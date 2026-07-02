# Faction Commander Build Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each faction's commander (start unit) build icon next to the faction name in the game detail page's Sides section.

**Architecture:** A new one-shot worker mode `--unit-buildpics` mounts a game's archive set once, resolves each start unit's build-pic filename (unitdef `buildpic` field via the restricted Lua parser, falling back to the `unitpics/<name>.*` convention), reads the texture from the primary archive, decodes it (adding DDS/BCn support via a new shared texture module), downscales and PNG-encodes it with alpha to a `data:` URL, and disk-caches the result. A new Tauri plugin command surfaces this to a session-cached React hook that renders the icons.

**Tech Stack:** Rust (`coilbox-unitsync-worker`, `tauri-plugin-coilbox-unitsync`), the `image` crate, new `ddsfile` + `texpresso` crates for DDS decode, TypeScript/React frontend.

**Design spec:** `docs/superpowers/specs/2026-07-02-faction-commander-build-icons-design.md`

---

## Notes for the implementer

- Branch is already `feat/faction-commander-build-icons` (created during design). Do all work there.
- The worker is a one-shot process: `Init` once, do one job, `UnInit`, print one JSON doc, exit. See `crates/coilbox-unitsync-worker/src/main.rs` header comment.
- Two crate API names must be confirmed against `cargo doc` during implementation — they are flagged inline where used. The TDD tests / compile are the gate; adjust getter names if 0.6 differs.
- Run `cargo test -p coilbox-unitsync-worker` and `cargo test -p tauri-plugin-coilbox-unitsync` after each Rust task.

---

## Task 1: Add DDS decoder dependencies to the worker

**Files:**
- Modify: `crates/coilbox-unitsync-worker/Cargo.toml`

- [ ] **Step 1: Add the two decode crates**

In `crates/coilbox-unitsync-worker/Cargo.toml`, under `[dependencies]` (after the `image = { ... }` block, before `base64`), add:

```toml
# DDS (DirectDraw Surface) decode for unit build pics, which are frequently
# DXT/BCn-compressed. ddsfile parses the container + format; texpresso does the
# pure-Rust BC1/2/3 block decompress. Decode-only — no C toolchain.
ddsfile = "0.6"
texpresso = "2"
```

- [ ] **Step 2: Verify it resolves and builds**

Run: `cargo build -p coilbox-unitsync-worker`
Expected: compiles (no code uses the crates yet; this just locks the dependency graph).

- [ ] **Step 3: Commit**

```bash
git add crates/coilbox-unitsync-worker/Cargo.toml crates/coilbox-unitsync-worker/Cargo.lock
git commit -m "build(unitsync-worker): add ddsfile + texpresso for DDS decode"
```

---

## Task 2: Shared texture-decode module (`texture.rs`)

A new module that decodes any supported texture (adding DDS) to an `image::RgbaImage`, and encodes an icon-sized PNG `data:` URL preserving alpha. Kept separate from `buildpic.rs` so archive preview / header art can adopt it later.

**Files:**
- Create: `crates/coilbox-unitsync-worker/src/texture.rs`
- Modify: `crates/coilbox-unitsync-worker/src/main.rs` (add `mod texture;`)

- [ ] **Step 1: Declare the module**

In `crates/coilbox-unitsync-worker/src/main.rs`, add to the module list (alphabetical, after `mod skirmishai;` — actually place with the others near the top, after `mod skirmishai;`):

```rust
mod skirmishai;
mod texture;
```

- [ ] **Step 2: Write the failing tests**

Create `crates/coilbox-unitsync-worker/src/texture.rs` with ONLY the tests first (implementation stubs added in the next step):

```rust
//! Shared texture decoding: turn a supported image (incl. DXT/BCn `.dds`) into an
//! `image::RgbaImage`, and encode a small PNG `data:` URL preserving alpha. Used by
//! the unit-buildpic mode; deliberately decoupled so archive preview and header art
//! can adopt DDS support later.

use base64::Engine;
use image::ImageEncoder;

/// Icons are downscaled to fit within this box (build pics are ~128px squares).
const ICON_MAX: u32 = 128;

#[cfg(test)]
mod tests {
    use super::*;

    /// A 2x2 RGBA PNG built in-memory decodes back to a 2x2 RgbaImage.
    #[test]
    fn decodes_png_bytes() {
        let img = image::RgbaImage::from_pixel(2, 2, image::Rgba([10, 20, 30, 255]));
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(img.as_raw(), 2, 2, image::ExtendedColorType::Rgba8)
            .unwrap();
        let out = decode_texture("png", &png).expect("png should decode");
        assert_eq!((out.width(), out.height()), (2, 2));
    }

    #[test]
    fn unknown_extension_is_none() {
        assert!(decode_texture("xyz", &[0, 1, 2]).is_none());
    }

    /// DXT fourcc + BCn DXGI formats map to the right texpresso format.
    #[test]
    fn bc_format_mapping() {
        use ddsfile::{D3DFormat, DxgiFormat};
        use texpresso::Format;
        assert_eq!(bc_format(Some(D3DFormat::DXT1), None), Some(Format::Bc1));
        assert_eq!(bc_format(Some(D3DFormat::DXT3), None), Some(Format::Bc2));
        assert_eq!(bc_format(Some(D3DFormat::DXT5), None), Some(Format::Bc3));
        assert_eq!(bc_format(None, Some(DxgiFormat::BC1_UNorm)), Some(Format::Bc1));
        assert_eq!(bc_format(None, Some(DxgiFormat::BC3_UNorm)), Some(Format::Bc3));
        assert_eq!(bc_format(None, None), None);
    }

    /// Encoding a small RgbaImage yields a PNG data URL.
    #[test]
    fn encodes_png_data_url() {
        let img = image::RgbaImage::from_pixel(8, 8, image::Rgba([1, 2, 3, 128]));
        let url = encode_icon_png(img).expect("should encode");
        assert!(url.starts_with("data:image/png;base64,"), "got: {url}");
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p coilbox-unitsync-worker texture::`
Expected: FAIL — `decode_texture`, `bc_format`, `encode_icon_png` not defined.

