//! The gadget fixes load in `coilbox-springlua`, the sandboxed Lua 5.1 the app
//! evaluates game Lua in, in the state each is for (issue #4559). The engine's
//! Lua is 5.1 too, so this catches code that only LuaJIT, which the tests in
//! `lua/compat/tests/` run under, would accept. What the gadgets do is tested
//! there.

use std::collections::BTreeMap;
use std::path::PathBuf;

use coilbox_compat::{gadget_files, manifest};
use coilbox_springlua::SpringLua;
use serde_json::Value;

/// Loads the gadget at `path` the way a gadget handler does, in the synced or
/// unsynced state, and says what it returned and the name it registers.
fn load(path: &str, source: &str, synced: bool) -> Value {
    let dir = tempfile::tempdir().unwrap();
    let files = BTreeMap::from([(dir.path().join(path), source.to_string())]);
    SpringLua::with_files(dir.path(), files)
        .unwrap()
        .eval_value_raw(
            &format!(
                r#"
                gadget = {{}}
                gadgetHandler = {{ IsSyncedCode = function() return {synced} end }}
                local returned = VFS.Include("{path}")
                return {{
                    off = returned == false,
                    name = gadget.GetInfo(gadget).name,
                    callIns = type(gadget.Initialize),
                }}
                "#
            ),
            "probe",
        )
        .unwrap()
}

#[test]
fn every_gadget_loads_in_lua_5_1_and_only_in_its_own_state() {
    let files: Vec<(String, String)> = [3, 4, 5]
        .into_iter()
        .flat_map(|n| gadget_files(&manifest(n).unwrap()))
        .collect();
    assert_eq!(files.len(), 10);
    for (path, source) in &files {
        let name = PathBuf::from(path)
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let unsynced_only = name == "coilbox_compat_messages_tdf";
        for synced in [true, false] {
            let got = load(path, source, synced);
            assert_eq!(got["name"], name.as_str(), "{path}");
            let runs_here = synced != unsynced_only;
            assert_eq!(got["off"], !runs_here, "{path}, synced {synced}");
            if runs_here {
                assert_eq!(got["callIns"], "function", "{path}");
            }
        }
    }
}

/// The aircraft gadget of manifest `n` and where the mutator writes it.
fn aircraft_gadget(n: u32) -> (String, String) {
    gadget_files(&manifest(n).unwrap())
        .into_iter()
        .find(|(p, _)| p.ends_with("coilbox_compat_aircraft_crash.lua"))
        .unwrap()
}

/// Whether the aircraft gadget of manifest `n` removes itself in Lua 5.1 in a
/// game of one plane whose script is `scripts/plane.cob`, with `files` as the
/// game's other files.
fn aircraft_removed(n: u32, files: &[(&str, &str)]) -> bool {
    let (path, source) = aircraft_gadget(n);
    let dir = tempfile::tempdir().unwrap();
    // VFS.DirList lists the disk only, so the game's files are written there.
    for (file, text) in files {
        let at = dir.path().join(file);
        std::fs::create_dir_all(at.parent().unwrap()).unwrap();
        std::fs::write(at, text).unwrap();
    }
    let all = BTreeMap::from([(dir.path().join(&path), source)]);
    let got = SpringLua::with_files(dir.path(), all)
        .unwrap()
        .eval_value_raw(
            &format!(
                r#"
                gadget = {{}}
                REMOVED = false
                gadgetHandler = {{
                    IsSyncedCode = function() return true end,
                    RemoveGadget = function() REMOVED = true end,
                }}
                UnitDefs = {{ [1] = {{ isStrafingAirUnit = true, scriptName = "scripts/plane.cob" }} }}
                VFS.Include("{path}")
                gadget:Initialize()
                return {{ removed = REMOVED }}
                "#
            ),
            "probe",
        )
        .unwrap();
    got["removed"] == true
}

/// The pattern the aircraft gadget finds `set CRASHING to <value>` with, run by
/// Lua 5.1, whose patterns cannot hold a zero byte, on the bytes a COB
/// compiler writes for it: push 97, push 1, then SET.
#[test]
fn the_aircraft_gadget_finds_set_crashing_in_a_cob_script_under_lua_5_1() {
    let push97 = "\u{1}\u{10}\u{2}\u{10}a\0\0\0";
    let push1 = "\u{1}\u{10}\u{2}\u{10}\u{1}\0\0\0";
    let set = "\0 \u{8}\u{10}";
    let get = "\0 \u{4}\u{10}";
    for n in [3, 4] {
        for (script, crashes) in [
            (format!("{push97}{push1}{set}"), true),
            (format!("{push97}{get}{push1}{set}"), false),
            (format!("{push1}{push1}{set}"), false),
        ] {
            let removed = aircraft_removed(n, &[("scripts/plane.cob", &script)]);
            assert_eq!(removed, crashes, "manifest {n}, {script:?}");
        }
    }
}

/// The patterns the aircraft gadget of manifest 4 reads a game's gadgets with
/// (#4638), run by Lua 5.1: a call to a function 0.82 did not have turns it off,
/// and one in a comment, outside LuaRules/Gadgets/ or defined by the game does
/// not.
#[test]
fn the_aircraft_gadget_turns_off_for_a_newer_game_under_lua_5_1() {
    let newer = "local upitch, uyaw, uroll = Spring.GetUnitRotation(unitID)";
    assert!(aircraft_removed(
        4,
        &[("LuaRules/Gadgets/unit_airbase.lua", newer)]
    ));
    assert!(!aircraft_removed(
        3,
        &[("LuaRules/Gadgets/unit_airbase.lua", newer)]
    ));
    assert!(!aircraft_removed(
        4,
        &[
            (
                "LuaRules/Gadgets/unit_dynamic_collision_volume.lua",
                "--[[\nSpring.GetFeatureCollisionVolumeData(featureID)\n]]--\n-- Spring.GetUnitRotation(1)",
            ),
            (
                "LuaRules/Deploy/main.lua",
                "if Spring.GetModOption(\"gamemode\") then end",
            ),
        ]
    ));
    assert!(!aircraft_removed(
        4,
        &[
            (
                "LuaRules/main.lua",
                "function Spring.GetModOption(s, bool, default) end",
            ),
            (
                "LuaRules/Gadgets/start_unit_setup.lua",
                "local mode = Spring.GetModOption(\"startingresourcetype\")",
            ),
        ]
    ));
}
