//! Galactic-conquest storage plugin (Rust half). A galaxy is an authored or
//! generated strategic map played through skirmishes; this crate persists
//! galaxy documents and per-run conquest state under app-data and stays
//! schema-agnostic — both are opaque JSON strings the frontend owns and
//! validates (see `src/conquest/model.ts`).
//!
//! On-disk layout under `<data_dir>/conquest/`:
//!   - `galaxies/<id>.json`  one document per local (created/imported) galaxy
//!   - `state.json`          opaque per-run conquest state, keyed by galaxy id
//!   - `maps/<id>/`          one folder per imported hand-made map (see `maps`)
//!   - `map-staging/`        a zip being imported, until the frontend has read it
//!
//! A distribution profile can additionally ship *read-only* galaxies as export
//! files in the portable `.coilbox/galaxies/` folder; [`conquest_list`] merges
//! those in as `"bundled"` so they show up without being copied into writable
//! storage (run state is tracked separately, so they still record progress).
//!
//! Registered as `"coilbox-conquest"`; the frontend invokes
//! `plugin:coilbox-conquest|<cmd>`.

mod maps;

use coilbox_portable::valid_id;
use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

/// Empty state document returned when `state.json` doesn't exist yet. Mirrors
/// the frontend `ConquestStateFile` schema so it parses unconditionally.
const DEFAULT_STATE: &str = r#"{"schemaVersion":1,"conquests":{}}"#;

/// A galaxy document plus where it was read from. The frontend
/// parses/validates the JSON; `source` lets the UI mark bundled galaxies as
/// read-only.
#[derive(Serialize)]
struct GalaxyItem {
    json: String,
    source: &'static str, // "local" | "bundled"
}

/// Base storage directory: `<data_dir>/conquest`.
fn conquest_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?.join("conquest"))
}

fn galaxies_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(conquest_dir(app)?.join("galaxies"))
}

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(conquest_dir(app)?.join("state.json"))
}

/// Read every `*.json` file in `dir` (non-recursive) and append it to `items`
/// with the given source. A missing directory or an unreadable file is
/// skipped, not an error — a fresh install simply has no local galaxies, and a
/// non-portable install has no bundled ones.
fn read_json_dir(dir: &Path, source: &'static str, items: &mut Vec<GalaxyItem>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(json) = std::fs::read_to_string(&path) {
            items.push(GalaxyItem { json, source });
        }
    }
}

/// `conquest_list` — every stored galaxy: local documents under app-data
/// first, then any read-only galaxies bundled in the portable
/// `.coilbox/galaxies/` folder. Non-portable installs simply contribute no
/// bundled entries.
#[tauri::command]
async fn conquest_list<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let mut items = Vec::new();
    if let Ok(dir) = galaxies_dir(&app) {
        read_json_dir(&dir, "local", &mut items);
    }
    if let Some(root) = coilbox_portable::portable_root() {
        read_json_dir(&root.join("galaxies"), "bundled", &mut items);
    }
    CliResult::ok(json!({ "items": items }))
}

/// `conquest_save` — write a galaxy document (serialized by the frontend) to
/// `galaxies/<id>.json`. Treated as an opaque string; only the id is
/// validated.
#[tauri::command]
async fn conquest_save<R: Runtime>(app: AppHandle<R>, id: String, json: String) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid galaxy id: {id}"));
    }
    let dir = match galaxies_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return CliResult::err(format!("could not create conquest dir: {e}"));
    }
    match std::fs::write(dir.join(format!("{id}.json")), json) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not write galaxy: {e}")),
    }
}

/// `conquest_delete` — remove a galaxy document. Missing file is fine (a
/// bundled galaxy has no local document).
#[tauri::command]
async fn conquest_delete<R: Runtime>(app: AppHandle<R>, id: String) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid galaxy id: {id}"));
    }
    let doc = match galaxies_dir(&app) {
        Ok(d) => d.join(format!("{id}.json")),
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::remove_file(&doc) {
        if e.kind() != std::io::ErrorKind::NotFound {
            return CliResult::err(format!("could not delete galaxy: {e}"));
        }
    }
    CliResult::ok(json!({}))
}

/// `conquest_state_load` — the opaque `state.json`, or an empty default when
/// it doesn't exist yet.
#[tauri::command]
async fn conquest_state_load<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let json = state_path(&app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_else(|| DEFAULT_STATE.to_string());
    CliResult::ok(json!({ "json": json }))
}

/// `conquest_state_save` — persist the opaque conquest-state document.
#[tauri::command]
async fn conquest_state_save<R: Runtime>(app: AppHandle<R>, json: String) -> CliResult {
    let path = match state_path(&app) {
        Ok(p) => p,
        Err(e) => return CliResult::err(e),
    };
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return CliResult::err(format!("could not create conquest dir: {e}"));
        }
    }
    match std::fs::write(&path, json) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not write conquest state: {e}")),
    }
}

