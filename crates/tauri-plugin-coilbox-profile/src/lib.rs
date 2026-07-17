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

use base64::{engine::general_purpose::STANDARD, Engine as _};
use coilbox_portable::{is_safe_rel, mime_for};
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

/// Pure core of [`profile_asset`]: resolve `<root>/<rel>`, read it via the supplied
/// reader, and return a `data:<mime>;base64,...` URI. Returns an empty string when
/// there's no portable root, the path is unsafe, or the read fails — the frontend
/// treats empty as "no splash", so this never hard-fails.
fn read_asset_from(
    root: Option<PathBuf>,
    rel: &str,
    read: impl Fn(&Path) -> std::io::Result<Vec<u8>>,
) -> String {
    let Some(root) = root else {
        return String::new();
    };
    let rel_path = Path::new(rel);
    if !is_safe_rel(rel_path) {
        return String::new();
    }
    let full = root.join(rel_path);
    match read(&full) {
        Ok(bytes) => format!("data:{};base64,{}", mime_for(&full), STANDARD.encode(bytes)),
        Err(_) => String::new(),
    }
}

/// `profile_asset` — read a file from the portable `.coilbox/` folder and return it
/// as a `data:` URI, so the webview can show a splash image that ships offline beside
/// `profile.json`. Path-traversal guarded; empty string on any miss (see
/// [`read_asset_from`]).
#[tauri::command]
async fn profile_asset(path: String) -> CliResult {
    let data_uri = read_asset_from(coilbox_portable::portable_root(), &path, |p| {
        std::fs::read(p)
    });
    CliResult::ok(json!({ "dataUri": data_uri }))
}

/// Pure core of [`profile_file`]: resolve `<root>/<rel>`, read it as raw UTF-8 text via
/// the supplied reader, and return `(text, ok)`. Unlike [`read_asset_from`] (which
/// base64-encodes into a data URI for `<img>`), this returns the text verbatim so it can
/// be spliced into markdown/HTML/CSS (the `@`-reference feature, issue #274). `ok` is
/// `false` — with empty text — when there's no portable root, the path is unsafe, or the
/// read fails, so a bad reference fails loud in the frontend rather than silently.
fn read_file_from(
    root: Option<PathBuf>,
    rel: &str,
    read: impl Fn(&Path) -> std::io::Result<String>,
) -> (String, bool) {
    let Some(root) = root else {
        return (String::new(), false);
    };
    let rel_path = Path::new(rel);
    if !is_safe_rel(rel_path) {
        return (String::new(), false);
    }
    match read(&root.join(rel_path)) {
        Ok(text) => (text, true),
        Err(_) => (String::new(), false),
    }
}

/// `profile_file` — read a text file from the portable `.coilbox/` folder and return its
/// contents so the frontend can splice referenced HTML/CSS/markdown into a profile
/// (`@.coilbox/...` references). Path-traversal guarded; `{ ok: false }` on any miss (see
/// [`read_file_from`]).
#[tauri::command]
async fn profile_file(path: String) -> CliResult {
    let (text, ok) = read_file_from(coilbox_portable::portable_root(), &path, |p| {
        std::fs::read_to_string(p)
    });
    CliResult::ok(json!({ "text": text, "ok": ok }))
}

/// Pure core of [`profile_pages`]: enumerate `<root>/pages/*.md`, returning each
/// file's `.coilbox`-relative path (`pages/<name>.md`) and text, sorted by path so nav
/// order is stable. `list` yields the directory's entry paths; `read` reads one file.
/// Empty when there's no portable root, the folder is absent/unreadable, or every read
/// fails — the frontend treats an empty list as "no custom pages", so this never
/// hard-fails. Non-`.md` entries are skipped.
fn read_pages_from(
    root: Option<PathBuf>,
    list: impl Fn(&Path) -> std::io::Result<Vec<PathBuf>>,
    read: impl Fn(&Path) -> std::io::Result<String>,
) -> Vec<(String, String)> {
    let Some(root) = root else {
        return Vec::new();
    };
    let Ok(mut entries) = list(&root.join("pages")) else {
        return Vec::new();
    };
    entries.sort();
    let mut out = Vec::new();
    for entry in entries {
        if entry.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(name) = entry.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if let Ok(text) = read(&entry) {
            out.push((format!("pages/{name}"), text));
        }
    }
    out
}

/// List a directory's immediate entries as full paths; the real reader for
/// [`read_pages_from`]. A missing directory surfaces as an `Err`, which the core maps
/// to an empty list.
fn list_dir(dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    Ok(std::fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect())
}

/// `profile_pages` — read the markdown files under the portable `.coilbox/pages/`
/// folder so a distribution can add custom screens without a rebuild. Returns
/// `{ pages: [{ path, content }] }`; the frontend parses each file's frontmatter and
/// builds the routes/nav. Empty when not portable or the folder is absent.
#[tauri::command]
async fn profile_pages() -> CliResult {
    let pages: Vec<_> = read_pages_from(coilbox_portable::portable_root(), list_dir, |p| {
        std::fs::read_to_string(p)
    })
    .into_iter()
    .map(|(path, content)| json!({ "path": path, "content": content }))
    .collect();
    CliResult::ok(json!({ "pages": pages }))
}

