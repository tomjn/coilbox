//! Does the Lua the converter writes move a unit the way its COB does?
//!
//! For every script in a game, run the game's own `.cob` through the COB
//! runtime and the converted `.bos` through the Lua one, with the same events,
//! and compare where every piece is on every frame. Both runtimes are the ones
//! the preview uses, so a script that matches here previews the same either way.
//!
//! Set `COILBOX_BOS_SWEEP` to a game's unpacked `scripts` folder. Skipped when
//! it is unset, because no game ships in this repo.

use coilbox_springlua::unitscript::{run as run_lua, Rest, ScriptEvent, Unit};
use coilbox_unitpose::{EngineAction, ScriptOutput};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Radians or elmos, for rounding in the runtimes.
const TOLERANCE: f64 = 0.01;

/// The converter writes `<150>` as `math.rad(150)`, where the compiler stores
/// 150 × 182 of 65536ths, 149.96 degrees. That is 1 − 182 / (65536 / 360), or
/// 0.024%, of every angle, and on a spin it grows with every turn. So a
/// rotation may be off by twice that share of how far it has turned.
const ANGLE_DRIFT: f64 = 0.0005;
const FRAMES: u32 = 300;

/// Expand and Exterminate scripts whose Lua is right for the engine but which
/// these two previews play a frame or a cycle apart, each looked at by hand.
const KNOWN: &[(&str, &str)] = &[
    (
        "scripts/gdadvhfact2.bos",
        "a turn lasting a whole number of frames ends a frame apart",
    ),
    (
        "scripts/gdvadvhfact2.bos",
        "a turn lasting a whole number of frames ends a frame apart",
    ),
    (
        "scripts/gdhfact2.bos",
        "a turn lasting a whole number of frames ends a frame apart",
    ),
    (
        "scripts/urccom2.bos",
        "a turn lasting a whole number of frames ends a frame apart",
    ),
    (
        "scripts/alienaaa.bos",
        "a sleeper wakes in the frame StartMoving arrives",
    ),
    (
        "scripts/alienpenetrator.bos",
        "a sleeper wakes in the frame StartMoving arrives",
    ),
];

fn files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            files(&path, out);
        } else {
            out.push(path);
        }
    }
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

fn action(frame: u32, action: EngineAction) -> ScriptEvent {
    ScriptEvent {
        frame,
        callin: String::new(),
        args: Vec::new(),
        ambient: false,
        world: None,
        engine: Some(action),
    }
}

fn pieces_of(lua: &str) -> Vec<String> {
    lua.split("piece(\"")
        .skip(1)
        .filter_map(|rest| rest.split('"').next())
        .map(str::to_string)
        .collect()
}

