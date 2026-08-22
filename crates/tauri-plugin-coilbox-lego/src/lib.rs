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
//!   - `geometry/<id>.bin.gz` the meshes of a unit imported from somebody
//!     else's `.s3o`, served by the `legogeom` root. Too big for the document:
//!     see [`import`], and [`geometry`] for the ones nobody kept
//!   - `textures/<sha256>.<ext>` the textures those units draw with, served by
//!     the `legotex` root. Keyed by content because a texture is shared: see
//!     [`texture`]
//!   - `out/<id>/` where an export lands unless told otherwise
//!   - `packs/<name>/` extension parts packs, served by the `legopacks` root
//!
//! Registered as `"coilbox-lego"`, so the frontend invokes
//! `plugin:coilbox-lego|<cmd>`.

mod atlas3do;
mod geometry;
mod import;
mod texture;

use coilbox_portable::valid_id;
use coilbox_springlua::unitscript;
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
            // Imported geometry belongs to one unit, so it goes with it. The
            // textures do not: they are shared, and `lego_texture_prune` is
            // what clears the ones nothing names any more.
            let _ = std::fs::remove_file(base.join("geometry").join(format!("{id}.bin.gz")));
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

/// Where the bundled pack can sit inside the resource directory, in the order we
/// take them. The Windows installer moves it into `.coilbox\resources` so the
/// install folder shows little more than the executable. Every other platform
/// leaves it at the top of the resource directory, which is also where a build
/// that has not been through an installer keeps it.
const BUNDLED: [&str; 2] = [".coilbox/resources/legoparts", "legoparts"];

/// The bundled pack under `resource_dir`, or `None` when neither layout is there.
fn bundled_pack_dir(resource_dir: &Path, is_dir: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    BUNDLED
        .into_iter()
        .map(|rel| resource_dir.join(rel))
        .find(|dir| is_dir(dir))
}

/// Where the parts pack lives, in order of precedence:
///
/// 1. `.coilbox/legoparts` beside the executable, so a distribution can ship its
///    own parts library without a rebuild. The installer's own copy goes a level
///    deeper, under `.coilbox/resources`, so this stays the distribution's to
///    fill in and an update never overwrites it.
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

    let resources = app.path().resource_dir().ok();
    if let Some(dir) = resources
        .as_deref()
        .and_then(|d| bundled_pack_dir(d, |dir| dir.is_dir()))
    {
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
    resources.map(|d| d.join("legoparts"))
}

/// Where extension parts packs live: one folder per pack under
/// `<data_dir>/lego/packs/`.
///
/// Separate from the base pack's own folder because that may be the bundled
/// copy, which sits inside the application and cannot be added to. In portable
/// mode `data_dir` is under `.coilbox`, so a distribution can ship extension
/// packs the same way it ships everything else.
///
/// Public because the app serves the same folder over `coilbox://`.
pub fn extra_packs_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    lego_dir(app).ok().map(|dir| dir.join("packs"))
}

/// Folder names of the extension packs installed, sorted so the load order the
/// frontend applies is the same on every run.
///
/// A pack is a folder holding a `pack.json`. Anything else in there is skipped
/// rather than reported: the folder is a user's own, and a stray file in it is
/// not a fault worth raising.
fn installed_packs(dir: &Path) -> Vec<String> {
    let mut names = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return names;
    };
    for entry in entries.flatten() {
        if !entry.path().join("pack.json").is_file() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_string());
        }
    }
    names.sort();
    names
}

/// `lego_packs` lists the extension parts packs installed beside the base pack.
///
/// The folder is reported whether or not it exists, because "where do I put a
/// pack" is a question the UI has to be able to answer.
#[tauri::command]
async fn lego_packs<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let Some(dir) = extra_packs_dir(&app) else {
        return CliResult::err("could not resolve the parts pack folder".to_string());
    };
    let names = installed_packs(&dir);
    CliResult::ok(json!({ "dir": dir.to_string_lossy(), "names": names }))
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

/// An installed pack's folder name, never a path. It comes from the frontend,
/// which read it out of `lego_packs`, and it becomes a directory to read from.
fn valid_pack_folder(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.contains(['/', '\\'])
        && name != "."
        && name != ".."
}

/// Which atlas to place, which installed pack ships it, and what to call it in
/// the game folder. The three travel together because a texture's file name
/// does not say where to read it from, and what a pack calls its atlas is not
/// what an export writes.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtlasRef {
    /// The texture's file name in the pack that ships it.
    name: String,
    /// The atlas pack's folder, or `None` for the base pack's own atlas.
    pack: Option<String>,
    /// The file name to write it as, which is what the s3o names. The frontend
    /// derives it, since the same name has to go into the model header.
    write_as: String,
}

/// Where an atlas file is read from: the base pack, or the atlas pack that
/// ships it. `pack` is a folder under the extension packs directory.
fn atlas_source<R: Runtime>(app: &AppHandle<R>, atlas: &AtlasRef) -> Result<PathBuf, String> {
    if !valid_atlas_name(&atlas.name) {
        return Err(format!("invalid texture name: {}", atlas.name));
    }
    match &atlas.pack {
        None => legopack_dir(app)
            .map(|dir| dir.join(&atlas.name))
            .ok_or_else(|| "no parts pack is installed".to_string()),
        Some(folder) => {
            if !valid_pack_folder(folder) {
                return Err(format!("invalid pack folder: {folder}"));
            }
            extra_packs_dir(app)
                .map(|dir| dir.join(folder).join(&atlas.name))
                .ok_or_else(|| "could not resolve the parts pack folder".to_string())
        }
    }
}

/// Where an atlas is written: `dir` joined with the name the s3o gives it.
///
/// Checked apart from the source name because the caller derives this one
/// rather than reading it off a pack, and it is still a file name from the
/// frontend.
fn atlas_target(dir: &Path, atlas: &AtlasRef) -> Result<PathBuf, String> {
    if !valid_atlas_name(&atlas.write_as) {
        return Err(format!("invalid texture name: {}", atlas.write_as));
    }
    Ok(dir.join(&atlas.write_as))
}

