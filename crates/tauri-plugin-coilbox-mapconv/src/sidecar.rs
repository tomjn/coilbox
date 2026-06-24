//! Locate the bundled SpringMapConvNG sidecars (`mapcompile` / `mapdecompile`)
//! and translate a frontend request into their CLI argument vectors. The
//! `build_*_args` functions are pure so they can be unit-tested without spawning
//! anything; the actual spawn/stream lives in `lib.rs` where it has the Tauri
//! Channel and managed state.
//!
//! These are legacy getopt-style binaries: every flag is a single dash, value
//! flags are TWO argv tokens (`-t` then the value), and boolean flags
//! (`-noclamp`, `-smooth`) are lone tokens with no value. Never use `=`.

use serde::Deserialize;
use std::path::PathBuf;

/// Resolve a bundled sidecar by base name (`"mapcompile"` | `"mapdecompile"`).
/// The env override `MAPCONV_<NAME>_SIDECAR` (e.g. `MAPCONV_MAPCOMPILE_SIDECAR`)
/// wins — handy for `tauri dev` and tests where the binaries are not bundled next
/// to the dev executable. Otherwise look next to the current executable for
/// `<name>` (`.exe` on Windows), as Tauri's `externalBin` bundling arranges.
pub fn resolve_sidecar(name: &str) -> Option<PathBuf> {
    let env_key = format!("MAPCONV_{}_SIDECAR", name.to_uppercase());
    if let Ok(p) = std::env::var(&env_key) {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let candidate = dir.join(format!("{name}{}", std::env::consts::EXE_SUFFIX));
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
