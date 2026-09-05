//! The blueprint library's store: one JSON document per saved layout.
//!
//! A base blueprint is a layout of buildings a player keeps and places wherever
//! they like, so it lives on its own rather than inside the mission it happened
//! to be drawn in. That makes it a document library, the same shape as scenarios
//! and lego units, and this is its half of it: files under the app data dir,
//! named by the id the frontend minted.
//!
//! Nothing here reads what is in a document. The frontend owns the shape (see
//! `src/blueprint/library.ts`), so a field added there costs nothing here, and a
//! document this build cannot read is skipped rather than sinking the list.

use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

/// One stored layout: the id it is filed under, and the document itself.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBlueprint {
    pub id: String,
    /// The document, exactly as the frontend serialised it.
    pub json: String,
}

/// Whether an id is safe to become a file name. A UUID is hex and hyphens, which
/// is what the frontend mints, so this never has to turn a name into a path.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn document_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.json"))
}

/// Every stored layout, in whatever order the directory hands them over. The
/// frontend sorts, because only it can read the timestamps in the document.
pub fn list(dir: &Path) -> Vec<StoredBlueprint> {
    let mut out: Vec<StoredBlueprint> = match std::fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|entry| {
                let path = entry.path();
                let id = path.file_stem()?.to_string_lossy().to_string();
                if !valid_id(&id) {
                    return None;
                }
                Some(StoredBlueprint {
                    id,
                    json: std::fs::read_to_string(&path).ok()?,
                })
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    // Stable enough to test against, and it costs nothing on a list this size.
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// Write one layout, replacing whatever was filed under that id.
pub fn save(dir: &Path, id: &str, json: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("invalid blueprint id: {id}"));
    }
    // Not read beyond this, but a document that will not parse can only ever be
    // skipped on the way back out, and failing the save says so while the
    // layout is still on screen to be saved again.
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|e| format!("blueprint is not valid JSON: {e}"))?;
    std::fs::create_dir_all(dir).map_err(|e| format!("create blueprints dir: {e}"))?;
    std::fs::write(document_path(dir, id), json).map_err(|e| format!("write blueprint: {e}"))
}

/// Delete one layout. Deleting one that is not there is not an error: the list
/// it was deleted from may simply be behind what is on disk.
pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("invalid blueprint id: {id}"));
    }
    let path = document_path(dir, id);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("delete blueprint: {e}"))?;
    }
    Ok(())
}

/// Directory holding the blueprint library, under the app data dir.
fn blueprints_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?.join("blueprints"))
}

/// `content_blueprints`, every layout in the blueprint library. The documents
/// are opaque here: the frontend owns their shape.
#[tauri::command]
pub(crate) async fn content_blueprints<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let dir = match blueprints_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    match tauri::async_runtime::spawn_blocking(move || list(&dir)).await {
        Ok(items) => CliResult::ok(json!({ "items": items })),
        Err(e) => CliResult::err(format!("list blueprints task failed: {e}")),
    }
}

/// `content_blueprint_save`, write one layout under its id, replacing what was
/// there. Ids are `[A-Za-z0-9-_]+`, which is what a UUID is.
#[tauri::command]
pub(crate) async fn content_blueprint_save<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    json: String,
) -> CliResult {
    let dir = match blueprints_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let res = tauri::async_runtime::spawn_blocking(move || save(&dir, &id, &json)).await;
    match res {
        Ok(Ok(())) => CliResult::ok(json!({ "ok": true })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("save blueprint task failed: {e}")),
    }
}

/// `content_blueprint_delete`, drop one layout from the library.
#[tauri::command]
pub(crate) async fn content_blueprint_delete<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> CliResult {
    let dir = match blueprints_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let res = tauri::async_runtime::spawn_blocking(move || delete(&dir, &id)).await;
    match res {
        Ok(Ok(())) => CliResult::ok(json!({ "ok": true })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("delete blueprint task failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cbx-blueprints-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn save_list_delete() {
        let dir = tmp("roundtrip").join("blueprints");
        assert!(list(&dir).is_empty());

        save(&dir, "aaa-1", r#"{"name":"Opening"}"#).unwrap();
        save(&dir, "bbb-2", r#"{"name":"Wall"}"#).unwrap();
        let listed = list(&dir);
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "aaa-1");
        assert_eq!(listed[0].json, r#"{"name":"Opening"}"#);

        // Saving the same id replaces rather than duplicating.
        save(&dir, "aaa-1", r#"{"name":"Opening 2"}"#).unwrap();
        assert_eq!(list(&dir).len(), 2);

        delete(&dir, "aaa-1").unwrap();
        let listed = list(&dir);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "bbb-2");

        // Deleting what is already gone is not an error.
        delete(&dir, "aaa-1").unwrap();
    }

    #[test]
    fn an_id_never_becomes_a_path() {
        let dir = tmp("path");
        assert!(save(&dir, "../escape", "{}").is_err());
        assert!(delete(&dir, "../escape").is_err());
        assert!(!valid_id(""));
        assert!(valid_id("0b8a1f2c-0000-4000-8000-000000000000"));
    }

    #[test]
    fn a_document_that_will_not_parse_is_refused() {
        let dir = tmp("parse");
        assert!(save(&dir, "aaa", "not json").is_err());
        assert!(list(&dir).is_empty());
    }

    #[test]
    fn a_file_that_cannot_be_read_does_not_hide_the_rest() {
        let dir = tmp("junk").join("blueprints");
        save(&dir, "good", r#"{"name":"Opening"}"#).unwrap();
        std::fs::write(dir.join("notes.txt"), "ignored").unwrap();
        let listed = list(&dir);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "good");
    }
}
