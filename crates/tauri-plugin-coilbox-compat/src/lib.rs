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

pub mod models;
pub mod mutator;

use picoframe_core::CliResult;
use serde::Serialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

pub use mutator::{Marker, Stale};

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
    /// Why the converted models are not used, when they cannot be.
    pub notes: Vec<String>,
}

/// Write the compat mutator for the game in `archive_name` under `data_dir`'s
/// `games/`, from manifest `manifest_version`, with the game's `.3do` models
/// converted by the worker for the engine at `engine_path`. Replaces whatever
/// the folder held. `game_name` and `base_checksum` are the game's name and its
/// archive's checksum as unitsync reports them.
pub fn build(
    engine_path: &str,
    data_dir: &str,
    archive_name: &str,
    game_name: &str,
    base_checksum: &str,
    manifest_version: u32,
    coilbox_version: &str,
) -> Result<Built, String> {
    let staging = tempfile::tempdir()
        .map_err(|e| format!("could not make a folder to convert the models into: {e}"))?;
    build_with(
        data_dir,
        archive_name,
        game_name,
        base_checksum,
        manifest_version,
        coilbox_version,
        || models::convert(engine_path, data_dir, archive_name, staging.path()),
    )
}

/// [`build`], with the models `convert` gives. It runs once the request is
/// known to be sound, and before anything is written.
pub fn build_with(
    data_dir: &str,
    archive_name: &str,
    game_name: &str,
    base_checksum: &str,
    manifest_version: u32,
    coilbox_version: &str,
    convert: impl FnOnce() -> Result<models::Models, String>,
) -> Result<Built, String> {
    let manifest = coilbox_compat::manifest(manifest_version)
        .ok_or_else(|| format!("there is no compat manifest {manifest_version}"))?;
    mutator::check_converter(&manifest)?;
    if base_checksum.trim().is_empty() {
        return Err(format!(
            "unitsync gave no checksum for {archive_name}, so a change to it could not be noticed"
        ));
    }
    let folder = mutator::folder(archive_name, manifest_version)?;
    let dir = mutator::games_dir(data_dir)?.join(&folder);
    coilbox_portable::refuse_in_bundle(&dir)?;
    let marker = Marker {
        manifest_version,
        base_checksum: base_checksum.to_string(),
        coilbox_version: coilbox_version.to_string(),
    };
    let mut files = mutator::files(&manifest, game_name, &marker)?;
    let models = convert()?;
    write_with_models(&dir, &mut files, &models, manifest_version).map(|files| Built {
        dir: dir.to_string_lossy().into_owned(),
        folder,
        files,
        models: models.conversion,
        notes: models.notes,
    })
}

