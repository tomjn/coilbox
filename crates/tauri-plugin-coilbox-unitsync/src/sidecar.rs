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

/// Build args for the bare `--map` minimap mode: scan args plus the map
/// name, mip level, and the optional on-disk PNG cache directory.
///
/// No caller here ever sends an asset directory (the app draws its own
/// minimap preview and never asks the worker to encode one as a hub asset),
/// but `run()` still honours `MinimapArgs::asset_dir` when given, so the
/// field stays part of the contract (issue #2448).
pub fn build_minimap_args(
    lib: &str,
    datadir: &str,
    map: &str,
    mip: i32,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::Minimap(coilbox_unitsync_worker::MinimapArgs {
            map: map.into(),
            mip,
            cache_dir: cache_dir.map(String::from),
            asset_dir: None,
        })
        .to_args(),
    );
    args
}

/// Build args for batch `--game-headers` mode: resolve every game's loadpicture
/// art in one session, with the optional on-disk cache directory.
///
/// The mode's own field lives once in
/// `coilbox_unitsync_worker::GameHeadersArgs`, so this function only has to
/// add `--lib`/`--datadir`, which every mode takes and `Mode::to_args` does
/// not include (issue #2448).
pub fn build_game_headers_args(lib: &str, datadir: &str, cache_dir: Option<&str>) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::GameHeaders(coilbox_unitsync_worker::GameHeadersArgs {
            cache_dir: cache_dir.map(String::from),
        })
        .to_args(),
    );
    args
}

/// Build args for `--unit-buildpics` mode: the game whose start-unit build icons
/// to resolve, the comma-joined unit names, and the optional on-disk cache dir.
///
/// `asset_dir` additionally encodes each build pic as the hub's `buildpic` asset
/// and writes it there. Only the blueprint backfill asks for that (issue #1636).
/// Every other caller wants the `data:` icon and nothing on disk, and encoding a
/// WebP for a picture nobody is going to send is work for nothing.
///
/// The mode's fields live once in
/// `coilbox_unitsync_worker::UnitBuildpicsArgs`, so this function only has to
/// add `--lib`/`--datadir`, which every mode takes and `Mode::to_args` does
/// not include (issue #2448).
pub fn build_unit_buildpics_args(
    lib: &str,
    datadir: &str,
    game: &str,
    units: &[String],
    cache_dir: Option<&str>,
    asset_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::UnitBuildpics(coilbox_unitsync_worker::UnitBuildpicsArgs {
            game: game.into(),
            units: units.to_vec(),
            cache_dir: cache_dir.map(String::from),
            asset_dir: asset_dir.map(String::from),
        })
        .to_args(),
    );
    args
}

/// Build args for `--faction-logos` mode: the game whose `Sidepics/<side>` emblems
/// to resolve, the comma-joined side names, and the optional on-disk cache dir.
///
/// The mode's fields live once in `coilbox_unitsync_worker::FactionLogosArgs`,
/// so this function only has to add `--lib`/`--datadir`, which every mode
/// takes and `Mode::to_args` does not include (issue #2448).
pub fn build_faction_logos_args(
    lib: &str,
    datadir: &str,
    game: &str,
    sides: &[String],
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::FactionLogos(coilbox_unitsync_worker::FactionLogosArgs {
            game: game.into(),
            sides: sides.to_vec(),
            cache_dir: cache_dir.map(String::from),
        })
        .to_args(),
    );
    args
}

/// Build args for `--unit-dataset` mode: the game whose unit graph (units +
/// `buildoptions` edges) to read, plus the optional on-disk info-blob cache dir.
///
/// The mode's fields live once in `coilbox_unitsync_worker::UnitDatasetArgs`,
/// so this function only has to add `--lib`/`--datadir`, which every mode
/// takes and `Mode::to_args` does not include (issue #2448).
pub fn build_unit_dataset_args(
    lib: &str,
    datadir: &str,
    game: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::UnitDataset(coilbox_unitsync_worker::UnitDatasetArgs {
            game: game.into(),
            cache_dir: cache_dir.map(String::from),
        })
        .to_args(),
    );
    args
}

/// Build args for `--unit-model` mode: the game whose archive holds the model,
/// the unitdef `objectname` naming it, plus the directory extracted textures are
/// cached in (and served from).
///
/// The mode's fields live once in `coilbox_unitsync_worker::UnitModelArgs`,
/// so this function only has to add `--lib`/`--datadir`, which every mode
/// takes and `Mode::to_args` does not include (issue #2448).
pub fn build_unit_model_args(
    lib: &str,
    datadir: &str,
    game: &str,
    object: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::UnitModel(coilbox_unitsync_worker::UnitModelArgs {
            game: game.into(),
            object: object.into(),
            cache_dir: cache_dir.map(String::from),
        })
        .to_args(),
    );
    args
}

/// Build args for `--unit-script` mode: the game and one unit definition's key.
///
/// The unit's own key rather than its `objectname`, because a script is named by
/// the definition and a model by a field inside it, and games regularly use
/// different words for the two.
///
/// The mode's fields live once in `coilbox_unitsync_worker::UnitScriptArgs`,
/// so this function only has to add `--lib`/`--datadir`, which every mode
/// takes and `Mode::to_args` does not include (issue #2448).
pub fn build_unit_script_args(lib: &str, datadir: &str, game: &str, unit: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::UnitScript(coilbox_unitsync_worker::UnitScriptArgs {
            game: game.into(),
            unit: unit.into(),
        })
        .to_args(),
    );
    args
}

