//! Two builds of one mutator are byte for byte the same, on every platform CI
//! runs (issue #4563).
//!
//! Multiplayer on the mutator rests on every player writing the same files. The
//! golden hashes in `tests` pin fixed in-memory games to one machine's output.
//! This builds a game checked in under `tests/fixtures/old-game.sdd` (three
//! units, one `.3do`, one gadget written for an old engine) twice into separate
//! folders, compares the files, and writes a SHA-256 per file for CI to compare
//! between operating systems.
//!
//! The 3do conversion runs the converter crates' own encoders on the fixture
//! model, without unitsync, which the runners do not have. The worker's
//! walk over an archive is not in the loop. `tests/converts_the_models.rs`
//! covers that, against a real game.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::*;

const ARCHIVE: &str = "old-game.sdd";

/// Where CI asks for the list of hashes. Without it the test only prints them.
const LIST_VARIABLE: &str = "COILBOX_COMPAT_HASH_LIST";

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(ARCHIVE)
}

/// Every file of the fixture game, by path and bytes.
fn fixture() -> Vec<(String, Vec<u8>)> {
    let dir = fixture_dir();
    models::list(&dir)
        .unwrap()
        .into_iter()
        .map(|path| {
            let bytes = std::fs::read(dir.join(&path)).unwrap();
            (path, bytes)
        })
        .collect()
}

/// The Lua compat scan's answer for the fixture, as the worker writes it.
fn scan_of(game: &[(String, Vec<u8>)]) -> String {
    let files: Vec<serde_json::Value> = game
        .iter()
        .filter(|(path, _)| path.ends_with(".lua"))
        .map(|(path, bytes)| {
            let src = String::from_utf8_lossy(bytes);
            let hits = coilbox_luacompat::scan(&src, coilbox_luacompat::Catalogue::embedded());
            serde_json::json!({ "archive": ARCHIVE, "path": path, "hits": hits })
        })
        .collect();
    serde_json::json!({ "files": files, "archives": [ARCHIVE], "errors": [] }).to_string()
}

