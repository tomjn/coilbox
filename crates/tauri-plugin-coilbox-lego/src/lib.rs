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
//!   - `pictures/<id>.png` the build picture an export writes to `unitpics/`
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

mod assimp;
mod geometry;
mod glb;
mod import;
mod reexport;
mod sandbox;
mod sheet;
mod texture;

use coilbox_3do_convert as atlas3do;
use coilbox_portable::valid_id;
use coilbox_springlua::unitscript;
use picoframe_core::CliResult;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
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

/// `lego_delete` removes a document and its geometry sidecar, and for a project
/// its thumbnail and export folder too. Those are best effort: a project that
/// was never exported or never saved a thumbnail has neither, and only an
/// imported unit or a lifted piece has a sidecar.
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
            let _ = std::fs::remove_file(base.join("pictures").join(format!("{id}.png")));
            let _ = std::fs::remove_dir_all(base.join("out").join(&id));
        }
    }
    // Imported geometry belongs to one unit, or to one piece lifted into the
    // inventory (#3262), so it goes with it. The textures do not: they are
    // shared, and `lego_texture_prune` is what clears the ones nothing names
    // any more.
    if let Ok(base) = lego_dir(&app) {
        let _ = std::fs::remove_file(base.join("geometry").join(format!("{id}.bin.gz")));
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

/// `lego_open_path` shows an exported file, or the scratch game's folder, in
/// the file manager.
#[tauri::command]
async fn lego_open_path(path: String) -> CliResult {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return CliResult::err(format!("path does not exist: {path}"));
    }
    match reveal(&target) {
        Ok(()) => CliResult::ok(json!({ "opened": true })),
        Err(e) => CliResult::err(format!("could not show {path}: {e}")),
    }
}

/// The file manager command that shows `target`: a folder opened, a file
/// selected inside its folder. Opening a file instead hands it to whatever app
/// claims its type, and on macOS nothing claims an `.s3o`, so the export
/// drawer's "Show me" did nothing at all.
#[cfg(target_os = "macos")]
fn reveal_command(target: &Path) -> Command {
    let mut open = Command::new("open");
    if target.is_file() {
        open.arg("-R");
    }
    open.arg(target);
    open
}

#[cfg(target_os = "windows")]
fn reveal_command(target: &Path) -> Command {
    use std::os::windows::process::CommandExt;
    let mut explorer = Command::new("explorer");
    if target.is_file() {
        // Explorer reads `/select,` and the quoted path as one argument, which
        // the standard quoting would split at the comma.
        explorer.raw_arg(format!("/select,\"{}\"", target.display()));
    } else {
        explorer.arg(target);
    }
    explorer
}

/// No call selects a file in every Linux file manager, so a file's folder is
/// opened instead.
#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_command(target: &Path) -> Command {
    let folder = match target.parent() {
        Some(parent) if target.is_file() => parent,
        _ => target,
    };
    let mut open = Command::new("xdg-open");
    open.arg(folder);
    open
}

/// Run [`reveal_command`]. `open` exits once the Finder has the request, and
/// with a failure it can explain, so macOS waits for it. Elsewhere only a
/// command that will not start is reported: Explorer exits with 1 whether or
/// not it worked, and `xdg-open` can wait on the app it launched.
fn reveal(target: &Path) -> Result<(), String> {
    let mut command = reveal_command(target);
    if cfg!(target_os = "macos") {
        let out = command.output().map_err(|e| e.to_string())?;
        if out.status.success() {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    command.spawn().map(drop).map_err(|e| e.to_string())
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
/// is one exception (see [`is_scratch_dir`]): it has no hand edits worth
/// keeping and has to show the unit as it stands now. `overwrite` is the other,
/// and applies only to a texture: the export drawer's own checkbox for when a
/// stale texture is exactly the problem being fixed.
fn keep_existing(target: &Path, scratch: bool, overwrite: bool) -> bool {
    target.exists() && !scratch && !overwrite
}

/// Where a game keeps the words a player reads, when it keeps them outside its
/// unit definitions, for one locale. Beyond All Reason's layout, and the one the
/// unitsync worker reads a game's names out of.
fn game_language_file(root: &Path, code: &str) -> PathBuf {
    root.join("language").join(code).join("units.json")
}

/// Coilbox's own file beside it, holding the names of the units coilbox put in
/// this folder and nothing else (issue #2683).
///
/// A file of our own rather than a patch to the game's. Beyond All Reason's
/// `modules/i18n/i18n.lua` loads every `*.json` under `language/<code>/` with
/// `VFS.DirList` and merges them into one table, so a second file is read
/// exactly as the first is, and the game's own file is never opened, never
/// reparsed and never rewritten.
///
/// The name sorts before `units.json`, which is the order the merge happens in,
/// so a key the game also declares is the game's rather than ours. Nothing
/// relies on that: [`write_unit_text`] is only ever asked to write a key the
/// caller has already checked the game does not use.
fn coilbox_language_file(root: &Path, code: &str) -> PathBuf {
    root.join("language").join(code).join("coilbox.json")
}

/// What a locale may be called, which is also what may become a folder name
/// here. Beyond All Reason ships `de`, `en`, `es`, `fr`, `ru`, `zh` and
/// `test_unicode`, so this is deliberately wider than two letters, and narrow
/// enough that nothing arriving over the IPC boundary can name a path.
fn valid_language_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 32
        && code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Generous next to Beyond All Reason's own 80 KB file, and still a bound on a
/// game that ships something enormous under that name. The unitsync worker caps
/// its read of the same file at the same size.
const LANGUAGE_CAP: usize = 4 * 1024 * 1024;

/// Read one `units.json`-shaped file into its two tables.
///
/// The shape is `{"units": {"names": {...}, "descriptions": {...}}}`, matching
/// the worker's `text_from_language_json`. Keys are lowercased, because a unit
/// def key is, and blanks are dropped: a name that is only whitespace is a unit
/// nobody named.
///
/// `Ok(None)` for a file that is not there, which is every game that names its
/// units in their definitions. `Err` for one that is there and will not read,
/// because that is the case where guessing does harm: the caller is about to
/// decide whether to strip the name out of a unit definition.
fn read_language_file(path: &Path) -> Result<Option<LanguageTables>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let bytes =
        std::fs::read(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    if bytes.len() > LANGUAGE_CAP {
        return Err(format!(
            "{} is {} bytes, larger than coilbox will read",
            path.display(),
            bytes.len()
        ));
    }
    let text = String::from_utf8_lossy(&bytes);
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("{} will not parse as JSON: {e}", path.display()))?;
    let units = value.get("units").and_then(serde_json::Value::as_object);
    Ok(Some(LanguageTables {
        names: language_table(units, "names"),
        descriptions: language_table(units, "descriptions"),
    }))
}

/// One table of def key to string out of a `units` object.
fn language_table(
    units: Option<&serde_json::Map<String, serde_json::Value>>,
    section: &str,
) -> HashMap<String, String> {
    let Some(Some(table)) = units.map(|u| u.get(section).and_then(|v| v.as_object())) else {
        return HashMap::new();
    };
    table
        .iter()
        .filter_map(|(key, value)| {
            let text = value.as_str()?.trim();
            (!text.is_empty()).then(|| (key.to_lowercase(), text.to_string()))
        })
        .collect()
}

/// What a `units.json`-shaped file says.
struct LanguageTables {
    names: HashMap<String, String>,
    descriptions: HashMap<String, String>,
}

/// A built unit's name and the line under it, for a game that reads neither
/// from the unit definition.
///
/// One locale, the game's base one, because a unit is built with one name. The
/// game's other locales fall back to it, which is the same thing they do for
/// every unit the game itself did not translate.
#[derive(Deserialize)]
struct UnitText {
    language: String,
    name: String,
    description: String,
}

/// Put one unit's name and description into coilbox's own language file.
///
/// Every key in that file is coilbox's, because coilbox is the only thing that
/// writes it, so this can rewrite the whole file without having to prove
/// anything about who put what in it. Keys belonging to other units exported
/// into the same folder are read back and kept, which is the only reason it
/// reads before writing at all.
///
/// A file that will not parse stops the write and is reported. It was ours, but
/// something has happened to it, and the alternative is throwing away whatever
/// that something was.
fn write_unit_text(root: &Path, unit_name: &str, text: &UnitText) -> Result<String, String> {
    if !valid_language_code(&text.language) {
        return Err(format!("invalid language code: {}", text.language));
    }
    let path = coilbox_language_file(root, &text.language);
    let existing = read_language_file(&path)?.unwrap_or(LanguageTables {
        names: HashMap::new(),
        descriptions: HashMap::new(),
    });

    let mut names = existing.names;
    let mut descriptions = existing.descriptions;
    names.insert(unit_name.to_string(), text.name.clone());
    descriptions.insert(unit_name.to_string(), text.description.clone());

    // Sorted, so a re-export of one unit is a one-line diff in a game folder
    // somebody keeps under version control rather than a reshuffle.
    let as_object = |table: HashMap<String, String>| {
        let mut sorted: Vec<_> = table.into_iter().collect();
        sorted.sort();
        sorted
            .into_iter()
            .map(|(k, v)| (k, serde_json::Value::String(v)))
            .collect::<serde_json::Map<_, _>>()
    };
    let document = json!({
        "units": {
            "names": as_object(names),
            "descriptions": as_object(descriptions),
        }
    });
    let mut body = serde_json::to_string_pretty(&document)
        .map_err(|e| format!("could not build {}: {e}", path.display()))?;
    body.push('\n');

    let dir = path.parent().ok_or("the game folder has no parent")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    std::fs::write(&path, &body).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().to_string())
}

/// Every `language/<code>/units.json` a game folder ships, keyed by code.
///
/// Only the game's own file. Coilbox's `coilbox.json` beside it is deliberately
/// not read back: the caller is asking what the game says, and answering with
/// coilbox's own past exports would let one export decide the next one's home.
fn read_game_languages(root: &Path) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let mut out = serde_json::Map::new();
    let Ok(entries) = std::fs::read_dir(root.join("language")) else {
        return Ok(out);
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !valid_language_code(&name) {
            continue;
        }
        let Some(tables) = read_language_file(&game_language_file(root, &name))? else {
            continue;
        };
        out.insert(
            name,
            json!({ "names": tables.names, "descriptions": tables.descriptions }),
        );
    }
    Ok(out)
}

/// `lego_game_language` reads a game folder's own `language/<code>/units.json`
/// files.
///
/// The export drawer asks this before it builds anything, because the answer
/// decides where a unit's name goes (issue #2683). A game whose units are named
/// there does not read a `name` in the definition at all: Beyond All Reason
/// builds every label from `Spring.I18N('units.names.' .. unitDefName)` and
/// falls back to the key rather than to the def.
///
/// `texts` is empty for a folder with no `language` folder, which is every game
/// that names its units in their definitions and is the answer for the great
/// majority of games.
#[tauri::command]
async fn lego_game_language(dir: String) -> CliResult {
    let root = PathBuf::from(&dir);
    if !root.is_absolute() || !root.is_dir() {
        return CliResult::err(format!("not a folder: {dir}"));
    }
    match read_game_languages(&root) {
        Ok(texts) => CliResult::ok(json!({ "texts": texts })),
        Err(e) => CliResult::err(e),
    }
}

/// One file an export wrote, with the digest of the bytes it wrote.
///
/// The digest is what lets a later cleanup prove a file is still coilbox's own
/// (issue #2680). A rename leaves the old name's files behind, and the only
/// safe way to take them away is to check that what is on disk now is exactly
/// what was written. A hand edit made since, or a file the game shipped under
/// that name, hashes to something else and is left alone.
fn owned_file(path: &Path, bytes: &[u8]) -> serde_json::Value {
    json!({ "path": path.to_string_lossy(), "sha256": hex_digest(bytes) })
}

/// Every file an export writes under one unit name, derived from the folder and
/// the name alone.
///
/// Never a texture of the game's or of a pack's. An atlas is shared by every unit
/// that samples it, and a unit imported from somebody else's model places its
/// textures under the names that model already gives them, which are the
/// game's own. Neither is keyed on the unit name, so neither is part of a
/// rename. A mixed unit's combined sheet is the exception, because it is made
/// from this unit alone and named after it (`sheetTextureNames` in
/// `src/lego/textureSheet.ts`, #3260).
fn export_paths(root: &Path, unit_name: &str) -> Vec<PathBuf> {
    vec![
        root.join("objects3d").join(format!("{unit_name}.s3o")),
        root.join("scripts").join(format!("{unit_name}.lua")),
        root.join("scripts")
            .join("coilbox")
            .join(format!("{unit_name}_collision.lua")),
        root.join("units").join(format!("{unit_name}.lua")),
        wreck_model_path(root, unit_name),
        reexport::feature_path(root, unit_name),
        root.join("unitpics").join(format!("{unit_name}.png")),
        root.join("blender").join(format!("{unit_name}.glb")),
        root.join("blender").join(format!("{unit_name}.obj")),
        root.join("blender").join(format!("{unit_name}.mtl")),
        root.join("unittextures")
            .join(format!("coilbox_{unit_name}_sheet.png")),
        root.join("unittextures")
            .join(format!("coilbox_{unit_name}_sheet2.png")),
    ]
}

/// Where a unit's wreck model is written (issue #3310). In a `coilbox` folder
/// so it cannot be the model of a unit whose own name ends in `_dead`.
fn wreck_model_path(root: &Path, unit_name: &str) -> PathBuf {
    root.join("objects3d")
        .join("coilbox")
        .join(format!("{unit_name}_dead.s3o"))
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

impl ExportModel {
    /// The model as `.s3o` bytes.
    fn into_s3o(self) -> Result<Vec<u8>, String> {
        coilbox_s3o::write(&coilbox_s3o::Model {
            radius: self.radius,
            height: self.height,
            mid: self.mid,
            texture1: self.texture1,
            texture2: self.texture2,
            root: self.root.into(),
        })
        .map_err(|e| format!("could not build the model: {e}"))
    }
}

/// The wreck a unit leaves (issue #3310): its model, and the feature
/// definition that names it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WreckExport {
    model: ExportModel,
    feature: String,
    /// The digest the receipt holds for the feature file the last export
    /// wrote here.
    feature_written: Option<String>,
}

/// What writing the wreck did: the model's path, the feature file's path when
/// it was written, and whether a changed feature file was left alone.
struct WreckWrite {
    model: PathBuf,
    feature: Option<PathBuf>,
    feature_kept: bool,
}

/// Write the wreck's model, rewritten every time like the unit's, and its
/// feature file, under the script's rule. Adds what it wrote to `owned`.
fn write_wreck(
    root: &Path,
    unit_name: &str,
    scratch: bool,
    wreck: WreckExport,
    owned: &mut Vec<serde_json::Value>,
) -> Result<WreckWrite, String> {
    let bytes = wreck.model.into_s3o()?;
    let model = wreck_model_path(root, unit_name);
    if let Some(folder) = model.parent() {
        std::fs::create_dir_all(folder)
            .map_err(|e| format!("could not create {}: {e}", folder.display()))?;
    }
    std::fs::write(&model, &bytes)
        .map_err(|e| format!("could not write {}: {e}", model.display()))?;
    owned.push(owned_file(&model, &bytes));
    let written = reexport::write_feature(
        root,
        unit_name,
        scratch,
        &wreck.feature,
        wreck.feature_written.as_deref(),
    )?;
    Ok(match written {
        reexport::ScriptWrite::Written(path) => {
            owned.push(owned_file(&path, wreck.feature.as_bytes()));
            WreckWrite {
                model,
                feature: Some(path),
                feature_kept: false,
            }
        }
        reexport::ScriptWrite::Kept(_) => WreckWrite {
            model,
            feature: None,
            feature_kept: true,
        },
    })
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

/// `lego_save_s3o` writes a model alone to an exact path, and nothing else.
///
/// The counterpart to `lego_read_s3o`, for a unit opened to fix one thing and
/// save it back: over the file it was opened from, or to a path the user
/// chose. Unlike `lego_export`, which builds a whole unit into a game folder
/// and writes a definition, a script and a collision file beside it, this
/// writes the one file and stops.
#[tauri::command]
async fn lego_save_s3o(path: String, model: ExportModel) -> CliResult {
    let file = PathBuf::from(&path);
    if !file.is_absolute() {
        return CliResult::err(format!("not an absolute path: {path}"));
    }
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
    if let Some(parent) = file.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return CliResult::err(format!("could not create {}: {e}", parent.display()));
        }
    }
    if let Err(e) = std::fs::write(&file, &bytes) {
        return CliResult::err(format!("could not write {}: {e}", file.display()));
    }
    CliResult::ok(json!({ "path": file.to_string_lossy() }))
}

/// `lego_save_glb` writes a `.glb`'s bytes to an exact path the user chose,
/// and nothing else.
///
/// `lego_export_glb` only ever writes under a game folder's own
/// `blender/<unit>.glb`, alongside the rest of an export. This is for saving a
/// `.glb` on its own wherever the user likes, without touching a game folder at
/// all, so there is no texture to place beside it either: the picture is
/// already embedded in the bytes the frontend built.
#[tauri::command]
async fn lego_save_glb(path: String, bytes: Vec<u8>) -> CliResult {
    let file = PathBuf::from(&path);
    if !file.is_absolute() {
        return CliResult::err(format!("not an absolute path: {path}"));
    }
    if let Some(parent) = file.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return CliResult::err(format!("could not create {}: {e}", parent.display()));
        }
    }
    if let Err(e) = std::fs::write(&file, &bytes) {
        return CliResult::err(format!("could not write {}: {e}", file.display()));
    }
    CliResult::ok(json!({ "path": file.to_string_lossy() }))
}

