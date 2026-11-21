//! Every Splinter Faction unit has an icon type that resolves to a picture.
//!
//! Needs an engine and Splinter Faction under `~/.spring`, and the unitsync
//! worker built with `cargo build -p coilbox-unitsync-worker`, so a normal run
//! reports it as skipped. Run it with
//! `cargo nextest run -p tauri-plugin-coilbox-unitsync --run-ignored only`.

use serde_json::Value;
use std::path::{Path, PathBuf};

const GAME: &str = "SplinterFaction.sdd";

/// The engine folder holding a `libunitsync`, with the worker pointed at.
fn engine() -> PathBuf {
    let lib = if cfg!(target_os = "macos") {
        "libunitsync.dylib"
    } else if cfg!(windows) {
        "unitsync.dll"
    } else {
        "libunitsync.so"
    };
    let data = data_dir().join("engine");
    let engine = std::fs::read_dir(&data)
        .unwrap_or_else(|_| panic!("no engine is installed under {}", data.display()))
        .flatten()
        .flat_map(|platform| {
            std::fs::read_dir(platform.path())
                .into_iter()
                .flatten()
                .flatten()
        })
        .map(|e| e.path())
        .find(|dir| dir.join(lib).is_file())
        .expect("no engine with a libunitsync is installed");
    let worker = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug")
        .join(if cfg!(windows) {
            "coilbox-unitsync-worker.exe"
        } else {
            "coilbox-unitsync-worker"
        });
    assert!(
        worker.is_file(),
        "build the worker first: cargo build -p coilbox-unitsync-worker"
    );
    std::env::set_var("UNITSYNC_WORKER", &worker);
    engine
}

fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").expect("no HOME")).join(".spring")
}

fn icons(engine: &Path, cache: &Path) -> Value {
    let out = tauri_plugin_coilbox_unitsync::unit_icons_blocking(
        &engine.to_string_lossy(),
        &data_dir().to_string_lossy(),
        GAME,
        cache,
    )
    .expect("unit icons");
    serde_json::from_str(&out).expect("JSON")
}

#[test]
#[ignore = "needs an engine and Splinter Faction in ~/.spring, and a built unitsync worker"]
fn every_splinter_faction_unit_has_an_icon_type_that_resolves_to_a_picture() {
    let engine = engine();
    let cache = tempfile::tempdir().expect("a cache directory");

    let defs: Value = serde_json::from_str(
        &tauri_plugin_coilbox_unitsync::unit_defs_blocking(
            &engine.to_string_lossy(),
            &data_dir().to_string_lossy(),
            GAME,
        )
        .expect("unit defs"),
    )
    .expect("JSON");
    let units: Vec<&String> = defs["units"].as_object().expect("units").keys().collect();
    assert!(!units.is_empty(), "{}", defs["unitErrors"]);

    let first = icons(&engine, cache.path());
    assert_eq!(
        first["errors"],
        serde_json::json!([]),
        "the read had errors"
    );
    let unit_types = first["unitTypes"].as_object().expect("unitTypes");
    let types = first["types"].as_object().expect("types");

    for unit in &units {
        let named = unit_types
            .get(unit.as_str())
            .unwrap_or_else(|| panic!("{unit} has no icon type"))
            .as_str()
            .expect("a type name");
        let icon = types
            .get(named)
            .unwrap_or_else(|| panic!("{unit} names {named}, which is not in types"));
        let file = icon["file"]
            .as_str()
            .unwrap_or_else(|| panic!("{unit}'s type {named} has no picture: {icon}"));
        let png = std::fs::read(cache.path().join(file))
            .unwrap_or_else(|_| panic!("{file} is not in the cache"));
        assert_eq!(&png[1..4], b"PNG", "{file} is not a PNG");
        assert!(
            icon["size"].as_f64().is_some_and(|s| s > 0.0),
            "{named} has no size: {icon}"
        );
    }
    eprintln!(
        "{} units, {} icon types, {} pictures",
        units.len(),
        types.len(),
        types.values().filter(|t| t["file"].is_string()).count()
    );

    // A second call is answered from the record the first wrote, which names the
    // same pictures, and the cache answers it with no worker at all.
    let second = icons(&engine, cache.path());
    assert_eq!(second["unitTypes"], first["unitTypes"]);
    assert_eq!(second["types"], first["types"]);
    let archive = data_dir().join("games").join(GAME);
    let from_cache = coilbox_unitsync_worker::cached::unit_icons(cache.path(), &archive)
        .expect("the cache answers without a worker");
    assert_eq!(from_cache.unit_types.len(), unit_types.len());
}