/// Build args for `--unit-models` mode: the game, a file of `objectname`s, and
/// the directory each flattened model and its textures are written into.
///
/// The objects travel by file for the same reason `--unit-render-keys`' units do:
/// a blueprint's worth of them is past what Windows takes on a command line.
///
/// The mode's own fields and cross field rule (both the units file and the
/// cache directory are required, checked by the worker's `from_args`) live
/// once in `coilbox_unitsync_worker::UnitModelsArgs`, so this function only
/// has to add `--lib`/`--datadir`, which every mode takes and `Mode::to_args`
/// does not include (issue #2448).
pub fn build_unit_models_args(
    lib: &str,
    datadir: &str,
    game: &str,
    units_file: &str,
    cache_dir: &str,
) -> Vec<String> {
    let mode = coilbox_unitsync_worker::Mode::UnitModels(coilbox_unitsync_worker::UnitModelsArgs {
        game: game.into(),
        units_file: units_file.into(),
        cache_dir: cache_dir.into(),
    });
    let mut args = build_args(lib, datadir);
    args.extend(mode.to_args());
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
///
/// The mode's own fields and this rule (the units file is required, an empty
/// `angles` means every angle) live once in
/// `coilbox_unitsync_worker::UnitRenderKeysArgs`, so this function only has to
/// add `--lib`/`--datadir`, which every mode takes and `Mode::to_args` does
/// not include (issue #2448).
pub fn build_unit_render_keys_args(
    lib: &str,
    datadir: &str,
    game: &str,
    units_file: &str,
    angles: &[String],
    renderer_version: u32,
) -> Vec<String> {
    let mode = coilbox_unitsync_worker::Mode::UnitRenderKeys(
        coilbox_unitsync_worker::UnitRenderKeysArgs {
            game: game.into(),
            units_file: units_file.into(),
            angles: angles.to_vec(),
            renderer_version,
        },
    );
    let mut args = build_args(lib, datadir);
    args.extend(mode.to_args());
    args
}

/// Build args for heightmap mode: the map name and the optional on-disk
/// picture cache directory.
///
/// No size cap. The height picture is capped at the shared vocabulary's edge so
/// the preview and the hub's `overlay:height` asset are the same bytes, which a
/// caller asking for its own size would break (issue #1730).
///
/// The mode's fields live once in `coilbox_unitsync_worker::HeightmapArgs`,
/// so this function only has to add `--lib`/`--datadir`, which every mode
/// takes and `Mode::to_args` does not include (issue #2448). No caller here
/// sends `--asset-dir`: that shape exists only because `run()` still honours
/// it.
pub fn build_heightmap_args(
    lib: &str,
    datadir: &str,
    map: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::Heightmap(coilbox_unitsync_worker::HeightmapArgs {
            map: map.into(),
            cache_dir: cache_dir.map(String::from),
            asset_dir: None,
        })
        .to_args(),
    );
    args
}

/// Build args for height-field mode: the map name and the cache directory
/// the grid is written to. No size cap: the whole point is the map's own
/// corner grid at full depth (issue #1490).
///
/// The mode's fields live once in
/// `coilbox_unitsync_worker::HeightFieldArgs`, so this function only has to
/// add `--lib`/`--datadir`, which every mode takes and `Mode::to_args` does
/// not include (issue #2448).
pub fn build_height_field_args(
    lib: &str,
    datadir: &str,
    map: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::HeightField(coilbox_unitsync_worker::HeightFieldArgs {
            map: map.into(),
            cache_dir: cache_dir.map(String::from),
        })
        .to_args(),
    );
    args
}

/// Build args for metalmap mode: the map name, the longest-side pixel cap,
/// and the optional on-disk PNG cache directory.
///
/// The mode's fields live once in `coilbox_unitsync_worker::MetalmapArgs`,
/// so this function only has to add `--lib`/`--datadir`, which every mode
/// takes and `Mode::to_args` does not include (issue #2448). No caller here
/// sends `--asset-dir`: that shape exists only because `run()` still honours
/// it.
pub fn build_metalmap_args(
    lib: &str,
    datadir: &str,
    map: &str,
    max_side: i32,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::Metalmap(coilbox_unitsync_worker::MetalmapArgs {
            map: map.into(),
            // `max_side` stays `i32` on this function's own signature since
            // that is what the Tauri command's `Option<i32>` parameter
            // carries. The worker has only ever taken a non-negative side,
            // and no caller sends a negative one, so this clamps rather than
            // widening the type the mode's contract exposes.
            max_side: max_side.max(0) as u32,
            cache_dir: cache_dir.map(String::from),
            asset_dir: None,
        })
        .to_args(),
    );
    args
}

/// Build args for batch-thumbnail mode: scan args plus the thumbnail mip level and
/// the optional on-disk PNG cache directory.
///
/// The mode's fields live once in `coilbox_unitsync_worker::ThumbnailsArgs`,
/// so this function only has to add `--lib`/`--datadir`, which every mode
/// takes and `Mode::to_args` does not include (issue #2448).
pub fn build_thumbnails_args(
    lib: &str,
    datadir: &str,
    mip: i32,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::Thumbnails(coilbox_unitsync_worker::ThumbnailsArgs {
            mip,
            cache_dir: cache_dir.map(String::from),
        })
        .to_args(),
    );
    args
}

