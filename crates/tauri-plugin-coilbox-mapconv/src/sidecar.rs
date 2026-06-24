//! Locate the bundled SpringMapConvNG sidecars (`mapcompile` / `mapdecompile`)
//! and translate a frontend request into their CLI argument vectors. The
//! `build_*_args` functions are pure so they can be unit-tested without spawning
//! anything; the actual spawn/stream lives in `lib.rs` where it has the Tauri
//! Channel and managed state.
//!
//! These are legacy getopt-style binaries: every flag is a single dash, value
//! flags are TWO argv tokens (`-t` then the value), and boolean flags
//! (`-noclamp`, `-smooth`) are lone tokens with no value. Never use `=`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Resolve a bundled sidecar by base name (`"mapcompile"` | `"mapdecompile"`).
/// The env override `MAPCONV_<NAME>_SIDECAR` (e.g. `MAPCONV_MAPCOMPILE_SIDECAR`)
/// wins — handy for `tauri dev` and tests. Otherwise look in the bundled
/// `mapconv/` resource folder, where the binary sits beside its `libs/` (the
/// mac/Windows binaries load DevIL etc. via `@executable_path/libs`, so they
/// must stay in that folder — hence a resource dir, not `externalBin`).
pub fn resolve_sidecar(resource_dir: Option<&Path>, name: &str) -> Option<PathBuf> {
    let env_key = format!("MAPCONV_{}_SIDECAR", name.to_uppercase());
    if let Ok(p) = std::env::var(&env_key) {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    let exe_name = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let candidate = resource_dir?.join("mapconv").join(exe_name);
    candidate.exists().then_some(candidate)
}

/// One streamed output line from a run.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub stream: String, // "out" | "err"
    pub line: String,
}

/// A `mapcompile` request from the frontend. One field per CLI flag; the output
/// directory is NOT here — it is passed separately as the spawn cwd, because
/// `-o` must be a bare suffix (mapcompile bakes `<suffix>.smt` into the `.smf` as
/// the tile reference, so an absolute path would corrupt the map).
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CompileOpts {
    pub maintexture: String, // -t (required, absolute path)
    pub out_suffix: String,  // -o (required, bare basename)
    pub heightmap: Option<String>, // -h
    pub maxh: Option<f64>,         // -maxh
    pub minh: Option<f64>,         // -minh
    pub metalmap: Option<String>,  // -m
    pub typemap: Option<String>,   // -z
    pub minimap: Option<String>,   // -minimap
    pub vegmap: Option<String>,    // -v
    pub compression_type: Option<i64>, // -ct (1-4)
    pub ccount: Option<i64>,       // -ccount
    pub th: Option<f64>,           // -th
    #[serde(default)]
    pub noclamp: bool, // -noclamp (lone flag)
    #[serde(default)]
    pub smooth: bool, // -smooth (lone flag)
    pub features: Option<String>, // -features
}

/// A `mapdecompile` request. `mapfile` is a filename, NOT a path: mapdecompile
/// chdir's into `directory` and then opens `mapfile` relative to it.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DecompileOpts {
    pub directory: String, // -directory (holds the .smf/.smt; also the output dir)
    pub mapfile: String,   // -mapfile (basename of the .smf)
}

/// Build the `mapcompile` argument vector. Value flags push two tokens; bool
/// flags push a lone token. atof/atoi parse integer-looking floats fine, so
/// plain `f64::to_string()` (which may drop a trailing `.0`) is acceptable.
pub fn build_compile_args(o: &CompileOpts) -> Vec<String> {
    let mut a = Vec::new();
    a.push("-t".into());
    a.push(o.maintexture.clone());
    a.push("-o".into());
    a.push(o.out_suffix.clone());
    if let Some(v) = &o.heightmap {
        a.push("-h".into());
        a.push(v.clone());
    }
    if let Some(v) = o.maxh {
        a.push("-maxh".into());
        a.push(v.to_string());
    }
    if let Some(v) = o.minh {
        a.push("-minh".into());
        a.push(v.to_string());
    }
    if let Some(v) = &o.metalmap {
        a.push("-m".into());
        a.push(v.clone());
    }
    if let Some(v) = &o.typemap {
        a.push("-z".into());
        a.push(v.clone());
    }
    if let Some(v) = &o.minimap {
        a.push("-minimap".into());
        a.push(v.clone());
    }
    if let Some(v) = &o.vegmap {
        a.push("-v".into());
        a.push(v.clone());
    }
    if let Some(v) = o.compression_type {
        a.push("-ct".into());
        a.push(v.to_string());
    }
    if let Some(v) = o.ccount {
        a.push("-ccount".into());
        a.push(v.to_string());
    }
    if let Some(v) = o.th {
        a.push("-th".into());
        a.push(v.to_string());
    }
    if o.noclamp {
        a.push("-noclamp".into());
    }
    if o.smooth {
        a.push("-smooth".into());
    }
    if let Some(v) = &o.features {
        a.push("-features".into());
        a.push(v.clone());
    }
    a
}

/// Conventional sibling source files we can auto-prefill from the texture's
/// folder. Filenames mirror what `mapdecompile` writes (heightmap.png, etc.).
#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedSources {
    pub heightmap: Option<String>,
    pub metalmap: Option<String>,
    pub typemap: Option<String>,
    pub minimap: Option<String>,
    pub vegmap: Option<String>,
    pub features: Option<String>,
}

const IMAGE_EXTS: &[&str] = &["png", "bmp", "tga", "jpg", "jpeg", "tif", "tiff"];

