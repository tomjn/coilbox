//! The parts of BOS beyond what today's compiler accepts: what Scriptor's
//! `Compiler.cfg` defines, and what Recoil added. Each script is converted and
//! run, and what it computes is read back off a piece it moves.

use coilbox_bos2lua::{convert, precedence, Options, Precedence, MODERN_LINEAR};
use coilbox_springlua::unitscript::{run, ScriptEvent, Unit};
use std::collections::HashMap;

fn lua(source: &str, precedence: Precedence) -> String {
    convert(
        source,
        &Options {
            name: "scripts/unit.bos",
            includes: &HashMap::new(),
            pieces: None,
            linear_scale: MODERN_LINEAR,
            precedence,
            prune: false,
        },
    )
    .unwrap()
    .lua
}

/// What `body` leaves in `y`, read off how far it moves `base`.
fn y_after(body: &str, precedence: Precedence) -> f64 {
    y_after_defining("", body, precedence)
}

fn y_after_defining(defines: &str, body: &str, precedence: Precedence) -> f64 {
    let source = format!(
        "{defines}\npiece base;\nstatic-var a, b, c;\nCreate() {{\n var x, y, i;\n x = 0; y = 0; i = 0;\n {body}\n move base to y-axis y * 65536 now;\n}}\n"
    );
    let lua = lua(&source, precedence);
    let pieces = vec!["base".to_string()];
    let events = [ScriptEvent {
        frame: 0,
        callin: "Create".into(),
        args: Vec::new(),
        ambient: true,
    }];
    let timeline = run(
        &lua,
        "unit.lua",
        &Unit::new(&pieces),
        &events,
        2,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None, "{lua}");
    timeline.frames[1][1]
}

#[test]
fn break_leaves_the_loop() {
    let body = "while (TRUE) { if (y > 3) { break; } y = y + 1; }";
    assert_eq!(y_after(body, Precedence::Modern), 4.0);
}

#[test]
fn continue_goes_round_again() {
    let body = "while (x < 5) { x = x + 1; if (x == 2) continue; y = y + 1; }";
    assert_eq!(y_after(body, Precedence::Modern), 4.0);
}

#[test]
fn continue_in_a_for_still_runs_the_step() {
    let body = "for (x = 0; x < 5; x = x + 1) { if (x == 2) continue; y = y + 1; }";
    assert_eq!(y_after(body, Precedence::Modern), 4.0);
}

#[test]
fn break_beside_continue_ends_the_loop() {
    let body = "while (TRUE) { x = x + 1; if (x == 2) continue; if (x > 4) break; y = y + 1; }";
    assert_eq!(y_after(body, Precedence::Modern), 3.0);
}

#[test]
fn break_in_an_inner_loop_leaves_only_that_loop() {
    let body =
        "while (x < 3) { x = x + 1; if (x == 1) continue; while (TRUE) { y = y + 1; break; } }";
    assert_eq!(y_after(body, Precedence::Modern), 2.0);
}

#[test]
fn break_outside_a_loop_is_refused() {
    let err = convert(
        "Create() { break; }",
        &Options {
            name: "unit.bos",
            includes: &HashMap::new(),
            pieces: None,
            linear_scale: MODERN_LINEAR,
            precedence: Precedence::Modern,
            prune: false,
        },
    )
    .err()
    .unwrap();
    assert!(err.contains("break outside a loop"), "{err}");
}

#[test]
fn scriptor_reads_operators_of_a_level_left_to_right() {
    let body = "a = 1; b = 0; c = 0; y = a || b && c;";
    assert_eq!(y_after(body, Precedence::Modern), 1.0);
    assert_eq!(y_after(body, Precedence::Scriptor), 0.0);
    let body = "y = 1 | 2 & 2;";
    assert_eq!(y_after(body, Precedence::Modern), 3.0);
    assert_eq!(y_after(body, Precedence::Scriptor), 2.0);
    let body = "y = 2 == 2 < 3;";
    assert_eq!(y_after(body, Precedence::Modern), 0.0);
    assert_eq!(y_after(body, Precedence::Scriptor), 1.0);
}

