//! Scenario storage plugin (Rust half). A scenario is the in-engine half of a
//! mission: skirmish setup, spawns, zones, triggers, objectives, dialogue. Like
//! the campaign plugin this crate stays schema-agnostic, so a scenario document
//! is an opaque JSON string the frontend owns and validates
//! (`src/scenario/model.ts`). The plugin's jobs are storage and holding the
//! dialogue clips a compile step later copies into the game.
//!
//! On-disk layout under `<data_dir>/scenario/`:
//!   - `scenarios/<id>.json`              one document per scenario
//!   - `media/<scenarioId>/<uuid>.<ext>`  dialogue portraits and voice clips
//!
//! Media is copied verbatim, with no re-encode. Unlike campaign art, these files
//! are not shown in a webview. They are written into the game's VFS beside the
//! compiled mission, so the engine has to load them as they were authored: an
//! alpha portrait, or an `.ogg` the engine's sound code accepts.
//!
//! Registered as `"coilbox-scenario"`, so the frontend invokes
//! `plugin:coilbox-scenario|<cmd>`.

use coilbox_portable::{is_safe_rel, valid_id};
use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

/// One stored scenario document. The frontend parses and validates the JSON.
#[derive(Serialize)]
struct ScenarioItem {
    json: String,
}

/// Base storage directory: `<data_dir>/scenario`.
fn scenario_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(coilbox_portable::data_dir(app)?.join("scenario"))
}

fn scenarios_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(scenario_dir(app)?.join("scenarios"))
}

fn media_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(scenario_dir(app)?.join("media"))
}

/// Read every `*.json` file in `dir` (non-recursive) into `items`. A missing
/// directory or an unreadable file is skipped rather than an error, because a
/// fresh install simply has no scenarios yet.
fn read_json_dir(dir: &Path, items: &mut Vec<ScenarioItem>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(json) = std::fs::read_to_string(&path) {
            items.push(ScenarioItem { json });
        }
    }
}

/// Lower-case the alphanumerics of a file extension, falling back to `bin`. Keeps
/// the stored name predictable for the engine, which picks its loader by extension.
fn safe_ext(raw: &str) -> String {
    let ext: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    if ext.is_empty() {
        "bin".to_string()
    } else {
        ext
    }
}

/// `scenario_list`, every stored scenario document.
#[tauri::command]
async fn scenario_list<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let mut items = Vec::new();
    if let Ok(dir) = scenarios_dir(&app) {
        read_json_dir(&dir, &mut items);
    }
    CliResult::ok(json!({ "items": items }))
}

/// `scenario_save`, writing a scenario document (serialized by the frontend) to
/// `scenarios/<id>.json`. Treated as an opaque string, so only the id is validated.
#[tauri::command]
async fn scenario_save<R: Runtime>(app: AppHandle<R>, id: String, json: String) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid scenario id: {id}"));
    }
    let dir = match scenarios_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return CliResult::err(format!("could not create scenario dir: {e}"));
    }
    match std::fs::write(dir.join(format!("{id}.json")), json) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not write scenario: {e}")),
    }
}

/// `scenario_delete`, removing a scenario document and its media folder.
/// Best-effort on the media, because a scenario with no dialogue clips has none.
#[tauri::command]
async fn scenario_delete<R: Runtime>(app: AppHandle<R>, id: String) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid scenario id: {id}"));
    }
    let doc = match scenarios_dir(&app) {
        Ok(d) => d.join(format!("{id}.json")),
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::remove_file(&doc) {
        if e.kind() != std::io::ErrorKind::NotFound {
            return CliResult::err(format!("could not delete scenario: {e}"));
        }
    }
    if let Ok(dir) = media_dir(&app) {
        let _ = std::fs::remove_dir_all(dir.join(&id));
    }
    CliResult::ok(json!({}))
}

