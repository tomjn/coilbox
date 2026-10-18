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
    /// Why the converted models or the def fixes are not used, when they
    /// cannot be.
    pub notes: Vec<String>,
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
    let scan = tauri_plugin_coilbox_unitsync::lua_compat_scan_blocking(
        engine_path,
        data_dir,
        archive_name,
    )?;
    let handlers = handlers::handlers_in(&scan, archive_name)?;
    let staging = tempfile::tempdir()
        .map_err(|e| format!("could not make a folder to convert the models into: {e}"))?;
    let short_name = tauri_plugin_coilbox_unitsync::game_declared_short_name_blocking(
        engine_path,
        data_dir,
        game_name,
    )?;
    build_reading(
        data_dir,
        archive_name,
        game_name,
        short_name.as_deref(),
        base_checksum,
        manifest_version,
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
        || models::convert(engine_path, data_dir, archive_name, staging.path()),
    )
}

/// [`build`], with `read` returning a file of the base game by path,
/// `handlers` the call-in handlers the base game's Lua defines, and `convert`
/// its converted models. `convert` runs once the request is known to be sound,
/// and before anything is written.
#[allow(clippy::too_many_arguments)]
fn build_reading(
    data_dir: &str,
    archive_name: &str,
    game_name: &str,
    short_name: Option<&str>,
    base_checksum: &str,
    manifest_version: u32,
    coilbox_version: &str,
    handlers: &[coilbox_compat::Handler],
    mut read: impl FnMut(&str) -> Result<Option<String>, String>,
    convert: impl FnOnce() -> Result<models::Models, String>,
) -> Result<Built, String> {
    let manifest = coilbox_compat::manifest(manifest_version)
        .ok_or_else(|| format!("there is no compat manifest {manifest_version}"))?;
    mutator::check_pins(&manifest)?;
    let manifest = coilbox_compat::for_game(&manifest, handlers);
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
        writer: manifest.writer,
        base_checksum: base_checksum.to_string(),
        coilbox_version: coilbox_version.to_string(),
    };
    let mut files = mutator::files(&manifest, game_name, short_name, &marker, &mut read)?;
    let defs = defs::plan(&manifest, &mut read)?;
    let models = convert()?;
    let mut notes = models.notes.clone();
    notes.extend(defs.notes.iter().cloned());
    write_with_models(&dir, &mut files, &models, &defs, manifest_version).map(|files| Built {
        dir: dir.to_string_lossy().into_owned(),
        folder,
        files,
        models: models.conversion,
        notes,
    })
}