/// Whether a file the export owns has to be left exactly as it is.
///
/// Once a game folder holds one, it is the game author's: hand edits to a
/// script, a unit definition or a texture have to survive a re-export, and a
/// file the export never wrote must not be overwritten at all. The scratch game
/// is the one exception (see [`is_scratch_dir`]): it has no hand edits worth
/// keeping and has to show the unit as it stands now.
fn keep_existing(target: &Path, scratch: bool) -> bool {
    target.exists() && !scratch
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

/// A model read back off disk, shaped exactly like what `lego_export` takes.
///
/// The frontend already knows this shape, because it is what it builds a unit
/// into, so recovering a project is a matter of undoing the bake rather than
/// learning a second one.
#[derive(Serialize)]
struct ReadVertex {
    pos: [f32; 3],
    normal: [f32; 3],
    uv: [f32; 2],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadPiece {
    name: String,
    /// 0 triangles, 1 strip, 2 quads. Passed through rather than converted: the
    /// builder only ever writes triangles, so anything else says this file did
    /// not come from here.
    primitive_type: u32,
    offset: [f32; 3],
    vertices: Vec<ReadVertex>,
    indices: Vec<u32>,
    children: Vec<ReadPiece>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadModel {
    radius: f32,
    height: f32,
    mid: [f32; 3],
    texture1: String,
    texture2: String,
    root: ReadPiece,
}

impl From<&coilbox_s3o::Piece> for ReadPiece {
    fn from(piece: &coilbox_s3o::Piece) -> Self {
        Self {
            name: piece.name.clone(),
            primitive_type: match piece.primitive_type {
                coilbox_s3o::PrimitiveType::Triangles => 0,
                coilbox_s3o::PrimitiveType::TriangleStrip => 1,
                coilbox_s3o::PrimitiveType::Quads => 2,
            },
            offset: piece.offset,
            vertices: piece
                .vertices
                .iter()
                .map(|v| ReadVertex {
                    pos: v.pos,
                    normal: v.normal,
                    uv: v.uv,
                })
                .collect(),
            indices: piece.indices.clone(),
            children: piece.children.iter().map(Into::into).collect(),
        }
    }
}

/// The largest `.s3o` worth reading. The largest in the games checked is 3.2
/// MiB, so this is generous and still bounds a mistaken pick.
const MAX_MODEL_BYTES: u64 = 64 * 1024 * 1024;

/// `lego_read_s3o` parses a `.s3o` the user picked, for the builder to try to
/// recover a project from.
///
/// Any path, because the file being recovered lives wherever it was exported
/// to. Reading is all this does: whether the model came out of coilbox is a
/// question about the parts pack, and the pack lives in the frontend.
#[tauri::command]
async fn lego_read_s3o(path: String) -> CliResult {
    let file = PathBuf::from(&path);
    let size = match std::fs::metadata(&file) {
        Ok(meta) => meta.len(),
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    if size > MAX_MODEL_BYTES {
        return CliResult::err(format!(
            "{path} is {size} bytes, which is far larger than any unit model"
        ));
    }
    let bytes = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    let model = match coilbox_s3o::read(&bytes) {
        Ok(model) => model,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    let out = ReadModel {
        radius: model.radius,
        height: model.height,
        mid: model.mid,
        texture1: model.texture1.clone(),
        texture2: model.texture2.clone(),
        root: ReadPiece::from(&model.root),
    };
    match serde_json::to_value(&out) {
        Ok(value) => CliResult::ok(value),
        Err(e) => CliResult::err(format!("could not describe {path}: {e}")),
    }
}

/// A texture the model header names, once the import has looked for it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedTexture {
    /// The file in the store, or `None` when the texture could not be found.
    key: Option<String>,
    /// What the header names, which is what to say when it was not found.
    name: String,
    /// Where it was read from, so it can be refreshed after an edit elsewhere.
    source: Option<String>,
}

/// One header texture: found beside the model, stored, and described.
///
/// Not finding it is not fatal. The unit draws untextured and says which file
/// it wanted, which is more use than refusing an import over it.
fn import_texture(store: &Path, model: &Path, name: &str) -> ImportedTexture {
    let mut out = ImportedTexture {
        key: None,
        name: name.to_string(),
        source: None,
    };
    if name.trim().is_empty() {
        return out;
    }
    let Some(source) = texture::find_beside_model(model, name) else {
        return out;
    };
    out.source = Some(source.to_string_lossy().to_string());
    if let Ok(stored) = texture::store(store, &source) {
        out.key = Some(stored.key);
        out.name = stored.name;
    }
    out
}

/// `lego_import_s3o` imports somebody else's `.s3o` as raw geometry.
///
/// Separate from `lego_read_s3o`, which hands the whole model to the frontend
/// so it can try to match it back to the parts pack. This one keeps the meshes:
/// it packs them into `geometry/<id>.bin.gz` and answers with the tree, which
/// is names, offsets and a mesh key per piece and nothing else. The vertices
/// never cross the IPC, because the largest model measured is 15.0 MB as JSON
/// against 3.1 MiB packed.
///
/// The two textures the header names are resolved beside the model and put in
/// the shared store in the same call, since the model's own path is what finds
/// them and the frontend does not have it afterwards.
#[tauri::command]
async fn lego_import_s3o<R: Runtime>(app: AppHandle<R>, path: String, id: String) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid id: {id}"));
    }
    let file = PathBuf::from(&path);
    let size = match std::fs::metadata(&file) {
        Ok(meta) => meta.len(),
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    if size > MAX_MODEL_BYTES {
        return CliResult::err(format!(
            "{path} is {size} bytes, which is far larger than any unit model"
        ));
    }
    let bytes = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    let model = match coilbox_s3o::read(&bytes) {
        Ok(model) => model,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    let imported = match import::import(&model) {
        Ok(imported) => imported,
        Err(e) => return CliResult::err(e),
    };
    if imported.meshes == 0 {
        return CliResult::err(format!(
            "{path} has no geometry in it, so there is nothing to import."
        ));
    }

    let base = match lego_dir(&app) {
        Ok(dir) => dir,
        Err(e) => return CliResult::err(e),
    };
    let geometry = base.join("geometry");
    if let Err(e) = std::fs::create_dir_all(&geometry) {
        return CliResult::err(format!("could not create the geometry folder: {e}"));
    }
    if let Err(e) = std::fs::write(geometry.join(format!("{id}.bin.gz")), &imported.blob) {
        return CliResult::err(format!("could not store the geometry: {e}"));
    }

    let store = base.join("textures");
    let out = json!({
        "radius": model.radius,
        "height": model.height,
        "mid": model.mid,
        "root": imported.root,
        "texture": import_texture(&store, &file, &model.texture1),
        "texture2": import_texture(&store, &file, &model.texture2),
        "meshes": imported.meshes,
        "vertices": imported.vertices,
        "triangles": imported.triangles,
        "converted": imported.converted,
        "bytes": imported.blob.len(),
    });
    match serde_json::to_value(out) {
        Ok(value) => CliResult::ok(value),
        Err(e) => CliResult::err(format!("could not describe {path}: {e}")),
    }
}

/// `lego_read_3do` names the tiles a `.3do` asks for, before anything imports it.
///
/// The pair to `lego_read_s3o`, and it exists for the same reason: a model
/// unpacked out of a packed archive needs its textures put beside it before the
/// import goes looking for them, and only the model itself says which ones.
///
/// Both spellings of each name come back. The engine appends `00` to a `.3do`
/// texture name unless it is listed in the game's `teamtex.txt`, so a face
/// naming `arm2` is drawn with `arm200`, and whichever the archive holds is the
/// one worth unpacking.
#[tauri::command]
async fn lego_read_3do(path: String) -> CliResult {
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    let model = match coilbox_3do::read(&bytes) {
        Ok(model) => model,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    let mut names: Vec<String> = Vec::new();
    for piece in model.root.walk() {
        for prim in &piece.primitives {
            let coilbox_3do::Texture::Name(name) = &prim.texture else {
                continue;
            };
            if name.is_empty() {
                continue;
            }
            for candidate in [format!("{name}00"), name.clone()] {
                if !names.contains(&candidate) {
                    names.push(candidate);
                }
            }
        }
    }
    CliResult::ok(json!({ "textures": names }))
}

/// `lego_import_3do` imports a `.3do`, the older model format, as raw geometry.
///
/// Opening one is a conversion rather than a read, which is what makes this a
/// different command from `lego_import_s3o` rather than a branch inside it. An
/// `.s3o` names one texture and stores coordinates into it. A `.3do` names a
/// tile per face, in `unittextures/tatex/`, and stores no coordinates at all: a
/// face is stretched over the whole of its tile. So the tiles are packed into
/// one sheet and every face is given real coordinates onto it, and what comes
/// out is an ordinary unit that exports as an ordinary `.s3o`.
///
/// The sheet is written into the shared texture store like any other imported
/// texture, so nothing downstream knows this unit was converted.
///
/// A tile nothing on disk matched, and a face the format gives a flat palette
/// colour rather than a texture, are both drawn plain and counted. The Total
/// Annihilation palette is embedded in the engine rather than shipped in the
/// archive, so there is no colour to look up for the second kind.
#[tauri::command]
async fn lego_import_3do<R: Runtime>(app: AppHandle<R>, path: String, id: String) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid id: {id}"));
    }
    let file = PathBuf::from(&path);
    let size = match std::fs::metadata(&file) {
        Ok(meta) => meta.len(),
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    if size > MAX_MODEL_BYTES {
        return CliResult::err(format!(
            "{path} is {size} bytes, which is far larger than any unit model"
        ));
    }
    let bytes = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    let model = match coilbox_3do::read(&bytes) {
        Ok(model) => model,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };

    let (tiles, wanted) = read_tiles(&file, &model);
    let packed = match atlas3do::pack(tiles, true) {
        Ok(packed) => packed,
        Err(e) => return CliResult::err(format!("could not build a texture for {path}: {e}")),
    };
    let imported = match import::import_3do(&model, &packed.rects) {
        Ok(imported) => imported,
        Err(e) => return CliResult::err(e),
    };
    if imported.meshes == 0 {
        return CliResult::err(format!(
            "{path} has no geometry in it, so there is nothing to import."
        ));
    }

    let base = match lego_dir(&app) {
        Ok(dir) => dir,
        Err(e) => return CliResult::err(e),
    };
    let geometry = base.join("geometry");
    if let Err(e) = std::fs::create_dir_all(&geometry) {
        return CliResult::err(format!("could not create the geometry folder: {e}"));
    }
    if let Err(e) = std::fs::write(geometry.join(format!("{id}.bin.gz")), &imported.blob) {
        return CliResult::err(format!("could not store the geometry: {e}"));
    }

    // Named after the unit rather than after anything in the file, because the
    // sheet did not exist until now and nothing else is going to want it.
    let sheet_name = format!(
        "{}.png",
        file.file_stem()
            .map_or("model", |s| s.to_str().unwrap_or("model"))
    );
    let texture = match store_sheet(&base.join("textures"), &packed.image, &sheet_name) {
        Ok(value) => value,
        Err(e) => return CliResult::err(e),
    };

    let out = json!({
        "radius": model.radius,
        "height": model.height,
        "mid": model.mid,
        "root": imported.root,
        "texture": texture,
        "texture2": json!({ "key": null, "name": "", "source": null }),
        "meshes": imported.meshes,
        "vertices": imported.vertices,
        "triangles": imported.triangles,
        "converted": imported.converted,
        "bytes": imported.blob.len(),
        "paletteFaces": imported.palette_faces,
        "missingTextures": imported.missing_textures,
        "tiles": wanted,
    });
    match serde_json::to_value(out) {
        Ok(value) => CliResult::ok(value),
        Err(e) => CliResult::err(format!("could not describe {path}: {e}")),
    }
}

/// Read every tile a `.3do` names off the disk beside it.
///
/// Answers the tiles it found and how many the model asked for, so the import
/// can say "22 of 25" rather than leaving a silently patchy unit.
fn read_tiles(model_file: &Path, model: &coilbox_3do::Model) -> (Vec<atlas3do::Tile>, usize) {
    let mut names: Vec<String> = Vec::new();
    for piece in model.root.walk() {
        for prim in &piece.primitives {
            if let coilbox_3do::Texture::Name(name) = &prim.texture {
                if !name.is_empty() && !names.iter().any(|held| held == name) {
                    names.push(name.clone());
                }
            }
        }
    }

    let wanted = names.len();
    let tiles = names
        .into_iter()
        .filter_map(|name| {
            let found = texture::find_tile_beside_model(model_file, &name)?;
            let bytes = std::fs::read(&found.path).ok()?;
            let mut image = coilbox_texture::decode(&extension_of(&found.path), &bytes)?;
            if found.team_colour {
                team_colour_tile(&mut image);
            }
            Some(atlas3do::Tile { name, image })
        })
        .collect();
    (tiles, wanted)
}

/// Turn a team-colour placeholder into what an `.s3o` means by one.
///
/// The file a game ships for one of these is flat magenta, which is a marker
/// rather than a colour: the engine never draws it. An `.s3o` says the same
/// thing in the alpha of the texture the unit is painted with, so the pixels
/// become transparent and the engine paints the player's colour over them.
///
/// The colour underneath goes mid grey rather than staying magenta, because the
/// builder draws the texture as it is and shows no team colour at all. Left
/// magenta, a converted commander would have magenta patches on it in the one
/// place somebody is looking at it.
fn team_colour_tile(image: &mut image::RgbaImage) {
    for pixel in image.pixels_mut() {
        *pixel = image::Rgba([128, 128, 128, 0]);
    }
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

/// Put a sheet this import drew into the texture store.
///
/// Through the same content-addressed store every other texture goes through,
/// written as a PNG because that is what the sheet is: pixels coilbox composed
/// rather than a file it copied.
fn store_sheet(
    dir: &Path,
    image: &image::RgbaImage,
    name: &str,
) -> Result<serde_json::Value, String> {
    let png = coilbox_texture::encode_png(image).ok_or("could not encode the packed texture")?;
    let key = format!("{}.png", hex_digest(&png));
    let target = dir.join(&key);
    if !target.is_file() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("could not create the texture folder: {e}"))?;
        std::fs::write(&target, &png).map_err(|e| format!("could not store the texture: {e}"))?;
    }
    // No source. The sheet is pixels coilbox composed rather than a file it
    // copied, so there is nothing on disk to refresh it from.
    Ok(json!({ "key": key, "name": name, "source": serde_json::Value::Null }))
}

fn hex_digest(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// `lego_texture_import` puts a texture the user pointed at into the store.
///
/// Both changing a unit's texture and refreshing one edited outside coilbox go
/// through here. Refreshing is the same call with the path it came from: the
/// store is keyed by content, so edited bytes land on a new key and the webview
/// has nothing stale to serve, and unchanged bytes cost no write at all.
#[tauri::command]
async fn lego_texture_import<R: Runtime>(app: AppHandle<R>, path: String) -> CliResult {
    let dir = match lego_dir(&app) {
        Ok(dir) => dir.join("textures"),
        Err(e) => return CliResult::err(e),
    };
    match texture::store(&dir, Path::new(&path)) {
        Ok(stored) => CliResult::ok(json!({
            "key": stored.key,
            "name": stored.name,
            "bytes": stored.bytes,
        })),
        Err(e) => CliResult::err(e),
    }
}

/// `lego_texture_png` hands a stored texture back as a PNG the webview can
/// decode.
///
/// Only the `.glb` export asks for this. It embeds the image inside the
/// container, which means three.js has to have decoded it first, and the store
/// holds the game's own file: usually a compressed `.dds`, which no webview
/// reads. A `data:` URL rather than a file, because the alternative is another
/// asset-protocol root and another thing to prune, for bytes that are wanted
/// once and thrown away.
#[tauri::command]
async fn lego_texture_png<R: Runtime>(app: AppHandle<R>, key: String) -> CliResult {
    let dir = match lego_dir(&app) {
        Ok(dir) => dir.join("textures"),
        Err(e) => return CliResult::err(e),
    };
    let source = match stored_texture_source(&dir, &key) {
        Ok(path) => path,
        Err(e) => return CliResult::err(e),
    };
    // Always the texture the unit is painted with: the `.glb` embeds that one
    // and nothing else, because a glTF material has nowhere to put the other.
    match texture::blender_png(&source, texture::TextureRole::Colour) {
        Ok(png) => CliResult::ok(json!({
            "dataUrl": coilbox_texture::png_data_url(&png.bytes),
            "width": png.width,
            "height": png.height,
            "scaled": png.scaled,
        })),
        Err(e) => CliResult::err(e),
    }
}

/// `lego_texture_prune` deletes every stored texture that `keep` does not name.
///
/// The store is content addressed, so refreshing an edited texture leaves the
/// version before it behind. `keep` comes from the frontend because the
/// document schema is the frontend's, which is the same seam everything else
/// here sits on.
#[tauri::command]
async fn lego_texture_prune<R: Runtime>(app: AppHandle<R>, keep: Vec<String>) -> CliResult {
    let dir = match lego_dir(&app) {
        Ok(dir) => dir.join("textures"),
        Err(e) => return CliResult::err(e),
    };
    CliResult::ok(json!({ "removed": texture::prune(&dir, &keep) }))
}

/// A texture to place out of the shared store, for a unit imported from
/// somebody else's model rather than built out of the parts pack.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredTextureRef {
    /// The file in the store: `<sha256>.<ext>`.
    key: String,
    /// What to call it in the game folder, which is what the s3o names.
    write_as: String,
}

/// What an export places in `unittextures`, which is one thing or the other.
///
/// A unit built out of parts places the atlas it samples, under a prefixed name
/// so it cannot land on a file the game already has. A unit imported from
/// somebody else's model places its own textures out of the shared store, under
/// the names the model already gives them, which are the game's own.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportTextures {
    atlas: Option<AtlasRef>,
    #[serde(default)]
    stored: Vec<StoredTextureRef>,
}

/// A stored texture's file in the store. The key is content addressed and comes
/// from the frontend, so it is held to the same "a file name, never a path"
/// rule as everything else that lands in a folder.
fn stored_texture_source(dir: &Path, key: &str) -> Result<PathBuf, String> {
    if key.is_empty() || key.len() > 128 || key.contains(['/', '\\']) || key == "." || key == ".." {
        return Err(format!("invalid texture key: {key}"));
    }
    Ok(dir.join(key))
}

/// Where a stored texture is written: `dir` joined with the name the s3o gives
/// it, which is the model's own texture name and therefore the game's.
fn stored_texture_target(dir: &Path, write_as: &str) -> Result<PathBuf, String> {
    if write_as.is_empty()
        || write_as.len() > 128
        || write_as.contains(['/', '\\'])
        || write_as == "."
        || write_as == ".."
    {
        return Err(format!("invalid texture name: {write_as}"));
    }
    Ok(dir.join(write_as))
}

/// `lego_export` writes a built unit into a game folder.
///
/// The model goes to `objects3d/<unit>.s3o`. The atlas is shared by every unit
/// that samples it, so one copy in `unittextures/` serves all of them and
/// re-exporting a second unit does not add a second PNG. `atlas.pack` says
/// which installed pack ships it, since a unit may sample an atlas pack's
/// texture rather than the base pack's, and `atlas.write_as` is what it is
/// called once written.
/// The unit script and the unit definition both land under their own folder,
/// and all three of the texture, the script and the definition are written once
/// and then left alone: a re-export never overwrites one that is already there
/// (see [`keep_existing`]). Only the model and the per-piece collision file are
/// rewritten every time, because those are the files the builder alone owns.
// Each argument is one field of the IPC payload, so grouping them would only
// move the width into a struct the frontend then has to nest.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn lego_export<R: Runtime>(
    app: AppHandle<R>,
    dir: String,
    unit_name: String,
    textures: Option<ExportTextures>,
    script: Option<String>,
    piece_collision: Option<String>,
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

    // The texture is written once and then left alone, like the two files
    // below. The name it is written under is the caller's and cannot collide
    // with a game's own by accident, so a file already there is either a copy
    // an earlier export made or one the author put there, and neither is ours
    // to overwrite.
    let mut texture_path = None;
    let mut texture_kept = false;
    if let Some(atlas) = textures.as_ref().and_then(|t| t.atlas.as_ref()) {
        let source = match atlas_source(&app, atlas) {
            Ok(path) => path,
            Err(e) => return CliResult::err(e),
        };
        let into = root.join("unittextures");
        if let Err(e) = std::fs::create_dir_all(&into) {
            return CliResult::err(format!("could not create {}: {e}", into.display()));
        }
        let target = match atlas_target(&into, atlas) {
            Ok(path) => path,
            Err(e) => return CliResult::err(e),
        };
        if keep_existing(&target, scratch) {
            texture_kept = true;
        } else if let Err(e) = std::fs::copy(&source, &target) {
            return CliResult::err(format!("could not copy the texture: {e}"));
        } else {
            texture_path = Some(target.to_string_lossy().to_string());
        }
    }

    // An imported unit draws with its own textures rather than a pack's atlas,
    // and an `.s3o` names two: the one it is painted with, and the mask marking
    // the regions the engine paints in the player's colour. Both follow the
    // same write-once rule as the atlas, and for the same reason: the name they
    // land under is the game's own, so a file already there is the game's.
    let mut stored_paths = Vec::new();
    let mut stored_kept = Vec::new();
    let stored = textures.map(|t| t.stored).unwrap_or_default();
    if !stored.is_empty() {
        let store = match lego_dir(&app) {
            Ok(base) => base.join("textures"),
            Err(e) => return CliResult::err(e),
        };
        let into = root.join("unittextures");
        if let Err(e) = std::fs::create_dir_all(&into) {
            return CliResult::err(format!("could not create {}: {e}", into.display()));
        }
        for stored in stored {
            let source = match stored_texture_source(&store, &stored.key) {
                Ok(path) => path,
                Err(e) => return CliResult::err(e),
            };
            let target = match stored_texture_target(&into, &stored.write_as) {
                Ok(path) => path,
                Err(e) => return CliResult::err(e),
            };
            if keep_existing(&target, scratch) {
                stored_kept.push(stored.write_as);
            } else if let Err(e) = std::fs::copy(&source, &target) {
                return CliResult::err(format!(
                    "could not copy {}: {e}. The texture may have been deleted from the store.",
                    stored.write_as
                ));
            } else {
                stored_paths.push(target.to_string_lossy().to_string());
            }
        }
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
        if keep_existing(&target, scratch) {
            script_kept = true;
        } else if let Err(e) = std::fs::write(&target, script) {
            return CliResult::err(format!("could not write {}: {e}", target.display()));
        } else {
            script_path = Some(target.to_string_lossy().to_string());
        }
    }

    // The per-piece collision volumes, which are the one generated Lua file
    // coilbox keeps ownership of. Rewritten every export, unlike the script and
    // the definition either side of it, and that is the whole reason it is a
    // file of its own: the script is the user's and is never rewritten, so
    // nothing in it could ever be brought up to date.
    //
    // A unit that stops overriding anything still gets a file, an empty one. The
    // include line lives in that script nothing rewrites, so taking the file
    // away would leave it pointing at nothing, which the unit script framework
    // logs as an error for every unit created.
    //
    // It goes in a `coilbox` folder under `scripts/` so overwriting only ever
    // touches coilbox's own files, and because the framework walks `scripts/`
    // recursively and would otherwise be one basename collision away from
    // loading it as somebody's unit script.
    let mut piece_collision_path = None;
    if let Some(lua) = piece_collision {
        let generated = root.join("scripts").join("coilbox");
        if let Err(e) = std::fs::create_dir_all(&generated) {
            return CliResult::err(format!("could not create {}: {e}", generated.display()));
        }
        let target = generated.join(format!("{unit_name}_collision.lua"));
        if let Err(e) = std::fs::write(&target, lua) {
            return CliResult::err(format!("could not write {}: {e}", target.display()));
        }
        piece_collision_path = Some(target.to_string_lossy().to_string());
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
        if keep_existing(&target, scratch) {
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
        "textureKept": texture_kept,
        "textures": stored_paths,
        "texturesKept": stored_kept,
        "script": script_path,
        "scriptKept": script_kept,
        "pieceCollision": piece_collision_path,
        "unitDef": unit_def_path,
        "unitDefKept": unit_def_kept,
    }))
}