- [ ] **Step 4: Write the implementation**

Add above the `#[cfg(test)]` block in `texture.rs`:

```rust
/// Decode a texture by file extension into an `RgbaImage`, or `None` if the format
/// isn't supported or the bytes don't decode. `.dds` is DXT/BCn-decompressed;
/// everything else goes through the `image` crate (extension-driven because TGA has
/// no magic bytes).
pub fn decode_texture(ext: &str, bytes: &[u8]) -> Option<image::RgbaImage> {
    match ext.to_lowercase().as_str() {
        "dds" => decode_dds(bytes),
        "png" => load_rgba(bytes, image::ImageFormat::Png),
        "jpg" | "jpeg" => load_rgba(bytes, image::ImageFormat::Jpeg),
        "tga" => load_rgba(bytes, image::ImageFormat::Tga),
        "bmp" => load_rgba(bytes, image::ImageFormat::Bmp),
        "gif" => load_rgba(bytes, image::ImageFormat::Gif),
        _ => None,
    }
}

fn load_rgba(bytes: &[u8], format: image::ImageFormat) -> Option<image::RgbaImage> {
    Some(image::load_from_memory_with_format(bytes, format).ok()?.to_rgba8())
}

/// Decode a DXT/BCn `.dds` (the common Spring/Recoil build-pic case) into RGBA8.
/// Only block-compressed BC1/2/3 are handled; uncompressed or BC4/5/6/7 DDS return
/// `None` (treated as unresolved by the caller). CONFIRM getter names against
/// `cargo doc -p ddsfile`: `read`, `get_width`, `get_height`, `get_data`,
/// `get_d3d_format`, `get_dxgi_format`.
fn decode_dds(bytes: &[u8]) -> Option<image::RgbaImage> {
    let dds = ddsfile::Dds::read(bytes).ok()?;
    let (w, h) = (dds.get_width(), dds.get_height());
    let format = bc_format(dds.get_d3d_format(), dds.get_dxgi_format())?;
    let data = dds.get_data(0).ok()?;
    let mut rgba = vec![0u8; (w as usize) * (h as usize) * 4];
    format.decompress(data, w as usize, h as usize, &mut rgba);
    image::RgbaImage::from_raw(w, h, rgba)
}

/// Map a DDS fourcc (`D3DFormat`) or modern `DxgiFormat` to the texpresso block
/// format. Prefers the legacy fourcc (what most Spring build pics carry).
fn bc_format(
    d3d: Option<ddsfile::D3DFormat>,
    dxgi: Option<ddsfile::DxgiFormat>,
) -> Option<texpresso::Format> {
    use ddsfile::{D3DFormat, DxgiFormat};
    use texpresso::Format;
    if let Some(f) = d3d {
        return match f {
            D3DFormat::DXT1 => Some(Format::Bc1),
            D3DFormat::DXT2 | D3DFormat::DXT3 => Some(Format::Bc2),
            D3DFormat::DXT4 | D3DFormat::DXT5 => Some(Format::Bc3),
            _ => None,
        };
    }
    match dxgi? {
        DxgiFormat::BC1_UNorm | DxgiFormat::BC1_UNorm_sRGB => Some(Format::Bc1),
        DxgiFormat::BC2_UNorm | DxgiFormat::BC2_UNorm_sRGB => Some(Format::Bc2),
        DxgiFormat::BC3_UNorm | DxgiFormat::BC3_UNorm_sRGB => Some(Format::Bc3),
        _ => None,
    }
}

/// Downscale to fit `ICON_MAX` (preserving aspect, never upscaling) and encode a
/// PNG `data:` URL. PNG (not JPEG) preserves the transparent backgrounds build pics
/// usually have.
pub fn encode_icon_png(img: image::RgbaImage) -> Option<String> {
    let dynimg = image::DynamicImage::ImageRgba8(img);
    let scaled = if dynimg.width() > ICON_MAX || dynimg.height() > ICON_MAX {
        dynimg.thumbnail(ICON_MAX, ICON_MAX)
    } else {
        dynimg
    };
    let rgba = scaled.to_rgba8();
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            image::ExtendedColorType::Rgba8,
        )
        .ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&png)
    ))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p coilbox-unitsync-worker texture::`
