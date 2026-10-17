//! The converter against a unit script written for these tests in the style of
//! Expand and Exterminate's, which is where it first went wrong: preprocessor
//! lines left in, a define turned into broken Lua, zero read as true. Every
//! conversion here is also loaded and run, because Lua that only looks right
//! is the failure this crate exists to end.

use coilbox_bos2lua::{
    convert, linear_scale, Conversion, Options, Precedence, FIVE_QUARTERS_LINEAR, MODERN_LINEAR,
    SCRIPTOR_LINEAR,
};
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
            precedence: Precedence::Modern,
            prune: false,
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
        world: None,
        engine: None,
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
    assert!(
        lua.contains("\tStartThread(runStarted, 0, Create)\n"),
        "{lua}"
    );
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
    assert!(
        lua.contains("function script.QueryWeapon1()\n\treturn flare\nend"),
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

/// A call-in the engine wants an answer from at once may not sleep in Lua, so
/// one whose BOS waits runs as a thread and answers what the engine answers
/// for a COB that has not finished: what it handed over
/// (`CobInstance.cpp:496-523,592-617`).
#[test]
fn a_call_in_that_waits_for_its_answer_runs_as_a_thread() {
    let c = convert_with(
        r#"
        piece base, turret, flare;
        AimWeapon1(heading, pitch) { return (1); }
        QueryWeapon1(piecenum) { sleep 100; piecenum = flare; }
        BlockShot1(target, block) { sleep 100; block = 1; }
        TargetWeight1(target, weight) { sleep 100; weight = 2; }
        HitByWeaponId(z, x, id, damage) { sleep 100; return (50); }
        "#,
        &HashMap::new(),
        65536,
    );
    let lua = &c.lua;
    for (callin, args, fallback) in [
        ("QueryWeapon1", "", "turret"),
        ("BlockShot1", "targetID, userTarget", "(targetID or 0) ~= 0"),
        ("TargetWeight1", "targetID", "(targetID or 0) / 65536"),
        ("HitByWeapon", "x, z, weaponDefID, damage", "damage / 100"),
    ] {
        let adapter = format!("function script.{callin}({args})\n\tlocal answer = {fallback}\n\tStartThread(function()\n\t\tanswer = ");
        assert!(lua.contains(&adapter), "{adapter}\n{lua}");
    }
    assert!(
        !lua.contains("function script.QueryWeapon1()\n\tlocal piecenum"),
        "{lua}"
    );
    assert!(
        !c.warnings.iter().any(|w| w.to_string().contains("waits")),
        "{:?}",
        c.warnings
    );
}

#[test]
fn holds_a_piece_used_as_a_number_as_bos_numbers_it() {
    let lua = walker();
    // base is piece 0 to a COB script, because the script declares it first.
    assert!(lua.contains("spray = 0 --[[base]]"), "{lua}");
    assert!(lua.contains("gun_ready = 0 --[[base]]"), "{lua}");
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
    assert!(lua.contains("Sleep(150 + 33)"), "{lua}");
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
    // Balanced Annihilation's armcom.cob holds [8] as 655360.
    let five_quarters = words(&[7, -204_800, -81_920, 163_840]);
    assert_eq!(linear_scale(WALKER, &scriptor), Some(SCRIPTOR_LINEAR));
    assert_eq!(linear_scale(WALKER, &modern), Some(MODERN_LINEAR));
    assert_eq!(
        linear_scale(WALKER, &five_quarters),
        Some(FIVE_QUARTERS_LINEAR)
    );
    assert_eq!(linear_scale(WALKER, &words(&[1, 2, 3])), None);
}

/// A turn goes the short way round, so an angle BOS stores on the other side
/// of a half turn from its degrees keeps BOS's value. Shaped like Balanced
/// Annihilation's `cormexp.bos` and `corspec.bos`.
#[test]
fn an_angle_stored_across_a_half_turn_keeps_bos_s_value() {
    let source = r#"
        piece base, shell, tong;
        Create()
        {
            turn shell to x-axis <-180.038462> speed <261>;
            turn tong to x-axis <180.043956> now;
            turn base to x-axis <90.016484> speed <30>;
        }
    "#;
    let lua = convert_with(source, &HashMap::new(), MODERN_LINEAR).lua;
    assert!(
        lua.contains("Turn(shell, x_axis, math.rad(-179.9945), math.rad(261))"),
        "{lua}"
    );
    assert!(
        lua.contains("Turn(tong, x_axis, math.rad(179.9945))"),
        "{lua}"
    );
    assert!(
        lua.contains("Turn(base, x_axis, math.rad(90.0165), math.rad(30))"),
        "{lua}"
    );
}

/// A speed too small for four decimal places stays a speed, because 0 in Lua
/// moves the piece at once. Shaped like Balanced Annihilation's `corsy.bos`.
#[test]
fn a_tiny_speed_is_not_written_as_zero() {
    let source = r#"
        piece base, turret;
        Create() { move turret to y-axis [6.95] speed [0.000018]; }
    "#;
    let lua = convert_with(source, &HashMap::new(), MODERN_LINEAR).lua;
    assert!(
        lua.contains("Move(turret, y_axis, 6.95, 0.000018)"),
        "{lua}"
    );
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
    let timeline = run(
        &lua,
        "walker.lua",
        &Unit::new(&pieces),
        &events,
        200,
        &HashMap::new(),
    );
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
            precedence: Precedence::Modern,
            prune: false,
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
        conversion
            .warnings
            .iter()
            .any(|w| w.to_string().contains("pad")),
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
    let timeline = run(
        &lua,
        "big.lua",
        &Unit::new(&names),
        &events,
        5,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None);
}

/// The shape of THIS's `THIS.h`: a multi-line macro with arguments that writes
/// whole functions, and assignments sitting outside any function.
const TRAIL_HEADER: &str = "static-var isMoving, fireStealthTime;\r\n\r\nfireStealthTime = 1000;\r\n\r\nlua_AddTrail() {\r\n\treturn 0;\r\n}\r\n\r\n#define TRAIL(p,width,ttl,rate) static-var EngineEnabled;\\\r\n\\\r\nMoveRate1() {\\\r\n\tisMoving = 1;\\\r\n\tif (!EngineEnabled) {\\\r\n\t\tcall-script lua_AddTrail(p,width,ttl,rate);\\\r\n\t\tEngineEnabled=1;\\\r\n\t}\\\r\n}\r\n";

const TRAIL_SCRIPT: &str = "piece base;\r\n\r\n#include \"THIS.h\"\r\n\r\nTRAIL(base,1,1,1)\t//fake trail\r\n\r\nCreate() {\r\n\tsleep fireStealthTime;\r\n}\r\n";

#[test]
fn a_macro_with_arguments_writes_the_functions_it_stands_for() {
    let includes = HashMap::from([("scripts/THIS.h".to_string(), TRAIL_HEADER.to_string())]);
    let conversion = convert(
        TRAIL_SCRIPT,
        &Options {
            name: "scripts/comet.bos",
            includes: &includes,
            pieces: None,
            linear_scale: MODERN_LINEAR,
            precedence: Precedence::Modern,
            prune: false,
        },
    )
    .unwrap();
    let lua = &conversion.lua;
    // A piece handed over as a number is numbered as BOS numbers it, and the
    // call goes to the trail gadget, which THIS puts in GG, not to the stub.
    assert!(
        lua.contains(
            "GG.AddTrail(unitID, unitDefID, Spring.GetUnitTeam(unitID), base - 1, 1, 1, 1)"
        ),
        "{lua}"
    );
    assert!(
        conversion.warnings.iter().any(|w| {
            let w = w.to_string();
            w.contains("THIS.h line 3") && w.contains("fireStealthTime = 1000;")
        }),
        "{:?}",
        conversion.warnings
    );
    let events = [event(0, "Create", &[]), event(5, "StartMoving", &[])];
    let timeline = run(
        lua,
        "comet.lua",
        &Unit::new(&pieces_of(lua)),
        &events,
        20,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None);
}

/// The loops run as the `.cob` THIS compiled them to runs them: the first
/// clause once, the test before every pass, and the last clause after the body.
#[test]
fn for_loops_run_as_the_compiled_script_runs_them() {
    let source = "piece base, arm, tip;\n\nCreate()\n{\n\tvar i, total;\n\ttotal = 0;\n\tfor (i = 0; i < 4; ++i) {\n\t\ttotal = total + [1];\n\t}\n\tmove base to y-axis total now;\n\tfor (i = 0; i < 2; sleep 100) ++i;\n\tmove arm to y-axis i * [1] now;\n\tfor (i = 5; i < 5; ++i) move arm to y-axis [9] now;\n\ti = 0;\n\tfor (;;) {\n\t\t++i;\n\t\tif (i == 3) {\n\t\t\tmove tip to y-axis i * [1] now;\n\t\t\treturn;\n\t\t}\n\t}\n}\n\nStop()\n{\n\tvar i;\n\tfor (i = 0; i < 4; ++i) {\n\t\treturn;\n\t}\n}\n";
    let lua = convert_with(source, &HashMap::new(), MODERN_LINEAR).lua;
    let pieces = pieces_of(&lua);
    let timeline = run(
        &lua,
        "loops.lua",
        &Unit::new(&pieces),
        &[event(0, "Create", &[])],
        30,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None, "{lua}");
    let last = timeline.frames.last().unwrap();
    let y = |name: &str| last[pieces.iter().position(|p| p == name).unwrap() * 6 + 1];
    assert_eq!((y("base"), y("arm"), y("tip")), (4.0, 2.0, 3.0), "{lua}");
}

#[test]
fn a_failed_conversion_names_the_includes_it_was_not_given() {
    let err = convert(
        TRAIL_SCRIPT,
        &Options {
            name: "scripts/comet.bos",
            includes: &HashMap::new(),
            pieces: None,
            linear_scale: MODERN_LINEAR,
            precedence: Precedence::Modern,
            prune: false,
        },
    )
    .err()
    .unwrap();
    assert!(err.contains("THIS.h"), "{err}");
}

#[test]
fn a_missing_include_is_said_and_the_engine_s_names_stand_in() {
    let conversion = convert_with(WALKER, &HashMap::new(), MODERN_LINEAR);
    assert_eq!(
        conversion.missing_includes,
        ["flags.h", "animations/stride.bos"]
    );
    assert!(convert_with(WALKER, &includes(), MODERN_LINEAR)
        .missing_includes
        .is_empty());
    assert!(
        conversion
            .warnings
            .iter()
            .any(|w| w.to_string().contains("flags.h")),
        "{:?}",
        conversion.warnings
    );
    assert!(
        conversion.lua.contains("COB.INBUILDSTANCE"),
        "{}",
        conversion.lua
    );
    assert!(
        conversion
            .warnings
            .iter()
            .any(|w| w.to_string().contains("SHATTER")),
        "{:?}",
        conversion.warnings
    );
}

/// The search every host runs finds exactly the files the walker includes, and
/// the conversion it feeds reports nothing missing.
#[test]
fn find_includes_finds_what_convert_looks_for() {
    let files = includes();
    let mut asked = Vec::new();
    let found = coilbox_bos2lua::find_includes(WALKER, "scripts/walker.bos", |candidate| {
        asked.push(candidate.to_string());
        files
            .get_key_value(candidate)
            .map(|(path, text)| (path.clone(), text.clone()))
    });
    let mut paths: Vec<_> = found.iter().map(|f| f.path.as_str()).collect();
    paths.sort();
    assert_eq!(paths, ["scripts/animations/stride.bos", "scripts/flags.h"]);
    let map = found.into_iter().map(|f| (f.path, f.text)).collect();
    assert!(convert_with(WALKER, &map, MODERN_LINEAR)
        .missing_includes
        .is_empty());
    assert!(asked
        .iter()
        .all(|c| c == &c.to_lowercase() && !c.contains('\\')));
}

#[test]
fn find_includes_skips_comments_follows_parents_and_stops_on_a_cycle() {
    let files = HashMap::from([
        ("scripts/a.h", "#include \"lib\\B.h\"\n"),
        (
            "scripts/lib/b.h",
            "  # include <../a.h>\n#include \"../c.h\"\n",
        ),
        ("scripts/c.h", "// #include \"never.h\"\n"),
        ("scripts/never.h", ""),
    ]);
    let found = coilbox_bos2lua::find_includes(
        "#include \"A.H\"\n/* x */ #include \"never.h\"\n",
        "scripts/unit.bos",
        |candidate| {
            files
                .get(candidate)
                .map(|t| (candidate.to_string(), t.to_string()))
        },
    );
    let names: Vec<_> = found
        .iter()
        .map(|f| (f.name.as_str(), f.path.as_str()))
        .collect();
    assert_eq!(
        names,
        [
            ("A.H", "scripts/a.h"),
            ("lib\\B.h", "scripts/lib/b.h"),
            ("../c.h", "scripts/c.h"),
        ]
    );
}

/// Shaped like Balanced Annihilation's `corack.bos`, which answers
/// `QueryNanoPiece` with a number that swaps between 0 and 1. Those are the
/// first two pieces the script declares, which the model holds in another
/// order.
#[test]
fn a_piece_given_as_a_number_is_the_one_the_script_declares_there() {
    let source = "piece rnanospray, lnanospray, torso, ground, pelvis;\n\nstatic-var nanoNozzle;\n\nCreate()\n{\n\tnanoNozzle = 0;\n}\n\nQueryNanoPiece(piecenum)\n{\n\tpiecenum = nanoNozzle;\n\tnanoNozzle = !nanoNozzle;\n}\n\nTransportPickup(unitid)\n{\n\tattach-unit unitid to 1;\n}\n";
    let model: Vec<String> = ["ground", "pelvis", "torso", "rnanospray", "lnanospray"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let spray = |frame: u32, action: coilbox_springlua::unitscript::EngineAction| ScriptEvent {
        frame,
        callin: String::new(),
        args: Vec::new(),
        ambient: false,
        world: None,
        engine: Some(action),
    };
    for prune in [false, true] {
        let includes = HashMap::new();
        let lua = convert(
            source,
            &Options {
                name: "scripts/corack.bos",
                includes: &includes,
                pieces: Some(&model),
                linear_scale: MODERN_LINEAR,
                precedence: Precedence::Modern,
                prune,
            },
        )
        .unwrap()
        .lua;
        let events = [
            event(0, "Create", &[]),
            spray(1, coilbox_springlua::unitscript::EngineAction::NanoStart),
            spray(5, coilbox_springlua::unitscript::EngineAction::NanoStop),
        ];
        let timeline = run(
            &lua,
            "corack.lua",
            &Unit::new(&model),
            &events,
            10,
            &HashMap::new(),
        );
        assert_eq!(timeline.error, None, "{lua}");
        let nano: Vec<String> = timeline
            .events
            .iter()
            .filter_map(|e| match e {
                coilbox_unitpose::ScriptOutput::Nano { piece, .. } => piece.clone(),
                _ => None,
            })
            .collect();
        assert!(!nano.is_empty(), "prune {prune}: no nano sprayed\n{lua}");
        assert!(
            nano.iter().all(|p| p == "rnanospray" || p == "lnanospray"),
            "prune {prune}: {nano:?}\n{lua}"
        );
        assert!(
            nano.iter().any(|p| p == "lnanospray"),
            "prune {prune}: {nano:?}"
        );
        assert!(lua.contains("return PIECES[piecenum + 1]"), "{lua}");
        // A number the script writes out names the piece.
        if !prune {
            assert!(lua.contains("AttachUnit(lnanospray, unitid)"), "{lua}");
        }
    }
}

/// Every call-in that answers with a piece, `attach-unit` and `get PIECE_Y`,
/// each handed a number worked out from a variable. COB counts that number
/// along the script's own `piece` line (`CobInstance.cpp:142-195`), and a Lua
/// script's pieces are the model's (`LuaUnitScript.cpp:264-277`), which holds
/// them in another order here.
#[test]
fn every_piece_worked_out_from_a_number_counts_the_script_s_own_pieces() {
    // gunPiece starts at 0, so each number below names one declared piece.
    let source = "piece flare, barrel, pad1, pad2, nano, base, turret;\n\nstatic-var gunPiece;\n\nCreate()\n{\n\tif (get PIECE_Y(gunPiece + 3) == [7]) { move base to y-axis [1] now; }\n}\n\nQueryWeapon1(p) { p = gunPiece; }\nAimFromWeapon1(p) { p = gunPiece + 1; }\nQueryNanoPiece(p) { p = 4; }\nQueryBuildInfo(p) { p = gunPiece + 5; }\nQueryTransport(p) { p = gunPiece + 6; }\nQueryLandingPad(a, b) { a = gunPiece + 2; b = gunPiece + 3; }\nTransportPickup(unitid) { attach-unit unitid to gunPiece + 3; }\n";
    let model: Vec<String> = ["base", "turret", "barrel", "flare", "pad1", "pad2", "nano"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    // pad2 sits 7 elmos up and nothing else is off the ground.
    let rest: Vec<coilbox_springlua::unitscript::Rest> = model
        .iter()
        .map(|name| coilbox_springlua::unitscript::Rest {
            parent: (name != "base").then_some(0),
            position: if name == "pad2" {
                [0.0, 7.0, 0.0]
            } else {
                [0.0; 3]
            },
        })
        .collect();
    let unit = Unit {
        rest: &rest,
        ..Unit::new(&model)
    };
    for prune in [false, true] {
        let lua = convert(
            source,
            &Options {
                name: "scripts/order.bos",
                includes: &HashMap::new(),
                pieces: Some(&model),
                linear_scale: MODERN_LINEAR,
                precedence: Precedence::Modern,
                prune,
            },
        )
        .unwrap()
        .lua;

        let asked = [
            ("QueryWeapon1", "flare"),
            ("AimFromWeapon1", "barrel"),
            ("QueryNanoPiece", "nano"),
            ("QueryBuildInfo", "base"),
            ("QueryTransport", "turret"),
        ];
        let callins: Vec<String> = asked.iter().map(|(c, _)| c.to_string()).collect();
        let probes = coilbox_springlua::unitscript::probe(&lua, "order.lua", &unit, &callins);
        assert_eq!(probes.error, None, "{lua}");
        for (callin, piece) in asked {
            let probe = probes.probes.iter().find(|p| p.callin == callin).unwrap();
            assert_eq!(probe.note, None, "prune {prune}: {callin}\n{lua}");
            assert_eq!(
                probe.pieces.first().map(String::as_str),
                Some(piece),
                "prune {prune}: {callin}\n{lua}"
            );
        }
        // The probe reads one piece, and QueryLandingPads answers with a list.
        assert!(
            lua.contains("return {PIECES[a + 1], PIECES[b + 1]}"),
            "prune {prune}\n{lua}"
        );

        let timeline = run(
            &lua,
            "order.lua",
            &unit,
            &[event(0, "Create", &[]), event(2, "TransportPickup", &[9.0])],
            5,
            &HashMap::new(),
        );
        assert_eq!(timeline.error, None, "{lua}");
        let attached: Vec<Option<String>> = timeline
            .events
            .iter()
            .filter_map(|e| match e {
                coilbox_unitpose::ScriptOutput::Attach { piece, .. } => Some(piece.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(attached, [Some("pad2".to_string())], "prune {prune}\n{lua}");
        // base moved up, so PIECE_Y read pad2 rather than the model's fourth piece.
        let base_y = timeline.frames[1][1];
        assert!(
            (base_y - 1.0).abs() < 1e-6,
            "prune {prune}: {base_y}\n{lua}"
        );
    }
}

/// The engine draws a muzzle flame for `show` inside a fire function and
/// leaves the piece hidden (`CobThread.cpp:715-728`). Anywhere else, `show`
/// unhides.
#[test]
fn show_in_a_fire_function_becomes_show_flare() {
    let source = r#"
        piece base, flare;
        Create() { hide flare; show base; }
        FirePrimary() { show flare; }
    "#;
    let lua = convert(
        source,
        &Options {
            name: "scripts/gun.bos",
            includes: &HashMap::new(),
            pieces: None,
            linear_scale: MODERN_LINEAR,
            precedence: Precedence::Modern,
            prune: false,
        },
    )
    .unwrap()
    .lua;

    assert!(lua.contains("Spring.UnitScript.ShowFlare(flare)"), "{lua}");
    assert!(lua.contains("Show(base)"), "{lua}");
    assert!(!lua.contains("Show(flare)"), "{lua}");
}

/// Two arguments that each move the shared random generator are still worked
/// out in the order written, then handed over reversed.
#[test]
fn a_started_script_s_arguments_are_reversed_but_worked_out_in_order() {
    let source = "piece base;\nLift(first, second) { sleep first; }\nCreate() { start-script Lift(rand(1, 2), rand(3, 4)); start-script Lift(5, 6); start-script Lift(7); }\n";
    let conversion = convert_with(source, &HashMap::new(), MODERN_LINEAR);
    let lua = conversion.lua;
    assert!(lua.contains("local arg1, arg2 = "), "{lua}");
    assert!(lua.contains("startScript(Lift, arg2, arg1)"), "{lua}");
    assert!(lua.contains("startScript(Lift, 6, 5)"), "{lua}");
    assert!(lua.contains("startScript(Lift, 7)"), "{lua}");
    let said = conversion
        .warnings
        .iter()
        .filter(|w| w.message.contains("reverse order"))
        .count();
    assert_eq!(said, 1, "{:?}", conversion.warnings);
}

/// Convert `source` and play `actions` against it, handing back what the
/// script announced and the Lua itself.
fn play_engine(
    source: &str,
    pieces: &[&str],
    actions: &[(u32, coilbox_springlua::unitscript::EngineAction)],
    prune: bool,
) -> (Vec<coilbox_unitpose::ScriptOutput>, String) {
    let includes = HashMap::new();
    let model: Vec<String> = pieces.iter().map(|s| s.to_string()).collect();
    let lua = convert(
        source,
        &Options {
            name: "scripts/unit.bos",
            includes: &includes,
            pieces: Some(&model),
            linear_scale: MODERN_LINEAR,
            precedence: Precedence::Modern,
            prune,
        },
    )
    .unwrap()
    .lua;
    let events: Vec<ScriptEvent> = actions
        .iter()
        .map(|(frame, action)| ScriptEvent {
            frame: *frame,
            callin: String::new(),
            args: Vec::new(),
            ambient: false,
            world: None,
            engine: Some(*action),
        })
        .collect();
    let timeline = run(
        &lua,
        "unit.lua",
        &Unit::new(&model),
        &events,
        10,
        &HashMap::new(),
    );
    assert_eq!(timeline.error, None, "{lua}");
    (timeline.events, lua)
}

/// A COB script with no `QueryNanoPiece` sprays from script piece 1 (`CobInstance.cpp:411-420`).
#[test]
fn a_script_with_no_query_nano_piece_sprays_from_its_second_piece() {
    use coilbox_springlua::unitscript::EngineAction::{NanoStart, NanoStop};
    let source = "piece base, nozzle, arm;\n\nCreate()\n{\n\thide nozzle;\n}\n";
    for prune in [false, true] {
        let (events, lua) = play_engine(
            source,
            &["arm", "nozzle", "base"],
            &[(1, NanoStart), (5, NanoStop)],
            prune,
        );
        let nano: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                coilbox_unitpose::ScriptOutput::Nano { piece, .. } => Some(piece.clone()),
                _ => None,
            })
            .collect();
        assert!(!nano.is_empty(), "prune {prune}: no nano\n{lua}");
        assert!(
            nano.iter().all(|p| p.as_deref() == Some("nozzle")),
            "prune {prune}: {nano:?}\n{lua}"
        );
        assert!(lua.contains("function script.QueryNanoPiece()"), "{lua}");
        assert!(lua.contains("return nozzle\n"), "{lua}");
    }
}

/// With one piece there is no script piece 1, and the engine sprays from nothing.
#[test]
fn a_script_with_one_piece_and_no_query_nano_piece_gets_none_written() {
    let (_, lua) = play_engine("piece base;\n\nCreate()\n{\n}\n", &["base"], &[], false);
    assert!(!lua.contains("QueryNanoPiece"), "{lua}");
}

/// A script that answers `QueryNanoPiece` and `QueryWeapon1` itself keeps its own.
#[test]
fn a_script_that_answers_its_own_pieces_gets_nothing_added() {
    let source = "piece base, flare, nozzle;\n\nQueryNanoPiece(p) { p = nozzle; }\nQueryWeapon1(p) { p = flare; }\nAimFromWeapon1(p) { p = base; }\nAimWeapon1(h, pt) { return (1); }\nFireWeapon1() { }\n";
    let (_, lua) = play_engine(source, &["base", "flare", "nozzle"], &[], false);
    assert_eq!(
        lua.matches("function script.QueryNanoPiece").count(),
        1,
        "{lua}"
    );
    assert_eq!(
        lua.matches("function script.QueryWeapon1").count(),
        1,
        "{lua}"
    );
    assert_eq!(
        lua.matches("function script.AimFromWeapon1").count(),
        1,
        "{lua}"
    );
    assert!(!lua.contains("The engine answers script piece 1"), "{lua}");
}

/// A weapon the script aims and fires but never queries shoots from script piece 1,
/// for the weapon numbers the script names and no others.
#[test]
fn a_weapon_with_no_query_weapon_shoots_from_the_second_piece() {
    use coilbox_springlua::unitscript::EngineAction::Fire;
    let source = "piece base, lnanospray, turret;\n\nstatic-var ready;\n\nAimWeapon1(h, pt)\n{\n\treturn (1);\n}\n\nFireWeapon1()\n{\n\tready = 1;\n}\n\nShot2(z)\n{\n\tready = 2;\n}\n\nQueryNanoPiece(p)\n{\n\tp = turret;\n}\n";
    for prune in [false, true] {
        let (events, lua) = play_engine(
            source,
            &["base", "lnanospray", "turret"],
            &[(1, Fire)],
            prune,
        );
        assert!(
            events.iter().any(|e| matches!(e, coilbox_unitpose::ScriptOutput::Shot { weapon: 1, piece: Some(p), .. } if p == "lnanospray")),
            "prune {prune}: {events:?}\n{lua}"
        );
        for name in [
            "QueryWeapon1",
            "AimFromWeapon1",
            "QueryWeapon2",
            "AimFromWeapon2",
        ] {
            assert!(
                lua.contains(&format!("function script.{name}()")),
                "{name}\n{lua}"
            );
        }
        assert!(!lua.contains("script.QueryWeapon3"), "{lua}");
        assert!(
            !lua.contains("function script.QueryNanoPiece()\n\treturn PIECES[2]"),
            "{lua}"
        );
    }
}
