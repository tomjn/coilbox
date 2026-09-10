//! Does the Lua the converter writes move a unit the way its COB does?
//!
//! For every script in a game, run the game's own `.cob` through the COB
//! runtime and the converted `.bos` through the Lua one, with the same events,
//! and compare where every piece is on every frame. Both runtimes are the ones
//! the preview uses, so a script that matches here previews the same either way.
//!
//! Set `COILBOX_BOS_SWEEP` to a game's unpacked `scripts` folder. Skipped when
//! it is unset, because no game ships in this repo.

use coilbox_springlua::unitscript::{run as run_lua, ScriptEvent, Unit};
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
        event(120, "StopBuilding", &[]),
        event(130, "AimWeapon1", &[0.8, 0.1]),
        event(131, "AimWeapon2", &[-0.5, 0.2]),
        event(150, "FireWeapon1", &[]),
        event(151, "Shot1", &[]),
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
            },
        ) {
            Ok(c) => c,
            Err(e) => {
                differ.push(format!("{name}: did not convert: {e}"));
                continue;
            }
        };
        let pieces = pieces_of(&conversion.lua);
        let from_cob = crate::cobrun::run(&bytes, &pieces, &events, FRAMES, &[]);
        let from_lua = run_lua(&conversion.lua, &name, &Unit::new(&pieces), &events, FRAMES);
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
    let from_cob = crate::cobrun::run(&cob, &pieces, &events, 220, &[]);
    let from_lua = run_lua(&lua, "walker.lua", &Unit::new(&pieces), &events, 220);
    assert_eq!(from_cob.error, None);
    assert_eq!(from_lua.error, None);
    assert_eq!(
        first_difference(&from_cob, &from_lua, &pieces, "walker", false),
        None
    );
}