/// `scenario_media_import`, copying a dialogue portrait or voice clip the user
/// picked into `media/<scenarioId>/`, verbatim, under a uuid name with the source
/// extension. Returns the bare filename, which is what the document stores.
#[tauri::command]
async fn scenario_media_import<R: Runtime>(
    app: AppHandle<R>,
    scenario_id: String,
    src_path: String,
) -> CliResult {
    if !valid_id(&scenario_id) {
        return CliResult::err(format!("invalid scenario id: {scenario_id}"));
    }
    let ext = safe_ext(
        Path::new(&src_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or(""),
    );
    let dir = match media_dir(&app) {
        Ok(d) => d.join(&scenario_id),
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return CliResult::err(format!("could not create media dir: {e}"));
    }
    let file = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    match std::fs::copy(&src_path, dir.join(&file)) {
        Ok(_) => CliResult::ok(json!({ "file": file })),
        Err(e) => CliResult::err(format!("could not import media: {e}")),
    }
}

/// `scenario_read_mission`, evaluating a compiled `mission.lua` under `root` and
/// handing back the table it built.
///
/// This is the read half of the compile step's validator. Rather than parse the
/// file it just wrote, coilbox loads it the way the mission runtime's gadget
/// will: a sandboxed Spring Lua VM rooted at the game archive, `VFS.Include`,
/// and whatever comes back. A file the engine cannot load fails here, and the
/// frontend resolves the ids in the result (`src/scenario/validate.ts`), where
/// the trigger capability table already lives.
///
/// `root` is a directory coilbox chose (a loose `.sdd` game). `path` is
/// VFS-relative and confined to it, both by `is_safe_rel` here and by the VFS
/// itself.
#[tauri::command]
async fn scenario_read_mission(root: String, path: String) -> CliResult {
    if !is_safe_rel(Path::new(&path)) {
        return CliResult::err(format!("unsafe mission path: {path}"));
    }
    let lua = match coilbox_springlua::SpringLua::new(&root) {
        Ok(l) => l,
        Err(e) => return CliResult::err(format!("could not start the Lua sandbox: {e}")),
    };
    match lua.include_value(&path) {
        Ok(mission) => CliResult::ok(json!({ "mission": mission })),
        Err(e) => CliResult::err(format!("could not read {path}: {e}")),
    }
}

/// `scenario_media_delete`, a best-effort removal of a stored clip. Dropping a
/// portrait from a dialogue line needn't fail if the file is already gone.
#[tauri::command]
async fn scenario_media_delete<R: Runtime>(
    app: AppHandle<R>,
    scenario_id: String,
    file: String,
) -> CliResult {
    if !valid_id(&scenario_id) {
        return CliResult::err(format!("invalid scenario id: {scenario_id}"));
    }
    if !is_safe_rel(Path::new(&file)) {
        return CliResult::err(format!("unsafe media file name: {file}"));
    }
    if let Ok(dir) = media_dir(&app) {
        let _ = std::fs::remove_file(dir.join(&scenario_id).join(&file));
    }
    CliResult::ok(json!({}))
}

/// Build the plugin. Registered as `"coilbox-scenario"` (the crate name minus the
/// `tauri-plugin-` prefix), so the frontend invokes `plugin:coilbox-scenario|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-scenario")
        .invoke_handler(tauri::generate_handler![
            scenario_list,
            scenario_save,
            scenario_delete,
            scenario_media_import,
            scenario_media_delete,
            scenario_read_mission
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_json_dir_reads_only_json() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.json"), r#"{"id":"a"}"#).unwrap();
        std::fs::write(tmp.path().join("b.json"), r#"{"id":"b"}"#).unwrap();
        std::fs::write(tmp.path().join("notes.txt"), "ignore me").unwrap();
        std::fs::create_dir(tmp.path().join("media")).unwrap();

        let mut items = Vec::new();
        read_json_dir(tmp.path(), &mut items);

        let mut jsons: Vec<&str> = items.iter().map(|i| i.json.as_str()).collect();
        jsons.sort();
        assert_eq!(jsons, vec![r#"{"id":"a"}"#, r#"{"id":"b"}"#]);
    }

    #[test]
    fn read_json_dir_missing_dir_is_empty() {
        let mut items = Vec::new();
        read_json_dir(Path::new("/no/such/scenario/dir"), &mut items);
        assert!(items.is_empty());
    }

    #[test]
    fn safe_ext_sanitizes_and_defaults() {
        assert_eq!(safe_ext("PNG"), "png");
        assert_eq!(safe_ext("ogg"), "ogg");
        assert_eq!(safe_ext("../sh"), "sh");
        assert_eq!(safe_ext(""), "bin");
        assert_eq!(safe_ext("!!"), "bin");
    }

    #[test]
    fn id_and_media_name_guards_match_the_campaign_plugin() {
        assert!(valid_id("scen-01"));
        assert!(!valid_id("../etc"));
        assert!(!valid_id("a/b"));
        assert!(is_safe_rel(Path::new("abc.png")));
        assert!(!is_safe_rel(Path::new("../x.png")));
        assert!(!is_safe_rel(Path::new("/abs.png")));
    }
}
