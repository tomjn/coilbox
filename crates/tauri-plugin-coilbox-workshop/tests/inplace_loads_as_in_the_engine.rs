//! A value worked out to load as the typed one does, written in place into a
//! loose game's own files, checked against the real engine (issue #3093).
//!
//! `loads_as_in_the_engine.rs` does this for the mutator route against
//! Balanced Annihilation. That game is packed, so edit in place cannot write
//! into it, and none of the loose games installed under `~/.spring/games`
//! turns a typed number for one field back into a different number for that
//! same field in an easily isolated way (SpringMCLegacy's own
//! `unitdefs_post.lua` does, but only for a vehicle whose customparams and
//! side happen to satisfy several unrelated build-menu rules at once). So
//! this builds a fixture instead: a scratch copy of THIS.sdd (30 MB, the
//! smallest loose game installed here, picked to keep the copy cheap) with
//! one line appended to its own `gamedata/unitdefs_post.lua` scaling the
//! existing `wraith` unit's `maxdamage` by 0.3, mirroring the shape of
//! Balanced Annihilation's crater multiplier.
//!
//! The scratch copy lives entirely under a temp directory this test creates
//! and deletes. Nothing under `~/.spring/games` is written.
//!
//! It needs an engine under `~/.spring/engine`, THIS installed in
//! `~/.spring/games`, and a worker built from this checkout in
//! `target/debug`. Where any is missing, or the worker predates
//! `--defs-probe`, it checks nothing and says so.

use std::path::{Path, PathBuf};

use serde_json::json;
use tauri_plugin_coilbox_workshop::loads_as::{self, Outcome, Precision, ProbeRead, ProbeRun};
use tauri_plugin_coilbox_workshop::{write_in_place, ModProject};

const SOURCE_GAME: &str = "THIS.sdd";
/// A different name from the installed game's own, so the engine's archive
/// scan (which is not told to isolate to one data dir) cannot resolve this
/// test's scratch copy to the real, unmodified `THIS.sdd` it also finds under
/// `~/.spring` by that name.
const GAME: &str = "THIS_workshop_3093_test.sdd";
const UNIT: &str = "wraith";
/// The typed maxdamage. Not the unit's own 500, so a bug that answers with
/// the game's existing value rather than the typed one cannot pass by
/// accident.
const TYPED: f64 = 333.0;

/// An engine folder holding a `libunitsync`, and the worker binary, or `None`
/// with the reason.
fn setup() -> Result<PathBuf, String> {
    let home = PathBuf::from(std::env::var_os("HOME").ok_or("no HOME")?);
    let data = home.join(".spring");
    if !data.join("games").join(SOURCE_GAME).is_dir() {
        return Err(format!("{SOURCE_GAME} is not installed"));
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
    Ok(engine)
}

/// A copy of `from` at `to`, skipping `.git`. This test's own scratch game
/// needs the whole tree, but not its history.
fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("scratch dir");
    for entry in std::fs::read_dir(from)
        .expect("read the source game")
        .flatten()
    {
        let name = entry.file_name();
        if name == ".git" {
            continue;
        }
        let (from, to) = (entry.path(), to.join(&name));
        if entry.file_type().expect("file type").is_dir() {
            copy_tree(&from, &to);
        } else {
            std::fs::copy(&from, &to).unwrap_or_else(|e| panic!("copy {from:?}: {e}"));
        }
    }
}

/// A scratch copy of THIS.sdd under a fresh temp `games` folder, with one
/// line appended to its `unitdefs_post.lua` scaling `wraith`'s `maxdamage` by
/// 0.3, so a typed value only loads as itself once coilbox has worked out
/// what to write in its place.
///
/// The folder name alone is not enough to keep this scratch copy from
/// resolving to the real installed game: the engine's archive resolution
/// follows `modinfo.lua`'s own declared name, shortname and version, not the
/// folder it sits in, and reused that identity to answer from the real,
/// unmodified `THIS.sdd` even once this copy's own name and content had
/// changed. So the identity is renamed here too.
fn scratch_game(real_games: &Path) -> (tempfile::TempDir, PathBuf) {
    let root = tempfile::tempdir().expect("temp dir");
    let game = root.path().join("games").join(GAME);
    copy_tree(&real_games.join(SOURCE_GAME), &game);
    let post = game.join("gamedata/unitdefs_post.lua");
    let mut text = std::fs::read_to_string(&post).expect("the post file");
    text.push_str(&format!(
        "\nif UnitDefs.{UNIT} then UnitDefs.{UNIT}.maxdamage = UnitDefs.{UNIT}.maxdamage * 0.3 end\n"
    ));
    std::fs::write(&post, text).expect("append the scale");
    let modinfo = game.join("modinfo.lua");
    let mtext = std::fs::read_to_string(&modinfo).expect("modinfo.lua");
    std::fs::write(
        &modinfo,
        mtext
            .replacen("name='THIS'", "name='THIS_workshop_3093_test'", 1)
            .replacen("shortname='THIS'", "shortname='THIS_workshop_3093_test'", 1)
            .replacen("version='KRE $VERSION'", "version='workshop-3093-test'", 1),
    )
    .expect("rename the mod identity");
    (root, game)
}