/// Build the plugin. Registered as `"coilbox-profile"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-profile")
        .invoke_handler(tauri::generate_handler![
            profile_load,
            profile_asset,
            profile_file,
            profile_pages
        ])
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

    #[test]
    fn asset_serves_present_file_as_data_uri() {
        let uri = read_asset_from(Some(PathBuf::from("/pkg/.coilbox")), "logo.png", |p| {
            assert_eq!(p, Path::new("/pkg/.coilbox/logo.png"));
            Ok(vec![0x89, 0x50]) // arbitrary bytes
        });
        assert_eq!(
            uri,
            format!("data:image/png;base64,{}", STANDARD.encode([0x89, 0x50]))
        );
    }

    #[test]
    fn asset_rejects_parent_traversal() {
        let uri = read_asset_from(Some(PathBuf::from("/pkg/.coilbox")), "../secret", |_| {
            panic!("reader must not run for an unsafe path")
        });
        assert_eq!(uri, "");
    }

    #[test]
    fn asset_rejects_absolute_path() {
        let uri = read_asset_from(Some(PathBuf::from("/pkg/.coilbox")), "/etc/passwd", |_| {
            panic!("reader must not run for an absolute path")
        });
        assert_eq!(uri, "");
    }

    #[test]
    fn asset_empty_when_not_portable() {
        let uri = read_asset_from(None, "logo.png", |_| {
            panic!("reader must not run without a portable root")
        });
        assert_eq!(uri, "");
    }

    #[test]
    fn asset_empty_when_read_fails() {
        let uri = read_asset_from(Some(PathBuf::from("/pkg/.coilbox")), "missing.png", |_| {
            Err(std::io::Error::from(std::io::ErrorKind::NotFound))
        });
        assert_eq!(uri, "");
    }

    #[test]
    fn file_reads_present_file_as_text() {
        let (text, ok) =
            read_file_from(Some(PathBuf::from("/pkg/.coilbox")), "welcome.html", |p| {
                assert_eq!(p, Path::new("/pkg/.coilbox/welcome.html"));
                Ok("<p>hi</p>".to_string())
            });
        assert!(ok);
        assert_eq!(text, "<p>hi</p>");
    }

    #[test]
    fn file_rejects_parent_traversal() {
        let (text, ok) = read_file_from(Some(PathBuf::from("/pkg/.coilbox")), "../secret", |_| {
            panic!("reader must not run for an unsafe path")
        });
        assert!(!ok);
        assert_eq!(text, "");
    }

    #[test]
    fn file_rejects_absolute_path() {
        let (text, ok) =
            read_file_from(Some(PathBuf::from("/pkg/.coilbox")), "/etc/passwd", |_| {
                panic!("reader must not run for an absolute path")
            });
        assert!(!ok);
        assert_eq!(text, "");
    }

    #[test]
    fn file_not_ok_when_not_portable() {
        let (text, ok) = read_file_from(None, "welcome.html", |_| {
            panic!("reader must not run without a portable root")
        });
        assert!(!ok);
        assert_eq!(text, "");
    }

    #[test]
    fn file_not_ok_when_read_fails() {
        let (text, ok) =
            read_file_from(Some(PathBuf::from("/pkg/.coilbox")), "missing.html", |_| {
                Err(std::io::Error::from(std::io::ErrorKind::NotFound))
            });
        assert!(!ok);
        assert_eq!(text, "");
    }

    #[test]
    fn pages_lists_markdown_sorted_with_rel_paths() {
        let out = read_pages_from(
            Some(PathBuf::from("/pkg/.coilbox")),
            |dir| {
                assert_eq!(dir, Path::new("/pkg/.coilbox/pages"));
                Ok(vec![
                    PathBuf::from("/pkg/.coilbox/pages/rules.md"),
                    PathBuf::from("/pkg/.coilbox/pages/about.md"),
                    PathBuf::from("/pkg/.coilbox/pages/logo.png"), // non-md, skipped
                ])
            },
            |p| Ok(format!("body of {}", p.display())),
        );
        assert_eq!(
            out,
            vec![
                (
                    "pages/about.md".to_string(),
                    "body of /pkg/.coilbox/pages/about.md".to_string()
                ),
                (
                    "pages/rules.md".to_string(),
                    "body of /pkg/.coilbox/pages/rules.md".to_string()
                ),
            ]
        );
    }

    #[test]
    fn pages_empty_when_folder_missing() {
        let out = read_pages_from(
            Some(PathBuf::from("/pkg/.coilbox")),
            |_| Err(std::io::Error::from(std::io::ErrorKind::NotFound)),
            |_| panic!("reader must not run when the folder is absent"),
        );
        assert!(out.is_empty());
    }

    #[test]
    fn pages_empty_when_not_portable() {
        let out = read_pages_from(
            None,
            |_| panic!("lister must not run without a portable root"),
            |_| panic!("reader must not run without a portable root"),
        );
        assert!(out.is_empty());
    }

    #[test]
    fn pages_skips_files_that_fail_to_read() {
        let out = read_pages_from(
            Some(PathBuf::from("/pkg/.coilbox")),
            |_| {
                Ok(vec![
                    PathBuf::from("/pkg/.coilbox/pages/ok.md"),
                    PathBuf::from("/pkg/.coilbox/pages/bad.md"),
                ])
            },
            |p| {
                if p.ends_with("bad.md") {
                    Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
                } else {
                    Ok("ok".to_string())
                }
            },
        );
        assert_eq!(out, vec![("pages/ok.md".to_string(), "ok".to_string())]);
    }
}