#[test]
fn converted_scripts_move_pieces_as_their_cobs_do() {
    let Ok(root) = std::env::var("COILBOX_BOS_SWEEP") else {
        eprintln!("COILBOX_BOS_SWEEP is not set, so there is nothing to compare.");
        return;
    };
    let root = PathBuf::from(root);
    let mut all = Vec::new();
    files(&root, &mut all);
    let base = root.parent().unwrap_or(&root).to_path_buf();
    let name_of = |p: &Path| {
        p.strip_prefix(&base)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/")
    };
    let text = |p: &Path| String::from_utf8_lossy(&std::fs::read(p).unwrap()).into_owned();
    let includes: HashMap<String, String> = all.iter().map(|p| (name_of(p), text(p))).collect();
    let cobs: HashMap<String, PathBuf> = all
        .iter()
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("cob")))
        .map(|p| (name_of(p).to_lowercase(), p.clone()))
        .collect();

    let events = [
        event(0, "Create", &[]),
        event(1, "setSFXoccupy", &[4.0]),
        event(5, "StartMoving", &[]),
        event(60, "StopMoving", &[]),
        event(70, "Activate", &[]),
        event(80, "StartBuilding", &[0.5, 0.1]),
        action(81, EngineAction::NanoStart),
        action(119, EngineAction::NanoStop),
        event(120, "StopBuilding", &[]),
        event(130, "AimWeapon1", &[0.8, 0.1]),
        event(131, "AimWeapon2", &[-0.5, 0.2]),
        action(150, EngineAction::Fire),
        event(160, "Deactivate", &[]),
        event(200, "Killed", &[50.0, 100.0]),
    ];

    let (mut same, mut skipped) = (0, Vec::new());
    let mut differ = Vec::new();
    for path in all
        .iter()
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("bos")))
    {
        let name = name_of(path);
        if name.to_lowercase().contains("/animations/") {
            continue;
        }
        // `COILBOX_BOS_PARITY_ONLY=gdhtanki2,urcfortress2` narrows the run to
        // those scripts and prints the frames around where each first differs.
        let only = std::env::var("COILBOX_BOS_PARITY_ONLY").ok();
        if let Some(only) = &only {
            let stem = path.file_stem().unwrap().to_string_lossy().to_lowercase();
            if !only.split(',').any(|o| o == stem) {
                continue;
            }
        }
        let Some(cob) = cobs.get(&name.to_lowercase().replace(".bos", ".cob")) else {
            skipped.push(format!("{name}: no .cob beside it"));
            continue;
        };
        let source = text(path);
        let bytes = std::fs::read(cob).unwrap();
        let linear_scale = coilbox_bos2lua::linear_scale(&source, &bytes)
            .unwrap_or(coilbox_bos2lua::MODERN_LINEAR);
        let conversion = match coilbox_bos2lua::convert(
            &source,
            &coilbox_bos2lua::Options {
                name: &name,
                includes: &includes,
                pieces: None,
                linear_scale,
                precedence: coilbox_bos2lua::precedence(&source, &bytes).unwrap_or_default(),
                prune: false,
            },
        ) {
            Ok(c) => c,
            Err(e) => {
                differ.push(format!("{name}: did not convert: {e}"));
                continue;
            }
        };
        // The model holds the pieces in another order from the script's, as
        // a real one usually does, so a piece the Lua finds by number rather
        // than by name shows up as the wrong one.
        let mut pieces = pieces_of(&conversion.lua);
        pieces.reverse();
        let from_cob = crate::cobrun::run(&bytes, &pieces, &events, FRAMES, &[], &HashMap::new());
        let from_lua = run_lua(
            &conversion.lua,
            &name,
            &Unit::new(&pieces),
            &events,
            FRAMES,
            &HashMap::new(),
        );
        if let Some(e) = &from_cob.error {
            skipped.push(format!("{name}: the COB itself stops: {e}"));
            continue;
        }
        if let Some(e) = &from_lua.error {
            differ.push(format!("{name}: the Lua stops: {e}"));
            continue;
        }
        if let Some(w) = from_lua
            .warnings
            .iter()
            .find(|w| w.contains("That thread stopped"))
        {
            differ.push(format!("{name}: a Lua thread stops: {w}"));
            continue;
        }
        let first = first_difference(&from_cob, &from_lua, &pieces, &name, only.is_some());
        match first {
            None => same += 1,
            Some(_) if KNOWN.iter().any(|(known, _)| *known == name) => same += 1,
            Some(d) => differ.push(d),
        }
        let known = KNOWN.iter().any(|(known, _)| *known == name);
        let nano = |t: &coilbox_unitpose::Timeline| -> Vec<Option<String>> {
            t.events
                .iter()
                .filter_map(|e| match e {
                    ScriptOutput::Nano { piece, .. } => Some(piece.clone()),
                    _ => None,
                })
                .collect()
        };
        // A COB script with no QueryNanoPiece sprays from its piece 1 and a Lua
        // one sprays nothing, in the engine as in the runtimes, so only an
        // answer the script gives is compared.
        let answers = conversion.lua.contains("QueryNanoPiece");
        let (cob_nano, lua_nano) = (nano(&from_cob), nano(&from_lua));
        if answers && cob_nano != lua_nano && !known {
            let at = cob_nano.iter().zip(&lua_nano).position(|(a, b)| a != b);
            differ.push(format!(
                "{name}: QueryNanoPiece names {:?} in COB and {:?} in Lua, first apart at spray {at:?}",
                cob_nano.iter().flatten().collect::<std::collections::BTreeSet<_>>(),
                lua_nano.iter().flatten().collect::<std::collections::BTreeSet<_>>(),
            ));
        }
        let heard = |t: &coilbox_unitpose::Timeline| -> Vec<ScriptOutput> {
            t.events
                .iter()
                .filter(|e| !matches!(e, ScriptOutput::Nano { .. }))
                .cloned()
                .map(|e| match e {
                    ScriptOutput::Sound { frame, .. } => ScriptOutput::Sound { frame, name: None },
                    other => other,
                })
                .collect()
        };
        if heard(&from_cob) != heard(&from_lua) && !known {
            differ.push(format!("{name}: the two announce different events"));
        }
    }
    eprintln!(
        "{same} match or are known, {} differ, {} skipped",
        differ.len(),
        skipped.len()
    );
    for line in skipped.iter().chain(&differ) {
        eprintln!("  {line}");
    }
    assert!(differ.is_empty(), "\n{}", differ.join("\n"));
}

