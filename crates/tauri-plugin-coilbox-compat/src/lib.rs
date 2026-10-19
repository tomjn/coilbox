//! Compatibility mode's mutator (issue #4556): an old game wrapped in a
//! generated game that overlays fixes on it, on a current engine.
//!
//! `compat_build` writes `coilbox-compat-<stem>-<n>.sdd` under a content root's
//! `games/` from compat manifest `n`, and `compat_status` says whether the one
//! already there is stale. See `mutator` for the folder and its files, and
//! `models` for the base game's `.3do` models converted into it.
//!
//! Registered as `"coilbox-compat"`. The frontend invokes
//! `plugin:coilbox-compat|<cmd>`.

pub mod defs;
mod handlers;
#[cfg(test)]
mod identical_builds;
pub mod models;
pub mod mutator;
pub mod standins;

use picoframe_core::CliResult;
use serde::Serialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

pub use mutator::{Marker, Stale};
pub use tauri_plugin_coilbox_unitsync::DeclaredGame;

/// What a build wrote.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Built {
    /// The mutator's folder, absolute.
    pub dir: String,
    /// The folder's name, which is the archive name unitsync reports.
    pub folder: String,
    /// Every file written, relative to `dir`.
    pub files: Vec<String>,
    /// What the 3do converter said about the base game's models.
    pub models: models::Conversion,
    /// Why the converted models or the def fixes are not used, when they
    /// cannot be.
    pub notes: Vec<String>,
    /// The ids of the prelude fixes written, which define the functions the
    /// engine removed.
    pub prelude_fixes: Vec<String>,
    /// The names of the polyfill gadgets written. Each decides when it loads
    /// whether the game needs it.
    pub gadgets: Vec<String>,
    /// How many converted models `gamedata/defs_post.lua` points the game's
    /// defs at, plus how many of the base game's unit and weapon defs the def
    /// fixes change, counted on a read of its defs (see `defs::changed`).
    pub def_overrides: usize,
}

/// Write the compat mutator for the game in `archive_name` under `data_dir`'s
/// `games/`, from manifest `manifest_version`. Replaces whatever the folder
/// held. `game_name` and `base_checksum` are the game's name and its archive's
/// checksum as unitsync reports them. The game's Lua entry files are read, and
/// its `.3do` models converted, through the unitsync worker of the engine at
/// `engine_path`, which also scans the game's Lua for the call-in handlers that
/// pick its call-in adapters.
pub fn build(
    data_dir: &str,
    engine_path: &str,
    archive_name: &str,
    game_name: &str,
    base_checksum: &str,
    manifest_version: u32,
    coilbox_version: &str,
) -> Result<Built, String> {
    let manifest = coilbox_compat::manifest(manifest_version)
        .ok_or_else(|| format!("there is no compat manifest {manifest_version}"))?;
    // The models are converted as the writer the manifest names converts them.
    let writer = manifest.writer;
    let scan = tauri_plugin_coilbox_unitsync::lua_compat_scan_blocking(
        engine_path,
        data_dir,
        archive_name,
    )?;
    let handlers = handlers::handlers_in(&scan, archive_name)?;
    let staging = tempfile::tempdir()
        .map_err(|e| format!("could not make a folder to convert the models into: {e}"))?;
    let declared =
        tauri_plugin_coilbox_unitsync::game_declared_blocking(engine_path, data_dir, game_name)?;
    build_with(
        data_dir,
        archive_name,
        game_name,
        &declared,
        base_checksum,
        &manifest,
        coilbox_version,
        &handlers,
        |file| {
            tauri_plugin_coilbox_unitsync::archive_text_blocking(
                engine_path,
                data_dir,
                archive_name,
                file,
            )
        },
        |file| {
            tauri_plugin_coilbox_unitsync::archive_bytes_blocking(
                engine_path,
                data_dir,
                archive_name,
                file,
            )
        },
        || models::convert(engine_path, data_dir, archive_name, staging.path(), writer),
        || tauri_plugin_coilbox_unitsync::unit_defs_blocking(engine_path, data_dir, archive_name),
        |source| {
            tauri_plugin_coilbox_unitsync::lua_exec_blocking(
                engine_path,
                data_dir,
                archive_name,
                source,
            )
        },
    )
}

/// [`build_with`], for a base game whose files `read` returns as text, so
/// their bytes are that text's.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
fn build_reading(
    data_dir: &str,
    archive_name: &str,
    game_name: &str,
    declared: &DeclaredGame,
    base_checksum: &str,
    manifest_version: u32,
    coilbox_version: &str,
    handlers: &[coilbox_compat::Handler],
    read: impl Fn(&str) -> Result<Option<String>, String>,
    convert: impl FnOnce() -> Result<models::Models, String>,
    read_defs: impl FnOnce() -> Result<String, String>,
) -> Result<Built, String> {
    build_reading_with_lua(
        data_dir,
        archive_name,
        game_name,
        declared,
        base_checksum,
        manifest_version,
        coilbox_version,
        handlers,
        read,
        convert,
        read_defs,
        |_| Ok(standins_answer("[]")),
    )
}

