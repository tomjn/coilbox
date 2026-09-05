//! Standalone build-tree HTML export writer (issue #363).
//!
//! The frontend builds the whole artifact — SVG scene, dependency-free JS runtime,
//! CSS and wrapper — as pure strings and picks the destination via the save
//! dialog. This module only writes bytes to disk: a single self-contained `.html`,
//! or a `.zip` (`index.html` + `images/<unit>.png` + `assets/tree.{js,css}`)
//! assembled here with the `zip` crate already used by the map/archive paths. No
//! unitsync, no branding — opaque data in, files out.

use base64::Engine;
use picoframe_core::CliResult;
use serde::Deserialize;
use serde_json::json;
use std::io::Write;
use std::path::Path;

/// One file to pack into the zip. Exactly one of `text`/`base64` is set: text for
/// `index.html`/css/js, base64 for the decoded image bytes.
#[derive(Deserialize)]
pub struct ExportFile {
    pub path: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub base64: Option<String>,
}

/// Reject absolute or parent-escaping zip entry paths ("zip slip" on the write
/// side): the caller controls these, but keeping them relative and contained is
/// cheap insurance.
fn is_safe_rel_path(p: &str) -> bool {
    !p.is_empty()
        && !p.starts_with('/')
        && !p.starts_with('\\')
        && !p.contains("..")
        && !Path::new(p).is_absolute()
}

/// Write a single self-contained HTML export to `dest`.
pub fn write_html(dest: &str, html: &str) -> Result<(), String> {
    std::fs::write(dest, html).map_err(|e| format!("could not write export: {e}"))
}

/// Assemble the zip export at `dest` from the caller's file set. Text entries are
/// written UTF-8; base64 entries are decoded first. Deflated for a small archive.
pub fn write_zip(dest: &str, files: &[ExportFile]) -> Result<(), String> {
    let out = std::fs::File::create(dest).map_err(|e| format!("could not create zip: {e}"))?;
    let mut zip = zip::ZipWriter::new(out);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for f in files {
        if !is_safe_rel_path(&f.path) {
            return Err(format!("unsafe export path: {}", f.path));
        }
        zip.start_file(&f.path, opts)
            .map_err(|e| format!("could not add zip entry {}: {e}", f.path))?;
        if let Some(text) = &f.text {
            zip.write_all(text.as_bytes())
                .map_err(|e| format!("could not write zip entry {}: {e}", f.path))?;
        } else if let Some(b64) = &f.base64 {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64.trim())
                .map_err(|e| format!("invalid base64 for {}: {e}", f.path))?;
            zip.write_all(&bytes)
                .map_err(|e| format!("could not write zip entry {}: {e}", f.path))?;
        }
    }
    zip.finish()
        .map_err(|e| format!("could not finish zip: {e}"))?;
    Ok(())
}

/// `content_export_build_tree_html`, write a single self-contained build-tree
/// export HTML file (built entirely by the frontend) to a caller-chosen path.
/// Opaque: the frontend owns the markup and picks the destination via the save
/// dialog (mirrors `campaign_export`).
#[tauri::command]
pub(crate) async fn content_export_build_tree_html(dest: String, html: String) -> CliResult {
    match write_html(&dest, &html) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e),
    }
}

/// `content_export_build_tree_zip`, assemble the build-tree export zip
/// (`index.html` + `images/` + `assets/`) at a caller-chosen path from the file
/// set the frontend serialized. Image bytes arrive base64-encoded and are decoded
/// here, and text files (html/css/js) are written UTF-8.
#[tauri::command]
pub(crate) async fn content_export_build_tree_zip(
    dest: String,
    files: Vec<ExportFile>,
) -> CliResult {
    match write_zip(&dest, &files) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_paths() {
        assert!(is_safe_rel_path("index.html"));
        assert!(is_safe_rel_path("assets/tree.js"));
        assert!(is_safe_rel_path("images/armcom.png"));
        assert!(!is_safe_rel_path(""));
        assert!(!is_safe_rel_path("/etc/passwd"));
        assert!(!is_safe_rel_path("../escape.html"));
        assert!(!is_safe_rel_path("a/../../b"));
    }

    #[test]
    fn writes_and_reads_back_a_zip() {
        let dir = std::env::temp_dir().join("bte_zip_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("tree.zip");
        // "QQ==" is base64 for the single byte 0x41 ('A').
        let files = vec![
            ExportFile {
                path: "index.html".into(),
                text: Some("<!doctype html><title>x</title>".into()),
                base64: None,
            },
            ExportFile {
                path: "images/armcom.png".into(),
                text: None,
                base64: Some("QQ==".into()),
            },
        ];
        write_zip(dest.to_str().unwrap(), &files).unwrap();

        let f = std::fs::File::open(&dest).unwrap();
        let mut zip = zip::ZipArchive::new(f).unwrap();
        assert_eq!(zip.len(), 2);
        use std::io::Read;
        let mut html = String::new();
        zip.by_name("index.html")
            .unwrap()
            .read_to_string(&mut html)
            .unwrap();
        assert!(html.contains("<!doctype html>"));
        let mut img = Vec::new();
        zip.by_name("images/armcom.png")
            .unwrap()
            .read_to_end(&mut img)
            .unwrap();
        assert_eq!(img, b"A");
    }

    #[test]
    fn zip_rejects_traversal_entry() {
        let dir = std::env::temp_dir().join("bte_bad_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("bad.zip");
        let files = vec![ExportFile {
            path: "../evil.html".into(),
            text: Some("x".into()),
            base64: None,
        }];
        assert!(write_zip(dest.to_str().unwrap(), &files).is_err());
    }

    #[test]
    fn writes_single_html() {
        let dir = std::env::temp_dir().join("bte_html_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("tree.html");
        write_html(dest.to_str().unwrap(), "<!doctype html>hi").unwrap();
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "<!doctype html>hi");
    }
}
