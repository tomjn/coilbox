//! A compat mutator exported as an `.sdz` gives the engine the same sync
//! checksum as the `.sdd` folder it was exported from, so a player who only
//! has the `.sdz` can join a battle with one who built the folder.
//!
//! The engine hashes each file's lowercased path and its bytes, and leaves out
//! a top-level dot file such as the marker. A folder also leaves out a dot file
//! at any depth on macOS and Linux, but a zip keeps a nested one. So the export
//! has to leave those out too, or a `.DS_Store` that Finder writes into a
//! subfolder changes the `.sdz`'s checksum.
//!
//! Unitsync runs isolated to the engine's own folder and each test's content
//! root, which holds a read-only copy of the base game. It writes its cache
//! into that root, never into `~/.spring` or `~/.config/spring`.

#[allow(dead_code)]
mod common;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The isolation is process-wide env, so one test at a time sets it.
static ENV: Mutex<()> = Mutex::new(());

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap().flatten() {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).unwrap();
            read_only(&target);
        }
    }
}

fn read_only(path: &Path) {
    let mut perms = std::fs::metadata(path).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(path, perms).unwrap();
}

/// A fresh content root whose `games/` holds only a read-only copy of `base`.
fn root_with(base: &Path) -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("games").join(base.file_name().unwrap());
    if base.is_dir() {
        copy_dir(base, &target);
    } else {
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::copy(base, &target).unwrap();
        read_only(&target);
    }
    root
}

/// The game sync checksum unitsync gives `archive` in `root`, which covers
/// the archive and its dependencies.
fn checksum(engine: &Path, root: &Path, archive: &str) -> String {
    std::env::set_var("SPRING_ISOLATED", engine);
    std::env::set_var("SPRING_WRITEDIR", root);
    tauri_plugin_coilbox_unitsync::game_checksum_blocking(
        &engine.to_string_lossy(),
        &root.to_string_lossy(),
        archive,
    )
    .expect("checksum")
    .unwrap_or_else(|| panic!("unitsync gave {archive} no checksum"))
}

fn game_name(engine: &Path, root: &Path, archive: &str) -> String {
    std::env::set_var("SPRING_ISOLATED", engine);
    std::env::set_var("SPRING_WRITEDIR", root);
    let out = tauri_plugin_coilbox_unitsync::scan_blocking(
        &engine.to_string_lossy(),
        &root.to_string_lossy(),
    )
    .expect("scan");
    let scan: serde_json::Value = serde_json::from_str(&out).expect("the scan is JSON");
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
        .unwrap_or_else(|| panic!("the scan does not list {archive}: {}", scan["errors"]))
        .to_string()
}

/// Export the mutator built in `built_in` into a fresh root holding only
/// `base`, and return that root and the checksum unitsync gives the `.sdz`.
fn export_alone(
    engine: &Path,
    base: &Path,
    built_in: &Path,
    folder: &str,
) -> (tempfile::TempDir, String) {
    let archive = base.file_name().unwrap().to_string_lossy();
    let root = root_with(base);
    let sdz = folder.replace(".sdd", ".sdz");
    let dest = root.path().join("games").join(&sdz);
    tauri_plugin_coilbox_compat::export(
        &built_in.to_string_lossy(),
        &engine.to_string_lossy(),
        &archive,
        "0",
        &dest.to_string_lossy(),
    )
    .expect("export");
    let sum = checksum(engine, root.path(), &sdz);
    (root, sum)
}

/// Build a mutator for `base`, export it, and check the folder and the
/// `.sdz` give the same checksum, with and without a stray nested dot file.
fn folder_and_sdz_match(engine: &Path, base: &Path) {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let archive = base.file_name().unwrap().to_string_lossy().to_string();
    let built_in = root_with(base);
    let name = game_name(engine, built_in.path(), &archive);
    let built = tauri_plugin_coilbox_compat::build(
        &built_in.path().to_string_lossy(),
        &engine.to_string_lossy(),
        &archive,
        &name,
        "0",
        coilbox_compat::latest(),
        "0.0.0",
    )
    .expect("build");

    let folder_sum = checksum(engine, built_in.path(), &built.folder);
    let (_clean, sdz_sum) = export_alone(engine, base, built_in.path(), &built.folder);
    eprintln!("{}: folder {folder_sum}, .sdz {sdz_sum}", built.folder);
    assert_eq!(folder_sum, sdz_sum, "the .sdz's checksum differs");

    // A `.DS_Store` such as Finder writes on opening a subfolder.
    let sub = built
        .files
        .iter()
        .find_map(|f| f.rsplit_once('/').map(|(dir, _)| dir.to_string()))
        .expect("the mutator has a subfolder");
    let stray: PathBuf = Path::new(&built.dir).join(&sub).join(".DS_Store");
    std::fs::write(&stray, b"Bud1 stray finder metadata").unwrap();
    if cfg!(unix) {
        // The engine leaves dot files out of a folder at any depth here.
        assert_eq!(
            checksum(engine, built_in.path(), &built.folder),
            folder_sum,
            "the stray file changed the folder's checksum"
        );
    }
    let (_stray, stray_sum) = export_alone(engine, base, built_in.path(), &built.folder);
    eprintln!("{}: .sdz with {sub}/.DS_Store {stray_sum}", built.folder);
    assert_eq!(
        stray_sum, folder_sum,
        "a nested dot file changed the .sdz's checksum"
    );
}

#[test]
#[ignore = "needs xta-9.65.sd7 (or COILBOX_COMPAT_GAME) in ~/.spring/games, an installed engine with libunitsync, a built coilbox-unitsync-worker in target/debug"]
fn an_exported_game_mutator_has_the_folders_checksum() {
    let (engine, archive) = match common::setup() {
        Ok(v) => v,
        Err(why) => {
            eprintln!("{why}, so this checks nothing");
            return;
        }
    };
    let home = PathBuf::from(std::env::var_os("HOME").unwrap());
    folder_and_sdz_match(&engine, &home.join(".spring/games").join(archive));
}

#[test]
#[ignore = "needs an installed engine with libunitsync under ~/.spring/engine and a built coilbox-unitsync-worker in target/debug"]
fn an_exported_fixture_mutator_has_the_folders_checksum() {
    let engine = match common::engine() {
        Ok(engine) => engine,
        Err(why) => {
            eprintln!("{why}, so this checks nothing");
            return;
        }
    };
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/old-game.sdd");
    folder_and_sdz_match(&engine, &fixture);
}
