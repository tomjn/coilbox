//! The fixture game builds into the same mutator twice through the real
//! unitsync worker, and unitsync gives both folders the same archive checksum
//! (issue #4563).
//!
//! CI has no engine, so the cross-platform hash list comes from the
//! `identical_builds` unit tests, which build the fixture without unitsync.
//! This one adds the number the file hashes could miss: the checksum unitsync
//! computes for each folder, printed so a run on another machine can be
//! compared by eye. It writes only into fresh content roots under the system's
//! temporary folder, which `TMPDIR` moves.

#[allow(dead_code)]
mod common;

use std::path::Path;

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap().flatten() {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

#[test]
#[ignore = "needs an installed engine with libunitsync under ~/.spring/engine and a built coilbox-unitsync-worker in target/debug"]
fn the_fixture_mutator_has_the_same_unitsync_checksum_twice() {
    let engine = match common::engine() {
        Ok(engine) => engine,
        Err(why) => {
            eprintln!("{why}, so this records no unitsync checksum");
            return;
        }
    };
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/old-game.sdd");
    let mut built = Vec::new();
    for _ in 0..2 {
        let root = tempfile::tempdir().unwrap();
        copy_dir(&fixture, &root.path().join("games/old-game.sdd"));
        let out = tauri_plugin_coilbox_compat::build(
            &root.path().to_string_lossy(),
            &engine.to_string_lossy(),
            "old-game.sdd",
            "Fixture Game 1",
            "0",
            coilbox_compat::latest(),
            "0.0.0",
        )
        .expect("build");
        let checksum = tauri_plugin_coilbox_unitsync::game_checksum_blocking(
            &engine.to_string_lossy(),
            &root.path().to_string_lossy(),
            &out.folder,
        )
        .expect("checksum");
        let dir = Path::new(&out.dir);
        let bytes: Vec<(String, Vec<u8>)> = out
            .files
            .iter()
            .map(|f| (f.clone(), std::fs::read(dir.join(f)).expect("read")))
            .collect();
        eprintln!("{}: unitsync checksum {checksum:?}", out.folder);
        built.push((checksum, bytes, out.notes));
    }
    assert!(built[0].0.is_some(), "unitsync gave no checksum");
    assert_eq!(built[0].0, built[1].0, "the unitsync checksums differ");
    assert!(built[0].1 == built[1].1, "the files differ");
    assert_eq!(built[0].2, built[1].2);
}
