//! The sandbox half of the scratch game, for "Play with this unit" (issue
//! #3341).
//!
//! The frontend generates the files (`src/lego/sandbox.ts`): a build menu
//! entry that puts the unit on the base game's builder, a gadget that holds the
//! targets still, and a compiled mission. This puts them where the engine looks
//! for each, and adds the mission runtime that plays the mission unless the base
//! game already bundles one. Everything lands inside the scratch folder, so
//! deleting it still undoes the lot.
//!
//! The runtime goes in with the scenario plugin's own `runtime::install`, the
//! call the workshop's test makes, so there is one copy of the rules for which
//! files make up the runtime.

use crate::write_scratch_file;
use coilbox_portable::valid_id;
use serde::Deserialize;
use std::path::Path;
use tauri_plugin_coilbox_scenario::runtime;

/// The build menu entry. The engine's base `gamedata/unitdefs.lua` reads every
/// `download/*.tdf` and appends each entry to the builder it names.
const DOWNLOAD: &[&str] = &["download", "coilbox_sandbox.tdf"];

/// The gadget that holds the targets still. Beside the start unit gadget, with
/// the same casing, so the engine sees one `LuaRules/Gadgets` folder.
const GADGET: &[&str] = &["LuaRules", "Gadgets", "coilbox_sandbox.lua"];

/// What the frontend generated for the sandbox.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sandbox {
    pub download: String,
    pub gadget: String,
    pub mission_id: String,
    pub mission: String,
    /// False when the base game already bundles a runtime new enough for the
    /// mission. Shipping a second one would shadow it.
    pub ship_runtime: bool,
}

/// Write the sandbox's files into the scratch game at `dir`. `runtime_src` is
/// the runtime to install, and is only read when the sandbox asks for one.
/// Returns every file written, relative to `dir`.
///
/// Call it before the scratch game's own files are written: installing the
/// runtime removes the start unit gadget, for the reason given below.
pub fn write(
    dir: &Path,
    sandbox: &Sandbox,
    runtime_src: Option<&Path>,
) -> Result<Vec<String>, String> {
    if !valid_id(&sandbox.mission_id) {
        return Err(format!("invalid mission id: {}", sandbox.mission_id));
    }
    // The runtime first. Its install removes every `coilbox_*` file under
    // `luarules/` it did not write, which is how a gadget dropped between
    // runtime versions goes, and the sandbox gadget is one of those names.
    let mut files = Vec::new();
    if sandbox.ship_runtime {
        let src = runtime_src.ok_or("could not find the bundled mission runtime")?;
        // The install spells each folder the way the game already does, so
        // making the gadget folder first keeps one `LuaRules/` on a
        // case-sensitive filesystem rather than a `luarules/` beside it.
        let gadgets = dir.join(GADGET[0]).join(GADGET[1]);
        std::fs::create_dir_all(&gadgets)
            .map_err(|e| format!("could not create {}: {e}", gadgets.display()))?;
        files.extend(runtime::install(src, dir)?);
    }
    write_scratch_file(dir, DOWNLOAD, &sandbox.download)?;
    write_scratch_file(dir, GADGET, &sandbox.gadget)?;
    files.extend([DOWNLOAD.join("/"), GADGET.join("/")]);
    write_scratch_file(
        dir,
        &["missions", &sandbox.mission_id, "mission.lua"],
        &sandbox.mission,
    )?;
    files.push(format!("missions/{}/mission.lua", sandbox.mission_id));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in for the shipped runtime, the same shape the workshop's tests
    /// use.
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

    fn sandbox(ship_runtime: bool) -> Sandbox {
        Sandbox {
            download: "[MENUENTRY1]".into(),
            gadget: "-- sandbox".into(),
            mission_id: "coilbox-lego-sandbox".into(),
            mission: "return {}".into(),
            ship_runtime,
        }
    }

    /// The scratch game as the start unit gadget leaves it, which is what the
    /// sandbox is written into.
    fn scratch() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        write_scratch_file(
            dir.path(),
            &["LuaRules", "Gadgets", "coilbox_start_unit.lua"],
            "-",
        )
        .expect("write");
        dir
    }

    #[test]
    fn every_file_lands_where_the_engine_looks_for_it() {
        let src = runtime_tree();
        let game = scratch();

        let files = write(game.path(), &sandbox(true), Some(src.path())).expect("write");

        let read = |rel: &str| std::fs::read_to_string(game.path().join(rel)).expect(rel);
        assert_eq!(read("download/coilbox_sandbox.tdf"), "[MENUENTRY1]");
        assert_eq!(read("LuaRules/Gadgets/coilbox_sandbox.lua"), "-- sandbox");
        assert_eq!(
            read("missions/coilbox-lego-sandbox/mission.lua"),
            "return {}"
        );
        assert_eq!(read("missions/runtime.lua"), "return { version = 1 }");
        // The runtime follows the folder casing the scratch game already has.
        assert_eq!(
            read("LuaRules/Gadgets/coilbox_mission_runtime.lua"),
            "-- gadget"
        );
        assert!(!game.path().join("README.md").exists());
        assert!(files.contains(&"download/coilbox_sandbox.tdf".to_string()));
        assert!(files.contains(&"missions/coilbox-lego-sandbox/mission.lua".to_string()));
    }

    #[test]
    fn a_base_game_with_its_own_runtime_gets_only_the_mission() {
        let game = scratch();

        let files = write(game.path(), &sandbox(false), None).expect("write");

        assert!(!game.path().join("missions/runtime.lua").exists());
        assert!(!game.path().join("luaui").exists());
        assert_eq!(files.len(), 3);
    }

    #[test]
    fn a_runtime_asked_for_and_not_found_is_an_error() {
        let game = scratch();
        let err = write(game.path(), &sandbox(true), None).expect_err("refused");
        assert!(err.contains("runtime"), "{err}");
    }

    #[test]
    fn an_unsafe_mission_id_is_refused_before_anything_is_written() {
        let game = scratch();
        let mut bad = sandbox(false);
        bad.mission_id = "../x".into();

        assert!(write(game.path(), &bad, None).is_err());
        assert!(!game.path().join("download").exists());
    }
}
