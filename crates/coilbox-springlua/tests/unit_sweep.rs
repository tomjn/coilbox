//! Run the animation script of every unit in a game, as the app runs them.
//!
//! Set `COILBOX_UNIT_SWEEP` to a folder of JSON files, one per unit, each
//! holding what the unitsync worker read for it: `script`, `includes` and
//! `unitDef` from `--unit-script`, and `pieces`, the model's piece names from
//! `--unit-model`. Each script is asked for its pieces the way importing a unit
//! asks, then played through the call-ins the animation presets send. Any
//! script that stops fails the test, by unit.
//!
//! Skipped when the variable is unset, because no game ships in this repo.

use coilbox_springlua::unitscript::{probe, run, ScriptEvent, Unit};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

fn event(frame: u32, callin: &str, args: &[f64]) -> ScriptEvent {
    ScriptEvent {
        frame,
        callin: callin.into(),
        args: args.to_vec(),
        ambient: true,
    }
}

#[test]
fn every_unit_script_in_the_folder_runs() {
    let Ok(root) = std::env::var("COILBOX_UNIT_SWEEP") else {
        eprintln!("COILBOX_UNIT_SWEEP is not set, so there is nothing to sweep.");
        return;
    };
    let events = [
        event(0, "Create", &[]),
        event(1, "setSFXoccupy", &[4.0]),
        event(5, "StartMoving", &[]),
        event(60, "StopMoving", &[]),
        event(70, "Activate", &[]),
        event(80, "StartBuilding", &[0.5, 0.1]),
        event(120, "StopBuilding", &[]),
        event(130, "AimWeapon1", &[0.8, 0.1]),
        event(150, "FireWeapon1", &[]),
        event(160, "Deactivate", &[]),
        event(200, "Killed", &[50.0, 100.0]),
    ];
    let asked: Vec<String> = ["QueryNanoPiece", "AimFromWeapon1", "QueryWeapon1"]
        .map(String::from)
        .to_vec();

    let mut paths: Vec<PathBuf> = std::fs::read_dir(&root)
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|e| e == "json"))
        .collect();
    paths.sort();

    let mut failures = Vec::new();
    let mut count = 0;
    let mut no_model = Vec::new();
    for path in &paths {
        let gathered: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let Some(script) = gathered["script"].as_str() else {
            continue;
        };
        let unit = gathered["unit"].as_str().unwrap_or("?");
        // A model the worker reads no pieces from, such as a `.dae`, is a unit
        // the app cannot open either, so its script has nothing to move.
        if gathered["pieces"].as_array().is_none_or(Vec::is_empty) {
            no_model.push(unit.to_string());
            continue;
        }
        count += 1;
        let includes: HashMap<String, String> = gathered["includes"]
            .as_object()
            .map(|files| {
                files
                    .iter()
                    .filter_map(|(name, text)| Some((name.clone(), text.as_str()?.to_string())))
                    .collect()
            })
            .unwrap_or_default();
        let pieces: Vec<String> = gathered["pieces"]
            .as_array()
            .map(|names| {
                names
                    .iter()
                    .filter_map(|name| Some(name.as_str()?.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let def = gathered.get("unitDef").filter(|def| def.is_object());
        let target = Unit {
            def,
            includes: &includes,
            ..Unit::new(&pieces)
        };
        let name = format!("{unit}.lua");

        if let Some(error) = probe(script, &name, &target, &asked).error {
            failures.push(format!("{unit}: asked for its pieces: {error}"));
            continue;
        }
        let timeline = run(script, &name, &target, &events, 300);
        if let Some(error) = timeline.error {
            failures.push(format!("{unit}: {error}"));
        }
        for warning in timeline
            .warnings
            .iter()
            .filter(|w| w.contains("That thread stopped"))
        {
            failures.push(format!("{unit}: {warning}"));
        }
    }
    eprintln!(
        "{count} scripts swept, {} failed, {} skipped with no model pieces: {}",
        failures.len(),
        no_model.len(),
        no_model.join(" ")
    );
    assert!(count > 0, "no unit JSON under {root}");
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
