//! Where a content root's disk has gone, and the engine removal that follows.
//!
//! Nothing else in coilbox totals a root. Each screen knows its own corner of it,
//! so a player with a full disk has no way to see that the 40 GB is mostly engines
//! they upgraded past. [`overview`] walks a root once per category and reports the
//! breakdown, using the same walker (`caches::dir_stats`) and the same replay
//! search dirs (`demo::demo_search_dirs`) the rest of the crate uses, so the
//! figures agree with the lists the player already sees.
//!
//! The categories partition the tree: every byte under the root lands in exactly
//! one of them, so the total is the root's real size. That costs two adjustments.
//! Replays inside an engine folder are subtracted from the engines figure, because
//! `demo.rs` finds them and they are already in the replays figure. And everything
//! at the top level that no category names is summed as "other", so a stray
//! 20 GB folder is visible rather than silently missing from the total.

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::caches::dir_stats;

/// Top-level directory names the named categories already account for. Anything
/// else directly under the root is what "other" counts.
const COVERED_TOP_LEVEL: &[&str] = &[
    "engine", "games", "maps", "pool", "packages", "rapid", "saves", "demos", "replays",
];

/// The engine tree, relative to a content root.
const ENGINE_DIR: &str = "engine";

/// One line of a root's breakdown.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StorageCategory {
    /// Stable id for the UI, e.g. `engines`, `rapidPool`.
    pub id: String,
    pub label: String,
    pub bytes: u64,
    pub files: u64,
    /// The existing directories this figure covers, so the UI can reveal one.
    pub paths: Vec<String>,
}

/// One installed engine's own folder.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EngineUsage {
    pub path: String,
    pub version: String,
    /// The whole folder, which is what deleting it frees. The engines category is
    /// this less [`EngineUsage::replay_bytes`], which the replays category holds.
    pub bytes: u64,
    /// What this engine's own `demos`/`replays` folders hold. Non-zero means
    /// deleting the folder takes a player's game history with it.
    pub replay_bytes: u64,
}

/// One root's whole breakdown.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageOverview {
    pub root: String,
    pub categories: Vec<StorageCategory>,
    pub engines: Vec<EngineUsage>,
    pub total_bytes: u64,
}

/// Size every category under `root`. Missing directories contribute nothing, so a
/// root with no saves simply reports zero for saves.
pub fn overview(root: &Path) -> StorageOverview {
    let engine_tree = root.join(ENGINE_DIR);
    let replay_dirs = replay_dirs(root);

    let replays = tally("replays", "Replays", &replay_dirs);
    let games = tally("games", "Games", &[root.join("games")]);
    let maps = tally("maps", "Maps", &[root.join("maps")]);
    let saves = tally("saves", "Saves", &[root.join("Saves")]);
    // `rapid` holds the tag metadata pr-downloader fetches alongside the blobs. It
    // is small next to the pool, but it belongs with it rather than in "other".
    let rapid = tally(
        "rapidPool",
        "Rapid pool",
        &[root.join("pool"), root.join("packages"), root.join("rapid")],
    );

    // The engine tree less the replays sitting inside it, which the replays
    // category already counted.
    let mut engines = tally("engines", "Engines", std::slice::from_ref(&engine_tree));
    for dir in replay_dirs.iter().filter(|d| d.starts_with(&engine_tree)) {
        let (bytes, files) = dir_stats(dir);
        engines.bytes = engines.bytes.saturating_sub(bytes);
        engines.files = engines.files.saturating_sub(files);
    }

    let (other_bytes, other_files) = other_stats(root);
    let other = StorageCategory {
        id: "other".into(),
        label: "Other".into(),
        bytes: other_bytes,
        files: other_files,
        paths: if root.is_dir() {
            vec![crate::display_path(root)]
        } else {
            Vec::new()
        },
    };

    let categories = vec![engines, games, maps, replays, saves, rapid, other];
    let total_bytes = categories.iter().map(|c| c.bytes).sum();
    StorageOverview {
        root: crate::display_path(root),
        categories,
        engines: engine_usage(root),
        total_bytes,
    }
}

/// Every folder a root's replays can be in: `demos`/`replays` under the root and
/// under each installed engine, which is exactly where `content_list_replays`
/// looks (see [`crate::demo::demo_search_dirs`]).
fn replay_dirs(root: &Path) -> Vec<PathBuf> {
    crate::demo::demo_search_dirs(root)
        .iter()
        .flat_map(|base| crate::demo::DEMO_DIRS.iter().map(|d| base.join(d)))
        .collect()
}

