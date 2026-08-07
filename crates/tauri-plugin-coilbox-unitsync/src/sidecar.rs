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

/// Pick the worker path from an already-read override and executable directory.
/// The override wins outright. Otherwise look for `coilbox-unitsync-worker` (`.exe`
/// on Windows) in the `.coilbox` subfolder next to the executable (where the
/// Windows installer tucks sidecars to keep the install root clean), then next to
/// the executable itself as `externalBin` arranges (dev, and if the move didn't
/// run). Split out from `resolve_sidecar` so tests inject rather than set env.
fn resolve_sidecar_in(
    worker_override: Option<&str>,
    exe_dir: Option<&Path>,
    exists: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    if let Some(p) = worker_override.filter(|p| !p.is_empty()) {
        return Some(PathBuf::from(p));
    }
    let dir = exe_dir?;
    let name = format!("coilbox-unitsync-worker{}", std::env::consts::EXE_SUFFIX);
    let tucked = dir.join(".coilbox").join(&name);
    if exists(&tucked) {
        return Some(tucked);
    }
    let candidate = dir.join(&name);
    exists(&candidate).then_some(candidate)
}

/// Resolve the worker path, reading the `UNITSYNC_WORKER` override (handy for
/// `tauri dev`) and the executable's directory once here so the choice itself
/// stays pure.
pub fn resolve_sidecar() -> Option<PathBuf> {
    let worker_override = std::env::var("UNITSYNC_WORKER").ok();
    let exe = std::env::current_exe().ok();
    resolve_sidecar_in(
        worker_override.as_deref(),
        exe.as_deref().and_then(Path::parent),
        |p| p.exists(),
    )
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

/// Build args for batch `--game-headers` mode: resolve every game's loadpicture
/// art in one session, with the optional on-disk cache directory.
pub fn build_game_headers_args(lib: &str, datadir: &str, cache_dir: Option<&str>) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--game-headers".into());
    push_cache_dir(&mut args, cache_dir);
    args
}

/// Build args for `--unit-buildpics` mode: the game whose start-unit build icons
/// to resolve, the comma-joined unit names, and the optional on-disk cache dir.
pub fn build_unit_buildpics_args(
    lib: &str,
    datadir: &str,
    game: &str,
    units: &[String],
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--unit-buildpics".into());
    args.push("--game".into());
    args.push(game.into());
    args.push("--units".into());
    args.push(units.join(","));
    push_cache_dir(&mut args, cache_dir);
    args
}

/// Build args for `--faction-logos` mode: the game whose `Sidepics/<side>` emblems
/// to resolve, the comma-joined side names, and the optional on-disk cache dir.
pub fn build_faction_logos_args(
    lib: &str,
    datadir: &str,
    game: &str,
    sides: &[String],
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--faction-logos".into());
    args.push("--game".into());
    args.push(game.into());
    args.push("--sides".into());
    args.push(sides.join(","));
    push_cache_dir(&mut args, cache_dir);
    args
}

/// Build args for `--unit-dataset` mode: the game whose unit graph (units +
/// `buildoptions` edges) to read, plus the optional on-disk info-blob cache dir.
pub fn build_unit_dataset_args(
    lib: &str,
    datadir: &str,
    game: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--unit-dataset".into());
    args.push("--game".into());
    args.push(game.into());
    push_cache_dir(&mut args, cache_dir);
    args
}

