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
//! The one thing here that is not a read is [`profile_open`], which acts on a link
//! to a bundled file. It lives in this crate because the folder those files are in
//! is only known once the app has found itself on disk, so no capability file can
//! name it.
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

/// Pure core of [`profile_scaffold`]: write `<app_dir>/.coilbox/profile.json`, but
/// only when nothing is there yet. Returns the target path and whether it was written.
/// An existing file is left alone (`false`) and never overwritten, because it is the
/// distributor's authored work. Anchored on `app_dir` rather than
/// [`coilbox_portable::portable_root`] on purpose, since the root only resolves once a
/// `profile.json` exists, which is exactly what this creates.
fn scaffold_profile_in(
    app_dir: Option<PathBuf>,
    json: &str,
    exists: impl Fn(&Path) -> bool,
    write: impl Fn(&Path, &str) -> std::io::Result<()>,
) -> Result<(String, bool), String> {
    let app_dir = app_dir.ok_or_else(|| "could not resolve the app directory".to_string())?;
    let target = app_dir.join(".coilbox").join("profile.json");
    let path = target.display().to_string();
    if exists(&target) {
        return Ok((path, false));
    }
    write(&target, json).map_err(|e| format!("could not write {path}: {e}"))?;
    Ok((path, true))
}

/// Create the parent directory then write the file, the real writer for
/// [`scaffold_profile_in`]. `.coilbox` usually does not exist yet on the install this
/// scaffolds into.
fn write_new_file(path: &Path, contents: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, contents)
}

/// `profile_scaffold` writes a starter `profile.json` into `<app_dir>/.coilbox/` so a
/// distributor can start from a real file instead of a blank one. The frontend composes
/// the JSON (it owns the schema), this only places it. Returns `{ path, written }`, with
/// `written: false` when a profile is already there.
#[tauri::command]
async fn profile_scaffold(json: String) -> CliResult {
    match scaffold_profile_in(
        coilbox_portable::app_dir(),
        &json,
        |p| p.exists(),
        write_new_file,
    ) {
        Ok((path, written)) => CliResult::ok(json!({ "path": path, "written": written })),
        Err(e) => CliResult::err(e),
    }
}

/// Whether a bundled file is one Coilbox will hand to the OS to open.
///
/// A markdown link is something a reader clicks, and on Windows the program the OS
/// opens a `.bat` or a `.exe` with is the file itself. A distribution page has no
/// other way to start a program, and a link captioned "our logo" must not become
/// one, so this lists file types a viewer shows rather than types an interpreter
/// runs. Archives are off the list too: opening a `.zip` on macOS unpacks it into
/// the distribution's own folder, which is not what the click asked for.
///
/// Anything absent is shown in the file manager instead, which is where a link to a
/// bundled file already led (#1783). Being wrong about a type therefore costs the
/// reader one extra click, not a dead link.
fn opens_in_a_viewer(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some(
            // Pictures
            "webp" | "png" | "jpg" | "jpeg" | "gif" | "bmp" | "svg" | "avif"
            // Things somebody reads
            | "pdf" | "txt" | "md" | "rtf" | "csv" | "html" | "htm"
            // Audio
            | "ogg" | "oga" | "mp3" | "wav" | "flac" | "opus" | "m4a"
            // Video
            | "mp4" | "webm" | "mov" | "ogv"
        )
    )
}

/// Pure core of [`profile_open`]: resolve `<root>/<rel>` and decide what a click on it
/// does. A type with a viewer goes to the OS. Anything else, and anything the OS
/// refuses, is shown in the file manager. Returns which of the two happened.
///
/// The only paths this ever acts on are `<portable_root>/<rel>`, and that bound is
/// enforced here rather than in `src-tauri/capabilities/`. A capability file names a
/// directory ahead of time, and no path variable describes the folder beside the
/// executable: `$EXE` is the user's own bin directory, `$RESOURCE` is inside the
/// bundle, and on macOS and in an AppImage the folder is not the executable's parent
/// at all. Granting `<root>/**` at runtime instead would hand the webview every file
/// under `.coilbox`, which in portable mode includes Coilbox's own `data` and `cache`
/// folders. This grants one bundled file, by a relative path, and is the same fence
/// [`read_asset_from`] already puts around reading that file.
fn open_asset_in(
    root: Option<PathBuf>,
    rel: &str,
    is_file: impl Fn(&Path) -> bool,
    open: impl Fn(&Path) -> Result<(), String>,
    reveal: impl Fn(&Path) -> Result<(), String>,
) -> Result<&'static str, String> {
    let root = root.ok_or_else(|| "this install has no .coilbox folder".to_string())?;
    let rel_path = Path::new(rel);
    if !is_safe_rel(rel_path) {
        return Err(format!("{rel} is not a path inside the .coilbox folder"));
    }
    let full = root.join(rel_path);
    if !is_file(&full) {
        return Err(format!("there is no file at {rel}"));
    }
    if opens_in_a_viewer(&full) && open(&full).is_ok() {
        return Ok("open");
    }
    reveal(&full).map(|_| "reveal")
}

