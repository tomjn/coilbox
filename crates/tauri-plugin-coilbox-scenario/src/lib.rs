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
//! A distribution profile can additionally ship *read-only* scenarios as export
//! files in the portable `.coilbox/scenarios/` folder. [`scenario_list`] merges
//! those in as `"bundled"`, the way `campaign_list` does, so a distribution can
//! hand out a playable mission without the player importing anything.
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

mod archive;
mod mutator;
// Public so the harness scripts can install through it rather than copying the
// runtime into a game by hand (issue #934). See
// `examples/install-mission-runtime.rs`.
pub mod runtime;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

/// A scenario document plus where it was read from. The frontend parses and
/// validates the JSON. `source` is what marks a bundled scenario read-only.
#[derive(Serialize)]
struct ScenarioItem {
    json: String,
    source: &'static str, // "local" | "bundled"
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

/// Read every `*.json` file in `dir` (non-recursive) into `items` with the given
/// source. A missing directory or an unreadable file is skipped rather than an
/// error, because a fresh install simply has no scenarios yet and a
/// non-portable one has no bundled ones.
fn read_json_dir(dir: &Path, source: &'static str, items: &mut Vec<ScenarioItem>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(json) = std::fs::read_to_string(&path) {
            items.push(ScenarioItem { json, source });
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

/// `scenario_list`, every scenario document: the local ones under app data
/// first, then any read-only scenarios a distribution bundled in the portable
/// `.coilbox/scenarios/` folder (issue #786). A non-portable install simply
/// contributes no bundled entries. Mirrors `campaign_list`.
#[tauri::command]
async fn scenario_list<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let mut items = Vec::new();
    if let Ok(dir) = scenarios_dir(&app) {
        read_json_dir(&dir, "local", &mut items);
    }
    if let Some(root) = coilbox_portable::portable_root() {
        read_json_dir(&root.join("scenarios"), "bundled", &mut items);
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

/// Evaluate a compiled mission the caller already holds as text. Shared by
/// [`scenario_eval_mission`] and its own tests, since a `#[tauri::command]`
/// function cannot be called directly from a plain `#[test]`.
///
/// `eval_value_raw`, not `eval_value`. A mission's keys are author data (team
/// ids, variable names) and the emitter writes `schemaVersion` and `unitDef` in
/// camelCase, so lowercasing them would give a different table from the one
/// [`scenario_read_mission`] returns for the same file. `include_value` does not
/// lowercase, and this must agree with it or a mission would validate one way
/// out of a folder and another way out of an archive.
///
/// The VM is rooted at a path under the temp dir that coilbox never creates, so
/// every `VFS` read fails. Text is all there is here: a mission that came out of
/// an archive has no folder to chase siblings in, and a compiled mission is a
/// single `return { ... }` that never asks for one.
fn eval_mission_text(source: &str) -> Result<serde_json::Value, String> {
    let root = std::env::temp_dir().join("coilbox-mission-text-has-no-vfs");
    let lua = coilbox_springlua::SpringLua::new(root)
        .map_err(|e| format!("could not start the Lua sandbox: {e}"))?;
    lua.eval_value_raw(source, "mission.lua")
        .map_err(|e| format!("could not read mission.lua: {e}"))
}

/// `scenario_eval_mission`, the same read-back validation as
/// [`scenario_read_mission`] for a mission that is already in hand as text.
///
/// A mission inside a packaged `.sd7`/`.sdz` has no path on disk for
/// `VFS.Include` to open, so the archive reader pulls the bytes out and this
/// evaluates them. Same table back, same frontend validator
/// (`src/scenario/validate.ts`), so the way a mission was read does not change
/// what it is told about.
#[tauri::command]
async fn scenario_eval_mission(source: String) -> CliResult {
    match eval_mission_text(&source) {
        Ok(mission) => CliResult::ok(json!({ "mission": mission })),
        Err(e) => CliResult::err(e),
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

/// `scenario_runtime_consolidate`, putting a game holding two spellings of a
/// vendored tree back together (issue #950).
///
/// A Linux player who installed the runtime before #798 has the game's own
/// `LuaRules/` and a `luarules/` coilbox wrote beside it. The engine lower-cases
/// both into one key, so a file under the spelling coilbox no longer writes to is
/// one the engine may load in place of the one it does, and the install's prune
/// walks a single spelling so it can never clear it.
///
/// `apply` false lists what would go and touches nothing, so a player sees the
/// files first. Only then does anything get removed, because this is the one path
/// where coilbox deletes from a folder the game may have written.
#[tauri::command]
async fn scenario_runtime_consolidate<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    apply: bool,
) -> CliResult {
    let dir = match writable_game_dir(&root) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let Some(src) = runtime::runtime_dir(&app) else {
        return CliResult::err("could not find the bundled mission runtime".to_string());
    };
    match runtime::consolidate(&src, &dir, apply) {
        Ok(files) => CliResult::ok(json!({ "files": files, "applied": apply })),
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
///
/// `duplicates` is the runtime files sitting under a second spelling of a
/// vendored tree, empty for every game that has only one (issue #950). It rides
/// along here so the offer to put them back together is only made to the games
/// that need it.
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
    let src = runtime::runtime_dir(&app);
    let available = src
        .as_deref()
        .and_then(|dir| runtime::read_marker(dir).ok());
    let duplicates: Vec<String> = match (src.as_deref(), dir.as_deref()) {
        (Some(src), Some(dir)) => runtime::duplicates(src, dir)
            .iter()
            .map(|rel| rel.to_string_lossy().replace('\\', "/"))
            .collect(),
        _ => Vec::new(),
    };
    CliResult::ok(json!({
        "installed": installed,
        "installedError": installed_error,
        "available": available,
        "extensions": extensions,
        "duplicates": duplicates,
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

/// Write the document, the compiled mission and the dialogue clips of a mission
/// an author is putting into a game, under `missions/<folder>/`, and hand back
/// the folder and the clips that went in.
///
/// `media` is the scenario's stored clip folder, or `None` for a caller with no
/// clips to bring. They travel because the compiled mission names its portraits
/// and voice clips by bare file name and the runtime resolves those beside
/// `mission.lua`: left in coilbox's store they would keep playing on the
/// author's machine and on nobody else's.
///
/// The fence is the same shape as the test mutator's. A loose `.sdd` only, one
/// folder only, and nothing else in the game is written or removed. A packaged
/// archive is a file rather than a directory, so it fails in
/// [`writable_game_dir`], which is what makes a shipped game's missions
/// read-only. Shared by [`scenario_write_game_mission`] and its own tests, since
/// a `#[tauri::command]` function cannot be called directly from a plain
/// `#[test]`.
fn write_game_mission(
    root: &str,
    folder: &str,
    document: &str,
    mission: &str,
    media: Option<&Path>,
) -> Result<(PathBuf, Vec<String>), String> {
    if !valid_id(folder) {
        return Err(format!("invalid mission folder: {folder}"));
    }
    let dir = writable_game_dir(root)?;
    let missions = mutator::mission_dir(&dir, folder);
    mutator::write_file(&missions.join("mission.lua"), mission)?;
    mutator::write_file(&missions.join("scenario.json"), document)?;
    let clips = match media {
        Some(src) => mutator::copy_media(src, &missions)?,
        None => Vec::new(),
    };
    Ok((missions, clips))
}

/// `scenario_write_game_mission`, writing a mission the author is putting into a
/// game: the compiled `mission.lua` and the `scenario.json` it was compiled from.
///
/// Unlike [`scenario_write_mission`], which writes what a launch needs into a
/// folder coilbox owns and may later remove, this writes the game's own content,
/// under a name the author chose. The document goes in beside the compiled file
/// because that is what makes the mission editable and nameable wherever the game
/// ends up (issue #2160).
///
/// `scenario_id` is the document's id, which is where its dialogue clips are
/// stored, and it is optional: a caller writing a mission it did not compile
/// from a stored document has no clip folder to name and passes nothing.
#[tauri::command]
async fn scenario_write_game_mission<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    folder: String,
    document: String,
    mission: String,
    scenario_id: Option<String>,
) -> CliResult {
    let media = match scenario_id {
        Some(id) => {
            if !valid_id(&id) {
                return CliResult::err(format!("invalid scenario id: {id}"));
            }
            match media_dir(&app) {
                Ok(dir) => Some(dir.join(id)),
                Err(e) => return CliResult::err(e),
            }
        }
        None => None,
    };
    match write_game_mission(&root, &folder, &document, &mission, media.as_deref()) {
        Ok((dir, _)) => CliResult::ok(json!({ "dir": dir.to_string_lossy() })),
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

/// `scenario_game_missions`, the missions a game ships inside its own archive.
///
/// Unlike [`scenario_list_missions`], which lists what coilbox wrote into a loose
/// game while testing, this reads the game's own content and works on a packaged
/// `.sd7`/`.sdz` too. That is the point: a game can distribute finished missions.
///
/// `stamp` is [`archive::stamp`]: a real change signal for a packaged archive, or
/// `null` for a loose one, so the frontend can cache a packaged archive's
/// contents for the session without ever caching a loose folder's, which an
/// author may be editing right now.
#[tauri::command]
async fn scenario_game_missions(root: String) -> CliResult {
    let path = Path::new(&root);
    match archive::list_missions(path) {
        Ok(missions) => {
            CliResult::ok(json!({ "missions": missions, "stamp": archive::stamp(path) }))
        }
        Err(e) => CliResult::err(e),
    }
}

/// `scenario_game_mission_file`, one file out of one of a game's own missions.
///
/// Base64 because a portrait and a voice clip are binary and this crosses the
/// IPC boundary as JSON. Nothing is written to disk: the caller holds what it
/// needs for the session, which is what keeps a game's media in its archive.
#[tauri::command]
async fn scenario_game_mission_file(root: String, folder: String, file: String) -> CliResult {
    match archive::read_file(Path::new(&root), &folder, &file) {
        Ok(bytes) => CliResult::ok(json!({ "base64": STANDARD.encode(bytes) })),
        Err(e) => CliResult::err(e),
    }
}

/// Read and evaluate `missions/runtime.lua` out of the game at `root`, however
/// it is packaged. Uses `eval_value_raw`, not `eval_value`. The marker's keys
/// are author data, the same "don't lowercase" contract `runtime::read_marker`
/// gets from `include_value` for a loose game, so a packaged and a loose game
/// have to agree on whether `schemaVersion` survives as itself. Shared by
/// [`scenario_game_runtime`] and its own tests, since a `#[tauri::command]`
/// function cannot be called directly from a plain `#[test]`.
fn read_game_runtime(root: &str) -> Result<serde_json::Value, String> {
    let bytes = archive::read_root_file(Path::new(root), "runtime.lua")?;
    let src = std::str::from_utf8(&bytes)
        .map_err(|e| format!("{}: not valid UTF-8: {e}", runtime::MARKER))?;
    let lua = coilbox_springlua::SpringLua::new(root)
        .map_err(|e| format!("could not start the Lua sandbox: {e}"))?;
    lua.eval_value_raw(src, runtime::MARKER)
        .map_err(|e| format!("could not read {}: {e}", runtime::MARKER))
}

/// `scenario_game_runtime`, the runtime version marker a game declares for
/// itself in its own `missions/runtime.lua`.
///
/// Unlike [`scenario_runtime_status`], which reads a loose game's installed
/// marker through `VFS.Include` against a working directory on disk, this reads
/// the file out through [`archive`] first, so it works on a packaged
/// `.sd7`/`.sdz` too. The archive read handles the packaging. The evaluation
/// after that is `eval_value_raw`, not `VFS.Include`, a different path through
/// the sandbox that is kept to the same "keys are author data, never
/// lowercased" rule so the two routes agree on casing. Same shape as
/// `installed` there, because it comes from the same file.
#[tauri::command]
async fn scenario_game_runtime(root: String) -> CliResult {
    match read_game_runtime(&root) {
        Ok(installed) => CliResult::ok(json!({ "installed": installed })),
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

/// What a media sweep found, and whether it acted on it. Counts and names are the
/// same either way, so a dry run is an exact preview of the apply.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct SweepSummary {
    /// Whether these were actually deleted (`false` for a dry run).
    applied: bool,
    /// Scenario ids whose whole `media/<id>/` folder nothing names.
    folders: Vec<String>,
    /// `<id>/<file>` clips inside a folder that is still named, where the clip
    /// itself is not.
    files: Vec<String>,
    /// Total size of everything above.
    bytes: u64,
}

/// `scenario_media_sweep`, dropping the dialogue clips nothing names any more
/// (issues #919 and #916).
///
/// A scenario's own clips go when the scenario does, but two paths deliberately
/// leave clips behind. A bundled campaign's are written here on the launch path,
/// and nothing named them afterwards. A scenario a campaign mission attached
/// keeps its whole folder when it is deleted, and a clip a campaign mission still
/// names survives being replaced in the editor. Both are right at the moment they
/// happen, because the mission plays the file by name, and both leave bytes
/// nothing can reach once that mission is detached or deleted.
///
/// `keep` maps a scenario id to the clip names still referenced under it. A
/// folder whose id is absent goes whole, and a folder whose id is present keeps
/// only the names listed. Which those are is the frontend's to decide, because
/// only it reads the scenario and campaign documents. This end does no more than
/// remove what it is told to, and only folders whose name is a scenario id
/// holding files coilbox could itself have written, so nothing else under
/// `media/` can be caught by a caller that got its list wrong.
///
/// `apply` false counts without deleting, so a caller can show what would go
/// before it goes. Mirrors `content_prune_rapid_pool`.
#[tauri::command]
async fn scenario_media_sweep<R: Runtime>(
    app: AppHandle<R>,
    keep: std::collections::HashMap<String, Vec<String>>,
    apply: bool,
) -> CliResult {
    let dir = match media_dir(&app) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    CliResult::ok(json!({ "summary": sweep_media(&dir, &keep, apply) }))
}

/// Size of one file, or 0 when it cannot be read. A file whose length is unknown
/// is still worth removing, it just does not count towards the total.
fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Total size of a folder's own files, one level deep, which is all a media
/// folder ever holds.
fn folder_len(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries.flatten().map(|e| file_len(&e.path())).sum()
}

/// Remove the clips under `dir` that `keep` does not name, and say what went.
/// A missing `dir` sweeps nothing, because a machine with no dialogue clips has
/// no folder.
fn sweep_media(
    dir: &Path,
    keep: &std::collections::HashMap<String, Vec<String>>,
    apply: bool,
) -> SweepSummary {
    let mut out = SweepSummary {
        applied: apply,
        ..Default::default()
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let Some(id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let path = entry.path();
        if !valid_id(&id) || !path.is_dir() {
            continue;
        }
        match keep.get(&id) {
            None => {
                out.bytes += folder_len(&path);
                if !apply || std::fs::remove_dir_all(&path).is_ok() {
                    out.folders.push(id);
                }
            }
            Some(named) => sweep_folder(&path, &id, named, apply, &mut out),
        }
    }
    out.folders.sort();
    out.files.sort();
    out
}

/// Remove the files in one still-named folder that `named` does not list. Only
/// plain files under a name coilbox itself mints are touched, so anything else a
/// user put there is left alone.
fn sweep_folder(dir: &Path, id: &str, named: &[String], apply: bool, out: &mut SweepSummary) {
    let named: std::collections::HashSet<&str> = named.iter().map(String::as_str).collect();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Some(file) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let path = entry.path();
        if named.contains(file.as_str()) || !safe_media_name(&file) || !path.is_file() {
            continue;
        }
        out.bytes += file_len(&path);
        if !apply || std::fs::remove_file(&path).is_ok() {
            out.files.push(format!("{id}/{file}"));
        }
    }
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
            scenario_eval_mission,
            scenario_runtime_install,
            scenario_runtime_consolidate,
            scenario_runtime_status,
            scenario_list_missions,
            scenario_delete_mission,
            scenario_test_mutator,
            scenario_write_mission,
            scenario_write_game_mission,
            scenario_game_missions,
            scenario_game_mission_file,
            scenario_game_runtime
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_json_dir_reads_only_json_and_tags_source() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.json"), r#"{"id":"a"}"#).unwrap();
        std::fs::write(tmp.path().join("b.json"), r#"{"id":"b"}"#).unwrap();
        std::fs::write(tmp.path().join("notes.txt"), "ignore me").unwrap();
        std::fs::create_dir(tmp.path().join("media")).unwrap();

        let mut items = Vec::new();
        read_json_dir(tmp.path(), "local", &mut items);

        assert!(items.iter().all(|i| i.source == "local"));
        let mut jsons: Vec<&str> = items.iter().map(|i| i.json.as_str()).collect();
        jsons.sort();
        assert_eq!(jsons, vec![r#"{"id":"a"}"#, r#"{"id":"b"}"#]);
    }

    /// What `scenario_list` does: app data first, then the portable folder, with
    /// each entry saying which it came from (issue #786).
    #[test]
    fn read_json_dir_merges_local_then_bundled() {
        let local = tempfile::tempdir().unwrap();
        let bundled = tempfile::tempdir().unwrap();
        std::fs::write(local.path().join("mine.json"), r#"{"n":1}"#).unwrap();
        std::fs::write(bundled.path().join("shipped.json"), r#"{"n":2}"#).unwrap();

        let mut items = Vec::new();
        read_json_dir(local.path(), "local", &mut items);
        read_json_dir(bundled.path(), "bundled", &mut items);

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].source, "local");
        assert_eq!(items[1].source, "bundled");
    }

    #[test]
    fn read_json_dir_missing_dir_is_empty() {
        let mut items = Vec::new();
        read_json_dir(Path::new("/no/such/scenario/dir"), "local", &mut items);
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

    /// `keep` as the frontend sends it: a scenario id mapped to the clip names
    /// something still references under it.
    fn keep(pairs: &[(&str, &[&str])]) -> std::collections::HashMap<String, Vec<String>> {
        pairs
            .iter()
            .map(|(id, files)| {
                (
                    (*id).to_string(),
                    files.iter().map(|f| (*f).to_string()).collect(),
                )
            })
            .collect()
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

        let out = sweep_media(tmp.path(), &keep(&[("kept", &["a.png"])]), true);

        assert_eq!(
            out.folders,
            vec!["also-gone".to_string(), "gone".to_string()]
        );
        assert!(out.files.is_empty());
        assert_eq!(out.bytes, 2);
        assert!(tmp.path().join("kept").join("a.png").exists());
        assert!(!tmp.path().join("gone").exists());
        assert!(tmp.path().join("..hidden").exists());
        assert!(tmp.path().join("notes.txt").exists());
    }

    /// Issue #916. The case that matters is the other way round from the folder
    /// sweep: a clip something still names has to survive one that nothing does,
    /// in the same folder.
    #[test]
    fn sweep_media_keeps_the_named_clips_inside_a_named_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("scen");
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("named.png"), b"kept").unwrap();
        std::fs::write(dir.join("also-named.ogg"), b"kept too").unwrap();
        std::fs::write(dir.join("orphan.png"), b"twelve bytes").unwrap();
        // Not a name coilbox mints, so not this command's to remove either.
        std::fs::write(dir.join(".DS_Store"), b"x").unwrap();
        std::fs::create_dir(dir.join("sub")).unwrap();

        let out = sweep_media(
            tmp.path(),
            &keep(&[("scen", &["named.png", "also-named.ogg"])]),
            true,
        );

        assert!(out.folders.is_empty());
        assert_eq!(out.files, vec!["scen/orphan.png".to_string()]);
        assert_eq!(out.bytes, 12);
        assert!(dir.join("named.png").exists());
        assert!(dir.join("also-named.ogg").exists());
        assert!(!dir.join("orphan.png").exists());
        assert!(dir.join(".DS_Store").exists());
        assert!(dir.join("sub").exists());
    }

    /// A folder named with an empty list is still named, so it stays. Only what
    /// is inside it goes. This is a scenario whose dialogue lost its last clip.
    #[test]
    fn sweep_media_empties_a_named_folder_without_removing_it() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("scen");
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("orphan.png"), b"x").unwrap();

        let out = sweep_media(tmp.path(), &keep(&[("scen", &[])]), true);

        assert_eq!(out.files, vec!["scen/orphan.png".to_string()]);
        assert!(dir.exists());
        assert!(!dir.join("orphan.png").exists());
    }

    #[test]
    fn sweep_media_dry_run_counts_the_same_and_deletes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        for id in ["kept", "gone"] {
            std::fs::create_dir(tmp.path().join(id)).unwrap();
            std::fs::write(tmp.path().join(id).join("a.png"), b"xy").unwrap();
        }
        std::fs::write(tmp.path().join("kept").join("orphan.ogg"), b"xyz").unwrap();
        let held = keep(&[("kept", &["a.png"])]);

        let dry = sweep_media(tmp.path(), &held, false);
        assert!(!dry.applied);
        assert!(tmp.path().join("gone").exists());
        assert!(tmp.path().join("kept").join("orphan.ogg").exists());

        let applied = sweep_media(tmp.path(), &held, true);
        assert!(applied.applied);
        assert_eq!(dry.folders, applied.folders);
        assert_eq!(dry.files, applied.files);
        assert_eq!(dry.bytes, applied.bytes);
        assert_eq!(applied.bytes, 5);
    }

    #[test]
    fn sweep_media_with_a_missing_folder_removes_nothing() {
        let out = sweep_media(Path::new("/no/such/media/dir"), &keep(&[]), true);
        assert!(out.folders.is_empty() && out.files.is_empty());
        assert_eq!(out.bytes, 0);
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

    /// A packaged game's own `missions/runtime.lua` has to read the same as a
    /// loose one's marker: `schemaVersion`, not `schemaversion`. `eval_value`
    /// would silently lowercase this key through `__lowerkeys`, which is the
    /// bug `eval_value_raw` exists to avoid, so this asserts the camelCase key
    /// survives out of a `.sdz` rather than merely that some value comes back.
    #[test]
    fn game_runtime_keeps_camelcase_keys_from_a_packaged_archive() {
        use std::io::Write;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("game.sdz");
        let file = std::fs::File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("missions/runtime.lua", opts).unwrap();
        zip.write_all(b"return { version = 4, schemaVersion = 1 }")
            .unwrap();
        zip.finish().unwrap();

        let installed = read_game_runtime(path.to_str().unwrap()).unwrap();

        assert_eq!(installed["schemaVersion"], 1);
        assert!(installed.get("schemaversion").is_none());
    }

    /// A mission read as text has to come back as the same table
    /// `scenario_read_mission` builds through `VFS.Include`, which does not
    /// lowercase. The emitter writes `schemaVersion` and `unitDef` in camelCase
    /// and team ids are whatever the author typed, so `eval_value` here would
    /// make the same mission validate differently depending on which read it
    /// came from.
    #[test]
    fn mission_text_keeps_camelcase_keys_and_author_ids() {
        let mission = eval_mission_text(
            "return { schemaVersion = 1, teams = { [\"Enemy-1\"] = { team = 1 } } }",
        )
        .unwrap();

        assert_eq!(mission["schemaVersion"], 1);
        assert!(mission.get("schemaversion").is_none());
        assert_eq!(mission["teams"]["Enemy-1"]["team"], 1);
    }

    #[test]
    fn mission_text_that_does_not_evaluate_is_an_error() {
        assert!(eval_mission_text("return {").is_err());
    }

    /// Putting a mission into a game writes the two files that make it both
    /// playable and editable, and writes them under the folder the author named.
    #[test]
    fn a_mission_put_into_a_game_ships_its_document_beside_the_compiled_file() {
        let game = tempfile::tempdir().unwrap();
        let root = game.path().to_str().unwrap();

        let (dir, clips) = write_game_mission(
            root,
            "silence-the-jericho",
            "{\"id\":\"s1\"}",
            "return {}",
            None,
        )
        .unwrap();

        assert!(clips.is_empty());
        assert_eq!(dir, game.path().join("missions/silence-the-jericho"));
        assert_eq!(
            std::fs::read_to_string(dir.join("mission.lua")).unwrap(),
            "return {}"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("scenario.json")).unwrap(),
            "{\"id\":\"s1\"}"
        );
    }

    /// The fence: a packaged archive is a file, and a folder name that could
    /// climb out of `missions/` is refused before anything is opened.
    #[test]
    fn a_packaged_game_and_a_climbing_folder_are_both_refused() {
        let dir = tempfile::tempdir().unwrap();
        let packaged = dir.path().join("game.sd7");
        std::fs::write(&packaged, b"not a folder").unwrap();

        assert!(
            write_game_mission(packaged.to_str().unwrap(), "demo", "{}", "return {}", None)
                .is_err()
        );
        assert!(write_game_mission(
            dir.path().to_str().unwrap(),
            "../evil",
            "{}",
            "return {}",
            None
        )
        .is_err());
        assert!(!dir.path().join("evil").exists());
    }

    /// A mission put into a game takes its dialogue portraits and voice clips
    /// with it, because the runtime resolves them beside `mission.lua`. Leave
    /// them in coilbox's store and the author's own machine plays the mission
    /// perfectly while everyone the game ships to gets silence.
    #[test]
    fn a_mission_put_into_a_game_takes_its_dialogue_clips_with_it() {
        let game = tempfile::tempdir().unwrap();
        let media = tempfile::tempdir().unwrap();
        std::fs::write(media.path().join("kesh.png"), b"portrait").unwrap();
        std::fs::write(media.path().join("kesh.ogg"), b"voice").unwrap();

        let (dir, clips) = write_game_mission(
            game.path().to_str().unwrap(),
            "silence-the-jericho",
            "{\"id\":\"s1\"}",
            "return {}",
            Some(media.path()),
        )
        .unwrap();

        assert_eq!(clips, vec!["kesh.ogg", "kesh.png"]);
        assert_eq!(
            std::fs::read_to_string(dir.join("kesh.png")).unwrap(),
            "portrait"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("kesh.ogg")).unwrap(),
            "voice"
        );
    }
}
