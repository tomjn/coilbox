//! Locate the bundled `coilbox-unitsync-worker` sidecar and the engine's
//! `libunitsync`, and build the worker's argument vector. These helpers are pure
//! so they can be unit-tested without spawning anything; the spawn/timeout lives
//! in `lib.rs`.
//!
//! The worker is bundled via Tauri `externalBin`, placed next to the app
//! executable at runtime. We resolve it there (with an env override for dev), so
//! the ACL grant stays uniform with every other plugin.

use std::path::{Path, PathBuf};

/// Candidate `libunitsync` filenames across platforms.
const UNITSYNC_NAMES: &[&str] = &["libunitsync.dylib", "unitsync.dll", "libunitsync.so"];

/// Resolve the worker path. `UNITSYNC_WORKER` overrides everything (handy for
/// `tauri dev` and tests); otherwise look next to the current executable for
/// `coilbox-unitsync-worker` (`.exe` on Windows), as `externalBin` arranges.
pub fn resolve_sidecar() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("UNITSYNC_WORKER") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let candidate = dir.join(format!(
        "coilbox-unitsync-worker{}",
        std::env::consts::EXE_SUFFIX
    ));
    candidate.exists().then_some(candidate)
}

/// Find the `libunitsync.*` inside an engine directory (the `Engine.path` from
/// the content plugin). Returns the first platform-matching file present.
pub fn find_unitsync(engine_dir: &Path) -> Option<PathBuf> {
    for name in UNITSYNC_NAMES {
        let candidate = engine_dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Build the worker argument vector: which library to load and which content root
/// to scan.
pub fn build_args(lib: &str, datadir: &str) -> Vec<String> {
    vec![
        "--lib".into(),
        lib.into(),
        "--datadir".into(),
        datadir.into(),
    ]
}

/// Append `--cache-dir <dir>` when a PNG cache directory is given.
fn push_cache_dir(args: &mut Vec<String>, cache_dir: Option<&str>) {
    if let Some(dir) = cache_dir {
        args.push("--cache-dir".into());
        args.push(dir.into());
    }
}

/// Build args for minimap mode: scan args plus the map name, mip level, and the
/// optional on-disk PNG cache directory.
pub fn build_minimap_args(
    lib: &str,
    datadir: &str,
    map: &str,
    mip: i32,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--map".into());
    args.push(map.into());
    args.push("--mip".into());
    args.push(mip.to_string());
    push_cache_dir(&mut args, cache_dir);
    args
}

/// Build args for batch-thumbnail mode: scan args plus the thumbnail mip level and
/// the optional on-disk PNG cache directory.
pub fn build_thumbnails_args(
    lib: &str,
    datadir: &str,
    mip: i32,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--thumbnails".into());
    args.push("--mip".into());
    args.push(mip.to_string());
    push_cache_dir(&mut args, cache_dir);
    args
}

/// Build args for game-detail mode: scan args plus the game's archive name.
pub fn build_game_args(lib: &str, datadir: &str, game: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--game".into());
    args.push(game.into());
    args
}

/// Build args for engine-config mode: scan args plus the `--config` flag.
pub fn build_config_args(lib: &str, datadir: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--config".into());
    args
}

/// Build args for archive-tree mode: scan args plus the archive name.
pub fn build_archive_tree_args(lib: &str, datadir: &str, archive: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--archive".into());
    args.push(archive.into());
    args
}

/// Build args for archive-file (member preview) mode: the archive name plus the
/// member's path within it.
pub fn build_archive_file_args(lib: &str, datadir: &str, archive: &str, file: &str) -> Vec<String> {
    let mut args = build_archive_tree_args(lib, datadir, archive);
    args.push("--file".into());
    args.push(file.into());
    args
}

/// Build args for `--lua` mode: scan args plus the `--lua` flag, the archive to
/// mount, and the path of the temp file holding the user's Lua source.
pub fn build_lua_args(lib: &str, datadir: &str, archive: &str, source_file: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--lua".into());
    args.push("--archive".into());
    args.push(archive.into());
    args.push("--source-file".into());
    args.push(source_file.into());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_args_has_lib_and_datadir() {
        let a = build_args("/eng/libunitsync.dylib", "/home/u/.spring");
        assert_eq!(
            a,
            vec![
                "--lib".to_string(),
                "/eng/libunitsync.dylib".to_string(),
                "--datadir".to_string(),
                "/home/u/.spring".to_string(),
            ]
        );
    }

    #[test]
    fn thumbnails_args_append_cache_dir_when_present() {
        let with =
            build_thumbnails_args("/eng/libunitsync.dylib", "/data", 3, Some("/cache/thumbs"));
        assert_eq!(&with[with.len() - 2..], &["--cache-dir", "/cache/thumbs"]);
        let without = build_thumbnails_args("/eng/libunitsync.dylib", "/data", 3, None);
        assert!(!without.iter().any(|a| a == "--cache-dir"));
    }

    #[test]
    fn minimap_args_append_cache_dir_when_present() {
        let with = build_minimap_args(
            "/eng/libunitsync.dylib",
            "/data",
            "Map v1",
            1,
            Some("/cache/thumbs"),
        );
        assert_eq!(&with[with.len() - 2..], &["--cache-dir", "/cache/thumbs"]);
        let without = build_minimap_args("/eng/libunitsync.dylib", "/data", "Map v1", 1, None);
        assert!(!without.iter().any(|a| a == "--cache-dir"));
    }

    #[test]
    fn build_config_args_appends_flag() {
        let a = build_config_args("/eng/libunitsync.dylib", "/home/u/.spring");
        assert_eq!(a.last(), Some(&"--config".to_string()));
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
    }

    #[test]
    fn build_archive_args_carry_archive_and_member() {
        let tree = build_archive_tree_args("/eng/libunitsync.so", "/data", "Map.sd7");
        assert_eq!(tree.last(), Some(&"Map.sd7".to_string()));
        assert!(tree.contains(&"--archive".to_string()));
        assert!(!tree.contains(&"--file".to_string()));

        let file = build_archive_file_args("/eng/libunitsync.so", "/data", "Map.sd7", "maps/x.smd");
        assert!(file.contains(&"--archive".to_string()));
        assert_eq!(
            &file[file.len() - 4..],
            &[
                "--archive".to_string(),
                "Map.sd7".to_string(),
                "--file".to_string(),
                "maps/x.smd".to_string(),
            ]
        );
    }

    #[test]
    fn find_unitsync_picks_present_file() {
        let dir = std::env::temp_dir().join("coilbox_unitsync_find_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // None present yet.
        assert!(find_unitsync(&dir).is_none());
        // Create a platform-appropriate name and find it.
        let name = if cfg!(target_os = "macos") {
            "libunitsync.dylib"
        } else if cfg!(windows) {
            "unitsync.dll"
        } else {
            "libunitsync.so"
        };
        let f = dir.join(name);
        std::fs::write(&f, b"x").unwrap();
        assert_eq!(find_unitsync(&dir), Some(f));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_sidecar_honors_env_override() {
        std::env::set_var("UNITSYNC_WORKER", "/custom/worker");
        assert_eq!(resolve_sidecar(), Some(PathBuf::from("/custom/worker")));
        std::env::remove_var("UNITSYNC_WORKER");
    }

    #[test]
    fn build_lua_args_carry_archive_and_source_file() {
        let a = build_lua_args("/eng/libunitsync.so", "/data", "Map v1", "/tmp/x.lua");
        assert!(a.contains(&"--lua".to_string()));
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
        assert_eq!(
            &a[a.len() - 4..],
            &[
                "--archive".to_string(),
                "Map v1".to_string(),
                "--source-file".to_string(),
                "/tmp/x.lua".to_string(),
            ]
        );
    }
}
