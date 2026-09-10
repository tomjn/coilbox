//! The converter against a unit script written for these tests in the style of
//! Expand and Exterminate's, which is where it first went wrong: preprocessor
//! lines left in, a define turned into broken Lua, zero read as true. Every
//! conversion here is also loaded and run, because Lua that only looks right
//! is the failure this crate exists to end.

use coilbox_bos2lua::{convert, linear_scale, Conversion, Options, MODERN_LINEAR, SCRIPTOR_LINEAR};
use coilbox_springlua::unitscript::{run, ScriptEvent, Unit};
use std::collections::HashMap;

const WALKER: &str = include_str!("fixtures/walker.bos");

fn includes() -> HashMap<String, String> {
    HashMap::from([
        (
            "scripts/flags.h".to_string(),
            include_str!("fixtures/flags.h").to_string(),
        ),
        (
            "scripts/animations/stride.bos".to_string(),
            include_str!("fixtures/animations/stride.bos").to_string(),
        ),
    ])
}

fn convert_with(source: &str, includes: &HashMap<String, String>, linear_scale: i64) -> Conversion {
    convert(
        source,
        &Options {
            name: "scripts/walker.bos",
            includes,
            pieces: None,
            linear_scale,
        },
    )
    .unwrap()
}

fn walker() -> String {
    convert_with(WALKER, &includes(), MODERN_LINEAR).lua
}

fn pieces_of(lua: &str) -> Vec<String> {
    lua.split("piece(\"")
        .skip(1)
        .filter_map(|rest| rest.split('"').next())
        .map(str::to_string)
        .collect()
}

fn event(frame: u32, callin: &str, args: &[f64]) -> ScriptEvent {
    ScriptEvent {
        frame,
        callin: callin.into(),
        args: args.to_vec(),
        ambient: true,
    }
}

#[test]
fn leaves_no_preprocessor_line_behind() {
    let lua = walker();
    for line in lua.lines() {
        assert!(!line.trim_start().starts_with('#'), "{line}");
        // A comment may name the macro. Code may not.
        if !line.trim_start().starts_with("--") {
            assert!(!line.contains("ANIM_VARIABLE"), "{line}");
        }
    }
    assert!(!lua.contains("local TA"), "{lua}");
}

#[test]
fn keeps_the_comments() {
    let lua = walker();
    for comment in [
        "-- This is a TA script",
        "-- Signal definitions",
        "-- The walk loop. It runs for the life of the unit and",
        "-- asks the stride library for one step at a time.",
        "\t\t-- left leg forward",
        "-- Alternates nozzles. spray holds a piece as a number, and base is piece 0.",
        "local SHATTER = 1 -- flies apart",
    ] {
        assert!(lua.contains(comment), "missing {comment:?} in\n{lua}");
    }
}

#[test]
fn pulls_in_includes_but_leaves_a_header_s_own_comments_behind() {
    let lua = walker();
    assert!(lua.contains("-- Start of animations/stride.bos"), "{lua}");
    assert!(lua.contains("function stride()"), "{lua}");
    assert!(lua.contains("-- From flags.h"), "{lua}");
    assert!(
        !lua.contains("explosion flags and unit value numbers"),
        "{lua}"
    );
    // Only the header's constants that something uses.
    assert!(!lua.contains("PIECE_Y"), "{lua}");
}

#[test]
fn names_unit_values_the_way_the_engine_does() {
    let lua = walker();
    assert!(lua.contains("SetUnitValue(COB.INBUILDSTANCE, 1)"), "{lua}");
    assert!(
        lua.contains("GetUnitValue(COB.BUILD_PERCENT_LEFT) ~= 0"),
        "{lua}"
    );
}

#[test]
fn reads_zero_as_false() {
    let lua = walker();
    assert!(lua.contains("if moving ~= 0 then"), "{lua}");
    assert!(lua.contains("while true do"), "{lua}");
    assert!(
        lua.contains("gun_ready = (gun_ready == 0 and 1 or 0)"),
        "{lua}"
    );
}

#[test]
fn hands_call_ins_to_the_engine_under_its_names() {
    let lua = walker();
    assert_eq!(lua.matches("function script.Create()").count(), 1, "{lua}");
    assert!(lua.contains("\tStartThread(Create)\n"), "{lua}");
    assert!(
        lua.contains("StartThread(SetMaxReloadTime, math.floor("),
        "{lua}"
    );
    assert!(
        lua.contains("function script.AimWeapon1(heading, pitch)"),
        "{lua}"
    );
    assert!(lua.contains("\theading = toCobAngle(heading)"), "{lua}");
    assert!(lua.contains("\treturn true\nend"), "{lua}");
    assert!(lua.contains("function script.QueryWeapon1()"), "{lua}");
    assert!(
        lua.contains("\tpiecenum = flare\n\treturn piecenum"),
        "{lua}"
    );
    assert!(
        lua.contains("function script.Killed(recentDamage, maxHealth)"),
        "{lua}"
    );
    assert!(lua.contains("\treturn corpsetype\nend"), "{lua}");
    assert!(
        lua.contains("function script.StartBuilding(heading, pitch)"),
        "{lua}"
    );
}

#[test]
fn holds_a_piece_used_as_a_number_as_bos_numbers_it() {
    let lua = walker();
    // base is piece 0 to a COB script, and 1 to Lua's piece().
    assert!(lua.contains("spray = base - 1"), "{lua}");
    assert!(lua.contains("gun_ready = base - 1"), "{lua}");
}

