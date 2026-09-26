//! A value worked out to load as the typed one does, in the engine's own Lua
//! (issue #3059).
//!
//! `post_processing_runs_once.rs` checks the working out against a stock Lua,
//! whose numbers are doubles. The engine's are 32 bit floats, and the value
//! that loads as exactly 0.5 there is a different one. So this runs the
//! unitsync worker's `--defs-probe` mode over Balanced Annihilation V15.9.8
//! with the engine's own `libunitsync`, the way the app does, and then loads
//! the compiled mutator once more to read the result back.
//!
//! It needs an engine under `~/.spring/engine`, Balanced Annihilation in
//! `~/.spring/games`, and a worker built from this checkout in `target/debug`.
//! Where any is missing, or the worker predates `--defs-probe`, it checks
//! nothing and says so.

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde_json::{json, Value};
use tauri_plugin_coilbox_workshop::loads_as::{
    compile_written, settle, DefTable, Outcome, Precision, ProbeRead, ProbeResult, ProbeRun,
};
use tauri_plugin_coilbox_workshop::ModProject;

const BA: &str = "balanced_annihilation-v15.9.8.sdz";

/// An engine folder holding a `libunitsync`, the Spring data folder, and the
/// worker binary, or `None` with the reason.
fn setup() -> Result<(PathBuf, PathBuf), String> {
    let home = PathBuf::from(std::env::var_os("HOME").ok_or("no HOME")?);
    let data = home.join(".spring");
    if !data.join("games").join(BA).is_file() {
        return Err(format!("{BA} is not installed"));
    }
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

/// A Lua file out of the archive at `archive`, evaluated. The file is GPL, so
/// it is read at test time rather than copied into this repository.
fn own_file(archive: &Path, path: &str) -> Value {
    let file = std::fs::File::open(archive).expect("the archive");
    let mut zip = zip::ZipArchive::new(file).expect("a zip");
    let mut text = String::new();
    std::io::Read::read_to_string(&mut zip.by_name(path).expect("the file"), &mut text)
        .expect("utf-8 Lua");
    let dir = tempfile::tempdir().expect("tempdir");
    coilbox_springlua::SpringLua::new(dir.path())
        .expect("vm")
        .eval_value(&text, path)
        .expect("the file evaluates")
}

/// The unitsync worker as `settle`'s loader.
fn worker(
    engine: &Path,
    data: &Path,
) -> impl FnMut(&[ProbeRun]) -> Result<Vec<ProbeResult>, String> {
    let (engine, data) = (engine.to_path_buf(), data.to_path_buf());
    move |runs: &[ProbeRun]| {
        let input = serde_json::to_string(&json!({ "runs": runs })).expect("json");
        let out = tauri_plugin_coilbox_unitsync::defs_probe_blocking(
            &engine.to_string_lossy(),
            &data.to_string_lossy(),
            BA,
            &input,
        )?;
        let out: Value = serde_json::from_str(&out).map_err(|e| format!("{e}: {out}"))?;
        serde_json::from_value(out["runs"].clone())
            .ok()
            .filter(|r: &Vec<ProbeResult>| r.len() == runs.len())
            .ok_or_else(|| out["errors"].to_string())
    }
}

#[test]
fn a_typed_crater_multiplier_loads_as_typed_in_the_engine() {
    let (engine, data) = match setup() {
        Ok(v) => v,
        Err(why) => {
            eprintln!("{why}, so this checks nothing");
            return;
        }
    };
    let mut load = worker(&engine, &data);
    // Whether this worker knows the mode at all.
    if let Err(e) = load(&[]) {
        if e.contains("unknown argument") {
            eprintln!("the worker in target/debug predates --defs-probe, so this checks nothing");
            return;
        }
    }

    // The Big Bertha as the game's own file has it, which is what a copy
    // compiles to once the game's post-processed values are put back.
    let mut def = own_file(&data.join("games").join(BA), "units/armbrtha.lua")["armbrtha"].clone();
    def["name"] = json!("Big Bertha copy");
    def["weapondefs"]["arm_berthacannon"]["cratermult"] = json!(0.5);
    let clone = json!({
        "key": "armbrtha2",
        "source": "armbrtha",
        "replacesGameUnit": false,
        "def": def,
    });
    let typed = json!({ "armbrtha2": { "weapondefs.arm_berthacannon.cratermult": 0.5 } });
    let mut beside = typed.clone();
    beside["armcom"] = json!({ "maxdamage": 3001 });

    for (route, overrides) in [("alone", typed), ("beside a change", beside)] {
        let project: ModProject = serde_json::from_value(json!({
            "name": "TEST loads as typed (delete me)",
            "gameName": "Balanced Annihilation V15.9.8",
            "edits": { "clones": { "armbrtha2": clone.clone() }, "overrides": overrides },
        }))
        .expect("parse");
        let start = Instant::now();
        let settled = settle(&project, Precision::F32, &mut load).expect("settle");
        eprintln!(
            "{route}: {} loads in {} ms, {:?}",
            settled.loads,
            start.elapsed().as_millis(),
            settled.fields
        );
        let report = settled
            .fields
            .iter()
            .find(|f| f.typed == 0.5)
            .expect("the crater multiplier");
        assert_eq!(report.outcome, Outcome::Written, "{route}");

        // Read the compiled mutator back through the worker once more, apart
        // from `settle`.
        let files = compile_written(&project, &settled.written)
            .files
            .into_iter()
            .map(|f| tauri_plugin_coilbox_workshop::loads_as::ProbeFile {
                path: f.path,
                contents: f.contents,
            })
            .collect();
        let back = load(&[ProbeRun {
            files,
            reads: vec![ProbeRead {
                table: DefTable::Weapons,
                key: "armbrtha2_arm_berthacannon".into(),
                path: vec!["cratermult".into()],
                expect: 0.5,
            }],
            ..Default::default()
        }])
        .expect("a load");
        assert_eq!(back[0].reads[0].value, Some(0.5), "{route}");
        assert!(back[0].reads[0].equal, "{route}");
    }
}
