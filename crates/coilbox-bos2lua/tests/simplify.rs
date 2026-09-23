//! Lua written the way somebody would write it by hand, where that changes
//! nothing: a piece handed straight back, `Sleep` called as itself, and a
//! constant that is only ever an angle or a distance kept in Lua's own units.
//! Every conversion is also loaded and run.

use coilbox_bos2lua::{convert, Options, Precedence, MODERN_LINEAR, SCRIPTOR_LINEAR};
use coilbox_springlua::unitscript::{run, ScriptEvent, Unit};
use std::collections::HashMap;

const SCRIPT: &str = r#"
piece base, turret, flare, alt;

static-var delay, useAlt;

#define TURRETAIM <160>
#define HALFTURN <180>
#define LIMIT <90>
#define TWICE <45>
#define DOUBLED (TWICE * 2)
#define RISE [10]
#define REACH [650]

Create() {
	delay = 400;
	sleep 150;
	sleep delay;
	sleep delay - 100;
	spin turret around z-axis speed TURRETAIM;
	turn base to y-axis HALFTURN speed TURRETAIM;
	turn base to x-axis DOUBLED speed TWICE;
	move turret to y-axis RISE speed RISE;
	move turret to x-axis RISE now;
	get WEAPON_RANGE(-1, REACH);
	move base to y-axis REACH now;
}

QueryWeapon1(p) {
	// where the shot leaves
	p = flare; // the muzzle
}

AimFromWeapon1(p) {
	if (useAlt) { p = alt; }
	else { p = turret; }
}

AimWeapon1(heading, pitch) {
	if (heading > LIMIT) { return 0; }
	turn turret to y-axis LIMIT speed TURRETAIM;
	turn turret to x-axis 0 - LIMIT now;
	return 1;
}
"#;

fn converted_at(linear_scale: i64) -> String {
    convert(
        SCRIPT,
        &Options {
            name: "scripts/unit.bos",
            includes: &HashMap::new(),
            pieces: None,
            linear_scale,
            precedence: Precedence::Modern,
            prune: true,
        },
    )
    .unwrap()
    .lua
}

fn converted() -> String {
    converted_at(MODERN_LINEAR)
}

#[test]
fn a_call_in_that_only_names_its_piece_hands_it_straight_back() {
    let lua = converted();
    assert!(
        lua.contains(
            "function script.QueryWeapon1()\n\t-- where the shot leaves\n\treturn flare -- the muzzle\nend"
        ),
        "{lua}"
    );
}

#[test]
fn a_call_in_that_chooses_its_piece_keeps_the_variable() {
    let lua = converted();
    assert!(
        lua.contains("function script.AimFromWeapon1()\n\tlocal p = 0\n\tif useAlt ~= 0 then"),
        "{lua}"
    );
}

#[test]
fn sleep_is_called_as_itself_with_the_frame_added() {
    let lua = converted();
    assert!(lua.contains("\tSleep(150 + 33)\n"), "{lua}");
    assert!(lua.contains("\tSleep(delay + 33)\n"), "{lua}");
    assert!(lua.contains("\tSleep(delay - 100 + 33)\n"), "{lua}");
    assert!(!lua.contains("BosSleep"), "{lua}");
}

#[test]
fn the_extra_frame_is_explained_once() {
    let lua = converted();
    assert_eq!(lua.matches("a frame later than Lua's").count(), 1, "{lua}");
}

#[test]
fn a_constant_that_is_only_ever_an_angle_is_kept_in_radians() {
    let lua = converted();
    assert!(lua.contains("local TURRETAIM = math.rad(160)"), "{lua}");
    assert!(lua.contains("Spin(turret, z_axis, -TURRETAIM)"), "{lua}");
    assert!(
        lua.contains("Turn(turret, y_axis, LIMIT * COB_ANGLE, TURRETAIM)"),
        "{lua}"
    );
}

#[test]
fn a_constant_that_is_also_compared_stays_in_the_bos_s_units() {
    let lua = converted();
    assert!(lua.contains("local LIMIT = 16380"), "{lua}");
    assert!(lua.contains("heading > LIMIT"), "{lua}");
}

#[test]
fn a_constant_used_in_a_sum_or_in_another_constant_stays_in_the_bos_s_units() {
    let lua = converted();
    // DOUBLED is worked out from TWICE, in the BOS's units.
    assert!(lua.contains("local TWICE = 8190"), "{lua}");
}

#[test]
fn a_half_turn_constant_keeps_the_bos_s_value() {
    let lua = converted();
    assert!(lua.contains("local HALFTURN = 32760"), "{lua}");
}

#[test]
fn a_constant_that_is_only_ever_a_distance_is_kept_in_elmos() {
    let lua = converted();
    assert!(lua.contains("local RISE = 10\n"), "{lua}");
    assert!(lua.contains("Move(turret, y_axis, RISE, RISE)"), "{lua}");
    assert!(lua.contains("Move(turret, x_axis, -RISE)"), "{lua}");
}

#[test]
fn a_scriptor_distance_constant_is_two_and_a_half_elmos_a_bracket() {
    let lua = converted_at(SCRIPTOR_LINEAR);
    assert!(lua.contains("local RISE = 25\n"), "{lua}");
}

#[test]
fn a_distance_constant_the_engine_is_also_handed_stays_in_the_bos_s_units() {
    let lua = converted();
    assert!(lua.contains("local REACH = 42598400"), "{lua}");
    assert!(
        lua.contains("Move(base, y_axis, REACH * COB_LINEAR)"),
        "{lua}"
    );
}

#[test]
fn the_script_loads_and_runs() {
    let lua = converted();
    let pieces: Vec<String> = ["base", "turret", "flare", "alt"]
        .map(String::from)
        .to_vec();
    let event = |frame, callin: &str, args: &[f64]| ScriptEvent {
        frame,
        callin: callin.into(),
        args: args.to_vec(),
        ambient: true,
        world: None,
    };
    let events = [
        event(0, "Create", &[]),
        event(40, "QueryWeapon1", &[]),
        event(41, "AimFromWeapon1", &[]),
        event(42, "AimWeapon1", &[0.5, 0.1]),
    ];
    let timeline = run(
        &lua,
        "unit.lua",
        &Unit::new(&pieces),
        &events,
        60,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None, "{lua}");
}
