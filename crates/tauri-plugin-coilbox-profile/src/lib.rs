//! Distribution-profile loader for Coilbox (Rust half).
//!
//! A bundler shipping Coilbox alongside a game can drop a `profile.json` into the
//! portable `.coilbox/` folder to reskin/narrow the app at runtime — window title,
//! hidden nav items, a preset game filter, a branded welcome screen, and theme
//! colour overrides. This crate only *reads* that file and hands the raw JSON to
//! the frontend, which owns the schema (so future fields stay a pure-TS change).
//! Registered as `"coilbox-profile"`; the frontend invokes
//! `plugin:coilbox-profile|profile_load`.
//!
//! Never hard-fails: a missing file — or a non-portable install with no `.coilbox`
//! folder at all — resolves to an empty `{"version":1}` default, leaving vanilla
//! behaviour untouched.

use std::path::{Path, PathBuf};

use picoframe_core::CliResult;
use serde_json::json;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// The empty profile used when no `profile.json` is present. Mirrors the schema's
/// only required field so the frontend can parse it unconditionally.
const DEFAULT_PROFILE: &str = r#"{"version":1}"#;

/// Pure core of [`resolve_profile`]: read `<root>/profile.json` via the supplied
/// reader, falling back to the default. `root` is `None` for a non-portable install.
/// Split out so the fallback logic is unit-testable without touching the real
/// filesystem or the memoized `portable_root()` global.
fn resolve_profile_from(
    root: Option<PathBuf>,
    read: impl Fn(&Path) -> std::io::Result<String>,
) -> (String, &'static str) {
    if let Some(root) = root {
        if let Ok(text) = read(&root.join("profile.json")) {
            return (text, "file");
        }
    }
    (DEFAULT_PROFILE.to_string(), "default")
}

/// Resolve the distribution profile: `<portable_root>/profile.json` when present,
/// else the empty default. Returns the raw JSON text and its source.
fn resolve_profile() -> (String, &'static str) {
    resolve_profile_from(coilbox_portable::portable_root(), |p| {
        std::fs::read_to_string(p)
    })
}

/// `profile_load` — return the distribution profile JSON text, where it came from
/// (`"file"` | `"default"`), and the portable root (`<app_dir>/.coilbox`, or `""`
/// when not portable). The frontend parses/validates the JSON; `root` lets it write
/// an updated `profile.json` back into the portable folder (game-updates feature).
#[tauri::command]
async fn profile_load() -> CliResult {
    let (json_text, source) = resolve_profile();
    let root = coilbox_portable::portable_root()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    CliResult::ok(json!({ "json": json_text, "source": source, "root": root }))
}

/// Build the plugin. Registered as `"coilbox-profile"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-profile")
        .invoke_handler(tauri::generate_handler![profile_load])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_profile_when_present() {
        let (json, source) = resolve_profile_from(Some(PathBuf::from("/pkg/.coilbox")), |p| {
            assert_eq!(p, Path::new("/pkg/.coilbox/profile.json"));
            Ok(r#"{"version":1,"title":"X"}"#.to_string())
        });
        assert_eq!(source, "file");
        assert_eq!(json, r#"{"version":1,"title":"X"}"#);
    }

    #[test]
    fn falls_back_to_default_when_file_missing() {
        let (json, source) = resolve_profile_from(Some(PathBuf::from("/pkg/.coilbox")), |_| {
            Err(std::io::Error::from(std::io::ErrorKind::NotFound))
        });
        assert_eq!(source, "default");
        assert_eq!(json, DEFAULT_PROFILE);
    }

    #[test]
    fn falls_back_to_default_when_not_portable() {
        let (json, source) = resolve_profile_from(None, |_| {
            panic!("reader must not run without a portable root")
        });
        assert_eq!(source, "default");
        assert_eq!(json, DEFAULT_PROFILE);
    }
}