/// Balanced Annihilation's `armss.bos` has `bAiming OR Static_Var_5 AND
/// bMoving`, and its `.cob` does the `OR` first.
#[test]
fn tells_the_precedence_from_the_cob() {
    const PUSH_STATIC: u32 = 0x1002_1004;
    const AND: u32 = 0x1005_7000;
    const OR: u32 = 0x1005_8000;
    let words = |w: &[u32]| w.iter().flat_map(|w| w.to_le_bytes()).collect::<Vec<u8>>();
    let source = "Go() { if( bAiming OR Static_Var_5 AND bMoving ) { sleep 1; } }";
    let scriptor = words(&[PUSH_STATIC, 2, PUSH_STATIC, 4, OR, PUSH_STATIC, 1, AND]);
    let modern = words(&[PUSH_STATIC, 2, PUSH_STATIC, 4, PUSH_STATIC, 1, AND, OR]);
    assert_eq!(precedence(source, &scriptor), Some(Precedence::Scriptor));
    assert_eq!(precedence(source, &modern), Some(Precedence::Modern));
    assert_eq!(precedence(source, &words(&[1, 2, 3])), None);
    // Both read `a && b || c` the same, so it says nothing.
    let same = "Go() { if( a AND b OR c ) { sleep 1; } }";
    assert_eq!(precedence(same, &scriptor), None);
}

#[test]
fn reads_scriptor_s_other_operator_spellings() {
    assert_eq!(
        y_after("y = (3 >? 2) + (2 >=? 2) + (6 ? 3);", Precedence::Modern),
        4.0
    );
}

#[test]
fn a_constant_may_stand_in_brackets() {
    let source = "#define SPEED 2\n#define ANGLE 90\npiece base;\nCreate() {\n move base to y-axis [SPEED] now;\n move base to x-axis [-SPEED] now;\n turn base to x-axis <ANGLE> now;\n}\n";
    let lua = lua(source, Precedence::Modern);
    assert!(lua.contains("Move(base, y_axis, 2)"), "{lua}");
    assert!(lua.contains("Move(base, x_axis, 2)"), "{lua}");
    assert!(lua.contains("math.rad(90)"), "{lua}");
}

/// Pasted beside a `*`, a define of two terms is not the value it adds up to.
#[test]
fn a_define_of_more_than_one_term_is_pasted() {
    let sum = "#define SUM 1+2";
    assert_eq!(
        y_after_defining(sum, "y = SUM * 3;", Precedence::Modern),
        7.0
    );
    let source = "#define SUM (1+2)\npiece base;\nCreate() {\n var y;\n y = SUM * 3;\n}\n";
    assert!(lua(source, Precedence::Modern).contains("local SUM"));
}

#[test]
fn plays_a_declared_sound_and_skips_stop_sound() {
    let source =
        "piece base;\nsound bang, boom;\nCreate() {\n play-sound(bang, 1);\n stop-sound;\n}\n";
    let lua = lua(source, Precedence::Modern);
    assert!(lua.contains("\"sounds/bang.wav\""), "{lua}");
    assert!(!lua.contains("stop"), "{lua}");
}

#[test]
fn scales_a_piece() {
    let source = "piece base;\nCreate() {\n scale base to x-axis [2] speed [1];\n wait-for-scale base along x-axis;\n scale base to y-axis [1] now;\n}\n";
    let lua = lua(source, Precedence::Modern);
    assert!(lua.contains("Scale(base, 2, 1)"), "{lua}");
    assert!(lua.contains("UnitScript.WaitForScale(base)"), "{lua}");
    assert!(lua.contains("Scale(base, 1)"), "{lua}");
    let pieces = vec!["base".to_string()];
    let events = [ScriptEvent {
        frame: 0,
        callin: "Create".into(),
        args: Vec::new(),
        ambient: true,
    }];
    let timeline = run(
        &lua,
        "unit.lua",
        &Unit::new(&pieces),
        &events,
        2,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None, "{lua}");
}