/// Write `text` to an absolute path, making the folder it goes in.
fn write_text_at(path: &str, text: &str) -> Result<(), String> {
    let file = PathBuf::from(path);
    if !file.is_absolute() {
        return Err(format!("not an absolute path: {path}"));
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    std::fs::write(&file, text).map_err(|e| format!("could not write {}: {e}", file.display()))
}

/// Read a UTF-8 text file from an absolute path.
fn read_text_at(path: &str) -> Result<String, String> {
    let file = PathBuf::from(path);
    if !file.is_absolute() {
        return Err(format!("not an absolute path: {path}"));
    }
    std::fs::read_to_string(&file).map_err(|e| format!("could not read {}: {e}", file.display()))
}

/// `lego_write_text_file` writes text the frontend serialized to an exact path
/// the user chose in a save dialog. Used to save a module to a file.
#[tauri::command]
async fn lego_write_text_file(path: String, text: String) -> CliResult {
    match write_text_at(&path, &text) {
        Ok(()) => CliResult::ok(json!({ "path": path })),
        Err(e) => CliResult::err(e),
    }
}

/// `lego_read_text_file` reads a text file the user chose in an open dialog.
/// The frontend validates the content. Used to load a module from a file.
#[tauri::command]
async fn lego_read_text_file(path: String) -> CliResult {
    match read_text_at(&path) {
        Ok(text) => CliResult::ok(json!({ "text": text })),
        Err(e) => CliResult::err(e),
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

/// `lego_geometry_save` writes a document's geometry sidecar from bytes the
/// frontend packed: a unit of parts taking in a lifted piece's meshes (#3259).
/// See [`geometry::store`].
#[tauri::command]
async fn lego_geometry_save<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    bytes: Vec<u8>,
) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid id: {id}"));
    }
    let base = match lego_dir(&app) {
        Ok(dir) => dir,
        Err(e) => return CliResult::err(e),
    };
    match geometry::store(&base, &id, &bytes) {
        Ok(()) => CliResult::ok(json!({ "bytes": bytes.len() })),
        Err(e) => CliResult::err(e),
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
/// one worth unpacking. A face can also name an empty string rather than
/// naming nothing at all (issue #2610), and the engine treats that the same
/// way: it becomes `"00"`, so that candidate is asked for too.
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
            for candidate in [format!("{name}00"), name.clone()] {
                if !names.contains(&candidate) {
                    names.push(candidate);
                }
            }
        }
    }
    CliResult::ok(json!({ "textures": names }))
}

