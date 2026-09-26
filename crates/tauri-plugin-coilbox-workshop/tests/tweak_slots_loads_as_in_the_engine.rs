//! A value worked out for the tweak slot route loads as the typed one, in the
//! engine's own Lua with the slots handed over as mod options (issue #3092).
//!
//! Beyond All Reason is the test case. It decodes and runs the `tweakdefs`
//! and `tweakunits` mod options in its own `gamedata/unitdefs_post.lua`,
//! before `alldefs_post.lua` post-processes
//! every unit and weapon. So a crater multiplier typed on the Big Bertha gets
//! `craterareaofeffect / 2000` added to it after the slot has set it, and a
//! unit's `maxslope` is multiplied by 1.5 and rounded. This settles both on
//! each of the two tweak routes, the bare slot a local launch writes and the
//! numbered slots a lobby gets, then loads BAR once more with exactly the mod
//! options that route carries and reads the values back.
//!
//! It needs an engine under `~/.spring/engine`, a Beyond All Reason build the
//! engine can find (`COILBOX_TWEAK_SLOT_GAME` names it, defaulting to the test
//! build this was written against), and a worker built from this checkout in
//! `target/debug`. Where any is missing, or the worker predates `--defs-probe`,
//! it checks nothing and says so.

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde_json::{json, Value};
use tauri_plugin_coilbox_workshop::loads_as::{
    settle_tweaks, tweak_mod_options, DefTable, Outcome, ProbeRead, ProbeResult, ProbeRun,
    TweakRoute,
};
use tauri_plugin_coilbox_workshop::ModProject;

const DEFAULT_GAME: &str = "Beyond All Reason test-30922-8064a43";

fn game_archive() -> String {
    std::env::var("COILBOX_TWEAK_SLOT_GAME").unwrap_or_else(|_| DEFAULT_GAME.to_string())
}

/// An engine folder holding a `libunitsync`, the Spring data folder, and the
/// worker binary, or `None` with the reason.
fn setup() -> Result<(PathBuf, PathBuf), String> {
    let home = PathBuf::from(std::env::var_os("HOME").ok_or("no HOME")?);
    let data = home.join(".spring");
    let lib = if cfg!(target_os = "macos") {
        "libunitsync.dylib"
    } else if cfg!(windows) {
        "unitsync.dll"
    } else {
        "libunitsync.so"
    };
    let engine = std::fs::read_dir(data.join("engine"))
        .map_err(|_| "no engine is installed".to_string())?
        .flatten()
        .flat_map(|platform| {
            std::fs::read_dir(platform.path())
                .into_iter()
                .flatten()
                .flatten()
        })
        .map(|e| e.path())
        .find(|dir| dir.join(lib).is_file())
        .ok_or("no engine is installed")?;
    let worker = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug")
        .join(if cfg!(windows) {
            "coilbox-unitsync-worker.exe"
        } else {
            "coilbox-unitsync-worker"
        });
    if !worker.is_file() {
        return Err("the unitsync worker is not built".into());
    }
    std::env::set_var("UNITSYNC_WORKER", &worker);
    Ok((engine, data))
}

/// The unitsync worker as `settle_tweaks`'s loader.
fn worker(
    engine: &Path,
    data: &Path,
    archive: &str,
) -> impl FnMut(&[ProbeRun]) -> Result<Vec<ProbeResult>, String> {
    let (engine, data, archive) = (
        engine.to_path_buf(),
        data.to_path_buf(),
        archive.to_string(),
    );
    move |runs: &[ProbeRun]| {
        let input = serde_json::to_string(&json!({ "runs": runs })).expect("json");
        let out = tauri_plugin_coilbox_unitsync::defs_probe_blocking(
            &engine.to_string_lossy(),
            &data.to_string_lossy(),
            &archive,
            &input,
        )?;
        let out: Value = serde_json::from_str(&out).map_err(|e| format!("{e}: {out}"))?;
        serde_json::from_value(out["runs"].clone())
            .ok()
            .filter(|r: &Vec<ProbeResult>| r.len() == runs.len())
            .ok_or_else(|| out["errors"].to_string())
    }
}

fn read(table: DefTable, key: &str, field: &str, expect: f64) -> ProbeRead {
    ProbeRead {
        table,
        key: key.into(),
        path: vec![field.into()],
        expect,
    }
}

#[test]
fn typed_values_load_as_typed_through_tweak_slots() {
    let (engine, data) = match setup() {
        Ok(v) => v,
        Err(why) => {
            eprintln!("{why}, so this checks nothing");
            return;
        }
    };
    let archive = game_archive();
    let mut load = worker(&engine, &data, &archive);
    // Whether this worker knows the mode, and whether the game is here: a
    // load with nothing on top has to read the Big Bertha's own weapon.
    let probe = read(DefTable::Weapons, "armbrtha_lrpc", "range", 0.0);
    match load(&[ProbeRun {
        reads: vec![probe],
        ..Default::default()
    }]) {
        Err(e) if e.contains("unknown argument") => {
            eprintln!("the worker in target/debug predates --defs-probe, so this checks nothing");
            return;
        }
        Ok(runs) if runs[0].error.is_none() && runs[0].reads[0].value.is_some() => {}
        other => {
            eprintln!("{archive} did not load ({other:?}), so this checks nothing");
            return;
        }
    }

    let project: ModProject = serde_json::from_value(json!({
        "name": "TEST bar tweak loads as typed (delete me)",
        "gameName": archive,
        "edits": { "overrides": {
            "armbrtha": { "weapondefs.lrpc.cratermult": 0.5 },
            "armcom": { "maxslope": 20 },
        } },
    }))
    .expect("parse");

    for route in [TweakRoute::Bare, TweakRoute::Numbered] {
        let start = Instant::now();
        let settled = settle_tweaks(&project, route, &mut load).expect("settle");
        eprintln!(
            "{route:?}: {} loads in {} ms, {:?}",
            settled.loads,
            start.elapsed().as_millis(),
            settled.fields
        );
        for typed in [0.5, 20.0] {
            let report = settled
                .fields
                .iter()
                .find(|f| f.typed == typed)
                .expect("the field");
            assert_ne!(
                report.loads_as_typed,
                Some(typed),
                "{route:?}: BAR's post files change {typed} as typed"
            );
            assert_eq!(report.outcome, Outcome::Written, "{route:?}: {report:?}");
        }

        // Load BAR once more, apart from `settle_tweaks`, with exactly the mod
        // options this route hands a game.
        let mod_options = tweak_mod_options(&project, &settled.written, route).expect("slots");
        let back = load(&[ProbeRun {
            reads: vec![
                read(DefTable::Weapons, "armbrtha_lrpc", "cratermult", 0.5),
                read(DefTable::Units, "armcom", "maxslope", 20.0),
            ],
            mod_options,
            ..Default::default()
        }])
        .expect("a load");
        assert_eq!(back[0].error, None, "{route:?}");
        assert_eq!(back[0].reads[0].value, Some(0.5), "{route:?}");
        assert!(back[0].reads[0].equal, "{route:?}");
        assert_eq!(back[0].reads[1].value, Some(20.0), "{route:?}");
        assert!(back[0].reads[1].equal, "{route:?}");
    }
}
