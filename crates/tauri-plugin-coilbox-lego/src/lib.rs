//! Unit builder storage plugin (Rust half).
//!
//! Stays schema-agnostic: a project is an opaque JSON string the frontend owns
//! and validates, exactly as campaigns work. This crate's job is storage.
//!
//! On-disk layout under `<data_dir>/lego/`:
//!   - `projects/<id>.json` one document per unit
//!   - `compounds/<id>.json` reusable sub-assemblies, saved out of a unit
//!   - `thumbs/<id>.png` overview thumbnails, served by the `lego` root of the
//!     `coilbox://` scheme
//!   - `out/<id>/` where an export lands unless told otherwise
//!
//! Registered as `"coilbox-lego"`, so the frontend invokes
//! `plugin:coilbox-lego|<cmd>`.

use coilbox_portable::valid_id;
use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

/// Generous for a bounded thumbnail and small enough that a mistake cannot fill
/// the disk. The frontend renders these at a fixed small size.
const MAX_THUMB_BYTES: usize = 2 * 1024 * 1024;

const PNG_MAGIC: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/// A stored document. The frontend parses and validates the JSON.
#[derive(Serialize)]
struct Item {
    id: String,
    json: String,
}

/// Projects and compounds are stored identically and differ only in which
/// folder they live in, so one pair of commands serves both.
fn folder_for(kind: &str) -> Option<&'static str> {
    match kind {
        "project" => Some("projects"),
        "compound" => Some("compounds"),
        _ => None,
    }
}

fn lego_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?.join("lego"))
}

fn kind_dir<R: Runtime>(app: &AppHandle<R>, kind: &str) -> Result<PathBuf, String> {
    let folder = folder_for(kind).ok_or_else(|| format!("unknown kind: {kind}"))?;
    Ok(lego_dir(app)?.join(folder))
}

/// Read every `*.json` in `dir`, keyed by file stem. A missing directory is not
/// an error: a fresh install simply has nothing saved yet.
fn read_json_dir(dir: &Path) -> Vec<Item> {
    let mut items = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return items;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if let Ok(json) = std::fs::read_to_string(&path) {
            items.push(Item {
                id: id.to_string(),
                json,
            });
        }
    }
    items
}

/// `lego_list` gives back every saved unit and compound in one call, because
/// the overview shows both and a second round trip buys nothing.
#[tauri::command]
async fn lego_list<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let projects = match kind_dir(&app, "project") {
        Ok(dir) => read_json_dir(&dir),
        Err(e) => return CliResult::err(e),
    };
    let compounds = match kind_dir(&app, "compound") {
        Ok(dir) => read_json_dir(&dir),
        Err(e) => return CliResult::err(e),
    };
    CliResult::ok(json!({ "projects": projects, "compounds": compounds }))
}

/// `lego_save` writes a document the frontend serialized. The id is checked
/// because it becomes a file name.
#[tauri::command]
async fn lego_save<R: Runtime>(
    app: AppHandle<R>,
    kind: String,
    id: String,
    json: String,
) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid id: {id}"));
    }
    let dir = match kind_dir(&app, &kind) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return CliResult::err(format!("could not create the {kind} folder: {e}"));
    }
    match std::fs::write(dir.join(format!("{id}.json")), json) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not save the {kind}: {e}")),
    }
}

/// `lego_delete` removes a document, and for a project its thumbnail and export
/// folder too. Those two are best effort: a project that was never exported or
/// never saved a thumbnail has neither.
#[tauri::command]
async fn lego_delete<R: Runtime>(app: AppHandle<R>, kind: String, id: String) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid id: {id}"));
    }
    let dir = match kind_dir(&app, &kind) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::remove_file(dir.join(format!("{id}.json"))) {
        if e.kind() != std::io::ErrorKind::NotFound {
            return CliResult::err(format!("could not delete the {kind}: {e}"));
        }
    }
    if kind == "project" {
        if let Ok(base) = lego_dir(&app) {
            let _ = std::fs::remove_file(base.join("thumbs").join(format!("{id}.png")));
            let _ = std::fs::remove_dir_all(base.join("out").join(&id));
        }
    }
    CliResult::ok(json!({}))
}

/// `lego_thumb_save` stores an overview thumbnail.
///
/// The frontend renders it at a fixed small size and sends the encoded bytes,
/// so there is nothing to decode or resize here. The checks are only to stop a
/// mistake writing something that is not an image, or something enormous.
#[tauri::command]
async fn lego_thumb_save<R: Runtime>(app: AppHandle<R>, id: String, png: Vec<u8>) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid id: {id}"));
    }
    if png.len() > MAX_THUMB_BYTES {
        return CliResult::err(format!(
            "thumbnail is {} bytes, over the {MAX_THUMB_BYTES} limit",
            png.len()
        ));
    }
    if !png.starts_with(PNG_MAGIC) {
        return CliResult::err("thumbnail is not a PNG".to_string());
    }

    let dir = match lego_dir(&app) {
        Ok(d) => d.join("thumbs"),
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return CliResult::err(format!("could not create the thumbnail folder: {e}"));
    }
    match std::fs::write(dir.join(format!("{id}.png")), png) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not save the thumbnail: {e}")),
    }
}

/// `lego_open_path` reveals an exported unit in the file manager.
#[tauri::command]
async fn lego_open_path(path: String) -> CliResult {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return CliResult::err(format!("path does not exist: {path}"));
    }
    #[cfg(target_os = "macos")]
    let spawned = Command::new("open").arg(&target).spawn();
    #[cfg(target_os = "windows")]
    let spawned = Command::new("explorer").arg(&target).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = Command::new("xdg-open").arg(&target).spawn();

    match spawned {
        Ok(_) => CliResult::ok(json!({ "opened": true })),
        Err(e) => CliResult::err(format!("could not open path: {e}")),
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-lego")
        .invoke_handler(tauri::generate_handler![
            lego_list,
            lego_save,
            lego_delete,
            lego_thumb_save,
            lego_open_path
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_two_known_kinds_resolve_to_a_folder() {
        assert_eq!(folder_for("project"), Some("projects"));
        assert_eq!(folder_for("compound"), Some("compounds"));
        // Anything else would otherwise become a folder name from the frontend.
        assert_eq!(folder_for(".."), None);
        assert_eq!(folder_for(""), None);
    }

    #[test]
    fn read_json_dir_keys_by_file_stem_and_skips_the_rest() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("one.json"), "{\"a\":1}").expect("write");
        std::fs::write(dir.path().join("notes.txt"), "ignored").expect("write");

        let items = read_json_dir(dir.path());

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "one");
        assert_eq!(items[0].json, "{\"a\":1}");
    }

    #[test]
    fn read_json_dir_treats_a_missing_folder_as_empty() {
        assert!(read_json_dir(Path::new("/definitely/not/here")).is_empty());
    }
}