/// Build args for `--unit-model` mode: the game whose archive holds the model,
/// the unitdef `objectname` naming it, plus the directory extracted textures are
/// cached in (and served from).
pub fn build_unit_model_args(
    lib: &str,
    datadir: &str,
    game: &str,
    object: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--unit-model".into());
    args.push("--game".into());
    args.push(game.into());
    args.push("--object".into());
    args.push(object.into());
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

/// Build args for metalmap mode: scan args plus the map name, the `--metalmap`
/// flag, the longest-side pixel cap, and the optional on-disk PNG cache directory.
pub fn build_metalmap_args(
    lib: &str,
    datadir: &str,
    map: &str,
    max_side: i32,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--map".into());
    args.push(map.into());
    args.push("--metalmap".into());
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

/// Build args for batch map-metadata mode: scan args plus the info-blob cache
/// directory the per-map results are stored in.
pub fn build_map_meta_args(lib: &str, datadir: &str, cache_dir: Option<&str>) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--map-meta".into());
    push_cache_dir(&mut args, cache_dir);
    args
}

/// Build args for game-detail mode: scan args plus the game's archive name and
/// the optional on-disk info-blob cache directory.
pub fn build_game_args(
    lib: &str,
    datadir: &str,
    game: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--game".into());
    args.push(game.into());
    push_cache_dir(&mut args, cache_dir);
    args
}

/// Build args for map-info mode: scan args plus the map name, the `--map-info`
/// flag, and the optional on-disk info-blob cache directory.
pub fn build_map_info_args(
    lib: &str,
    datadir: &str,
    map_name: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--map".into());
    args.push(map_name.into());
    args.push("--map-info".into());
    push_cache_dir(&mut args, cache_dir);
    args
}

/// Build args for map-skybox mode: scan args plus the map name and the
/// `--map-skybox` flag (read the map's `atmosphere.skyBox` DDS).
pub fn build_map_skybox_args(lib: &str, datadir: &str, map_name: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--map".into());
    args.push(map_name.into());
    args.push("--map-skybox".into());
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

/// Build args for engine-config write mode: scan args plus `--config-set` and the
/// `--config-key`/`--config-value` pair to set.
pub fn build_config_set_args(lib: &str, datadir: &str, key: &str, value: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--config-set".into());
    args.push("--config-key".into());
    args.push(key.into());
    args.push("--config-value".into());
    args.push(value.into());
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

/// Build args for `--lua` REPL replay mode: scan args plus the `--lua` flag, the
/// archive to mount, and the path of the temp file holding the JSON array of
/// session chunks (`--chunks-file`, not `--source-file`).
pub fn build_lua_repl_args(
    lib: &str,
    datadir: &str,
    archive: &str,
    chunks_file: &str,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--lua".into());
    args.push("--archive".into());
    args.push(archive.into());
    args.push("--chunks-file".into());
    args.push(chunks_file.into());
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
    fn game_headers_args_append_flag_and_cache_dir() {
        let with =
            build_game_headers_args("/eng/libunitsync.dylib", "/data", Some("/cache/headers"));
        assert!(with.contains(&"--game-headers".to_string()));
        assert_eq!(&with[with.len() - 2..], &["--cache-dir", "/cache/headers"]);
        let without = build_game_headers_args("/eng/libunitsync.dylib", "/data", None);
        assert!(without.contains(&"--game-headers".to_string()));
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
    fn metalmap_args_carry_map_flag_and_max_side() {
        let a = build_metalmap_args(
            "/eng/libunitsync.dylib",
            "/data",
            "Map v1",
            512,
            Some("/cache/thumbs"),
        );
        assert!(a.contains(&"--metalmap".to_string()));
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
    fn build_map_skybox_args_carry_map_and_flag() {
        let a = build_map_skybox_args("/eng/libunitsync.so", "/data", "Map v1");
        assert_eq!(a.last(), Some(&"--map-skybox".to_string()));
        let i = a.iter().position(|x| x == "--map").unwrap();
        assert_eq!(a[i + 1], "Map v1");
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
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
    fn build_map_info_args_carry_map_and_flag() {
        let a = build_map_info_args("/eng/libunitsync.dylib", "/home/u/.spring", "Map v1", None);
        assert_eq!(a.last(), Some(&"--map-info".to_string()));
        let i = a.iter().position(|x| x == "--map").unwrap();
        assert_eq!(a[i + 1], "Map v1");
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
    }

    #[test]
    fn build_game_and_map_info_args_append_cache_dir() {
        let g = build_game_args(
            "/eng/libunitsync.so",
            "/data",
            "game.sdd",
            Some("/cache/info"),
        );
        assert_eq!(&g[g.len() - 2..], &["--cache-dir", "/cache/info"]);
        let m = build_map_info_args(
            "/eng/libunitsync.so",
            "/data",
            "Map v1",
            Some("/cache/info"),
        );
        assert_eq!(&m[m.len() - 2..], &["--cache-dir", "/cache/info"]);
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
    fn build_unit_buildpics_args_carry_game_units_and_cache_dir() {
        let a = build_unit_buildpics_args(
            "/eng/libunitsync.so",
            "/data",
            "BAR.sdd",
            &["armcom".into(), "corcom".into()],
            Some("/cache/buildpics"),
        );
        assert!(a.contains(&"--unit-buildpics".to_string()));
        let g = a.iter().position(|x| x == "--game").unwrap();
        assert_eq!(a[g + 1], "BAR.sdd");
        let u = a.iter().position(|x| x == "--units").unwrap();
        assert_eq!(a[u + 1], "armcom,corcom");
        assert_eq!(&a[a.len() - 2..], &["--cache-dir", "/cache/buildpics"]);

        let without =
            build_unit_buildpics_args("/eng/libunitsync.so", "/data", "BAR.sdd", &[], None);
        assert!(without.contains(&"--unit-buildpics".to_string()));
        assert!(!without.iter().any(|x| x == "--cache-dir"));
    }

    #[test]
    fn build_unit_dataset_args_carry_game_and_cache_dir() {
        let a = build_unit_dataset_args(
            "/eng/libunitsync.so",
            "/data",
            "BAR.sdd",
            Some("/cache/info"),
        );
        assert!(a.contains(&"--unit-dataset".to_string()));
        let g = a.iter().position(|x| x == "--game").unwrap();
        assert_eq!(a[g + 1], "BAR.sdd");
        assert_eq!(&a[a.len() - 2..], &["--cache-dir", "/cache/info"]);

        let without = build_unit_dataset_args("/eng/libunitsync.so", "/data", "BAR.sdd", None);
        assert!(without.contains(&"--unit-dataset".to_string()));
        assert!(!without.iter().any(|x| x == "--cache-dir"));
    }

    #[test]
    fn build_unit_model_args_carry_game_object_and_cache_dir() {
        let a = build_unit_model_args(
            "/eng/libunitsync.so",
            "/data",
            "BA.sdz",
            "ARMCOM",
            Some("/cache/models"),
        );
        assert!(a.contains(&"--unit-model".to_string()));
        let g = a.iter().position(|x| x == "--game").unwrap();
        assert_eq!(a[g + 1], "BA.sdz");
        let o = a.iter().position(|x| x == "--object").unwrap();
        assert_eq!(a[o + 1], "ARMCOM");
        assert_eq!(&a[a.len() - 2..], &["--cache-dir", "/cache/models"]);
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
    fn resolve_sidecar_honors_worker_override() {
        let found = resolve_sidecar_in(Some("/custom/worker"), Some(Path::new("/app")), |_| true);
        assert_eq!(found, Some(PathBuf::from("/custom/worker")));
    }

    #[test]
    fn resolve_sidecar_ignores_empty_override() {
        let name = format!("coilbox-unitsync-worker{}", std::env::consts::EXE_SUFFIX);
        let tucked = Path::new("/app").join(".coilbox").join(&name);
        let found = resolve_sidecar_in(Some(""), Some(Path::new("/app")), |p| p == tucked);
        assert_eq!(found, Some(tucked));
    }

    #[test]
    fn resolve_sidecar_prefers_tucked_then_beside_exe() {
        let name = format!("coilbox-unitsync-worker{}", std::env::consts::EXE_SUFFIX);
        let tucked = Path::new("/app").join(".coilbox").join(&name);
        let beside = Path::new("/app").join(&name);

        let both = resolve_sidecar_in(None, Some(Path::new("/app")), |_| true);
        assert_eq!(both, Some(tucked));

        let only_beside = resolve_sidecar_in(None, Some(Path::new("/app")), |p| p == beside);
        assert_eq!(only_beside, Some(beside));
    }

    #[test]
    fn resolve_sidecar_absent_without_file_or_exe_dir() {
        assert_eq!(
            resolve_sidecar_in(None, Some(Path::new("/app")), |_| false),
            None
        );
        assert_eq!(resolve_sidecar_in(None, None, |_| true), None);
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

    #[test]
    fn build_lua_repl_args_carry_archive_and_chunks_file() {
        let a = build_lua_repl_args("/eng/libunitsync.so", "/data", "Map v1", "/tmp/c.json");
        assert!(a.contains(&"--lua".to_string()));
        assert_eq!(
            &a[a.len() - 4..],
            &[
                "--archive".to_string(),
                "Map v1".to_string(),
                "--chunks-file".to_string(),
                "/tmp/c.json".to_string(),
            ]
        );
    }
}