/// Write `files`, the converted `models` and the def files of `defs` into
/// `dir`, with the marker that ends `files` written last, so a write that
/// stops part way leaves none. Answers with every path written, sorted, with
/// the marker last.
fn write_with_models(
    dir: &std::path::Path,
    files: &mut Vec<tauri_plugin_coilbox_workshop::CompiledFile>,
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
    files.extend(post.into_iter().chain(defs.weapondefs_post.clone()));
    files.sort_by(|a, b| a.path.cmp(&b.path));
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
/// `data_dir` matches the latest manifest, the writer this build carries, and
/// the archive's current checksum.
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
        stale: mutator::staleness(
            marker.as_ref(),
            latest,
            coilbox_compat::WRITER,
            base_checksum,
        ),
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

    fn no_models() -> Result<models::Models, String> {
        Ok(models::Models::default())
    }

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
        let n = coilbox_compat::latest();
        let built = build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            None,
            "1234abcd",
            n,
            "1.2.3",
            &[],
            no_file,
            no_models,
        )
        .unwrap();
        assert_eq!(built.folder, format!("coilbox-compat-xta-9.65-{n}.sdd"));
        let gadgets: Vec<String> =
            coilbox_compat::gadget_files(&coilbox_compat::manifest(n).unwrap())
                .into_iter()
                .map(|(path, _)| path)
                .collect();
        let expected: Vec<String> = gadgets
            .into_iter()
            .chain([
                models::DEFS_POST.to_string(),
                "gamedata/weapondefs_post.lua".to_string(),
                "modinfo.lua".to_string(),
                mutator::MARKER.to_string(),
            ])
            .collect();
        assert_eq!(built.files, expected);
        let dir = std::path::Path::new(&built.dir);
        assert!(dir.join("modinfo.lua").is_file());
        assert_eq!(
            mutator::read_marker(dir).unwrap(),
            Marker {
                manifest_version: n,
                writer: coilbox_compat::WRITER,
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
            None,
            "1234abcd",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            no_file,
            no_models,
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
            None,
            "1234abcd",
            1,
            "1.2.3",
            &[],
            no_file,
            no_models,
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
            None,
            "1234abcd",
            2,
            "1.2.3",
            &[],
            read,
            no_models,
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
                None,
                "1234abcd",
                2,
                "1.2.3",
                handlers,
                read,
                no_models,
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
            None,
            "1234abcd",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            no_file,
            no_models,
        )
        .unwrap();
        let leftover = std::path::Path::new(&built.dir).join("leftover.lua");
        std::fs::write(&leftover, "return {}").unwrap();
        build_reading(
            &data,
            "xta-9.65.sd7",
            "XTA 9.65",
            None,
            "5678",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            no_file,
            no_models,
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
        assert!(build_reading(
            &data,
            "xta.sd7",
            "XTA",
            None,
            "",
            1,
            "1",
            &[],
            no_file,
            no_models
        )
        .is_err());
        assert!(build_reading(
            &data,
            "xta.sd7",
            "XTA",
            None,
            "1",
            9999,
            "1",
            &[],
            no_file,
            no_models
        )
        .is_err());
        assert!(build_reading(
            "relative",
            "xta.sd7",
            "XTA",
            None,
            "1",
            1,
            "1",
            &[],
            no_file,
            no_models
        )
        .is_err());
        assert!(build_reading(
            &data,
            "../xta.sd7",
            "XTA",
            None,
            "1",
            1,
            "1",
            &[],
            no_file,
            no_models
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
        Ok(r#"{"modelsFound":3,"modelsWritten":2,"errors":[]}"#.into())
    }

    /// Every file but the marker of the mutator built for `fixture` from
    /// manifest `n`, as lower case paths and bytes. Lower case because the
    /// engine lowercases names when it checksums an archive, and a
    /// case-insensitive filesystem merges `Objects3D/` and `objects3d/`.
    fn golden_build(n: u32, fixture: &Fixture) -> Vec<(String, Vec<u8>)> {
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
        let built = build_reading(
            &data,
            fixture.archive,
            fixture.game,
            fixture.short_name,
            "1234abcd",
            n,
            "1.2.3",
            &handlers,
            read,
            || models::convert_reading(read, || run_converter(staging.path()), staging.path()),
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
        let defs_only = golden_build(5, &FIXTURES[2]);
        assert!(text(&defs_only, models::DEFS_POST).is_none());
        assert!(text(&defs_only, weapons).unwrap().contains(bombs));
    }

    /// The hash of every fixed game built from manifest `n`.
    fn golden_hash(n: u32) -> String {
        use sha2::{Digest, Sha256};
        let mut hash = Sha256::new();
        for fixture in FIXTURES {
            hash.update(fixture.archive.as_bytes());
            hash.update([0]);
            for (path, bytes) in golden_build(n, fixture) {
                hash.update(path.as_bytes());
                hash.update([0]);
                hash.update((bytes.len() as u64).to_le_bytes());
                hash.update(&bytes);
            }
        }
        hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
    }

    /// The hash of the fixed games built from each manifest this writer builds.
    /// Adding a manifest adds a line. A line that changes means the plugin, the
    /// prelude, the adapter choice or the handler scan writes different bytes
    /// than before for a manifest players may already have built (issue
    /// #4629).
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
    ];

    #[test]
    fn the_fixed_games_build_the_same_bytes_from_every_manifest() {
        let built: Vec<(u32, String)> = (1..=coilbox_compat::latest())
            .filter(|n| {
                coilbox_compat::manifest(*n).is_some_and(|m| m.writer == coilbox_compat::WRITER)
            })
            .map(|n| (n, golden_hash(n)))
            .collect();
        let recorded: Vec<(u32, String)> =
            GOLDEN.iter().map(|(n, h)| (*n, h.to_string())).collect();
        assert_eq!(coilbox_compat::WRITER, 1);
        assert!(
            recorded == built,
            "the mutator a manifest builds changed. If a line below is new, add it. \
             If one moved, move coilbox_compat::WRITER, add a compat manifest that names \
             the new writer, and only then record the hashes:\n{built:#?}"
        );
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
            None,
            "1234abcd",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            no_file,
            || some_models(staging.path()),
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
            None,
            "1234abcd",
            coilbox_compat::latest(),
            "1.2.3",
            &[],
            read,
            || some_models(staging.path()),
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
    fn nothing_is_converted_for_a_request_that_is_refused() {
        let (_keep, data) = root();
        let refused = build_reading(
            &data,
            "xta.sd7",
            "XTA",
            None,
            "",
            1,
            "1",
            &[],
            no_file,
            || panic!("converted before the request was checked"),
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
            None,
            "1",
            1,
            "1",
            &[],
            no_file,
            || Err("the 3do converter wrote nothing".into()),
        );
        assert!(failed.is_err());
        assert!(!std::path::Path::new(&data).join("games").exists());
    }
}
