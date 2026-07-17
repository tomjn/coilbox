//! Single-player roguelite-run storage plugin (Rust half). A run is a
//! forward-only node graph crossed once on top of the conquest battle engine;
//! this crate persists the *one* active run and the persistent
//! meta-progression, staying schema-agnostic — both are opaque JSON strings the
//! frontend owns and validates (see `src/runlite/model.ts`).
//!
//! On-disk layout under `<data_dir>/runlite/`:
//!   - `run.json`   the single active run (a fresh run replaces it; abandoning
//!                  or completing clears it)
//!   - `meta.json`  persistent between-run unlocks (loadouts, event pools,
//!                  ascension tiers)
//!
//! Unlike conquest there is no authored/bundled document to list: a run is
//! generated fresh from a seed and disposable, so this crate only loads/saves
//! the two opaque blobs.
//!
//! Registered as `"coilbox-runlite"`; the frontend invokes
//! `plugin:coilbox-runlite|<cmd>`.

use picoframe_core::CliResult;
use serde_json::json;
use std::path::PathBuf;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

/// Empty run-state document returned when `run.json` doesn't exist yet. `run:
/// null` means "no active run". Mirrors the frontend `RunStateFile` schema so
/// it parses unconditionally.
const DEFAULT_STATE: &str = r#"{"schemaVersion":1,"run":null}"#;

/// Empty meta document returned when `meta.json` doesn't exist yet. Mirrors the
/// frontend `RogueliteMeta` schema.
const DEFAULT_META: &str = r#"{"schemaVersion":1,"loadouts":[],"eventPools":[],"ascensionTier":0,"stats":{"runs":0,"wins":0,"deepest":0}}"#;

/// Base storage directory: `<data_dir>/runlite`.
fn runlite_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?.join("runlite"))
}

fn run_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(runlite_dir(app)?.join("run.json"))
}

fn meta_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(runlite_dir(app)?.join("meta.json"))
}

/// Write `json` to `path`, creating the parent directory. Shared by both save
/// commands.
fn write_doc(path: PathBuf, json: String, what: &str) -> CliResult {
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return CliResult::err(format!("could not create runlite dir: {e}"));
        }
    }
    match std::fs::write(&path, json) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not write {what}: {e}")),
    }
}

/// `runlite_state_load` — the opaque `run.json`, or an empty default (no active
/// run) when it doesn't exist yet.
#[tauri::command]
async fn runlite_state_load<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let json = run_path(&app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_else(|| DEFAULT_STATE.to_string());
    CliResult::ok(json!({ "json": json }))
}

/// `runlite_state_save` — persist the opaque active-run document.
#[tauri::command]
async fn runlite_state_save<R: Runtime>(app: AppHandle<R>, json: String) -> CliResult {
    match run_path(&app) {
        Ok(path) => write_doc(path, json, "runlite state"),
        Err(e) => CliResult::err(e),
    }
}

/// `runlite_meta_load` — the opaque `meta.json`, or an empty default when it
/// doesn't exist yet.
#[tauri::command]
async fn runlite_meta_load<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let json = meta_path(&app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_else(|| DEFAULT_META.to_string());
    CliResult::ok(json!({ "json": json }))
}

/// `runlite_meta_save` — persist the opaque meta-progression document.
#[tauri::command]
async fn runlite_meta_save<R: Runtime>(app: AppHandle<R>, json: String) -> CliResult {
    match meta_path(&app) {
        Ok(path) => write_doc(path, json, "runlite meta"),
        Err(e) => CliResult::err(e),
    }
}

/// Build the plugin. Registered as `"coilbox-runlite"` (crate name minus the
/// `tauri-plugin-` prefix); the frontend invokes `plugin:coilbox-runlite|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-runlite")
        .invoke_handler(tauri::generate_handler![
            runlite_state_load,
            runlite_state_save,
            runlite_meta_load,
            runlite_meta_save
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
        assert!(parsed["run"].is_null());
    }

    #[test]
    fn default_meta_is_valid_json() {
        let parsed: serde_json::Value = serde_json::from_str(DEFAULT_META).unwrap();
        assert_eq!(parsed["schemaVersion"], 1);
        assert!(parsed["loadouts"].is_array());
        assert_eq!(parsed["ascensionTier"], 0);
        assert_eq!(parsed["stats"]["runs"], 0);
    }
}