Expected: PASS (4 tests). If `bc_format_mapping` fails to compile, fix the `DxgiFormat`/`D3DFormat` variant names to match the installed `ddsfile` and re-run.

- [ ] **Step 6: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/texture.rs crates/coilbox-unitsync-worker/src/main.rs
git commit -m "feat(unitsync-worker): shared texture decode with DDS/BCn support"
```

---

## Task 3: `UnitBuildpicsOutput` model type

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/model.rs` (after the `GameInfoOutput` struct, ~line 224)

- [ ] **Step 1: Add the output struct**

After `GameInfoOutput` in `model.rs`, add:

```rust
/// Output of `--unit-buildpics`: a map of unit internal name -> build-icon `data:`
/// URL, for the units that resolved. Units with no usable build pic are simply
/// absent (and negative-cached on disk so re-runs skip them).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UnitBuildpicsOutput {
    pub buildpics: std::collections::BTreeMap<String, String>,
    pub errors: Vec<String>,
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo build -p coilbox-unitsync-worker`
Expected: compiles (struct unused for now — a `dead_code` warning is acceptable until Task 4 wires it).

- [ ] **Step 3: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/model.rs
git commit -m "feat(unitsync-worker): UnitBuildpicsOutput model"
```

---

## Task 4: Buildpic resolution module (`buildpic.rs`)

The core worker logic. Pure helpers (Lua-result parsing, candidate filename ordering) are TDD'd; the unitsync-driven `render` is exercised by the live smoke test in Task 9.

**Files:**
- Create: `crates/coilbox-unitsync-worker/src/buildpic.rs`
- Modify: `crates/coilbox-unitsync-worker/src/main.rs` (add `mod buildpic;`)

- [ ] **Step 1: Declare the module**

In `main.rs`, next to the other `mod` lines (after `mod archive;`):

```rust
mod archive;
mod buildpic;
```

- [ ] **Step 2: Write the failing tests**

Create `crates/coilbox-unitsync-worker/src/buildpic.rs` with the module doc + pure helpers' tests first:

```rust
//! `--unit-buildpics` mode: resolve each requested start unit's build icon.
//!
//! In one `AddAllArchives` session: run the Lua parser once to read each unit's
//! `buildpic` field (games that override the default), then read the texture from
//! `unitpics/` in the primary archive (mirroring `archive::game_headers`), decode
//! it (via `crate::texture`, which adds DDS), and PNG-encode a small `data:` URL.
//! Disk-cached per (game-identity, unit), keyed on cheap file identity like the
//! header cache.

use crate::ffi::Unitsync;
use crate::model::UnitBuildpicsOutput;
use std::path::Path;

/// Salts the buildpic cache key, independent of the header cache so this cache can
/// be invalidated on its own. Bump when the icon encoding changes.
const BUILDPIC_CACHE_VERSION: u32 = 1;

/// Read up to this many bytes of a candidate texture before decoding (build pics
/// are tiny; this is a generous safety bound).
const BUILDPIC_READ_CAP: usize = 8 * 1024 * 1024;