#[test]
fn converts_units_and_the_axes_cob_mirrors() {
    let lua = walker();
    // x turns as it is, a z turn and an x move are mirrored in COB.
    assert!(
        lua.contains("Turn(lthigh, x_axis, math.rad(-30), math.rad(180))"),
        "{lua}"
    );
    assert!(lua.contains("Move(pad, x_axis, 2.5)"), "{lua}");
    assert!(
        lua.contains("Turn(turret, y_axis, heading * COB_ANGLE, math.rad(180))"),
        "{lua}"
    );
    assert!(
        lua.contains("Turn(pad, y_axis, math.rad(179.9561))"),
        "{lua}"
    );
    assert!(lua.contains("BosSleep(150)"), "{lua}");
}

#[test]
fn scriptor_s_distances_are_two_and_a_half_times_as_long() {
    let lua = convert_with(WALKER, &includes(), SCRIPTOR_LINEAR).lua;
    assert!(lua.contains("Move(pad, x_axis, 6.25)"), "{lua}");
    assert!(lua.contains("Move(barrel, z_axis, 0, 5)"), "{lua}");
}

#[test]
fn tells_the_linear_scale_from_the_cob() {
    let words = |values: &[i32]| {
        values
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect::<Vec<u8>>()
    };
    // The fixture's distances are [-2.5], [-1] and [2].
    let scriptor = words(&[7, -409_600, -163_840, 327_680]);
    let modern = words(&[7, -163_840, -65_536, 131_072]);
    assert_eq!(linear_scale(WALKER, &scriptor), Some(SCRIPTOR_LINEAR));
    assert_eq!(linear_scale(WALKER, &modern), Some(MODERN_LINEAR));
    assert_eq!(linear_scale(WALKER, &words(&[1, 2, 3])), None);
}

#[test]
fn runs_without_a_thread_stopping_and_walks() {
    let lua = walker();
    let pieces = pieces_of(&lua);
    let events = [
        event(0, "Create", &[]),
        event(10, "StartMoving", &[]),
        event(60, "StopMoving", &[]),
        event(70, "AimWeapon1", &[0.8, 0.1]),
        event(90, "FireWeapon1", &[]),
        event(100, "StartBuilding", &[0.5, 0.1]),
        event(140, "StopBuilding", &[]),
        event(170, "Killed", &[80.0, 100.0]),
    ];
    let timeline = run(&lua, "walker.lua", &Unit::new(&pieces), &events, 200);
    assert_eq!(timeline.error, None);
    let stopped: Vec<_> = timeline
        .warnings
        .iter()
        .filter(|w| w.contains("That thread stopped"))
        .collect();
    assert!(stopped.is_empty(), "{stopped:?}");
    let thigh = pieces.iter().position(|p| p == "lthigh").unwrap() * 6 + 3;
    assert!(
        timeline.frames[10..60].iter().any(|f| f[thigh] != 0.0),
        "the thigh never moved while walking"
    );
}

#[test]
fn asks_for_pieces_by_the_model_s_spelling() {
    let model: Vec<String> = [
        "Base", "BODY", "turret", "sleeve", "barrel", "flare", "LThigh", "RThigh", "nano1", "nano2",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let includes = includes();
    let conversion = convert(
        WALKER,
        &Options {
            name: "scripts/walker.bos",
            includes: &includes,
            pieces: Some(&model),
            linear_scale: MODERN_LINEAR,
        },
    )
    .unwrap();
    assert!(
        conversion.lua.contains("local base = piece(\"Base\")"),
        "{}",
        conversion.lua
    );
    assert!(
        conversion.lua.contains("local lthigh = piece(\"LThigh\")"),
        "{}",
        conversion.lua
    );
    assert!(
        conversion.warnings.iter().any(|w| w.contains("pad")),
        "{:?}",
        conversion.warnings
    );
}

#[test]
fn a_script_too_big_for_lua_s_locals_still_loads() {
    let names: Vec<String> = (0..120).map(|i| format!("p{i}")).collect();
    let explodes: String = names
        .iter()
        .map(|n| format!("\texplode {n} type 1;\n"))
        .collect();
    let source = format!(
        "piece {};\n\nKilled(severity, corpsetype)\n{{\n{explodes}\tcorpsetype = 1;\n}}\n",
        names.join(", ")
    );
    let lua = convert_with(&source, &HashMap::new(), MODERN_LINEAR).lua;
    assert!(lua.contains("\np0 = piece(\"p0\")"), "{lua}");
    let events = [event(0, "Killed", &[80.0, 100.0])];
    let timeline = run(&lua, "big.lua", &Unit::new(&names), &events, 5);
    assert_eq!(timeline.error, None);
}

#[test]
fn a_missing_include_is_said_and_the_engine_s_names_stand_in() {
    let conversion = convert_with(WALKER, &HashMap::new(), MODERN_LINEAR);
    assert!(
        conversion.warnings.iter().any(|w| w.contains("flags.h")),
        "{:?}",
        conversion.warnings
    );
    assert!(
        conversion.lua.contains("COB.INBUILDSTANCE"),
        "{}",
        conversion.lua
    );
    assert!(
        conversion.warnings.iter().any(|w| w.contains("SHATTER")),
        "{:?}",
        conversion.warnings
    );
}
