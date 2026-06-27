//! Best-effort reader for the handful of `mapinfo.lua` fields the UI needs:
//! map metadata (name/description/author/version), the `smf` height range (to
//! prefill compile and scale the 3D preview), and appearance hints (water
//! colour/visibility, sky/sun) so the preview resembles the real map.
//!
//! There are two readers here. [`eval_appearance`] is preferred: it evaluates
//! `mapinfo.lua` in a sandboxed Spring Lua VM (`coilbox-springlua`), so it
//! handles computed values and `VFS.Include`d siblings. [`parse_appearance`] is
//! the **fallback** literal scanner, used when evaluation fails (a file reaching
//! for engine globals we don't stub, or Lua the VM rejects). It:
//!   - strips `--` line comments first (so a commented-out `--planeColor = {…}`
//!     is ignored),
//!   - matches keys as whole words, case-insensitively (the engine lowercases
//!     every key at load via `lowerkeys`, and source files use mixed case),
//!   - reads scalar / boolean / `{r,g,b}` vector / quoted-string literals,
//!     tolerating multi-line arrays and trailing commas.
//!
//! Anything computed, `require`d, or absent is simply omitted by the scanner;
//! callers fall back further (e.g. to the `.smf` header for the height range).
//! Scanner limitations: a `--` inside a string value truncates it, and the
//! first whole-word `name =` wins (the map's, which by convention precedes the
//! per-terrain-type `name =` entries).

use std::path::Path;

use coilbox_springlua::SpringLua;
use serde::{Deserialize, Serialize};

/// The subset of `mapinfo.lua` we surface. Every field is optional — present
/// only when found as a literal.
#[derive(Serialize, Default, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MapAppearance {
    pub name: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub version: Option<String>,
    pub min_height: Option<f64>,
    pub max_height: Option<f64>,
    pub void_water: Option<bool>,
    pub water_color: Option<[f32; 3]>,
    pub water_alpha: Option<f32>,
    pub sky_color: Option<[f32; 3]>,
    pub fog_color: Option<[f32; 3]>,
    pub sun_dir: Option<[f32; 3]>,
    pub sun_color: Option<[f32; 3]>,
}

