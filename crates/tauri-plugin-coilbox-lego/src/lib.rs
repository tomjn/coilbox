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
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
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

/// Where the parts pack lives, in order of precedence:
///
/// 1. `.coilbox/legoparts` beside the executable, so a distribution can ship its
///    own parts library without a rebuild.
/// 2. The bundled copy under the resource directory.
/// 3. The source tree, in debug builds only. `bundle.resources` is assembled by
///    `tauri build`, so under `tauri dev` there is nothing beside the binary and
///    the pack would otherwise be missing for the whole of development.
///
/// Public because the app serves the same folder over `coilbox://`, and the
/// pack's location belongs with the rest of the pack's code.
pub fn legopack_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let portable = coilbox_portable::portable_root().map(|root| root.join("legoparts"));
    if let Some(dir) = portable.filter(|dir| dir.is_dir()) {
        return Some(dir);
    }

    let bundled = app.path().resource_dir().ok().map(|d| d.join("legoparts"));
    if let Some(dir) = bundled.clone().filter(|dir| dir.is_dir()) {
        return Some(dir);
    }

    if cfg!(debug_assertions) {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../src-tauri/legoparts")
            .canonicalize()
            .ok();
        if let Some(dir) = source.filter(|dir| dir.is_dir()) {
            return Some(dir);
        }
    }
    bundled
}

/// A unit name becomes a file name and a Lua identifier, so it is held to the
/// same rule the frontend normalises to rather than to `valid_id`, which does
/// not allow the underscores unit names are full of.
fn valid_unit_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Whether an export target is coilbox's own scratch game rather than a real
/// install, judged by the shape of the target folder's own name. Used to waive
/// the write-once rule below: a real game folder's hand edits must survive a
/// re-export, but the scratch `.sdd` the Test drawer writes into is coilbox's
/// own throwaway and should always reflect the unit as it stands right now.
fn is_scratch_dir(root: &Path) -> bool {
    root.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(valid_scratch_folder)
}

/// The scratch game's folder name, held to a shape no real game folder has:
/// coilbox's own prefix and a `.sdd` suffix. That is what keeps this command
/// from being pointed at an installed game and rewriting its `modinfo.lua`.
fn valid_scratch_folder(folder: &str) -> bool {
    folder.starts_with("coilbox-lego-")
        && folder.ends_with(".sdd")
        && folder.len() <= 64
        && !folder.contains("..")
        && folder
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.')
}

/// A texture file name from the pack, never a path.
fn valid_atlas_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.contains(['/', '\\'])
        && name != "."
        && name != ".."
        && name.to_ascii_lowercase().ends_with(".png")
}

