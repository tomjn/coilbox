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

/// Build args for `--game-header` mode: resolve a game's loadpicture art to a
/// cached data URL. `loadpicture` is the modinfo hint (may be empty); `checksum`
/// keys the disk cache (empty disables caching).
pub fn build_game_header_args(
    lib: &str,
    datadir: &str,
    archive: &str,
    loadpicture: &str,
    checksum: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--game-header".into());
    args.push("--archive".into());
    args.push(archive.into());
    args.push("--file".into());
    args.push(loadpicture.into());
    args.push("--checksum".into());
    args.push(checksum.into());
    push_cache_dir(&mut args, cache_dir);
    args
}

/// Build args for heightmap mode: scan args plus the map name, the `--heightmap`
/// flag, the longest-side pixel cap, and the optional on-disk PNG cache directory.
pub fn build_heightmap_args(
    lib: &str,
    datadir: &str,
    map: &str,
    max_side: i32,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--map".into());
    args.push(map.into());
    args.push("--heightmap".into());
    args.push("--max-side".into());
    args.push(max_side.to_string());
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

/// Build args for skirmish-AI mode: scan args plus the `--skirmish-ais` flag and,
/// when a game is given, `--game <archive>` so its Lua AIs are enumerated too.
pub fn build_skirmish_ai_args(lib: &str, datadir: &str, game: Option<&str>) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--skirmish-ais".into());
    if let Some(game) = game.filter(|g| !g.is_empty()) {
        args.push("--game".into());
        args.push(game.into());
    }
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

/// Build args for archive-extract (download) mode: the file-preview args plus the
/// destination path the member's full bytes are written to.
pub fn build_archive_extract_args(
    lib: &str,
    datadir: &str,
    archive: &str,
    file: &str,
    dest: &str,
) -> Vec<String> {
    let mut args = build_archive_file_args(lib, datadir, archive, file);
    args.push("--extract".into());
    args.push(dest.into());
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
    fn heightmap_args_carry_map_flag_and_max_side() {
        let a = build_heightmap_args(
            "/eng/libunitsync.dylib",
            "/data",
            "Map v1",
            512,
            Some("/cache/thumbs"),
        );
        assert!(a.contains(&"--heightmap".to_string()));
        assert_eq!(
            &a[a.len() - 2..],
            &["--cache-dir".to_string(), "/cache/thumbs".to_string()]
        );
        let i = a.iter().position(|x| x == "--map").unwrap();
        assert_eq!(a[i + 1], "Map v1");
        let j = a.iter().position(|x| x == "--max-side").unwrap();
        assert_eq!(a[j + 1], "512");
    }

    #[test]
    fn build_skirmish_ai_args_flag_and_optional_game() {
        let no_game = build_skirmish_ai_args("/eng/libunitsync.so", "/data", None);
        assert!(no_game.contains(&"--skirmish-ais".to_string()));
        assert!(!no_game.contains(&"--game".to_string()));

        let with_game = build_skirmish_ai_args("/eng/libunitsync.so", "/data", Some("BAR.sdd"));
        assert!(with_game.contains(&"--skirmish-ais".to_string()));
        assert_eq!(
            &with_game[with_game.len() - 2..],
            &["--game".to_string(), "BAR.sdd".to_string()],
        );

        let empty_game = build_skirmish_ai_args("/eng/libunitsync.so", "/data", Some(""));
        assert!(!empty_game.contains(&"--game".to_string()));
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

        let extract = build_archive_extract_args(
            "/eng/libunitsync.so",
            "/data",
            "Map.sd7",
            "maps/x.smd",
            "/out/x.smd",
        );
        assert!(extract.contains(&"--file".to_string()));
        assert_eq!(
            &extract[extract.len() - 2..],
            &["--extract".to_string(), "/out/x.smd".to_string()],
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