fn is_ident(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Drop `--`-to-end-of-line comments. Best-effort: ignores Lua block comments
/// and `--` inside string literals (neither appears in the value lines we read,
/// bar the rare description containing `--`).
fn strip_comments(src: &str) -> String {
    src.lines()
        .map(|line| match line.find("--") {
            Some(i) => &line[..i],
            None => line,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Byte index just past the `=` of the first whole-word `key =` in `lower`
/// (which must be lowercase). ASCII lowercasing preserves byte offsets, so the
/// index is also valid in the original-case text.
fn value_at(lower: &str, key: &str) -> Option<usize> {
    let b = lower.as_bytes();
    let mut from = 0;
    while let Some(rel) = lower[from..].find(key) {
        let i = from + rel;
        let end = i + key.len();
        let prev_ok = i == 0 || !is_ident(b[i - 1]);
        let next_ok = end >= b.len() || !is_ident(b[end]);
        if prev_ok && next_ok {
            let mut j = end;
            while j < b.len() && (b[j] as char).is_whitespace() {
                j += 1;
            }
            if j < b.len() && b[j] == b'=' {
                return Some(j + 1);
            }
        }
        from = end;
    }
    None
}

fn scan_f64(lower: &str, key: &str) -> Option<f64> {
    let s = lower[value_at(lower, key)?..].trim_start();
    let tok: String = s
        .chars()
        .take_while(|c| !c.is_whitespace() && !matches!(c, ',' | '{' | '}'))
        .collect();
    tok.parse().ok()
}

fn scan_bool(lower: &str, key: &str) -> Option<bool> {
    let s = lower[value_at(lower, key)?..].trim_start();
    if s.starts_with("true") {
        Some(true)
    } else if s.starts_with("false") {
        Some(false)
    } else {
        None
    }
}

fn scan_vec3(lower: &str, key: &str) -> Option<[f32; 3]> {
    let s = lower[value_at(lower, key)?..].trim_start();
    let inner = s.strip_prefix('{')?;
    let inner = &inner[..inner.find('}')?];
    let nums: Vec<f32> = inner
        .split(',')
        .filter_map(|p| p.trim().parse().ok())
        .collect();
    (nums.len() >= 3).then(|| [nums[0], nums[1], nums[2]])
}

/// Read a `key = "value"` string from the original-case text, using the
/// lowercase copy only to locate the key.
fn scan_str(stripped: &str, lower: &str, key: &str) -> Option<String> {
    let s = stripped[value_at(lower, key)?..].trim_start();
    let s = s.strip_prefix('"')?;
    Some(s[..s.find('"')?].to_string())
}

/// Parse the supported fields out of a `mapinfo.lua` source string.
pub fn parse_appearance(src: &str) -> MapAppearance {
    let stripped = strip_comments(src);
    let lower = stripped.to_lowercase();
    MapAppearance {
        name: scan_str(&stripped, &lower, "name"),
        description: scan_str(&stripped, &lower, "description"),
        author: scan_str(&stripped, &lower, "author"),
        version: scan_str(&stripped, &lower, "version"),
        min_height: scan_f64(&lower, "minheight"),
        max_height: scan_f64(&lower, "maxheight"),
        void_water: scan_bool(&lower, "voidwater"),
        water_color: scan_vec3(&lower, "surfacecolor").or_else(|| scan_vec3(&lower, "planecolor")),
        water_alpha: scan_f64(&lower, "surfacealpha").map(|v| v as f32),
        sky_color: scan_vec3(&lower, "skycolor"),
        fog_color: scan_vec3(&lower, "fogcolor"),
        sun_dir: scan_vec3(&lower, "sundir"),
        sun_color: scan_vec3(&lower, "suncolor"),
    }
}

/// The nested shape of `mapinfo.lua` we deserialize from the evaluated table.
/// Keys are lowercase because `coilbox-springlua` applies the engine's
/// `lowerkeys` first; unknown keys (e.g. `terrainTypes`) are ignored.
#[derive(Deserialize, Default)]
#[serde(default)]
struct MapInfoRaw {
    name: Option<String>,
    description: Option<String>,
    author: Option<String>,
    version: Option<String>,
    voidwater: Option<bool>,
    smf: Smf,
    water: Water,
    atmosphere: Atmosphere,
    lighting: Lighting,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Smf {
    minheight: Option<f64>,
    maxheight: Option<f64>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Water {
    surfacecolor: Option<[f32; 3]>,
    planecolor: Option<[f32; 3]>,
    surfacealpha: Option<f32>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Atmosphere {
    skycolor: Option<[f32; 3]>,
    fogcolor: Option<[f32; 3]>,
    suncolor: Option<[f32; 3]>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Lighting {
    sundir: Option<[f32; 3]>,
}

impl From<MapInfoRaw> for MapAppearance {
    fn from(r: MapInfoRaw) -> Self {
        MapAppearance {
            name: r.name,
            description: r.description,
            author: r.author,
            version: r.version,
            min_height: r.smf.minheight,
            max_height: r.smf.maxheight,
            void_water: r.voidwater,
            // surfaceColor wins over planeColor, matching the scanner.
            water_color: r.water.surfacecolor.or(r.water.planecolor),
            water_alpha: r.water.surfacealpha,
            sky_color: r.atmosphere.skycolor,
            fog_color: r.atmosphere.fogcolor,
            sun_dir: r.lighting.sundir,
            sun_color: r.atmosphere.suncolor,
        }
    }
}

/// Evaluate `mapinfo.lua` (`src`) in a sandboxed Spring Lua VM rooted at `root`
/// (so `VFS.Include` resolves siblings). Returns `None` on any eval/sandbox
/// error — callers fall back to [`parse_appearance`].
pub fn eval_appearance(root: &Path, src: &str) -> Option<MapAppearance> {
    let lua = SpringLua::new(root).ok()?;
    let raw: MapInfoRaw = lua.eval_to(src, "mapinfo.lua").ok()?;
    Some(raw.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Inline-array, mixed-case, void-water map (mirrors tma20xr). planeColor is
    // commented out, so water_color must come from surfaceColor.
    const TMA: &str = r#"
        local mapinfo = {
            name        = "TMA20XR",
            shortname   = "TMA20XR",
            description = "The new optimized TMA | BAR Certified",
            author      = "IceXuick",
            version     = "2.1",
            mapfile     = "maps/TMA20.smf",
            voidWater   = true,
            smf = {
                minheight = -300,
                maxheight = 1150,
                smtFileName0 = "maps/TMA20.smt",
            },
            atmosphere = {
                fogColor = {0.07, 0.06, 0.05},
                sunColor = {1.0, 0.91, 0.75},
                skyColor = {0.64, 0.55, 0.43},
            },
            lighting = { sunDir = {-0.5, 0.53, -0.79} },
            water = {
                --planeColor = {0.0, 0.4, 0.0},
                surfaceColor  = {0.75, 0.8, 0.85},
                surfaceAlpha  = 0.55,
                forceRendering = false,
            },
            terrainTypes = { [0] = { name = "Space", hardness = 1.25 } },
        }
    "#;

    // Multi-line arrays, voidWater false, planeColor present (mirrors ATG2).
    const ATG: &str = r#"
        name = "All That Glitters v2.2.3",
        author = "Nikuksis",
        voidWater = false,
        smf = { minheight = 100, maxheight = 800 },
        atmosphere = {
            skyColor = {
                0.7,
                0.6,
                0.4,
            },
        },
        lighting = {
            sunDir = {
                0.5,
                0.4,
                -0.5,
            },
        },
        water = {
            surfaceColor  = {0.25, 0.40, 0.45},
            surfaceAlpha  = 0.6,
            planeColor = {0.13, 0.22, 0.25},
        },
    "#;

    #[test]
    fn parses_metadata_and_height() {
        let a = parse_appearance(TMA);
        assert_eq!(a.name.as_deref(), Some("TMA20XR"));
        assert_eq!(
            a.description.as_deref(),
            Some("The new optimized TMA | BAR Certified")
        );
        assert_eq!(a.author.as_deref(), Some("IceXuick"));
        assert_eq!(a.version.as_deref(), Some("2.1"));
        assert_eq!(a.min_height, Some(-300.0));
        assert_eq!(a.max_height, Some(1150.0));
    }

    #[test]
    fn parses_appearance_inline() {
        let a = parse_appearance(TMA);
        assert_eq!(a.void_water, Some(true));
        assert_eq!(a.water_color, Some([0.75, 0.8, 0.85]));
        assert_eq!(a.water_alpha, Some(0.55));
        assert_eq!(a.sky_color, Some([0.64, 0.55, 0.43]));
        assert_eq!(a.sun_dir, Some([-0.5, 0.53, -0.79]));
    }

    #[test]
    fn commented_planecolor_is_ignored() {
        // surfaceColor present, so it wins; but also confirm a lone commented
        // planeColor never leaks in.
        let only_commented = "water = { --planeColor = {0.1, 0.2, 0.3}, }";
        assert_eq!(parse_appearance(only_commented).water_color, None);
    }

    #[test]
    fn parses_multiline_arrays() {
        let a = parse_appearance(ATG);
        assert_eq!(a.name.as_deref(), Some("All That Glitters v2.2.3"));
        assert_eq!(a.void_water, Some(false));
        assert_eq!(a.min_height, Some(100.0));
        assert_eq!(a.max_height, Some(800.0));
        assert_eq!(a.sky_color, Some([0.7, 0.6, 0.4]));
        assert_eq!(a.sun_dir, Some([0.5, 0.4, -0.5]));
        assert_eq!(a.water_color, Some([0.25, 0.40, 0.45]));
    }

    #[test]
    fn whole_word_keys_dont_match_substrings() {
        // "name" must not be found inside "shortname"/"smtFileName0".
        let s = r#"shortname = "X", smtFileName0 = "Y", name = "Real","#;
        assert_eq!(parse_appearance(s).name.as_deref(), Some("Real"));
    }

    #[test]
    fn empty_on_no_match() {
        assert_eq!(parse_appearance("return {}"), MapAppearance::default());
    }

    // TMA is a `local mapinfo = {…}` block; wrapping it with `return mapinfo`
    // makes it a real evaluable file. The eval path must agree with the scanner
    // on a file both can read. (ATG is a non-returning loose fragment — only the
    // scanner handles that, which is exactly its fallback role.)
    #[test]
    fn eval_path_matches_scanner() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let src = format!("{TMA}\nreturn mapinfo");
        let evaled = eval_appearance(root, &src).expect("TMA evaluates");
        assert_eq!(evaled, parse_appearance(TMA));
    }
}