#[derive(Deserialize)]
struct ExportVertex {
    pos: [f32; 3],
    normal: [f32; 3],
    uv: [f32; 2],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportPiece {
    name: String,
    offset: [f32; 3],
    vertices: Vec<ExportVertex>,
    indices: Vec<u32>,
    children: Vec<ExportPiece>,
}

#[derive(Deserialize)]
struct ExportModel {
    radius: f32,
    height: f32,
    mid: [f32; 3],
    texture1: String,
    texture2: String,
    root: ExportPiece,
}

impl From<ExportPiece> for coilbox_s3o::Piece {
    fn from(piece: ExportPiece) -> Self {
        Self {
            name: piece.name,
            // The builder only ever emits triangles. Strips and quads exist in
            // the format, but the engine converts both on load.
            primitive_type: coilbox_s3o::PrimitiveType::Triangles,
            offset: piece.offset,
            vertices: piece
                .vertices
                .into_iter()
                .map(|v| coilbox_s3o::Vertex {
                    pos: v.pos,
                    normal: v.normal,
                    uv: v.uv,
                })
                .collect(),
            indices: piece.indices,
            children: piece.children.into_iter().map(Into::into).collect(),
        }
    }
}

/// `lego_export` writes a built unit into a game folder.
///
/// The model goes to `objects3d/<unit>.s3o`. The atlas is shared: every unit
/// built from a pack names the same texture, so one copy in `unittextures/`
/// serves all of them and re-exporting a second unit does not add a second PNG.
/// The unit script and the unit definition both land under their own folder
/// and, like the script, the definition is written once and then left for
/// hand edits: a re-export never overwrites one that is already there. The one
/// exception is coilbox's own scratch game (see [`is_scratch_dir`]), which has
/// no hand edits worth keeping and must always show the unit as it stands now,
/// so both files are overwritten unconditionally there.
#[tauri::command]
async fn lego_export<R: Runtime>(
    app: AppHandle<R>,
    dir: String,
    unit_name: String,
    atlas: Option<String>,
    script: Option<String>,
    unit_def: Option<String>,
    model: ExportModel,
) -> CliResult {
    if !valid_unit_name(&unit_name) {
        return CliResult::err(format!(
            "invalid unit name: {unit_name}. Lower case letters, digits and underscores only."
        ));
    }
    let root = PathBuf::from(&dir);
    if !root.is_absolute() || !root.is_dir() {
        return CliResult::err(format!("not a folder: {dir}"));
    }
    let scratch = is_scratch_dir(&root);

    let bytes = match coilbox_s3o::write(&coilbox_s3o::Model {
        radius: model.radius,
        height: model.height,
        mid: model.mid,
        texture1: model.texture1,
        texture2: model.texture2,
        root: model.root.into(),
    }) {
        Ok(bytes) => bytes,
        Err(e) => return CliResult::err(format!("could not build the model: {e}")),
    };

    let models = root.join("objects3d");
    if let Err(e) = std::fs::create_dir_all(&models) {
        return CliResult::err(format!("could not create {}: {e}", models.display()));
    }
    let model_path = models.join(format!("{unit_name}.s3o"));
    if let Err(e) = std::fs::write(&model_path, &bytes) {
        return CliResult::err(format!("could not write {}: {e}", model_path.display()));
    }

    let mut texture_path = None;
    if let Some(atlas) = atlas {
        if !valid_atlas_name(&atlas) {
            return CliResult::err(format!("invalid texture name: {atlas}"));
        }
        let Some(source) = legopack_dir(&app).map(|dir| dir.join(&atlas)) else {
            return CliResult::err("no parts pack is installed".to_string());
        };
        let textures = root.join("unittextures");
        if let Err(e) = std::fs::create_dir_all(&textures) {
            return CliResult::err(format!("could not create {}: {e}", textures.display()));
        }
        let target = textures.join(&atlas);
        if let Err(e) = std::fs::copy(&source, &target) {
            return CliResult::err(format!("could not copy the texture: {e}"));
        }
        texture_path = Some(target.to_string_lossy().to_string());
    }

    // The unit script is written once and then left alone. It is meant to be
    // edited by hand, and re-exporting a model after a change to the geometry
    // must not throw that away. The scratch game is the one exception: it has
    // no hand edits worth keeping, so it always gets the current script.
    let mut script_path = None;
    let mut script_kept = false;
    if let Some(script) = script {
        let scripts = root.join("scripts");
        if let Err(e) = std::fs::create_dir_all(&scripts) {
            return CliResult::err(format!("could not create {}: {e}", scripts.display()));
        }
        let target = scripts.join(format!("{unit_name}.lua"));
        if target.exists() && !scratch {
            script_kept = true;
        } else if let Err(e) = std::fs::write(&target, script) {
            return CliResult::err(format!("could not write {}: {e}", target.display()));
        } else {
            script_path = Some(target.to_string_lossy().to_string());
        }
    }

    // The unit definition follows the same rule as the script, scratch
    // exception included: written once and left alone in a real game folder,
    // always refreshed in coilbox's own scratch game.
    let mut unit_def_path = None;
    let mut unit_def_kept = false;
    if let Some(unit_def) = unit_def {
        let units = root.join("units");
        if let Err(e) = std::fs::create_dir_all(&units) {
            return CliResult::err(format!("could not create {}: {e}", units.display()));
        }
        let target = units.join(format!("{unit_name}.lua"));
        if target.exists() && !scratch {
            unit_def_kept = true;
        } else if let Err(e) = std::fs::write(&target, unit_def) {
            return CliResult::err(format!("could not write {}: {e}", target.display()));
        } else {
            unit_def_path = Some(target.to_string_lossy().to_string());
        }
    }

    CliResult::ok(json!({
        "model": model_path.to_string_lossy(),
        "texture": texture_path,
        "script": script_path,
        "scriptKept": script_kept,
        "unitDef": unit_def_path,
        "unitDefKept": unit_def_kept,
    }))
}

/// `lego_export_glb` writes a unit's `.glb` into a game folder.
///
/// Kept out of `objects3d`, in its own `blender/` folder: a `.glb` is not
/// something the engine reads, only something to open in Blender to check
/// the unit or finish it by hand.
#[tauri::command]
async fn lego_export_glb(dir: String, unit_name: String, bytes: Vec<u8>) -> CliResult {
    if !valid_unit_name(&unit_name) {
        return CliResult::err(format!(
            "invalid unit name: {unit_name}. Lower case letters, digits and underscores only."
        ));
    }
    let root = PathBuf::from(&dir);
    if !root.is_absolute() || !root.is_dir() {
        return CliResult::err(format!("not a folder: {dir}"));
    }

    let blender = root.join("blender");
    if let Err(e) = std::fs::create_dir_all(&blender) {
        return CliResult::err(format!("could not create {}: {e}", blender.display()));
    }
    let target = blender.join(format!("{unit_name}.glb"));
    match std::fs::write(&target, &bytes) {
        Ok(()) => CliResult::ok(json!({ "path": target.to_string_lossy() })),
        Err(e) => CliResult::err(format!("could not write {}: {e}", target.display())),
    }
}

/// `lego_export_obj` writes a unit's `.obj` and `.mtl` into a game folder,
/// alongside a copy of the atlas the `.mtl` names.
///
/// The copy is what makes the reference resolve: the caller's `.mtl` points
/// `map_Kd` at `atlas` by file name alone, so that file has to actually sit
/// next to it rather than only in `unittextures/` elsewhere in the game
/// folder.
#[tauri::command]
async fn lego_export_obj<R: Runtime>(
    app: AppHandle<R>,
    dir: String,
    unit_name: String,
    obj: String,
    mtl: String,
    atlas: String,
) -> CliResult {
    if !valid_unit_name(&unit_name) {
        return CliResult::err(format!(
            "invalid unit name: {unit_name}. Lower case letters, digits and underscores only."
        ));
    }
    if !valid_atlas_name(&atlas) {
        return CliResult::err(format!("invalid texture name: {atlas}"));
    }
    let root = PathBuf::from(&dir);
    if !root.is_absolute() || !root.is_dir() {
        return CliResult::err(format!("not a folder: {dir}"));
    }

    let blender = root.join("blender");
    if let Err(e) = std::fs::create_dir_all(&blender) {
        return CliResult::err(format!("could not create {}: {e}", blender.display()));
    }

    let obj_path = blender.join(format!("{unit_name}.obj"));
    if let Err(e) = std::fs::write(&obj_path, obj) {
        return CliResult::err(format!("could not write {}: {e}", obj_path.display()));
    }
    let mtl_path = blender.join(format!("{unit_name}.mtl"));
    if let Err(e) = std::fs::write(&mtl_path, mtl) {
        return CliResult::err(format!("could not write {}: {e}", mtl_path.display()));
    }

    let Some(source) = legopack_dir(&app).map(|dir| dir.join(&atlas)) else {
        return CliResult::err("no parts pack is installed".to_string());
    };
    let texture_path = blender.join(&atlas);
    if let Err(e) = std::fs::copy(&source, &texture_path) {
        return CliResult::err(format!("could not copy the texture: {e}"));
    }

    CliResult::ok(json!({
        "obj": obj_path.to_string_lossy(),
        "mtl": mtl_path.to_string_lossy(),
        "texture": texture_path.to_string_lossy(),
    }))
}

/// `lego_scratch_game` prepares the `.sdd` a unit is tested in.
///
/// It writes one file, the `modinfo.lua` the frontend generated, into
/// `<data_dir>/games/<folder>`. The unit itself follows through `lego_export`,
/// which treats the result as any other game folder. Nothing else in the
/// content root is touched, so removing that one folder undoes the lot.
#[tauri::command]
async fn lego_scratch_game(data_dir: String, folder: String, modinfo: String) -> CliResult {
    if !valid_scratch_folder(&folder) {
        return CliResult::err(format!("not a scratch game folder: {folder}"));
    }
    let root = PathBuf::from(&data_dir);
    if !root.is_absolute() || !root.is_dir() {
        return CliResult::err(format!("not a content root: {data_dir}"));
    }

    let dir = root.join("games").join(&folder);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return CliResult::err(format!("could not create {}: {e}", dir.display()));
    }