/// Where two runs of the same unit first disagree, if they do. `dump` prints
/// the frames around it.
fn first_difference(
    from_cob: &coilbox_unitpose::Timeline,
    from_lua: &coilbox_unitpose::Timeline,
    pieces: &[String],
    name: &str,
    dump: bool,
) -> Option<String> {
    {
        let only: Option<()> = dump.then_some(());
        let per_piece = from_cob
            .frames
            .first()
            .map_or(0, |f| f.len() / pieces.len().max(1));
        let mut first = None;
        let tau = std::f64::consts::TAU;
        let mut travelled = vec![0.0; from_cob.frames.first().map_or(0, Vec::len)];
        'frames: for (f, (a, b)) in from_cob.frames.iter().zip(&from_lua.frames).enumerate() {
            if f > 0 {
                for (k, (now, before)) in a.iter().zip(&from_cob.frames[f - 1]).enumerate() {
                    let step = (now - before).rem_euclid(tau);
                    travelled[k] += step.min(tau - step);
                }
            }
            for (k, (x, y)) in a.iter().zip(b).enumerate() {
                // Rotations are compared round the circle, so a full turn
                // one way and none at all are the same place.
                let (gap, allowed) = if k % 6 >= 3 {
                    (
                        ((x - y).rem_euclid(tau)).min((y - x).rem_euclid(tau)),
                        TOLERANCE + travelled[k] * ANGLE_DRIFT,
                    )
                } else {
                    ((x - y).abs(), TOLERANCE)
                };
                if gap > allowed {
                    let piece = pieces
                        .get(k / per_piece.max(1))
                        .cloned()
                        .unwrap_or_default();
                    if only.is_some() {
                        let at = k / per_piece.max(1) * per_piece;
                        for g in f.saturating_sub(4)..(f + 6).min(from_cob.frames.len()) {
                            let show = |frames: &Vec<Vec<f64>>| {
                                frames.get(g).map_or(String::new(), |fr| {
                                    fr[at..at + per_piece]
                                        .iter()
                                        .map(|v| format!("{v:8.4}"))
                                        .collect::<Vec<_>>()
                                        .join(" ")
                                })
                            };
                            eprintln!(
                                "  {piece} frame {g}\n    COB {}\n    Lua {}",
                                show(&from_cob.frames),
                                show(&from_lua.frames)
                            );
                        }
                    }
                    first = Some(format!(
                        "{name}: frame {f}, {piece} value {}: COB {x:.4}, Lua {y:.4}",
                        k % per_piece.max(1)
                    ));
                    break 'frames;
                }
            }
        }
        if first.is_none() && from_cob.hidden != from_lua.hidden {
            first = Some(format!(
                "{name}: a piece is hidden in one and shown in the other"
            ));
        }
        first
    }
}