/// The worker's answer to the stand-in script (see `standins`) for a game
/// whose defs the fix changes as the JSON list `standins` says.
#[cfg(test)]
fn standins_answer(standins: &str) -> String {
    let json = format!(r#"{{"loaded":true,"ran":true,"standins":{standins},"failed":[]}}"#);
    let quoted = format!("\"{}\"", json.replace('\\', "\\\\").replace('"', "\\\""));
    serde_json::json!({ "result": quoted, "errors": [] }).to_string()
}

/// [`build_reading`], with `run_lua` answering for the worker that runs the
/// stand-in script.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
fn build_reading_with_lua(
    data_dir: &str,
    archive_name: &str,
    game_name: &str,
    declared: &DeclaredGame,
    base_checksum: &str,
    manifest_version: u32,
    coilbox_version: &str,
    handlers: &[coilbox_compat::Handler],
    read: impl Fn(&str) -> Result<Option<String>, String>,
    convert: impl FnOnce() -> Result<models::Models, String>,
    read_defs: impl FnOnce() -> Result<String, String>,
    run_lua: impl FnOnce(&str) -> Result<String, String>,
) -> Result<Built, String> {
    let manifest = coilbox_compat::manifest(manifest_version)
        .ok_or_else(|| format!("there is no compat manifest {manifest_version}"))?;
    build_with(
        data_dir,
        archive_name,
        game_name,
        declared,
        base_checksum,
        &manifest,
        coilbox_version,
        handlers,
        &read,
        |file| Ok(read(file)?.map(String::into_bytes)),
        convert,
        read_defs,
        run_lua,
    )
}

/// [`build`] from `manifest`, with `read` returning a file of the base game by path as the
/// worker's text read gives it, `read_bytes` the same file's bytes, `handlers`
/// the call-in handlers the base game's Lua defines, `convert` its converted
/// models, and `read_defs` its defs as `unitsync_unit_defs` reads them.
/// `convert` runs once the request is known to be sound, and before anything is
/// written. `read_defs` runs only when def fixes were written, to count the
/// defs they change. `run_lua` runs a script through the worker with the game
/// mounted, and only when the def fix for missing models is written, to find
/// the defs it changes (see `standins`).
///
/// The entry files the prelude wraps come from `read_bytes` for a manifest
/// whose writer copies them byte for byte, and from `read` for one whose
/// writer does not (see [`coilbox_compat::copies_entry_bytes`]).
#[allow(clippy::too_many_arguments)]
fn build_with(
    data_dir: &str,
    archive_name: &str,
    game_name: &str,
    declared: &DeclaredGame,
    base_checksum: &str,
    manifest: &coilbox_compat::Manifest,
    coilbox_version: &str,
    handlers: &[coilbox_compat::Handler],
    mut read: impl FnMut(&str) -> Result<Option<String>, String>,
    mut read_bytes: impl FnMut(&str) -> Result<Option<Vec<u8>>, String>,
    convert: impl FnOnce() -> Result<models::Models, String>,
    read_defs: impl FnOnce() -> Result<String, String>,
    run_lua: impl FnOnce(&str) -> Result<String, String>,
) -> Result<Built, String> {
    let manifest_version = manifest.version;
    mutator::check_pins(manifest)?;
    let manifest = coilbox_compat::for_game(manifest, handlers);
    if base_checksum.trim().is_empty() {
        return Err(format!(
            "unitsync gave no checksum for {archive_name}, so a change to it could not be noticed"
        ));
    }
    let folder = mutator::folder(archive_name, manifest_version)?;
    let dir = mutator::games_dir(data_dir)?.join(&folder);
    coilbox_portable::refuse_in_bundle(&dir)?;
    let mut marker = Marker {
        manifest_version,
        writer: manifest.writer,
        base_checksum: base_checksum.to_string(),
        coilbox_version: coilbox_version.to_string(),
        palette: None,
    };
    let copies_bytes = coilbox_compat::copies_entry_bytes(manifest.writer);
    let entry = |file: &str| -> Result<Option<Vec<u8>>, String> {
        if copies_bytes {
            read_bytes(file)
        } else {
            Ok(read(file)?.map(String::into_bytes))
        }
    };
    let mut files = mutator::files(&manifest, game_name, declared, &marker, entry)?;
    let defs = defs::plan(&manifest, &mut read)?;
    let standins = if standins::wanted(&manifest, &defs) {
        let found = standins::parse(&run_lua(&standins::script(&manifest)?)?)?;
        let at = files.len().saturating_sub(1);
        files.splice(at..at, standins::files(&found.standins)?);
        found
    } else {
        standins::Found::default()
    };
    let models = convert()?;
    // The palette is known only once the models are converted, so the marker
    // that ends `files` is written again with it.
    if models.palette.is_some() {
        marker.palette = models.palette.clone();
        match files.last_mut() {
            Some(last) if last.path == mutator::MARKER => *last = mutator::marker_file(&marker)?,
            _ => return Err("the mutator's files do not end with its marker".into()),
        }
    }
    let prelude_fixes = manifest
        .fixes
        .iter()
        .filter(|id| coilbox_compat::is_prelude_fix(id))
        .cloned()
        .collect();
    let gadgets = coilbox_compat::gadget_files(&manifest)
        .into_iter()
        .filter_map(|(path, _)| {
            let name = path.strip_prefix("LuaRules/Gadgets/")?;
            Some(name.strip_suffix(".lua").unwrap_or(name).to_string())
        })
        .collect();
    let mut notes = models.notes.clone();
    notes.extend(defs.notes.iter().cloned());
    notes.extend(standins::note(&standins));
    let files = write_with_models(&dir, &mut files, &models, &defs, manifest_version)?;
    let mut def_overrides = models::model_keys(&files).len() + standins.standins.len();
    if !defs.written.is_empty() {
        match read_defs().and_then(|read| defs::changed(&manifest, &defs.written, &read)) {
            Ok(n) => def_overrides += n,
            Err(e) => notes.push(format!(
                "Could not read the game's defs to count what the def fixes change: {e}"
            )),
        }
    }
    Ok(Built {
        dir: dir.to_string_lossy().into_owned(),
        folder,
        def_overrides,
        files,
        models: models.conversion,
        notes,
        prelude_fixes,
        gadgets,
    })
}

/// Write `files`, the converted `models` and the def files of `defs` into
/// `dir`, with the marker that ends `files` written last, so a write that
/// stops part way leaves none. Answers with every path written, sorted, with
/// the marker last.
fn write_with_models(
    dir: &std::path::Path,
    files: &mut Vec<mutator::File>,
    models: &models::Models,
    defs: &defs::Plan,
    manifest_version: u32,
) -> Result<Vec<String>, String> {
    let marker = files
        .pop()
        .filter(|f| f.path == mutator::MARKER)
        .ok_or("the mutator's files do not end with its marker")?;
    let converted = match &models.dir {
        Some(from) => models::list(from)?,
        None => Vec::new(),
    };
    let post = models::defs_post(
        &models::model_keys(&converted),
        defs.defs_post.as_deref(),
        manifest_version,
    );
    files.extend(
        post.into_iter()
            .chain(defs.weapondefs_post.clone())
            .map(mutator::File::from),
    );
    files.sort_by(|a, b| a.path.cmp(&b.path));
    // Clears the folder, and then the files go in as bytes.
    tauri_plugin_coilbox_workshop::write_mutator(dir, &[])?;
    for file in files.iter() {
        let at = dir.join(&file.path);
        if let Some(parent) = at.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        std::fs::write(&at, &file.contents)
            .map_err(|e| format!("could not write {}: {e}", at.display()))?;
    }
    if let Some(from) = &models.dir {
        models::copy(from, &converted, dir)?;
    }
    let at = dir.join(&marker.path);
    std::fs::write(&at, &marker.contents)
        .map_err(|e| format!("could not write {}: {e}", at.display()))?;
    let mut paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    paths.extend(converted);
    paths.sort();
    paths.push(marker.path);
    Ok(paths)
}

/// Where the compat mutator for a game stands.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The manifest coilbox builds now.
    pub latest: u32,
    /// The newest mutator built for the game, or `None` when there is none.
    pub folder: Option<String>,
    /// Why that mutator is stale. Empty when it is current or there is none.
    pub stale: Vec<Stale>,
}

/// Whether the newest compat mutator built for `archive_name` under
/// `data_dir` matches the latest manifest, the writer this build carries, the
/// archive's current checksum, and the palette its models take their colours
/// from, which the worker of the engine at `engine_path` reads.
pub fn status(
    data_dir: &str,
    engine_path: &str,
    archive_name: &str,
    base_checksum: &str,
) -> Result<Status, String> {
    status_with(data_dir, archive_name, base_checksum, || {
        models::current_palette(engine_path, data_dir, archive_name)
    })
}

/// [`status`], with `palette_now` reading the palette a conversion would read
/// now. It is only called for a mutator whose marker records one.
fn status_with(
    data_dir: &str,
    archive_name: &str,
    base_checksum: &str,
    palette_now: impl FnOnce() -> Result<coilbox_compat::Palette, String>,
) -> Result<Status, String> {
    let latest = coilbox_compat::latest();
    let games = mutator::games_dir(data_dir)?;
    let Some((folder, _)) = mutator::newest_built(&games, archive_name)? else {
        return Ok(Status {
            latest,
            folder: None,
            stale: Vec::new(),
        });
    };
    let marker = mutator::read_marker(&games.join(&folder));
    Ok(Status {
        latest,
        stale: mutator::staleness(
            marker.as_ref(),
            latest,
            coilbox_compat::WRITER,
            base_checksum,
            palette_now,
        )?,
        folder: Some(folder),
    })
}

/// Delete every compat mutator built for `archive_name` under `data_dir`,
/// which are generated folders and never the original game. Answers with the
/// folders deleted.
pub fn remove(data_dir: &str, archive_name: &str) -> Result<Vec<String>, String> {
    let games = mutator::games_dir(data_dir)?;
    let mut removed = Vec::new();
    for (folder, _) in mutator::built_folders(&games, archive_name)? {
        let dir = games.join(&folder);
        coilbox_portable::refuse_in_bundle(&dir)?;
        std::fs::remove_dir_all(&dir)
            .map_err(|e| format!("could not delete {}: {e}", dir.display()))?;
        removed.push(folder);
    }
    removed.sort();
    Ok(removed)
}