/// Extensions tried under `unitpics/`, in the engine's resolution order.
const BUILDPIC_EXTS: &[&str] = &["dds", "png", "tga", "bmp"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tab_separated_buildpic_result() {
        let got = parse_buildpic_result("armcom\tunitpics/armcom.dds\ncorcom\t\n");
        assert_eq!(got.get("armcom").map(String::as_str), Some("unitpics/armcom.dds"));
        assert_eq!(got.get("corcom").map(String::as_str), Some(""));
    }

    #[test]
    fn candidates_prefer_explicit_buildpic_then_unit_name() {
        // Explicit buildpic with a directory is tried verbatim first, then by
        // basename across extensions, then the unit name across extensions.
        let c = candidate_members("armcom", "unitpics/ArmCom_alt.png");
        assert_eq!(c[0], "unitpics/ArmCom_alt.png");
        assert!(c.contains(&"unitpics/armcom_alt.dds".to_string()));
        assert!(c.contains(&"unitpics/armcom.dds".to_string()));
    }

    #[test]
    fn candidates_with_no_buildpic_use_unit_name_only() {
        let c = candidate_members("armcom", "");
        assert_eq!(c[0], "unitpics/armcom.dds");
        assert!(c.contains(&"unitpics/armcom.png".to_string()));
    }

    #[test]
    fn lua_script_lists_requested_units() {
        let s = build_buildpic_script(&["armcom".into(), "corcom".into()]);
        assert!(s.contains("['armcom']") && s.contains("['corcom']"));
        assert!(s.contains("VFS.Include"));
        assert!(s.contains("result ="));
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p coilbox-unitsync-worker buildpic::`
Expected: FAIL — helpers not defined.

- [ ] **Step 4: Write the pure helpers**

Add above the `#[cfg(test)]` block:

```rust
/// Build the Lua script run through the parser. It reads each requested unit's
/// `buildpic` field from `units/<name>.lua` (keyed by unit name inside the file),
/// and returns a flat `name\tbuildpic` string in the `result` field that
/// `run_lua_source` reads back. Empty buildpic => fall back to the name convention.
fn build_buildpic_script(units: &[String]) -> String {
    // Unit internal names are alnum/underscore, so a single-quoted key is safe.
    let want: String = units
        .iter()
        .map(|u| format!("['{}']=1,", u.to_lowercase()))
        .collect();
    format!(
        r#"
local want = {{ {want} }}
local parts = {{}}
for name in pairs(want) do
  local bp = ''
  local ok, def = pcall(VFS.Include, 'units/'..name..'.lua')
  if ok and type(def) == 'table' then
    local ud = def[name]
    if type(ud) ~= 'table' then
      for k, v in pairs(def) do
        if type(v) == 'table' and string.lower(k) == name then ud = v break end
      end
    end
    if type(ud) == 'table' and type(ud.buildpic) == 'string' then bp = ud.buildpic end
  end
  parts[#parts + 1] = name .. '\t' .. bp
end
return {{ result = table.concat(parts, '\n') }}
"#
    )
}

/// Parse the `name\tbuildpic` lines the Lua script returns into a map.
fn parse_buildpic_result(raw: &str) -> std::collections::HashMap<String, String> {
    raw.lines()
        .filter_map(|line| {
            let (name, bp) = line.split_once('\t')?;
            Some((name.to_string(), bp.to_string()))
        })
        .collect()
}

/// Ordered, deduped candidate member paths under `unitpics/` for a unit. Explicit
/// buildpic (if it has a directory) is tried verbatim first, then its basename
/// across extensions, then the unit name across extensions. All lowercased except
/// the verbatim path (matched case-insensitively by the caller).
fn candidate_members(unit_name: &str, buildpic: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let bp = buildpic.trim();
    if !bp.is_empty() {
        if bp.contains('/') {
            push_unique(&mut out, bp.to_string());
        }
        let base = bp.rsplit('/').next().unwrap_or(bp);
        let base = base.rsplit_once('.').map(|(b, _)| b).unwrap_or(base);
        for ext in BUILDPIC_EXTS {
            push_unique(&mut out, format!("unitpics/{}.{ext}", base.to_lowercase()));
        }
    }
    for ext in BUILDPIC_EXTS {
        push_unique(&mut out, format!("unitpics/{}.{ext}", unit_name.to_lowercase()));
    }
    out
}

/// Append `s` to `v` only if not already present (small N, so linear scan is fine).
fn push_unique(v: &mut Vec<String>, s: String) {
    if !v.contains(&s) {
        v.push(s);
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p coilbox-unitsync-worker buildpic::`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the `render` entry point + cache + emit_error**

Append to `buildpic.rs` (below the helpers, above `#[cfg(test)]`):

```rust
/// Resolve build icons for `units` in `game_archive`. Cache hits/negatives skip the
/// unitsync session entirely; otherwise mount the archive once and resolve the
/// misses. `cache_dir` `None` disables caching (always re-resolves).
pub fn render(
    lib: &str,
    game_archive: &str,
    units: &[String],
    cache_dir: Option<&Path>,
) -> UnitBuildpicsOutput {
    let mut buildpics = std::collections::BTreeMap::new();
    let mut errors = Vec::new();

    // We can only know each unit's cache key after loading unitsync (it needs the
    // archive's on-disk identity), so load first, then check the cache per unit.
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return UnitBuildpicsOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    errors.extend(us.drain_errors());

    let key_base = cache_key_base(&us, game_archive);
    let cache = cache_dir.zip(key_base.as_ref());

    // Partition into cache hits (done) and misses (need the archive mounted).
    let mut misses: Vec<String> = Vec::new();
    for unit in units {
        if let Some((dir, base)) = cache {
            match read_cache(dir, base, unit) {
                Some(Some(url)) => {
                    buildpics.insert(unit.clone(), url);
                    continue;
                }
                Some(None) => continue, // negative cache: no icon
                None => {}
            }
        }
        misses.push(unit.clone());
    }

    if misses.is_empty() {
        us.uninit();
        return UnitBuildpicsOutput { buildpics, errors };
    }

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
        us.uninit();
        return UnitBuildpicsOutput { buildpics, errors };
    }
    errors.extend(us.drain_errors());

    // One Lua pass reads the explicit `buildpic` fields for the miss units.
    let script = build_buildpic_script(&misses);
    let fields = match us.run_lua_source(&script, "rmMbe") {
        Ok(raw) => parse_buildpic_result(&raw),
        Err(e) => {
            errors.push(format!("buildpic lua resolve failed: {e}"));
            std::collections::HashMap::new()
        }
    };
    let _ = us.drain_errors();

    // Read textures from the primary archive (like game_headers): list once,
    // case-insensitive match against each unit's candidate members.
    let members = match crate::archive::resolve_open_path(&us, game_archive)
        .as_deref()
        .and_then(|p| us.open_archive(p))
    {
        Some(handle) => {
            let list: Vec<(String, String)> = us
                .list_archive_files(handle)
                .into_iter()
                .map(|(path, _)| (path.to_lowercase(), path))
                .collect();
            for unit in &misses {
                let bp = fields.get(&unit.to_lowercase()).cloned().unwrap_or_default();
                let url = candidate_members(unit, &bp).into_iter().find_map(|cand| {
                    let actual = list
                        .iter()
                        .find(|(lower, _)| *lower == cand.to_lowercase())
                        .map(|(_, real)| real.clone())?;
                    read_and_encode(&us, handle, &actual)
                });
                if let Some((dir, base)) = cache {
                    write_cache(dir, base, unit, url.as_deref());
                }
                if let Some(url) = url {
                    buildpics.insert(unit.clone(), url);
                }
            }
            us.close_archive(handle);
            true
        }
        None => false,
    };
    if !members {
        errors.push(format!("could not open archive {game_archive}"));
    }

    errors.extend(us.drain_errors());
    us.remove_all_archives();
    us.uninit();

    UnitBuildpicsOutput { buildpics, errors }
}

/// Read one member (capped) and decode+encode it as a build-icon PNG data URL.
fn read_and_encode(us: &Unitsync, handle: i32, member: &str) -> Option<String> {
    let ext = member.rsplit('.').next().unwrap_or("").to_lowercase();
    let (size, bytes) = us.read_archive_member(handle, member, BUILDPIC_READ_CAP)?;
    if size as usize > BUILDPIC_READ_CAP {
        return None;
    }
    let img = crate::texture::decode_texture(&ext, &bytes)?;
    crate::texture::encode_icon_png(img)
}

/// Cheap, stable per-game cache identity (path + size + mtime + version salt).
/// `None` disables caching for this game. Mirrors `archive::game_cache_key`.
fn cache_key_base(us: &Unitsync, archive_name: &str) -> Option<String> {
    use std::hash::{Hash, Hasher};
    let dir = us.archive_path(archive_name)?;
    let path = Path::new(&dir).join(archive_name);
    let md = std::fs::metadata(&path).ok()?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    BUILDPIC_CACHE_VERSION.hash(&mut h);
    path.hash(&mut h);
    md.len().hash(&mut h);
    mtime.hash(&mut h);
    Some(format!("{:016x}", h.finish()))
}

/// Per-unit cache file stem: `<gamekey>_<sanitized-unit>`.
fn unit_stem(base: &str, unit: &str) -> String {
    let safe: String = unit
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{base}_{safe}")
}

/// `Some(Some(url))` = cached icon; `Some(None)` = negative cache; `None` = miss.
fn read_cache(dir: &Path, base: &str, unit: &str) -> Option<Option<String>> {
    let stem = unit_stem(base, unit);
    if let Ok(url) = std::fs::read_to_string(dir.join(format!("{stem}.dataurl"))) {
        return Some(Some(url));
    }
    if dir.join(format!("{stem}.none")).exists() {
        return Some(None);
    }
    None
}

/// Best-effort cache write: `.dataurl` for a hit, `.none` marker for no icon.
fn write_cache(dir: &Path, base: &str, unit: &str, url: Option<&str>) {
    let _ = std::fs::create_dir_all(dir);
    let stem = unit_stem(base, unit);
    match url {
        Some(u) => {
            let _ = std::fs::write(dir.join(format!("{stem}.dataurl")), u);
        }
        None => {
            let _ = std::fs::write(dir.join(format!("{stem}.none")), b"");
        }
    }
}

/// Print a buildpics error envelope to stdout (used on the panic path in `main`).
pub fn emit_error(msg: String) {
    let out = UnitBuildpicsOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}
```

- [ ] **Step 7: Make `resolve_open_path` reachable from `buildpic.rs`**

`render` calls `crate::archive::resolve_open_path`. In `crates/coilbox-unitsync-worker/src/archive.rs`, find `fn resolve_open_path(` (around line 98) and change its visibility to `pub(crate) fn resolve_open_path(`. Do not change its body.

- [ ] **Step 8: Run tests + build to verify**

Run: `cargo test -p coilbox-unitsync-worker buildpic::`
Expected: PASS (the 4 pure-helper tests; `render` is not unit-tested).
Run: `cargo build -p coilbox-unitsync-worker`
Expected: compiles.

- [ ] **Step 9: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/buildpic.rs crates/coilbox-unitsync-worker/src/main.rs crates/coilbox-unitsync-worker/src/archive.rs
git commit -m "feat(unitsync-worker): resolve unit build pics (lua field + unitpics convention)"
```

---

## Task 5: Wire `--unit-buildpics` into the worker CLI

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/main.rs` (`Args` struct, `parse_args`, `run` dispatch)

- [ ] **Step 1: Add fields to `Args`**

In `struct Args` (main.rs ~line 34), after the `game_headers: bool,` field group, add:

```rust
    /// `--unit-buildpics`: resolve start-unit build icons for `--game`, for the
    /// units listed in `--units` (comma-separated).
    unit_buildpics: bool,
    units: Vec<String>,
```

- [ ] **Step 2: Parse the new flags**

In `parse_args`, add local mut vars near the others (after `let mut game_headers = false;`):

```rust
    let mut unit_buildpics = false;
    let mut units: Vec<String> = Vec::new();
```

Add match arms (after the `"--game-headers" => game_headers = true,` arm):

```rust
            "--unit-buildpics" => unit_buildpics = true,
            "--units" => {
                units = it
                    .next()
                    .map(|s| {
                        s.split(',')
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default()
            }
```

Add both to the returned `Args { ... }` literal (after `game_headers,`):

```rust
        unit_buildpics,
        units,
```

- [ ] **Step 3: Dispatch the mode**

In `run()`, insert this block immediately after the `--game-headers` block (after its closing `}` near line 151, before the "Archive browsing" `if let Some(archive_name)` block):

```rust
    // Unit build icons: resolve start-unit build pics for one game in one Init,
    // disk-cached like game headers. Checked before the --game modes because it
    // also keys off --game.
    if args.unit_buildpics {
        let game_archive = args.game.clone().unwrap_or_default();
        let units = args.units.clone();
        return match std::panic::catch_unwind(|| {
            buildpic::render(&args.lib, &game_archive, &units, cache_dir)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                buildpic::emit_error("worker panicked while resolving unit build pics".into());
                1
            }
        };
    }
```

- [ ] **Step 4: Verify build + existing tests**

Run: `cargo build -p coilbox-unitsync-worker`
Expected: compiles, no unused-field warnings.
Run: `cargo test -p coilbox-unitsync-worker`
Expected: PASS (all worker tests).

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/main.rs
git commit -m "feat(unitsync-worker): --unit-buildpics CLI mode"
```

---

## Task 6: Plugin arg builder + command

**Files:**
- Modify: `crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs`
- Modify: `crates/tauri-plugin-coilbox-unitsync/src/lib.rs`
- Modify: `crates/tauri-plugin-coilbox-unitsync/build.rs`
- Modify: `crates/tauri-plugin-coilbox-unitsync/permissions/default.toml`

- [ ] **Step 1: Write the failing arg-builder test**

In `crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs`, inside `mod tests`, add:

```rust
    #[test]
    fn build_unit_buildpics_args_carry_game_units_and_cache_dir() {
        let a = build_unit_buildpics_args(
            "/eng/libunitsync.so",
            "/data",
            "BAR.sdd",
            &["armcom".into(), "corcom".into()],
            Some("/cache/buildpics"),
        );
        assert!(a.contains(&"--unit-buildpics".to_string()));
        let g = a.iter().position(|x| x == "--game").unwrap();
        assert_eq!(a[g + 1], "BAR.sdd");
        let u = a.iter().position(|x| x == "--units").unwrap();
        assert_eq!(a[u + 1], "armcom,corcom");
        assert_eq!(&a[a.len() - 2..], &["--cache-dir", "/cache/buildpics"]);

        let without =
            build_unit_buildpics_args("/eng/libunitsync.so", "/data", "BAR.sdd", &[], None);
        assert!(without.contains(&"--unit-buildpics".to_string()));
        assert!(!without.iter().any(|x| x == "--cache-dir"));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p tauri-plugin-coilbox-unitsync build_unit_buildpics_args`
Expected: FAIL — `build_unit_buildpics_args` not defined.

- [ ] **Step 3: Add the arg builder**

In `sidecar.rs`, after `build_game_headers_args` (~line 89), add:

```rust
/// Build args for `--unit-buildpics` mode: the game whose start-unit build icons
/// to resolve, the comma-joined unit names, and the optional on-disk cache dir.
pub fn build_unit_buildpics_args(
    lib: &str,
    datadir: &str,
    game: &str,
    units: &[String],
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--unit-buildpics".into());
    args.push("--game".into());
    args.push(game.into());
    args.push("--units".into());
    args.push(units.join(","));
    push_cache_dir(&mut args, cache_dir);
    args
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p tauri-plugin-coilbox-unitsync build_unit_buildpics_args`
Expected: PASS.

- [ ] **Step 5: Add the cache-dir helper + command in `lib.rs`**

In `lib.rs`, after `HEADER_CACHE_SUBDIR` (~line 71), add:

```rust
/// Subdirectory of the app cache dir holding resolved unit build-icon `data:` URLs.
const BUILDPIC_CACHE_SUBDIR: &str = "coilbox-unitsync-buildpics";
```

After `header_cache_dir` (~line 90), add:

```rust
/// The on-disk unit build-icon cache directory, under the app cache dir. `None`
/// when the platform can't resolve a cache dir (caching is then skipped).
fn buildpic_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_cache_dir()
        .ok()
        .map(|d| d.join(BUILDPIC_CACHE_SUBDIR))
}
```

After `unitsync_game_info` (~line 385), add the command:

```rust
/// `unitsync_unit_buildpics` — resolve build icons for a game's start units in one
/// session. `game_archive` is the game's primary archive; `units` are the units'
/// internal names (e.g. `armcom`). Disk-cached under the app cache dir, keyed on
/// cheap file identity. Returns `{ buildpics: { name: dataUrl }, errors }`.
#[tauri::command]
async fn unitsync_unit_buildpics<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game_archive: String,
    units: Vec<String>,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let cache_dir = buildpic_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_unit_buildpics_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &game_archive,
        &units,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, SCAN_TIMEOUT, "unit buildpics", None).await)
}
```

- [ ] **Step 6: Import the arg builder**

At the top of `lib.rs` there is a `use sidecar::{ ... };` block (lines 14-19) listing the builders. Add `build_unit_buildpics_args,` to it (e.g. after `build_thumbnails_args,`), keeping the list alphabetical-ish as it already is.

- [ ] **Step 7: Register the handler**

In `init()`'s `generate_handler!` list (~line 566), add `unitsync_unit_buildpics,` after `unitsync_game_info,`.

- [ ] **Step 8: Add to `build.rs` COMMANDS**

In `crates/tauri-plugin-coilbox-unitsync/build.rs`, add `"unitsync_unit_buildpics",` to the `COMMANDS` array (after `"unitsync_game_info",`).

- [ ] **Step 9: Add the permission**

In `crates/tauri-plugin-coilbox-unitsync/permissions/default.toml`, add `"allow-unitsync-unit-buildpics",` to the `permissions` array (after `"allow-unitsync-game-info",`).

- [ ] **Step 10: Build + test the plugin crate**

Run: `cargo build -p tauri-plugin-coilbox-unitsync`
Expected: compiles; the tauri-plugin build helper autogenerates `allow-unitsync-unit-buildpics` from COMMANDS.
Run: `cargo test -p tauri-plugin-coilbox-unitsync`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs crates/tauri-plugin-coilbox-unitsync/src/lib.rs crates/tauri-plugin-coilbox-unitsync/build.rs crates/tauri-plugin-coilbox-unitsync/permissions/default.toml
git commit -m "feat(unitsync-plugin): unitsync_unit_buildpics command"
```