/// Build args for batch map-metadata mode: scan args plus the info-blob cache
/// directory the per-map results are stored in.
///
/// The mode's own field lives once in
/// `coilbox_unitsync_worker::MapMetaArgs`, so this function only has to add
/// `--lib`/`--datadir`, which every mode takes and `Mode::to_args` does not
/// include (issue #2448).
pub fn build_map_meta_args(lib: &str, datadir: &str, cache_dir: Option<&str>) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::MapMeta(coilbox_unitsync_worker::MapMetaArgs {
            cache_dir: cache_dir.map(String::from),
        })
        .to_args(),
    );
    args
}

/// Build args for the bare `--game` game-detail mode: scan args plus the
/// game's archive name and the optional on-disk info-blob cache directory.
///
/// The mode's fields live once in `coilbox_unitsync_worker::GameArgs`, so
/// this function only has to add `--lib`/`--datadir`, which every mode takes
/// and `Mode::to_args` does not include (issue #2448).
pub fn build_game_args(
    lib: &str,
    datadir: &str,
    game: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::Game(coilbox_unitsync_worker::GameArgs {
            game: game.into(),
            cache_dir: cache_dir.map(String::from),
        })
        .to_args(),
    );
    args
}

/// Build args for map-info mode: scan args plus the map name, the `--map-info`
/// flag, and the optional on-disk info-blob cache directory.
///
/// The mode's field and cross field rule (`map_name` is required, checked by
/// the worker's `from_args`) live once in
/// `coilbox_unitsync_worker::MapInfoArgs`, so this function only has to add
/// `--lib`/`--datadir`, which every mode takes and `Mode::to_args` does not
/// include (issue #2448).
pub fn build_map_info_args(
    lib: &str,
    datadir: &str,
    map_name: &str,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::MapInfo(coilbox_unitsync_worker::MapInfoArgs {
            map: map_name.into(),
            cache_dir: cache_dir.map(String::from),
        })
        .to_args(),
    );
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
///
/// The mode's fields live once in
/// `coilbox_unitsync_worker::MapCatalogArgs`, so this function only has to
/// add `--lib`/`--datadir`, which every mode takes and `Mode::to_args` does
/// not include (issue #2448). No caller here sends a single map: that shape
/// exists only because `run()` still honours it.
pub fn build_map_catalog_args(
    lib: &str,
    datadir: &str,
    maps_file: Option<&str>,
    keys_only: bool,
    cache_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::MapCatalog(coilbox_unitsync_worker::MapCatalogArgs {
            map: None,
            maps_file: maps_file.map(String::from),
            keys_only,
            cache_dir: cache_dir.map(String::from),
        })
        .to_args(),
    );
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
///
/// The mode's fields live once in
/// `coilbox_unitsync_worker::MapMinimapsArgs`, so this function only has to
/// add `--lib`/`--datadir`, which every mode takes and `Mode::to_args` does
/// not include (issue #2448).
pub fn build_map_minimaps_args(
    lib: &str,
    datadir: &str,
    maps_file: Option<&str>,
    cache_dir: Option<&str>,
    asset_dir: Option<&str>,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::MapMinimaps(coilbox_unitsync_worker::MapMinimapsArgs {
            maps_file: maps_file.map(String::from),
            cache_dir: cache_dir.map(String::from),
            asset_dir: asset_dir.map(String::from),
        })
        .to_args(),
    );
    args
}

/// Build args for map-skybox mode: scan args plus the map name and the
/// `--map-skybox` flag (read the map's `atmosphere.skyBox` DDS).
///
/// The mode's field and cross field rule (`map_name` is required, checked by
/// the worker's `from_args`) live once in
/// `coilbox_unitsync_worker::MapSkyboxArgs`, so this function only has to
/// add `--lib`/`--datadir`, which every mode takes and `Mode::to_args` does
/// not include (issue #2448).
pub fn build_map_skybox_args(lib: &str, datadir: &str, map_name: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::MapSkybox(coilbox_unitsync_worker::MapSkyboxArgs {
            map: map_name.into(),
        })
        .to_args(),
    );
    args
}

/// Build args for skirmish-AI mode: scan args plus the `--skirmish-ais` flag and,
/// when a game is given, `--game <archive>` so its Lua AIs are enumerated too.
///
/// The mode's field and its empty-string filter live once in
/// `coilbox_unitsync_worker::SkirmishAisArgs`, so this function only has to
/// add `--lib`/`--datadir`, which every mode takes and `Mode::to_args` does
/// not include (issue #2448).
pub fn build_skirmish_ai_args(lib: &str, datadir: &str, game: Option<&str>) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::SkirmishAis(coilbox_unitsync_worker::SkirmishAisArgs {
            game: game.map(String::from),
        })
        .to_args(),
    );
    args
}

/// Build args for engine-config mode: scan args plus the `--config` flag.
///
/// `--config` has no fields of its own, so `Mode::Config` carries none
/// either (issue #2448). This function only has to add `--lib`/`--datadir`,
/// which every mode takes and `Mode::to_args` does not include.
pub fn build_config_args(lib: &str, datadir: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(coilbox_unitsync_worker::Mode::Config.to_args());
    args
}

/// Build args for engine-config write mode: scan args plus `--config-set` and the
/// `--config-key`/`--config-value` pair to set.
///
/// The mode's own field and its rule (`key` is required, checked by the
/// worker's `from_args`) live once in
/// `coilbox_unitsync_worker::ConfigSetArgs`, so this function only has to add
/// `--lib`/`--datadir`, which every mode takes and `Mode::to_args` does not
/// include (issue #2448).
pub fn build_config_set_args(lib: &str, datadir: &str, key: &str, value: &str) -> Vec<String> {
    let mode = coilbox_unitsync_worker::Mode::ConfigSet(coilbox_unitsync_worker::ConfigSetArgs {
        key: key.into(),
        value: value.into(),
    });
    let mut args = build_args(lib, datadir);
    args.extend(mode.to_args());
    args
}