/// Imported hand-made maps: `<data_dir>/conquest/maps/<id>/`. The
/// `coilbox://conquestmap/` asset root serves images out of it.
fn maps_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(conquest_dir(app)?.join("maps"))
}

/// Where a zip is unpacked until the frontend has read it. The
/// `coilbox://conquestmapstaging/` asset root serves images out of it.
fn map_staging_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(conquest_dir(app)?.join("map-staging"))
}

/// Bundled map folders sit beside the bundled galaxy files.
fn bundled_maps_dir() -> Option<PathBuf> {
    coilbox_portable::portable_root().map(|root| root.join("galaxies"))
}

/// `conquest_map_list` — every hand-made map folder: imported ones under
/// app-data first, then the read-only ones bundled in `.coilbox/galaxies/`.
#[tauri::command]
async fn conquest_map_list<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let mut items = Vec::new();
    if let Ok(dir) = maps_dir(&app) {
        maps::list_maps(&dir, "imported", &mut items);
    }
    if let Some(dir) = bundled_maps_dir() {
        maps::list_maps(&dir, "bundled", &mut items);
    }
    CliResult::ok(json!({ "items": items }))
}

/// `conquest_map_stage` — unpack the zip at `path` into staging and return its
/// manifest and file list. Nothing is installed until `conquest_map_commit`.
#[tauri::command]
async fn conquest_map_stage<R: Runtime>(app: AppHandle<R>, path: String) -> CliResult {
    let staging = match map_staging_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    match maps::stage(Path::new(&path), &staging, maps::Limits::DEFAULT) {
        Ok(staged) => CliResult::ok(json!(staged)),
        Err(e) => CliResult::err(e),
    }
}

/// `conquest_map_commit` — install a staged map. `status` is `"exists"` when a
/// map with that id is installed and `replace` was not set, and the staged
/// copy is kept so the caller can ask and commit again.
#[tauri::command]
async fn conquest_map_commit<R: Runtime>(
    app: AppHandle<R>,
    token: String,
    replace: bool,
) -> CliResult {
    let (staging, installed) = match (map_staging_dir(&app), maps_dir(&app)) {
        (Ok(s), Ok(m)) => (s, m),
        (Err(e), _) | (_, Err(e)) => return CliResult::err(e),
    };
    let bundled = bundled_maps_dir();
    match maps::commit(&staging, &installed, bundled.as_deref(), &token, replace) {
        Ok((outcome, id)) => {
            let status = match outcome {
                maps::Commit::Imported => "imported",
                maps::Commit::Exists => "exists",
            };
            CliResult::ok(json!({ "status": status, "id": id }))
        }
        Err(e) => CliResult::err(e),
    }
}

/// `conquest_map_discard` — throw away a staged map.
#[tauri::command]
async fn conquest_map_discard<R: Runtime>(app: AppHandle<R>, token: String) -> CliResult {
    match map_staging_dir(&app).and_then(|dir| maps::discard(&dir, &token)) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e),
    }
}

/// `conquest_map_remove` — remove an imported map. A bundled one is refused.
#[tauri::command]
async fn conquest_map_remove<R: Runtime>(app: AppHandle<R>, id: String) -> CliResult {
    let bundled = bundled_maps_dir();
    match maps_dir(&app).and_then(|dir| maps::remove(&dir, bundled.as_deref(), &id)) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e),
    }
}

/// Build the plugin. Registered as `"coilbox-conquest"` (crate name minus the
/// `tauri-plugin-` prefix); the frontend invokes `plugin:coilbox-conquest|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-conquest")
        .invoke_handler(tauri::generate_handler![
            conquest_list,
            conquest_save,
            conquest_delete,
            conquest_state_load,
            conquest_state_save,
            conquest_map_list,
            conquest_map_stage,
            conquest_map_commit,
            conquest_map_discard,
            conquest_map_remove
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_is_valid_json() {
        let parsed: serde_json::Value = serde_json::from_str(DEFAULT_STATE).unwrap();
        assert_eq!(parsed["schemaVersion"], 1);
        assert!(parsed["conquests"].is_object());
    }

    #[test]
    fn read_json_dir_reads_only_json_and_tags_source() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.json"), r#"{"id":"a"}"#).unwrap();
        std::fs::write(tmp.path().join("notes.txt"), "ignore me").unwrap();

        let mut items = Vec::new();
        read_json_dir(tmp.path(), "bundled", &mut items);

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].source, "bundled");
        assert_eq!(items[0].json, r#"{"id":"a"}"#);
    }

    #[test]
    fn read_json_dir_missing_dir_is_empty() {
        let mut items = Vec::new();
        read_json_dir(Path::new("/no/such/conquest/dir"), "local", &mut items);
        assert!(items.is_empty());
    }
}
