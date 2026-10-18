//! Compatibility mode's mutator (issue #4556): an old game wrapped in a
//! generated game that overlays fixes on it, on a current engine.
//!
//! `compat_build` writes `coilbox-compat-<stem>-<n>.sdd` under a content root's
//! `games/` from compat manifest `n`, and `compat_status` says whether the one
//! already there is stale. See `mutator` for the folder and its files.
//!
//! Registered as `"coilbox-compat"`. The frontend invokes
//! `plugin:coilbox-compat|<cmd>`.

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
}

/// Write the compat mutator for the game in `archive_name` under `data_dir`'s
/// `games/`, from manifest `manifest_version`. Replaces whatever the folder
/// held. `game_name` and `base_checksum` are the game's name and its archive's
/// checksum as unitsync reports them. The game's Lua entry files are read
/// through the unitsync worker of the engine at `engine_path`.
pub fn build(
    data_dir: &str,
    engine_path: &str,
    archive_name: &str,
    game_name: &str,
    base_checksum: &str,
    manifest_version: u32,
    coilbox_version: &str,
) -> Result<Built, String> {
    build_reading(
        data_dir,
        archive_name,
        game_name,
        base_checksum,
        manifest_version,
        coilbox_version,
        |file| {
            tauri_plugin_coilbox_unitsync::archive_text_blocking(
                engine_path,
                data_dir,
                archive_name,
                file,
            )
        },
    )
}

/// [`build`], with `read` returning a file of the base game by path.
fn build_reading(
    data_dir: &str,
    archive_name: &str,
    game_name: &str,
    base_checksum: &str,
    manifest_version: u32,
    coilbox_version: &str,
    read: impl FnMut(&str) -> Result<Option<String>, String>,
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
    let files = mutator::files(&manifest, game_name, &marker, read)?;
    tauri_plugin_coilbox_workshop::write_mutator(&dir, &files)?;
    Ok(Built {
        dir: dir.to_string_lossy().into_owned(),
        folder,
        files: files.into_iter().map(|f| f.path).collect(),
    })
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

/// [`build`], recording the running coilbox's version in the marker.
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
    envelope(build(
        &data_dir,
        &engine_path,
        &archive_name,
        &game_name,
        &base_checksum,
        manifest_version,
        &version,
    ))
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

    fn no_file(_: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn root() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        (dir, path)
    }

    #[test]
    fn a_build_writes_the_folder_and_status_finds_it_current() {
        let (_keep, data) = root();
        let built = build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            "1234abcd",
            1,
            "1.2.3",
            no_file,
        )
        .unwrap();
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
        build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            "1234abcd",
            1,
            "1.2.3",
            no_file,
        )
        .unwrap();
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
        let built = build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            "1234abcd",
            1,
            "1.2.3",
            no_file,
        )
        .unwrap();
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
    fn a_build_from_manifest_2_writes_the_prelude_and_the_wrapped_entry_file() {
        let (_keep, data) = root();
        let read = |file: &str| -> Result<Option<String>, String> {
            Ok((file == "LuaRules/main.lua").then(|| "-- rules\n".to_string()))
        };
        let built = build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            "1234abcd",
            2,
            "1.2.3",
            read,
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
        let built = build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            "1234abcd",
            1,
            "1.2.3",
            no_file,
        )
        .unwrap();
        let leftover = std::path::Path::new(&built.dir).join("leftover.lua");
        std::fs::write(&leftover, "return {}").unwrap();
        build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            "5678",
            1,
            "1.2.3",
            no_file,
        )
        .unwrap();
        assert!(!leftover.exists());
        assert!(status(&data, "xta-9.65.sd7", "5678")
            .unwrap()
            .stale
            .is_empty());
    }

    #[test]
    fn a_build_is_refused_without_a_checksum_a_manifest_or_a_content_root() {
        let (_keep, data) = root();
        assert!(build_reading(&data, "xta.sd7", "XTA", "", 1, "1", no_file).is_err());
        assert!(build_reading(&data, "xta.sd7", "XTA", "1", 9999, "1", no_file).is_err());
        assert!(build_reading("relative", "xta.sd7", "XTA", "1", 1, "1", no_file).is_err());
        assert!(build_reading(&data, "../xta.sd7", "XTA", "1", 1, "1", no_file).is_err());
    }
}