---

## Task 7: TypeScript binding + hook

**Files:**
- Modify: `src/content/bindings.ts` (after `unitsyncGameInfo`, ~line 313)
- Modify: `src/content/config.ts` (after `useUnitsyncGameInfo`, ~line 435)

- [ ] **Step 1: Add the binding**

In `src/content/bindings.ts`, after the `unitsyncGameInfo` definition (~line 313), add:

```ts
export interface UnitBuildpicsResult {
  /** Unit internal name -> build-icon `data:` URL, for units that resolved. */
  buildpics: Record<string, string>;
  errors: string[];
}

/**
 * Resolve build icons for a game's start units — lazy, since it mounts the game's
 * archive set. `gameArchive` is the primary archive; `units` are internal names.
 */
export const unitsyncUnitBuildpics = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    gameArchive: string;
    units: string[];
  },
  UnitBuildpicsResult
>("coilbox-unitsync", "unitsync_unit_buildpics");
```

- [ ] **Step 2: Add the session-cached hook**

In `src/content/config.ts`, first ensure `UnitBuildpicsResult` and `unitsyncUnitBuildpics` are imported from `./bindings` (add them to the existing bindings import). Then, after `useUnitsyncGameInfo` (ends ~line 435), add:

```ts
/** Session cache of unit build icons, keyed by dataDir::engine::game::units. */
const buildpicsCache = new Map<string, UnitBuildpicsResult>();

/** Lazily resolve build icons for a game's start units. */
export function useUnitsyncUnitBuildpics(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
  units?: string[],
) {
  const [data, setData] = useState<UnitBuildpicsResult | null>(null);
  // Stable, order-independent key for the requested unit set.
  const unitsKey = (units ?? []).slice().sort().join(",");

  useEffect(() => {
    if (!enginePath || !dataDir || !gameArchive || !units || units.length === 0) {
      setData(null);
      return;
    }
    const key = `${dataDir}::${enginePath}::${gameArchive}::${unitsKey}`;
    const cached = buildpicsCache.get(key);
    if (cached) {
      setData(cached);
      return;
    }
    let cancelled = false;
    unitsyncUnitBuildpics({ enginePath, dataDir, gameArchive, units })
      .then((res) => {
        if (cancelled) return;
        buildpicsCache.set(key, res);
        setData(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // unitsKey stands in for `units` (arrays are unstable references).
  }, [enginePath, dataDir, gameArchive, unitsKey]);

  return data;
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `bun run typecheck`
Expected: no errors.
Run: `bunx biome ci src/content/bindings.ts src/content/config.ts`
Expected: no errors. (If biome flags the `useEffect` dep comment or import order, apply its fix.)

- [ ] **Step 4: Commit**

```bash
git add src/content/bindings.ts src/content/config.ts
git commit -m "feat(content): unitsync_unit_buildpics binding + hook"
```

---

## Task 8: Render icons in the Sides section

**Files:**
- Modify: `src/content/pages/GameDetailPage.tsx`

- [ ] **Step 1: Import the hook + `useMemo`**

In `GameDetailPage.tsx`, add `useMemo` to the React import (add `import { useMemo } from "react";` if no React import exists yet — check the top of the file; if there's already a react import line, add `useMemo` to it). Add `useUnitsyncUnitBuildpics` to the existing `../config` import (the block importing `useUnitsyncGameInfo`).

- [ ] **Step 2: Collect start units + call the hook**

After the `useUnitsyncGameInfo` call (~line 43-47), add:

```tsx
  const startUnits = useMemo(
    () =>
      gameInfo
        ? Array.from(
            new Set(
              gameInfo.sides
                .map((s) => s.startUnit)
                .filter((u): u is string => !!u),
            ),
          )
        : [],
    [gameInfo],
  );
  const buildpics = useUnitsyncUnitBuildpics(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
    startUnits,
  );