/// Build args for `--archive` tree mode: scan args plus the archive name.
///
/// The mode's fields live once in `coilbox_unitsync_worker::ArchiveArgs`, so
/// this function only has to add `--lib`/`--datadir`, which every mode takes
/// and `Mode::to_args` does not include (issue #2448).
pub fn build_archive_tree_args(lib: &str, datadir: &str, archive: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::Archive(coilbox_unitsync_worker::ArchiveArgs {
            archive: archive.into(),
            file: None,
            extract: None,
        })
        .to_args(),
    );
    args
}

/// Build args for `--archive` file (member preview) mode: the archive name
/// plus the member's path within it.
pub fn build_archive_file_args(lib: &str, datadir: &str, archive: &str, file: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::Archive(coilbox_unitsync_worker::ArchiveArgs {
            archive: archive.into(),
            file: Some(file.into()),
            extract: None,
        })
        .to_args(),
    );
    args
}

/// Build args for `--lua` mode: scan args plus the `--lua` flag, the archive to
/// mount, and the path of the temp file holding the user's Lua source.
///
/// The mode's fields live once in `coilbox_unitsync_worker::LuaArgs`, so this
/// function only has to add `--lib`/`--datadir`, which every mode takes and
/// `Mode::to_args` does not include (issue #2448).
pub fn build_lua_args(lib: &str, datadir: &str, archive: &str, source_file: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::Lua(coilbox_unitsync_worker::LuaArgs {
            archive: archive.into(),
            source_file: Some(source_file.into()),
            chunks_file: None,
        })
        .to_args(),
    );
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
    args.extend(
        coilbox_unitsync_worker::Mode::Lua(coilbox_unitsync_worker::LuaArgs {
            archive: archive.into(),
            source_file: None,
            chunks_file: Some(chunks_file.into()),
        })
        .to_args(),
    );
    args
}

