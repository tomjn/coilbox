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
//! Media is copied verbatim, with no re-encode. These files are written into the
//! game's VFS beside the compiled mission, so the engine has to load them as they
//! were authored: an alpha portrait, or an `.ogg` the engine's sound code accepts.
//! The editor previews them out of this same folder over the `coilbox://`
//! protocol's `scenario` root (issue #785), which range-serves, so a voice clip
//! seeks. `scenario_media_read` stays for the export path, where a clip has to be
//! inlined as base64 anyway.
//!
//! Registered as `"coilbox-scenario"`, so the frontend invokes
//! `plugin:coilbox-scenario|<cmd>`.
//!
//! The plugin also installs the mission runtime into a game (see [`runtime`]),
//! which is storage of a different kind: coilbox's own Lua, written into
//! someone else's archive.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use coilbox_portable::{is_safe_rel, mime_for, valid_id};
use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};

mod mutator;
// Public so the harness scripts can install through it rather than copying the
// runtime into a game by hand (issue #934). See
// `examples/install-mission-runtime.rs`.
pub mod runtime;
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
///
/// `keep_media` leaves the clips behind (issue #866). A campaign mission that
/// attached this scenario carries the whole document, but its dialogue still
/// names the clips by file name in this store, so wiping them would leave the
/// mission playing its radio messages with no portrait and no voice. The caller
/// decides, because only the frontend knows which campaigns attached what.
#[tauri::command]
async fn scenario_delete<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    keep_media: Option<bool>,
) -> CliResult {
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
    if !keep_media.unwrap_or(false) {
        if let Ok(dir) = media_dir(&app) {
            let _ = std::fs::remove_dir_all(dir.join(&id));
        }
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

/// Largest dialogue clip coilbox will write out of an imported scenario file.
/// Media is copied verbatim, so unlike campaign art there is no re-encode step to
/// bound it, and an export file arrives from outside the app.
const MAX_MEDIA_BYTES: usize = 16 * 1024 * 1024;

/// Stored media names are minted here as `<uuid>.<ext>`, so an incoming one only
/// ever has to be a plain file name. Stricter than [`is_safe_rel`], which allows
/// sub-directories, because these two commands read and create real files.
fn safe_media_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// Decode the base64 body of a `data:` URI, the only form an export file carries.
/// `None` when the string is not one, or when it holds more than
/// [`MAX_MEDIA_BYTES`]. The encoded length is checked first, so a hostile file
/// cannot make coilbox allocate the decode buffer before it is rejected.
fn data_uri_bytes(uri: &str) -> Option<Vec<u8>> {
    let rest = uri.strip_prefix("data:")?;
    let comma = rest.find(',')?;
    let (meta, payload) = rest.split_at(comma);
    if !meta.contains(";base64") {
        return None;
    }
    let encoded = &payload[1..];
    if encoded.len() / 4 * 3 > MAX_MEDIA_BYTES {
        return None;
    }
    let bytes = STANDARD.decode(encoded).ok()?;
    (bytes.len() <= MAX_MEDIA_BYTES).then_some(bytes)
}

/// `scenario_media_read`, reading a stored dialogue clip back as a `data:` URL.
/// The export path inlines every clip a scenario references, so a shared scenario
/// is one self-contained file. The content type follows the stored extension,
/// which is the extension the author's own file had.
#[tauri::command]
async fn scenario_media_read<R: Runtime>(
    app: AppHandle<R>,
    scenario_id: String,
    file: String,
) -> CliResult {
    if !valid_id(&scenario_id) {
        return CliResult::err(format!("invalid scenario id: {scenario_id}"));
    }
    if !safe_media_name(&file) {
        return CliResult::err(format!("unsafe media file name: {file}"));
    }
    let path = match media_dir(&app) {
        Ok(d) => d.join(&scenario_id).join(&file),
        Err(e) => return CliResult::err(e),
    };
    match std::fs::read(&path) {
        Ok(bytes) => {
            let encoded = STANDARD.encode(&bytes);
            let url = format!("data:{};base64,{}", mime_for(&path), encoded);
            CliResult::ok(json!({ "dataUrl": url }))
        }
        Err(e) => CliResult::err(format!("could not read media: {e}")),
    }
}

/// `scenario_media_write`, materialising a clip carried by an imported scenario
/// file under the name the document already references.
///
/// The name is kept rather than minted anew, because an import writes into a
/// brand new scenario's own media folder, where nothing can collide. Keeping it
/// means the imported document needs no rewriting to stay valid.
#[tauri::command]
async fn scenario_media_write<R: Runtime>(
    app: AppHandle<R>,
    scenario_id: String,
    file: String,
    data_uri: String,
) -> CliResult {
    if !valid_id(&scenario_id) {
        return CliResult::err(format!("invalid scenario id: {scenario_id}"));
    }
    if !safe_media_name(&file) {
        return CliResult::err(format!("unsafe media file name: {file}"));
    }
    let Some(bytes) = data_uri_bytes(&data_uri) else {
        return CliResult::err(format!("invalid or oversized media for {file}"));
    };
    let dir = match media_dir(&app) {
        Ok(d) => d.join(&scenario_id),
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return CliResult::err(format!("could not create media dir: {e}"));
    }
    match std::fs::write(dir.join(&file), bytes) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not write media: {e}")),
    }
}

/// `scenario_export`, writing a caller-serialized scenario export file to a
/// caller-chosen path. Opaque: the frontend builds the container text
/// (`src/scenario/transfer.ts`) and picks the destination with the save dialog,
/// so this only writes bytes. Mirrors `campaign_export`.
#[tauri::command]
async fn scenario_export(text: String, dest: String) -> CliResult {
    match std::fs::write(&dest, text) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not write scenario export: {e}")),
    }
}