/// What the worker's converter would write into `staging` for the fixture's
/// models, and its answer. The sheet and the model go through the converter
/// crates' encoders.
fn convert_into(game: &[(String, Vec<u8>)], staging: &Path) -> Result<String, String> {
    let write = |path: &str, bytes: &[u8]| -> Result<(), String> {
        let at = staging.join(path);
        std::fs::create_dir_all(at.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(at, bytes).map_err(|e| e.to_string())
    };
    let sheet = "objects3d";
    let (mut found, mut written) = (0, 0);
    for (path, bytes) in game
        .iter()
        .filter(|(path, _)| path.starts_with("objects3d/") && path.ends_with(".3do"))
    {
        found += 1;
        let model = coilbox_3do::read(bytes).map_err(|e| format!("{path}: {e:?}"))?;
        let packed = coilbox_3do_convert::pack(&coilbox_3do_convert::palette_tiles(&model, None))?;
        let png =
            coilbox_3do_convert::encode_sheet(&packed.image).ok_or("the sheet did not encode")?;
        let record = coilbox_3do_convert::Sheet::of(&packed, &format!("{sheet}.png")).write()?;
        let dir = coilbox_3do_convert::SHEET_DIR;
        write(&format!("unittextures/{dir}/{sheet}.png"), &png)?;
        write(&format!("unittextures/{dir}/{sheet}.json"), &record)?;
        let converted =
            coilbox_3do_convert::to_s3o(&model, &packed.rects, &format!("{dir}/{sheet}.png"))?;
        let s3o = coilbox_s3o::write(&converted.model).map_err(|e| format!("{path}: {e}"))?;
        write(&path.replace(".3do", ".s3o"), &s3o)?;
        written += 1;
    }
    Ok(format!(
        r#"{{"modelsFound":{found},"modelsWritten":{written},"errors":[]}}"#
    ))
}

/// The fixture built from manifest `n` into a content root of its own. The
/// root goes away with the returned folder.
fn build_fixture(n: u32, game: &[(String, Vec<u8>)]) -> (tempfile::TempDir, Built) {
    let root = tempfile::tempdir().unwrap();
    let staging = tempfile::tempdir().unwrap();
    let read = |file: &str| -> Result<Option<String>, String> {
        Ok(game
            .iter()
            .find(|(path, _)| path == file)
            .map(|(_, bytes)| String::from_utf8(bytes.clone()).unwrap()))
    };
    let handlers = handlers::handlers_in(&scan_of(game), ARCHIVE).unwrap();
    let built = build_reading(
        &root.path().to_string_lossy(),
        ARCHIVE,
        "Fixture Game 1",
        &DeclaredGame {
            short_name: Some("FG".into()),
            name: Some("Fixture Game".into()),
            version: Some("1".into()),
        },
        "1234abcd",
        n,
        "0.0.0",
        &handlers,
        read,
        || {
            models::convert_reading(
                read,
                || convert_into(game, staging.path()),
                staging.path(),
            )
        },
        || Ok(r#"{"units":{"testcom":{"commander":1},"testscout":{},"testtank":{}},"weaponDefs":{}}"#.into()),
    )
    .unwrap();
    (root, built)
}

/// Every file the build wrote, by path and bytes, marker included.
fn written(built: &Built) -> Vec<(String, Vec<u8>)> {
    let dir = Path::new(&built.dir);
    models::list(dir)
        .unwrap()
        .into_iter()
        .map(|path| {
            let bytes = std::fs::read(dir.join(&path)).unwrap();
            (path, bytes)
        })
        .collect()
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[test]
fn the_fixture_game_is_what_the_issue_describes() {
    let game = fixture();
    let paths: Vec<&str> = game.iter().map(|(path, _)| path.as_str()).collect();
    let count = |ext: &str| paths.iter().filter(|p| p.ends_with(ext)).count();
    assert_eq!(count(".fbi"), 3, "{paths:?}");
    assert_eq!(count(".3do"), 1, "{paths:?}");
    assert!(
        paths.contains(&"LuaRules/Gadgets/old_damage.lua"),
        "{paths:?}"
    );
}

#[test]
fn two_builds_of_the_fixture_are_byte_identical_from_every_manifest() {
    let game = fixture();
    let latest = coilbox_compat::latest();
    let mut list = Vec::new();
    for n in 1..=latest {
        let (_first_root, first) = build_fixture(n, &game);
        let (_second_root, second) = build_fixture(n, &game);
        assert_eq!(first.files, second.files, "manifest {n}");
        let (x, y) = (written(&first), written(&second));
        let paths = |files: &[(String, Vec<u8>)]| -> Vec<String> {
            files.iter().map(|(path, _)| path.clone()).collect()
        };
        assert_eq!(paths(&x), paths(&y), "manifest {n}");
        for ((path, a), (_, b)) in x.iter().zip(&y) {
            assert!(a == b, "{path} differs between two builds of manifest {n}");
        }
        for path in [
            "objects3d/testcom.s3o",
            "unittextures/3do/objects3d.png",
            "unittextures/3do/objects3d.json",
            mutator::MARKER,
        ] {
            assert!(paths(&x).iter().any(|p| p == path), "manifest {n}: {path}");
        }
        if n == latest {
            let synced = &x
                .iter()
                .find(|(path, _)| path == "compat/prelude-synced.lua")
                .expect("the latest manifest writes the synced prelude")
                .1;
            let synced = String::from_utf8(synced.clone()).unwrap();
            for fix in ["callin-unit-damaged-95", "callin-allow-command-105"] {
                assert!(
                    synced.contains(&format!("-- fix: {fix}\n")),
                    "the old gadget should get {fix}"
                );
            }
        }
        list.extend(
            x.iter()
                .map(|(path, bytes)| format!("{}  manifest-{n}/{path}\n", sha256(bytes))),
        );
    }
    let list = list.concat();
    eprintln!("{list}");
    if let Some(at) = std::env::var_os(LIST_VARIABLE) {
        std::fs::write(&at, &list).unwrap();
    }
}