/// Build args for `--archive` extract (download) mode: the archive and
/// member plus the destination path the member's full bytes are written to.
pub fn build_archive_extract_args(
    lib: &str,
    datadir: &str,
    archive: &str,
    file: &str,
    dest: &str,
) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.extend(
        coilbox_unitsync_worker::Mode::Archive(coilbox_unitsync_worker::ArchiveArgs {
            archive: archive.into(),
            file: Some(file.into()),
            extract: Some(dest.into()),
        })
        .to_args(),
    );
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

    /// What `build_thumbnails_args` writes, the worker's own `from_args`
    /// reads back whole. A test that only checks a flag landed somewhere in
    /// the argv cannot catch the sidecar and the worker disagreeing about
    /// the mode's fields, and this one can (issue #2448).
    #[test]
    fn build_thumbnails_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::ThumbnailsArgs;

        let with =
            build_thumbnails_args("/eng/libunitsync.dylib", "/data", 3, Some("/cache/thumbs"));
        assert!(with.contains(&"--lib".to_string()) && with.contains(&"--datadir".to_string()));
        let recovered = ThumbnailsArgs::from_args(&with).expect("valid argv");
        assert_eq!(
            recovered,
            ThumbnailsArgs {
                mip: 3,
                cache_dir: Some("/cache/thumbs".into()),
            }
        );

        let without = build_thumbnails_args("/eng/libunitsync.dylib", "/data", 3, None);
        assert!(!without.iter().any(|a| a == "--cache-dir"));
        let recovered = ThumbnailsArgs::from_args(&without).expect("valid argv");
        assert_eq!(recovered.cache_dir, None);
    }

    /// What `build_game_headers_args` writes, the worker's own `from_args`
    /// reads back whole. A test that only checks a flag landed somewhere in
    /// the argv cannot catch the sidecar and the worker disagreeing about
    /// the mode's field, and this one can (issue #2448).
    #[test]
    fn build_game_headers_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::GameHeadersArgs;

        let with =
            build_game_headers_args("/eng/libunitsync.dylib", "/data", Some("/cache/headers"));
        assert!(with.contains(&"--game-headers".to_string()));
        let recovered = GameHeadersArgs::from_args(&with).expect("valid argv");
        assert_eq!(
            recovered,
            GameHeadersArgs {
                cache_dir: Some("/cache/headers".into()),
            }
        );

        let without = build_game_headers_args("/eng/libunitsync.dylib", "/data", None);
        assert!(without.contains(&"--game-headers".to_string()));
        assert!(!without.iter().any(|a| a == "--cache-dir"));
        let recovered = GameHeadersArgs::from_args(&without).expect("valid argv");
        assert_eq!(recovered.cache_dir, None);
    }

    /// What `build_minimap_args` writes, the worker's own `from_args` reads
    /// back whole. A test that only checks a flag landed somewhere in the
    /// argv cannot catch the sidecar and the worker disagreeing about the
    /// mode's fields, and this one can (issue #2448).
    #[test]
    fn build_minimap_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::MinimapArgs;

        let with = build_minimap_args(
            "/eng/libunitsync.dylib",
            "/data",
            "Map v1",
            1,
            Some("/cache/thumbs"),
        );
        let recovered = MinimapArgs::from_args(&with).expect("valid argv");
        assert_eq!(
            recovered,
            MinimapArgs {
                map: "Map v1".into(),
                mip: 1,
                cache_dir: Some("/cache/thumbs".into()),
                asset_dir: None,
            }
        );

        let without = build_minimap_args("/eng/libunitsync.dylib", "/data", "Map v1", 1, None);
        assert!(!without.iter().any(|a| a == "--cache-dir"));
        assert_eq!(
            MinimapArgs::from_args(&without)
                .expect("valid argv")
                .cache_dir,
            None
        );
    }

    /// What `build_heightmap_args` writes, the worker's own `from_args`
    /// reads back whole. A test that only checks a flag landed somewhere in
    /// the argv cannot catch the sidecar and the worker disagreeing about
    /// the mode's fields, and this one can (issue #2448).
    #[test]
    fn build_heightmap_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::HeightmapArgs;

        let a = build_heightmap_args(
            "/eng/libunitsync.dylib",
            "/data",
            "Map v1",
            Some("/cache/thumbs"),
        );
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
        let recovered = HeightmapArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            HeightmapArgs {
                map: "Map v1".into(),
                cache_dir: Some("/cache/thumbs".into()),
                asset_dir: None,
            }
        );
        // The vocabulary caps the height picture, so asking for a size here
        // would produce a preview that is not the asset (issue #1730).
        assert!(!a.contains(&"--max-side".to_string()));
    }

    /// What `build_height_field_args` writes, the worker's own `from_args`
    /// reads back whole.
    #[test]
    fn build_height_field_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::HeightFieldArgs;

        let a = build_height_field_args(
            "/eng/libunitsync.dylib",
            "/data",
            "Map v1",
            Some("/cache/thumbs"),
        );
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
        let recovered = HeightFieldArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            HeightFieldArgs {
                map: "Map v1".into(),
                cache_dir: Some("/cache/thumbs".into()),
            }
        );
    }

    /// What `build_metalmap_args` writes, the worker's own `from_args` reads
    /// back whole.
    #[test]
    fn build_metalmap_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::MetalmapArgs;

        let a = build_metalmap_args(
            "/eng/libunitsync.dylib",
            "/data",
            "Map v1",
            512,
            Some("/cache/thumbs"),
        );
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
        let recovered = MetalmapArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            MetalmapArgs {
                map: "Map v1".into(),
                max_side: 512,
                cache_dir: Some("/cache/thumbs".into()),
                asset_dir: None,
            }
        );
    }

    /// A negative `max_side` (never sent by the real caller) clamps to 0
    /// rather than wrapping into a huge cap, since the mode's contract has
    /// only ever taken a non-negative side.
    #[test]
    fn build_metalmap_args_clamps_a_negative_max_side_to_zero() {
        use coilbox_unitsync_worker::MetalmapArgs;

        let a = build_metalmap_args("/eng/libunitsync.dylib", "/data", "Map v1", -5, None);
        let recovered = MetalmapArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered.max_side, 0);
    }

    /// What `build_map_skybox_args` writes, the worker's own `from_args`
    /// reads back whole. A test that only checks a flag landed somewhere in
    /// the argv cannot catch the sidecar and the worker disagreeing about
    /// the mode's field, and this one can (issue #2448).
    #[test]
    fn build_map_skybox_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::MapSkyboxArgs;

        let a = build_map_skybox_args("/eng/libunitsync.so", "/data", "Map v1");
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
        let recovered = MapSkyboxArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            MapSkyboxArgs {
                map: "Map v1".into()
            }
        );
    }

    #[test]
    fn build_skirmish_ai_args_flag_and_optional_game() {
        use coilbox_unitsync_worker::SkirmishAisArgs;

        let no_game = build_skirmish_ai_args("/eng/libunitsync.so", "/data", None);
        assert!(no_game.contains(&"--skirmish-ais".to_string()));
        assert!(!no_game.contains(&"--game".to_string()));
        assert_eq!(
            SkirmishAisArgs::from_args(&no_game).expect("valid argv"),
            SkirmishAisArgs { game: None }
        );

        let with_game = build_skirmish_ai_args("/eng/libunitsync.so", "/data", Some("BAR.sdd"));
        assert!(with_game.contains(&"--skirmish-ais".to_string()));
        assert_eq!(
            SkirmishAisArgs::from_args(&with_game).expect("valid argv"),
            SkirmishAisArgs {
                game: Some("BAR.sdd".into())
            }
        );

        let empty_game = build_skirmish_ai_args("/eng/libunitsync.so", "/data", Some(""));
        assert!(!empty_game.contains(&"--game".to_string()));
    }

    /// `--config` has no fields of its own, so there is no `from_args` to
    /// round trip through. What this can still show is that the flag comes
    /// from `Mode::Config` itself rather than a hand written literal that
    /// could drift from it (issue #2448).
    #[test]
    fn build_config_args_appends_the_shared_mode_s_flag() {
        let a = build_config_args("/eng/libunitsync.dylib", "/home/u/.spring");
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
        assert_eq!(
            a[a.len() - 1..],
            coilbox_unitsync_worker::Mode::Config.to_args()
        );
    }

    /// The whole point of sharing `ConfigSetArgs` with the worker: what
    /// `build_config_set_args` writes, the worker's own `from_args` reads
    /// back whole. A test that only checks a flag landed somewhere in the
    /// argv cannot catch the sidecar and the worker disagreeing about the
    /// mode's fields, and this one can (issue #2448).
    #[test]
    fn build_config_set_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::ConfigSetArgs;

        let expected = ConfigSetArgs {
            key: "Fullscreen".into(),
            value: "1".into(),
        };
        let a = build_config_set_args(
            "/eng/libunitsync.dylib",
            "/home/u/.spring",
            &expected.key,
            &expected.value,
        );
        assert!(
            a.contains(&"--lib".to_string()),
            "the shared lib/datadir args are still prepended"
        );
        let recovered = ConfigSetArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, expected);
    }

    /// What `build_map_info_args` writes, the worker's own `from_args` reads
    /// back whole. A test that only checks a flag landed somewhere in the
    /// argv cannot catch the sidecar and the worker disagreeing about the
    /// mode's fields, and this one can (issue #2448).
    #[test]
    fn build_map_info_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::MapInfoArgs;

        let a = build_map_info_args(
            "/eng/libunitsync.dylib",
            "/home/u/.spring",
            "Map v1",
            Some("/cache/info"),
        );
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
        let recovered = MapInfoArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            MapInfoArgs {
                map: "Map v1".into(),
                cache_dir: Some("/cache/info".into()),
            }
        );
    }

    /// What `build_game_args` writes, the worker's own `from_args` reads
    /// back whole. A test that only checks a flag landed somewhere in the
    /// argv cannot catch the sidecar and the worker disagreeing about the
    /// mode's fields, and this one can (issue #2448).
    #[test]
    fn build_game_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::GameArgs;

        let g = build_game_args(
            "/eng/libunitsync.so",
            "/data",
            "game.sdd",
            Some("/cache/info"),
        );
        let recovered = GameArgs::from_args(&g).expect("valid argv");
        assert_eq!(
            recovered,
            GameArgs {
                game: "game.sdd".into(),
                cache_dir: Some("/cache/info".into()),
            }
        );
    }

    /// What `build_map_meta_args` writes, the worker's own `from_args` reads
    /// back whole. A test that only checks a flag landed somewhere in the
    /// argv cannot catch the sidecar and the worker disagreeing about the
    /// mode's field, and this one can (issue #2448).
    #[test]
    fn build_map_meta_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::MapMetaArgs;

        let a = build_map_meta_args("/eng/libunitsync.so", "/data", Some("/cache/meta"));
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
        let recovered = MapMetaArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            MapMetaArgs {
                cache_dir: Some("/cache/meta".into()),
            }
        );

        let without = build_map_meta_args("/eng/libunitsync.so", "/data", None);
        assert!(!without.iter().any(|a| a == "--cache-dir"));
    }

    /// What `build_map_catalog_args` writes, the worker's own `from_args`
    /// reads back whole. A test that only checks a flag landed somewhere in
    /// the argv cannot catch the sidecar and the worker disagreeing about
    /// the mode's fields, and this one can (issue #2448).
    #[test]
    fn build_map_catalog_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::MapCatalogArgs;

        let a = build_map_catalog_args(
            "/eng/libunitsync.so",
            "/data",
            Some("/tmp/maps.json"),
            true,
            Some("/cache/catalog"),
        );
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
        let recovered = MapCatalogArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            MapCatalogArgs {
                map: None,
                maps_file: Some("/tmp/maps.json".into()),
                keys_only: true,
                cache_dir: Some("/cache/catalog".into()),
            }
        );
    }

    /// The have-check pass takes none of the optional fields, so that shape
    /// has to round trip too.
    #[test]
    fn build_map_catalog_args_with_nothing_narrowed_round_trips_to_defaults() {
        use coilbox_unitsync_worker::MapCatalogArgs;

        let a = build_map_catalog_args("/eng/libunitsync.so", "/data", None, false, None);
        let recovered = MapCatalogArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, MapCatalogArgs::default());
    }

    /// What `build_map_minimaps_args` writes, the worker's own `from_args`
    /// reads back whole. A test that only checks a flag landed somewhere in
    /// the argv cannot catch the sidecar and the worker disagreeing about
    /// the mode's fields, and this one can (issue #2448).
    #[test]
    fn build_map_minimaps_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::MapMinimapsArgs;

        let a = build_map_minimaps_args(
            "/eng/libunitsync.so",
            "/data",
            Some("/tmp/maps.json"),
            Some("/cache/minimaps"),
            Some("/assets"),
        );
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
        let recovered = MapMinimapsArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            MapMinimapsArgs {
                maps_file: Some("/tmp/maps.json".into()),
                cache_dir: Some("/cache/minimaps".into()),
                asset_dir: Some("/assets".into()),
            }
        );
    }

    /// The first pass of the sweep (issue #2379) gives no asset directory,
    /// which has to round trip to `None` rather than an empty string.
    #[test]
    fn build_map_minimaps_args_with_no_asset_dir_round_trips_none() {
        use coilbox_unitsync_worker::MapMinimapsArgs;

        let a = build_map_minimaps_args("/eng/libunitsync.so", "/data", None, None, None);
        assert!(!a.iter().any(|a| a == "--asset-dir"));
        let recovered = MapMinimapsArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, MapMinimapsArgs::default());
    }

    /// What each `build_archive_*_args` writes, the worker's own `from_args`
    /// reads back whole, for all three shapes: a bare tree listing, a file
    /// preview, and an extract. A test that only checks a flag landed
    /// somewhere in the argv cannot catch the sidecar and the worker
    /// disagreeing about the mode's fields, and this one can (issue #2448).
    #[test]
    fn build_archive_args_round_trip_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::ArchiveArgs;

        let tree = build_archive_tree_args("/eng/libunitsync.so", "/data", "Map.sd7");
        assert_eq!(
            ArchiveArgs::from_args(&tree).expect("valid argv"),
            ArchiveArgs {
                archive: "Map.sd7".into(),
                file: None,
                extract: None,
            }
        );

        let file = build_archive_file_args("/eng/libunitsync.so", "/data", "Map.sd7", "maps/x.smd");
        assert_eq!(
            ArchiveArgs::from_args(&file).expect("valid argv"),
            ArchiveArgs {
                archive: "Map.sd7".into(),
                file: Some("maps/x.smd".into()),
                extract: None,
            }
        );

        let extract = build_archive_extract_args(
            "/eng/libunitsync.so",
            "/data",
            "Map.sd7",
            "maps/x.smd",
            "/out/x.smd",
        );
        assert_eq!(
            ArchiveArgs::from_args(&extract).expect("valid argv"),
            ArchiveArgs {
                archive: "Map.sd7".into(),
                file: Some("maps/x.smd".into()),
                extract: Some("/out/x.smd".into()),
            }
        );
    }

    #[test]
    fn build_unit_buildpics_args_carry_game_units_and_cache_dir() {
        use coilbox_unitsync_worker::UnitBuildpicsArgs;

        let a = build_unit_buildpics_args(
            "/eng/libunitsync.so",
            "/data",
            "BAR.sdd",
            &["armcom".into(), "corcom".into()],
            Some("/cache/buildpics"),
            None,
        );
        assert!(a.contains(&"--unit-buildpics".to_string()));
        let recovered = UnitBuildpicsArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            UnitBuildpicsArgs {
                game: "BAR.sdd".into(),
                units: vec!["armcom".into(), "corcom".into()],
                cache_dir: Some("/cache/buildpics".into()),
                asset_dir: None,
            }
        );

        let without =
            build_unit_buildpics_args("/eng/libunitsync.so", "/data", "BAR.sdd", &[], None, None);
        assert!(without.contains(&"--unit-buildpics".to_string()));
        assert!(!without.iter().any(|x| x == "--cache-dir"));
        let recovered = UnitBuildpicsArgs::from_args(&without).expect("valid argv");
        assert_eq!(recovered.cache_dir, None);
        assert_eq!(recovered.units, Vec::<String>::new());
    }

    /// The hub's build pic asset is opt-in, so the callers that only want the
    /// icon never pay for an encode (issue #1636). What `to_args` writes,
    /// `from_args` reads back whole either way.
    #[test]
    fn build_unit_buildpics_args_only_write_assets_when_asked() {
        use coilbox_unitsync_worker::UnitBuildpicsArgs;

        let icons_only = build_unit_buildpics_args(
            "/eng/libunitsync.so",
            "/data",
            "BAR.sdd",
            &["armcom".into()],
            Some("/cache/buildpics"),
            None,
        );
        assert!(!icons_only.iter().any(|x| x == "--asset-dir"));
        assert_eq!(
            UnitBuildpicsArgs::from_args(&icons_only)
                .expect("valid argv")
                .asset_dir,
            None
        );

        let with_assets = build_unit_buildpics_args(
            "/eng/libunitsync.so",
            "/data",
            "BAR.sdd",
            &["armcom".into()],
            Some("/cache/buildpics"),
            Some("/cache/hub-assets"),
        );
        assert_eq!(
            UnitBuildpicsArgs::from_args(&with_assets)
                .expect("valid argv")
                .asset_dir,
            Some("/cache/hub-assets".into())
        );
    }

    /// What `build_faction_logos_args` writes, the worker's own `from_args`
    /// reads back whole. A test that only checks a flag landed somewhere in
    /// the argv cannot catch the sidecar and the worker disagreeing about
    /// the mode's fields, and this one can (issue #2448).
    #[test]
    fn build_faction_logos_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::FactionLogosArgs;

        let a = build_faction_logos_args(
            "/eng/libunitsync.so",
            "/data",
            "BAR.sdd",
            &["Armada".into(), "Cortex".into()],
            Some("/cache/logos"),
        );
        assert!(a.contains(&"--faction-logos".to_string()));
        let recovered = FactionLogosArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            FactionLogosArgs {
                game: "BAR.sdd".into(),
                sides: vec!["Armada".into(), "Cortex".into()],
                cache_dir: Some("/cache/logos".into()),
            }
        );

        let without =
            build_faction_logos_args("/eng/libunitsync.so", "/data", "BAR.sdd", &[], None);
        assert!(!without.iter().any(|x| x == "--cache-dir"));
        let recovered = FactionLogosArgs::from_args(&without).expect("valid argv");
        assert_eq!(recovered.cache_dir, None);
    }

    /// What `build_unit_dataset_args` writes, the worker's own `from_args`
    /// reads back whole. A test that only checks a flag landed somewhere in
    /// the argv cannot catch the sidecar and the worker disagreeing about
    /// the mode's fields, and this one can (issue #2448).
    #[test]
    fn build_unit_dataset_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::UnitDatasetArgs;

        let a = build_unit_dataset_args(
            "/eng/libunitsync.so",
            "/data",
            "BAR.sdd",
            Some("/cache/info"),
        );
        assert!(a.contains(&"--unit-dataset".to_string()));
        let recovered = UnitDatasetArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            UnitDatasetArgs {
                game: "BAR.sdd".into(),
                cache_dir: Some("/cache/info".into()),
            }
        );

        let without = build_unit_dataset_args("/eng/libunitsync.so", "/data", "BAR.sdd", None);
        assert!(without.contains(&"--unit-dataset".to_string()));
        assert!(!without.iter().any(|x| x == "--cache-dir"));
        let recovered = UnitDatasetArgs::from_args(&without).expect("valid argv");
        assert_eq!(recovered.cache_dir, None);
    }

    /// What `build_unit_model_args` writes, the worker's own `from_args`
    /// reads back whole. A test that only checks a flag landed somewhere in
    /// the argv cannot catch the sidecar and the worker disagreeing about
    /// the mode's fields, and this one can (issue #2448).
    #[test]
    fn build_unit_model_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::UnitModelArgs;

        let a = build_unit_model_args(
            "/eng/libunitsync.so",
            "/data",
            "BA.sdz",
            "ARMCOM",
            Some("/cache/models"),
        );
        assert!(a.contains(&"--unit-model".to_string()));
        let recovered = UnitModelArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            UnitModelArgs {
                game: "BA.sdz".into(),
                object: "ARMCOM".into(),
                cache_dir: Some("/cache/models".into()),
            }
        );
    }

    /// What `build_unit_script_args` writes, the worker's own `from_args`
    /// reads back whole. A test that only checks a flag landed somewhere in
    /// the argv cannot catch the sidecar and the worker disagreeing about
    /// the mode's fields, and this one can (issue #2448).
    #[test]
    fn build_unit_script_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::UnitScriptArgs;

        let a = build_unit_script_args("/eng/libunitsync.so", "/data", "BAR.sdd", "armcom");
        assert!(a.contains(&"--unit-script".to_string()));
        let recovered = UnitScriptArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            UnitScriptArgs {
                game: "BAR.sdd".into(),
                unit: "armcom".into(),
            }
        );
    }

    /// The whole point of sharing `UnitModelsArgs` with the worker: what
    /// `build_unit_models_args` writes, the worker's own `from_args` reads
    /// back whole. A test that only checks a flag appears at some position
    /// cannot catch the sidecar and the worker disagreeing about the mode's
    /// fields, and this one can (issue #2448).
    #[test]
    fn build_unit_models_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::UnitModelsArgs;

        let expected = UnitModelsArgs {
            game: "BAR.sdd".into(),
            units_file: "/tmp/objects.json".into(),
            cache_dir: "/cache/models".into(),
        };
        let a = build_unit_models_args(
            "/eng/libunitsync.so",
            "/data",
            &expected.game,
            &expected.units_file,
            &expected.cache_dir,
        );
        assert!(
            a.contains(&"--lib".to_string()),
            "the shared lib/datadir args are still prepended"
        );
        assert!(!a.contains(&"--unit-model".to_string()));
        let recovered = UnitModelsArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, expected);
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

    /// The whole point of sharing `UnitRenderKeysArgs` with the worker: what
    /// `build_unit_render_keys_args` writes, the worker's own `from_args`
    /// reads back whole. A test that only checks a flag appears at some
    /// position cannot catch the sidecar and the worker disagreeing about the
    /// mode's fields, and this one can (issue #2448).
    #[test]
    fn build_unit_render_keys_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::UnitRenderKeysArgs;

        let expected = UnitRenderKeysArgs {
            game: "BAR.sdd".into(),
            units_file: "/tmp/units.json".into(),
            angles: vec!["top".into(), "angled".into()],
            renderer_version: 1,
        };
        let a = build_unit_render_keys_args(
            "/eng/libunitsync.so",
            "/data",
            &expected.game,
            &expected.units_file,
            &expected.angles,
            expected.renderer_version,
        );
        assert!(
            a.contains(&"--lib".to_string()),
            "the shared lib/datadir args are still prepended"
        );
        // Nothing is drawn or written, so neither belongs on this call.
        assert!(!a.contains(&"--pixels".to_string()));
        assert!(!a.contains(&"--asset-dir".to_string()));
        let recovered = UnitRenderKeysArgs::from_args(&a).expect("valid argv");
        assert_eq!(recovered, expected);

        // No angles named is how a caller says every angle, so the flag has to
        // be absent rather than empty, and that has to round trip too (issue
        // #1951): an empty `--angles` would key nothing at all and read to the
        // caller as the hub already holding every picture.
        let none_named = UnitRenderKeysArgs {
            angles: Vec::new(),
            ..expected.clone()
        };
        let b = build_unit_render_keys_args(
            "/eng/libunitsync.so",
            "/data",
            &none_named.game,
            &none_named.units_file,
            &none_named.angles,
            none_named.renderer_version,
        );
        assert!(!b.contains(&"--angles".to_string()));
        assert_eq!(
            UnitRenderKeysArgs::from_args(&b).expect("valid argv"),
            none_named
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

    /// What `build_lua_args` writes, the worker's own `from_args` reads back
    /// whole. A test that only checks a flag landed somewhere in the argv
    /// cannot catch the sidecar and the worker disagreeing about the mode's
    /// fields, and this one can (issue #2448).
    #[test]
    fn build_lua_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::LuaArgs;

        let a = build_lua_args("/eng/libunitsync.so", "/data", "Map v1", "/tmp/x.lua");
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
        let recovered = LuaArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            LuaArgs {
                archive: "Map v1".into(),
                source_file: Some("/tmp/x.lua".into()),
                chunks_file: None,
            }
        );
    }

    /// The REPL replay shape carries `--chunks-file` instead of
    /// `--source-file`, and that has to round trip too (issue #2448).
    #[test]
    fn build_lua_repl_args_round_trips_through_the_worker_s_own_parser() {
        use coilbox_unitsync_worker::LuaArgs;

        let a = build_lua_repl_args("/eng/libunitsync.so", "/data", "Map v1", "/tmp/c.json");
        let recovered = LuaArgs::from_args(&a).expect("valid argv");
        assert_eq!(
            recovered,
            LuaArgs {
                archive: "Map v1".into(),
                source_file: None,
                chunks_file: Some("/tmp/c.json".into()),
            }
        );
    }
}