/// What an export wrote.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exported {
    /// The archive written, as given.
    pub path: String,
    /// The mutator folder it was packed from.
    pub folder: String,
    /// Every file in the archive, in archive order: sorted by path, with the
    /// marker last, as a build lists them.
    pub files: Vec<String>,
}

/// Pack the compat mutator built for `archive_name` under `data_dir` into a
/// `.sdz` at `dest`, for somebody who does not run coilbox (issue #4568). The
/// worker of the engine at `engine_path` reads the palette [`status`] checks.
///
/// Refused when there is no mutator, or when [`status`] says it is stale, since
/// the export would hand out a mutator coilbox itself would rebuild. The folder
/// is read as it is on disk, so the archive holds the very files a build wrote.
/// They go in sorted by path with the marker last, the order a build lists them
/// in, so two exports of one folder are the same bytes.
pub fn export(
    data_dir: &str,
    engine_path: &str,
    archive_name: &str,
    base_checksum: &str,
    dest: &str,
) -> Result<Exported, String> {
    export_with(data_dir, archive_name, base_checksum, dest, || {
        models::current_palette(engine_path, data_dir, archive_name)
    })
}

/// [`export`], with `palette_now` as for [`status_with`].
fn export_with(
    data_dir: &str,
    archive_name: &str,
    base_checksum: &str,
    dest: &str,
    palette_now: impl FnOnce() -> Result<coilbox_compat::Palette, String>,
) -> Result<Exported, String> {
    let current = status_with(data_dir, archive_name, base_checksum, palette_now)?;
    let Some(folder) = current.folder else {
        return Err(format!(
            "there is no compat mutator built for {archive_name} to export"
        ));
    };
    if !current.stale.is_empty() {
        return Err(format!(
            "{folder} is out of date, so it was not exported. Rebuild it first"
        ));
    }
    let dest_path = std::path::Path::new(dest);
    let names_an_sdz = dest_path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("sdz"));
    if !names_an_sdz {
        return Err(format!("{dest} does not end in .sdz"));
    }
    let dir = mutator::games_dir(data_dir)?.join(&folder);
    let mut files = models::list(&dir)?;
    // `list` sorts, which puts the dot file first.
    files.retain(|f| f != mutator::MARKER);
    files.push(mutator::MARKER.to_string());
    tauri_plugin_coilbox_workshop::write_sdz_entries(dest_path, &files, |path| {
        let at = dir.join(path);
        std::fs::read(&at).map_err(|e| format!("could not read {}: {e}", at.display()))
    })?;
    Ok(Exported {
        path: dest.to_string(),
        folder,
        files,
    })
}

fn envelope<T: Serialize>(result: Result<T, String>) -> CliResult {
    match result.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string())) {
        Ok(v) => CliResult::ok(v),
        Err(e) => CliResult::err(e),
    }
}

/// [`build`], recording the running coilbox's version in the marker. On a
/// blocking task, since converting a game's models takes seconds.
#[tauri::command]
async fn compat_build<R: Runtime>(
    app: AppHandle<R>,
    data_dir: String,
    engine_path: String,
    archive_name: String,
    game_name: String,
    base_checksum: String,
    manifest_version: u32,
) -> CliResult {
    let version = app.package_info().version.to_string();
    let result = tauri::async_runtime::spawn_blocking(move || {
        build(
            &data_dir,
            &engine_path,
            &archive_name,
            &game_name,
            &base_checksum,
            manifest_version,
            &version,
        )
    })
    .await
    .unwrap_or_else(|e| Err(format!("the compat build task failed: {e}")));
    envelope(result)
}

/// [`status`]. On a blocking task, since a mutator with converted models has
/// the worker read the palette.
#[tauri::command]
async fn compat_status(
    data_dir: String,
    engine_path: String,
    archive_name: String,
    base_checksum: String,
) -> CliResult {
    let result = tauri::async_runtime::spawn_blocking(move || {
        status(&data_dir, &engine_path, &archive_name, &base_checksum)
    })
    .await
    .unwrap_or_else(|e| Err(format!("the compat status task failed: {e}")));
    envelope(result)
}

/// [`remove`].
#[tauri::command]
async fn compat_remove(data_dir: String, archive_name: String) -> CliResult {
    let result = tauri::async_runtime::spawn_blocking(move || remove(&data_dir, &archive_name))
        .await
        .unwrap_or_else(|e| Err(format!("the compat remove task failed: {e}")));
    envelope(result)
}

/// [`export`].
#[tauri::command]
async fn compat_export(
    data_dir: String,
    engine_path: String,
    archive_name: String,
    base_checksum: String,
    dest: String,
) -> CliResult {
    let result = tauri::async_runtime::spawn_blocking(move || {
        export(
            &data_dir,
            &engine_path,
            &archive_name,
            &base_checksum,
            &dest,
        )
    })
    .await
    .unwrap_or_else(|e| Err(format!("the compat export task failed: {e}")));
    envelope(result)
}