/// `scenario_import`, reading a scenario file the user picked and handing its raw
/// text back for the frontend to decode through the container reader.
#[tauri::command]
async fn scenario_import(src: String) -> CliResult {
    match std::fs::read_to_string(&src) {
        Ok(text) => CliResult::ok(json!({ "text": text })),
        Err(e) => CliResult::err(format!("could not read scenario import: {e}")),
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

/// A game folder coilbox may write the runtime into: an absolute path to a
/// directory that exists. A packaged `.sd7`/`.sdz` is a file, so it fails here,
/// which is the read-only case the test mutator answers (issue #754).
fn writable_game_dir(root: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(root);
    if !path.is_absolute() || !path.is_dir() {
        return Err(format!("not a loose game folder: {root}"));
    }
    Ok(path)
}

/// `scenario_runtime_install`, writing the mission runtime's `luarules/`,
/// `luaui/` and `missions/` into the loose game at `root`, or updating an older
/// install in place.
///
/// The marker is read back out of the game afterwards rather than reported from
/// what was written, because the answer that matters is what the engine will
/// load from that folder. A copy that half succeeded, or a game whose own VFS
/// shadows the marker, shows up here.
#[tauri::command]
async fn scenario_runtime_install<R: Runtime>(app: AppHandle<R>, root: String) -> CliResult {
    let dest = match writable_game_dir(&root) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let Some(src) = runtime::runtime_dir(&app) else {
        return CliResult::err("could not find the bundled mission runtime".to_string());
    };
    let files = match runtime::install(&src, &dest) {
        Ok(f) => f,
        Err(e) => return CliResult::err(e),
    };
    match runtime::read_marker(&dest) {
        Ok(installed) => CliResult::ok(json!({ "installed": installed, "files": files })),
        Err(e) => CliResult::err(e),
    }
}

/// `scenario_runtime_status`, the runtime a game has installed and the one
/// coilbox ships, plus the condition and action types the game declares for
/// itself. Each is null when it cannot be read: an unadopted game has no marker,
/// a build with no bundled runtime has nothing to offer, and most games declare
/// no types of their own.
///
/// `installedError` is why the game's own marker would not load, and is set only
/// when the file is there to load. Without it a broken marker is indistinguishable
/// from a game that never adopted the runtime, and the user is told to install a
/// runtime that is already there (issue #806).
///
/// The extensions come from the game and never from coilbox's own runtime
/// folder, because they are the game's to declare. They are read here rather
/// than through a command of their own so the editor learns what the game runs
/// and what it supports in one round trip.
#[tauri::command]
async fn scenario_runtime_status<R: Runtime>(app: AppHandle<R>, root: String) -> CliResult {
    let dir = writable_game_dir(&root).ok();
    let (installed, installed_error) = match dir.as_deref() {
        Some(dir) => match runtime::read_marker(dir) {
            Ok(marker) => (Some(marker), None),
            Err(e) if runtime::marker_present(dir) => (None, Some(e)),
            Err(_) => (None, None),
        },
        None => (None, None),
    };
    let extensions = dir
        .as_deref()
        .and_then(|dir| runtime::read_extensions(dir).ok());
    let available = runtime::runtime_dir(&app).and_then(|dir| runtime::read_marker(&dir).ok());
    CliResult::ok(json!({
        "installed": installed,
        "installedError": installed_error,
        "available": available,
        "extensions": extensions,
    }))
}

/// Write a compiled mission into a game archive folder, with the scenario's
/// dialogue clips beside it, and hand back the folder it landed in and the clips
/// that were copied.
///
/// Shared by the two routes a scenario reaches the engine through: the game's
/// own `missions/` when it has vendored the runtime, and the test mutator's when
/// it has not. Both write the same tree, so the runtime finds the mission in the
/// same place whichever route was taken.
fn write_mission<R: Runtime>(
    app: &AppHandle<R>,
    dir: &Path,
    scenario_id: &str,
    mission: &str,
) -> Result<(PathBuf, Vec<String>), String> {
    let missions = mutator::mission_dir(dir, scenario_id);
    mutator::write_file(&missions.join("mission.lua"), mission)?;
    let media = media_dir(app)?.join(scenario_id);
    let clips = mutator::copy_media(&media, &missions)?;
    Ok((missions, clips))
}

/// `scenario_write_mission`, writing a compiled mission into the loose game at
/// `root`, under `missions/<scenarioId>/`.
///
/// This is the launch-time half of the adoption contract: a game that vendors
/// the runtime plays a scenario out of its own archive, and the start script
/// names it with the `coilbox_mission` modoption. Only that one folder is
/// written, so nothing the game ships is touched and deleting the folder undoes
/// it.
///
/// Unlike the test mutator, the game's other missions are left alone. They are
/// the game's own content, and a game may ship as many as it likes.
#[tauri::command]
async fn scenario_write_mission<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    scenario_id: String,
    mission: String,
) -> CliResult {
    if !valid_id(&scenario_id) {
        return CliResult::err(format!("invalid scenario id: {scenario_id}"));
    }
    let dir = match writable_game_dir(&root) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    match write_mission(&app, &dir, &scenario_id, &mission) {
        Ok((missions, media)) => CliResult::ok(json!({
            "dir": missions.to_string_lossy(),
            "media": media,
        })),
        Err(e) => CliResult::err(e),
    }
}

/// `scenario_list_missions`, the compiled mission folders in a loose game.
///
/// Every launch into a game that vendors the runtime writes one and leaves it
/// there, so a player who has tested five scenarios has five folders and no way
/// to see them (issue #814). Folders only, so the runtime's own `runtime.lua`
/// and the game's `extensions.lua` are never listed. A packaged `.sd7`/`.sdz`
/// fails here, as it does for every write, because coilbox never put anything
/// in one.
#[tauri::command]
async fn scenario_list_missions(root: String) -> CliResult {
    match writable_game_dir(&root) {
        Ok(dir) => CliResult::ok(json!({ "missions": mutator::list_missions(&dir) })),
        Err(e) => CliResult::err(e),
    }
}

/// `scenario_delete_mission`, removing one `missions/<scenarioId>/` from a loose
/// game, dialogue clips and all.
///
/// The undo for [`scenario_write_mission`], and only for that: the runtime the
/// game vendors stays, so the game can still play the missions it kept, and only
/// a folder is ever removed. Both guards are the write path's own, an id of
/// `[A-Za-z0-9-]+` and a game folder coilbox may write into, so nothing this
/// command can reach is something the other could not have written.
#[tauri::command]
async fn scenario_delete_mission(root: String, scenario_id: String) -> CliResult {
    if !valid_id(&scenario_id) {
        return CliResult::err(format!("invalid scenario id: {scenario_id}"));
    }
    let dir = match writable_game_dir(&root) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    match mutator::remove_mission(&dir, &scenario_id) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e),
    }
}