/// The fixture the converter's own tests use, compiled with this crate's
/// compiler and converted with the converter, must move the same way. Unlike
/// the sweep above this needs no game, so it runs everywhere.
#[test]
fn the_converter_s_fixture_moves_as_its_compiled_cob_does() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../coilbox-bos2lua/tests/fixtures");
    let read = |p: &str| std::fs::read_to_string(dir.join(p)).unwrap();
    let source = read("walker.bos");
    let cob = crate::compile_bos(&source, &dir).unwrap();
    let includes = HashMap::from([
        ("scripts/flags.h".to_string(), read("flags.h")),
        (
            "scripts/animations/stride.bos".to_string(),
            read("animations/stride.bos"),
        ),
    ]);
    assert_eq!(
        coilbox_bos2lua::linear_scale(&source, &cob),
        Some(coilbox_bos2lua::MODERN_LINEAR)
    );
    let lua = coilbox_bos2lua::convert(
        &source,
        &coilbox_bos2lua::Options {
            name: "scripts/walker.bos",
            includes: &includes,
            pieces: None,
            linear_scale: coilbox_bos2lua::MODERN_LINEAR,
            precedence: coilbox_bos2lua::Precedence::Modern,
            prune: false,
        },
    )
    .unwrap()
    .lua;
    let pieces = pieces_of(&lua);
    let events = [
        event(0, "Create", &[]),
        event(12, "StartMoving", &[]),
        event(62, "StopMoving", &[]),
        event(80, "AimWeapon1", &[0.8, 0.1]),
        event(100, "FireWeapon1", &[]),
        event(110, "StartBuilding", &[0.5, 0.1]),
        event(150, "StopBuilding", &[]),
        event(180, "Killed", &[80.0, 100.0]),
    ];
    let from_cob = crate::cobrun::run(&cob, &pieces, &events, 220, &[], &HashMap::new());
    let from_lua = run_lua(
        &lua,
        "walker.lua",
        &Unit::new(&pieces),
        &events,
        220,
        &HashMap::new(),
    );
    assert_eq!(from_cob.error, None);
    assert_eq!(from_lua.error, None);
    assert_eq!(
        first_difference(&from_cob, &from_lua, &pieces, "walker", false),
        None
    );
}

/// Compile `source` with this crate's compiler and convert it with the
/// converter, as the fixture test above does, and name its pieces.
fn both(source: &str) -> (Vec<u8>, String, Vec<String>) {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../coilbox-bos2lua/tests/fixtures");
    let cob = crate::compile_bos(source, &dir).unwrap();
    let lua = coilbox_bos2lua::convert(
        source,
        &coilbox_bos2lua::Options {
            name: "scripts/events.bos",
            includes: &HashMap::new(),
            pieces: None,
            linear_scale: coilbox_bos2lua::linear_scale(source, &cob)
                .unwrap_or(coilbox_bos2lua::MODERN_LINEAR),
            precedence: coilbox_bos2lua::Precedence::Modern,
            prune: false,
        },
    )
    .unwrap()
    .lua;
    let pieces = pieces_of(&lua);
    (cob, lua, pieces)
}