/// Build the plugin. Registered as `"coilbox-compat"` (crate name minus the
/// `tauri-plugin-` prefix).
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-compat")
        .invoke_handler(tauri::generate_handler![
            compat_build,
            compat_status,
            compat_remove,
            compat_export
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_models() -> Result<models::Models, String> {
        Ok(models::Models::default())
    }

    fn no_file(_: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn no_defs() -> Result<String, String> {
        Err("no defs in this test".into())
    }

    /// For a mutator whose marker records no palette, which must not read one.
    fn unread() -> Result<coilbox_compat::Palette, String> {
        panic!("read the palette for a mutator whose marker records none")
    }

    /// The palette the converted models in these tests were coloured from.
    fn a_palette() -> coilbox_compat::Palette {
        coilbox_compat::Palette::of(Some(b"the palette"), Some("springcontent.sdz".into()))
    }

    fn same_palette() -> Result<coilbox_compat::Palette, String> {
        Ok(a_palette())
    }

    fn root() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        (dir, path)
    }

    #[test]
    fn a_build_writes_the_folder_and_status_finds_it_current() {
        let (_keep, data) = root();
        let n = coilbox_compat::latest();
        let asked = std::cell::RefCell::new(String::new());
        let built = build_reading_with_lua(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            &DeclaredGame::default(),
            "1234abcd",
            n,
            "1.2.3",
            &[],
            no_file,
            no_models,
            || Ok(r#"{"units":{"armcom":{"commander":1},"armpw":{}},"weaponDefs":{}}"#.into()),
            |source| {
                *asked.borrow_mut() = source.to_string();
                Ok(standins_answer(
                    r#"[{"kind":"feature","name":"arm_infinity_dead","model":"arm_infinity_dead","standin":"compat/models/standin-3x2.s3o"}]"#,
                ))
            },
        )
        .unwrap();
        assert!(asked
            .borrow()
            .contains("-- fix: defs-missing-model-standin\n"));
        assert_eq!(built.folder, format!("coilbox-compat-xta-9.65-{n}.sdd"));
        let gadgets: Vec<String> =
            coilbox_compat::gadget_files(&coilbox_compat::manifest(n).unwrap())
                .into_iter()
                .map(|(path, _)| path)
                .collect();
        let expected: Vec<String> = gadgets
            .into_iter()
            .chain([
                "compat/models/standin-1x1.s3o".to_string(),
                "compat/models/standin-3x2.s3o".to_string(),
                "compat/models/standin.tga".to_string(),
                models::DEFS_POST.to_string(),
                "gamedata/weapondefs_post.lua".to_string(),
                "modinfo.lua".to_string(),
                mutator::MARKER.to_string(),
            ])
            .collect();
        assert_eq!(built.files, expected);
        // The commander the def fixes give customparams.iscommander, and the
        // wreck whose model is missing (issue #4686).
        assert_eq!(built.def_overrides, 2);
        assert_eq!(built.notes.len(), 1, "{:?}", built.notes);
        assert!(built.notes[0].contains("feature arm_infinity_dead (arm_infinity_dead)"));
        let manifest = coilbox_compat::manifest(n).unwrap();
        let def_fixes = manifest
            .fixes
            .iter()
            .filter(|id| coilbox_compat::is_defs_fix(id))
            .count();
        assert_eq!(
            built.prelude_fixes.len() + built.gadgets.len() + def_fixes,
            manifest.fixes.len()
        );
        assert!(built
            .gadgets
            .iter()
            .all(|g| g.starts_with(coilbox_compat::GADGET_PREFIX)));
        let dir = std::path::Path::new(&built.dir);
        assert!(dir.join("modinfo.lua").is_file());
        assert_eq!(
            mutator::read_marker(dir).unwrap(),
            Marker {
                manifest_version: n,
                writer: coilbox_compat::WRITER,
                base_checksum: "1234abcd".into(),
                coilbox_version: "1.2.3".into(),
                palette: None,
            }
        );
        assert_eq!(
            status_with(&data, "xta-9.65.sd7", "1234abcd", unread).unwrap(),
            Status {
                latest: coilbox_compat::latest(),
                folder: Some(built.folder),
                stale: Vec::new(),
            }
        );
    }

    #[test]
    fn status_reports_a_changed_base_archive() {
        let (_keep, data) = root();
        build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            &DeclaredGame::default(),
            "1234abcd",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            no_file,
            no_models,
            no_defs,
        )
        .unwrap();
        let s = status_with(&data, "xta-9.65.sd7", "99999999", unread).unwrap();
        assert_eq!(
            s.stale,
            [Stale::BaseChecksum {
                built: "1234abcd".into(),
                now: "99999999".into()
            }]
        );
    }

    #[test]
    fn status_reports_a_folder_built_from_another_manifest() {
        let (_keep, data) = root();
        let built = build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            &DeclaredGame::default(),
            "1234abcd",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            no_file,
            no_models,
            no_defs,
        )
        .unwrap();
        // A folder from a manifest this build does not know stands in for one
        // built before the manifest moved.
        let other = coilbox_compat::latest() + 1;
        let games = std::path::Path::new(&data).join("games");
        let moved = games.join(format!("coilbox-compat-xta-9.65-{other}.sdd"));
        std::fs::rename(&built.dir, &moved).unwrap();
        let mut marker = mutator::read_marker(&moved).unwrap();
        marker.manifest_version = other;
        std::fs::write(
            moved.join(mutator::MARKER),
            serde_json::to_string(&marker).unwrap(),
        )
        .unwrap();
        let s = status_with(&data, "xta-9.65.sd7", "1234abcd", unread).unwrap();
        assert_eq!(
            s.stale,
            [Stale::Manifest {
                built: other,
                now: coilbox_compat::latest()
            }]
        );
    }

    #[test]
    fn a_build_from_manifest_2_writes_the_prelude_and_the_wrapped_entry_file() {
        let (_keep, data) = root();
        let read = |file: &str| -> Result<Option<String>, String> {
            Ok((file == "LuaRules/main.lua").then(|| "-- rules\n".to_string()))
        };
        let built = build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            &DeclaredGame::default(),
            "1234abcd",
            2,
            "1.2.3",
            &[],
            read,
            no_models,
            no_defs,
        )
        .unwrap();
        let dir = std::path::Path::new(&built.dir);
        assert_eq!(
            std::fs::read_to_string(dir.join("LuaRules/main.lua")).unwrap(),
            "VFS.Include(\"compat/prelude-synced.lua\") -- rules\n"
        );
        assert!(dir.join("compat/prelude-synced.lua").is_file());
        assert!(!dir.join("compat/prelude-unsynced.lua").exists());
    }

    /// Issue #4641: a Total Annihilation era game's Lua often holds Latin-1
    /// text. From writer 2 the entry file is copied from its bytes, and
    /// writer 1 keeps the text read, which replaced the byte with U+FFFD.
    #[test]
    fn an_entry_file_that_is_not_utf8_is_copied_as_it_is_from_writer_2() {
        let raw: &[u8] = b"local name = \"Caf\xe9\"\n";
        let main = "LuaRules/main.lua";
        let entry = |n: u32| -> Vec<u8> {
            let (_keep, data) = root();
            let built = build_with(
                &data,
                "xta-9.65.sd7",
                "XTA 9.65",
                &DeclaredGame::default(),
                "1234abcd",
                &coilbox_compat::manifest(n).unwrap(),
                "1.2.3",
                &[],
                |file| Ok((file == main).then(|| String::from_utf8_lossy(raw).into_owned())),
                |file| Ok((file == main).then(|| raw.to_vec())),
                no_models,
                no_defs,
                |_| Ok(standins_answer("[]")),
            )
            .unwrap();
            std::fs::read(std::path::Path::new(&built.dir).join(main)).unwrap()
        };
        let include = b"VFS.Include(\"compat/prelude-synced.lua\") ";
        let new = entry(8);
        assert_eq!(&new[..include.len()], include);
        assert_eq!(&new[include.len()..], raw);
        let old = entry(7);
        assert_eq!(
            &old[include.len()..],
            "local name = \"Caf\u{fffd}\"\n".as_bytes()
        );
    }

    #[test]
    fn a_game_whose_handlers_take_the_new_order_gets_no_adapter_for_them() {
        let read = |file: &str| -> Result<Option<String>, String> {
            Ok((file == "LuaRules/main.lua").then(|| "-- rules\n".to_string()))
        };
        let new_order = coilbox_compat::Handler {
            entry: "signature:UnitDamaged@95.0".into(),
            params: [
                "unitID",
                "unitDefID",
                "unitTeam",
                "damage",
                "paralyzer",
                "weaponDefID",
                "projectileID",
                "attackerID",
            ]
            .map(String::from)
            .to_vec(),
        };
        let prelude = |handlers: &[coilbox_compat::Handler]| {
            let (_keep, data) = root();
            let built = build_reading(
                &data,
                "xta-9.65.sd7",
                "XTA 9.65",
                &DeclaredGame::default(),
                "1234abcd",
                2,
                "1.2.3",
                handlers,
                read,
                no_models,
                no_defs,
            )
            .unwrap();
            std::fs::read_to_string(
                std::path::Path::new(&built.dir).join("compat/prelude-synced.lua"),
            )
            .unwrap()
        };
        let adapter = "-- fix: callin-unit-damaged-95\n";
        assert!(prelude(&[]).contains(adapter));
        let picked = prelude(std::slice::from_ref(&new_order));
        assert!(!picked.contains(adapter));
        assert!(picked.contains("-- fix: callin-allow-command-105\n"));
        assert_eq!(picked, prelude(&[new_order]));
    }

    #[test]
    fn remove_deletes_every_mutator_of_the_game_and_nothing_else() {
        let (_keep, data) = root();
        let build = |archive: &str, n: u32| {
            build_reading(
                &data,
                archive,
                "XTA 9.65",
                &DeclaredGame::default(),
                "1234abcd",
                n,
                "1.2.3",
                &[],
                no_file,
                no_models,
                no_defs,
            )
            .unwrap()
        };
        let first = build("xta-9.65.sd7", 1);
        let second = build("xta-9.65.sd7", coilbox_compat::latest());
        let other = build("other.sd7", coilbox_compat::latest());
        let mut expected = vec![first.folder.clone(), second.folder.clone()];
        expected.sort();
        assert_eq!(remove(&data, "xta-9.65.sd7").unwrap(), expected);
        assert!(!std::path::Path::new(&first.dir).exists());
        assert!(!std::path::Path::new(&second.dir).exists());
        assert!(std::path::Path::new(&other.dir).is_dir());
        assert_eq!(
            status_with(&data, "xta-9.65.sd7", "1234abcd", unread)
                .unwrap()
                .folder,
            None
        );
        assert!(remove(&data, "xta-9.65.sd7").unwrap().is_empty());
    }

    #[test]
    fn nothing_built_is_not_stale() {
        let (_keep, data) = root();
        let s = status_with(&data, "xta-9.65.sd7", "1234abcd", unread).unwrap();
        assert_eq!(s.folder, None);
        assert!(s.stale.is_empty());
    }

    #[test]
    fn a_rebuild_replaces_what_the_folder_held() {
        let (_keep, data) = root();
        let built = build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            &DeclaredGame::default(),
            "1234abcd",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            no_file,
            no_models,
            no_defs,
        )
        .unwrap();
        let leftover = std::path::Path::new(&built.dir).join("leftover.lua");
        std::fs::write(&leftover, "return {}").unwrap();
        build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            &DeclaredGame::default(),
            "5678",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            no_file,
            no_models,
            no_defs,
        )
        .unwrap();
        assert!(!leftover.exists());
        assert!(status_with(&data, "xta-9.65.sd7", "5678", unread)
            .unwrap()
            .stale
            .is_empty());
    }

    #[test]
    fn a_build_is_refused_without_a_checksum_a_manifest_or_a_content_root() {
        let (_keep, data) = root();
        assert!(build_reading(
            &data,
            "xta.sd7",
            "XTA",
            &DeclaredGame::default(),
            "",
            1,
            "1",
            &[],
            no_file,
            no_models,
            no_defs,
        )
        .is_err());
        assert!(build_reading(
            &data,
            "xta.sd7",
            "XTA",
            &DeclaredGame::default(),
            "1",
            9999,
            "1",
            &[],
            no_file,
            no_models,
            no_defs,
        )
        .is_err());
        assert!(build_reading(
            "relative",
            "xta.sd7",
            "XTA",
            &DeclaredGame::default(),
            "1",
            1,
            "1",
            &[],
            no_file,
            no_models,
            no_defs,
        )
        .is_err());
        assert!(build_reading(
            &data,
            "../xta.sd7",
            "XTA",
            &DeclaredGame::default(),
            "1",
            1,
            "1",
            &[],
            no_file,
            no_models,
            no_defs,
        )
        .is_err());
    }

    /// A base game for the golden build: its archive and name, the text files
    /// the build reads out of it, and the Lua the scan finds handlers in, by
    /// archive.
    struct Fixture {
        archive: &'static str,
        game: &'static str,
        short_name: Option<&'static str>,
        /// The modinfo `name` as written and the `version`, which differ from
        /// `game` for a game that lists its version apart from its name.
        declared: (Option<&'static str>, Option<&'static str>),
        files: &'static [(&'static str, &'static str)],
        lua: &'static [(&'static str, &'static str)],
    }

    const OLD_DAMAGED: &str = "function gadget:UnitDamaged(unitID, unitDefID, unitTeam, damage, paralyzer, weaponID, attackerID, attackerDefID, attackerTeam)\nend\n";
    const NEW_DAMAGED: &str = "gadget.UnitDamaged = function(self, unitID, unitDefID, unitTeam, damage, paralyzer, weaponDefID, projectileID, attackerID)\nend\n";
    const OLD_COMMAND: &str =
        "function gadget:AllowCommand(u, d, t, cmdID, params, options, tag, synced)\nend\n";
    const NEW_COMMAND: &str =
        "function AllowCommand(u, d, t, cmdID, params, options, tag, playerID, fromSynced)\nend\n";

    /// One game with every entry file, written for the old call-in orders,
    /// with a dependency written for the new ones. One updated for one change
    /// and both ways for the other, whose defs load `defs_post.lua`. One with
    /// only LuaUI, updated, which ships its own `defs_post.lua`, so gets no
    /// models.
    const FIXTURES: &[Fixture] = &[
        Fixture {
            archive: "xta-9.65.sd7",
            game: "XTA 9.65",
            short_name: Some("XTA"),
            declared: (Some("XTA"), Some("9.65")),
            files: &[
                ("LuaRules/main.lua", "-- rules\r\nreturn include('x')\n"),
                ("LuaRules/draw.lua", "-- draw, caf\u{e9}\n"),
                ("LuaGaia/main.lua", "-- gaia\n"),
                ("LuaGaia/draw.lua", ""),
                ("luaui.lua", "-- luaui.lua\n"),
                ("LuaUI/main.lua", "-- LuaUI/main.lua, never read\n"),
                ("LuaIntro/main.lua", "-- intro"),
            ],
            lua: &[
                ("xta-9.65.sd7", OLD_DAMAGED),
                ("xta-9.65.sd7", OLD_COMMAND),
                ("otherdep.sdz", NEW_DAMAGED),
                ("otherdep.sdz", NEW_COMMAND),
            ],
        },
        Fixture {
            archive: "BA-V9.79.SDZ",
            game: "Balanced \"Annihilation\" \\ V9.79",
            short_name: Some("BA\\\""),
            declared: (Some("Balanced \"Annihilation\" \\"), Some("V9.79")),
            files: &[
                ("LuaRules/main.lua", "-- rules\n"),
                ("gamedata/defs.lua", "LoadDefs('defs_post')\n"),
            ],
            lua: &[
                ("BA-V9.79.SDZ", NEW_DAMAGED),
                ("BA-V9.79.SDZ", "function gadget:UnitDamaged(u, ...)\nend\n"),
                ("BA-V9.79.SDZ", OLD_COMMAND),
                ("BA-V9.79.SDZ", NEW_COMMAND),
            ],
        },
        Fixture {
            archive: "SplinterFaction.sdd",
            game: "Splinter Faction 0.1.86",
            short_name: None,
            declared: (Some("Splinter Faction"), None),
            files: &[
                ("LuaUI/main.lua", "-- ui\n"),
                ("gamedata/defs_post.lua", "return {}\n"),
            ],
            lua: &[("SplinterFaction.sdd", NEW_DAMAGED)],
        },
    ];

    /// The Lua compat scan's answer for `fixture`, as the worker writes it.
    fn scan_of(fixture: &Fixture) -> String {
        let files: Vec<serde_json::Value> = fixture
            .lua
            .iter()
            .enumerate()
            .map(|(i, (archive, src))| {
                let hits = coilbox_luacompat::scan(src, coilbox_luacompat::Catalogue::embedded());
                serde_json::json!({
                    "archive": archive,
                    "path": format!("LuaRules/Gadgets/{i}.lua"),
                    "hits": hits,
                })
            })
            .collect();
        let mut archives = vec![fixture.archive];
        archives.extend(fixture.lua.iter().map(|(a, _)| *a));
        archives.dedup();
        serde_json::json!({ "files": files, "archives": archives, "errors": [] }).to_string()
    }

    /// What the worker's converter would write into `staging`, and its answer.
    fn run_converter(staging: &std::path::Path) -> Result<String, String> {
        for (path, bytes) in [
            ("Objects3D/ArmCom.s3o", &[0u8, 1, 2, 255][..]),
            ("objects3d/arm/Mech.s3o", &[3u8, 4][..]),
            ("unittextures/3do/objects3d.png", &[5u8][..]),
            ("unittextures/3do/objects3d.json", b"{}\n"),
        ] {
            let p = staging.join(path);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, bytes).unwrap();
        }
        Ok(r#"{"modelsFound":3,"modelsWritten":2,"palette":{"source":null,"sha256":null},"errors":[]}"#.into())
    }

    /// Every file but the marker of the mutator built for `fixture` from
    /// manifest `n`, as lower case paths and bytes. Lower case because the
    /// engine lowercases names when it checksums an archive, and a
    /// case-insensitive filesystem merges `Objects3D/` and `objects3d/`.
    fn golden_build(n: u32, fixture: &Fixture) -> Vec<(String, Vec<u8>)> {
        golden_build_of(&coilbox_compat::manifest(n).unwrap(), fixture)
    }

    /// [`golden_build`] from `manifest` as given.
    fn golden_build_of(
        manifest: &coilbox_compat::Manifest,
        fixture: &Fixture,
    ) -> Vec<(String, Vec<u8>)> {
        let (_keep, data) = root();
        let staging = tempfile::tempdir().unwrap();
        let read = |file: &str| -> Result<Option<String>, String> {
            Ok(fixture
                .files
                .iter()
                .find(|(path, _)| *path == file)
                .map(|(_, text)| text.to_string()))
        };
        let handlers = handlers::handlers_in(&scan_of(fixture), fixture.archive).unwrap();
        let built = build_with(
            &data,
            fixture.archive,
            fixture.game,
            &DeclaredGame {
                short_name: fixture.short_name.map(String::from),
                name: fixture.declared.0.map(String::from),
                version: fixture.declared.1.map(String::from),
            },
            "1234abcd",
            manifest,
            "1.2.3",
            &handlers,
            read,
            |file| Ok(read(file)?.map(String::into_bytes)),
            || models::convert_reading(read, || run_converter(staging.path()), staging.path()),
            no_defs,
            |_| Ok(standins_answer(GOLDEN_STANDINS)),
        )
        .unwrap();
        let dir = std::path::Path::new(&built.dir);
        let mut out: Vec<(String, Vec<u8>)> = models::list(dir)
            .unwrap()
            .into_iter()
            .filter(|path| path != mutator::MARKER)
            .map(|path| (path.to_lowercase(), std::fs::read(dir.join(&path)).unwrap()))
            .collect();
        out.sort();
        out
    }

    /// The defs the golden build's games give a stand-in, as the worker would
    /// find them: a wreck with a footprint and a weapon without one.
    const GOLDEN_STANDINS: &str = r#"[
        {"kind":"feature","name":"arm_infinity_dead","model":"arm_infinity_dead","standin":"compat/models/standin-3x2.s3o"},
        {"kind":"weapon","name":"shell","model":"shell.3do","standin":"compat/models/standin-1x1.s3o"}
    ]"#;

    /// What the golden build's games are there to cover, so a change to the
    /// fixtures that stops covering it fails here and not in silence.
    #[test]
    fn the_fixed_games_cover_each_rule() {
        let text = |files: &[(String, Vec<u8>)], path: &str| {
            files
                .iter()
                .find(|(p, _)| p == path)
                .map(|(_, b)| String::from_utf8(b.clone()).unwrap())
        };
        let paths = |files: &[(String, Vec<u8>)]| -> Vec<String> {
            files.iter().map(|(p, _)| p.clone()).collect()
        };
        let (damaged, command) = (
            "-- fix: callin-unit-damaged-95\n",
            "-- fix: callin-allow-command-105\n",
        );

        let full = golden_build(2, &FIXTURES[0]);
        let synced = text(&full, "compat/prelude-synced.lua").unwrap();
        assert!(synced.contains(damaged) && synced.contains(command));
        for path in [
            "luagaia/draw.lua",
            "luaintro/main.lua",
            "luarules/draw.lua",
            "luaui.lua",
            "objects3d/armcom.s3o",
            models::DEFS_POST,
        ] {
            assert!(paths(&full).iter().any(|p| p == path), "{path}");
        }
        assert!(!paths(&full).iter().any(|p| p == "luaui/main.lua"));

        let updated = golden_build(2, &FIXTURES[1]);
        let synced = text(&updated, "compat/prelude-synced.lua").unwrap();
        assert!(!synced.contains(damaged) && synced.contains(command));
        assert!(text(&updated, models::DEFS_POST).is_some());

        let ui_only = golden_build(2, &FIXTURES[2]);
        let unsynced = text(&ui_only, "compat/prelude-unsynced.lua").unwrap();
        assert!(!unsynced.contains(damaged));
        assert!(text(&ui_only, models::DEFS_POST).is_none());
        assert!(!paths(&ui_only).iter().any(|p| p.ends_with(".s3o")));

        let with_gadgets = golden_build(3, &FIXTURES[0]);
        for (path, _) in coilbox_compat::gadget_files(&coilbox_compat::manifest(3).unwrap()) {
            let path = path.to_lowercase();
            assert!(paths(&with_gadgets).contains(&path), "{path}");
        }

        let (commander, bombs) = (
            "-- fix: defs-commander-85\n",
            "-- fix: defs-manual-bomb-settings-92\n",
        );
        let weapons = "gamedata/weapondefs_post.lua";
        let with_defs = golden_build(5, &FIXTURES[0]);
        let post = text(&with_defs, models::DEFS_POST).unwrap();
        assert!(post.contains(commander) && post.contains("local converted = {"));
        assert!(text(&with_defs, weapons).unwrap().contains(bombs));
        assert!(!text(&full, models::DEFS_POST).unwrap().contains(commander));
        assert!(text(&full, weapons).is_none());
        let modinfo = |files: &[(String, Vec<u8>)]| text(files, "modinfo.lua").unwrap();
        assert!(modinfo(&golden_build(6, &FIXTURES[0])).contains("compatbasename = \"XTA\","));
        assert!(modinfo(&golden_build(6, &FIXTURES[2])).contains("compatbaseversion = \"\","));
        assert!(!modinfo(&with_defs).contains("compatbase"));
        let defs_only = golden_build(5, &FIXTURES[2]);
        assert!(text(&defs_only, models::DEFS_POST).is_none());
        assert!(text(&defs_only, weapons).unwrap().contains(bombs));

        let boxes = [
            "compat/models/standin-1x1.s3o",
            "compat/models/standin-3x2.s3o",
            "compat/models/standin.tga",
        ];
        let with_boxes = golden_build(10, &FIXTURES[0]);
        for path in boxes {
            assert!(paths(&with_boxes).iter().any(|p| p == path), "{path}");
        }
        assert!(text(&with_boxes, models::DEFS_POST)
            .unwrap()
            .contains("-- fix: defs-missing-model-standin\n"));
        assert!(!paths(&golden_build(9, &FIXTURES[0]))
            .iter()
            .any(|p| p.starts_with("compat/models/")));
        // A game with its own defs_post.lua runs no def fix there, so it gets
        // no boxes.
        assert!(!paths(&golden_build(10, &FIXTURES[2]))
            .iter()
            .any(|p| p.starts_with("compat/models/")));
    }

    /// The hash of every fixed game built from `manifest`.
    fn golden_hash(manifest: &coilbox_compat::Manifest) -> String {
        use sha2::{Digest, Sha256};
        let mut hash = Sha256::new();
        for fixture in FIXTURES {
            hash.update(fixture.archive.as_bytes());
            hash.update([0]);
            for (path, bytes) in golden_build_of(manifest, fixture) {
                hash.update(path.as_bytes());
                hash.update([0]);
                hash.update((bytes.len() as u64).to_le_bytes());
                hash.update(&bytes);
            }
        }
        hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
    }

    /// The hash of the fixed games built from each manifest, with the writer
    /// it names. Adding a manifest adds a line. A line that changes means the
    /// plugin, the prelude, the adapter choice or the handler scan writes
    /// different bytes than before for a manifest players may already have
    /// built (issue #4629).
    const GOLDEN: &[(u32, &str)] = &[
        (
            1,
            "679d265ba887f16b342fa9c22117c6fdd13879b25209e99c9716b99802a72db3",
        ),
        (
            2,
            "595eb4f1042f0b1f328da80a63044634b5ed60afd71bc5c2cd956af8a20deb18",
        ),
        (
            3,
            "7a0f8a84911b5cac4f21313e9a1490f9e19299c0a71e4e2d0f264f87a656d3cf",
        ),
        (
            4,
            "fc84ec81f4a375d31b5f9797580e141b6da9ba60cfcf98871ed38fde6da5f693",
        ),
        (
            5,
            "8a678ce14a48f4bff3503d89b553486e337779101ac2730effc825439648a7d5",
        ),
        (
            6,
            "76862d9aef98748f9106276e25025c72e84fd8599c4614757af78ddd23054283",
        ),
        (
            7,
            "991aba4284bf08486778b34d436818176d6304d7c2828a349f976a11b363d33b",
        ),
        (
            8,
            "989268ce40bf5778182d3bd9bff7f52a9295ab593598973e02bdd4dc5c11a121",
        ),
        (
            9,
            "fe0773afdc7d89040e08cd849ad9456074ef00d43aa0d42c9dcfb5eba9744e79",
        ),
        (
            10,
            "a2e6d720dd4c31135410c9cb3e9a39a527bbb1e3d089cfc14cc41fe6464cbed3",
        ),
        (
            11,
            "e5efcd9a94e2be746ab58d360d28d02ce131ea52fe460ca190182b92f9f0aada",
        ),
    ];

    #[test]
    fn the_fixed_games_build_the_same_bytes_from_every_manifest() {
        let built: Vec<(u32, String)> = (1..=coilbox_compat::latest())
            .map(|n| (n, golden_hash(&coilbox_compat::manifest(n).unwrap())))
            .collect();
        let recorded: Vec<(u32, String)> =
            GOLDEN.iter().map(|(n, h)| (*n, h.to_string())).collect();
        assert!(
            recorded == built,
            "the mutator a manifest builds changed. If a line below is new, add it. \
             If one moved, keep the old bytes for the writer that manifest names, put \
             the change behind a new coilbox_compat::WRITER and add a compat manifest \
             that names it:\n{built:#?}"
        );
    }

    /// Issue #4678: once `coilbox-3do-convert` moves past the version a manifest
    /// names, the build still takes that manifest and writes the bytes its
    /// golden line records. A changed pin stands in for the raised crate, since
    /// either way the two versions differ.
    #[test]
    fn a_raised_converter_version_still_builds_every_manifest_to_its_golden_bytes() {
        let raised = {
            let (major, rest) = coilbox_3do_convert::VERSION.split_once('.').unwrap();
            let minor: u32 = rest.split('.').next().unwrap().parse().unwrap();
            format!("{major}.{}.0", minor + 1)
        };
        for (n, golden) in GOLDEN {
            let mut manifest = coilbox_compat::manifest(*n).unwrap();
            assert_ne!(manifest.converter.version, raised);
            manifest.converter.version = raised.clone();
            assert_eq!(golden_hash(&manifest), *golden, "manifest {n}");
        }
    }

    fn some_models(staging: &std::path::Path) -> Result<models::Models, String> {
        for f in ["Objects3D/armcom.s3o", "unittextures/3do/objects3d.png"] {
            let p = staging.join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, [0u8, 1, 2, 255]).unwrap();
        }
        Ok(models::Models {
            dir: Some(staging.to_path_buf()),
            conversion: models::Conversion {
                models_found: 1,
                models_written: 1,
                ..Default::default()
            },
            palette: Some(a_palette()),
            notes: Vec::new(),
        })
    }

    #[test]
    fn converted_models_are_copied_in_and_named_in_defs_post_before_the_marker() {
        let (_keep, data) = root();
        let staging = tempfile::tempdir().unwrap();
        let built = build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            &DeclaredGame::default(),
            "1234abcd",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            no_file,
            || some_models(staging.path()),
            no_defs,
        )
        .unwrap();
        assert_eq!(
            built.files,
            [
                "LuaRules/Gadgets/coilbox_compat_aircraft_crash.lua",
                "LuaRules/Gadgets/coilbox_compat_messages_tdf.lua",
                "LuaRules/Gadgets/coilbox_compat_model_center_offset.lua",
                "LuaRules/Gadgets/coilbox_compat_only_forward_aim.lua",
                "Objects3D/armcom.s3o",
                "compat/models/standin-1x1.s3o",
                "compat/models/standin.tga",
                models::DEFS_POST,
                "gamedata/weapondefs_post.lua",
                "modinfo.lua",
                "unittextures/3do/objects3d.png",
                mutator::MARKER,
            ]
        );
        let dir = std::path::Path::new(&built.dir);
        assert_eq!(
            std::fs::read(dir.join("Objects3D/armcom.s3o")).unwrap(),
            [0u8, 1, 2, 255]
        );
        let post = std::fs::read_to_string(dir.join(models::DEFS_POST)).unwrap();
        assert!(post.contains(r#"["armcom"] = true,"#), "{post}");
        assert_eq!(built.models.models_written, 1);
        assert!(mutator::read_marker(dir).is_some());
    }

    /// Issue #4642: a build records the palette its models were coloured
    /// from, and is stale once a different `palette.pal` is reachable, as it
    /// is when the engine or a dependency that holds it changes.
    #[test]
    fn a_different_reachable_palette_makes_the_earlier_build_stale() {
        let (_keep, data) = root();
        let built = build_with_models(&data);
        let marker = mutator::read_marker(std::path::Path::new(&built.dir)).unwrap();
        assert_eq!(marker.palette, Some(a_palette()));
        let current = status_with(&data, "xta-9.65.sd7", "1234abcd", same_palette).unwrap();
        assert!(current.stale.is_empty(), "{:?}", current.stale);

        let other =
            coilbox_compat::Palette::of(Some(b"another palette"), Some("ba-deps.sdz".into()));
        let s = status_with(&data, "xta-9.65.sd7", "1234abcd", || Ok(other.clone())).unwrap();
        assert_eq!(
            s.stale,
            [Stale::Palette {
                built: a_palette(),
                now: other.clone()
            }]
        );
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("xta-compat.sdz");
        let err = export_with(
            &data,
            "xta-9.65.sd7",
            "1234abcd",
            dest.to_str().unwrap(),
            || Ok(other),
        )
        .unwrap_err();
        assert!(err.contains("out of date"), "{err}");
    }

    /// The marker sits in the folder, so the palette it records must not
    /// change what two players compare: the engine leaves dot files out of an
    /// archive's checksum, and every other file is the same bytes.
    #[test]
    fn recording_the_palette_changes_no_file_but_the_marker() {
        let files = |palette: Option<coilbox_compat::Palette>| {
            let (_keep, data) = root();
            let staging = tempfile::tempdir().unwrap();
            let built = build_reading(
                &data,
                "xta-9.65.sd7",
                "XTA 9.65",
                &DeclaredGame::default(),
                "1234abcd",
                coilbox_compat::latest(),
                "1.2.3",
                &[],
                no_file,
                || {
                    let mut models = some_models(staging.path())?;
                    models.palette = palette;
                    Ok(models)
                },
                no_defs,
            )
            .unwrap();
            let dir = std::path::Path::new(&built.dir);
            built
                .files
                .iter()
                .map(|path| (path.clone(), std::fs::read(dir.join(path)).unwrap()))
                .collect::<Vec<_>>()
        };
        let (with, without) = (files(Some(a_palette())), files(None));
        let marker = |files: &[(String, Vec<u8>)]| files.last().unwrap().clone();
        assert_eq!(marker(&with).0, mutator::MARKER);
        assert_ne!(marker(&with).1, marker(&without).1);
        assert_eq!(with[..with.len() - 1], without[..without.len() - 1]);
    }

    /// The prelude's wrapped entry files and the converted models land in the
    /// same folder, neither covering the other.
    #[test]
    fn the_prelude_and_the_models_are_both_written() {
        let (_keep, data) = root();
        let staging = tempfile::tempdir().unwrap();
        let read = |path: &str| -> Result<Option<String>, String> {
            Ok((path == "LuaRules/main.lua").then(|| "-- the game's own\n".to_string()))
        };
        let built = build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            &DeclaredGame::default(),
            "1234abcd",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            read,
            || some_models(staging.path()),
            no_defs,
        )
        .unwrap();
        for f in [
            "LuaRules/main.lua",
            models::DEFS_POST,
            "Objects3D/armcom.s3o",
        ] {
            assert!(built.files.iter().any(|b| b == f), "{f}: {:?}", built.files);
        }
        assert_eq!(built.files.last().unwrap(), mutator::MARKER);
    }

    #[test]
    fn a_failed_read_of_the_defs_is_noted_and_counts_nothing() {
        let (_keep, data) = root();
        let built = build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            &DeclaredGame::default(),
            "1234abcd",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            no_file,
            no_models,
            no_defs,
        )
        .unwrap();
        assert_eq!(built.def_overrides, 0);
        assert_eq!(built.notes.len(), 1);
        assert!(built.notes[0].contains("no defs in this test"));
    }

    #[test]
    fn a_manifest_without_def_fixes_never_reads_the_defs() {
        let (_keep, data) = root();
        let built = build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            &DeclaredGame::default(),
            "1234abcd",
            4,
            "1.2.3",
            &[],
            no_file,
            no_models,
            || panic!("read the defs for a manifest with no def fixes"),
        )
        .unwrap();
        assert!(built.notes.is_empty());
    }

    #[test]
    fn nothing_is_converted_for_a_request_that_is_refused() {
        let (_keep, data) = root();
        let refused = build_reading(
            &data,
            "xta.sd7",
            "XTA",
            &DeclaredGame::default(),
            "",
            1,
            "1",
            &[],
            no_file,
            || panic!("converted before the request was checked"),
            no_defs,
        );
        assert!(refused.is_err());
    }

    #[test]
    fn a_failed_conversion_writes_nothing() {
        let (_keep, data) = root();
        let failed = build_reading(
            &data,
            "xta.sd7",
            "XTA",
            &DeclaredGame::default(),
            "1",
            1,
            "1",
            &[],
            no_file,
            || Err("the 3do converter wrote nothing".into()),
            no_defs,
        );
        assert!(failed.is_err());
        assert!(!std::path::Path::new(&data).join("games").exists());
    }

    /// Issue #4686: the boxes are part of the mutator's bytes, so a build that
    /// could not find which defs need one stops, rather than write a mutator
    /// another player's build would not match.
    #[test]
    fn a_failed_search_for_missing_models_writes_nothing() {
        let (_keep, data) = root();
        let failed = build_reading_with_lua(
            &data,
            "xta.sd7",
            "XTA",
            &DeclaredGame::default(),
            "1",
            coilbox_compat::latest(),
            "1",
            &[],
            no_file,
            no_models,
            no_defs,
            |_| Err("unitsync lua exec timed out after 300s".into()),
        );
        assert_eq!(
            failed.err(),
            Some("unitsync lua exec timed out after 300s".into())
        );
        assert!(!std::path::Path::new(&data).join("games").exists());
    }

    fn build_with_models(data: &str) -> Built {
        let staging = tempfile::tempdir().unwrap();
        build_reading(
            data,
            "xta-9.65.sd7",
            "XTA 9.65",
            &DeclaredGame::default(),
            "1234abcd",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            no_file,
            || some_models(staging.path()),
            no_defs,
        )
        .unwrap()
    }

    fn zip_entries(path: &std::path::Path) -> Vec<(String, Vec<u8>)> {
        use std::io::Read;
        let mut zip = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
        (0..zip.len())
            .map(|i| {
                let mut entry = zip.by_index(i).unwrap();
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).unwrap();
                (entry.name().to_string(), bytes)
            })
            .collect()
    }

    /// Issue #4568: the archive holds the folder's files, in the order a build
    /// lists them, with the bytes the folder holds, binary models included.
    #[test]
    fn an_export_holds_the_folder_s_files_in_build_order() {
        let (_keep, data) = root();
        let built = build_with_models(&data);
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("xta-compat.sdz");

        let exported = export_with(
            &data,
            "xta-9.65.sd7",
            "1234abcd",
            dest.to_str().unwrap(),
            same_palette,
        )
        .unwrap();

        assert_eq!(exported.folder, built.folder);
        assert_eq!(exported.files, built.files);
        let entries = zip_entries(&dest);
        let names: Vec<&str> = entries.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, built.files);
        let dir = std::path::Path::new(&built.dir);
        for (name, bytes) in &entries {
            assert_eq!(&std::fs::read(dir.join(name)).unwrap(), bytes, "{name}");
        }
        assert_eq!(
            entries
                .iter()
                .find(|(n, _)| n == "Objects3D/armcom.s3o")
                .unwrap()
                .1,
            [0u8, 1, 2, 255]
        );
    }

    #[test]
    fn two_exports_of_one_folder_are_the_same_bytes() {
        let (_keep, data) = root();
        build_with_models(&data);
        let out = tempfile::tempdir().unwrap();
        let (a, b) = (out.path().join("a.sdz"), out.path().join("b.sdz"));
        export_with(
            &data,
            "xta-9.65.sd7",
            "1234abcd",
            a.to_str().unwrap(),
            same_palette,
        )
        .unwrap();
        export_with(
            &data,
            "xta-9.65.sd7",
            "1234abcd",
            b.to_str().unwrap(),
            same_palette,
        )
        .unwrap();
        assert_eq!(std::fs::read(a).unwrap(), std::fs::read(b).unwrap());
    }

    #[test]
    fn a_stale_mutator_is_not_exported() {
        let (_keep, data) = root();
        build_with_models(&data);
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("xta-compat.sdz");
        let err = export_with(
            &data,
            "xta-9.65.sd7",
            "99999999",
            dest.to_str().unwrap(),
            same_palette,
        )
        .unwrap_err();
        assert!(err.contains("out of date"), "{err}");
        assert!(!dest.exists());
    }

    #[test]
    fn nothing_is_exported_without_a_built_mutator_or_an_sdz_path() {
        let (_keep, data) = root();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("xta-compat.sdz");
        let err = export_with(
            &data,
            "xta-9.65.sd7",
            "1234abcd",
            dest.to_str().unwrap(),
            same_palette,
        )
        .unwrap_err();
        assert!(err.contains("no compat mutator"), "{err}");

        build_with_models(&data);
        let wrong = out.path().join("xta-compat.zip");
        let err = export_with(
            &data,
            "xta-9.65.sd7",
            "1234abcd",
            wrong.to_str().unwrap(),
            same_palette,
        )
        .unwrap_err();
        assert!(err.contains("does not end in .sdz"), "{err}");
        assert!(!dest.exists() && !wrong.exists());
    }
}
