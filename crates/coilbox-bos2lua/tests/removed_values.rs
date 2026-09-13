//! Unit values the engine no longer keeps. Spring 102.0 stopped keeping the
//! values BOS scripts shared, 1024 to 8191, so the Lua keeps them as rules
//! params. Every conversion here is run, and the preview answers a shared value
//! sent to the engine with 0, as the game does, so only Lua that keeps them
//! itself passes.

use coilbox_bos2lua::{convert, Conversion, Options, COB_VARS_POLYFILL, MODERN_LINEAR};
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

/// A timeline for a Lua script that can include the polyfill as a game does.
fn with_polyfill(lua: &str) -> coilbox_springlua::unitscript::Timeline {
    let pieces = pieces();
    let includes = HashMap::from([(
        "lualibs/cob_vars.lua".to_string(),
        COB_VARS_POLYFILL.to_string(),
    )]);
    let unit = Unit {
        includes: &includes,
        ..Unit::new(&pieces)
    };
    run(lua, "polyfill.lua", &unit, &create(), 3)
}

#[test]
fn a_conversion_says_whether_it_shares_values() {
    let sharing = convert_bos("piece base, turret;\n\nCreate()\n{\n\tset 2048 to 1;\n}\n");
    let not_sharing = convert_bos("piece base, turret;\n\nCreate()\n{\n\tset 1032 to 1;\n}\n");
    assert!(sharing.shared_values);
    assert!(!not_sharing.shared_values);
}

/// The converted Lua and the polyfill are two files that must agree on where
/// each kind of value lives.
#[test]
fn the_converter_and_the_polyfill_use_the_same_names() {
    let lua = convert_bos("piece base, turret;\n\nCreate()\n{\n\tset 2048 to 1;\n}\n").lua;
    for name in ["cobUnitVar", "cobTeamVar", "cobAllyVar", "cobGlobalVar"] {
        assert!(lua.contains(&format!("\"{name}\"")), "{name} in {lua}");
        assert!(COB_VARS_POLYFILL.contains(&format!("\"{name}\"")), "{name}");
    }
}

/// The removed functions read back what a converted script stores. A packed
/// position splits into two signed halves, and a team that does not exist, a
/// unit that does not exist or a slot out of range answers nothing, as the
/// engine's did.
#[test]
fn the_polyfill_reads_what_a_converted_script_stores() {
    let timeline = with_polyfill(
        r#"
local base, turret = piece("base", "turret")
include("lualibs/cob_vars.lua")
function script.Create()
	Spring.SetTeamRulesParam(0, "cobTeamVar3", 2, { allied = true })
	Spring.SetGameRulesParam("cobGlobalVar0", 5 * 65536 + 65529)
	local x, z = Spring.GetCOBGlobalVar(0, true)
	Move(turret, y_axis, Spring.GetCOBTeamVar(0, 3) + Spring.GetCOBAllyTeamVar(0, 9) + Spring.GetCOBUnitVar(unitID, 0))
	Move(turret, x_axis, x)
	Move(turret, z_axis, z)
	if Spring.GetCOBTeamVar(1, 3) == nil and Spring.GetCOBTeamVar(0, 64) == nil and Spring.GetCOBUnitVar(unitID + 1, 0) == nil then
		Move(base, y_axis, 1)
	end
end
"#,
    );
    assert_eq!(timeline.error, None, "{:?}", timeline.warnings);
    let frame = &timeline.frames[1];
    // base's y, then turret's x, y and z.
    assert_eq!(
        [frame[1], frame[6], frame[7], frame[8]],
        [1.0, 5.0, 2.0, -7.0]
    );
}

/// THIS sets a perk with `Spring.SetUnitCOBValue(u, 2048 + perk, 1)`. The
/// wrapped functions keep a shared id in the rules params, so a converted
/// script and `GetCOBTeamVar` both see it, and hand anything else, such as
/// the heading `unit_turn.lua` sets, to the engine's function. The script
/// stands in for the engine's two functions, counting the calls that reach
/// them, because the preview has neither.
#[test]
fn the_polyfill_keeps_shared_ids_set_through_unit_cob_values() {
    let timeline = with_polyfill(
        r#"
local base, turret = piece("base", "turret")
local reached = 0
Spring.GetUnitCOBValue = function(unitID, id) reached = reached + 1 return 7 end
Spring.SetUnitCOBValue = function(unitID, id, value) reached = reached + 1 end
include("lualibs/cob_vars.lua")
function script.Create()
	Spring.SetUnitCOBValue(unitID, 2049, 1)
	Spring.SetUnitCOBValue(unitID, 82, 5)
	local heading = Spring.GetUnitCOBValue(unitID, 82)
	Spring.SetUnitCOBValue(unitID, 4096, 5 * 65536 + 65529)
	local x, z = Spring.GetUnitCOBValue(unitID, true, 4096)
	Spring.GetUnitCOBValue(unitID, 1025, -unitID, 3)
	Move(turret, y_axis, Spring.GetUnitCOBValue(unitID, 2049) + Spring.GetCOBTeamVar(0, 1) + Spring.GetUnitCOBValue(unitID, 1025))
	Move(turret, x_axis, x)
	Move(turret, z_axis, z)
	Move(base, y_axis, reached + heading)
end
"#,
    );
    assert_eq!(timeline.error, None, "{:?}", timeline.warnings);
    let frame = &timeline.frames[1];
    // turret: the perk read two ways plus the unit value set through a unit
    // id, then the split position. base: the two calls with id 82 reached the
    // engine's functions, and the heading they answered is 7.
    assert_eq!(
        [frame[7], frame[6], frame[8], frame[1]],
        [5.0, 5.0, -7.0, 9.0]
    );
}

/// Neither can be brought back. The engine call stays, so the Lua does what the
/// COB does today, and the porter is told why the unit behaves differently.
#[test]
fn fuel_and_the_alpha_threshold_are_said_to_be_gone() {
    let conversion = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tset 103 to 5;\n\tmove turret to y-axis get 93 now;\n}\n",
    );
    let lua = &conversion.lua;
    assert!(lua.contains("SetUnitValue(103, 5)"), "{lua}");
    assert!(
        lua.contains("ALPHA_THRESHOLD was removed in Spring 99.0"),
        "{lua}"
    );
    assert!(
        lua.contains("CURRENT_FUEL has done nothing since Spring 101.0"),
        "{lua}"
    );
    for name in ["CURRENT_FUEL", "ALPHA_THRESHOLD"] {
        assert!(
            conversion.warnings.iter().any(|w| w.contains(name)),
            "{name} in {:?}",
            conversion.warnings
        );
    }
    assert_eq!(turret_height(lua), 0.0);
}

/// A removed value read in a condition is said on the line that reads it, not
/// on the first line of the body or on its end.
#[test]
fn a_removed_value_in_a_condition_is_said_on_that_line() {
    let lua = convert_bos(
        "piece base, turret;\n\nCreate()\n{\n\tif (get 93)\n\t{\n\t\tmove turret to y-axis [1] now;\n\t}\n\twhile (get 103)\n\t{\n\t\tsleep 100;\n\t}\n}\n",
    )
    .lua;
    let line_of = |text: &str| {
        lua.lines()
            .find(|line| line.contains(text))
            .unwrap_or_else(|| panic!("{text} in {lua}"))
            .trim_start()
            .to_string()
    };
    assert!(
        line_of("CURRENT_FUEL has done nothing").starts_with("if "),
        "{lua}"
    );
    assert!(
        line_of("ALPHA_THRESHOLD was removed").starts_with("while "),
        "{lua}"
    );
}