/// A flare in `FirePrimary`, a `show` in an ordinary function, a
/// `QueryWeapon1` and an alternating `QueryNanoPiece`, through both runtimes.
/// They announce the same events, and the flare piece stays hidden.
#[test]
fn both_runtimes_fire_and_spray_alike() {
    let source = r#"
        piece base, turret, flare1, flare2;
        static-var alternate;
        Create() { hide flare1; hide flare2; alternate = 0; }
        QueryWeapon1(piecenum) { piecenum = flare1; }
        AimFromWeapon1(piecenum) { piecenum = turret; }
        FirePrimary() { show flare1; }
        Shot1(zero) { show flare2; }
        QueryNanoPiece(piecenum) {
            if (alternate) { piecenum = flare1; alternate = 0; }
            else { piecenum = flare2; alternate = 1; }
        }
    "#;
    let (cob, lua, pieces) = both(source);
    let events = [
        event(0, "Create", &[]),
        ScriptEvent {
            frame: 10,
            callin: String::new(),
            args: vec![1.0],
            ambient: false,
            world: None,
            engine: Some(EngineAction::Fire),
        },
        action(20, EngineAction::NanoStart),
        action(30, EngineAction::NanoStop),
    ];
    let from_cob = crate::cobrun::run(&cob, &pieces, &events, 40, &[], &HashMap::new());
    let from_lua = run_lua(
        &lua,
        "gun.lua",
        &Unit::new(&pieces),
        &events,
        40,
        &HashMap::new(),
    );

    assert_eq!(from_cob.error, None);
    assert_eq!(from_lua.error, None);
    assert_eq!(from_cob.events, from_lua.events);
    assert!(from_cob.events.contains(&ScriptOutput::Flare {
        frame: 10,
        piece: "flare1".into()
    }));
    assert!(from_cob.events.contains(&ScriptOutput::Shot {
        frame: 10,
        weapon: 1,
        piece: Some("flare1".into())
    }));
    let flare1 = pieces.iter().position(|p| p == "flare1").unwrap();
    let flare2 = pieces.iter().position(|p| p == "flare2").unwrap();
    for timeline in [&from_cob, &from_lua] {
        assert!(timeline.hidden[39][flare1]);
        assert!(!timeline.hidden[39][flare2]);
    }
}

/// `TransportPickup(2)`, with the stand-in parked at (30, 0, 40).
fn pickup_at(frame: u32) -> ScriptEvent {
    ScriptEvent {
        frame,
        callin: "TransportPickup".into(),
        args: vec![2.0],
        ambient: false,
        world: Some(coilbox_unitpose::World {
            stand_in: Some(coilbox_unitpose::StandIn {
                id: 2,
                pos: Some([30.0, 0.0, 40.0]),
                radius: 5.0,
                height: 6.0,
            }),
            own: coilbox_unitpose::Size {
                radius: 10.0,
                height: 12.0,
            },
        }),
        engine: None,
    }
}

/// Rest positions in the order the conversion lists its pieces, by name, so
/// the test does not depend on that order.
fn rest_for(pieces: &[String], at: &[(&str, Option<&str>, [f64; 3])]) -> Vec<Rest> {
    let index = |name: &str| pieces.iter().position(|p| p == name).unwrap();
    pieces
        .iter()
        .map(|piece| {
            let (_, parent, position) = at.iter().find(|(name, _, _)| name == piece).unwrap();
            Rest {
                parent: parent.map(index),
                position: *position,
            }
        })
        .collect()
}

