//! A mission in the workshop's test game (issue #3178).
//!
//! "Start with this unit on the map" launches a mission the frontend generated
//! in memory, so the game needs two things in its archive: the mission at
//! `missions/<id>/mission.lua`, and the mission runtime that reads it. Most
//! games do not bundle the runtime, so the files go into the same fixed folder
//! the test mutator already writes (`mutator::FOLDER`), which depends on the
//! base game for everything else.
//!
//! The runtime is installed with the scenario plugin's own `runtime::install`,
//! the call `scenario_test_mutator` makes, so there is one copy of the rules
//! for which files make up the runtime.
//!
//! Two shapes of the folder use this:
//!
//! - The mutator route writes the compiled project first (`write_mutator`) and
//!   this adds to it. No `modinfo` is passed, and the folder must already hold
//!   one.
//! - The tweak slot route has no compiled files, because the edits travel in
//!   the `tweakdefs` mod option and the game's own `unitdefs_post.lua` has to
//!   keep reading them. A `modinfo` is passed and the folder is cleared first,
//!   so it holds that, the runtime and the mission, and no `gamedata/` at all.
//!   A `gamedata/unitdefs_post.lua` here would shadow the game's own.

use crate::compile::CompiledFile;
use crate::mutator;
use coilbox_portable::valid_id;
use std::path::Path;
use tauri_plugin_coilbox_scenario::runtime;

/// Put a mission, and the runtime when `runtime_src` is given, into the test
/// game at `dir`. Returns every file written, relative to `dir`.
///
/// `modinfo` starts the folder afresh: it is cleared and holds that `modinfo.lua`
/// before anything else is added. `None` adds to what is there, and refuses a
/// folder with no `modinfo.lua` rather than leaving files in something the
/// engine cannot launch.
pub fn write(
    dir: &Path,
    runtime_src: Option<&Path>,
    mission_id: &str,
    mission: &str,
    modinfo: Option<&str>,
) -> Result<Vec<String>, String> {
    if !valid_id(mission_id) {
        return Err(format!("invalid mission id: {mission_id}"));
    }
    match modinfo {
        Some(modinfo) => mutator::write_mutator(
            dir,
            &[CompiledFile {
                path: "modinfo.lua".to_string(),
                contents: modinfo.to_string(),
            }],
        )?,
        None => {
            if !dir.join("modinfo.lua").is_file() {
                return Err(format!(
                    "{} has no modinfo.lua, so the test game has not been written yet",
                    dir.display()
                ));
            }
        }
    }
    let mut files = match runtime_src {
        Some(src) => runtime::install(src, dir)?,
        None => Vec::new(),
    };
    let folder = dir.join("missions").join(mission_id);
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("could not create {}: {e}", folder.display()))?;
    let target = folder.join("mission.lua");
    std::fs::write(&target, mission)
        .map_err(|e| format!("could not write {}: {e}", target.display()))?;
    files.push(format!("missions/{mission_id}/mission.lua"));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in for the shipped runtime, the same shape the scenario
    /// plugin's own tests use.
    fn runtime_tree() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        for (rel, body) in [
            ("missions/runtime.lua", "return { version = 1 }"),
            ("luarules/gadgets/coilbox_mission_runtime.lua", "-- gadget"),
            ("luaui/widgets/coilbox_objectives.lua", "-- widget"),
            ("README.md", "not vendored"),
        ] {
            let path = dir.path().join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).expect("mkdir");
            std::fs::write(path, body).expect("write");
        }
        dir
    }

    fn game_with_compiled_files() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        for rel in ["modinfo.lua", "gamedata/unitdefs_post.lua"] {
            let path = dir.path().join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).expect("mkdir");
            std::fs::write(path, "return {}").expect("write");
        }
        dir
    }

    #[test]
    fn the_mutator_route_adds_the_runtime_and_mission_beside_the_compiled_files() {
        let src = runtime_tree();
        let game = game_with_compiled_files();

        let files = write(game.path(), Some(src.path()), "t-1", "return {}", None).expect("write");

        assert!(files.contains(&"missions/t-1/mission.lua".to_string()));
        assert!(files.contains(&"luarules/gadgets/coilbox_mission_runtime.lua".to_string()));
        assert!(game.path().join("gamedata/unitdefs_post.lua").is_file());
        assert!(game.path().join("missions/runtime.lua").is_file());
        assert_eq!(
            std::fs::read_to_string(game.path().join("missions/t-1/mission.lua")).expect("read"),
            "return {}"
        );
        assert!(!game.path().join("README.md").exists());
    }

    /// The tweak slot route must not leave a `gamedata/` behind from an earlier
    /// mutator test, or it would shadow the game's own `unitdefs_post.lua`.
    #[test]
    fn the_tweak_slot_route_ships_no_gamedata() {
        let src = runtime_tree();
        let game = game_with_compiled_files();

        let files = write(
            game.path(),
            Some(src.path()),
            "t-1",
            "return {}",
            Some("return { name = 'x' }"),
        )
        .expect("write");

        assert!(!game.path().join("gamedata").exists());
        assert!(!files.iter().any(|f| f.starts_with("gamedata")));
        assert_eq!(
            std::fs::read_to_string(game.path().join("modinfo.lua")).expect("read"),
            "return { name = 'x' }"
        );
        assert!(game.path().join("missions/t-1/mission.lua").is_file());
    }

    /// A base game that already bundles the runtime gets only the mission, so
    /// the generated game does not shadow the game's runtime with another.
    #[test]
    fn without_a_runtime_only_the_mission_is_added() {
        let game = game_with_compiled_files();

        let files = write(game.path(), None, "t-1", "return {}", None).expect("write");

        assert_eq!(files, vec!["missions/t-1/mission.lua".to_string()]);
        assert!(!game.path().join("luarules").exists());
    }

    #[test]
    fn a_second_write_replaces_the_first_mission() {
        let src = runtime_tree();
        let game = tempfile::tempdir().expect("tempdir");
        write(game.path(), Some(src.path()), "a", "one", Some("m")).expect("first");
        write(game.path(), Some(src.path()), "b", "two", Some("m")).expect("second");

        assert!(!game.path().join("missions/a").exists());
        assert!(game.path().join("missions/b/mission.lua").is_file());
    }

    #[test]
    fn a_folder_with_no_modinfo_is_refused_when_none_is_given() {
        let game = tempfile::tempdir().expect("tempdir");
        let err = write(game.path(), None, "t-1", "return {}", None).expect_err("refused");
        assert!(err.contains("modinfo.lua"), "{err}");
        assert!(!game.path().join("missions").exists());
    }

    #[test]
    fn an_unsafe_mission_id_is_refused() {
        let game = game_with_compiled_files();
        assert!(write(game.path(), None, "../x", "return {}", None).is_err());
        assert!(write(game.path(), None, "", "return {}", None).is_err());
    }

    #[test]
    fn a_runtime_with_no_files_is_an_error() {
        let empty = tempfile::tempdir().expect("tempdir");
        let game = game_with_compiled_files();
        assert!(write(game.path(), Some(empty.path()), "t-1", "return {}", None).is_err());
    }
}