/// Write `files` and the converted `models` into `dir`, with the marker that
/// ends `files` written last, so a write that stops part way leaves none.
/// Answers with every path written, sorted, with the marker last.
fn write_with_models(
    dir: &std::path::Path,
    files: &mut Vec<tauri_plugin_coilbox_workshop::CompiledFile>,
    models: &models::Models,
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
    if let Some(post) = models::defs_post(&models::model_keys(&converted), manifest_version) {
        files.push(post);
        files.sort_by(|a, b| a.path.cmp(&b.path));
    }
    tauri_plugin_coilbox_workshop::write_mutator(dir, files)?;
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
/// `data_dir` matches the latest manifest and the archive's current checksum.
pub fn status(data_dir: &str, archive_name: &str, base_checksum: &str) -> Result<Status, String> {
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
        stale: mutator::staleness(marker.as_ref(), latest, base_checksum),
        folder: Some(folder),
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
    engine_path: String,
    data_dir: String,
    archive_name: String,
    game_name: String,
    base_checksum: String,
    manifest_version: u32,
) -> CliResult {
    let version = app.package_info().version.to_string();
    let result = tauri::async_runtime::spawn_blocking(move || {
        build(
            &engine_path,
            &data_dir,
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

/// [`status`].
#[tauri::command]
async fn compat_status(data_dir: String, archive_name: String, base_checksum: String) -> CliResult {
    envelope(status(&data_dir, &archive_name, &base_checksum))
}

/// Build the plugin. Registered as `"coilbox-compat"` (crate name minus the
/// `tauri-plugin-` prefix).
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-compat")
        .invoke_handler(tauri::generate_handler![compat_build, compat_status])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        (dir, path)
    }

    /// A build of a game with no `.3do` models.
    fn plain(
        data: &str,
        archive: &str,
        game: &str,
        checksum: &str,
        n: u32,
        version: &str,
    ) -> Result<Built, String> {
        build_with(data, archive, game, checksum, n, version, || {
            Ok(models::Models::default())
        })
    }

    #[test]
    fn a_build_writes_the_folder_and_status_finds_it_current() {
        let (_keep, data) = root();
        let built = plain(&data, "xta-9.65.sd7", "XTA 9.65", "1234abcd", 1, "1.2.3").unwrap();
        assert_eq!(built.folder, "coilbox-compat-xta-9.65-1.sdd");
        assert_eq!(built.files, ["modinfo.lua", mutator::MARKER]);
        let dir = std::path::Path::new(&built.dir);
        assert!(dir.join("modinfo.lua").is_file());
        assert_eq!(
            mutator::read_marker(dir).unwrap(),
            Marker {
                manifest_version: 1,
                base_checksum: "1234abcd".into(),
                coilbox_version: "1.2.3".into(),
            }
        );
        assert_eq!(
            status(&data, "xta-9.65.sd7", "1234abcd").unwrap(),
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
        plain(&data, "xta-9.65.sd7", "XTA 9.65", "1234abcd", 1, "1.2.3").unwrap();
        let s = status(&data, "xta-9.65.sd7", "99999999").unwrap();
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
        let built = plain(&data, "xta-9.65.sd7", "XTA 9.65", "1234abcd", 1, "1.2.3").unwrap();
        // There is only one manifest so far, so a folder from a manifest this
        // build does not know stands in for one built before the manifest moved.
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
        let s = status(&data, "xta-9.65.sd7", "1234abcd").unwrap();
        assert_eq!(
            s.stale,
            [Stale::Manifest {
                built: other,
                now: coilbox_compat::latest()
            }]
        );
    }

    #[test]
    fn nothing_built_is_not_stale() {
        let (_keep, data) = root();
        let s = status(&data, "xta-9.65.sd7", "1234abcd").unwrap();
        assert_eq!(s.folder, None);
        assert!(s.stale.is_empty());
    }

    #[test]
    fn a_rebuild_replaces_what_the_folder_held() {
        let (_keep, data) = root();
        let built = plain(&data, "xta-9.65.sd7", "XTA 9.65", "1234abcd", 1, "1.2.3").unwrap();
        let leftover = std::path::Path::new(&built.dir).join("leftover.lua");
        std::fs::write(&leftover, "return {}").unwrap();
        plain(&data, "xta-9.65.sd7", "XTA 9.65", "5678", 1, "1.2.3").unwrap();
        assert!(!leftover.exists());
        assert!(status(&data, "xta-9.65.sd7", "5678")
            .unwrap()
            .stale
            .is_empty());
    }

    #[test]
    fn a_build_is_refused_without_a_checksum_a_manifest_or_a_content_root() {
        let (_keep, data) = root();
        assert!(plain(&data, "xta.sd7", "XTA", "", 1, "1").is_err());
        assert!(plain(&data, "xta.sd7", "XTA", "1", 9999, "1").is_err());
        assert!(plain("relative", "xta.sd7", "XTA", "1", 1, "1").is_err());
        assert!(plain(&data, "../xta.sd7", "XTA", "1", 1, "1").is_err());
    }

    #[test]
    fn converted_models_are_copied_in_and_named_in_defs_post_before_the_marker() {
        let (_keep, data) = root();
        let staging = tempfile::tempdir().unwrap();
        for f in ["Objects3D/armcom.s3o", "unittextures/3do/objects3d.png"] {
            let p = staging.path().join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, [0u8, 1, 2, 255]).unwrap();
        }
        let built = build_with(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            "1234abcd",
            1,
            "1.2.3",
            || {
                Ok(models::Models {
                    dir: Some(staging.path().to_path_buf()),
                    conversion: models::Conversion {
                        models_found: 1,
                        models_written: 1,
                        ..Default::default()
                    },
                    notes: Vec::new(),
                })
            },
        )
        .unwrap();
        assert_eq!(
            built.files,
            [
                "Objects3D/armcom.s3o",
                models::DEFS_POST,
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

    #[test]
    fn nothing_is_converted_for_a_request_that_is_refused() {
        let (_keep, data) = root();
        let refused = build_with(&data, "xta.sd7", "XTA", "", 1, "1", || {
            panic!("converted before the request was checked")
        });
        assert!(refused.is_err());
    }

    #[test]
    fn a_failed_conversion_writes_nothing() {
        let (_keep, data) = root();
        let failed = build_with(&data, "xta.sd7", "XTA", "1", 1, "1", || {
            Err("the 3do converter wrote nothing".into())
        });
        assert!(failed.is_err());
        assert!(!std::path::Path::new(&data).join("games").exists());
    }
}
