//! Unit values the engine no longer keeps. Spring 102.0 stopped keeping the
//! values BOS scripts shared, 1024 to 8191, so the Lua keeps them as rules
//! params. Every conversion here is run, and the preview answers a shared value
//! sent to the engine with 0, as the game does, so only Lua that keeps them
//! itself passes.

use coilbox_bos2lua::{convert, Conversion, Options, MODERN_LINEAR};
use coilbox_springlua::unitscript::{run, ScriptEvent, Unit};
use std::collections::HashMap;

fn convert_bos(source: &str) -> Conversion {
    let includes = HashMap::new();
    convert(
        source,
        &Options {
            name: "scripts/shared.bos",
            includes: &includes,
            pieces: None,
            linear_scale: MODERN_LINEAR,
        },
    )
    .unwrap()
}

fn pieces() -> Vec<String> {
    ["base", "turret"].iter().map(|p| p.to_string()).collect()
}

fn create() -> [ScriptEvent; 1] {
    [ScriptEvent {
        frame: 0,
        callin: "Create".into(),
        args: Vec::new(),
        ambient: true,
    }]
}

/// How far up the y axis `turret` sits a frame after Create, in elmos. Every
/// script here declares `piece base, turret`, so turret is the second piece.
fn turret_height(lua: &str) -> f64 {
    let pieces = pieces();
    let timeline = run(lua, "shared.lua", &Unit::new(&pieces), &create(), 3);
    assert_eq!(timeline.error, None, "{lua}");
    timeline.frames[1][6 + 1]
}

#[test]
fn a_team_value_that_is_set_reads_back() {
    let conversion = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tset 2048 to [2];\n\tmove turret to y-axis get 2048 now;\n}\n",
    );
    let lua = &conversion.lua;
    assert!(lua.contains("cobSet(2048, 131072)"), "{lua}");
    assert!(lua.contains("cobGet(2048)"), "{lua}");
    assert_eq!(turret_height(lua), 2.0);
    assert!(
        conversion
            .warnings
            .iter()
            .any(|w| w.contains("rules params")),
        "{:?}",
        conversion.warnings
    );
}

#[test]
fn an_allyteam_value_and_a_game_value_read_back() {
    let lua = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tvar total;\n\tset 3072 to [1];\n\tset 4096 to [2];\n\ttotal = (get 3072) + (get 4096);\n\tmove turret to y-axis total now;\n}\n",
    )
    .lua;
    assert_eq!(turret_height(&lua), 3.0);
}

/// A negative first argument sets the value on the unit with that id, and a
/// positive one reads it. The preview's one unit stands in for the other.
#[test]
fn a_unit_value_is_set_and_read_through_a_unit_id() {
    let lua = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tvar me;\n\tme = get 71;\n\tget 1025(0 - me, [2]);\n\tmove turret to y-axis get 1025(me) now;\n}\n",
    )
    .lua;
    assert_eq!(turret_height(&lua), 2.0);
}

#[test]
fn a_unit_value_of_a_unit_that_does_not_exist_reads_zero() {
    let lua = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tset 1025 to [2];\n\tmove turret to y-axis get 1025(999) now;\n}\n",
    )
    .lua;
    assert_eq!(turret_height(&lua), 0.0);
}

#[test]
fn an_id_only_known_while_running_is_checked_then() {
    let conversion = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tvar id;\n\tid = 2048;\n\tset id to [2];\n\tmove turret to y-axis get id now;\n}\n",
    );
    assert!(
        conversion.lua.contains("cobSet(id, 131072)"),
        "{}",
        conversion.lua
    );
    assert_eq!(turret_height(&conversion.lua), 2.0);
    assert!(
        conversion
            .warnings
            .iter()
            .any(|w| w.contains("while running")),
        "{:?}",
        conversion.warnings
    );
}

/// 1032 sits between the unit and team ranges and was never shared, so it
/// still goes to the engine, and a script with no shared value gets no helpers.
#[test]
fn a_value_that_was_never_shared_still_goes_to_the_engine() {
    let conversion = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tset 1032 to 1;\n\tmove turret to y-axis get 1032 now;\n}\n",
    );
    let lua = &conversion.lua;
    assert!(lua.contains("SetUnitValue(1032, 1)"), "{lua}");
    assert!(lua.contains("GetUnitValue(1032)"), "{lua}");
    assert!(!lua.contains("cobAllied"), "{lua}");
    assert!(conversion.warnings.is_empty(), "{:?}", conversion.warnings);
}