/// A texture to decode into a Blender export's folder.
///
/// The role is what says whether the alpha channel survives, which is not a
/// choice: an `.s3o`'s two textures mean different things by it. See
/// [`texture::TextureRole`].
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlenderTextureRef {
    key: String,
    write_as: String,
    role: texture::TextureRole,
}

/// Decode stored textures and write them into a Blender export's folder.
///
/// A PNG rather than the file the store holds, because that file is usually a
/// compressed `.dds` and neither Blender's glTF importer nor any `.mtl` reader
/// will open one. `write_as` already carries the `.png` name, derived by the
/// frontend, which needs the same name in the `.mtl` it wrote.
///
/// Overwritten every export, unlike the game's own folders: `blender/` holds
/// coilbox's files and nobody else's.
fn place_blender_textures<R: Runtime>(
    app: &AppHandle<R>,
    dir: &Path,
    textures: &[BlenderTextureRef],
) -> Result<Vec<serde_json::Value>, String> {
    if textures.is_empty() {
        return Ok(Vec::new());
    }
    let store = lego_dir(app)?.join("textures");
    let mut written = Vec::new();
    for stored in textures {
        let source = stored_texture_source(&store, &stored.key)?;
        let target = stored_texture_target(dir, &stored.write_as)?;
        let png = texture::blender_png(&source, stored.role)
            .map_err(|e| format!("{}: {e}", stored.write_as))?;
        std::fs::write(&target, &png.bytes)
            .map_err(|e| format!("could not write {}: {e}", target.display()))?;
        written.push(json!({
            "path": target.to_string_lossy(),
            "width": png.width,
            "height": png.height,
            "scaled": png.scaled,
        }));
    }
    Ok(written)
}