/// Sound is left out: this crate's compiler writes no sound table, so a
/// compiled `play-sound` has no name, and the converter plays
/// `sounds/<name>.wav`. Each runtime's own tests cover sound.
#[test]
fn both_runtimes_announce_the_same_events() {
    let (cob, lua, pieces) = both(
        r#"
#define SHATTER 1
#define BITMAP1 256
piece base, flare, arm1, link;
Create()
{
	emit-sfx 1025 from flare;
	explode arm1 type SHATTER | BITMAP1;
}
TransportPickup(unitid)
{
	attach-unit unitid to link;
	sleep 100;
	attach-unit unitid to 0 - 1;
	sleep 100;
	drop-unit unitid;
}
"#,
    );
    let events = [event(0, "Create", &[]), pickup_at(10)];
    let from_cob = crate::cobrun::run(&cob, &pieces, &events, 40, &[], &HashMap::new());
    let from_lua = run_lua(
        &lua,
        "events.lua",
        &Unit::new(&pieces),
        &events,
        40,
        &HashMap::new(),
    );

    assert_eq!(from_cob.error, None);
    assert_eq!(from_lua.error, None);
    assert_eq!(from_cob.events, from_lua.events);
    assert_eq!(
        from_cob.events[..3],
        [
            ScriptOutput::Sfx {
                frame: 0,
                piece: "flare".into(),
                sfx: 1025
            },
            ScriptOutput::Explode {
                frame: 0,
                piece: "arm1".into(),
                flags: 257
            },
            ScriptOutput::Attach {
                frame: 10,
                unit: 2,
                piece: Some("link".into())
            },
        ]
    );
    assert!(matches!(
        from_cob.events[3],
        ScriptOutput::Attach {
            unit: 2,
            piece: None,
            ..
        }
    ));
    assert!(matches!(
        from_cob.events[4],
        ScriptOutput::Drop { unit: 2, .. }
    ));
    assert_eq!(from_cob.events.len(), 5);
}

/// Shaped like `intruder.bos` `AreaUnload`, in both runtimes. The passenger is
/// not on the piece on the attach's own frame, because the engine moves it
/// after every script has ticked (`rts/Game/Game.cpp:1796-1798`), and it is on
/// the piece at the second poll. After a drop, moving the piece leaves the
/// passenger where it was.
#[test]
fn both_runtimes_move_a_passenger_once_the_frame_is_over() {
    let (cob, lua, pieces) = both(
        r#"
#define PIECE_XZ 7
#define UNIT_XZ 9
piece base, link, mark;
static-var polls, held;
TransportPickup(unitid)
{
	attach-unit unitid to link;
	polls = 1;
	while (get UNIT_XZ(unitid) != get PIECE_XZ(link))
	{
		polls = polls + 1;
		sleep 100;
	}
	if (polls == 1) { move base to y-axis [1] now; }
	if (polls == 2) { move base to y-axis [2] now; }
	if (polls > 2) { move base to y-axis [3] now; }
	held = get PIECE_XZ(link);
	drop-unit unitid;
	move link to x-axis [50] now;
	sleep 100;
	if (get UNIT_XZ(unitid) != get PIECE_XZ(link)) { move mark to y-axis [1] now; }
	if (get UNIT_XZ(unitid) == held) { move mark to z-axis [1] now; }
}
"#,
    );
    let rest = rest_for(
        &pieces,
        &[
            ("base", None, [0.0; 3]),
            ("link", Some("base"), [0.0, 10.0, 20.0]),
            ("mark", Some("base"), [0.0; 3]),
        ],
    );
    let events = [pickup_at(0)];
    let from_cob = crate::cobrun::run(&cob, &pieces, &events, 20, &rest, &HashMap::new());
    let from_lua = run_lua(
        &lua,
        "areaunload.lua",
        &Unit {
            rest: &rest,
            ..Unit::new(&pieces)
        },
        &events,
        20,
        &HashMap::new(),
    );

    for (runtime, timeline) in [("COB", &from_cob), ("Lua", &from_lua)] {
        assert_eq!(timeline.error, None, "{runtime}");
        let last = timeline.frames.last().unwrap();
        let at = |piece: &str, value: usize| {
            last[pieces.iter().position(|p| p == piece).unwrap() * 6 + value]
        };
        // 1 would mean the attach moved the stand-in at once. 0 would mean it
        // never reached the piece.
        assert!(
            (at("base", 1) - 2.0).abs() < TOLERANCE,
            "{runtime}: polls {}",
            at("base", 1)
        );
        assert!(
            (at("mark", 1) - 1.0).abs() < TOLERANCE,
            "{runtime}: the passenger followed the piece after the drop"
        );
        assert!(
            (at("mark", 2) - 1.0).abs() < TOLERANCE,
            "{runtime}: the passenger moved when it was dropped"
        );
    }
}
