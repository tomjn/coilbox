//! Convert every BOS script in a folder and run each one.
//!
//! Set `COILBOX_BOS_SWEEP` to a folder holding a game's `scripts` directory,
//! unpacked, and this converts every `.bos` in it, with every other file there
//! available to `#include`, and runs the Lua through the preview runtime for a
//! few hundred frames of the call-ins a unit gets. Any script that fails to
//! convert, fails to load or stops with an error fails the test, by name.
//!
//! Skipped when the variable is unset, because no game ships in this repo.

use coilbox_bos2lua::{convert, Options};
use coilbox_springlua::unitscript::{run, ScriptEvent, Unit};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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

#[test]
fn every_script_in_the_folder_converts_and_runs() {
    let Ok(root) = std::env::var("COILBOX_BOS_SWEEP") else {
        eprintln!("COILBOX_BOS_SWEEP is not set, so there is nothing to sweep.");
        return;
    };
    let root = PathBuf::from(root);
    let mut all = Vec::new();
    files(&root, &mut all);
    let base = root.parent().unwrap_or(&root);
    let name_of = |p: &Path| {
        p.strip_prefix(base)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/")
    };
    let text = |p: &Path| String::from_utf8_lossy(&std::fs::read(p).unwrap()).into_owned();
    let includes: HashMap<String, String> = all.iter().map(|p| (name_of(p), text(p))).collect();

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

    let piece = regex_lite(r#"piece("#);
    let mut failures = Vec::new();
    let mut count = 0;
    for path in all
        .iter()
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("bos")))
    {
        let name = name_of(path);
        // An animation library is included by the unit scripts that use it,
        // not run on its own.
        if name.to_lowercase().contains("/animations/") {
            continue;
        }
        count += 1;
        let source = text(path);
        let linear_scale = std::fs::read(path.with_extension("cob"))
            .ok()
            .and_then(|cob| coilbox_bos2lua::linear_scale(&source, &cob))
            .unwrap_or(coilbox_bos2lua::MODERN_LINEAR);
        let conversion = match convert(
            &source,
            &Options {
                name: &name,
                includes: &includes,
                pieces: None,
                linear_scale,
            },
        ) {
            Ok(c) => c,
            Err(e) => {
                failures.push(format!("{name}: did not convert: {e}"));
                continue;
            }
        };
        if let Ok(out) = std::env::var("COILBOX_BOS_SWEEP_OUT") {
            let target = Path::new(&out).join(&name).with_extension("lua");
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            let mut text = conversion.lua.clone();
            for w in &conversion.warnings {
                text.push_str(&format!("\n-- WARNING: {w}"));
            }
            std::fs::write(target, text).unwrap();
        }
        let pieces = piece(&conversion.lua);
        let timeline = run(&conversion.lua, &name, &Unit::new(&pieces), &events, 300);
        if let Some(error) = timeline.error {
            failures.push(format!("{name}: {error}"));
        }
        for w in timeline
            .warnings
            .iter()
            .filter(|w| w.contains("That thread stopped"))
        {
            failures.push(format!("{name}: {w}"));
        }
    }
    eprintln!("{count} scripts swept, {} failed", failures.len());
    assert!(count > 0, "no .bos files under {}", root.display());
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// The names in every `piece("name")` call, which is all the sweep needs to
/// know about a model it does not have.
fn regex_lite(open: &'static str) -> impl Fn(&str) -> Vec<String> {
    move |lua: &str| {
        let mut out = Vec::new();
        let mut rest = lua;
        while let Some(at) = rest.find(open) {
            rest = &rest[at + open.len()..];
            if let Some(stripped) = rest.strip_prefix('"') {
                if let Some(end) = stripped.find('"') {
                    out.push(stripped[..end].to_string());
                }
            }
        }
        out
    }
}