/// Size one category's directories. Missing ones are skipped, and a directory
/// named twice is counted once (a portable install's engine dir is the root
/// itself, so its `demos` folder appears in the list twice).
fn tally(id: &str, label: &str, dirs: &[PathBuf]) -> StorageCategory {
    let mut out = StorageCategory {
        id: id.into(),
        label: label.into(),
        bytes: 0,
        files: 0,
        paths: Vec::new(),
    };
    let mut seen: HashSet<&Path> = HashSet::new();
    for dir in dirs {
        if !dir.is_dir() || !seen.insert(dir.as_path()) {
            continue;
        }
        let (bytes, files) = dir_stats(dir);
        out.bytes += bytes;
        out.files += files;
        out.paths.push(crate::display_path(dir));
    }
    out
}

/// Everything directly under `root` that no category names: loose files and
/// unrecognised folders. Symlinks are counted as one entry and never followed,
/// matching [`dir_stats`].
fn other_stats(root: &Path) -> (u64, u64) {
    let mut bytes = 0u64;
    let mut files = 0u64;
    let Ok(rd) = std::fs::read_dir(root) else {
        return (0, 0);
    };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if COVERED_TOP_LEVEL.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path();
        let Ok(md) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if md.file_type().is_symlink() {
            files += 1;
        } else if md.is_dir() {
            let (b, f) = dir_stats(&path);
            bytes += b;
            files += f;
        } else {
            bytes += md.len();
            files += 1;
        }
    }
    (bytes, files)
}

/// Each installed engine's own folder, sized. The root itself is skipped: a
/// portable single-folder install is an engine directory, but it is also all the
/// player's content, and [`delete_engine`] refuses it anyway.
fn engine_usage(root: &Path) -> Vec<EngineUsage> {
    let mut out: Vec<EngineUsage> = crate::scan::engine_dirs(root)
        .into_iter()
        .filter(|(dir, _)| dir != root)
        .map(|(dir, _)| {
            let (bytes, _) = dir_stats(&dir);
            let replay_bytes = crate::demo::DEMO_DIRS
                .iter()
                .map(|d| dir_stats(&dir.join(d)).0)
                .sum();
            EngineUsage {
                path: crate::display_path(&dir),
                version: dir
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                bytes,
                replay_bytes,
            }
        })
        .collect();
    out.sort_by(|a, b| a.version.cmp(&b.version));
    out
}

/// Delete one installed engine directory, returning the bytes it freed.
///
/// The guard is positional, like `archives`: the path must be a real directory
/// (a symlink to one is refused, so this cannot delete through a link) and one of
/// its ancestors must be named `engine`. That is what keeps the command from being
/// an arbitrary recursive delete. It also refuses the `engine` directory itself,
/// which holds every install rather than one.
pub fn delete_engine(path: &Path) -> Result<u64, String> {
    let md = std::fs::symlink_metadata(path).map_err(|_| "engine folder not found".to_string())?;
    if !md.is_dir() {
        return Err("not an engine folder".to_string());
    }
    if !inside_engine_dir(path) {
        return Err("only a folder inside an engine directory can be deleted".to_string());
    }
    let (bytes, _files) = dir_stats(path);
    std::fs::remove_dir_all(path).map_err(|e| format!("delete failed: {e}"))?;
    Ok(bytes)
}

