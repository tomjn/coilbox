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
///
/// `asset_dir` additionally encodes each build pic as the hub's `buildpic` asset
/// and writes it there. Only the blueprint backfill asks for that (issue #1636).
/// Every other caller wants the `data:` icon and nothing on disk, and encoding a
/// WebP for a picture nobody is going to send is work for nothing.
pub fn build_unit_buildpics_args(
    lib: &str,
    datadir: &str,
    game: &str,
    units: &[String],
    cache_dir: Option<&str>,
    asset_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--unit-buildpics".into());
    args.push("--game".into());
    args.push(game.into());
    args.push("--units".into());
    args.push(units.join(","));
    push_cache_dir(&mut args, cache_dir);
    if let Some(dir) = asset_dir {
        args.push("--asset-dir".into());
        args.push(dir.into());
    }
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

/// Build args for `--unit-script` mode: the game and one unit definition's key.
///
/// The unit's own key rather than its `objectname`, because a script is named by
/// the definition and a model by a field inside it, and games regularly use
/// different words for the two.
pub fn build_unit_script_args(lib: &str, datadir: &str, game: &str, unit: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--unit-script".into());
    args.push("--game".into());
    args.push(game.into());
    args.push("--unit".into());
    args.push(unit.into());
    args
}

/// Build args for `--unit-models` mode: the game, a file of `objectname`s, and
/// the directory each flattened model and its textures are written into.
///
/// The objects travel by file for the same reason `--unit-render-keys`' units do:
/// a blueprint's worth of them is past what Windows takes on a command line.
pub fn build_unit_models_args(
    lib: &str,
    datadir: &str,
    game: &str,
    units_file: &str,
    cache_dir: &str,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--unit-models".into());
    args.push("--game".into());
    args.push(game.into());
    args.push("--units-file".into());
    args.push(units_file.into());
    push_cache_dir(&mut args, Some(cache_dir));
    args
}

/// Build args for `--unit-render` mode: the unit whose render this is, the frame
/// it was taken in, the file the pixels are in, and where the encoded asset goes.
///
/// The pixels travel by path rather than as an argument because a 256 square
/// render is a quarter of a megabyte of RGBA, which is past what a command line
/// takes on any platform.
///
/// The mode's own fields and cross field rules (the render source in
/// `source` is all three fields or none, checked by the worker's
/// `from_args`) live once in `coilbox_unitsync_worker::UnitRenderArgs`, so
/// this function only has to add `--lib`/`--datadir`, which every mode takes
/// and `Mode::to_args` does not include (issue #2448).
#[allow(clippy::too_many_arguments)]
pub fn build_unit_render_args(
    lib: &str,
    datadir: &str,
    game: &str,
    object: &str,
    angle: &str,
    footprint_x: u32,
    footprint_z: u32,
    renderer_version: u32,
    pixels: &str,
    width: u32,
    height: u32,
    asset_dir: &str,
    source: Option<coilbox_unitsync_worker::RenderSource>,
) -> Vec<String> {
    let mode = coilbox_unitsync_worker::Mode::UnitRender(coilbox_unitsync_worker::UnitRenderArgs {
        game: game.into(),
        object: object.into(),
        angle: angle.into(),
        footprint_x,
        footprint_z,
        renderer_version,
        pixels: pixels.into(),
        width,
        height,
        asset_dir: asset_dir.into(),
        source,
    });
    let mut args = build_args(lib, datadir);
    args.extend(mode.to_args());
    args
}

/// Build args for `--unit-render-keys` mode: the game the models come out of,
/// the file naming the units, and the angles and renderer the keys are for.
///
/// The units travel by path for the same reason the pixels do: a whole game's
/// roster is tens of kilobytes, which is past what Windows takes on a command
/// line. The angles do not: there are four of them and they are short words.
///
/// An empty list leaves `--angles` off, which is how the worker is told to key
/// every angle the vocabulary lists (issue #1951).
pub fn build_unit_render_keys_args(
    lib: &str,
    datadir: &str,
    game: &str,
    units_file: &str,
    angles: &[String],
    renderer_version: u32,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--unit-render-keys".into());
    args.push("--game".into());
    args.push(game.into());
    args.push("--units-file".into());
    args.push(units_file.into());
    if !angles.is_empty() {
        args.push("--angles".into());
        args.push(angles.join(","));
    }
    args.push("--renderer-version".into());
    args.push(renderer_version.to_string());
    args
}

/// Build args for heightmap mode: scan args plus the map name, the `--heightmap`
/// flag, and the optional on-disk picture cache directory.
///
/// No size cap. The height picture is capped at the shared vocabulary's edge so
/// the preview and the hub's `overlay:height` asset are the same bytes, which a
/// caller asking for its own size would break (issue #1730).
pub fn build_heightmap_args(
    lib: &str,
    datadir: &str,
    map: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--map".into());
    args.push(map.into());
    args.push("--heightmap".into());
    push_cache_dir(&mut args, cache_dir);
    args
}

/// Build args for height-field mode: scan args plus the map name, the
/// `--height-field` flag, and the cache directory the grid is written to. No
/// size cap: the whole point is the map's own corner grid at full depth (issue
/// #1490).
pub fn build_height_field_args(
    lib: &str,
    datadir: &str,
    map: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--map".into());
    args.push(map.into());
    args.push("--height-field".into());
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

/// Build args for the map catalog: the whole installed library in one Init,
/// assembled into the entries the hub takes (issue #1737).
///
/// `keys_only` reads each map\'s archive and hashes it and stops there, which is
/// what a have check compares on. Without it every map named also has its
/// infomaps read and its whole height grid counted, which is the expensive half
/// and worth paying only for the maps the hub said it wanted.
///
/// `maps_file` is a JSON array of map names, which is how the second pass is
/// told which those were. A file rather than an argument because three thousand
/// map names is past what Windows takes on a command line.
pub fn build_map_catalog_args(
    lib: &str,
    datadir: &str,
    maps_file: Option<&str>,
    keys_only: bool,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--map-catalog".into());
    if keys_only {
        args.push("--keys-only".into());
    }
    if let Some(path) = maps_file {
        args.push("--maps-file".into());
        args.push(path.into());
    }
    push_cache_dir(&mut args, cache_dir);
    args
}

/// Build args for the minimap walk: what every installed map's minimap would be
/// called, in one Init (issue #2379).
///
/// `asset_dir` is what tells the two passes apart. Without one the walk stops at
/// the identity, which is what a have check compares on and costs no encode. With
/// one it encodes the hub's `minimap` asset for each map named and writes it
/// there, which is the half worth paying only for the maps the hub asked for.
///
/// `maps_file` is a JSON array of map names, for the same reason the map catalog
/// takes one: a library's worth of names is past what Windows takes on a command
/// line.
pub fn build_map_minimaps_args(
    lib: &str,
    datadir: &str,
    maps_file: Option<&str>,
    cache_dir: Option<&str>,
    asset_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--map-minimaps".into());
    if let Some(path) = maps_file {
        args.push("--maps-file".into());
        args.push(path.into());
    }
    push_cache_dir(&mut args, cache_dir);
    if let Some(dir) = asset_dir {
        args.push("--asset-dir".into());
        args.push(dir.into());
    }
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
    fn heightmap_args_carry_the_map_flag_and_no_size_of_their_own() {
        let a = build_heightmap_args(
            "/eng/libunitsync.dylib",
            "/data",
            "Map v1",
            Some("/cache/thumbs"),
        );
        assert!(a.contains(&"--heightmap".to_string()));
        assert_eq!(
            &a[a.len() - 2..],
            &["--cache-dir".to_string(), "/cache/thumbs".to_string()]
        );
        let i = a.iter().position(|x| x == "--map").unwrap();
        assert_eq!(a[i + 1], "Map v1");
        // The vocabulary caps the height picture, so asking for a size here
        // would produce a preview that is not the asset (issue #1730).
        assert!(!a.contains(&"--max-side".to_string()));
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
            None,
        );
        assert!(a.contains(&"--unit-buildpics".to_string()));
        let g = a.iter().position(|x| x == "--game").unwrap();
        assert_eq!(a[g + 1], "BAR.sdd");
        let u = a.iter().position(|x| x == "--units").unwrap();
        assert_eq!(a[u + 1], "armcom,corcom");
        assert_eq!(&a[a.len() - 2..], &["--cache-dir", "/cache/buildpics"]);

        let without =
            build_unit_buildpics_args("/eng/libunitsync.so", "/data", "BAR.sdd", &[], None, None);
        assert!(without.contains(&"--unit-buildpics".to_string()));
        assert!(!without.iter().any(|x| x == "--cache-dir"));
    }

    /// The hub's build pic asset is opt-in, so the callers that only want the
    /// icon never pay for an encode (issue #1636).
    #[test]
    fn build_unit_buildpics_args_only_write_assets_when_asked() {
        let icons_only = build_unit_buildpics_args(
            "/eng/libunitsync.so",
            "/data",
            "BAR.sdd",
            &["armcom".into()],
            Some("/cache/buildpics"),
            None,
        );
        assert!(!icons_only.iter().any(|x| x == "--asset-dir"));

        let with_assets = build_unit_buildpics_args(
            "/eng/libunitsync.so",
            "/data",
            "BAR.sdd",
            &["armcom".into()],
            Some("/cache/buildpics"),
            Some("/cache/hub-assets"),
        );
        let at = with_assets
            .iter()
            .position(|x| x == "--asset-dir")
            .expect("asset dir");
        assert_eq!(with_assets[at + 1], "/cache/hub-assets");
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

    /// The batch's units travel in a file, and the cache directory is where the
    /// models it writes end up, so both have to reach the worker.
    #[test]
    fn build_unit_models_args_carry_the_game_the_units_file_and_the_cache_dir() {
        let a = build_unit_models_args(
            "/eng/libunitsync.so",
            "/data",
            "BAR.sdd",
            "/tmp/objects.json",
            "/cache/models",
        );
        assert!(a.contains(&"--unit-models".to_string()));
        assert!(!a.contains(&"--unit-model".to_string()));
        let g = a.iter().position(|x| x == "--game").unwrap();
        assert_eq!(a[g + 1], "BAR.sdd");
        let u = a.iter().position(|x| x == "--units-file").unwrap();
        assert_eq!(a[u + 1], "/tmp/objects.json");
        assert_eq!(&a[a.len() - 2..], &["--cache-dir", "/cache/models"]);
    }

    /// The whole point of sharing `UnitRenderArgs` with the worker: what
    /// `build_unit_render_args` writes, the worker's own `from_args` reads
    /// back whole. A test that only checks a flag appears at some position
    /// cannot catch the sidecar and the worker disagreeing about the mode's
    /// fields, and this one can (issue #2448).
    #[test]
    fn build_unit_render_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::UnitRenderArgs;

        let expected = UnitRenderArgs {
            game: "BAR.sdd".into(),
            object: "armcom.s3o".into(),
            angle: "top".into(),
            footprint_x: 3,
            footprint_z: 2,
            renderer_version: 1,
            pixels: "/tmp/pixels.bin".into(),
            width: 255,
            height: 204,
            asset_dir: "/assets".into(),
            source: None,
        };
        let a = build_unit_render_args(
            "/eng/libunitsync.so",
            "/data",
            &expected.game,
            &expected.object,
            &expected.angle,
            expected.footprint_x,
            expected.footprint_z,
            expected.renderer_version,
            &expected.pixels,
            expected.width,
            expected.height,
            &expected.asset_dir,
            expected.source.clone(),
        );
        assert!(
            a.contains(&"--lib".to_string()),
            "the shared lib/datadir args are still prepended"
        );
        let recovered = UnitRenderArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, expected);
    }

    /// A caller that already has the key from `--unit-render-keys` hands it
    /// down, and it has to round trip whole alongside the frame, not just
    /// arrive somewhere in the argv (issue #1720).
    #[test]
    fn build_unit_render_args_round_trips_a_handed_down_key_whole() {
        use coilbox_unitsync_worker::{RenderSource, UnitRenderArgs};

        let expected = UnitRenderArgs {
            game: "BAR.sdd".into(),
            object: "armcom.s3o".into(),
            angle: "top".into(),
            footprint_x: 3,
            footprint_z: 2,
            renderer_version: 1,
            pixels: "/tmp/pixels.bin".into(),
            width: 255,
            height: 204,
            asset_dir: "/assets".into(),
            source: Some(RenderSource {
                model_digest: "d5f0".into(),
                source_member: "objects3d/units/armcom.s3o".into(),
                source_archive: "Beyond All Reason test-30922".into(),
            }),
        };
        let a = build_unit_render_args(
            "/eng/libunitsync.so",
            "/data",
            &expected.game,
            &expected.object,
            &expected.angle,
            expected.footprint_x,
            expected.footprint_z,
            expected.renderer_version,
            &expected.pixels,
            expected.width,
            expected.height,
            &expected.asset_dir,
            expected.source.clone(),
        );
        let recovered = UnitRenderArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, expected);
    }

    /// The key mode's whole point is one call for many units, so the units go by
    /// file and the angles and renderer travel with them: a key made for the
    /// wrong renderer would report the hub's corpus as changed.
    #[test]
    fn build_unit_render_keys_args_carry_the_game_the_units_and_the_renderer() {
        let keys = |angles: &[&str]| {
            build_unit_render_keys_args(
                "/eng/libunitsync.so",
                "/data",
                "BAR.sdd",
                "/tmp/units.json",
                &angles.iter().map(|a| (*a).to_string()).collect::<Vec<_>>(),
                1,
            )
        };
        let a = keys(&["top", "angled"]);
        let after = |flag: &str| {
            let at = a.iter().position(|x| x == flag).expect(flag);
            a[at + 1].clone()
        };
        assert!(a.contains(&"--unit-render-keys".to_string()));
        assert_eq!(after("--game"), "BAR.sdd");
        assert_eq!(after("--units-file"), "/tmp/units.json");
        assert_eq!(after("--angles"), "top,angled");
        assert_eq!(after("--renderer-version"), "1");
        // Nothing is drawn or written, so neither belongs on this call.
        assert!(!a.contains(&"--pixels".to_string()));
        assert!(!a.contains(&"--asset-dir".to_string()));

        // No angles named is how a caller says every angle, so the flag has to be
        // absent rather than empty: an empty `--angles` would key nothing at all
        // and read to the caller as the hub already holding every picture.
        assert!(!keys(&[]).contains(&"--angles".to_string()));
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