/// `lego_export_glb` writes a unit's `.glb` into a game folder.
///
/// Kept out of `objects3d`, in its own `blender/` folder: a `.glb` is not
/// something the engine reads, only something to open in Blender to check
/// the unit or finish it by hand.
///
/// `textures` is for a unit imported from somebody else's model. The `.glb`
/// embeds the texture the unit is painted with, but an `.s3o` names a second
/// one, which carries the unit's glow, shine and visibility rather than any
/// colour. glTF has no slot for that, and the ones it does have would claim it
/// is a picture, so it goes beside the `.glb` as its own PNG instead.
#[tauri::command]
async fn lego_export_glb<R: Runtime>(
    app: AppHandle<R>,
    dir: String,
    unit_name: String,
    bytes: Vec<u8>,
    textures: Option<Vec<BlenderTextureRef>>,
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

    let blender = root.join("blender");
    if let Err(e) = std::fs::create_dir_all(&blender) {
        return CliResult::err(format!("could not create {}: {e}", blender.display()));
    }
    let target = blender.join(format!("{unit_name}.glb"));
    if let Err(e) = std::fs::write(&target, &bytes) {
        return CliResult::err(format!("could not write {}: {e}", target.display()));
    }
    match place_blender_textures(&app, &blender, &textures.unwrap_or_default()) {
        Ok(written) => CliResult::ok(json!({
            "path": target.to_string_lossy(),
            "textures": written,
        })),
        Err(e) => CliResult::err(e),
    }
}