/// `profile_open` — act on a link to a file bundled in the portable `.coilbox/` folder
/// (issue #1786), given the path relative to that folder. A picture, document, clip or
/// page opens in whatever program the OS opens its file type with. Anything else is
/// shown in the file manager with its folder open and the file selected. Returns
/// `{ action: "open" | "reveal" }`, or an error for a path that escapes the folder, a
/// file that is not there, or an install with no `.coilbox` folder at all.
#[tauri::command]
async fn profile_open(path: String) -> CliResult {
    let acted = open_asset_in(
        coilbox_portable::portable_root(),
        &path,
        |p| p.is_file(),
        |p| tauri_plugin_opener::open_path(p, None::<&str>).map_err(|e| e.to_string()),
        |p| tauri_plugin_opener::reveal_item_in_dir(p).map_err(|e| e.to_string()),
    );
    match acted {
        Ok(action) => CliResult::ok(json!({ "action": action })),
        Err(e) => CliResult::err(e),
    }
}

/// Build the plugin. Registered as `"coilbox-profile"`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-profile")
        .invoke_handler(tauri::generate_handler![
            profile_load,
            profile_asset,
            profile_file,
            profile_pages,
            profile_scaffold,
            profile_open
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
    fn scaffold_writes_profile_next_to_the_app() {
        let written = std::cell::RefCell::new(None);
        let out = scaffold_profile_in(
            Some(PathBuf::from("/pkg")),
            r#"{"version":1}"#,
            |_| false,
            |p, text| {
                *written.borrow_mut() = Some((p.to_path_buf(), text.to_string()));
                Ok(())
            },
        );
        assert_eq!(out, Ok(("/pkg/.coilbox/profile.json".to_string(), true)));
        assert_eq!(
            written.into_inner(),
            Some((
                PathBuf::from("/pkg/.coilbox/profile.json"),
                r#"{"version":1}"#.to_string()
            ))
        );
    }

    #[test]
    fn scaffold_never_overwrites_an_existing_profile() {
        let out = scaffold_profile_in(
            Some(PathBuf::from("/pkg")),
            r#"{"version":1}"#,
            |p| {
                assert_eq!(p, Path::new("/pkg/.coilbox/profile.json"));
                true
            },
            |_, _| panic!("writer must not run when a profile is already there"),
        );
        assert_eq!(out, Ok(("/pkg/.coilbox/profile.json".to_string(), false)));
    }

    #[test]
    fn scaffold_errors_without_an_app_dir() {
        let out = scaffold_profile_in(
            None,
            r#"{"version":1}"#,
            |_| panic!("existence check must not run without an app dir"),
            |_, _| panic!("writer must not run without an app dir"),
        );
        assert!(out.is_err());
    }

    #[test]
    fn scaffold_reports_a_write_failure() {
        let out = scaffold_profile_in(
            Some(PathBuf::from("/pkg")),
            r#"{"version":1}"#,
            |_| false,
            |_, _| Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
        );
        let err = out.expect_err("a failed write must surface");
        assert!(err.contains("/pkg/.coilbox/profile.json"), "{err}");
    }

    /// What [`open_asset_in`] did, so a test can assert both the choice and the path
    /// it acted on. The path is the whole point: it must always be the resolved root
    /// joined with the link's own relative path, and nothing else.
    #[derive(Debug, Default)]
    struct Acted {
        opened: std::cell::RefCell<Option<PathBuf>>,
        revealed: std::cell::RefCell<Option<PathBuf>>,
    }

    /// Run a click on `rel` against a `.coilbox` at `/pkg/.coilbox` where every file
    /// exists and both the OS handler and the file manager succeed.
    fn click(rel: &str) -> (Result<&'static str, String>, Acted) {
        let acted = Acted::default();
        let out = open_asset_in(
            Some(PathBuf::from("/pkg/.coilbox")),
            rel,
            |_| true,
            |p| {
                *acted.opened.borrow_mut() = Some(p.to_path_buf());
                Ok(())
            },
            |p| {
                *acted.revealed.borrow_mut() = Some(p.to_path_buf());
                Ok(())
            },
        );
        (out, acted)
    }

    #[test]
    fn open_hands_a_bundled_file_under_the_root_to_the_os() {
        let (out, acted) = click("images/logo.webp");
        assert_eq!(out, Ok("open"));
        assert_eq!(
            acted.opened.into_inner(),
            Some(PathBuf::from("/pkg/.coilbox/images/logo.webp"))
        );
        assert_eq!(acted.revealed.into_inner(), None);
    }

    #[test]
    fn open_covers_the_pdf_the_issue_asked_for() {
        let (out, acted) = click("docs/guide.pdf");
        assert_eq!(out, Ok("open"));
        assert_eq!(
            acted.opened.into_inner(),
            Some(PathBuf::from("/pkg/.coilbox/docs/guide.pdf"))
        );
    }

    #[test]
    fn open_reveals_a_file_the_os_would_run_rather_than_show() {
        // The reason the list exists: the program Windows opens a `.bat` with is the
        // file, so a link captioned "our guide" would run it.
        for rel in ["setup.bat", "install.exe", "tool.sh", "pack.zip"] {
            let (out, acted) = click(rel);
            assert_eq!(out, Ok("reveal"), "{rel}");
            assert_eq!(acted.opened.into_inner(), None, "{rel}");
            assert_eq!(
                acted.revealed.into_inner(),
                Some(PathBuf::from("/pkg/.coilbox").join(rel)),
                "{rel}"
            );
        }
    }

    #[test]
    fn open_falls_back_to_reveal_when_the_os_has_no_handler() {
        let acted = Acted::default();
        let out = open_asset_in(
            Some(PathBuf::from("/pkg/.coilbox")),
            "images/logo.webp",
            |_| true,
            |_| Err("no application knows how to open this".to_string()),
            |p| {
                *acted.revealed.borrow_mut() = Some(p.to_path_buf());
                Ok(())
            },
        );
        assert_eq!(out, Ok("reveal"));
        assert_eq!(
            acted.revealed.into_inner(),
            Some(PathBuf::from("/pkg/.coilbox/images/logo.webp"))
        );
    }

    #[test]
    fn open_refuses_a_path_outside_the_root() {
        for rel in ["../secret.pdf", "/etc/passwd", "a/../../b.png", ""] {
            let out = open_asset_in(
                Some(PathBuf::from("/pkg/.coilbox")),
                rel,
                |_| panic!("existence check must not run for a path outside the root"),
                |_| panic!("the OS must not be asked to open a path outside the root"),
                |_| panic!("the file manager must not be shown a path outside the root"),
            );
            assert!(out.is_err(), "{rel} was allowed");
        }
    }

    #[test]
    fn open_errors_without_a_portable_root() {
        let out = open_asset_in(
            None,
            "images/logo.webp",
            |_| panic!("existence check must not run without a portable root"),
            |_| panic!("the OS must not be asked to open anything without a root"),
            |_| panic!("the file manager must not be shown anything without a root"),
        );
        assert!(out.is_err());
    }

    #[test]
    fn open_errors_when_the_file_is_not_there() {
        let out = open_asset_in(
            Some(PathBuf::from("/pkg/.coilbox")),
            "images/missing.webp",
            |_| false,
            |_| panic!("the OS must not be asked to open a file that is absent"),
            |_| panic!("the file manager must not be shown a file that is absent"),
        );
        let err = out.expect_err("a missing file must surface");
        assert!(err.contains("images/missing.webp"), "{err}");
    }

    #[test]
    fn open_reports_a_file_manager_failure() {
        let out = open_asset_in(
            Some(PathBuf::from("/pkg/.coilbox")),
            "pack.zip",
            |_| true,
            |_| panic!("an archive must not be handed to the OS"),
            |_| Err("no file manager".to_string()),
        );
        assert_eq!(out, Err("no file manager".to_string()));
    }

    #[test]
    fn viewer_list_ignores_extension_case_and_unknown_types() {
        assert!(opens_in_a_viewer(Path::new("a/LOGO.WEBP")));
        assert!(opens_in_a_viewer(Path::new("a/notes.MD")));
        assert!(!opens_in_a_viewer(Path::new("a/parts.sd7")));
        assert!(!opens_in_a_viewer(Path::new("a/README")));
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