/// First image file in `files` whose stem matches one of `stems` (case-insensitive).
fn pick_image(files: &[String], stems: &[&str]) -> Option<String> {
    files.iter().find_map(|f| {
        let lower = f.to_lowercase();
        let (stem, ext) = lower.rsplit_once('.')?;
        (IMAGE_EXTS.contains(&ext) && stems.contains(&stem)).then(|| f.clone())
    })
}

/// Given the filenames present in the texture's folder, pick the conventional
/// source file for each optional field. Pure (no IO) so it can be unit-tested;
/// the command joins these to absolute paths.
pub fn match_sources(files: &[String]) -> SuggestedSources {
    SuggestedSources {
        heightmap: pick_image(files, &["heightmap", "height"]),
        metalmap: pick_image(files, &["metalmap", "metal"]),
        typemap: pick_image(files, &["typemap", "type"]),
        minimap: pick_image(files, &["minimap"]),
        vegmap: pick_image(files, &["vegmap", "vegetationmap"]),
        features: files.iter().find(|f| f.to_lowercase() == "features.txt").cloned(),
    }
}

/// Build the `mapdecompile` argument vector.
pub fn build_decompile_args(o: &DecompileOpts) -> Vec<String> {
    vec![
        "-directory".into(),
        o.directory.clone(),
        "-mapfile".into(),
        o.mapfile.clone(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_compile() -> CompileOpts {
        CompileOpts {
            maintexture: "/maps/tex.png".into(),
            out_suffix: "testmap".into(),
            heightmap: None,
            maxh: None,
            minh: None,
            metalmap: None,
            typemap: None,
            minimap: None,
            vegmap: None,
            compression_type: None,
            ccount: None,
            th: None,
            noclamp: false,
            smooth: false,
            features: None,
        }
    }

    /// Required flags lead the vector as two-token pairs.
    #[test]
    fn compile_required_flags_are_two_tokens_each() {
        let a = build_compile_args(&base_compile());
        assert_eq!(a[0], "-t");
        assert_eq!(a[1], "/maps/tex.png");
        assert!(a.windows(2).any(|w| w[0] == "-o" && w[1] == "testmap"));
    }

    /// Optional value flags are omitted entirely when None.
    #[test]
    fn compile_optional_flags_omitted_when_none() {
        let a = build_compile_args(&base_compile());
        for flag in ["-h", "-maxh", "-minh", "-m", "-z", "-minimap", "-v", "-ct", "-ccount", "-th", "-features"] {
            assert!(!a.contains(&flag.to_string()), "{flag} should be absent");
        }
    }

    /// Bool flags are lone tokens (no following value), and absent when false.
    #[test]
    fn compile_bool_flags_are_lone_tokens() {
        let mut o = base_compile();
        o.noclamp = true;
        o.smooth = false;
        let a = build_compile_args(&o);
        assert!(a.contains(&"-noclamp".to_string()));
        assert!(!a.contains(&"-smooth".to_string()));
        // -noclamp must be the last token (nothing pushed after it here).
        let idx = a.iter().position(|s| s == "-noclamp").unwrap();
        assert_eq!(idx, a.len() - 1, "-noclamp must not be followed by a value");
    }

    /// -ct is emitted as an integer pair.
    #[test]
    fn compile_ct_emitted_as_int_pair() {
        let mut o = base_compile();
        o.compression_type = Some(4);
        let a = build_compile_args(&o);
        assert!(a.windows(2).any(|w| w[0] == "-ct" && w[1] == "4"));
    }

    /// Float flags survive round-trip; integer-valued floats render without a dot
    /// (atof accepts that).
    #[test]
    fn compile_height_floats_are_two_tokens() {
        let mut o = base_compile();
        o.maxh = Some(2000.5);
        o.minh = Some(-500.0);
        let a = build_compile_args(&o);
        assert!(a.windows(2).any(|w| w[0] == "-maxh" && w[1] == "2000.5"));
        assert!(a.windows(2).any(|w| w[0] == "-minh" && w[1] == "-500"));
    }

    #[test]
    fn match_sources_picks_conventional_siblings() {
        let files = vec![
            "texture.png".into(),
            "heightmap.png".into(),
            "metalmap.png".into(),
            "typemap.png".into(),
            "minimap.png".into(),
            "features.txt".into(),
            "readme.md".into(),
        ];
        let s = match_sources(&files);
        assert_eq!(s.heightmap.as_deref(), Some("heightmap.png"));
        assert_eq!(s.metalmap.as_deref(), Some("metalmap.png"));
        assert_eq!(s.typemap.as_deref(), Some("typemap.png"));
        assert_eq!(s.minimap.as_deref(), Some("minimap.png"));
        assert_eq!(s.features.as_deref(), Some("features.txt"));
        // No vegmap present, and the texture itself is never matched as a source.
        assert_eq!(s.vegmap, None);
    }

    #[test]
    fn match_sources_empty_when_nothing_matches() {
        let s = match_sources(&["texture.png".into(), "notes.txt".into()]);
        assert_eq!(s, SuggestedSources::default());
    }

    /// Decompile is exactly the two flag pairs, mapfile passed through verbatim
    /// (basename splitting is the caller's responsibility, not this builder's).
    #[test]
    fn decompile_args_directory_and_mapfile() {
        let o = DecompileOpts {
            directory: "/maps/out".into(),
            mapfile: "MyMap.smf".into(),
        };
        let a = build_decompile_args(&o);
        assert_eq!(a, vec!["-directory", "/maps/out", "-mapfile", "MyMap.smf"]);
    }
}