/// The extension a model file carries, lower cased, which is the hint Assimp
/// takes to pick an importer.
fn model_extension(path: &std::path::Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// `lego_read_dae` names the textures one of the Assimp formats asks for,
/// before anything imports it.
///
/// The pair to `lego_read_3do`, and it exists for the same reason: a model
/// unpacked out of a packed archive needs its textures put beside it before the
/// import goes looking for them. Where the other two probes read the model
/// itself, this mostly reads the Lua file beside it, because a Collada file
/// carries no Spring texture binding of its own.
///
/// Both sources are reported rather than only the winning one. Staging a
/// texture that turns out not to be used costs one extracted file, and staging
/// none because the guess was wrong costs the unit its picture.
#[tauri::command]
async fn lego_read_dae(path: String) -> CliResult {
    let file = PathBuf::from(&path);
    let bytes = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    let model = match coilbox_assimp::read(&bytes, &model_extension(&file)) {
        Ok(model) => model,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    let meta = match assimp::metafile_textures(&file) {
        Ok(meta) => meta,
        Err(e) => return CliResult::err(e),
    };
    let mut names = meta.named();
    if let Some(from_material) = model.material_texture {
        if !from_material.trim().is_empty() && !names.contains(&from_material) {
            names.push(from_material);
        }
    }
    CliResult::ok(json!({ "textures": names }))
}

/// `lego_import_dae` imports one of the formats the engine loads through
/// Assimp, as raw geometry.
///
/// Its own command rather than a branch inside `lego_import_s3o` for the same
/// reason a `.3do` has one: opening it is a conversion. What it converts is
/// smaller though, because the reader already produces triangles with a normal
/// and a coordinate per vertex, and a piece tree carrying only translations.
///
/// The texture comes from the Lua file beside the model where there is one, and
/// from the model's own material where there is not. That is the engine's own
/// order of preference, with the metafile winning, and it matters because
/// Collada names no texture in the model at all.
#[tauri::command]
async fn lego_import_dae<R: Runtime>(app: AppHandle<R>, path: String, id: String) -> CliResult {
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
    let model = match coilbox_assimp::read(&bytes, &model_extension(&file)) {
        Ok(model) => model,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    let meta = match assimp::metafile_textures(&file) {
        Ok(meta) => meta,
        Err(e) => return CliResult::err(e),
    };
    let tex1 = if meta.tex1.is_empty() {
        model.material_texture.clone().unwrap_or_default()
    } else {
        meta.tex1.clone()
    };

    let converted = assimp::to_s3o(&model, &tex1, &meta.tex2);
    let imported = match import::import(&converted) {
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
        "radius": converted.radius,
        "height": converted.height,
        "mid": converted.mid,
        "root": imported.root,
        "texture": import_texture(&store, &file, &tex1),
        "texture2": import_texture(&store, &file, &meta.tex2),
        "meshes": imported.meshes,
        "vertices": imported.vertices,
        "triangles": imported.triangles,
        "converted": imported.converted,
        "bytes": imported.blob.len(),
        // What the format can hold and a Spring model cannot, counted by the
        // reader so this can say it rather than lose it quietly.
        "transformed": model.notes.transformed,
        "droppedFaces": model.notes.dropped_faces,
        "imagesUsed": model.notes.materials,
    });
    match serde_json::to_value(out) {
        Ok(value) => CliResult::ok(value),
        Err(e) => CliResult::err(format!("could not describe {path}: {e}")),
    }
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
/// A sheet a batch conversion (issue #2573) already left beside the model is
/// reused instead of packing a second one, found the same way as the palette
/// (see `texture::find_sheet_records_beside_model` and
/// `find_reusable_sheet`), so a unit opened here after converting its whole
/// game shares the one texture the rest of the game does rather than binding
/// a texture of its own (issue #2623).
///
/// A face names no texture at all when the format gives it a flat colour from
/// the Total Annihilation palette instead: `unittextures/tatex/palette.pal`,
/// found the same way a `.3do`'s ordinary tiles are (see
/// `texture::find_palette_beside_model`), colours it for real. A tile nothing
/// on disk matched, and a palette entry the file was not found or did not
/// have, are both drawn plain and counted. A child piece left dead by an
/// era-of-export naming slip (see `coilbox_3do_convert::is_dead_duplicate`) is
/// dropped from the tree and counted too.
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

    let (mut tiles, wanted) = read_tiles(&file, &model);
    let palette = texture::find_palette_beside_model(&file)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| coilbox_3do::read_palette(&bytes));
    tiles.extend(atlas3do::palette_tiles(&model, palette.as_ref()));
    let held: Vec<&str> = tiles.iter().map(|t| t.name.as_str()).collect();

    // A sheet a batch conversion (issue #2573) already left beside this model
    // is reused rather than packing a second one, so a unit opened here after
    // converting its whole game shares the one texture the rest of the game
    // does (issue #2623). Only when it holds every tile this model needs: a
    // sheet missing one is left alone and a fresh sheet is packed exactly as
    // before, the same fallback the batch itself takes on its own second run.
    let (rects, image, sheet_name, reused_sheet) = match find_reusable_sheet(&file, &held) {
        Some((rects, image, name)) => (rects, image, name, true),
        None => {
            let packed = match atlas3do::pack(&tiles) {
                Ok(packed) => packed,
                Err(e) => {
                    return CliResult::err(format!("could not build a texture for {path}: {e}"))
                }
            };
            // Named after the unit rather than after anything in the file,
            // because the sheet did not exist until now and nothing else is
            // going to want it.
            let name = format!(
                "{}.png",
                file.file_stem()
                    .map_or("model", |s| s.to_str().unwrap_or("model"))
            );
            (packed.rects, packed.image, name, false)
        }
    };

    let imported = match import::import_3do(&model, &rects) {
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

    let texture = match store_sheet(&base.join("textures"), &image, &sheet_name) {
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
        "droppedPieces": imported.dropped_pieces,
        "basePlateFaces": imported.base_plate_faces,
        "tiles": wanted,
        "sheetReused": reused_sheet,
    });
    match serde_json::to_value(out) {
        Ok(value) => CliResult::ok(value),
        Err(e) => CliResult::err(format!("could not describe {path}: {e}")),
    }
}

/// The largest `.glb` worth reading.
///
/// Larger than [`MAX_MODEL_BYTES`] because a `.glb` carries its pictures inside
/// itself where an `.s3o` names them, and the store's own cap on one texture is
/// 128 MiB (`texture::MAX_TEXTURE_BYTES`). This is that plus room for the
/// geometry beside it, and still small enough that a mistaken pick cannot fill
/// the disk.
const MAX_GLB_BYTES: u64 = 256 * 1024 * 1024;

/// `lego_import_glb` imports a binary glTF as raw geometry, keeping its tree.
///
/// The way back from Blender. Coilbox writes a unit as a `.glb` so it can be
/// finished there, and this reads one in, so a unit exported, edited and
/// imported again keeps its pieces rather than arriving as one flat lump. What
/// it produces is the same shape as an imported `.s3o` in every respect: the
/// same geometry sidecar, the same tree of names and offsets, the same texture
/// store. Nothing downstream needs to know which format a unit came in through.
///
/// Two things a `.glb` cannot carry, and both are said out loud rather than
/// guessed at. A glTF node has a full transform where an `.s3o` piece has a
/// translation, so the rotation and scale are baked into the vertices (see
/// `import::import_glb`). And a glTF material has one picture where an `.s3o`
/// has two, so the second texture, the one holding glow, shine and the cut-out
/// that decides whether a pixel is drawn at all, is not in the file and the
/// unit imports without one.
#[tauri::command]
async fn lego_import_glb<R: Runtime>(app: AppHandle<R>, path: String, id: String) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid id: {id}"));
    }
    let file = PathBuf::from(&path);
    let size = match std::fs::metadata(&file) {
        Ok(meta) => meta.len(),
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    if size > MAX_GLB_BYTES {
        return CliResult::err(format!(
            "{path} is {size} bytes, which is far larger than any unit model"
        ));
    }
    let bytes = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    let model = match glb::read(&bytes, &file) {
        Ok(model) => model,
        Err(e) => return CliResult::err(format!("could not read {path}: {e}")),
    };
    let imported = match import::import_glb(&model) {
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

    // A picture that could not be decoded is reported the way a missing one is:
    // the model still opens, and it names what it wanted so somebody can point
    // it at the file themselves.
    let mut missing = model.missing_image.clone();
    let mut team_mask = false;
    let texture = match &model.image {
        Some(image) => match store_glb_image(&base.join("textures"), image) {
            Ok((value, has_mask)) => {
                team_mask = has_mask;
                value
            }
            Err(problem) => {
                missing = Some(format!("{} ({problem})", image.name));
                json!({ "key": null, "name": image.name, "source": null })
            }
        },
        None => json!({
            "key": null,
            "name": missing.clone().unwrap_or_default(),
            "source": serde_json::Value::Null,
        }),
    };

    let out = json!({
        // No header to pin. An `.s3o` ships a collision sphere its author set,
        // and re-exporting must not quietly change it. A `.glb` has never held
        // one, so the builder measures it like a unit built out of parts.
        "radius": serde_json::Value::Null,
        "height": serde_json::Value::Null,
        "mid": serde_json::Value::Null,
        "root": imported.root,
        "texture": texture,
        "texture2": json!({ "key": null, "name": "", "source": null }),
        "meshes": imported.meshes,
        "vertices": imported.vertices,
        "triangles": imported.triangles,
        "converted": imported.converted,
        "bytes": imported.blob.len(),
        "skipped": model.skipped,
        "flatShaded": model.flat_shaded,
        "imagesUsed": model.images_used,
        "inventedRoot": model.invented_root,
        "transformed": model.transformed,
        "folded": model.folded,
        "teamMask": team_mask,
        "missingImage": missing,
    });
    match serde_json::to_value(out) {
        Ok(value) => CliResult::ok(value),
        Err(e) => CliResult::err(format!("could not describe {path}: {e}")),
    }
}

/// Read every tile a `.3do` names off the disk beside it.
///
/// Answers the tiles it found and how many the model asked for, so the import
/// can say "22 of 25" rather than leaving a silently patchy unit. A face
/// naming an empty string is one of those names, not a face that names
/// nothing at all (issue #2610): the engine resolves it to `"00"` the same as
/// any other name, so it is asked for here the same way.
fn read_tiles(model_file: &Path, model: &coilbox_3do::Model) -> (Vec<atlas3do::Tile>, usize) {
    let mut names: Vec<String> = Vec::new();
    for piece in model.root.walk() {
        for prim in &piece.primitives {
            if let coilbox_3do::Texture::Name(name) = &prim.texture {
                if !names.iter().any(|held| held == name) {
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
            set_team_mask(&mut image, found.team_colour);
            Some(atlas3do::Tile { name, image })
        })
        .collect();
    (tiles, wanted)
}

/// A sheet record left beside `model_file` by a batch conversion (issue
/// #2573) that already holds every tile in `held`, decoded and named, or
/// `None` if there is nothing to reuse.
///
/// Every candidate `find_sheet_records_beside_model` finds is tried in turn,
/// because a game with more than one faction leaves more than one record and
/// only the caller knows which tiles this particular model needs. A record
/// that does not cover `held` is not this model's sheet (issue #2623's second
/// question) and is skipped rather than reused half-mapped.
///
/// A record whose picture is missing, or whose picture no longer decodes to
/// the square size the record itself says it packed, is stale (issue #2623's
/// third question): something repacked or replaced the sheet without
/// rewriting this record, or the record survived a picture that did not. Both
/// are skipped the same way a missing tile is, rather than importing a unit
/// mapped onto coordinates that no longer point at what they used to.
fn find_reusable_sheet(
    model_file: &Path,
    held: &[&str],
) -> Option<(atlas3do::Rects, image::RgbaImage, String)> {
    for record_path in texture::find_sheet_records_beside_model(model_file) {
        let Ok(bytes) = std::fs::read(&record_path) else {
            continue;
        };
        let Ok(sheet) = atlas3do::Sheet::read(&bytes) else {
            continue;
        };
        if !sheet.covers(held.iter().copied()) {
            continue;
        }
        let image_path = record_path.with_file_name(&sheet.image);
        let Ok(image_bytes) = std::fs::read(&image_path) else {
            continue;
        };
        let Some(decoded) = coilbox_texture::decode(&extension_of(&image_path), &image_bytes)
        else {
            continue;
        };
        if decoded.width() != sheet.side || decoded.height() != sheet.side {
            continue;
        }
        return Some((sheet.rects(), decoded, sheet.image.clone()));
    }
    None
}

/// Put the team-colour mask an `.s3o` expects into a tile's alpha.
///
/// This is the one thing about the conversion with a direction that is easy to
/// get backwards, so it is worth writing down. Both engine model shaders read
/// `texColor1.rgb = mix(texColor1.rgb, teamCol.rgb, texColor1.a)`. Alpha of one
/// is entirely the player's colour, alpha of zero is entirely the texture. A
/// `.3do` tile is opaque, so copying its own alpha through paints the whole
/// unit flat in the player's colour with no texture left.
///
/// So the alpha is written rather than copied. An ordinary tile gets zero and
/// keeps its own colours. A team-colour region gets one, and its colours stop
/// mattering: the file a game ships for one is flat magenta, a marker the
/// engine never draws.
fn set_team_mask(image: &mut image::RgbaImage, team_colour: bool) {
    for pixel in image.pixels_mut() {
        if team_colour {
            *pixel = image::Rgba([128, 128, 128, 255]);
        } else {
            pixel.0[3] = 0;
        }
    }
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

/// Which format a picture out of a `.glb` is in.
///
/// By its own first bytes rather than by a name, because an embedded image has
/// no file name at all. glTF allows PNG and JPEG and nothing else, and both say
/// what they are in their first three bytes.
fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(PNG_MAGIC) {
        return Some("png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    None
}

/// A `.glb`'s picture, put in the store as the texture the unit is painted
/// with.
///
/// The alpha is the whole of the work here, and getting it wrong is invisible
/// in coilbox and glaring in the game. An `.s3o` reads the first texture's
/// alpha as the team-colour mask, `mix(texColor1.rgb, teamCol.rgb,
/// texColor1.a)`, so a fully opaque picture means "paint every pixel of this
/// unit in the player's colour" and the texture stops being drawn at all.
///
/// A picture out of a `.glb` is fully opaque nearly every time, because a glTF
/// material's base colour is a picture and its alpha is transparency. Coilbox's
/// own `.glb` export bakes the team colour into the picture and writes it fully
/// opaque, since `GLTFExporter` puts the image through a premultiplied canvas
/// that would eat the colour under any alpha (see `texture::glb_png`). So an
/// all-opaque picture is written to alpha
/// zero, which is no team colour anywhere and the unit's own colours kept. That
/// is the same call `set_team_mask` makes for a `.3do` tile, for the same
/// reason.
///
/// A picture that does carry varying alpha was authored that way, and is kept
/// exactly as it is. Answers whether it was.
fn store_glb_image(dir: &Path, image: &glb::Image) -> Result<(serde_json::Value, bool), String> {
    let ext = sniff_image(&image.bytes).ok_or_else(|| {
        "the picture inside this .glb is in neither of the two formats glTF allows, PNG and JPEG"
            .to_string()
    })?;
    let mut decoded = coilbox_texture::decode(ext, &image.bytes)
        .ok_or_else(|| format!("the .{ext} picture inside this .glb could not be decoded"))?;

    let has_mask = decoded.pixels().any(|pixel| pixel.0[3] != 255);
    if !has_mask {
        for pixel in decoded.pixels_mut() {
            pixel.0[3] = 0;
        }
    }
    Ok((store_sheet(dir, &decoded, &image.name)?, has_mask))
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

/// A particle bitmap already extracted to `path`, as a PNG with its alpha
/// kept, because the engine's particle blend reads it.
fn bitmap_png(path: &str) -> Result<(Vec<u8>, u32, u32), String> {
    let img = read_texture(path)?;
    let png = coilbox_texture::encode_png(&img)
        .ok_or_else(|| format!("could not encode {path} as a PNG"))?;
    Ok((png, img.width(), img.height()))
}

/// `lego_bitmap_png` decodes one particle bitmap for the preview's effects.
#[tauri::command]
async fn lego_bitmap_png(path: String) -> CliResult {
    match bitmap_png(&path) {
        Ok((png, width, height)) => CliResult::ok(json!({
            "dataUrl": coilbox_texture::png_data_url(&png),
            "width": width,
            "height": height,
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
    // Its alpha stays in, because that is the team-colour mask the frontend
    // bakes by (see `texture::glb_png`).
    match texture::glb_png(&source) {
        Ok(png) => CliResult::ok(json!({
            "dataUrl": coilbox_texture::png_data_url(&png.bytes),
            "width": png.width,
            "height": png.height,
            "scaled": png.scaled,
        })),
        Err(e) => CliResult::err(e),
    }
}

/// `lego_atlas_png` hands a parts atlas back as a PNG `data:` URL with the alpha
/// the engine would read.
///
/// The `.glb` export bakes the team colour in by that alpha, and an atlas with
/// none would read in the webview as full team colour everywhere (#4173).
/// Going through [`texture::engine_atlas`] means the `.glb` and the
/// `.s3o` follow one rule: no alpha channel is an alpha of 0, and an alpha the
/// atlas has is kept.
#[tauri::command]
async fn lego_atlas_png<R: Runtime>(app: AppHandle<R>, atlas: AtlasRef) -> CliResult {
    let source = match atlas_source(&app, &atlas) {
        Ok(path) => path,
        Err(e) => return CliResult::err(e),
    };
    let bytes = match std::fs::read(&source) {
        Ok(bytes) => bytes,
        Err(e) => return CliResult::err(format!("could not read the texture: {e}")),
    };
    match texture::engine_atlas(&bytes) {
        Ok(png) => CliResult::ok(json!({ "dataUrl": coilbox_texture::png_data_url(&png) })),
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

/// Read a texture off disk and decode it, for the texture composer below.
/// Reuses the same decoder every stored texture goes through, so a `.dds`
/// layer works exactly as a `.png` one does.
fn read_texture(path: &str) -> Result<image::RgbaImage, String> {
    let path = Path::new(path);
    let bytes =
        std::fs::read(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    coilbox_texture::decode(&extension_of(path), &bytes)
        .ok_or_else(|| format!("coilbox cannot decode {}", path.display()))
}

/// `lego_texture_compose_colour` builds an `.s3o`'s first texture from a
/// separate colour picture and team-colour mask, and puts the result in the
/// store.
///
/// The channel layout is `coilbox_texture::compose_texture1`'s, confirmed
/// against the engine's own model shader. `name` is the file name to record
/// against the result, which is what the export and the game folder end up
/// calling it: the frontend decides that, since it already knows the unit's
/// existing texture name and this crate stays out of the document schema.
#[tauri::command]
async fn lego_texture_compose_colour<R: Runtime>(
    app: AppHandle<R>,
    colour: String,
    mask: Option<String>,
    name: String,
) -> CliResult {
    let colour_img = match read_texture(&colour) {
        Ok(img) => img,
        Err(e) => return CliResult::err(e),
    };
    let mask_img = match mask.as_deref().map(read_texture).transpose() {
        Ok(img) => img,
        Err(e) => return CliResult::err(e),
    };
    let composed = match coilbox_texture::compose_texture1(&colour_img, mask_img.as_ref()) {
        Ok(img) => img,
        Err(e) => return CliResult::err(e),
    };
    let dir = match lego_dir(&app) {
        Ok(dir) => dir.join("textures"),
        Err(e) => return CliResult::err(e),
    };
    match store_sheet(&dir, &composed, &name) {
        Ok(value) => CliResult::ok(value),
        Err(e) => CliResult::err(e),
    }
}

/// Read a texture already in the store by its key and decode it, for carrying
/// an existing shading map's cutout into a rebuilt one. Goes through
/// `stored_texture_source` for the same key validation every other reader of
/// the store uses, rather than trusting a key handed across the IPC boundary.
fn read_stored_texture(dir: &Path, key: &str) -> Result<image::RgbaImage, String> {
    let path = stored_texture_source(dir, key)?;
    read_texture(path.to_str().ok_or("the store holds a non-UTF-8 path")?)
}

/// `lego_texture_compose_shading` builds an `.s3o`'s second texture from
/// separate glow and reflectivity maps, the other half of the same composer.
///
/// `existing` is the unit's current second texture, by its store key, so a
/// visibility cutout it carries survives the rebuild: see
/// `coilbox_texture::compose_texture2` for how and when that is possible.
/// `None` when the unit has no second texture yet.
#[tauri::command]
async fn lego_texture_compose_shading<R: Runtime>(
    app: AppHandle<R>,
    glow: Option<String>,
    reflectivity: Option<String>,
    existing: Option<String>,
    name: String,
) -> CliResult {
    let dir = match lego_dir(&app) {
        Ok(dir) => dir.join("textures"),
        Err(e) => return CliResult::err(e),
    };
    let glow_img = match glow.as_deref().map(read_texture).transpose() {
        Ok(img) => img,
        Err(e) => return CliResult::err(e),
    };
    let reflectivity_img = match reflectivity.as_deref().map(read_texture).transpose() {
        Ok(img) => img,
        Err(e) => return CliResult::err(e),
    };
    let existing_img = match existing
        .as_deref()
        .map(|key| read_stored_texture(&dir, key))
        .transpose()
    {
        Ok(img) => img,
        Err(e) => return CliResult::err(e),
    };
    let composed = match coilbox_texture::compose_texture2(
        glow_img.as_ref(),
        reflectivity_img.as_ref(),
        existing_img.as_ref(),
    ) {
        Ok(img) => img,
        Err(e) => return CliResult::err(e),
    };
    match store_sheet(&dir, &composed, &name) {
        Ok(value) => CliResult::ok(value),
        Err(e) => CliResult::err(e),
    }
}

/// One picture a combined sheet copies from (#3260): a parts atlas, or a
/// texture in the store by its key. Exactly one of the two.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SheetImage {
    #[serde(default)]
    atlas: Option<AtlasRef>,
    #[serde(default)]
    key: Option<String>,
    /// Whether the engine reads its v from the bottom row, as it does a `.dds`.
    #[serde(default)]
    flip_y: bool,
}

/// Where a sheet's picture is on disk, and whether it is a parts atlas.
fn sheet_image_path<R: Runtime>(
    app: &AppHandle<R>,
    store: &Path,
    image: &SheetImage,
) -> Result<(PathBuf, bool), String> {
    match (&image.atlas, &image.key) {
        (Some(atlas), None) => Ok((atlas_source(app, atlas)?, true)),
        (None, Some(key)) => Ok((stored_texture_source(store, key)?, false)),
        _ => Err("a sheet picture names either an atlas or a stored texture".to_string()),
    }
}

/// A sheet's picture decoded. A parts atlas goes through the rule an export
/// writes one by (see [`sheet::atlas_pixels`]), and a game's texture is read as
/// the game ships it, its team colour or visibility mask and all.
fn read_sheet_image<R: Runtime>(
    app: &AppHandle<R>,
    store: &Path,
    image: &SheetImage,
) -> Result<image::RgbaImage, String> {
    let (path, atlas) = sheet_image_path(app, store, image)?;
    if atlas {
        let bytes = std::fs::read(&path).map_err(|e| format!("could not read the atlas: {e}"))?;
        return sheet::atlas_pixels(&bytes);
    }
    read_texture(path.to_str().ok_or("the store holds a non-UTF-8 path")?)
}

/// A picture's width and height, read off a `.dds` header where it can be and
/// decoded otherwise.
fn sheet_image_size<R: Runtime>(
    app: &AppHandle<R>,
    store: &Path,
    image: &SheetImage,
) -> Result<(u32, u32), String> {
    let (path, _) = sheet_image_path(app, store, image)?;
    let bytes =
        std::fs::read(&path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    if let Some(size) = sheet::dds_size(&bytes) {
        return Ok(size);
    }
    let decoded = read_sheet_image(app, store, image)?;
    Ok((decoded.width(), decoded.height()))
}

/// `lego_texture_sizes` answers the width and height of each picture a mixed
/// unit's sheet is laid out from, in the order given. The frontend lays the
/// sheet out, and it cannot measure a `.dds` itself.
#[tauri::command]
async fn lego_texture_sizes<R: Runtime>(app: AppHandle<R>, images: Vec<SheetImage>) -> CliResult {
    let store = match lego_dir(&app) {
        Ok(dir) => dir.join("textures"),
        Err(e) => return CliResult::err(e),
    };
    let mut sizes = Vec::new();
    for image in &images {
        match sheet_image_size(&app, &store, image) {
            Ok((width, height)) => sizes.push(json!({ "width": width, "height": height })),
            Err(e) => return CliResult::err(e),
        }
    }
    CliResult::ok(json!(sizes))
}

/// One region of a combined sheet: what to copy, and where. `crop` is in the
/// source's own UVs and `dest` in sheet pixels (see [`sheet::Region`]). The
/// second texture is copied with the same crop, so the two sheets line up.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SheetRegionArg {
    colour: SheetImage,
    shading: Option<SheetImage>,
    crop: [f64; 4],
    dest: [u32; 4],
}

/// The file names the two sheets are recorded under in the store.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SheetNames {
    texture1: String,
    texture2: String,
}

/// The biggest sheet this will make, as a guard on what crosses the IPC. The
/// frontend's own limit is `SHEET_MAX_SIDE` in `src/lego/textureSheet.ts`.
const SHEET_MAX_SIDE: u32 = 4096;

/// The index of `image` in `decoded`, decoding it the first time it is asked
/// for. Keyed by what it names, so two regions on one picture share one decode.
fn decode_once<R: Runtime>(
    app: &AppHandle<R>,
    store: &Path,
    decoded: &mut Vec<(String, image::RgbaImage)>,
    image: &SheetImage,
) -> Result<usize, String> {
    let id = match (&image.atlas, &image.key) {
        (Some(atlas), _) => format!(
            "atlas:{}:{}",
            atlas.pack.as_deref().unwrap_or(""),
            atlas.name
        ),
        (None, key) => format!("key:{}", key.as_deref().unwrap_or("")),
    };
    if let Some(at) = decoded.iter().position(|(seen, _)| *seen == id) {
        return Ok(at);
    }
    decoded.push((id, read_sheet_image(app, store, image)?));
    Ok(decoded.len() - 1)
}

/// `lego_texture_sheet` paints a mixed unit's two combined sheets (#3260) and
/// puts both in the store, answering them as stored textures.
///
/// The first texture's regions keep each source's alpha, which is the team
/// colour mask, and the space between them has none. The second texture's
/// regions are each source's own second texture, or what the engine stands in
/// for a missing one ([`sheet::NO_SHADING`]) for a source that has none, which
/// is every part.
#[tauri::command]
async fn lego_texture_sheet<R: Runtime>(
    app: AppHandle<R>,
    width: u32,
    height: u32,
    regions: Vec<SheetRegionArg>,
    names: SheetNames,
) -> CliResult {
    if width == 0 || height == 0 || width > SHEET_MAX_SIDE || height > SHEET_MAX_SIDE {
        return CliResult::err(format!(
            "a {width} by {height} sheet is not one coilbox makes"
        ));
    }
    let store = match lego_dir(&app) {
        Ok(dir) => dir.join("textures"),
        Err(e) => return CliResult::err(e),
    };
    // Each picture once, however many regions share it.
    let mut decoded = Vec::new();
    let mut colour_at = Vec::with_capacity(regions.len());
    let mut shading_at = Vec::with_capacity(regions.len());
    for region in &regions {
        match decode_once(&app, &store, &mut decoded, &region.colour) {
            Ok(at) => colour_at.push(at),
            Err(e) => return CliResult::err(e),
        }
        let shading = match &region.shading {
            None => None,
            Some(image) => match decode_once(&app, &store, &mut decoded, image) {
                Ok(at) => Some(at),
                Err(e) => return CliResult::err(e),
            },
        };
        shading_at.push(shading);
    }

    let colour_regions: Vec<sheet::Region> = regions
        .iter()
        .zip(&colour_at)
        .map(|(region, &at)| sheet::Region {
            source: Some((&decoded[at].1, region.colour.flip_y)),
            crop: region.crop,
            dest: region.dest,
            fill: sheet::NO_COLOUR,
        })
        .collect();
    let shading_regions: Vec<sheet::Region> = regions
        .iter()
        .zip(&shading_at)
        .map(|(region, at)| sheet::Region {
            source: at
                .zip(region.shading.as_ref())
                .map(|(at, image)| (&decoded[at].1, image.flip_y)),
            crop: region.crop,
            dest: region.dest,
            fill: sheet::NO_SHADING,
        })
        .collect();
    let colour = match sheet::compose(width, height, sheet::NO_COLOUR, &colour_regions) {
        Ok(img) => img,
        Err(e) => return CliResult::err(e),
    };
    let shading = match sheet::compose(width, height, sheet::NO_SHADING, &shading_regions) {
        Ok(img) => img,
        Err(e) => return CliResult::err(e),
    };
    let texture = match store_sheet(&store, &colour, &names.texture1) {
        Ok(value) => value,
        Err(e) => return CliResult::err(e),
    };
    let texture2 = match store_sheet(&store, &shading, &names.texture2) {
        Ok(value) => value,
        Err(e) => return CliResult::err(e),
    };
    CliResult::ok(json!({ "texture": texture, "texture2": texture2 }))
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
    /// Written over whatever is there on every export, and recorded as the
    /// export's own, rather than written once and then left alone. Set for a
    /// mixed unit's combined sheet (#3260), which is made from the build like
    /// the model is, so a copy from an earlier build is never right.
    #[serde(default)]
    rewrite: bool,
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
    /// A folder every texture is read from instead of its pack or the store,
    /// by the same file names. A campaign's copy of a unit carries its own
    /// textures (issue #4516), so it launches without the pack it was built
    /// from.
    #[serde(default)]
    source_dir: Option<String>,
}

/// The folder an export reads its textures from instead of their usual
/// places, checked to be an absolute folder that exists.
fn texture_source_dir(dir: Option<&str>) -> Result<Option<PathBuf>, String> {
    let Some(dir) = dir else {
        return Ok(None);
    };
    let path = PathBuf::from(dir);
    if !path.is_absolute() || !path.is_dir() {
        return Err(format!("not a texture folder: {dir}"));
    }
    Ok(Some(path))
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

/// One library weapon's file, as the workshop's compile wrote it (issue
/// #3274).
#[derive(Deserialize)]
struct WeaponFile {
    name: String,
    contents: String,
}

/// Where each weapon file goes, checked before anything is written.
///
/// Only `coilbox_<unit>_<key>.lua` under `weapons/`, the name the workshop's
/// compile gives a library weapon on a unit (`weapon_file_name` in its
/// `compile.rs`). So an export can only ever write coilbox's own weapon files
/// for this unit, never one of the game's.
fn weapon_file_targets(
    root: &Path,
    unit_name: &str,
    files: &[WeaponFile],
) -> Result<Vec<PathBuf>, String> {
    let prefix = format!("coilbox_{unit_name}_");
    files
        .iter()
        .map(|file| {
            let key = file
                .name
                .strip_prefix(&prefix)
                .and_then(|rest| rest.strip_suffix(".lua"));
            match key {
                Some(key) if valid_unit_name(key) => Ok(root.join("weapons").join(&file.name)),
                _ => Err(format!("invalid weapon file name: {}", file.name)),
            }
        })
        .collect()
}

/// Write the weapon files. Rewritten on every export, like the collision
/// file, because the weapon is read again from the workshop each time.
fn write_weapon_files(
    targets: &[PathBuf],
    files: &[WeaponFile],
) -> Result<Vec<(String, serde_json::Value)>, String> {
    let mut written = Vec::new();
    for (target, file) in targets.iter().zip(files) {
        if let Some(folder) = target.parent() {
            std::fs::create_dir_all(folder)
                .map_err(|e| format!("could not create {}: {e}", folder.display()))?;
        }
        std::fs::write(target, &file.contents)
            .map_err(|e| format!("could not write {}: {e}", target.display()))?;
        written.push((
            target.to_string_lossy().to_string(),
            owned_file(target, file.contents.as_bytes()),
        ));
    }
    Ok(written)
}

/// Where an export writes the polyfill for shared COB unit values.
const COB_VARS: &[&str] = &["lualibs", "cob_vars.lua"];

/// `lualibs/cob_vars.lua`, beside a script that keeps the shared COB unit
/// values the engine stopped keeping, so the game's synced gadgets can set
/// them, and its gadgets and widgets can read them, too.
///
/// Every sharing unit in the game uses the one file, so it is not any unit's:
/// it is never in the receipt a rename reads, and it follows the script's rule,
/// written once and left alone in a real game folder and refreshed in the
/// scratch game. Answers the path written, and whether a file already there
/// was left alone.
fn write_cob_vars(
    root: &Path,
    scratch: bool,
    script: Option<&str>,
) -> Result<(Option<String>, bool), String> {
    if !script.is_some_and(coilbox_bos2lua::shares_values) {
        return Ok((None, false));
    }
    let target = COB_VARS
        .iter()
        .fold(root.to_path_buf(), |path, part| path.join(part));
    if keep_existing(&target, scratch, false) {
        return Ok((None, true));
    }
    let dir = root.join(COB_VARS[0]);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    std::fs::write(&target, coilbox_bos2lua::COB_VARS_POLYFILL)
        .map_err(|e| format!("could not write {}: {e}", target.display()))?;
    Ok((Some(target.to_string_lossy().to_string()), false))
}

/// Write a pack's atlas into a game with the alpha the engine reads as the team
/// colour mask (see [`texture::engine_atlas`]).
fn write_engine_atlas(source: &Path, target: &Path) -> Result<(), String> {
    let bytes = std::fs::read(source).map_err(|e| format!("could not read the texture: {e}"))?;
    let written = texture::engine_atlas(&bytes)?;
    std::fs::write(target, written).map_err(|e| format!("could not write the texture: {e}"))
}

/// `lego_export` writes a built unit into a game folder.
///
/// The model goes to `objects3d/<unit>.s3o`. The atlas is shared by every unit
/// that samples it, so one copy in `unittextures/` serves all of them and
/// re-exporting a second unit does not add a second PNG. `atlas.pack` says
/// which installed pack ships it, since a unit may sample an atlas pack's
/// texture rather than the base pack's, and `atlas.write_as` is what it is
/// called once written.
/// The unit script and the unit definition both land under their own folder.
/// The texture is written once and then left alone (see [`keep_existing`]).
/// The script and the definition follow the re-export rule in [`reexport`]
/// (issue #3245): the script is replaced only while it is still the one the
/// last export wrote, whose digest is `script_written`, and the definition has
/// the fields the build decides brought up to date, `unit_def_fields`, while
/// everything changed by hand stays. The model and the per-piece collision file
/// are rewritten every time, because those are the files the builder alone
/// owns. `overwrite_texture` is the one way round the texture's rule: with it
/// set, a texture already at that name is replaced rather than kept, for a
/// stale copy the drawer's ordinary write-once behaviour has no other way to
/// clear.
///
/// `text` is the unit's name and description for a game that reads neither from
/// the definition, and goes to [`coilbox_language_file`]. `None` for a game
/// that names its units in their definitions, where the words are already in
/// the `unit_def` above and nothing here has anything to add.
// Each argument is one field of the IPC payload, so grouping them would only
// move the width into a struct the frontend then has to nest.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn lego_export<R: Runtime>(
    app: AppHandle<R>,
    dir: String,
    unit_name: String,
    textures: Option<ExportTextures>,
    // The export drawer's "replace textures already there" checkbox. Only a
    // texture reads it: the script and the unit definition below keep their
    // own rule regardless.
    overwrite_texture: bool,
    script: Option<String>,
    // The digest the receipt holds for the script the last export wrote here.
    script_written: Option<String>,
    piece_collision: Option<String>,
    unit_def: Option<String>,
    // The fields the build decides, or `None` when nothing records coilbox
    // writing the definition already in the folder.
    unit_def_fields: Option<Vec<reexport::DerivedField>>,
    text: Option<UnitText>,
    model: ExportModel,
    // The library weapons the unit fires (issue #3274). Absent from a caller
    // that writes none.
    weapons: Option<Vec<WeaponFile>>,
    // The wreck the unit leaves (issue #3310). Absent from a caller that
    // writes none.
    wreck: Option<WreckExport>,
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
    let weapons = weapons.unwrap_or_default();
    let weapon_targets = match weapon_file_targets(&root, &unit_name, &weapons) {
        Ok(targets) => targets,
        Err(e) => return CliResult::err(e),
    };

    let bytes = match model.into_s3o() {
        Ok(bytes) => bytes,
        Err(e) => return CliResult::err(e),
    };

    let models = root.join("objects3d");
    if let Err(e) = std::fs::create_dir_all(&models) {
        return CliResult::err(format!("could not create {}: {e}", models.display()));
    }
    let model_path = models.join(format!("{unit_name}.s3o"));
    if let Err(e) = std::fs::write(&model_path, &bytes) {
        return CliResult::err(format!("could not write {}: {e}", model_path.display()));
    }
    // What this run wrote, and what it wrote there, so a rename can later prove
    // which files under the old name are still coilbox's to remove (issue
    // #2680). A file that was kept rather than written is deliberately absent:
    // coilbox did not put those contents there and has no claim on them.
    let mut owned = vec![owned_file(&model_path, &bytes)];

    // The texture is written once and then left alone, like the two files
    // below. The name it is written under is the caller's and cannot collide
    // with a game's own by accident, so a file already there is either a copy
    // an earlier export made or one the author put there, and neither is ours
    // to overwrite.
    let source_dir =
        match texture_source_dir(textures.as_ref().and_then(|t| t.source_dir.as_deref())) {
            Ok(dir) => dir,
            Err(e) => return CliResult::err(e),
        };
    let mut texture_path = None;
    let mut texture_kept = false;
    if let Some(atlas) = textures.as_ref().and_then(|t| t.atlas.as_ref()) {
        let source = match &source_dir {
            Some(dir) if valid_atlas_name(&atlas.name) => Ok(dir.join(&atlas.name)),
            Some(_) => Err(format!("invalid texture name: {}", atlas.name)),
            None => atlas_source(&app, atlas),
        };
        let source = match source {
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
        if keep_existing(&target, scratch, overwrite_texture) {
            texture_kept = true;
        } else if let Err(e) = write_engine_atlas(&source, &target) {
            return CliResult::err(e);
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
        let store = match (&source_dir, lego_dir(&app)) {
            (Some(dir), _) => dir.clone(),
            (None, Ok(base)) => base.join("textures"),
            (None, Err(e)) => return CliResult::err(e),
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
            if stored.rewrite {
                let read = std::fs::read(&source).map_err(|e| {
                    format!(
                        "could not read {}: {e}. The texture may have been deleted from the store.",
                        stored.write_as
                    )
                });
                let bytes = match read {
                    Ok(bytes) => bytes,
                    Err(e) => return CliResult::err(e),
                };
                if let Err(e) = std::fs::write(&target, &bytes) {
                    return CliResult::err(format!("could not write {}: {e}", target.display()));
                }
                owned.push(owned_file(&target, &bytes));
                stored_paths.push(target.to_string_lossy().to_string());
            } else if keep_existing(&target, scratch, overwrite_texture) {
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

    let (cob_vars_path, cob_vars_kept) = match write_cob_vars(&root, scratch, script.as_deref()) {
        Ok(written) => written,
        Err(e) => return CliResult::err(e),
    };

    // The unit script is meant to be edited by hand, and re-exporting after a
    // change to the build must not throw that away. So it is replaced only
    // while it is still exactly the script the last export wrote (issue
    // #3245). The scratch game has no hand edits worth keeping, so it always
    // gets the current script.
    let mut script_path = None;
    let mut script_kept = false;
    if let Some(script) = script {
        match reexport::write_script(
            &root,
            &unit_name,
            scratch,
            &script,
            script_written.as_deref(),
        ) {
            Ok(reexport::ScriptWrite::Written(target)) => {
                script_path = Some(target.to_string_lossy().to_string());
                owned.push(owned_file(&target, script.as_bytes()));
            }
            Ok(reexport::ScriptWrite::Kept(_)) => script_kept = true,
            Err(e) => return CliResult::err(e),
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
        if let Err(e) = std::fs::write(&target, &lua) {
            return CliResult::err(format!("could not write {}: {e}", target.display()));
        }
        piece_collision_path = Some(target.to_string_lossy().to_string());
        owned.push(owned_file(&target, lua.as_bytes()));
    }

    let weapon_paths = match write_weapon_files(&weapon_targets, &weapons) {
        Ok(written) => written
            .into_iter()
            .map(|(path, file)| {
                owned.push(file);
                path
            })
            .collect::<Vec<_>>(),
        Err(e) => return CliResult::err(e),
    };

    let wreck = match wreck
        .map(|wreck| write_wreck(&root, &unit_name, scratch, wreck, &mut owned))
        .transpose()
    {
        Ok(wreck) => wreck,
        Err(e) => return CliResult::err(e),
    };

    // The unit definition: written whole the first time and in the scratch
    // game, and after that brought up to date field by field, keeping every
    // field somebody changed (issue #3245).
    let mut unit_def_path = None;
    let mut unit_def_kept = None;
    let mut unit_def_changes = Vec::new();
    if let Some(unit_def) = unit_def {
        match reexport::write_unit_def(
            &root,
            &unit_name,
            scratch,
            &unit_def,
            unit_def_fields.as_deref(),
        ) {
            Ok(wrote) => {
                if let Some(text) = &wrote.written {
                    unit_def_path = Some(wrote.path.to_string_lossy().to_string());
                    owned.push(owned_file(&wrote.path, text.as_bytes()));
                }
                unit_def_kept = wrote.kept;
                unit_def_changes = wrote.fields;
            }
            Err(e) => return CliResult::err(e),
        }
    }

    // The name and the line under it, for a game that reads neither from the
    // definition (issue #2683). Coilbox's own file, so unlike the definition it
    // is rewritten every export: the words come from the project, and a project
    // renamed between two exports has to reach the game under the new name.
    let mut language_path = None;
    if let Some(text) = text {
        match write_unit_text(&root, &unit_name, &text) {
            Ok(path) => language_path = Some(path),
            Err(e) => return CliResult::err(e),
        }
    }

    CliResult::ok(json!({
        "model": model_path.to_string_lossy(),
        "texture": texture_path,
        "language": language_path,
        "textureKept": texture_kept,
        "textures": stored_paths,
        "texturesKept": stored_kept,
        "script": script_path,
        "scriptKept": script_kept,
        "cobVars": cob_vars_path,
        "cobVarsKept": cob_vars_kept,
        "pieceCollision": piece_collision_path,
        "unitDef": unit_def_path,
        "unitDefKept": unit_def_kept,
        "unitDefFields": unit_def_changes,
        "weapons": weapon_paths,
        "wreckModel": wreck.as_ref().map(|w| w.model.to_string_lossy().to_string()),
        "wreckFeature": wreck
            .as_ref()
            .and_then(|w| w.feature.as_ref())
            .map(|path| path.to_string_lossy().to_string()),
        "wreckFeatureKept": wreck.as_ref().is_some_and(|w| w.feature_kept),
        "owned": owned,
    }))
}

/// `lego_export_stale` reports, and optionally removes, the files an export left
/// behind under a name the unit no longer uses (issue #2680).
///
/// Renaming a unit and exporting again writes a second set of files rather than
/// moving the first, so the game ends up with two units. This is how the old
/// set is found and cleared. `digests` are the ones the receipt recorded for
/// that name, and a file is only ever removed when its contents still hash to
/// one of them. That is the whole safety rule: a file the user edited by hand
/// since, and a file the game shipped under the same name, both hash to
/// something else and come back under `kept` instead.
///
/// `dry_run` reports without touching anything, which is what the export drawer
/// shows before offering the button.
#[tauri::command]
async fn lego_export_stale(
    dir: String,
    unit_name: String,
    digests: Vec<String>,
    dry_run: bool,
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
    match sort_stale_files(&root, &unit_name, &digests, dry_run) {
        Ok(sorted) => CliResult::ok(json!({
            "ours": sorted.ours,
            "kept": sorted.kept,
            "missing": sorted.missing,
            "dryRun": dry_run,
        })),
        Err(e) => CliResult::err(e),
    }
}

/// What is left under an old unit name, split by whether coilbox can prove the
/// file is its own.
struct StaleFiles {
    /// Present, and still exactly what coilbox wrote. Removed unless dry run.
    ours: Vec<String>,
    /// Present, but not what coilbox wrote. Never touched, only reported.
    kept: Vec<String>,
    /// Not there at all, so a rename left nothing at this path.
    missing: Vec<String>,
}

/// Sort every file the old name could own, removing the ones that are provably
/// coilbox's when this is not a dry run. See [`lego_export_stale`].
fn sort_stale_files(
    root: &Path,
    unit_name: &str,
    digests: &[String],
    dry_run: bool,
) -> Result<StaleFiles, String> {
    let mut sorted = StaleFiles {
        ours: Vec::new(),
        kept: Vec::new(),
        missing: Vec::new(),
    };
    sort_named_files(export_paths(root, unit_name), digests, dry_run, &mut sorted)?;
    sort_weapon_files(root, unit_name, digests, dry_run, &mut sorted)?;
    Ok(sorted)
}

/// Sort the files at these exact paths. See [`sort_stale_files`].
fn sort_named_files(
    paths: Vec<PathBuf>,
    digests: &[String],
    dry_run: bool,
    sorted: &mut StaleFiles,
) -> Result<(), String> {
    let known: std::collections::HashSet<&str> = digests.iter().map(String::as_str).collect();
    for path in paths {
        let display = path.to_string_lossy().to_string();
        if !path.is_file() {
            sorted.missing.push(display);
            continue;
        }
        // A file that will not read cannot be shown to be ours, so it is left
        // alone rather than assumed either way.
        let Ok(bytes) = std::fs::read(&path) else {
            sorted.kept.push(display);
            continue;
        };
        if !known.contains(hex_digest(&bytes).as_str()) {
            sorted.kept.push(display);
            continue;
        }
        if !dry_run {
            std::fs::remove_file(&path)
                .map_err(|e| format!("could not remove {}: {e}", path.display()))?;
        }
        sorted.ours.push(display);
    }
    Ok(())
}

/// Sort the unit's weapon files, which are named by key as well as unit, so they
/// are found by prefix. `coilbox_tank_` also matches `tank_big`'s files, so a
/// weapon file counts only when its digest is on this name's receipt. One that
/// is not is silently passed over rather than reported as kept, because it is
/// as likely another unit's as an edited file of this one.
fn sort_weapon_files(
    root: &Path,
    unit_name: &str,
    digests: &[String],
    dry_run: bool,
    sorted: &mut StaleFiles,
) -> Result<(), String> {
    let known: std::collections::HashSet<&str> = digests.iter().map(String::as_str).collect();
    for path in stale_weapon_candidates(root, unit_name) {
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        if !known.contains(hex_digest(&bytes).as_str()) {
            continue;
        }
        if !dry_run {
            std::fs::remove_file(&path)
                .map_err(|e| format!("could not remove {}: {e}", path.display()))?;
        }
        sorted.ours.push(path.to_string_lossy().to_string());
    }
    Ok(())
}

/// Remove the named parts of a unit that stays in the set, under the same digest
/// rule as [`sort_stale_files`].
fn sort_unit_parts(
    root: &Path,
    unit_name: &str,
    digests: &[String],
    parts: &[PrunePart],
) -> Result<StaleFiles, String> {
    let mut sorted = StaleFiles {
        ours: Vec::new(),
        kept: Vec::new(),
        missing: Vec::new(),
    };
    if parts.contains(&PrunePart::Wreck) {
        let paths = vec![
            wreck_model_path(root, unit_name),
            reexport::feature_path(root, unit_name),
        ];
        sort_named_files(paths, digests, false, &mut sorted)?;
    }
    if parts.contains(&PrunePart::Weapons) {
        sort_weapon_files(root, unit_name, digests, false, &mut sorted)?;
    }
    Ok(sorted)
}

/// Every `weapons/coilbox_<unit>_*.lua` in the folder, sorted by name. A prefix
/// match only, so the caller must check ownership before removing anything.
fn stale_weapon_candidates(root: &Path, unit_name: &str) -> Vec<PathBuf> {
    let prefix = format!("coilbox_{unit_name}_");
    let Ok(entries) = std::fs::read_dir(root.join("weapons")) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".lua"))
        })
        .collect();
    found.sort();
    found
}

/// What placing a build picture did.
#[derive(Debug, PartialEq)]
enum PicturePlacement {
    Written(PathBuf),
    /// A file was there that the builder did not write, so it was left alone.
    Kept(PathBuf),
}

/// Write `unitpics/<unit>.png`, unless the file there is not the builder's.
///
/// The engine looks for that name when a definition sets no `buildpic`
/// (`CUnitDrawerData::SetUnitDefImage`), and a game maker may paint a better
/// one. So a file already there is replaced only when it hashes to `known`, the
/// digest the receipt recorded when the builder last wrote it. With no digest, or
/// a different one, the picture is theirs.
fn place_picture(
    root: &Path,
    unit_name: &str,
    bytes: &[u8],
    known: Option<&str>,
) -> Result<PicturePlacement, String> {
    let folder = root.join("unitpics");
    let target = folder.join(format!("{unit_name}.png"));
    if target.exists() {
        let ours = match (known, std::fs::read(&target)) {
            (Some(known), Ok(on_disk)) => hex_digest(&on_disk) == known,
            _ => false,
        };
        if !ours {
            return Ok(PicturePlacement::Kept(target));
        }
    }
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("could not create {}: {e}", folder.display()))?;
    std::fs::write(&target, bytes)
        .map_err(|e| format!("could not write {}: {e}", target.display()))?;
    Ok(PicturePlacement::Written(target))
}

/// `lego_picture_save` stores the build picture the game maker took, beside the
/// thumbnails, until an export writes it into a game.
#[tauri::command]
async fn lego_picture_save<R: Runtime>(app: AppHandle<R>, id: String, png: Vec<u8>) -> CliResult {
    if !valid_id(&id) {
        return CliResult::err(format!("invalid id: {id}"));
    }
    if !png.starts_with(PNG_MAGIC) {
        return CliResult::err("build picture is not a PNG".to_string());
    }
    let dir = match lego_dir(&app) {
        Ok(d) => d.join("pictures"),
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return CliResult::err(format!("could not create the build picture folder: {e}"));
    }
    match std::fs::write(dir.join(format!("{id}.png")), png) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(format!("could not save the build picture: {e}")),
    }
}

/// `lego_export_picture` writes the stored build picture into a game folder
/// under the write once rule in [`place_picture`].
///
/// `written` is the digest the receipt holds for that path, if any.
#[tauri::command]
async fn lego_export_picture<R: Runtime>(
    app: AppHandle<R>,
    dir: String,
    unit_name: String,
    id: String,
    written: Option<String>,
) -> CliResult {
    if !valid_unit_name(&unit_name) {
        return CliResult::err(format!(
            "invalid unit name: {unit_name}. Lower case letters, digits and underscores only."
        ));
    }
    if !valid_id(&id) {
        return CliResult::err(format!("invalid id: {id}"));
    }
    let root = PathBuf::from(&dir);
    if !root.is_absolute() || !root.is_dir() {
        return CliResult::err(format!("not a folder: {dir}"));
    }
    let source = match lego_dir(&app) {
        Ok(d) => d.join("pictures").join(format!("{id}.png")),
        Err(e) => return CliResult::err(e),
    };
    let bytes = match std::fs::read(&source) {
        Ok(bytes) => bytes,
        Err(e) => return CliResult::err(format!("could not read the build picture: {e}")),
    };
    match place_picture(&root, &unit_name, &bytes, written.as_deref()) {
        Ok(PicturePlacement::Written(path)) => CliResult::ok(json!({
            "path": path.to_string_lossy(),
            "kept": false,
            "owned": [owned_file(&path, &bytes)],
        })),
        Ok(PicturePlacement::Kept(path)) => CliResult::ok(json!({
            "path": path.to_string_lossy(),
            "kept": true,
            "owned": [],
        })),
        Err(e) => CliResult::err(e),
    }
}

/// What a game's `unitpics` folder already holds.
struct PictureSurvey {
    /// Width, height and count for each size of PNG, most common first.
    png_sizes: Vec<(u32, u32, usize)>,
    /// Extension and count for every other file, such as `dds`.
    other_formats: Vec<(String, usize)>,
}

/// Count the pictures in `<root>/unitpics` by size and format, so the builder
/// can say when a game's pictures are not the kind it writes. A PNG's size is
/// read off its header without decoding it.
fn survey_unitpics(root: &Path) -> PictureSurvey {
    let mut sizes: HashMap<(u32, u32), usize> = HashMap::new();
    let mut formats: HashMap<String, usize> = HashMap::new();
    if let Ok(entries) = std::fs::read_dir(root.join("unitpics")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let extension = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if extension == "png" {
                if let Some(size) = png_size(&path) {
                    *sizes.entry(size).or_default() += 1;
                }
            } else if !extension.is_empty() {
                *formats.entry(extension).or_default() += 1;
            }
        }
    }
    let mut png_sizes: Vec<(u32, u32, usize)> =
        sizes.into_iter().map(|((w, h), n)| (w, h, n)).collect();
    png_sizes.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(&b.0)).then(a.1.cmp(&b.1)));
    let mut other_formats: Vec<(String, usize)> = formats.into_iter().collect();
    other_formats.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    PictureSurvey {
        png_sizes,
        other_formats,
    }
}

/// The width and height in a PNG's header, or `None` if it is not one.
fn png_size(path: &Path) -> Option<(u32, u32)> {
    use std::io::Read;
    let mut header = [0u8; 24];
    std::fs::File::open(path)
        .ok()?
        .read_exact(&mut header)
        .ok()?;
    if !header.starts_with(PNG_MAGIC) {
        return None;
    }
    let width = u32::from_be_bytes(header[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(header[20..24].try_into().ok()?);
    Some((width, height))
}

/// `lego_picture_survey` reports what a game's `unitpics` folder holds.
#[tauri::command]
async fn lego_picture_survey(dir: String) -> CliResult {
    let root = PathBuf::from(&dir);
    if !root.is_absolute() || !root.is_dir() {
        return CliResult::err(format!("not a folder: {dir}"));
    }
    let survey = survey_unitpics(&root);
    CliResult::ok(json!({
        "pngSizes": survey
            .png_sizes
            .iter()
            .map(|(width, height, count)| json!({ "width": width, "height": height, "count": count }))
            .collect::<Vec<_>>(),
        "otherFormats": survey
            .other_formats
            .iter()
            .map(|(extension, count)| json!({ "extension": extension, "count": count }))
            .collect::<Vec<_>>(),
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
            // Named on the receipt for the same reason the `.s3o` is: it is
            // keyed on the unit name, so a rename leaves it behind (#2680).
            "owned": [owned_file(&target, &bytes)],
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
    if let Err(e) = std::fs::write(&obj_path, &obj) {
        return CliResult::err(format!("could not write {}: {e}", obj_path.display()));
    }
    let mtl_path = blender.join(format!("{unit_name}.mtl"));
    if let Err(e) = std::fs::write(&mtl_path, &mtl) {
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
        // Both are keyed on the unit name, so both are left behind by a rename
        // and both belong on the receipt (issue #2680).
        "owned": [
            owned_file(&obj_path, obj.as_bytes()),
            owned_file(&mtl_path, mtl.as_bytes()),
        ],
    }))
}

/// The scratch game's generated files, by the path each has to sit at for the
/// engine to find it. Fixed here rather than passed in, so the frontend supplies
/// contents only and never a path.
const SCRATCH_MODINFO: &[&str] = &["modinfo.lua"];
const SCRATCH_SIDEDATA: &[&str] = &["gamedata", "sidedata.lua"];
const SCRATCH_GADGET: &[&str] = &["LuaRules", "Gadgets", "coilbox_start_unit.lua"];
const SCRATCH_UNIT_SCRIPT_GADGET: &[&str] = &["LuaRules", "Gadgets", "coilbox_unit_script.lua"];
/// The two files the engine starts LuaRules from. The scratch game writes one
/// only for a base game that lacks it (issue #4475).
const SCRATCH_LUARULES_ENTRIES: [&[&str]; 2] =
    [&["LuaRules", "main.lua"], &["LuaRules", "draw.lua"]];
/// The menu entries that put the units on base game builders' build lists,
/// read by the engine's base content `download_builds.lua` (issue #4515).
const SCRATCH_BUILD_LIST: &[&str] = &["download", "coilbox_build_list.tdf"];

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

/// Write the scratch game's generated files into `dir`: the `modinfo.lua` and
/// the unit script gadget, then the start unit's side data and gadget, and the
/// sandbox's files before them when there is a sandbox. The sandbox goes first
/// because installing the runtime removes the start unit gadget (see
/// [`sandbox::write`]).
///
/// `start_unit` holds the side data and the gadget that spawns a start unit,
/// which only a caller launching a single unit wants. `lua_rules` holds
/// `LuaRules/main.lua` and `LuaRules/draw.lua`, each given only when the base
/// game lacks it. `build_list` holds the build list menu entries, given only
/// when a unit names a builder. A file not given is removed in every case,
/// because the folder is reused and a copy left from an earlier launch would
/// hide this game's own, spawn a unit nobody asked for, or list a unit that has
/// since left.
fn write_scratch_game(
    dir: &Path,
    [modinfo, unit_script_gadget]: [&str; 2],
    start_unit: [Option<&str>; 2],
    lua_rules: [Option<&str>; 2],
    build_list: Option<&str>,
    sandbox: Option<&sandbox::Sandbox>,
    runtime_src: Option<&Path>,
) -> Result<(), String> {
    if let Some(sandbox) = sandbox {
        sandbox::write(dir, sandbox, runtime_src)?;
        // Read back through the sandbox the runtime gadget's own `VFS.Include`
        // uses, so a runtime copy that half succeeded is a refusal here and
        // not a game that starts with no mission and says nothing.
        if sandbox.ship_runtime {
            tauri_plugin_coilbox_scenario::runtime::read_marker(dir)?;
        }
    }
    write_scratch_file(dir, SCRATCH_MODINFO, modinfo)?;
    write_scratch_file(dir, SCRATCH_UNIT_SCRIPT_GADGET, unit_script_gadget)?;
    for (relative, contents) in [SCRATCH_SIDEDATA, SCRATCH_GADGET]
        .into_iter()
        .zip(start_unit)
        .chain(SCRATCH_LUARULES_ENTRIES.into_iter().zip(lua_rules))
        .chain(std::iter::once((SCRATCH_BUILD_LIST, build_list)))
    {
        match contents {
            Some(contents) => write_scratch_file(dir, relative, contents)?,
            None => remove_scratch_file(dir, relative)?,
        }
    }
    Ok(())
}

/// Remove one generated file from the scratch game, if it is there.
fn remove_scratch_file(dir: &Path, relative: &[&str]) -> Result<(), String> {
    let target = relative
        .iter()
        .fold(dir.to_path_buf(), |path, part| path.join(part));
    match std::fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("could not remove {}: {e}", target.display())),
    }
}

/// `lego_scratch_game` prepares the `.sdd` a unit is tested in.
///
/// It writes the files the frontend generated into
/// `<data_dir>/games/<folder>`: the `modinfo.lua` naming the base game, the
/// gadget that turns Lua unit scripts on where the base game has not, and,
/// only when given, the `gamedata/sidedata.lua` declaring a built unit as a
/// side's start unit and the gadget that spawns it. `lua_rules_main` and `lua_rules_draw` are
/// `LuaRules/main.lua` and `LuaRules/draw.lua`, given only for a base game that
/// lacks them and removed otherwise (issue #4475). `build_list` is the menu
/// entries that put the units on base game builders' build lists, removed when
/// not given (issue #4515). `sandbox` adds what "Play with this unit"
/// needs on top, see [`sandbox`]. The unit itself follows through
/// `lego_export`, which treats the result as any other game folder. Nothing
/// else in the content root is touched, so removing that one folder undoes the
/// lot.
// Each argument is one generated file in the IPC payload, so grouping them would
// only move the width into a struct the frontend then has to nest.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn lego_scratch_game<R: Runtime>(
    app: AppHandle<R>,
    data_dir: String,
    folder: String,
    modinfo: String,
    sidedata: Option<String>,
    gadget: Option<String>,
    unit_script_gadget: String,
    lua_rules_main: Option<String>,
    lua_rules_draw: Option<String>,
    sandbox: Option<sandbox::Sandbox>,
    build_list: Option<String>,
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

    let runtime_src = match &sandbox {
        Some(sandbox) if sandbox.ship_runtime => {
            tauri_plugin_coilbox_scenario::runtime::runtime_dir(&app)
        }
        _ => None,
    };
    if let Err(e) = write_scratch_game(
        &dir,
        [&modinfo, &unit_script_gadget],
        [sidedata.as_deref(), gadget.as_deref()],
        [lua_rules_main.as_deref(), lua_rules_draw.as_deref()],
        build_list.as_deref(),
        sandbox.as_ref(),
        runtime_src.as_deref(),
    ) {
        return CliResult::err(e);
    }
    CliResult::ok(json!({ "dir": dir.to_string_lossy() }))
}

/// A part of a unit that can go while the unit stays (issue #4528).
#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
enum PrunePart {
    /// Its `weapons/coilbox_<unit>_*.lua` files.
    Weapons,
    /// Its wreck model and feature file.
    Wreck,
}

/// One unit in a scratch game's set, with the digests of the files the export
/// that wrote it recorded. With no `only`, the unit left the set and all of its
/// files go. With `only`, it stays and just those parts go.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PruneUnit {
    unit_name: String,
    digests: Vec<String>,
    #[serde(default)]
    only: Option<Vec<PrunePart>>,
}

/// What pruning a scratch game removed, and what it left because it could not
/// show the file was its own.
#[derive(Debug, PartialEq)]
struct Pruned {
    removed: Vec<String>,
    kept: Vec<String>,
}

/// Remove the files of units that left a scratch game's set (issue #4521).
///
/// Only inside `<data_dir>/games/<folder>` with a folder that passes
/// [`valid_scratch_folder`], and only what coilbox wrote. A unit's files go when
/// they still hash to a digest its export recorded, by [`sort_stale_files`].
/// A texture has no digest, because it is copied from a pack or the store, so
/// the caller names it, and it goes only as a plain file name directly under
/// `unittextures/`. Every name is checked before the first removal, so a bad one
/// removes nothing.
fn prune_scratch_game(
    data_dir: &Path,
    folder: &str,
    units: &[PruneUnit],
    textures: &[String],
) -> Result<Pruned, String> {
    if !valid_scratch_folder(folder) {
        return Err(format!("not a scratch game folder: {folder}"));
    }
    let game = data_dir.join("games").join(folder);
    if !game.is_dir() || !is_scratch_dir(&game) {
        return Err(format!("not a scratch game: {}", game.display()));
    }
    if let Some(bad) = units.iter().find(|u| !valid_unit_name(&u.unit_name)) {
        return Err(format!("invalid unit name: {}", bad.unit_name));
    }
    let mut texture_paths = Vec::new();
    for name in textures {
        texture_paths.push(stored_texture_target(&game.join("unittextures"), name)?);
    }

    let mut pruned = Pruned {
        removed: Vec::new(),
        kept: Vec::new(),
    };
    for unit in units {
        let sorted = match &unit.only {
            None => sort_stale_files(&game, &unit.unit_name, &unit.digests, false)?,
            Some(parts) => sort_unit_parts(&game, &unit.unit_name, &unit.digests, parts)?,
        };
        pruned.removed.extend(sorted.ours);
        pruned.kept.extend(sorted.kept);
    }
    for path in texture_paths {
        // `symlink_metadata` so a link is never followed out of the folder.
        let is_file = std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_file());
        if !is_file {
            continue;
        }
        std::fs::remove_file(&path)
            .map_err(|e| format!("could not remove {}: {e}", path.display()))?;
        pruned.removed.push(path.to_string_lossy().to_string());
    }
    Ok(pruned)
}

/// `lego_scratch_prune` removes what units that left a scratch game's set wrote
/// into it. See [`prune_scratch_game`] for what it will and will not touch.
#[tauri::command]
async fn lego_scratch_prune(
    data_dir: String,
    folder: String,
    units: Vec<PruneUnit>,
    textures: Vec<String>,
) -> CliResult {
    let root = PathBuf::from(&data_dir);
    if !root.is_absolute() || !root.is_dir() {
        return CliResult::err(format!("not a content root: {data_dir}"));
    }
    match prune_scratch_game(&root, &folder, &units, &textures) {
        Ok(pruned) => CliResult::ok(json!({ "removed": pruned.removed, "kept": pruned.kept })),
        Err(e) => CliResult::err(e),
    }
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
// Each argument is one field of the IPC payload, so grouping them would only
// move the width into a struct the frontend then has to nest.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn lego_run_script(
    script: String,
    unit_name: String,
    pieces: Vec<String>,
    events: Vec<unitscript::ScriptEvent>,
    frames: u32,
    unit_def: Option<serde_json::Value>,
    includes: Option<HashMap<String, String>>,
    rest: Option<Vec<unitscript::Rest>>,
    values: Option<HashMap<i32, i32>>,
) -> CliResult {
    let timeline = unitscript::run(
        &script,
        &format!("{unit_name}.lua"),
        &unitscript::Unit {
            def: unit_def.as_ref(),
            includes: &includes.unwrap_or_default(),
            rest: &rest.unwrap_or_default(),
            ..unitscript::Unit::new(&pieces)
        },
        &events,
        frames,
        &values.unwrap_or_default(),
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
    unit_def: Option<serde_json::Value>,
    includes: Option<HashMap<String, String>>,
    rest: Option<Vec<unitscript::Rest>>,
) -> CliResult {
    let probes = unitscript::probe(
        &script,
        &format!("{unit_name}.lua"),
        &unitscript::Unit {
            def: unit_def.as_ref(),
            includes: &includes.unwrap_or_default(),
            rest: &rest.unwrap_or_default(),
            ..unitscript::Unit::new(&pieces)
        },
        &callins,
    );
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
            lego_save_s3o,
            lego_save_glb,
            lego_import_s3o,
            lego_geometry_save,
            lego_read_3do,
            lego_import_3do,
            lego_import_glb,
            lego_read_dae,
            lego_import_dae,
            lego_texture_import,
            lego_texture_png,
            lego_atlas_png,
            lego_bitmap_png,
            lego_texture_prune,
            lego_texture_compose_colour,
            lego_texture_compose_shading,
            lego_texture_sizes,
            lego_texture_sheet,
            lego_export,
            lego_game_language,
            lego_export_glb,
            lego_export_obj,
            lego_export_stale,
            lego_picture_save,
            lego_export_picture,
            lego_picture_survey,
            lego_scratch_game,
            lego_scratch_prune,
            lego_run_script,
            lego_probe_script,
            lego_write_text_file,
            lego_read_text_file
        ])
        .build()
}

#[cfg(test)]
mod team_mask_tests {
    use super::set_team_mask;

    fn tile(alpha: u8) -> image::RgbaImage {
        image::RgbaImage::from_pixel(2, 2, image::Rgba([10, 20, 30, alpha]))
    }

    /// The direction that is easy to get backwards, and was: both engine model
    /// shaders read `mix(texColor1.rgb, teamCol.rgb, texColor1.a)`, so alpha is
    /// how much of the player's colour to use. A `.3do` tile is opaque, and
    /// copying its own alpha through paints the whole unit flat in the player's
    /// colour with no texture left at all.
    #[test]
    fn leaves_an_ordinary_tile_out_of_the_team_colour() {
        let mut image = tile(255);

        set_team_mask(&mut image, false);

        assert_eq!(image.get_pixel(0, 0).0, [10, 20, 30, 0]);
    }

    /// A region the engine paints in the player's colour asks for all of it.
    #[test]
    fn asks_for_the_players_colour_over_a_team_region() {
        let mut image = tile(255);

        set_team_mask(&mut image, true);

        assert_eq!(image.get_pixel(0, 0).0[3], 255);
    }
}

#[cfg(test)]
mod find_reusable_sheet_tests {
    use super::*;

    fn tile(name: &str, side: u32) -> atlas3do::Tile {
        atlas3do::Tile {
            name: name.to_string(),
            image: image::RgbaImage::from_pixel(side, side, image::Rgba([9, 9, 9, 255])),
        }
    }

    /// Lays out `<dir>/objects3d/arm/armcom.3do` beside `<dir>/unittextures/3do/`
    /// holding a real packed sheet and its record, the same shape a batch
    /// conversion (issue #2573) leaves. Returns the model path and the packed
    /// image dimensions.
    fn game_with_a_batch_sheet(dir: &Path, sheet_tiles: &[atlas3do::Tile]) -> (PathBuf, u32) {
        std::fs::create_dir_all(dir.join("objects3d/arm")).expect("dirs");
        let sheets = dir.join("unittextures/3do");
        std::fs::create_dir_all(&sheets).expect("dirs");

        let packed = atlas3do::pack(sheet_tiles).expect("pack");
        let side = packed.image.width();
        let png = coilbox_texture::encode_png(&packed.image).expect("encode");
        std::fs::write(sheets.join("objects3d-arm.png"), &png).expect("write png");
        let record = atlas3do::Sheet::of(&packed, "objects3d-arm.png")
            .write()
            .expect("write record");
        std::fs::write(sheets.join("objects3d-arm.json"), &record).expect("write json");

        (dir.join("objects3d/arm/armcom.3do"), side)
    }

    /// The specimen this exists for: a game batch converted with #2573, then
    /// one of its units opened here, gets the same sheet the rest of the game
    /// was painted with rather than a second one of its own.
    #[test]
    fn reuses_a_sheet_that_covers_every_tile_the_model_holds() {
        let dir = tempfile::tempdir().expect("temp");
        let (model, side) = game_with_a_batch_sheet(
            dir.path(),
            &[tile("arm2", 32), tile(atlas3do::PALETTE_TILE, 8)],
        );

        let (rects, image, name) =
            find_reusable_sheet(&model, &["arm2", atlas3do::PALETTE_TILE]).expect("reused");

        assert!(rects.contains_key("arm2"));
        assert_eq!(image.width(), side);
        assert_eq!(name, "objects3d-arm.png");
    }

    /// The batch caps a sheet at 2048 and can leave a tile off it (issue
    /// #2623's second question). A model asking for one the record does not
    /// have is not this model's sheet, and nothing here decides that by
    /// guessing: it is exactly `Sheet::covers`.
    #[test]
    fn does_not_reuse_a_sheet_missing_a_tile_the_model_needs() {
        let dir = tempfile::tempdir().expect("temp");
        let (model, _side) = game_with_a_batch_sheet(
            dir.path(),
            &[tile("arm2", 32), tile(atlas3do::PALETTE_TILE, 8)],
        );

        let reused = find_reusable_sheet(&model, &["arm2", "arm3", atlas3do::PALETTE_TILE]);

        assert!(reused.is_none());
    }

    /// The third question: a record surviving a picture that did not (or one
    /// repacked to a different size without rewriting its record) is stale,
    /// and importing against it would map the model onto coordinates that no
    /// longer point at what they used to. Detected here by the one thing a
    /// record and its picture both say independently: the sheet's side.
    #[test]
    fn does_not_reuse_a_record_whose_picture_no_longer_matches_its_own_size() {
        let dir = tempfile::tempdir().expect("temp");
        let (model, _side) = game_with_a_batch_sheet(
            dir.path(),
            &[tile("arm2", 32), tile(atlas3do::PALETTE_TILE, 8)],
        );
        // Something replaced the picture with a different size after the
        // record was written, without touching the record.
        let smaller = image::RgbaImage::from_pixel(4, 4, image::Rgba([1, 2, 3, 255]));
        let png = coilbox_texture::encode_png(&smaller).expect("encode");
        std::fs::write(dir.path().join("unittextures/3do/objects3d-arm.png"), &png)
            .expect("overwrite");

        let reused = find_reusable_sheet(&model, &["arm2", atlas3do::PALETTE_TILE]);

        assert!(reused.is_none());
    }

    /// A record whose picture has simply gone is the same problem as one that
    /// changed size: nothing here can be trusted to still describe a real
    /// file.
    #[test]
    fn does_not_reuse_a_record_whose_picture_is_missing() {
        let dir = tempfile::tempdir().expect("temp");
        let (model, _side) = game_with_a_batch_sheet(
            dir.path(),
            &[tile("arm2", 32), tile(atlas3do::PALETTE_TILE, 8)],
        );
        std::fs::remove_file(dir.path().join("unittextures/3do/objects3d-arm.png"))
            .expect("remove");

        let reused = find_reusable_sheet(&model, &["arm2", atlas3do::PALETTE_TILE]);

        assert!(reused.is_none());
    }

    /// No batch ever ran here, which is every model today: nothing to find,
    /// and the caller's existing fallback (pack a sheet of its own) is
    /// unchanged.
    #[test]
    fn finds_nothing_to_reuse_when_no_batch_ever_ran() {
        let dir = tempfile::tempdir().expect("temp");
        std::fs::create_dir_all(dir.path().join("objects3d")).expect("dirs");
        let model = dir.path().join("objects3d/armcom.3do");

        assert!(find_reusable_sheet(&model, &["arm2"]).is_none());
    }
}

#[cfg(test)]
mod glb_picture {
    use super::*;

    fn png(alpha: u8) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(4, 4, image::Rgba([10, 20, 30, alpha]));
        coilbox_texture::encode_png(&img).expect("encode")
    }

    fn stored(dir: &Path, bytes: Vec<u8>) -> (image::RgbaImage, bool) {
        let (value, has_mask) = store_glb_image(
            dir,
            &glb::Image {
                bytes,
                name: "skin.png".into(),
            },
        )
        .expect("store");
        let key = value["key"].as_str().expect("key").to_string();
        let written = std::fs::read(dir.join(&key)).expect("read back");
        (
            coilbox_texture::decode("png", &written).expect("decode"),
            has_mask,
        )
    }

    /// The defect this rule exists to stop, and it is invisible here and
    /// glaring in the game. An `.s3o` reads the first texture's alpha as the
    /// team-colour mask, so a fully opaque picture means every pixel of the
    /// unit is painted in the player's colour and the texture stops being
    /// drawn. Coilbox's own `.glb` export writes an RGB PNG with no alpha at
    /// all, so this is what a round trip hands back every time.
    #[test]
    fn writes_an_opaque_picture_to_no_team_colour_at_all() {
        let dir = tempfile::tempdir().expect("temp");
        let (image, has_mask) = stored(dir.path(), png(255));

        assert!(!has_mask);
        assert!(image.pixels().all(|pixel| pixel.0[3] == 0));
        // The colours are its own, untouched.
        assert_eq!(image.get_pixel(0, 0).0[0..3], [10, 20, 30]);
    }

    /// A picture that does carry varying alpha was authored that way, and
    /// zeroing it would be throwing away the mask rather than not inventing
    /// one.
    #[test]
    fn keeps_a_picture_that_carries_a_real_mask() {
        let dir = tempfile::tempdir().expect("temp");
        let mut img = image::RgbaImage::from_pixel(4, 4, image::Rgba([10, 20, 30, 0]));
        img.put_pixel(1, 1, image::Rgba([9, 9, 9, 255]));
        let (image, has_mask) = stored(dir.path(), coilbox_texture::encode_png(&img).expect("png"));

        assert!(has_mask);
        assert_eq!(image.get_pixel(1, 1).0[3], 255);
        assert_eq!(image.get_pixel(0, 0).0[3], 0);
    }

    /// glTF allows PNG and JPEG. Anything else is a file this cannot open, and
    /// saying so beats an untextured unit with no explanation.
    #[test]
    fn refuses_a_picture_in_neither_format_gltf_allows() {
        let dir = tempfile::tempdir().expect("temp");
        let problem = store_glb_image(
            dir.path(),
            &glb::Image {
                bytes: b"not a picture".to_vec(),
                name: "skin.png".into(),
            },
        )
        .expect_err("refused");

        assert!(problem.contains("PNG and JPEG"), "got: {problem}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_texture_folder_must_be_an_absolute_folder_that_exists() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().to_string_lossy().to_string();
        assert_eq!(
            texture_source_dir(Some(&path)).expect("a folder"),
            Some(dir.path().to_path_buf())
        );
        assert_eq!(texture_source_dir(None).expect("none"), None);
        assert!(texture_source_dir(Some("relative/textures")).is_err());
        let missing = dir.path().join("gone").to_string_lossy().to_string();
        assert!(texture_source_dir(Some(&missing)).is_err());
    }

    #[test]
    fn a_text_file_written_reads_back_and_makes_its_folder() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("a/b/module.json");
        let path = file.to_string_lossy().to_string();
        write_text_at(&path, "{\"x\":1}").expect("write");
        assert_eq!(read_text_at(&path).expect("read"), "{\"x\":1}");
    }

    #[test]
    fn text_files_refuse_a_relative_path_and_say_when_the_file_is_missing() {
        assert!(write_text_at("rel.json", "x")
            .unwrap_err()
            .contains("absolute"));
        assert!(read_text_at("rel.json").unwrap_err().contains("absolute"));
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("nope.json").to_string_lossy().to_string();
        assert!(read_text_at(&missing)
            .unwrap_err()
            .contains("could not read"));
    }

    /// The polyfill is one file every sharing unit in the game uses, so it is
    /// written once and left alone like the script, refreshed in the scratch
    /// game, and never written for a script that shares nothing.
    #[test]
    fn writes_the_cob_vars_polyfill_only_beside_a_script_that_shares_values() {
        let dir = tempfile::tempdir().expect("tempdir");
        let sharing = "local cobAllied = { allied = true }\n";
        let target = dir.path().join("lualibs/cob_vars.lua");

        assert_eq!(
            write_cob_vars(dir.path(), false, Some("-- shares nothing")).expect("write"),
            (None, false)
        );
        assert_eq!(
            write_cob_vars(dir.path(), false, None).expect("write"),
            (None, false)
        );
        assert!(!target.exists());

        let (written, kept) = write_cob_vars(dir.path(), false, Some(sharing)).expect("write");
        assert_eq!(written, Some(target.to_string_lossy().to_string()));
        assert!(!kept);
        assert_eq!(
            std::fs::read_to_string(&target).expect("read"),
            coilbox_bos2lua::COB_VARS_POLYFILL
        );

        std::fs::write(&target, "-- the game's own").expect("write");
        assert_eq!(
            write_cob_vars(dir.path(), false, Some(sharing)).expect("write"),
            (None, true)
        );
        assert_eq!(
            std::fs::read_to_string(&target).expect("read"),
            "-- the game's own"
        );

        let (written, kept) = write_cob_vars(dir.path(), true, Some(sharing)).expect("write");
        assert!(written.is_some() && !kept);
        assert_eq!(
            std::fs::read_to_string(&target).expect("read"),
            coilbox_bos2lua::COB_VARS_POLYFILL
        );
    }

    fn weapon_file(name: &str, contents: &str) -> WeaponFile {
        WeaponFile {
            name: name.to_string(),
            contents: contents.to_string(),
        }
    }

    /// A weapon file goes under `weapons/` only by the name the workshop gives
    /// a library weapon on this unit, so an export cannot write a game's own.
    #[test]
    fn weapon_files_go_only_under_the_units_own_coilbox_names() {
        let root = Path::new("/game.sdd");
        let ok = [weapon_file("coilbox_rover_laser_copy.lua", "")];
        assert_eq!(
            weapon_file_targets(root, "rover", &ok).expect("valid"),
            vec![root.join("weapons").join("coilbox_rover_laser_copy.lua")]
        );
        for bad in [
            "armpw_emg.lua",
            "coilbox_other_laser.lua",
            "coilbox_rover_.lua",
            "coilbox_rover_laser.txt",
            "coilbox_rover_../x.lua",
            "coilbox_rover_Laser.lua",
        ] {
            assert!(
                weapon_file_targets(root, "rover", &[weapon_file(bad, "")]).is_err(),
                "accepted {bad}"
            );
        }
    }

    /// Written every export, so a weapon changed in the workshop reaches the
    /// game, and recorded in the receipt with its digest.
    #[test]
    fn weapon_files_are_rewritten_and_owned() {
        let dir = tempfile::tempdir().expect("tempdir");
        let first = [weapon_file("coilbox_rover_laser.lua", "return { a = 1 }")];
        let targets = weapon_file_targets(dir.path(), "rover", &first).expect("valid");
        write_weapon_files(&targets, &first).expect("write");
        let second = [weapon_file("coilbox_rover_laser.lua", "return { a = 2 }")];
        let written = write_weapon_files(&targets, &second).expect("write");

        assert_eq!(
            std::fs::read_to_string(&targets[0]).expect("read"),
            "return { a = 2 }"
        );
        assert_eq!(written.len(), 1);
        assert_eq!(written[0].0, targets[0].to_string_lossy());
        assert_eq!(
            written[0].1,
            owned_file(&targets[0], "return { a = 2 }".as_bytes())
        );
    }

    fn reveal_args(target: &Path) -> Vec<std::ffi::OsString> {
        reveal_command(target)
            .get_args()
            .map(|arg| arg.to_os_string())
            .collect()
    }

    /// A file is selected in the Finder rather than opened, because opening
    /// hands it to whatever app claims its type and nothing claims an `.s3o`.
    #[cfg(target_os = "macos")]
    #[test]
    fn show_me_selects_a_file_in_the_finder_and_opens_a_folder() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("unit.s3o");
        std::fs::write(&file, b"s3o").expect("write");

        assert_eq!(
            reveal_args(&file),
            vec!["-R".into(), file.clone().into_os_string()]
        );
        assert_eq!(reveal_args(dir.path()), vec![dir.path().as_os_str()]);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn show_me_opens_the_folder_a_file_is_in_and_a_folder_itself() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("unit.s3o");
        std::fs::write(&file, b"s3o").expect("write");

        assert_eq!(reveal_args(&file), vec![dir.path().as_os_str()]);
        assert_eq!(reveal_args(dir.path()), vec![dir.path().as_os_str()]);
    }

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
    fn a_file_the_game_already_has_is_kept_unless_the_target_is_scratch_or_overwrite_is_on() {
        let dir = tempfile::tempdir().expect("tempdir");
        let existing = dir.path().join("atlas.png");
        std::fs::write(&existing, "the game's own").expect("write");
        let missing = dir.path().join("coilbox_atlas.png");

        // A real game folder with overwrite off: what is there stays, what is
        // not is written.
        assert!(keep_existing(&existing, false, false));
        assert!(!keep_existing(&missing, false, false));
        // The scratch game has nothing worth keeping, so it is always rewritten.
        assert!(!keep_existing(&existing, true, false));
        assert!(!keep_existing(&missing, true, false));
        // The drawer's "replace textures already there" checkbox does the same
        // in a real game folder, without needing the scratch exception.
        assert!(!keep_existing(&existing, false, true));
        assert!(!keep_existing(&missing, false, true));
    }

    /// Beyond All Reason's own file, trimmed to the parts anything reads. The
    /// spacing and the key order are deliberately not what coilbox writes, so a
    /// test comparing it before and after has something to catch.
    const GAME_UNITS_JSON: &str = "{\n\t\"units\": {\n\t\t\"factions\": {\"arm\": \"Armada\"},\n\t\t\"names\": {\"corcom\": \"Cortex Commander\", \"armcom\": \"Armada Commander\"},\n\t\t\"descriptions\": {\"armcom\": \"Commander\"}\n\t}\n}\n";

    fn language_game(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        for (path, body) in files {
            let target = dir.path().join(path);
            std::fs::create_dir_all(target.parent().expect("parent")).expect("mkdir");
            std::fs::write(&target, body).expect("write");
        }
        dir
    }

    fn text(name: &str, description: &str) -> UnitText {
        in_language("en", name, description)
    }

    fn in_language(code: &str, name: &str, description: &str) -> UnitText {
        UnitText {
            language: code.to_string(),
            name: name.to_string(),
            description: description.to_string(),
        }
    }

    /// The rule the whole of #2683 rests on: coilbox writes a file of its own
    /// and the game's is not opened for writing at all.
    #[test]
    fn the_games_own_language_file_survives_byte_for_byte() {
        let dir = language_game(&[("language/en/units.json", GAME_UNITS_JSON)]);
        let game = game_language_file(dir.path(), "en");
        let before = std::fs::read(&game).expect("read");

        write_unit_text(dir.path(), "skyfort", &text("Sky Fortress", "It flies")).expect("write");

        assert_eq!(before, std::fs::read(&game).expect("read"));
        assert!(coilbox_language_file(dir.path(), "en").is_file());
    }

    /// A game shipping no English file names its units in whichever locale it
    /// does ship, and the frontend's `baseLanguage` picks it. The write follows
    /// that rather than assuming English exists.
    #[test]
    fn a_name_lands_in_the_locale_it_was_sent_for() {
        let dir = language_game(&[]);
        write_unit_text(
            dir.path(),
            "skyfort",
            &in_language("ru", "Небесная", "Летает"),
        )
        .expect("write");

        assert!(coilbox_language_file(dir.path(), "ru").is_file());
        assert!(!coilbox_language_file(dir.path(), "en").exists());
    }

    /// A code arrives over the IPC boundary, so it is held to the same "a name,
    /// never a path" rule as every other caller-supplied name here.
    #[test]
    fn a_language_code_cannot_name_a_path() {
        let dir = language_game(&[]);
        let error = write_unit_text(dir.path(), "skyfort", &in_language("../..", "X", "Y"))
            .expect_err("should refuse");
        assert!(error.contains("invalid language code"), "{error}");
        assert!(valid_language_code("test_unicode"));
        assert!(!valid_language_code(""));
        assert!(!valid_language_code("en/../.."));
    }

    /// Every locale the game ships, which is what the drawer decides the home
    /// from. Coilbox's own file beside them is not read back: this answers what
    /// the game says, not what an earlier export did.
    #[test]
    fn every_locale_a_game_ships_comes_back() {
        let dir = language_game(&[
            ("language/en/units.json", GAME_UNITS_JSON),
            (
                "language/de/units.json",
                r#"{"units":{"names":{"armcom":"Kommandant"}}}"#,
            ),
            (
                "language/en/coilbox.json",
                r#"{"units":{"names":{"x":"X"}}}"#,
            ),
        ]);
        let texts = read_game_languages(dir.path()).expect("read");
        assert_eq!(texts.len(), 2);
        assert!(texts.contains_key("en"));
        assert!(texts.contains_key("de"));
        assert_eq!(
            texts["en"]["names"]["armcom"].as_str(),
            Some("Armada Commander")
        );
    }

    #[test]
    fn a_folder_with_no_language_folder_ships_no_locales() {
        let dir = language_game(&[]);
        assert!(read_game_languages(dir.path()).expect("read").is_empty());
    }

    #[test]
    fn a_unit_lands_under_the_key_the_game_looks_it_up_by() {
        let dir = language_game(&[]);
        write_unit_text(dir.path(), "skyfort", &text("Sky Fortress", "It flies")).expect("write");

        let written = read_language_file(&coilbox_language_file(dir.path(), "en"))
            .expect("read")
            .expect("present");
        assert_eq!(
            written.names.get("skyfort").map(String::as_str),
            Some("Sky Fortress")
        );
        assert_eq!(
            written.descriptions.get("skyfort").map(String::as_str),
            Some("It flies")
        );
    }

    /// One game folder takes exports from as many projects as you like, so a
    /// second unit adds a key rather than replacing the file.
    #[test]
    fn a_second_unit_keeps_the_first_ones_name() {
        let dir = language_game(&[]);
        write_unit_text(dir.path(), "skyfort", &text("Sky Fortress", "It flies")).expect("first");
        write_unit_text(dir.path(), "digger", &text("Digger", "It digs")).expect("second");

        let written = read_language_file(&coilbox_language_file(dir.path(), "en"))
            .expect("read")
            .expect("present");
        assert_eq!(written.names.len(), 2);
        assert_eq!(
            written.names.get("skyfort").map(String::as_str),
            Some("Sky Fortress")
        );
        assert_eq!(
            written.names.get("digger").map(String::as_str),
            Some("Digger")
        );
    }

    /// Re-exporting the same unit under a new project name has to reach the
    /// game, so this one file is rewritten rather than kept the way the unit
    /// definition beside it is.
    #[test]
    fn re_exporting_replaces_that_units_own_name() {
        let dir = language_game(&[]);
        write_unit_text(dir.path(), "skyfort", &text("Sky Fortress", "It flies")).expect("first");
        write_unit_text(dir.path(), "skyfort", &text("Sky Fort", "Renamed")).expect("second");

        let written = read_language_file(&coilbox_language_file(dir.path(), "en"))
            .expect("read")
            .expect("present");
        assert_eq!(
            written.names.get("skyfort").map(String::as_str),
            Some("Sky Fort")
        );
        assert_eq!(written.names.len(), 1);
    }

    /// Report rather than silently modify. The file is coilbox's, but something
    /// has happened to it, and overwriting would throw that something away.
    #[test]
    fn a_language_file_that_will_not_parse_stops_the_write() {
        let dir = language_game(&[("language/en/coilbox.json", "{ this is not json")]);
        let error = write_unit_text(dir.path(), "skyfort", &text("Sky Fortress", "It flies"))
            .expect_err("should refuse");
        assert!(error.contains("will not parse"), "{error}");
        assert_eq!(
            std::fs::read_to_string(coilbox_language_file(dir.path(), "en")).expect("read"),
            "{ this is not json"
        );
    }

    /// A game with no such file is a game that names its units in their
    /// definitions, which is most of them, and gets no language write at all.
    #[test]
    fn a_folder_with_no_language_file_reads_as_absent() {
        let dir = language_game(&[]);
        assert!(read_language_file(&game_language_file(dir.path(), "en"))
            .expect("read")
            .is_none());
    }

    #[test]
    fn a_games_names_come_back_lowercased_and_blanks_are_dropped() {
        let dir = language_game(&[(
            "language/en/units.json",
            r#"{"units":{"names":{"ARMCOM":"Armada Commander","corcom":"   "}}}"#,
        )]);
        let tables = read_language_file(&game_language_file(dir.path(), "en"))
            .expect("read")
            .expect("present");
        assert_eq!(
            tables.names.get("armcom").map(String::as_str),
            Some("Armada Commander")
        );
        assert!(!tables.names.contains_key("corcom"));
    }

    /// Write every file an export leaves under `unit_name`, and answer with the
    /// digests of the ones coilbox would have written.
    fn exported_unit(root: &Path, unit_name: &str) -> Vec<String> {
        let mut digests = Vec::new();
        for path in export_paths(root, unit_name) {
            std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
            let contents = format!("{unit_name} at {}", path.display());
            std::fs::write(&path, &contents).expect("write");
            digests.push(hex_digest(contents.as_bytes()));
        }
        digests
    }

    #[test]
    fn a_rename_leaves_twelve_files_behind_and_the_digests_find_them() {
        let dir = tempfile::tempdir().expect("tempdir");
        let digests = exported_unit(dir.path(), "skyfort");

        let dry = sort_stale_files(dir.path(), "skyfort", &digests, true).expect("dry run");
        assert_eq!(dry.ours.len(), 12);
        assert!(dry.kept.is_empty());
        assert!(dry.missing.is_empty());
        // A dry run removes none of them.
        assert!(dir.path().join("units/skyfort.lua").is_file());

        let done = sort_stale_files(dir.path(), "skyfort", &digests, false).expect("removal");
        assert_eq!(done.ours.len(), 12);
        assert!(!dir.path().join("unitpics/skyfort.png").exists());
        assert!(!dir
            .path()
            .join("unittextures/coilbox_skyfort_sheet.png")
            .exists());
        assert!(!dir
            .path()
            .join("objects3d/coilbox/skyfort_dead.s3o")
            .exists());
        assert!(!dir
            .path()
            .join("features/coilbox/skyfort_dead.lua")
            .exists());
        assert!(!dir.path().join("units/skyfort.lua").exists());
        assert!(!dir.path().join("objects3d/skyfort.s3o").exists());
        assert!(!dir
            .path()
            .join("scripts/coilbox/skyfort_collision.lua")
            .exists());
        assert!(!dir.path().join("blender/skyfort.mtl").exists());
    }

    /// A scratch game under a content root, as `lego_scratch_game` lays it out.
    fn scratch_root(folder: &str) -> (tempfile::TempDir, PathBuf) {
        let data = tempfile::tempdir().expect("tempdir");
        let game = data.path().join("games").join(folder);
        std::fs::create_dir_all(&game).expect("mkdir");
        (data, game)
    }

    fn prune_unit(unit_name: &str, digests: Vec<String>) -> PruneUnit {
        PruneUnit {
            unit_name: unit_name.to_string(),
            digests,
            only: None,
        }
    }

    fn prune_parts(unit_name: &str, digests: Vec<String>, only: Vec<PrunePart>) -> PruneUnit {
        PruneUnit {
            unit_name: unit_name.to_string(),
            digests,
            only: Some(only),
        }
    }

    /// A unit's weapon file and wreck, as an export leaves them, and the digests.
    fn armed_unit(game: &Path, unit_name: &str, keys: &[&str]) -> Vec<String> {
        let mut digests = exported_unit(game, unit_name);
        std::fs::create_dir_all(game.join("weapons")).expect("mkdir");
        for key in keys {
            let contents = format!("{unit_name} {key}");
            std::fs::write(
                game.join(format!("weapons/coilbox_{unit_name}_{key}.lua")),
                &contents,
            )
            .expect("weapon");
            digests.push(hex_digest(contents.as_bytes()));
        }
        digests
    }

    // Issue #4521. A unit taken out of a mutator's set must leave nothing behind.
    #[test]
    fn pruning_removes_a_dropped_units_files_and_none_of_the_kept_units() {
        let (data, game) = scratch_root("coilbox-lego-campaign.sdd");
        let tank = exported_unit(&game, "tank");
        exported_unit(&game, "skyfort");
        std::fs::create_dir_all(game.join("weapons")).expect("mkdir");
        let weapon = game.join("weapons/coilbox_tank_gun.lua");
        std::fs::write(&weapon, "return {}").expect("weapon");
        let mut digests = tank;
        digests.push(hex_digest(b"return {}"));

        let pruned = prune_scratch_game(
            data.path(),
            "coilbox-lego-campaign.sdd",
            &[prune_unit("tank", digests)],
            &[],
        )
        .expect("prune");

        assert!(!game.join("units/tank.lua").exists());
        assert!(!game.join("objects3d/tank.s3o").exists());
        assert!(!game.join("scripts/tank.lua").exists());
        assert!(!game.join("scripts/coilbox/tank_collision.lua").exists());
        assert!(!weapon.exists());
        assert!(game.join("units/skyfort.lua").is_file());
        assert!(game.join("objects3d/skyfort.s3o").is_file());
        assert!(!pruned.removed.is_empty());
        assert!(pruned.kept.is_empty());
    }

    #[test]
    fn pruning_leaves_a_file_that_is_no_longer_what_was_written() {
        let (data, game) = scratch_root("coilbox-lego-campaign.sdd");
        let digests = exported_unit(&game, "tank");
        std::fs::write(game.join("units/tank.lua"), "somebody's edit").expect("edit");

        let pruned = prune_scratch_game(
            data.path(),
            "coilbox-lego-campaign.sdd",
            &[prune_unit("tank", digests)],
            &[],
        )
        .expect("prune");

        assert!(game.join("units/tank.lua").is_file());
        assert_eq!(
            pruned.kept,
            vec![game.join("units/tank.lua").to_string_lossy()]
        );
        assert!(!game.join("objects3d/tank.s3o").exists());
    }

    #[test]
    fn pruning_removes_the_textures_named_and_only_from_unittextures() {
        let (data, game) = scratch_root("coilbox-lego-campaign.sdd");
        let textures = game.join("unittextures");
        std::fs::create_dir_all(&textures).expect("mkdir");
        std::fs::write(textures.join("old.png"), "png").expect("old");
        std::fs::write(textures.join("current.png"), "png").expect("current");
        std::fs::write(game.join("modinfo.lua"), "modinfo").expect("modinfo");

        prune_scratch_game(
            data.path(),
            "coilbox-lego-campaign.sdd",
            &[],
            &["old.png".to_string()],
        )
        .expect("prune");

        assert!(!textures.join("old.png").exists());
        assert!(textures.join("current.png").is_file());
        assert!(game.join("modinfo.lua").is_file());
    }

    // Issue #4528. A unit that stays but drops its weapons loses those files only.
    #[test]
    fn pruning_a_staying_units_weapons_leaves_the_rest_of_the_unit() {
        let (data, game) = scratch_root("coilbox-lego-campaign.sdd");
        let digests = armed_unit(&game, "tank", &["gun", "rocket"]);
        armed_unit(&game, "tank_big", &["gun"]);

        let pruned = prune_scratch_game(
            data.path(),
            "coilbox-lego-campaign.sdd",
            &[prune_parts("tank", digests, vec![PrunePart::Weapons])],
            &[],
        )
        .expect("prune");

        assert!(!game.join("weapons/coilbox_tank_gun.lua").exists());
        assert!(!game.join("weapons/coilbox_tank_rocket.lua").exists());
        assert!(game.join("weapons/coilbox_tank_big_gun.lua").is_file());
        assert!(game.join("units/tank.lua").is_file());
        assert!(wreck_model_path(&game, "tank").is_file());
        assert!(reexport::feature_path(&game, "tank").is_file());
        assert_eq!(pruned.removed.len(), 2);
    }

    #[test]
    fn pruning_a_staying_units_wreck_leaves_its_weapons_and_definition() {
        let (data, game) = scratch_root("coilbox-lego-campaign.sdd");
        let digests = armed_unit(&game, "tank", &["gun"]);

        let pruned = prune_scratch_game(
            data.path(),
            "coilbox-lego-campaign.sdd",
            &[prune_parts("tank", digests, vec![PrunePart::Wreck])],
            &[],
        )
        .expect("prune");

        assert!(!wreck_model_path(&game, "tank").exists());
        assert!(!reexport::feature_path(&game, "tank").exists());
        assert!(game.join("weapons/coilbox_tank_gun.lua").is_file());
        assert!(game.join("units/tank.lua").is_file());
        assert!(game.join("objects3d/tank.s3o").is_file());
        assert_eq!(pruned.removed.len(), 2);
    }

    #[test]
    fn pruning_a_staying_unit_keeps_a_weapon_or_wreck_file_edited_by_hand() {
        let (data, game) = scratch_root("coilbox-lego-campaign.sdd");
        let digests = armed_unit(&game, "tank", &["gun", "rocket"]);
        std::fs::write(game.join("weapons/coilbox_tank_gun.lua"), "my gun").expect("edit");
        std::fs::write(reexport::feature_path(&game, "tank"), "my wreck").expect("edit");

        let pruned = prune_scratch_game(
            data.path(),
            "coilbox-lego-campaign.sdd",
            &[prune_parts(
                "tank",
                digests,
                vec![PrunePart::Weapons, PrunePart::Wreck],
            )],
            &[],
        )
        .expect("prune");

        assert!(game.join("weapons/coilbox_tank_gun.lua").is_file());
        assert!(reexport::feature_path(&game, "tank").is_file());
        assert!(!game.join("weapons/coilbox_tank_rocket.lua").exists());
        assert!(!wreck_model_path(&game, "tank").exists());
        assert_eq!(
            pruned.kept,
            vec![reexport::feature_path(&game, "tank").to_string_lossy()]
        );
    }

    #[test]
    fn pruning_a_staying_unit_still_refuses_a_folder_that_is_not_a_scratch_game() {
        let (data, game) = scratch_root("ba1211.sdd");
        let digests = armed_unit(&game, "tank", &["gun"]);

        let refused = prune_scratch_game(
            data.path(),
            "ba1211.sdd",
            &[prune_parts("tank", digests, vec![PrunePart::Weapons])],
            &[],
        );

        assert!(refused.is_err());
        assert!(game.join("weapons/coilbox_tank_gun.lua").is_file());
    }

    #[test]
    fn pruning_refuses_a_folder_that_is_not_a_scratch_game() {
        let (data, game) = scratch_root("ba1211.sdd");
        let digests = exported_unit(&game, "tank");

        let refused = prune_scratch_game(
            data.path(),
            "ba1211.sdd",
            &[prune_unit("tank", digests)],
            &[],
        );

        assert!(refused.is_err());
        assert!(game.join("units/tank.lua").is_file());
    }

    #[test]
    fn pruning_refuses_names_that_are_paths_before_removing_anything() {
        let (data, game) = scratch_root("coilbox-lego-campaign.sdd");
        let digests = exported_unit(&game, "tank");
        std::fs::write(data.path().join("keep.png"), "png").expect("keep");

        let bad_unit = prune_scratch_game(
            data.path(),
            "coilbox-lego-campaign.sdd",
            &[
                prune_unit("tank", digests.clone()),
                prune_unit("../tank", digests),
            ],
            &[],
        );
        let bad_texture = prune_scratch_game(
            data.path(),
            "coilbox-lego-campaign.sdd",
            &[],
            &["../../keep.png".to_string()],
        );

        assert!(bad_unit.is_err());
        assert!(bad_texture.is_err());
        assert!(game.join("units/tank.lua").is_file());
        assert!(data.path().join("keep.png").is_file());
    }

    fn wreck(feature: &str, feature_written: Option<String>) -> WreckExport {
        serde_json::from_value(json!({
            "model": {
                "radius": 1.0,
                "height": 1.0,
                "mid": [0.0, 0.0, 0.0],
                "texture1": "atlas.png",
                "texture2": "",
                "root": {
                    "name": "base",
                    "offset": [0.0, -2.0, 0.0],
                    "vertices": [],
                    "indices": [],
                    "children": [],
                },
            },
            "feature": feature,
            "featureWritten": feature_written,
        }))
        .expect("wreck payload")
    }

    /// Issue #3310: the wreck's model is the builder's and is rewritten every
    /// time, and its feature file is kept once somebody has changed it.
    #[test]
    fn the_wreck_model_is_rewritten_and_its_feature_kept_once_edited() {
        let dir = tempfile::tempdir().expect("tempdir");
        let model = dir.path().join("objects3d/coilbox/tank_dead.s3o");
        let feature = dir.path().join("features/coilbox/tank_dead.lua");

        let mut owned = Vec::new();
        let first =
            write_wreck(dir.path(), "tank", false, wreck("one", None), &mut owned).expect("wreck");
        assert_eq!(first.model, model);
        assert_eq!(first.feature.as_ref(), Some(&feature));
        assert!(!first.feature_kept);
        assert!(model.is_file());
        assert_eq!(std::fs::read_to_string(&feature).unwrap(), "one");
        // Both on the receipt, so a rename can clear them.
        assert_eq!(owned.len(), 2);
        assert_eq!(owned[1]["sha256"], json!(hex_digest(b"one")));

        std::fs::write(&feature, "metal = 9000").unwrap();
        std::fs::remove_file(&model).unwrap();
        let mut owned = Vec::new();
        let second = write_wreck(
            dir.path(),
            "tank",
            false,
            wreck("two", Some(hex_digest(b"one"))),
            &mut owned,
        )
        .expect("wreck");
        assert!(second.feature_kept);
        assert_eq!(second.feature, None);
        assert!(model.is_file());
        assert_eq!(std::fs::read_to_string(&feature).unwrap(), "metal = 9000");
        assert_eq!(owned.len(), 1);
    }

    /// The rule that makes this safe to offer at all: a file whose contents are
    /// not what coilbox wrote is somebody else's, whether they edited it after
    /// the export or the game shipped it under that name all along.
    #[test]
    fn a_file_edited_since_the_export_is_reported_rather_than_removed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let digests = exported_unit(dir.path(), "skyfort");
        let edited = dir.path().join("units/skyfort.lua");
        std::fs::write(&edited, "-- my own changes").expect("write");

        let sorted = sort_stale_files(dir.path(), "skyfort", &digests, false).expect("removal");
        assert_eq!(sorted.kept, vec![edited.to_string_lossy().to_string()]);
        assert_eq!(sorted.ours.len(), 11);
        assert!(edited.is_file());
    }

    /// Write one weapon file for `unit_name` and answer with its digest.
    fn exported_weapon(root: &Path, unit_name: &str, key: &str) -> (PathBuf, String) {
        let path = root
            .join("weapons")
            .join(format!("coilbox_{unit_name}_{key}.lua"));
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        let contents = format!("return {{ unit = '{unit_name}', key = '{key}' }}");
        std::fs::write(&path, &contents).expect("write");
        (path, hex_digest(contents.as_bytes()))
    }

    /// Issue #4263: the weapon files an export wrote are named by key as well as
    /// unit, so a rename has to find them by prefix.
    #[test]
    fn a_rename_removes_the_old_units_weapon_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut digests = exported_unit(dir.path(), "skyfort");
        let (laser, laser_digest) = exported_weapon(dir.path(), "skyfort", "laser");
        let (rocket, rocket_digest) = exported_weapon(dir.path(), "skyfort", "rocket_pod");
        digests.extend([laser_digest, rocket_digest]);

        let dry = sort_stale_files(dir.path(), "skyfort", &digests, true).expect("dry run");
        assert_eq!(dry.ours.len(), 14);
        assert!(laser.is_file() && rocket.is_file());

        let done = sort_stale_files(dir.path(), "skyfort", &digests, false).expect("removal");
        assert_eq!(done.ours.len(), 14);
        assert!(done.kept.is_empty());
        assert!(!laser.exists() && !rocket.exists());
    }

    /// `tank` is a prefix of `tank_big`, so `coilbox_tank_big_laser.lua` matches
    /// `coilbox_tank_*.lua`. Only the digest keeps it safe.
    #[test]
    fn a_unit_whose_name_starts_the_same_way_keeps_its_weapon_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (tank_laser, tank_digest) = exported_weapon(dir.path(), "tank", "laser");
        let (big_laser, _) = exported_weapon(dir.path(), "tank_big", "laser");

        let done = sort_stale_files(dir.path(), "tank", &[tank_digest], false).expect("removal");
        assert_eq!(done.ours, vec![tank_laser.to_string_lossy().to_string()]);
        assert!(!tank_laser.exists());
        assert!(big_laser.is_file());
        assert!(!done.kept.contains(&big_laser.to_string_lossy().to_string()));
    }

    /// A weapon file the old unit owns but somebody edited stays.
    #[test]
    fn an_edited_weapon_file_is_left_alone() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (laser, digest) = exported_weapon(dir.path(), "skyfort", "laser");
        std::fs::write(&laser, "-- my own changes").expect("write");

        let done = sort_stale_files(dir.path(), "skyfort", &[digest], false).expect("removal");
        assert!(done
            .ours
            .iter()
            .all(|p| !p.ends_with("coilbox_skyfort_laser.lua")));
        assert!(laser.is_file());
    }

    /// A receipt written before the digests were recorded knows the name and
    /// nothing else, so every file is reported and none is removed.
    #[test]
    fn with_no_digests_recorded_nothing_is_removed() {
        let dir = tempfile::tempdir().expect("tempdir");
        exported_unit(dir.path(), "skyfort");

        let sorted = sort_stale_files(dir.path(), "skyfort", &[], false).expect("removal");
        assert!(sorted.ours.is_empty());
        assert_eq!(sorted.kept.len(), 12);
        assert!(dir.path().join("units/skyfort.lua").is_file());
    }

    #[test]
    fn a_name_that_left_nothing_behind_is_all_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let sorted = sort_stale_files(dir.path(), "skyfort", &[], false).expect("removal");
        assert_eq!(sorted.missing.len(), 12);
        assert!(sorted.ours.is_empty());
        assert!(sorted.kept.is_empty());
    }

    /// The textures are the reason this walks a fixed list rather than the
    /// folder: an atlas is shared by every unit that samples it, and an imported
    /// unit's textures land under the game's own names, so a rename owns
    /// neither. The only textures on the list are a mixed unit's own sheets.
    #[test]
    fn no_texture_but_the_units_own_sheets_is_ever_a_candidate() {
        let paths = export_paths(Path::new("/game"), "skyfort");
        let textures: Vec<PathBuf> = paths
            .iter()
            .filter(|p| p.starts_with("/game/unittextures"))
            .cloned()
            .collect();
        assert_eq!(
            textures,
            vec![
                PathBuf::from("/game/unittextures/coilbox_skyfort_sheet.png"),
                PathBuf::from("/game/unittextures/coilbox_skyfort_sheet2.png"),
            ]
        );
        assert_eq!(
            paths.first(),
            Some(&PathBuf::from("/game/objects3d/skyfort.s3o"))
        );
    }

    #[test]
    fn scratch_files_land_where_the_engine_looks_for_them() {
        let dir = tempfile::tempdir().expect("tempdir");
        for (relative, contents) in [
            (SCRATCH_MODINFO, "modinfo"),
            (SCRATCH_SIDEDATA, "sidedata"),
            (SCRATCH_GADGET, "gadget"),
            (SCRATCH_UNIT_SCRIPT_GADGET, "unit script"),
        ] {
            write_scratch_file(dir.path(), relative, contents).expect("write");
        }

        let read = |path: &str| std::fs::read_to_string(dir.path().join(path)).expect("read");
        assert_eq!(read("modinfo.lua"), "modinfo");
        assert_eq!(read("gamedata/sidedata.lua"), "sidedata");
        assert_eq!(read("LuaRules/Gadgets/coilbox_start_unit.lua"), "gadget");
        assert_eq!(
            read("LuaRules/Gadgets/coilbox_unit_script.lua"),
            "unit script"
        );
    }

    /// Installing the runtime removes `coilbox_*` gadgets it did not write, so
    /// a sandbox launch must still end up with the start unit gadget and the
    /// sandbox's own, whatever was in the folder before (issue #3341).
    #[test]
    fn a_sandbox_scratch_game_keeps_both_of_its_gadgets() {
        let src = tempfile::tempdir().expect("tempdir");
        for (rel, body) in [
            ("missions/runtime.lua", "return { version = 1 }"),
            ("luarules/gadgets/coilbox_mission_runtime.lua", "-- runtime"),
        ] {
            let path = src.path().join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).expect("mkdir");
            std::fs::write(path, body).expect("write");
        }
        let dir = tempfile::tempdir().expect("tempdir");
        let sandbox = sandbox::Sandbox {
            download: "[MENUENTRY1]".into(),
            gadget: "-- sandbox".into(),
            mission_id: "coilbox-lego-sandbox".into(),
            mission: "return {}".into(),
            ship_runtime: true,
        };
        let files = ["modinfo", "unit script"];
        let start_unit = [Some("sidedata"), Some("start unit")];

        // Twice, so the second launch finds the first one's files in place.
        for _ in 0..2 {
            write_scratch_game(
                dir.path(),
                files,
                start_unit,
                [None, None],
                None,
                Some(&sandbox),
                Some(src.path()),
            )
            .expect("write");
        }

        let read = |rel: &str| std::fs::read_to_string(dir.path().join(rel)).expect(rel);
        assert_eq!(
            read("LuaRules/Gadgets/coilbox_start_unit.lua"),
            "start unit"
        );
        assert_eq!(
            read("LuaRules/Gadgets/coilbox_unit_script.lua"),
            "unit script"
        );
        assert_eq!(read("LuaRules/Gadgets/coilbox_sandbox.lua"), "-- sandbox");
        assert_eq!(
            read("LuaRules/Gadgets/coilbox_mission_runtime.lua"),
            "-- runtime"
        );
        assert_eq!(read("modinfo.lua"), "modinfo");
    }

    /// Issue #4475. A base game with no `LuaRules/draw.lua` gets one, and the
    /// next launch on a game that has its own takes it away again, so the
    /// reused folder never hides the game's file.
    #[test]
    fn a_luarules_entry_is_written_only_while_the_base_game_lacks_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let files = ["modinfo", "unit script"];
        let start_unit = [Some("sidedata"), Some("start unit")];
        let draw = dir.path().join("LuaRules/draw.lua");
        let main = dir.path().join("LuaRules/main.lua");

        write_scratch_game(
            dir.path(),
            files,
            start_unit,
            [None, Some("-- handler")],
            None,
            None,
            None,
        )
        .expect("write");
        assert_eq!(std::fs::read_to_string(&draw).expect("draw"), "-- handler");
        assert!(!main.exists(), "the base game's main.lua is left to it");

        write_scratch_game(
            dir.path(),
            files,
            start_unit,
            [None, None],
            None,
            None,
            None,
        )
        .expect("write");
        assert!(!draw.exists(), "the earlier copy would hide the game's own");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("LuaRules/Gadgets/coilbox_start_unit.lua"))
                .expect("gadget"),
            "start unit"
        );
    }

    /// A caller that launches several units has no start unit, and the folder
    /// is reused, so the last launch's spawn gadget must not survive it.
    #[test]
    fn a_scratch_game_without_a_start_unit_removes_the_last_ones() {
        let dir = tempfile::tempdir().expect("tempdir");
        let files = ["modinfo", "unit script"];
        let sidedata = dir.path().join("gamedata/sidedata.lua");
        let gadget = dir.path().join("LuaRules/Gadgets/coilbox_start_unit.lua");

        write_scratch_game(
            dir.path(),
            files,
            [Some("sidedata"), Some("start unit")],
            [None, None],
            None,
            None,
            None,
        )
        .expect("write");
        assert!(sidedata.exists() && gadget.exists());

        write_scratch_game(
            dir.path(),
            files,
            [None, None],
            [None, None],
            None,
            None,
            None,
        )
        .expect("write");
        assert!(!sidedata.exists());
        assert!(!gadget.exists());
        assert!(dir.path().join("modinfo.lua").exists());
        assert!(dir
            .path()
            .join("LuaRules/Gadgets/coilbox_unit_script.lua")
            .exists());
    }

    /// Issue #4515. The build list goes where the engine's `download_builds.lua`
    /// reads it, and a launch with no builders takes the last one's away.
    #[test]
    fn the_build_list_is_written_only_while_a_unit_names_a_builder() {
        let dir = tempfile::tempdir().expect("tempdir");
        let files = ["modinfo", "unit script"];
        let list = dir.path().join("download/coilbox_build_list.tdf");

        write_scratch_game(
            dir.path(),
            files,
            [None, None],
            [None, None],
            Some("[MENUENTRY1]"),
            None,
            None,
        )
        .expect("write");
        assert_eq!(
            std::fs::read_to_string(&list).expect("list"),
            "[MENUENTRY1]"
        );

        write_scratch_game(
            dir.path(),
            files,
            [None, None],
            [None, None],
            None,
            None,
            None,
        )
        .expect("write");
        assert!(
            !list.exists(),
            "an earlier list would keep a unit on a menu"
        );
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

    /// `read_texture` is the composer's file-reading half: a real file on disk
    /// decodes to the same pixels it was written with, by extension rather than
    /// by sniffing, the same as every other reader in this crate.
    #[test]
    fn read_texture_decodes_a_real_file_by_its_extension() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("colour.png");
        let img = image::RgbaImage::from_pixel(2, 2, image::Rgba([10, 20, 30, 255]));
        let png = coilbox_texture::encode_png(&img).expect("encode");
        std::fs::write(&path, png).expect("write");

        let decoded = read_texture(path.to_str().expect("utf8 path")).expect("should decode");

        assert_eq!(decoded.get_pixel(0, 0).0, [10, 20, 30, 255]);
    }

    #[test]
    fn read_texture_names_the_file_when_it_is_missing() {
        let err = read_texture("/no/such/file.png").expect_err("should refuse");
        assert!(err.contains("file.png"), "got: {err}");
    }

    #[test]
    fn read_texture_names_the_file_when_it_cannot_be_decoded() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("not-really.png");
        std::fs::write(&path, b"not a png").expect("write");

        let err = read_texture(path.to_str().expect("utf8 path")).expect_err("should refuse");

        assert!(err.contains("not-really.png"), "got: {err}");
    }

    /// `read_stored_texture` is `lego_texture_compose_shading`'s way of loading
    /// a unit's current second texture to carry its cutout forward: a real key
    /// in the store decodes the same as any other texture.
    #[test]
    fn read_stored_texture_decodes_a_key_already_in_the_store() {
        let dir = tempfile::tempdir().expect("tempdir");
        let img = image::RgbaImage::from_pixel(2, 2, image::Rgba([1, 2, 3, 0]));
        let png = coilbox_texture::encode_png(&img).expect("encode");
        std::fs::write(dir.path().join("existing.png"), &png).expect("write");

        let decoded = read_stored_texture(dir.path(), "existing.png").expect("should decode");

        assert_eq!(decoded.get_pixel(0, 0).0, [1, 2, 3, 0]);
    }

    /// A key that is not a bare file name, the same shape `stored_texture_source`
    /// already refuses everywhere else, is refused here too rather than being
    /// joined onto the store directory unchecked.
    #[test]
    fn read_stored_texture_refuses_a_key_that_is_not_a_bare_file_name() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(read_stored_texture(dir.path(), "../elsewhere.png").is_err());
    }

    #[test]
    fn bitmap_png_keeps_alpha() {
        let mut tga = Vec::new();
        let img = image::RgbaImage::from_pixel(2, 1, image::Rgba([255, 128, 0, 64]));
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut tga), image::ImageFormat::Tga)
            .unwrap();
        let path = std::env::temp_dir().join(format!(
            "coilbox-bitmap-png-test-{}.tga",
            std::process::id()
        ));
        std::fs::write(&path, &tga).unwrap();

        let (png, width, height) = bitmap_png(path.to_str().unwrap()).unwrap();

        assert_eq!((width, height), (2, 1));
        let back = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(back.get_pixel(0, 0).0, [255, 128, 0, 64]);

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn bitmap_png_names_the_file_when_it_is_missing() {
        let err = bitmap_png("/no/such/flame.tga").unwrap_err();
        assert!(err.contains("flame.tga"), "got: {err}");
    }

    fn png_of(width: u32, height: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(width, height, image::Rgba([1, 2, 3, 255]));
        coilbox_texture::encode_png(&img).expect("encode")
    }

    #[test]
    fn a_build_picture_is_written_where_the_engine_looks_for_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bytes = png_of(4, 4);
        let outcome = place_picture(dir.path(), "skyfort", &bytes, None).expect("place");
        let target = dir.path().join("unitpics/skyfort.png");
        assert_eq!(outcome, PicturePlacement::Written(target.clone()));
        assert_eq!(std::fs::read(target).expect("read"), bytes);
    }

    #[test]
    fn a_build_picture_the_builder_wrote_is_replaced_on_the_next_export() {
        let dir = tempfile::tempdir().expect("tempdir");
        let first = png_of(4, 4);
        place_picture(dir.path(), "skyfort", &first, None).expect("first");
        let second = png_of(8, 8);
        let outcome = place_picture(
            dir.path(),
            "skyfort",
            &second,
            Some(hex_digest(&first).as_str()),
        )
        .expect("second");
        assert!(matches!(outcome, PicturePlacement::Written(_)));
        assert_eq!(
            std::fs::read(dir.path().join("unitpics/skyfort.png")).expect("read"),
            second
        );
    }

    /// The write once rule: a painted picture hashes to something other than the
    /// digest the builder recorded, so it is the game maker's and stays.
    #[test]
    fn a_build_picture_someone_replaced_is_left_alone() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ours = png_of(4, 4);
        place_picture(dir.path(), "skyfort", &ours, None).expect("first");
        let target = dir.path().join("unitpics/skyfort.png");
        let painted = png_of(64, 64);
        std::fs::write(&target, &painted).expect("paint");

        let outcome = place_picture(
            dir.path(),
            "skyfort",
            &png_of(8, 8),
            Some(hex_digest(&ours).as_str()),
        )
        .expect("second");

        assert_eq!(outcome, PicturePlacement::Kept(target.clone()));
        assert_eq!(std::fs::read(target).expect("read"), painted);
    }

    #[test]
    fn a_build_picture_the_builder_never_wrote_is_left_alone() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("unitpics/skyfort.png");
        std::fs::create_dir_all(target.parent().expect("parent")).expect("mkdir");
        let theirs = png_of(64, 64);
        std::fs::write(&target, &theirs).expect("write");

        let outcome = place_picture(dir.path(), "skyfort", &png_of(8, 8), None).expect("place");

        assert_eq!(outcome, PicturePlacement::Kept(target.clone()));
        assert_eq!(std::fs::read(target).expect("read"), theirs);
    }

    #[test]
    fn survey_reports_the_size_most_pictures_have_and_the_formats_present() {
        let dir = tempfile::tempdir().expect("tempdir");
        let pics = dir.path().join("unitpics");
        std::fs::create_dir_all(&pics).expect("mkdir");
        std::fs::write(pics.join("a.png"), png_of(64, 48)).expect("a");
        std::fs::write(pics.join("b.png"), png_of(64, 48)).expect("b");
        std::fs::write(pics.join("c.png"), png_of(32, 32)).expect("c");
        std::fs::write(pics.join("d.dds"), b"dds").expect("d");

        let survey = survey_unitpics(dir.path());

        assert_eq!(survey.png_sizes, vec![(64, 48, 2), (32, 32, 1)]);
        assert_eq!(survey.other_formats, vec![("dds".to_string(), 1)]);
    }

    #[test]
    fn survey_of_a_game_with_no_pictures_is_empty() {
        let dir = tempfile::tempdir().expect("tempdir");
        let survey = survey_unitpics(dir.path());
        assert!(survey.png_sizes.is_empty());
        assert!(survey.other_formats.is_empty());
    }
}