/// The unitsync worker as `settle_scoped`'s loader, over `data_dir`.
fn worker(
    engine: &Path,
    data_dir: &Path,
) -> impl FnMut(&[ProbeRun]) -> Result<Vec<loads_as::ProbeResult>, String> {
    let (engine, data_dir) = (engine.to_path_buf(), data_dir.to_path_buf());
    move |runs: &[ProbeRun]| {
        let input = serde_json::to_string(&json!({ "runs": runs })).expect("json");
        let out = tauri_plugin_coilbox_unitsync::defs_probe_blocking(
            &engine.to_string_lossy(),
            &data_dir.to_string_lossy(),
            GAME,
            &input,
        )?;
        let out: serde_json::Value =
            serde_json::from_str(&out).map_err(|e| format!("{e}: {out}"))?;
        serde_json::from_value(out["runs"].clone())
            .ok()
            .filter(|r: &Vec<loads_as::ProbeResult>| r.len() == runs.len())
            .ok_or_else(|| out["errors"].to_string())
    }
}

#[test]
fn a_typed_maxdamage_written_in_place_loads_as_typed_in_the_engine() {
    let engine = match setup() {
        Ok(v) => v,
        Err(why) => {
            eprintln!("{why}, so this checks nothing");
            return;
        }
    };
    let real_games = PathBuf::from(std::env::var_os("HOME").unwrap()).join(".spring/games");
    let (_root, game_dir) = scratch_game(&real_games);
    let data_dir = game_dir.parent().unwrap().parent().unwrap().to_path_buf();

    let mut load = worker(&engine, &data_dir);
    // Whether this worker knows the mode at all, and whether the scratch
    // game loads: the append above must still be valid Lua the engine loads.
    match load(&[ProbeRun {
        files: Vec::new(),
        reads: vec![ProbeRead {
            table: loads_as::DefTable::Units,
            key: UNIT.into(),
            path: vec!["maxdamage".into()],
            expect: 0.0,
        }],
    }]) {
        Err(e) if e.contains("unknown argument") => {
            eprintln!("the worker in target/debug predates --defs-probe, so this checks nothing");
            return;
        }
        Err(e) => panic!("the scratch game did not load: {e}"),
        Ok(_) => {}
    }

    let project: ModProject = serde_json::from_value(json!({
        "name": "TEST in place loads as typed (delete me)",
        "gameName": "THIS",
        "edits": { "overrides": { UNIT: { "maxdamage": TYPED } } },
    }))
    .expect("parse");

    let mut compile = |p: &ModProject, w: &loads_as::Written| {
        let patched = if w.is_empty() {
            p.clone()
        } else {
            loads_as::with_written(p, w)
        };
        tauri_plugin_coilbox_workshop::inplace_dry_run(&game_dir, &patched, &Default::default())
    };
    let settled = loads_as::settle_scoped(
        &project,
        Precision::F32,
        &|_, _| true,
        &|_| true,
        &mut compile,
        &mut load,
    )
    .expect("settle");
    eprintln!("{:?}", settled.fields);
    let report = settled
        .fields
        .iter()
        .find(|f| f.typed == TYPED)
        .expect("the maxdamage field");
    assert_eq!(report.outcome, Outcome::Written);

    // Write the settled value into the scratch game's own file, the way
    // `workshop_write_in_place` does once
    // `workshop_settle_typed_values_in_place` has answered.
    let written_project = loads_as::with_written(&project, &settled.written);
    let outcome = write_in_place(&game_dir, &written_project, &Default::default()).expect("write");
    assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
    assert!(!outcome.written.is_empty());

    // Load the scratch game exactly as it now sits on disk, apart from
    // `settle`, and read the typed field back.
    let back = load(&[ProbeRun {
        files: Vec::new(),
        reads: vec![ProbeRead {
            table: loads_as::DefTable::Units,
            key: UNIT.into(),
            path: vec!["maxdamage".into()],
            expect: TYPED,
        }],
    }])
    .expect("a load");
    assert_eq!(back[0].reads[0].value, Some(TYPED));
    assert!(back[0].reads[0].equal);
}