```

- [ ] **Step 3: Render the icon in each side's `<li>`**

Replace the `<li>` body in the Sides list (~lines 133-143) with an icon-aware layout. Change:

```tsx
                <li
                  key={s.name}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card p-3"
                >
                  <span className="font-medium">{s.name}</span>
                  {(s.startUnitName || s.startUnit) && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {s.startUnitName ?? s.startUnit}
                    </span>
                  )}
                </li>
```

to:

```tsx
                <li
                  key={s.name}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card p-3"
                >
                  <div className="flex items-center gap-2">
                    {s.startUnit && buildpics?.buildpics[s.startUnit] && (
                      <img
                        src={buildpics.buildpics[s.startUnit]}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded object-contain"
                      />
                    )}
                    <span className="font-medium">{s.name}</span>
                  </div>
                  {(s.startUnitName || s.startUnit) && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {s.startUnitName ?? s.startUnit}
                    </span>
                  )}
                </li>
```

(The icon is decorative — the faction name and start-unit name are already text — so `alt=""` is correct per the a11y rule against redundant alt text.)

- [ ] **Step 4: Typecheck + lint**

Run: `bun run typecheck`
Expected: no errors.
Run: `bunx biome ci src/content/pages/GameDetailPage.tsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/content/pages/GameDetailPage.tsx
git commit -m "feat(content): show commander build icons next to factions"
```

---

## Task 9: Full lint sweep + live smoke test

The DDS decode path and the unitsync-driven `render` are only exercisable against a real game, so this is the gate for those.

**Files:** none (verification only)

- [ ] **Step 1: Run the full CI lint suite locally**

Run: `cargo fmt --all --check`
Run: `cargo clippy --all-targets --all-features -- -D warnings`
Run: `bunx biome ci .`
Run: `bun run typecheck`
Expected: all pass. Fix any findings (rustfmt: run `cargo fmt --all` to auto-fix).

Note: clippy compiles the Tauri app crate, which needs the sidecars built. If clippy fails to find `coilbox-unitsync-worker`, build it first: `bun run sidecar:unitsync` (see CLAUDE.md).

- [ ] **Step 2: Build the worker sidecar for dev**

Run: `bun run sidecar:unitsync`
Expected: builds the worker; `bun tauri dev` will pick it up (or set `UNITSYNC_WORKER` to the built binary path).

- [ ] **Step 3: Live smoke via `bun tauri dev`**

Hand off to the user (per CLAUDE.md, give them a chance to test):
- Open a game detail page for a real game that ships DDS build pics (BAR, or Balanced Annihilation).
- Confirm each faction row in the Sides section shows the commander's build icon at 32px, with a transparent background (not a black/opaque box), left of the faction name.
- Confirm a game with no resolvable build pic (or a non-unit game) still renders the Sides list without broken-image placeholders.
- Confirm the icons load instantly on the second visit (disk cache hit).
- Capture screenshots via the Tauri MCP for the PR.

- [ ] **Step 4: If DDS icons render as black boxes or fail to decode**

This means the `bc_format` mapping or `decode_dds` getter names are off for the installed `ddsfile`. Debug: temporarily log the resolved `D3DFormat`/`DxgiFormat` in `decode_dds`, confirm against `cargo doc -p ddsfile`, and correct the mapping. Re-run the smoke test. (Uncompressed DDS is intentionally unsupported and negative-cached — that's expected, not a bug.)

- [ ] **Step 5: Clear stale cache if needed during testing**

If iterating on the encoder, the disk cache will serve old results. Delete the cache dir between runs: it's `coilbox-unitsync-buildpics` under the app cache dir (macOS: `~/Library/Caches/<app-id>/`).

---

## Task 10: PR

- [ ] **Step 1: Confirm the branch is clean and pushed**

```bash
git status
git push -u origin feat/faction-commander-build-icons
```

- [ ] **Step 2: Draft the PR description and get user approval**

Per the user's global rules, get approval on the PR description before creating the PR. Keep it short: the *why* (commander icons next to factions; reuses the header-cache pattern; adds a shared DDS decoder other surfaces can adopt), not a diff restatement. Note the known limitations: build pics read from the primary archive only (like headers); uncompressed/BC4-7 DDS unsupported.

- [ ] **Step 3: Create the PR**

```bash
gh pr create --base main --head feat/faction-commander-build-icons --title "..." --body "..."
```

---

## Self-review notes (author)

- **Spec coverage:** worker mode (T4/T5), DDS shared decoder (T2), cache mirroring headers (T4), plugin command + ACL wiring (T6), binding + session hook (T7), UI icons with null fallback (T8), tests + live smoke (T2/T4/T6/T9). All spec sections map to a task.
- **Type consistency:** `UnitBuildpicsOutput.buildpics` (Rust `BTreeMap<String,String>`) ↔ `UnitBuildpicsResult.buildpics` (`Record<string,string>`); command name `unitsync_unit_buildpics` used identically in worker CLI (`--unit-buildpics`), `build_unit_buildpics_args`, plugin command, `build.rs` COMMANDS, `default.toml` (`allow-unitsync-unit-buildpics`), and the TS `defineCommand`.
- **Known limitations (intentional, noted in PR):** primary-archive-only texture read (same as header art); BC1/2/3 only.
```
