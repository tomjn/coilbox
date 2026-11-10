//! What real walkers do when told to move, recorded for the leg inference
//! (#5184).
//!
//! `src/lego/inferRoles.test.ts` reads `fixtures/strides.json` and hands each
//! case's timeline to `inferRoles` as the sandbox's answer, so the leg rules are
//! tested against what this runtime does with real scripts. This side keeps
//! that recording true: it runs each case's script through the same runtime the
//! builder's open flow uses and checks every frame against it.
//!
//! The Splinter Faction cases read the scripts from the game's own checkout, so
//! nothing of the game is copied here beyond the piece trees and the numbers.
//! To rewrite the recording after a change, run
//! `COILBOX_WRITE_STRIDES=1 cargo test -p coilbox-springlua --test strides --
//! --include-ignored --test-threads=1`. One thread, because both tests write
//! the same file.

use coilbox_springlua::unitscript::{run, Rest, ScriptEvent, Unit};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;

const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/strides.json");

/// The repository root, which the builder's own case names its script under.
fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn splinter_faction() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap()).join(".spring/games/SplinterFaction.sdd")
}

/// One decimal place more than a float32 model offset carries, so a rewrite
/// does not churn on the last bits.
fn rounded(value: f64) -> f64 {
    (value * 1e6).round() / 1e6
}

/// Run every case `game` says to, and either check or rewrite its recording.
fn check(game: Option<&str>) {
    let text = std::fs::read_to_string(FIXTURE).unwrap();
    let mut fixture: Value = serde_json::from_str(&text).unwrap();
    let write = std::env::var("COILBOX_WRITE_STRIDES").is_ok();
    let mut failures = Vec::new();
    let mut ran = 0;

    for case in fixture["cases"].as_array_mut().unwrap() {
        if case["game"].as_str() != game {
            continue;
        }
        ran += 1;
        let name = case["name"].as_str().unwrap().to_owned();
        let root = match game {
            Some(_) => splinter_faction(),
            None => repo(),
        };
        let script = std::fs::read_to_string(root.join(case["script"].as_str().unwrap())).unwrap();
        let includes: HashMap<String, String> = case["includes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|include| {
                let include = include.as_str().unwrap();
                let text = std::fs::read_to_string(root.join("Scripts").join(include)).unwrap();
                (include.to_owned(), text)
            })
            .collect();
        let pieces = case["pieces"].as_array().unwrap();
        let names: Vec<String> = pieces
            .iter()
            .map(|piece| piece["name"].as_str().unwrap().to_owned())
            .collect();
        let rest: Vec<Rest> = pieces
            .iter()
            .map(|piece| Rest {
                parent: piece["parent"]
                    .as_str()
                    .map(|parent| names.iter().position(|n| n == parent).unwrap()),
                position: serde_json::from_value(piece["offset"].clone()).unwrap(),
            })
            .collect();
        let events: Vec<ScriptEvent> = serde_json::from_value(case["events"].clone()).unwrap();
        let def = (!case["unitDef"].is_null()).then(|| case["unitDef"].clone());

        let timeline = run(
            &script,
            &format!("{name}.lua"),
            &Unit {
                def: def.as_ref(),
                includes: &includes,
                rest: &rest,
                ..Unit::new(&names)
            },
            &events,
            case["frames"].as_u64().unwrap() as u32,
            &HashMap::new(),
        );
        let frames: Vec<Vec<f64>> = timeline
            .frames
            .iter()
            .map(|frame| frame.iter().copied().map(rounded).collect())
            .collect();

        if write {
            case["timeline"] = json!({
                "frames": frames,
                "error": timeline.error,
                "warnings": timeline.warnings,
            });
            continue;
        }

        let recorded = &case["timeline"];
        if recorded["error"].as_str() != timeline.error.as_deref() {
            failures.push(format!(
                "{name}: the run stopped with {:?}, the recording says {}",
                timeline.error, recorded["error"]
            ));
        }
        let held: Vec<Vec<f64>> = serde_json::from_value(recorded["frames"].clone()).unwrap();
        if held.len() != frames.len() {
            failures.push(format!(
                "{name}: {} frames, the recording has {}",
                frames.len(),
                held.len()
            ));
            continue;
        }
        for (at, (now, then)) in frames.iter().zip(&held).enumerate() {
            if let Some(i) = (0..now.len()).find(|&i| (now[i] - then[i]).abs() > 1e-5) {
                failures.push(format!(
                    "{name}: frame {at}, {} channel {}: {} where the recording has {}",
                    names[i / 6],
                    i % 6,
                    now[i],
                    then[i]
                ));
                break;
            }
        }
    }

    assert!(ran > 0, "no cases for {game:?}");
    if write {
        std::fs::write(
            FIXTURE,
            serde_json::to_string_pretty(&fixture).unwrap() + "\n",
        )
        .unwrap();
        return;
    }
    assert!(
        failures.is_empty(),
        "the stride recording no longer matches the runtime. Rerun with COILBOX_WRITE_STRIDES=1 if that is intended:\n{}",
        failures.join("\n")
    );
}

/// The builder's own four legged walk, which needs nothing outside the repo.
#[test]
fn the_builders_quad_strides_as_recorded() {
    check(None);
}

#[test]
#[ignore = "needs Splinter Faction at ~/.spring/games/SplinterFaction.sdd"]
fn splinter_factions_walkers_and_wheels_move_as_recorded() {
    check(Some("SplinterFaction"));
}
