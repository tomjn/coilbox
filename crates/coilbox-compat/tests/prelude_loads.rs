//! The built preludes run in `coilbox-springlua`, the sandboxed Lua 5.1 the
//! app evaluates game Lua in, and define what they claim (issue #4558).
//!
//! The sandbox has an empty `Spring` table and no `gl`, `Script` or unit data,
//! so this checks that every fix loads with nothing to lean on. What the
//! functions do is tested under luajit in `lua/compat/tests/`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use coilbox_compat::{manifest, prelude, prelude_files, LuaState};
use coilbox_springlua::SpringLua;
use serde_json::Value;

fn run(root: &Path, files: BTreeMap<PathBuf, String>, src: &str) -> Value {
    SpringLua::with_files(root, files)
        .unwrap()
        .eval_value_raw(src, "probe")
        .unwrap()
}

fn with_prelude(root: &Path, state: LuaState) -> BTreeMap<PathBuf, String> {
    let m = manifest(2).unwrap();
    BTreeMap::from([(root.join(state.prelude_path()), prelude(&m, state).unwrap())])
}

#[test]
fn the_synced_prelude_defines_the_removed_synced_functions() {
    let dir = tempfile::tempdir().unwrap();
    let files = with_prelude(dir.path(), LuaState::Synced);
    let got = run(
        dir.path(),
        files,
        r#"
        Spring.Echo = function(message) FAILED = message end
        VFS.Include("compat/prelude-synced.lua")
        return {
            failed = FAILED,
            get = type(Spring.GetUnitTravel),
            set = type(Spring.SetUnitTravel),
            toFeature = type(Spring.SetUnitToFeature),
            makeFont = type(Spring.MakeFont),
            unitDamaged = type(UnitDamaged),
            unitDestroyed = type(UnitDestroyed),
            allowFeature = type(AllowFeatureCreation),
            allowCommand = type(AllowCommand),
        }
        "#,
    );
    assert_eq!(got["failed"], Value::Null, "a fix failed");
    assert_eq!(got["get"], "function");
    assert_eq!(got["set"], "function");
    assert_eq!(got["toFeature"], "function");
    assert_eq!(got["makeFont"], "nil", "MakeFont is unsynced only");
    // An adapter has nothing to adapt until the game's handler sets the
    // call-in. A fix that has to hear the call-in keeps it registered.
    assert_eq!(got["unitDamaged"], "nil");
    assert_eq!(got["allowCommand"], "nil");
    assert_eq!(got["unitDestroyed"], "function");
    assert_eq!(got["allowFeature"], "function");
}

#[test]
fn the_unsynced_prelude_defines_the_removed_unsynced_functions() {
    let dir = tempfile::tempdir().unwrap();
    let files = with_prelude(dir.path(), LuaState::Unsynced);
    let got = run(
        dir.path(),
        files,
        r#"
        gl = {}
        Spring.Echo = function(message) FAILED = message end
        VFS.Include("compat/prelude-unsynced.lua")
        return {
            failed = FAILED,
            smoothing = type(gl.Smoothing),
            makeFont = type(Spring.MakeFont),
            makeFontResult = Spring.MakeFont("font.ttf", {}) == nil,
            infoTexture = Spring.UpdateInfoTexture(1),
            sun = type(Spring.SetSunParameters),
            sunControl = type(Spring.SetSunManualControl),
            travel = type(Spring.GetUnitTravel),
        }
        "#,
    );
    assert_eq!(got["failed"], Value::Null, "a fix failed");
    assert_eq!(got["smoothing"], "function");
    assert_eq!(got["makeFont"], "function");
    assert_eq!(got["makeFontResult"], true);
    assert_eq!(got["infoTexture"], false);
    assert_eq!(got["sun"], "function");
    assert_eq!(got["sunControl"], "function");
    assert_eq!(got["travel"], "nil", "travel is synced only");
}

#[test]
fn a_function_the_engine_still_has_is_left_alone() {
    let dir = tempfile::tempdir().unwrap();
    let files = with_prelude(dir.path(), LuaState::Unsynced);
    let got = run(
        dir.path(),
        files,
        r#"
        local own = function() return "own" end
        Spring.MakeFont = own
        VFS.Include("compat/prelude-unsynced.lua")
        return { same = Spring.MakeFont == own }
        "#,
    );
    assert_eq!(got["same"], true);
}

fn ee_archive() -> PathBuf {
    std::env::var_os("COILBOX_COMPAT_EE").map_or_else(
        || {
            PathBuf::from(std::env::var("HOME").unwrap())
                .join(".spring/games/expand_and_exterminate-0.46_for_spring_0.88.sdz")
        },
        PathBuf::from,
    )
}

/// A file from a zip archive, matched without regard to case as the engine's
/// VFS matches it.
fn read_from_zip(archive: &mut zip::ZipArchive<std::fs::File>, path: &str) -> Option<String> {
    let name = archive
        .file_names()
        .find(|n| n.eq_ignore_ascii_case(path))?
        .to_string();
    let mut text = String::new();
    std::io::Read::read_to_string(&mut archive.by_name(&name).ok()?, &mut text).ok()?;
    Some(text)
}

/// Expand and Exterminate 0.46's `LuaRules/main.lua` only includes the engine's
/// base gadget handler, `LuaGadgets/gadgets.lua`, which lives in the engine's
/// `springcontent.sdz` and needs the whole engine API. The sandbox has neither,
/// so a stand-in records that the game's own line ran.
#[test]
#[ignore = "needs Expand and Exterminate 0.46 at ~/.spring/games, or COILBOX_COMPAT_EE naming its .sdz"]
fn expand_and_exterminate_loads_with_the_prelude_in_front() {
    let file = std::fs::File::open(ee_archive()).expect("the E&E archive");
    let mut archive = zip::ZipArchive::new(file).unwrap();
    let m = manifest(2).unwrap();
    let written = prelude_files(&m, |path| read_from_zip(&mut archive, path));
    let paths: Vec<&str> = written.iter().map(|(p, _)| p.as_str()).collect();
    assert_eq!(
        paths,
        [
            "LuaRules/draw.lua",
            "LuaRules/main.lua",
            "compat/prelude-synced.lua",
            "compat/prelude-unsynced.lua",
        ]
    );

    let stand_in = "COILBOX_BASE_HANDLER_RAN = (COILBOX_BASE_HANDLER_RAN or 0) + 1\n";
    for (entry, state) in [
        ("LuaRules/main.lua", "synced"),
        ("LuaRules/draw.lua", "unsynced"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut files: BTreeMap<PathBuf, String> = written
            .iter()
            .map(|(p, text)| (dir.path().join(p), text.clone()))
            .collect();
        files.insert(
            dir.path().join("LuaGadgets/gadgets.lua"),
            stand_in.to_string(),
        );
        let got = run(
            dir.path(),
            files,
            &format!(
                r#"
                {gl}
                VFS.Include("{entry}")
                return {{
                    ran = COILBOX_BASE_HANDLER_RAN,
                    travel = type(Spring.GetUnitTravel),
                    smoothing = type(gl and gl.Smoothing),
                }}
                "#,
                gl = if state == "unsynced" { "gl = {}" } else { "" },
            ),
        );
        assert_eq!(got["ran"], 1, "{entry}");
        if state == "synced" {
            assert_eq!(got["travel"], "function", "{entry}");
        } else {
            assert_eq!(got["smoothing"], "function", "{entry}");
        }
    }
}