/// Whether one of `path`'s ancestor directories is named `engine`, case
/// insensitively (Windows and macOS filesystems are case insensitive, so the
/// guard has to be too).
fn inside_engine_dir(path: &Path) -> bool {
    path.ancestors().skip(1).any(|a| {
        a.file_name()
            .map(|n| n.to_string_lossy().eq_ignore_ascii_case(ENGINE_DIR))
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("storage_test_{name}"));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn write(path: &Path, body: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    /// An engine folder the scan will recognise, which needs the binary in it.
    fn make_engine(dir: &Path, binary_bytes: &[u8]) {
        write(&dir.join("spring"), binary_bytes);
    }

    fn cat<'a>(o: &'a StorageOverview, id: &str) -> &'a StorageCategory {
        o.categories.iter().find(|c| c.id == id).unwrap()
    }

    #[test]
    fn sizes_each_category_separately() {
        let root = tmp("categories");
        write(&root.join("games").join("g.sd7"), b"1234");
        write(&root.join("maps").join("m.sd7"), b"123");
        write(&root.join("demos").join("a.sdfz"), b"12");
        write(&root.join("Saves").join("s.ssf"), b"1");
        write(&root.join("pool").join("ab").join("cd.gz"), b"12345");
        write(&root.join("packages").join("x.sdp"), b"123456");
        write(&root.join("notes.txt"), b"1234567");

        let o = overview(&root);
        assert_eq!(cat(&o, "games").bytes, 4);
        assert_eq!(cat(&o, "maps").bytes, 3);
        assert_eq!(cat(&o, "replays").bytes, 2);
        assert_eq!(cat(&o, "saves").bytes, 1);
        assert_eq!(cat(&o, "rapidPool").bytes, 11);
        assert_eq!(cat(&o, "other").bytes, 7);
        assert_eq!(o.total_bytes, 28);
    }

    #[test]
    fn totals_every_byte_under_the_root() {
        let root = tmp("total");
        write(&root.join("games").join("g.sd7"), b"12345");
        let engine = root.join("engine").join("105.1.1");
        make_engine(&engine, b"1234567890");
        write(&engine.join("demos").join("e.sdfz"), b"123");
        write(&root.join("stray").join("thing.bin"), b"1234");

        let o = overview(&root);
        // 5 games + 10 engine binary + 3 engine-folder replay + 4 stray.
        assert_eq!(o.total_bytes, 22);
    }

    #[test]
    fn engine_folder_replays_count_once_as_replays() {
        let root = tmp("engine_replays");
        let engine = root.join("engine").join("105.1.1");
        make_engine(&engine, b"1234567890");
        write(&engine.join("demos").join("e.sdfz"), b"123");
        write(&root.join("demos").join("r.sdfz"), b"12");

        let o = overview(&root);
        assert_eq!(cat(&o, "replays").bytes, 5, "both demos folders");
        assert_eq!(cat(&o, "engines").bytes, 10, "binary only, not the replay");
        assert_eq!(o.engines.len(), 1);
        assert_eq!(
            o.engines[0].bytes, 13,
            "the whole folder, as deleting frees"
        );
        assert_eq!(o.engines[0].replay_bytes, 3);
        assert_eq!(o.engines[0].version, "105.1.1");
    }

    #[test]
    fn a_missing_root_is_all_zeroes() {
        let root = tmp("missing").join("gone");
        let o = overview(&root);
        assert_eq!(o.total_bytes, 0);
        assert!(o.engines.is_empty());
        assert!(cat(&o, "games").paths.is_empty());
    }

    #[test]
    fn deletes_an_engine_version_folder() {
        let root = tmp("delete_engine");
        let engine = root.join("engine").join("105.1.1");
        make_engine(&engine, b"12345");
        assert_eq!(delete_engine(&engine), Ok(5));
        assert!(!engine.exists());
    }

    #[test]
    fn deletes_a_platform_nested_engine_folder() {
        let root = tmp("delete_engine_platform");
        let engine = root.join("engine").join("linux64").join("105.1.1");
        make_engine(&engine, b"1234");
        assert_eq!(delete_engine(&engine), Ok(4));
        assert!(!engine.exists());
    }

    #[test]
    fn refuses_the_engine_directory_itself() {
        let root = tmp("delete_engine_parent");
        let engines = root.join("engine");
        make_engine(&engines.join("105.1.1"), b"12345");
        assert!(delete_engine(&engines).is_err());
        assert!(engines.exists(), "the engine tree must survive");
    }

    #[test]
    fn refuses_a_folder_outside_any_engine_directory() {
        let root = tmp("delete_engine_outside");
        let games = root.join("games");
        fs::create_dir_all(&games).unwrap();
        assert!(delete_engine(&games).is_err());
        assert!(delete_engine(&root).is_err());
        assert!(games.exists());
    }

    #[test]
    fn refuses_a_file_and_a_missing_path() {
        let root = tmp("delete_engine_file");
        let file = root.join("engine").join("105.1.1.txt");
        write(&file, b"x");
        assert!(delete_engine(&file).is_err());
        assert!(file.exists());
        assert!(delete_engine(&root.join("engine").join("nope")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_to_a_folder() {
        use std::os::unix::fs::symlink;
        let root = tmp("delete_engine_symlink");
        let outside = root.join("precious");
        write(&outside.join("keep.txt"), b"keep");
        let link = root.join("engine").join("105.1.1");
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        symlink(&outside, &link).unwrap();

        assert!(delete_engine(&link).is_err());
        assert!(outside.join("keep.txt").exists());
    }
}