/// `scenario_test_mutator`, generating the game a scenario is tested in.
///
/// A game that has not vendored the runtime, and a packaged one that cannot be
/// written into at all, still has to be testable. So coilbox writes a game of
/// its own under `<data_dir>/games/coilbox-mission-test.sdd`: the `modinfo.lua`
/// the frontend generated, which names the base game as its one dependency, the
/// mission runtime, and the one compiled mission with its dialogue clips beside
/// it. Everything else comes from the base game.
///
/// A test route, never a distribution one. Nothing outside that one folder is
/// touched, so deleting it undoes the lot, and re-running rewrites the same
/// files: the previous scenario's mission is dropped, because the mutator
/// carries exactly the one under test.
///
/// The marker is read back out of the generated game rather than reported from
/// what was written, for the reason [`scenario_runtime_install`] does it.
#[tauri::command]
async fn scenario_test_mutator<R: Runtime>(
    app: AppHandle<R>,
    data_dir: String,
    scenario_id: String,
    modinfo: String,
    mission: String,
) -> CliResult {
    if !valid_id(&scenario_id) {
        return CliResult::err(format!("invalid scenario id: {scenario_id}"));
    }
    let dir = match mutator::mutator_dir(&data_dir) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let Some(src) = runtime::runtime_dir(&app) else {
        return CliResult::err("could not find the bundled mission runtime".to_string());
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return CliResult::err(format!("could not create {}: {e}", dir.display()));
    }
    if let Err(e) = mutator::write_file(&dir.join("modinfo.lua"), &modinfo) {
        return CliResult::err(e);
    }
    let files = match runtime::install(&src, &dir) {
        Ok(f) => f,
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = mutator::prune_missions(&dir, &scenario_id) {
        return CliResult::err(e);
    }
    let clips = match write_mission(&app, &dir, &scenario_id, &mission) {
        Ok((_, clips)) => clips,
        Err(e) => return CliResult::err(e),
    };
    match runtime::read_marker(&dir) {
        Ok(installed) => CliResult::ok(json!({
            "dir": dir.to_string_lossy(),
            "folder": mutator::FOLDER,
            "installed": installed,
            "files": files,
            "media": clips,
        })),
        Err(e) => CliResult::err(e),
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

/// `scenario_media_sweep`, dropping every `media/<id>/` folder whose id is not in
/// `keep` (issue #919).
///
/// A scenario's own clips go when the scenario does, but a bundled campaign's are
/// written here on the launch path and nothing named them afterwards. A
/// distribution that stops shipping that campaign leaves the folder behind for
/// good.
///
/// Which ids are still named is the frontend's to decide, because only it reads
/// the campaign documents. This end does no more than remove what it is told to,
/// and only folders whose name is a scenario id, so nothing else under `media/`
/// can be caught by a caller that got its list wrong.
#[tauri::command]
async fn scenario_media_sweep<R: Runtime>(app: AppHandle<R>, keep: Vec<String>) -> CliResult {
    let dir = match media_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    CliResult::ok(json!({ "removed": sweep_media(&dir, &keep) }))
}

/// Remove every folder under `dir` whose name is a scenario id not in `keep`,
/// and say which ones went. A missing `dir` sweeps nothing, because a machine
/// with no dialogue clips has no folder.
fn sweep_media(dir: &Path, keep: &[String]) -> Vec<String> {
    let keep: std::collections::HashSet<&str> = keep.iter().map(String::as_str).collect();
    let mut removed: Vec<String> = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return removed;
    };
    for entry in entries.flatten() {
        let Some(id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !valid_id(&id) || keep.contains(id.as_str()) || !entry.path().is_dir() {
            continue;
        }
        if std::fs::remove_dir_all(entry.path()).is_ok() {
            removed.push(id);
        }
    }
    removed.sort();
    removed
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
            scenario_media_sweep,
            scenario_media_read,
            scenario_media_write,
            scenario_export,
            scenario_import,
            scenario_read_mission,
            scenario_runtime_install,
            scenario_runtime_status,
            scenario_list_missions,
            scenario_delete_mission,
            scenario_test_mutator,
            scenario_write_mission
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
    fn safe_media_name_allows_only_plain_file_names() {
        assert!(safe_media_name("a1b2.png"));
        assert!(safe_media_name("voice-01_take2.ogg"));
        assert!(!safe_media_name(""));
        assert!(!safe_media_name(".hidden"));
        assert!(!safe_media_name("../escape.png"));
        assert!(!safe_media_name("sub/dir.png"));
        assert!(!safe_media_name("has space.png"));
    }

    #[test]
    fn data_uri_bytes_decodes_and_bounds() {
        assert_eq!(
            data_uri_bytes("data:image/png;base64,aGk=").unwrap(),
            b"hi".to_vec()
        );
        assert!(data_uri_bytes("data:image/png,hi").is_none());
        assert!(data_uri_bytes("aGk=").is_none());
        assert!(data_uri_bytes("data:image/png;base64,!!!!").is_none());
        let huge = "A".repeat(MAX_MEDIA_BYTES * 2);
        assert!(data_uri_bytes(&format!("data:audio/ogg;base64,{huge}")).is_none());
    }

    #[test]
    fn sweep_media_drops_only_the_folders_nothing_names() {
        let tmp = tempfile::tempdir().unwrap();
        for id in ["kept", "gone", "also-gone"] {
            std::fs::create_dir(tmp.path().join(id)).unwrap();
            std::fs::write(tmp.path().join(id).join("a.png"), b"x").unwrap();
        }
        // Not a scenario id, and not a folder. Neither is this command's to touch.
        std::fs::create_dir(tmp.path().join("..hidden")).unwrap();
        std::fs::write(tmp.path().join("notes.txt"), b"x").unwrap();

        let removed = sweep_media(tmp.path(), &["kept".to_string()]);

        assert_eq!(removed, vec!["also-gone".to_string(), "gone".to_string()]);
        assert!(tmp.path().join("kept").join("a.png").exists());
        assert!(!tmp.path().join("gone").exists());
        assert!(tmp.path().join("..hidden").exists());
        assert!(tmp.path().join("notes.txt").exists());
    }

    #[test]
    fn sweep_media_with_a_missing_folder_removes_nothing() {
        assert!(sweep_media(Path::new("/no/such/media/dir"), &[]).is_empty());
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