/// `lego_export_obj` writes a unit's `.obj` and `.mtl` into a game folder,
/// alongside the texture the `.mtl` names.
///
/// The copy is what makes the reference resolve: the caller's `.mtl` points
/// `map_Kd` at a file name alone, so that file has to actually sit next to it
/// rather than only in `unittextures/` elsewhere in the game folder.
///
/// One or the other, the same split as [`lego_export`]. A unit built out of
/// parts names `atlas`, which is copied across as it is. A unit imported from
/// somebody else's model names `textures` instead, which are decoded to PNG on
/// the way: the second of them carries no colour, so nothing in an `.mtl` can
/// point at it, and it lands beside the `.obj` for whoever opens it to use
/// rather than being dropped.
#[tauri::command]
async fn lego_export_obj<R: Runtime>(
    app: AppHandle<R>,
    dir: String,
    unit_name: String,
    obj: String,
    mtl: String,
    atlas: Option<AtlasRef>,
    textures: Option<Vec<BlenderTextureRef>>,
) -> CliResult {
    if !valid_unit_name(&unit_name) {
        return CliResult::err(format!(
            "invalid unit name: {unit_name}. Lower case letters, digits and underscores only."
        ));
    }
    let source = match atlas.as_ref().map(|a| atlas_source(&app, a)).transpose() {
        Ok(path) => path,
        Err(e) => return CliResult::err(e),
    };
    let root = PathBuf::from(&dir);
    if !root.is_absolute() || !root.is_dir() {
        return CliResult::err(format!("not a folder: {dir}"));
    }

    let blender = root.join("blender");
    if let Err(e) = std::fs::create_dir_all(&blender) {
        return CliResult::err(format!("could not create {}: {e}", blender.display()));
    }
    // Resolved before anything is written, so a texture name that will not do
    // does not leave an `.mtl` pointing at a file that never arrives.
    let texture_path = match atlas
        .as_ref()
        .map(|a| atlas_target(&blender, a))
        .transpose()
    {
        Ok(path) => path,
        Err(e) => return CliResult::err(e),
    };

    let obj_path = blender.join(format!("{unit_name}.obj"));
    if let Err(e) = std::fs::write(&obj_path, obj) {
        return CliResult::err(format!("could not write {}: {e}", obj_path.display()));
    }
    let mtl_path = blender.join(format!("{unit_name}.mtl"));
    if let Err(e) = std::fs::write(&mtl_path, mtl) {
        return CliResult::err(format!("could not write {}: {e}", mtl_path.display()));
    }

    if let (Some(source), Some(target)) = (&source, &texture_path) {
        if let Err(e) = std::fs::copy(source, target) {
            return CliResult::err(format!("could not copy the texture: {e}"));
        }
    }

    let written = match place_blender_textures(&app, &blender, &textures.unwrap_or_default()) {
        Ok(written) => written,
        Err(e) => return CliResult::err(e),
    };

    CliResult::ok(json!({
        "obj": obj_path.to_string_lossy(),
        "mtl": mtl_path.to_string_lossy(),
        "texture": texture_path.map(|p| p.to_string_lossy().to_string()),
        "textures": written,
    }))
}

