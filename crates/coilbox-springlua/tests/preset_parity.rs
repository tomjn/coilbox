//! Every animation preset moves the same in its generated Lua as in its
//! `track()` (#3242).
//!
//! `src/lego/presetParity.test.ts` writes the fixture: one script per preset
//! and set of params, the call-ins that set it going, and where `track()` puts
//! each piece on every frame compared, with the allowance worked out there.
//! This side runs each script through the same runtime the builder's preview
//! uses and checks every one of those frames.
//!
//! Run with `--nocapture` to see how close each case came.

use coilbox_springlua::unitscript::{run, ScriptEvent, Unit};
use serde::Deserialize;
use std::collections::HashMap;
use std::f64::consts::{PI, TAU};

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    script: String,
    pieces: Vec<String>,
    events: Vec<ScriptEvent>,
    frames: u32,
    exceptions: Vec<String>,
    checks: Vec<Check>,
}

#[derive(Deserialize)]
struct Check {
    piece: String,
    /// x, y, z offset then x, y, z rotation, as a timeline frame lays them out.
    channel: usize,
    from: usize,
    to: usize,
    #[serde(default)]
    expected: Vec<f64>,
    constant: Option<f64>,
    tolerance: f64,
}

/// How far apart two values are. Rotations come back from the runtime in
/// `[0, TAU)` and `track()` does not wrap, so angles are compared the short
/// way round.
fn apart(channel: usize, actual: f64, expected: f64) -> f64 {
    let delta = actual - expected;
    if channel < 3 {
        return delta.abs();
    }
    ((delta + PI).rem_euclid(TAU) - PI).abs()
}

#[test]
fn every_preset_moves_in_its_lua_as_in_its_track() {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/preset-parity.json"
    ))
    .unwrap();
    let fixture: Fixture = serde_json::from_str(&text).unwrap();
    assert!(!fixture.cases.is_empty());

    let mut failures = Vec::new();
    for case in &fixture.cases {
        let timeline = run(
            &case.script,
            "parity.lua",
            &Unit::new(&case.pieces),
            &case.events,
            case.frames,
            &HashMap::new(),
        );
        if let Some(error) = &timeline.error {
            failures.push(format!("{}: the script stopped: {error}", case.name));
            continue;
        }
        assert_eq!(timeline.frames.len(), case.frames as usize, "{}", case.name);

        // The closest any check came to its allowance, as a share of it.
        let mut worst = (0.0_f64, String::new());
        for check in &case.checks {
            let index = timeline
                .pieces
                .iter()
                .position(|name| *name == check.piece)
                .unwrap_or_else(|| panic!("{}: no piece {}", case.name, check.piece));
            for frame in check.from..=check.to {
                let expected = check
                    .constant
                    .unwrap_or_else(|| check.expected[frame - check.from]);
                let actual = timeline.frames[frame][index * 6 + check.channel];
                let off = apart(check.channel, actual, expected);
                let share = off / check.tolerance;
                if share > worst.0 {
                    worst = (
                        share,
                        format!(
                            "{} channel {} on frame {frame}: {actual:.5} against {expected:.5}, {off:.5} apart, allowed {:.5}",
                            check.piece, check.channel, check.tolerance
                        ),
                    );
                }
                if off > check.tolerance {
                    failures.push(format!(
                        "{}: {} channel {} on frame {frame} is {actual:.5}, track says {expected:.5}, {off:.5} apart against an allowance of {:.5}",
                        case.name, check.piece, check.channel, check.tolerance
                    ));
                }
            }
        }
        println!(
            "{}: worst {:.0}% of its allowance ({})",
            case.name,
            worst.0 * 100.0,
            worst.1
        );
        for exception in &case.exceptions {
            println!("    not compared: {exception}");
        }
    }

    // One line per case is plenty to go on, and a broken cycle fails every
    // frame of it.
    let mut shown: Vec<String> = Vec::new();
    for failure in &failures {
        let case = failure.split(':').next().unwrap_or_default();
        if !shown.iter().any(|line| line.starts_with(case)) {
            shown.push(failure.clone());
        }
    }
    assert!(
        failures.is_empty(),
        "{} frames differ, first per case:\n{}",
        failures.len(),
        shown.join("\n")
    );
}