    let target = dir.join("modinfo.lua");
    // Removing before writing bumps the folder's own modification time, which
    // is what the engine's archive scanner keys its cache off. Rewriting the
    // file in place leaves the folder looking untouched, and a unit added since
    // the last scan would never load.
    let _ = std::fs::remove_file(&target);
    match std::fs::write(&target, modinfo) {
        Ok(()) => CliResult::ok(json!({ "dir": dir.to_string_lossy() })),
        Err(e) => CliResult::err(format!("could not write {}: {e}", target.display())),
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-lego")
        .invoke_handler(tauri::generate_handler![
            lego_list,
            lego_save,
            lego_delete,
            lego_thumb_save,
            lego_open_path,
            lego_export,
            lego_export_glb,
            lego_export_obj,
            lego_scratch_game
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

    #[test]
    fn a_unit_name_is_a_lua_safe_file_stem() {
        assert!(valid_unit_name("arm_walker2"));
        // Upper case would give a file name a script could not address.
        assert!(!valid_unit_name("ArmWalker"));
        assert!(!valid_unit_name("arm walker"));
        assert!(!valid_unit_name("../escape"));
        assert!(!valid_unit_name(""));
    }

    #[test]
    fn a_scratch_folder_is_ours_and_could_never_be_a_real_game() {
        assert!(valid_scratch_folder("coilbox-lego-test.sdd"));
        // A real install's game folder must never be a valid target.
        assert!(!valid_scratch_folder("ba1211.sdd"));
        assert!(!valid_scratch_folder("Beyond All Reason.sdd"));
        assert!(!valid_scratch_folder("coilbox-lego-test.sdz"));
        assert!(!valid_scratch_folder("../coilbox-lego-test.sdd"));
        assert!(!valid_scratch_folder("coilbox-lego-../x.sdd"));
        assert!(!valid_scratch_folder(""));
    }

    #[test]
    fn is_scratch_dir_reads_the_last_path_component() {
        assert!(is_scratch_dir(Path::new(
            "/data/games/coilbox-lego-test.sdd"
        )));
        // A real install's game folder must never read as scratch, however it
        // is spelled or nested.
        assert!(!is_scratch_dir(Path::new("/data/games/ba1211.sdd")));
        assert!(!is_scratch_dir(Path::new(
            "/data/games/coilbox-lego-test.sdd/objects3d"
        )));
        assert!(!is_scratch_dir(Path::new("/")));
    }

    #[test]
    fn an_atlas_name_is_a_png_file_name_and_never_a_path() {
        assert!(valid_atlas_name("lego2skin2048_2-2.png"));
        assert!(!valid_atlas_name("../../etc/passwd.png"));
        assert!(!valid_atlas_name("sub/atlas.png"));
        assert!(!valid_atlas_name("atlas.exe"));
        assert!(!valid_atlas_name(".."));
    }
}