/// The scratch game's generated files, by the path each has to sit at for the
/// engine to find it. Fixed here rather than passed in, so the frontend supplies
/// contents only and never a path.
const SCRATCH_MODINFO: &[&str] = &["modinfo.lua"];
const SCRATCH_SIDEDATA: &[&str] = &["gamedata", "sidedata.lua"];
const SCRATCH_GADGET: &[&str] = &["LuaRules", "Gadgets", "coilbox_start_unit.lua"];

/// Write one generated file into the scratch game, creating its folder.
///
/// Removing before writing bumps the containing folder's modification time,
/// which is what the engine's archive scanner keys its cache off. Rewriting a
/// file in place leaves the folder looking untouched, and a change made since
/// the last scan would never load.
fn write_scratch_file(dir: &Path, relative: &[&str], contents: &str) -> Result<(), String> {
    let target = relative
        .iter()
        .fold(dir.to_path_buf(), |path, part| path.join(part));
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let _ = std::fs::remove_file(&target);
    std::fs::write(&target, contents)
        .map_err(|e| format!("could not write {}: {e}", target.display()))
}

/// `lego_scratch_game` prepares the `.sdd` a unit is tested in.
///
/// It writes the three files the frontend generated into
/// `<data_dir>/games/<folder>`: the `modinfo.lua` naming the base game, the
/// `gamedata/sidedata.lua` declaring the built unit as the side's start unit,
/// and the gadget that spawns it. The unit itself follows through
/// `lego_export`, which treats the result as any other game folder. Nothing
/// else in the content root is touched, so removing that one folder undoes the
/// lot.
#[tauri::command]
async fn lego_scratch_game(
    data_dir: String,
    folder: String,
    modinfo: String,
    sidedata: String,
    gadget: String,
) -> CliResult {
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

    for (relative, contents) in [
        (SCRATCH_MODINFO, &modinfo),
        (SCRATCH_SIDEDATA, &sidedata),
        (SCRATCH_GADGET, &gadget),
    ] {
        if let Err(e) = write_scratch_file(&dir, relative, contents) {
            return CliResult::err(e);
        }
    }
    CliResult::ok(json!({ "dir": dir.to_string_lossy() }))
}