/// The engine logs an unknown opcode and stops the thread, and so does the Lua.
#[test]
fn mission_command_stops_the_thread() {
    let source =
        "piece base;\nCreate() {\n Mission-Command(1, 2, 3);\n move base to y-axis [1] now;\n}\n";
    let conversion = convert(
        source,
        &Options {
            name: "unit.bos",
            includes: &HashMap::new(),
            pieces: None,
            linear_scale: MODERN_LINEAR,
            precedence: Precedence::Modern,
            prune: false,
        },
    )
    .unwrap();
    assert!(conversion
        .warnings
        .iter()
        .any(|w| w.to_string().contains("Mission-Command")));
    assert!(conversion.lua.contains("do error("), "{}", conversion.lua);
}

/// The engine sends `call-script lua_X` to LuaRules' `X` even when the script
/// defines a stub of that name, as Metal Factions' do.
#[test]
fn a_lua_call_goes_to_the_game_s_lua() {
    let source = "piece base;\nlua_turnToTarget() { return 0; }\nCreate() {\n call-script lua_turnToTarget(1, 6);\n}\n";
    let lua = lua(source, Precedence::Modern);
    assert!(
        lua.contains("if GG.turnToTarget then GG.turnToTarget(unitID, unitDefID, Spring.GetUnitTeam(unitID), 1, 6) end"),
        "{lua}"
    );
    let pieces = vec!["base".to_string()];
    let events = [ScriptEvent {
        frame: 0,
        callin: "Create".into(),
        args: Vec::new(),
        ambient: true,
    }];
    let timeline = run(
        &lua,
        "unit.lua",
        &Unit::new(&pieces),
        &events,
        2,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None, "{lua}");
}

/// What the compilers of shipped games let through, each seen in a `.cob`.
#[test]
fn reads_what_older_compilers_let_through() {
    // Metal Factions: a stray `)` after a condition, and a stray `~`.
    let body = "a = 1; if ((a) > 0)) { y = 2; }; if ((a) < 0)) { y = 3; } y = y + 1;~";
    assert_eq!(y_after(body, Precedence::Modern), 3.0);
    // Spring 1944: a statement with no `;` at the end of its line.
    let body = "y = 5\n y = y + 1\n";
    assert_eq!(y_after(body, Precedence::Modern), 6.0);
}

/// `--` starts a Lua comment, so a minus in front of a negative value is
/// bracketed. Balanced Annihilation's `corhlt.bos` turns about z to a value
/// the converter works out as negative.
#[test]
fn a_minus_before_a_negative_value_is_not_a_comment() {
    let source = "piece base;\nCreate() {\n var a;\n a = 3;\n turn base to z-axis 0 - 21845 speed <90>;\n move base to x-axis 0 - 65536 now;\n a = -(-a);\n}\n";
    let lua = lua(source, Precedence::Modern);
    assert!(
        !lua.contains("--2") && !lua.contains("--6") && !lua.contains("--a"),
        "{lua}"
    );
    let pieces = vec!["base".to_string()];
    let events = [ScriptEvent {
        frame: 0,
        callin: "Create".into(),
        args: Vec::new(),
        ambient: true,
    }];
    let timeline = run(
        &lua,
        "unit.lua",
        &Unit::new(&pieces),
        &events,
        2,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None, "{lua}");
    assert_eq!(timeline.frames[1][0], 1.0, "{lua}");
    assert_eq!(y_after("x = 3; y = -(-x);", Precedence::Modern), 3.0);
}

/// Balanced Annihilation's `exptype.h` is older than the one its `.cob` files
/// were compiled with, which gave `NOHEATCLOUD` as 128.
#[test]
fn an_explode_flag_nothing_defines_takes_its_standard_value() {
    let source = "piece base;\nKilled(severity, corpsetype) {\n explode base type NOHEATCLOUD | FALL;\n corpsetype = 1;\n return (0);\n}\n";
    let conversion = convert(
        source,
        &Options {
            name: "unit.bos",
            includes: &HashMap::new(),
            pieces: None,
            linear_scale: MODERN_LINEAR,
            precedence: Precedence::Modern,
            prune: false,
        },
    )
    .unwrap();
    assert!(
        conversion.lua.contains("Explode(base, 132)"),
        "{}",
        conversion.lua
    );
    assert!(conversion
        .warnings
        .iter()
        .any(|w| w.to_string().contains("NOHEATCLOUD")));
}
