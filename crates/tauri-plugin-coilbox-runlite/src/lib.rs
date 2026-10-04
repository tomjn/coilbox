//! Single-player roguelite-run storage plugin (Rust half). A run is a
//! forward-only node graph crossed once on top of the conquest battle engine;
//! this crate persists the active runs and the persistent meta-progression,
//! staying schema-agnostic — both are opaque JSON strings the frontend owns and
//! validates (see `src/runlite/model.ts`).
//!
//! On-disk layout under `<data_dir>/runlite/`:
//!   - `run.json` the active runs, keyed by id (starting a warpath adds one;
//!     abandoning or clearing removes it). Runs for different games/factions
//!     coexist.
//!   - `meta.json` persistent between-run unlocks (loadouts, event pools,
//!     ascension tiers)
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

/// Empty run-state document returned when `run.json` doesn't exist yet. An empty
/// `runs` map means "no active runs". Mirrors the frontend `RunStateFile` schema
/// so it parses unconditionally.
const DEFAULT_STATE: &str = r#"{"schemaVersion":1,"runs":{}}"#;

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

/// Read the document at `path`, or `default` when there is no such file.
///
/// Only a missing file means "nothing saved yet". Any other failure, such as a
/// permission error or bytes that are not UTF-8, is returned as an error so the
/// caller reports a failed load and writes nothing. Falling back to the default
/// there would replace a player's record with an empty one the next time the
/// app saves.
fn load_doc(path: PathBuf, default: &str, what: &str) -> CliResult {
    match std::fs::read_to_string(path) {
        Ok(json) => CliResult::ok(json!({ "json": json })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            CliResult::ok(json!({ "json": default }))
        }
        Err(e) => CliResult::err(format!("could not read {what}: {e}")),
    }
}

/// `runlite_state_load` — the opaque `run.json`, or an empty default (no active
/// run) when it doesn't exist yet.
#[tauri::command]
async fn runlite_state_load<R: Runtime>(app: AppHandle<R>) -> CliResult {
    match run_path(&app) {
        Ok(path) => load_doc(path, DEFAULT_STATE, "runlite state"),
        Err(e) => CliResult::err(e),
    }
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
    match meta_path(&app) {
        Ok(path) => load_doc(path, DEFAULT_META, "runlite meta"),
        Err(e) => CliResult::err(e),
    }
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
        assert!(parsed["runs"].is_object());
        assert_eq!(parsed["runs"].as_object().unwrap().len(), 0);
    }

    #[test]
    fn default_meta_is_valid_json() {
        let parsed: serde_json::Value = serde_json::from_str(DEFAULT_META).unwrap();
        assert_eq!(parsed["schemaVersion"], 1);
        assert!(parsed["loadouts"].is_array());
        assert_eq!(parsed["ascensionTier"], 0);
        assert_eq!(parsed["stats"]["runs"], 0);
    }

    fn loaded_json(result: &CliResult) -> &str {
        result.data.as_ref().unwrap()["json"].as_str().unwrap()
    }

    #[test]
    fn a_missing_file_loads_as_the_default() {
        let dir = tempfile::tempdir().unwrap();
        let result = load_doc(dir.path().join("meta.json"), DEFAULT_META, "runlite meta");
        assert!(result.success, "got: {:?}", result.error);
        assert_eq!(loaded_json(&result), DEFAULT_META);
    }

    #[test]
    fn a_file_that_exists_loads_as_written() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("meta.json");
        std::fs::write(&path, r#"{"schemaVersion":1}"#).unwrap();
        let result = load_doc(path, DEFAULT_META, "runlite meta");
        assert!(result.success, "got: {:?}", result.error);
        assert_eq!(loaded_json(&result), r#"{"schemaVersion":1}"#);
    }

    #[test]
    fn a_file_that_is_not_utf8_is_an_error_not_the_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("meta.json");
        std::fs::write(&path, [0xff, 0xfe, 0x00, 0x80]).unwrap();
        let result = load_doc(path.clone(), DEFAULT_META, "runlite meta");
        assert!(!result.success, "an unreadable record is not an empty one");
        assert!(result.data.is_none());
        assert!(
            result
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("runlite meta"),
            "got: {:?}",
            result.error
        );
        assert_eq!(std::fs::read(&path).unwrap(), [0xff, 0xfe, 0x00, 0x80]);
    }

    #[cfg(unix)]
    #[test]
    fn a_file_with_no_read_permission_is_an_error_not_the_default() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("run.json");
        std::fs::write(&path, DEFAULT_STATE).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
        // Root reads anything, so the case cannot be set up there.
        if std::fs::read(&path).is_ok() {
            return;
        }
        let result = load_doc(path, DEFAULT_STATE, "runlite state");
        assert!(!result.success, "an unreadable record is not an empty one");
        assert!(result.data.is_none());
    }
}
