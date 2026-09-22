//! Leaving out what nothing uses, against a script in the style of THIS: one
//! header of constants, variables and functions that every unit includes and
//! each uses a little of. Every pruned conversion is also loaded and run.

use coilbox_bos2lua::{convert, Conversion, Options, Precedence, MODERN_LINEAR};
use coilbox_springlua::unitscript::{run, ScriptEvent, Unit};
use std::collections::HashMap;

const HEADER: &str = r#"
#define SIG_AIM 2
#define SIG_UNUSED 4
#define SIG_STEALTH 8
#define STEALTH_TIME 1000

static-var isMoving;
static-var spare;

RestoreStealth() {
	signal SIG_STEALTH;
	set-signal-mask SIG_STEALTH;
	sleep STEALTH_TIME;
	if (!isMoving) { hide base; }
}

Helper() {
	isMoving = 1;
}

Threaded() {
	sleep 1;
}

lua_AddTrail() {
	return 0;
}
"#;

const SCRIPT: &str = r#"
#include "shared.h"

piece base, turret, flare, leftover;

Create() {
	var unread, counted, rolled;
	unread = 5;
	counted = 1;
	rolled = rand(1, 6);
	call-script Helper();
	start-script Threaded();
	call-script lua_AddTrail(flare);
	if (counted) { show turret; }
}

// A gadget calls this by name, so nothing in the script does.
NewPerk(p) {
	if (p == 1) { show turret; }
}

HitByWeapon(anglex, anglez) {
	if (anglex > 0) { show turret; }
}

AimWeapon1(heading, pitch) {
	signal SIG_AIM;
	set-signal-mask SIG_AIM;
	turn turret to y-axis heading speed <90>;
	return 1;
}
"#;

fn converted(prune: bool) -> Conversion {
    let includes = HashMap::from([("scripts/shared.h".to_string(), HEADER.to_string())]);
    convert(
        SCRIPT,
        &Options {
            name: "scripts/unit.bos",
            includes: &includes,
            pieces: None,
            linear_scale: MODERN_LINEAR,
            precedence: Precedence::Modern,
            prune,
        },
    )
    .unwrap()
}

fn pruned() -> String {
    converted(true).lua
}

#[test]
fn turned_off_everything_is_written() {
    let lua = converted(false).lua;
    for kept in [
        "function RestoreStealth()",
        "function lua_AddTrail()",
        "SIG_UNUSED = 4",
        "spare = 0",
        "piece(\"leftover\")",
        "unread",
    ] {
        assert!(lua.contains(kept), "missing {kept:?} in\n{lua}");
    }
}

#[test]
fn a_header_function_nothing_calls_is_left_out_and_said_so() {
    let c = converted(true);
    assert!(!c.lua.contains("RestoreStealth"), "{}", c.lua);
    assert!(
        c.warnings
            .iter()
            .any(|w| w.to_string().contains("RestoreStealth") && w.to_string().contains("shared.h")),
        "{:?}",
        c.warnings
    );
}

#[test]
fn a_header_function_that_is_called_or_started_stays() {
    let lua = pruned();
    assert!(lua.contains("function Helper()"), "{lua}");
    assert!(lua.contains("function Threaded()"), "{lua}");
}

#[test]
fn a_function_in_the_script_s_own_file_stays_with_no_caller() {
    let c = converted(true);
    assert!(c.lua.contains("function NewPerk(p)"), "{}", c.lua);
    assert!(
        !c.warnings.iter().any(|w| w.to_string().contains("NewPerk")),
        "{:?}",
        c.warnings
    );
}

#[test]
fn a_lua_stub_is_left_out_because_the_call_goes_to_gg() {
    let lua = pruned();
    assert!(!lua.contains("function lua_AddTrail"), "{lua}");
    assert!(lua.contains("GG.AddTrail("), "{lua}");
}

#[test]
fn a_header_constant_stays_only_if_something_left_uses_it() {
    let lua = pruned();
    assert!(lua.contains("SIG_AIM = 2"), "{lua}");
    assert!(!lua.contains("SIG_UNUSED"), "{lua}");
    // Only RestoreStealth used these, and it is gone.
    assert!(!lua.contains("SIG_STEALTH"), "{lua}");
    assert!(!lua.contains("STEALTH_TIME"), "{lua}");
}

#[test]
fn a_variable_or_piece_nothing_names_is_left_out() {
    let lua = pruned();
    assert!(lua.contains("isMoving = 0"), "{lua}");
    assert!(!lua.contains("spare"), "{lua}");
    assert!(lua.contains("piece(\"turret\")"), "{lua}");
    assert!(lua.contains("piece(\"flare\")"), "{lua}");
    assert!(!lua.contains("leftover"), "{lua}");
}

#[test]
fn a_local_that_is_set_and_never_read_is_left_out() {
    let lua = pruned();
    assert!(!lua.contains("unread"), "{lua}");
    assert!(lua.contains("counted = 1"), "{lua}");
}

#[test]
fn a_call_in_parameter_the_body_never_names_is_not_worked_out() {
    let lua = pruned();
    assert!(lua.contains("local anglex = trunc("), "{lua}");
    assert!(!lua.contains("local anglez"), "{lua}");
    assert!(converted(false).lua.contains("local anglez = trunc("));
}

#[test]
fn a_local_set_from_rand_stays_because_rand_moves_the_synced_generator() {
    let lua = pruned();
    assert!(lua.contains("rolled = math.random(1, 6)"), "{lua}");
}

#[test]
fn the_pruned_script_loads_and_runs() {
    let lua = pruned();
    let pieces: Vec<String> = ["base", "turret", "flare"].map(String::from).to_vec();
    let events = [ScriptEvent {
        frame: 1,
        callin: "AimWeapon1".into(),
        args: vec![0.5, 0.0],
        ambient: true,
    }];
    let timeline = run(
        &lua,
        "unit.lua",
        &Unit::new(&pieces),
        &events,
        20,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None, "{lua}");
}
