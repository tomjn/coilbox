//! A compat build converts the base game's `.3do` models into the mutator,
//! writes the same bytes twice, and the game's own def pipeline then names the
//! `.s3o` for every unit whose model was converted (issue #4557).
//!
//! Like `scan_lists_the_mutator`, it writes only into fresh content roots under
//! the system's temporary folder, which `TMPDIR` moves, and reads the base game
//! from `~/.spring/games`. `COILBOX_COMPAT_GAME` picks another game there.

mod common;

use std::collections::BTreeMap;
use std::path::Path;

use common::setup;

/// The name the scan gives the game in `archive`, which the mutator depends on.
fn game_name(engine: &Path, root: &Path, archive: &str) -> String {
    let out = tauri_plugin_coilbox_unitsync::scan_blocking(
        &engine.to_string_lossy(),
        &root.to_string_lossy(),
    )
    .expect("scan");
    let scan: serde_json::Value = serde_json::from_str(&out).expect("JSON");
    scan["games"]
        .as_array()
        .and_then(|games| {
            games.iter().find(|g| {
                g["primaryArchive"]["name"]
                    .as_str()
                    .is_some_and(|n| n.eq_ignore_ascii_case(archive))
            })
        })
        .and_then(|g| g["name"].as_str())
        .expect("the scan lists the base game")
        .to_string()
}

fn build(
    engine: &Path,
    root: &Path,
    archive: &str,
    name: &str,
) -> tauri_plugin_coilbox_compat::Built {
    tauri_plugin_coilbox_compat::build(
        &root.to_string_lossy(),
        &engine.to_string_lossy(),
        archive,
        name,
        "0",
        coilbox_compat::latest(),
        "0.0.0",
    )
    .expect("build")
}

fn bytes_of(built: &tauri_plugin_coilbox_compat::Built) -> BTreeMap<String, Vec<u8>> {
    let dir = Path::new(&built.dir);
    built
        .files
        .iter()
        .map(|f| (f.clone(), std::fs::read(dir.join(f)).expect("read")))
        .collect()
}

#[test]
#[ignore = "needs xta-9.65.sd7 (or COILBOX_COMPAT_GAME) in ~/.spring/games, an installed engine with libunitsync, a built coilbox-unitsync-worker in target/debug"]
fn the_models_are_converted_the_same_twice_and_the_units_name_them() {
    let (engine, archive) = match setup() {
        Ok(v) => v,
        Err(why) => {
            eprintln!("{why}, so this checks nothing");
            return;
        }
    };
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let name = game_name(&engine, a.path(), &archive);
    let first = build(&engine, a.path(), &archive, &name);
    let second = build(&engine, b.path(), &archive, &name);
    eprintln!(
        "{archive}: {} of {} models converted, {} unreadable, {} did not fit, notes {:?}",
        first.models.models_written,
        first.models.models_found,
        first.models.unreadable.len(),
        first.models.did_not_fit.len(),
        first.notes,
    );
    // XTA names a wreck model it does not have, which the build says it draws
    // as a box (issue #4686). Balanced Annihilation's own weapondefs_post.lua
    // leaves it without the weapon def fixes (issue #4628). Nothing else is noted.
    assert!(
        first.notes.iter().all(|n| {
            n.contains("a model the game does not have")
                || n.contains("ships its own gamedata/weapondefs_post.lua")
        }),
        "{:?}",
        first.notes
    );
    assert!(first.models.models_written > 0, "{:?}", first.models);
    let hook = if archive == "balanced_annihilation-v15.9.8.sdz" {
        tauri_plugin_coilbox_compat::models::WEAPONDEFS
    } else {
        tauri_plugin_coilbox_compat::models::DEFS_POST
    };
    assert!(first.files.contains(&hook.to_string()));
    assert_eq!(first.files, second.files);
    let (x, y) = (bytes_of(&first), bytes_of(&second));
    for (file, bytes) in &x {
        assert!(bytes == &y[file], "{file} differs between two builds");
    }

    // Issue #4642: the marker records the palette the conversion read, and the
    // worker reads the same one again for the status check.
    let marker =
        tauri_plugin_coilbox_compat::mutator::read_marker(Path::new(&first.dir)).expect("a marker");
    eprintln!("palette {:?}", marker.palette);
    assert!(marker.palette.is_some());
    let status = tauri_plugin_coilbox_compat::status(
        &a.path().to_string_lossy(),
        &engine.to_string_lossy(),
        &archive,
        "0",
    )
    .expect("status");
    assert!(status.stale.is_empty(), "{:?}", status.stale);

    let out = tauri_plugin_coilbox_unitsync::unit_defs_blocking(
        &engine.to_string_lossy(),
        &a.path().to_string_lossy(),
        &first.folder,
    )
    .expect("unit defs");
    let defs: serde_json::Value = serde_json::from_str(&out).expect("JSON");
    let units = defs["units"].as_object().expect("units");
    assert!(!units.is_empty(), "{}", defs["errors"]);
    let named = |ext: &str| {
        units
            .values()
            .filter(|u| {
                u["objectname"]
                    .as_str()
                    .is_some_and(|n| n.to_ascii_lowercase().ends_with(ext))
            })
            .count()
    };
    eprintln!(
        "{} units, {} name an .s3o, {} still name a .3do",
        units.len(),
        named(".s3o"),
        named(".3do")
    );
    assert!(named(".s3o") > 0);
    // A model that would not convert keeps its .3do, so every unit can only
    // name one when the converter said why.
    if first.models.unreadable.is_empty() && first.models.did_not_fit.is_empty() {
        let keys = tauri_plugin_coilbox_compat::models::model_keys(&first.files);
        for (name, unit) in units {
            let model = unit["objectname"]
                .as_str()
                .unwrap_or_default()
                .to_lowercase();
            let stem = model.trim_end_matches(".3do").replace('\\', "/");
            let stem = stem.trim_start_matches("objects3d/");
            if keys.contains(stem) {
                panic!("{name} still names {model}, which was converted");
            }
        }
    }
}