/// `lego_run_script` plays a unit's own Lua and reports where its pieces are on
/// every frame of it.
///
/// Sampled rather than streamed: the runtime is here and the viewport is in the
/// webview, so driving pieces live would be one call a frame. One call hands
/// back the whole timeline, which is the shape the viewport already plays.
///
/// A script that throws, loops or names a piece the unit does not have is not
/// an error here. It comes back as a timeline carrying the reason, because what
/// the script managed before it broke is worth seeing.
#[tauri::command]
fn lego_run_script(
    script: String,
    unit_name: String,
    pieces: Vec<String>,
    events: Vec<unitscript::ScriptEvent>,
    frames: u32,
) -> CliResult {
    let timeline = unitscript::run(
        &script,
        &format!("{unit_name}.lua"),
        &pieces,
        &events,
        frames,
    );
    match serde_json::to_value(timeline) {
        Ok(value) => CliResult::ok(value),
        Err(e) => CliResult::err(format!("could not report what the script did: {e}")),
    }
}

/// `lego_probe_script` asks a script which of its pieces do which job, by
/// calling the call-ins that answer with a piece and reading what comes back.
///
/// Not a run and not a preview. The engine calls these for an answer rather
/// than for an effect, so this calls them the same way: directly, with no
/// frames passing and nothing animated.
///
/// A script that will not load, or that answers badly, is not an error here
/// either. It comes back saying so, for the same reason `lego_run_script` does.
#[tauri::command]
fn lego_probe_script(
    script: String,
    unit_name: String,
    pieces: Vec<String>,
    callins: Vec<String>,
) -> CliResult {
    let probes = unitscript::probe(&script, &format!("{unit_name}.lua"), &pieces, &callins);
    match serde_json::to_value(probes) {
        Ok(value) => CliResult::ok(value),
        Err(e) => CliResult::err(format!("could not report what the script named: {e}")),
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-lego")
        // An import writes its geometry before anyone says they want the unit,
        // so a read somebody walked away from leaves a sidecar nothing names.
        // Cleared here because startup is the one moment nothing can be part way
        // through an import: see [`geometry`].
        .setup(|app, _api| {
            if let Ok(base) = lego_dir(app) {
                geometry::sweep(&base);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            lego_list,
            lego_save,
            lego_delete,
            lego_thumb_save,
            lego_open_path,
            lego_packs,
            lego_read_s3o,
            lego_import_s3o,
            lego_read_3do,
            lego_import_3do,
            lego_texture_import,
            lego_texture_png,
            lego_texture_prune,
            lego_export,
            lego_export_glb,
            lego_export_obj,
            lego_scratch_game,
            lego_run_script,
            lego_probe_script
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
    fn installed_packs_are_folders_with_a_manifest_in_name_order() {
        let dir = tempfile::tempdir().expect("tempdir");
        for name in ["zebra", "aliens"] {
            std::fs::create_dir_all(dir.path().join(name)).expect("mkdir");
            std::fs::write(dir.path().join(name).join("pack.json"), "{}").expect("write");
        }
        // A folder with no manifest is not a pack, and neither is a loose file.
        std::fs::create_dir_all(dir.path().join("notes")).expect("mkdir");
        std::fs::write(dir.path().join("pack.json"), "{}").expect("write");

        assert_eq!(installed_packs(dir.path()), vec!["aliens", "zebra"]);
    }

    #[test]
    fn installed_packs_treats_a_missing_folder_as_empty() {
        assert!(installed_packs(Path::new("/definitely/not/here")).is_empty());
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

    #[test]
    fn a_texture_target_is_the_name_it_is_written_as_and_never_a_path() {
        let atlas = |write_as: &str| AtlasRef {
            name: "atlas.png".to_string(),
            pack: None,
            write_as: write_as.to_string(),
        };
        assert_eq!(
            atlas_target(Path::new("/game/unittextures"), &atlas("coilbox_atlas.png")),
            Ok(PathBuf::from("/game/unittextures/coilbox_atlas.png"))
        );
        // It is joined onto a folder in the game, so it must not walk out of it
        // any more than the name it was read from may.
        assert!(atlas_target(Path::new("/game/unittextures"), &atlas("../modinfo.png")).is_err());
        assert!(atlas_target(Path::new("/game/unittextures"), &atlas("sub/atlas.png")).is_err());
        assert!(atlas_target(Path::new("/game/unittextures"), &atlas("")).is_err());
    }

    #[test]
    fn a_file_the_game_already_has_is_kept_unless_the_target_is_scratch() {
        let dir = tempfile::tempdir().expect("tempdir");
        let existing = dir.path().join("atlas.png");
        std::fs::write(&existing, "the game's own").expect("write");
        let missing = dir.path().join("coilbox_atlas.png");

        // A real game folder: what is there stays, what is not is written.
        assert!(keep_existing(&existing, false));
        assert!(!keep_existing(&missing, false));
        // The scratch game has nothing worth keeping, so it is always rewritten.
        assert!(!keep_existing(&existing, true));
        assert!(!keep_existing(&missing, true));
    }

    #[test]
    fn scratch_files_land_where_the_engine_looks_for_them() {
        let dir = tempfile::tempdir().expect("tempdir");
        for (relative, contents) in [
            (SCRATCH_MODINFO, "modinfo"),
            (SCRATCH_SIDEDATA, "sidedata"),
            (SCRATCH_GADGET, "gadget"),
        ] {
            write_scratch_file(dir.path(), relative, contents).expect("write");
        }

        let read = |path: &str| std::fs::read_to_string(dir.path().join(path)).expect("read");
        assert_eq!(read("modinfo.lua"), "modinfo");
        assert_eq!(read("gamedata/sidedata.lua"), "sidedata");
        assert_eq!(read("LuaRules/Gadgets/coilbox_start_unit.lua"), "gadget");
    }

    #[test]
    fn writing_a_scratch_file_twice_replaces_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_scratch_file(dir.path(), SCRATCH_SIDEDATA, "first").expect("write");
        write_scratch_file(dir.path(), SCRATCH_SIDEDATA, "second").expect("write");

        assert_eq!(
            std::fs::read_to_string(dir.path().join("gamedata/sidedata.lua")).expect("read"),
            "second"
        );
    }

    #[test]
    fn the_bundled_pack_is_found_where_the_windows_installer_tucks_it() {
        let res = Path::new("C:/Program Files/Coilbox");
        let tucked = res.join(".coilbox/resources/legoparts");
        assert_eq!(bundled_pack_dir(res, |dir| dir == tucked), Some(tucked));
    }

    #[test]
    fn a_bundle_the_installer_never_touched_keeps_its_pack_at_the_top() {
        let res = Path::new("/Coilbox.app/Contents/Resources");
        let plain = res.join("legoparts");
        assert_eq!(bundled_pack_dir(res, |dir| dir == plain), Some(plain));
    }

    #[test]
    fn no_bundled_pack_is_no_pack() {
        assert_eq!(bundled_pack_dir(Path::new("/app"), |_| false), None);
    }

    #[test]
    fn a_pack_folder_is_a_single_directory_name() {
        assert!(valid_pack_folder("desert-atlas"));
        // It is joined onto the packs directory, so it must not walk out of it.
        assert!(!valid_pack_folder(".."));
        assert!(!valid_pack_folder("../legoparts"));
        assert!(!valid_pack_folder("nested/pack"));
        assert!(!valid_pack_folder(""));
    }
}
