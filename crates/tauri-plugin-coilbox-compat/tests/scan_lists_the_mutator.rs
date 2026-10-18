//! A built compat mutator is listed by the scan the app's `primeScan` reads, as
//! a game that depends on the base game (issue #4556).
//!
//! It writes into a fresh content root, never into `~/.spring`, and finds the
//! base game in `~/.spring/games` the way the app's scan does. Set
//! `COILBOX_COMPAT_GAME` to another archive there to check that one instead.
//! Where the engine, the game or the worker is missing it checks nothing and
//! says so.

mod common;

use std::path::Path;

use common::setup;
use serde_json::Value;

fn scan(engine: &Path, root: &Path) -> Value {
    let out = tauri_plugin_coilbox_unitsync::scan_blocking(
        &engine.to_string_lossy(),
        &root.to_string_lossy(),
    )
    .expect("scan");
    serde_json::from_str(&out).expect("the scan is JSON")
}

fn game_with_archive<'a>(scan: &'a Value, archive: &str) -> Option<&'a Value> {
    scan["games"].as_array()?.iter().find(|g| {
        g["primaryArchive"]["name"]
            .as_str()
            .is_some_and(|n| n.eq_ignore_ascii_case(archive))
    })
}

#[test]
#[ignore = "needs xta-9.65.sd7 (or COILBOX_COMPAT_GAME) in ~/.spring/games, an installed engine with libunitsync, a built coilbox-unitsync-worker in target/debug"]
fn the_scan_lists_a_built_mutator_as_a_game_on_top_of_its_base() {
    let (engine, archive) = match setup() {
        Ok(v) => v,
        Err(why) => {
            eprintln!("{why}, so this checks nothing");
            return;
        }
    };
    let root = tempfile::tempdir().expect("tempdir");

    let before = scan(&engine, root.path());
    let base = game_with_archive(&before, &archive).expect("the scan lists the base game");
    let name = base["name"].as_str().expect("a name");
    // The scan leaves checksums to the per game reads, and only the marker
    // keeps one, so any value does here.
    let checksum = "0";

    let built = tauri_plugin_coilbox_compat::build(
        &root.path().to_string_lossy(),
        &engine.to_string_lossy(),
        &archive,
        name,
        checksum,
        coilbox_compat::latest(),
        "0.0.0",
    )
    .expect("build");

    let after = scan(&engine, root.path());
    let compat = game_with_archive(&after, &built.folder).unwrap_or_else(|| {
        panic!(
            "the scan does not list {}: {}",
            built.folder, after["errors"]
        )
    });
    assert_eq!(
        compat["name"],
        format!("{name} (compat {})", coilbox_compat::latest())
    );
    let deps: Vec<&str> = compat["dependencyArchives"]
        .as_array()
        .expect("dependencies")
        .iter()
        .filter_map(|a| a["name"].as_str())
        .collect();
    // The scan names a dependency by the game's name, not its archive's.
    assert!(deps.contains(&name), "{deps:?} does not include {name}");
    assert!(
        compat["missingDependencies"]
            .as_array()
            .is_none_or(|m| m.is_empty()),
        "{}",
        compat["missingDependencies"]
    );
}
