//! `coilbox-unitsync-worker` — a one-shot worker that loads an engine's
//! `libunitsync`, scans a content root in a single `Init` session, and prints one
//! JSON document describing its maps, games, and the archives they come from.
//!
//! It runs out-of-process precisely because unitsync is an unstable global C
//! singleton that can `abort()`/`exit()` on a malformed archive — here that only
//! kills this throwaway process, which the parent reads as a failed scan.
//!
//! unitsync's state (VFS, opened archives, the info/archive accessor buffers)
//! lives for one `Init` and resets between processes, so we deliberately do
//! everything in a single pass: `Init` once, enumerate maps and games and their
//! archives, `UnInit`, emit, exit.
//!
//! Usage: `coilbox-unitsync-worker --lib <libunitsync.*> --datadir <content-root>`

mod archive;
mod assetencode;
mod buildpic;
mod config;
mod dataset;
mod factionlogo;
mod ffi;
mod game;
mod heightfield;
mod heightmap;
mod infocache;
mod lua;
mod mapcatalog;
mod mapmeta;
mod metalmap;
mod metalspots;
mod minimap;
mod model;
mod pcx;
mod renderkey;
mod seed;
mod skirmishai;
mod smf;
mod texture;
mod typemap;
mod unitmodel;
mod unitmodels;
mod unitrender;
mod unitscriptfile;

use ffi::Unitsync;
use model::{Archive, ConfigOption, GameItem, MapItem, OptionListItem, ScanOutput};
use std::path::Path;

const LIST_SEP: char = if cfg!(windows) { ';' } else { ':' };

/// Parsed CLI: always a lib + data dir. `--map` switches to single-minimap mode;
/// `--thumbnails` switches to batch-thumbnail mode; otherwise it's a full scan.
struct Args {
    lib: String,
    datadir: String,
    map: Option<String>,
    game: Option<String>,
    archive: Option<String>,
    file: Option<String>,
    /// Destination path for `--extract` (download one member to disk).
    extract: Option<String>,
    thumbnails: bool,
    /// `--heightmap`: render one map's height infomap as a downscaled preview
    /// PNG, and with `--asset-dir` also store the full resolution 16 bit samples
    /// as the hub's asset.
    heightmap: bool,
    /// `--height-field`: write one map's raw 16 bit heights to the cache, for
    /// the terrain check to read without a PNG in the way (issue #1490).
    height_field: bool,
    /// `--metalmap`: render one map's metal infomap as an RGBA overlay PNG, and
    /// with `--asset-dir` also store the raw density as the hub's asset.
    metalmap: bool,
    /// `--typemap`: store one map's terrain-type infomap as the hub's asset.
    /// Needs `--asset-dir`: nothing in coilbox draws a type map, so there is no
    /// other output for this mode to produce.
    typemap: bool,
    /// `--map-catalog`: assemble a map's facts into the entry the hub takes.
    /// With `--map`, one map. Without it, the whole installed library.
    map_catalog: bool,
    /// `--keys-only`: on a `--map-catalog` library walk, read each map's archive
    /// and hash it and stop there, which is what a have check compares on. The
    /// rest costs a whole height grid a map, and most of a library is maps the
    /// hub already holds (issue #1737).
    keys_only: bool,
    /// A JSON file of map names for a `--map-catalog` library walk, which is how
    /// the second pass is told which maps the hub asked for. A file rather than
    /// an argument because three thousand map names is past what Windows takes
    /// on a command line.
    maps_file: Option<String>,
    /// `--map-info`: lazily read one map's options (combined with `--map`).
    map_info: bool,
    /// `--map-meta`: batch-read every map's mapinfo metadata in one Init.
    map_meta: bool,
    /// `--map-skybox`: read one map's `atmosphere.skyBox` DDS (combined with `--map`).
    map_skybox: bool,
    config: bool,
    /// `--config-set`: write one curated engine setting (with `--config-key` and
    /// `--config-value`) back to `springsettings.cfg` via `SetSpringConfig*`.
    config_set: bool,
    config_key: Option<String>,
    config_value: Option<String>,
    /// `--skirmish-ais`: list native skirmish AIs (+ a game's Lua AIs when
    /// combined with `--game`).
    skirmish_ais: bool,
    /// `--game-headers`: batch-resolve every game's header art in one Init.
    game_headers: bool,
    /// `--unit-buildpics`: resolve start-unit build icons for `--game`, for the
    /// units listed in `--units` (comma-separated).
    unit_buildpics: bool,
    /// `--unit-dataset`: read `--game`'s reusable unit graph (units + their
    /// `buildoptions` edges), for the build-tree viewer and unit filters.
    unit_dataset: bool,
    /// `--unit-model`: read one unit's model out of `--game`, named by the
    /// unitdef `objectname` given in `--object`.
    unit_model: bool,
    /// `--unit-models`: read a batch of units' models out of `--game` in one
    /// mount, named by the `objectname`s in `--units-file`, and write each into
    /// `--cache-dir`.
    unit_models: bool,
    /// `--unit-script`: find and read `--unit`'s animation script inside
    /// `--game`, following the unit script framework's own resolution order.
    unit_script: bool,
    /// `--unit-render`: encode a top down render the webview drew as the hub's
    /// `render:<angle>` asset. Takes the pixels in `--pixels`, the frame in
    /// `--width`/`--height`/`--footprint-x`/`--footprint-z`, and the unit in
    /// `--game`/`--object`. Needs `--asset-dir`, since the file is the output.
    unit_render: bool,
    /// What a `--unit-render` was drawn from, for a caller that already holds it
    /// from `--unit-render-keys` (issue #1720). All three or none: given, the
    /// game's archive set is not mounted at all, and a caller that gives two of
    /// them has a wiring bug rather than a fast path.
    model_digest: Option<String>,
    source_member: Option<String>,
    source_archive: Option<String>,
    /// `--unit-render-keys`: what a batch of units' renders would be called,
    /// without drawing any of them. Takes the units in `--units-file`, the angles
    /// in `--angles` and the renderer in `--renderer-version`.
    unit_render_keys: bool,
    /// A JSON file of `{ unit, object, footprintX, footprintZ }` for
    /// `--unit-render-keys`, or of `objectname` strings for `--unit-models`. A
    /// file rather than an argument because a whole game's roster is past what
    /// Windows takes on a command line.
    units_file: Option<String>,
    /// The render angle for `--unit-render`, without the `render:` prefix.
    /// Defaults to the plan, which is the vocabulary's first.
    angle: Option<String>,
    /// The render angles for `--unit-render-keys`, comma separated and without
    /// the `render:` prefix. Defaults to every angle the vocabulary lists, since
    /// the mount they share is the cost.
    angles: Option<Vec<String>>,
    /// A file of raw RGBA pixels for `--unit-render`, top row first.
    pixels: Option<String>,
    /// The render's pixel dimensions, which have to be what the footprint frames
    /// to.
    width: u32,
    height: u32,
    footprint_x: u32,
    footprint_z: u32,
    /// Which renderer drew the pixels, for the render's `source_hash`.
    renderer_version: u32,
    object: Option<String>,
    /// `--unit`: one unit definition's own key, for `--unit-script`. Not the
    /// `objectname` the model reads: a script is named by the definition and a
    /// model by the field inside it, and the two are often different words.
    unit: Option<String>,
    units: Vec<String>,
    /// `--faction-logos`: resolve `Sidepics/<side>` emblems for `--game`, for the
    /// side names listed in `--sides` (comma-separated).
    faction_logos: bool,
    sides: Vec<String>,
    /// `--lua`: run a Lua snippet through the parser against `--archive`, reading
    /// the script from `--source-file`.
    lua: bool,
    source_file: Option<String>,
    /// `--chunks-file`: a JSON array of Lua chunks for REPL replay mode
    /// (combined with `--lua`), an alternative to a single `--source-file`.
    chunks_file: Option<String>,
    mip: i32,
    /// Longest-side pixel cap for the metal map PNG downscale (metalmap mode).
    /// The height picture takes its cap from the shared vocabulary instead.
    max_side: u32,
    /// Directory for the on-disk minimap/thumbnail PNG cache (minimap modes only).
    cache_dir: Option<String>,
    /// `--asset-dir`: where to write encoded hub assets. Set only when something
    /// intends to upload them, since the pictures the app itself draws come back
    /// in the JSON and need no file.
    asset_dir: Option<String>,
    /// `--seed`: walk the whole library and write the hub's seed corpus into
    /// `--asset-dir`, with a manifest describing every file.
    seed: bool,
    /// `--dry-run`: report what a mode would write without writing it.
    dry_run: bool,
}

fn main() {
    std::process::exit(run());
}

fn run() -> i32 {
    let mut args = match parse_args() {
        Ok(v) => v,
        Err(e) => {
            emit_error(e);
            return 1;
        }
    };

    // Every path the caller gave is resolved against the directory it ran from,
    // before the chdir below moves us into the engine's (issue #1653). Without
    // this a relative `--asset-dir assets` writes into the engine directory,
    // which is nobody's idea of where they asked for it.
    absolutize(&mut args);

    // unitsync reads SPRING_DATADIR via getenv inside Init, so setting it now
    // points the scan at the chosen content root. The loader-path var helps the
    // dynamic loader find libunitsync's own sibling libraries in the engine dir.
    std::env::set_var("SPRING_DATADIR", &args.datadir);
    if let Some(dir) = Path::new(&args.lib).parent() {
        prepend_loader_path(dir);
        // Best-effort: lets dependents that resolve relative to CWD load too.
        let _ = std::env::set_current_dir(dir);
    }

    let cache_dir = args.cache_dir.as_deref().map(Path::new);

    // Lua console: mount one archive and run a user snippet through the parser.
    if args.lua {
        let archive = args.archive.clone().unwrap_or_default();
        // REPL replay mode: `--chunks-file` holds a JSON array of session chunks.
        if let Some(p) = args.chunks_file.as_deref() {
            let chunks: Vec<String> = match std::fs::read_to_string(p) {
                Ok(s) => match serde_json::from_str(&s) {
                    Ok(c) => c,
                    Err(e) => {
                        lua::emit_repl_error(format!("could not parse chunks file {p}: {e}"));
                        return 1;
                    }
                },
                Err(e) => {
                    lua::emit_repl_error(format!("could not read chunks file {p}: {e}"));
                    return 1;
                }
            };
            return match std::panic::catch_unwind(|| lua::run_repl(&args.lib, &archive, &chunks)) {
                Ok(out) => {
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    0
                }
                Err(_) => {
                    lua::emit_repl_error("worker panicked while executing Lua".into());
                    1
                }
            };
        }
        let source = match args.source_file.as_deref() {
            Some(p) => match std::fs::read_to_string(p) {
                Ok(s) => s,
                Err(e) => {
                    lua::emit_error(format!("could not read source file {p}: {e}"));
                    return 1;
                }
            },
            None => String::new(),
        };
        return match std::panic::catch_unwind(|| lua::run(&args.lib, &archive, &source)) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                lua::emit_error("worker panicked while executing Lua".into());
                1
            }
        };
    }

    // Seed corpus: every map layer and every game's build pics, in one Init.
    // Checked first because it takes no --map or --game of its own and writes
    // for all of them.
    if args.seed {
        let Some(root) = args.asset_dir.clone() else {
            seed::emit_error("--seed needs --asset-dir <directory>".into());
            return 1;
        };
        let dry_run = args.dry_run;
        return match std::panic::catch_unwind(|| {
            seed::run(&args.lib, Path::new(&root), cache_dir, dry_run)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                seed::emit_error("worker panicked while walking the library".into());
                1
            }
        };
    }

    // Batch thumbnails: a small minimap for every map in one Init.
    if args.thumbnails {
        return match std::panic::catch_unwind(|| {
            minimap::render_all(&args.lib, args.mip, cache_dir)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                let out = model::ThumbnailsOutput {
                    errors: vec!["worker panicked while rendering thumbnails".into()],
                    ..Default::default()
                };
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                1
            }
        };
    }

    // Batch map metadata: every map's mapinfo in one Init, disk-cached per map.
    // Checked before the --map modes because it takes no --map of its own.
    if args.map_meta {
        return match std::panic::catch_unwind(|| mapmeta::read_all(&args.lib, cache_dir)) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                let out = model::MapMetaOutput {
                    errors: vec!["worker panicked while reading map metadata".into()],
                    ..Default::default()
                };
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                1
            }
        };
    }

    // Batch game headers: resolve every game's loadpicture art in one Init, for
    // the Games grid. Keyed on cheap file identity (not sync-checksum).
    if args.game_headers {
        return match std::panic::catch_unwind(|| archive::game_headers(&args.lib, cache_dir)) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                let out = model::GameHeadersOutput {
                    errors: vec!["worker panicked while resolving game headers".into()],
                    ..Default::default()
                };
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                1
            }
        };
    }

    // Unit build icons: resolve start-unit build pics for one game in one Init,
    // disk-cached like game headers. Checked before the --game modes because it
    // also keys off --game.
    if args.unit_buildpics {
        let game_archive = args.game.clone().unwrap_or_default();
        let units = args.units.clone();
        let asset_dir = args.asset_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| {
            buildpic::render(&args.lib, &game_archive, &units, cache_dir, asset_dir)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                buildpic::emit_error("worker panicked while resolving unit build pics".into());
                1
            }
        };
    }

    // Faction logos: resolve each side's `Sidepics/<side>` emblem for one game in
    // one Init, disk-cached like build pics. Keys off --game, so checked before the
    // --game modes.
    if args.faction_logos {
        let game_archive = args.game.clone().unwrap_or_default();
        let sides = args.sides.clone();
        return match std::panic::catch_unwind(|| {
            factionlogo::render(&args.lib, &game_archive, &sides, cache_dir)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                factionlogo::emit_error("worker panicked while resolving faction logos".into());
                1
            }
        };
    }

    // Unit dataset: read one game's reusable unit graph (units + buildoptions
    // edges) in one Init, disk-cached like game info. Checked before the --game
    // game-detail mode because it also keys off --game.
    if args.unit_dataset {
        let game_archive = args.game.clone().unwrap_or_default();
        return match std::panic::catch_unwind(|| {
            dataset::render(&args.lib, &game_archive, cache_dir)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                dataset::emit_error("worker panicked while reading unit dataset".into());
                1
            }
        };
    }

    // Unit model: read one unit's model out of a game's archive and flatten it
    // for the viewer. Keys off --game, so checked before the --game modes.
    if args.unit_model {
        let game_archive = args.game.clone().unwrap_or_default();
        let object = args.object.clone().unwrap_or_default();
        return match std::panic::catch_unwind(|| {
            unitmodel::render(&args.lib, &game_archive, &object, cache_dir)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                unitmodel::emit_error("worker panicked while reading a unit model".into());
                1
            }
        };
    }

    // Unit script: find and read one unit's animation script inside a game.
    // Keys off --game like the model read above, and names the unit by its
    // definition key rather than by a path, because the script name is a
    // definition field the game may compute.
    if args.unit_script {
        let game_archive = args.game.clone().unwrap_or_default();
        let unit = args.unit.clone().unwrap_or_default();
        return match std::panic::catch_unwind(|| {
            unitscriptfile::render(&args.lib, &game_archive, &unit)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                unitscriptfile::emit_error("worker panicked while reading a unit script".into());
                1
            }
        };
    }

    // Unit models: the same read for a batch of units in one mount (issue
    // #1684). The cache directory is the output, so there is nothing to do
    // without one.
    if args.unit_models {
        let Some(units_file) = args.units_file.clone() else {
            unitmodels::emit_error("--unit-models needs --units-file <json>".into());
            return 1;
        };
        let Some(cache_dir) = cache_dir else {
            unitmodels::emit_error("--unit-models needs --cache-dir <directory>".into());
            return 1;
        };
        let objects: Vec<String> = match std::fs::read_to_string(&units_file)
            .map_err(|e| format!("could not read units file {units_file}: {e}"))
            .and_then(|raw| {
                serde_json::from_str(&raw)
                    .map_err(|e| format!("could not parse units file {units_file}: {e}"))
            }) {
            Ok(v) => v,
            Err(e) => {
                unitmodels::emit_error(e);
                return 1;
            }
        };
        let game_archive = args.game.clone().unwrap_or_default();
        return match std::panic::catch_unwind(|| {
            unitmodels::render(&args.lib, &game_archive, &objects, cache_dir)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                unitmodels::emit_error("worker panicked while reading unit models".into());
                1
            }
        };
    }

    // Unit render: encode pixels the webview drew as the hub's render asset.
    // Keys off --game like the modes above, so it is checked before them. The
    // asset directory is the whole output, so there is nothing to do without one.
    if args.unit_render {
        let Some(asset_dir) = args.asset_dir.clone() else {
            unitrender::emit_error("--unit-render needs --asset-dir <directory>".into());
            return 1;
        };
        let Some(pixels) = args.pixels.clone() else {
            unitrender::emit_error("--unit-render needs --pixels <file of RGBA>".into());
            return 1;
        };
        let game_archive = args.game.clone().unwrap_or_default();
        let object = args.object.clone().unwrap_or_default();
        let angle = args
            .angle
            .clone()
            .unwrap_or_else(|| coilbox_assets::vocabulary().unit.render_angles[0].clone());
        let source = match render_source(&args) {
            Ok(source) => source,
            Err(why) => {
                unitrender::emit_error(why);
                return 1;
            }
        };
        let req = unitrender::RenderRequest {
            game_archive: &game_archive,
            object_name: &object,
            angle: &angle,
            footprint_x: args.footprint_x,
            footprint_z: args.footprint_z,
            renderer_version: args.renderer_version,
            pixels: Path::new(&pixels),
            width: args.width,
            height: args.height,
            asset_dir: Path::new(&asset_dir),
            source,
        };
        return match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            unitrender::render(&args.lib, &req)
        })) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                unitrender::emit_error("worker panicked while encoding a unit render".into());
                1
            }
        };
    }

    // Unit render keys: what a batch of units' renders would be called, without
    // drawing any of them. Keys off --game like the render mode, so it is
    // checked alongside them.
    if args.unit_render_keys {
        let Some(units_file) = args.units_file.clone() else {
            renderkey::emit_error("--unit-render-keys needs --units-file <json>".into());
            return 1;
        };
        let requests: Vec<model::UnitRenderKeyRequest> = match std::fs::read_to_string(&units_file)
            .map_err(|e| format!("could not read units file {units_file}: {e}"))
            .and_then(|raw| {
                serde_json::from_str(&raw)
                    .map_err(|e| format!("could not parse units file {units_file}: {e}"))
            }) {
            Ok(v) => v,
            Err(e) => {
                renderkey::emit_error(e);
                return 1;
            }
        };
        let game_archive = args.game.clone().unwrap_or_default();
        // Every angle the vocabulary lists unless the caller narrows it, since a
        // batch costs one mount whether it answers for one angle or four
        // (issue #1951).
        let angles = match args.angles.clone() {
            Some(named) => named,
            None => coilbox_assets::vocabulary().unit.render_angles.clone(),
        };
        let renderer_version = args.renderer_version;
        return match std::panic::catch_unwind(|| {
            renderkey::render(
                &args.lib,
                &game_archive,
                &requests,
                &angles,
                renderer_version,
            )
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                renderkey::emit_error("worker panicked while reading unit render keys".into());
                1
            }
        };
    }

    // Archive browsing: list a member tree, read one member for preview, or
    // extract one member to a destination path (download).
    if let Some(archive_name) = args.archive.clone() {
        if let (Some(inner), Some(dest)) = (args.file.clone(), args.extract.clone()) {
            return match std::panic::catch_unwind(|| {
                archive::extract(&args.lib, &archive_name, &inner, &dest)
            }) {
                Ok(out) => {
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    0
                }
                Err(_) => {
                    archive::emit_extract_error(
                        "worker panicked while extracting archive member".into(),
                    );
                    1
                }
            };
        }
        if let Some(inner) = args.file.clone() {
            return match std::panic::catch_unwind(|| {
                archive::file(&args.lib, &archive_name, &inner)
            }) {
                Ok(out) => {
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    0
                }
                Err(_) => {
                    archive::emit_file_error("worker panicked while reading archive member".into());
                    1
                }
            };
        }
        return match std::panic::catch_unwind(|| archive::tree(&args.lib, &archive_name)) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                archive::emit_tree_error("worker panicked while listing archive".into());
                1
            }
        };
    }

    // Skirmish AIs: native engine AIs, plus a game's Lua AIs when --game is
    // given. Checked before game detail because that mode also keys off --game.
    if args.skirmish_ais {
        let game = args.game.clone();
        return match std::panic::catch_unwind(|| skirmishai::render(&args.lib, game.as_deref())) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                skirmishai::emit_error("worker panicked while listing skirmish AIs".into());
                1
            }
        };
    }

    // Game detail: load one game's archives to read its sides + unit count.
    if let Some(game_archive) = args.game.clone() {
        return match std::panic::catch_unwind(|| game::render(&args.lib, &game_archive, cache_dir))
        {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                game::emit_error("worker panicked while reading game info".into());
                1
            }
        };
    }

    // Engine settings: read a curated set of config values (a separate, light
    // unitsync session — no archive scan).
    if args.config {
        return match std::panic::catch_unwind(|| config::render(&args.lib)) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                config::emit_error("worker panicked while reading engine config".into());
                1
            }
        };
    }

    // Engine settings write: set one curated config key via SetSpringConfig*.
    if args.config_set {
        let Some(key) = args.config_key.clone() else {
            config::emit_write_error("--config-set needs --config-key".into());
            return 1;
        };
        let value = args.config_value.clone().unwrap_or_default();
        return match std::panic::catch_unwind(|| config::apply(&args.lib, &key, &value)) {
            Ok(out) => {
                let ok = out.ok;
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                if ok {
                    0
                } else {
                    1
                }
            }
            Err(_) => {
                config::emit_write_error("worker panicked while writing engine config".into());
                1
            }
        };
    }

    // Lazy map info: one map's options + attributed warnings (mounts the map).
    if args.map_info {
        if let Some(map) = args.map.clone() {
            return match std::panic::catch_unwind(|| map_info(&args.lib, &map, cache_dir)) {
                Ok(out) => {
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    0
                }
                Err(_) => {
                    let out = model::MapInfoOutput {
                        errors: vec!["worker panicked while reading map info".into()],
                        ..Default::default()
                    };
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    1
                }
            };
        }
        emit_error("missing --map <name> for --map-info".into());
        return 1;
    }

    // Map skybox: read one map's `atmosphere.skyBox` DDS cube map as raw bytes.
    if args.map_skybox {
        if let Some(map) = args.map.clone() {
            return match std::panic::catch_unwind(|| archive::map_skybox(&args.lib, &map)) {
                Ok(out) => {
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    0
                }
                Err(_) => {
                    archive::emit_skybox_error("worker panicked while reading map skybox".into());
                    1
                }
            };
        }
        emit_error("missing --map <name> for --map-skybox".into());
        return 1;
    }

    // Heightmap: render one map's height infomap to a grayscale PNG data URL.
    if args.heightmap {
        if let Some(map) = args.map.clone() {
            let asset_dir = args.asset_dir.as_deref().map(Path::new);
            return match std::panic::catch_unwind(|| {
                heightmap::render(&args.lib, &map, cache_dir, asset_dir)
            }) {
                Ok(out) => {
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    0
                }
                Err(_) => {
                    heightmap::emit_error("worker panicked while rendering heightmap".into());
                    1
                }
            };
        }
        emit_error("missing --map <name> for --heightmap".into());
        return 1;
    }

    // Height field: write one map's raw heights out for the terrain check.
    if args.height_field {
        if let Some(map) = args.map.clone() {
            return match std::panic::catch_unwind(|| {
                heightfield::render(&args.lib, &map, cache_dir)
            }) {
                Ok(out) => {
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    0
                }
                Err(_) => {
                    heightfield::emit_error("worker panicked while reading heights".into());
                    1
                }
            };
        }
        emit_error("missing --map <name> for --height-field".into());
        return 1;
    }

    // Metalmap: render one map's metal infomap to a green-on-transparent RGBA PNG.
    if args.metalmap {
        if let Some(map) = args.map.clone() {
            let asset_dir = args.asset_dir.as_deref().map(Path::new);
            return match std::panic::catch_unwind(|| {
                metalmap::render(&args.lib, &map, args.max_side, cache_dir, asset_dir)
            }) {
                Ok(out) => {
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    0
                }
                Err(_) => {
                    metalmap::emit_error("worker panicked while rendering metalmap".into());
                    1
                }
            };
        }
        emit_error("missing --map <name> for --metalmap".into());
        return 1;
    }

    // Typemap: store one map's terrain-type infomap as the hub's overlay asset.
    // Asset-only, so a missing --asset-dir is an error rather than a quiet no-op.
    if args.typemap {
        let Some(map) = args.map.clone() else {
            typemap::emit_error("missing --map <name> for --typemap".into());
            return 1;
        };
        let Some(asset_dir) = args.asset_dir.clone() else {
            typemap::emit_error("--typemap needs --asset-dir".into());
            return 1;
        };
        return match std::panic::catch_unwind(|| {
            typemap::render(&args.lib, &map, Path::new(&asset_dir))
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                typemap::emit_error("worker panicked while reading the type map".into());
                1
            }
        };
    }

    // Map catalog: a map's facts in the shape the hub takes. Reads archives
    // rather than drawing anything, so it takes no --asset-dir. With --map it is
    // one map, and without it the whole library in one Init.
    if args.map_catalog {
        if let Some(map) = args.map.clone() {
            return match std::panic::catch_unwind(|| mapcatalog::read(&args.lib, &map, cache_dir)) {
                Ok(out) => {
                    println!("{}", serde_json::to_string(&out).unwrap_or_default());
                    0
                }
                Err(_) => {
                    mapcatalog::emit_error("worker panicked while reading the map's facts".into());
                    1
                }
            };
        }
        let only = match args.maps_file.as_deref() {
            None => None,
            Some(path) => match std::fs::read_to_string(path)
                .map_err(|e| e.to_string())
                .and_then(|text| {
                    serde_json::from_str::<Vec<String>>(&text).map_err(|e| e.to_string())
                }) {
                Ok(names) => Some(names),
                Err(e) => {
                    mapcatalog::emit_walk_error(format!("could not read maps file {path}: {e}"));
                    return 1;
                }
            },
        };
        let keys_only = args.keys_only;
        return match std::panic::catch_unwind(|| {
            mapcatalog::walk(&args.lib, only.as_deref(), keys_only, cache_dir)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                mapcatalog::emit_walk_error("worker panicked while walking the map library".into());
                1
            }
        };
    }

    // Single minimap renders one map; default mode scans everything.
    if let Some(map) = args.map.clone() {
        let asset_dir = args.asset_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| {
            minimap::render(&args.lib, &map, args.mip, cache_dir, asset_dir)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                minimap::emit_error("worker panicked while rendering minimap".into());
                1
            }
        };
    }

    match std::panic::catch_unwind(|| scan(&args.lib)) {
        Ok(Ok(out)) => {
            print_json(&out);
            0
        }
        Ok(Err(e)) => {
            emit_error(e);
            1
        }
        Err(_) => {
            emit_error("worker panicked during unitsync scan".into());
            1
        }
    }
}

/// What `--unit-render` was drawn from, when the caller said (issue #1720).
///
/// All three or none. Two of them is a caller that meant to hand the key down and
/// got it wrong, and quietly mounting the archive instead would hide that behind
/// a slow render nobody would look twice at.
fn render_source(args: &Args) -> Result<Option<unitrender::RenderSource<'_>>, String> {
    match (
        args.model_digest.as_deref(),
        args.source_member.as_deref(),
        args.source_archive.as_deref(),
    ) {
        (None, None, None) => Ok(None),
        (Some(model_digest), Some(source_member), Some(source_archive)) => {
            if [model_digest, source_member, source_archive]
                .iter()
                .any(|v| v.is_empty())
            {
                // An empty digest still hashes, into a `source_hash` naming a
                // picture of nothing that the have check would then key on.
                return Err(
                    "--unit-render was given an empty model digest, source member or \
                            source archive"
                        .into(),
                );
            }
            Ok(Some(unitrender::RenderSource {
                model_digest,
                source_member,
                source_archive,
            }))
        }
        _ => Err(
            "--unit-render takes --model-digest, --source-member and --source-archive together \
             or not at all"
                .into(),
        ),
    }
}

fn parse_args() -> Result<Args, String> {
    let mut lib = None;
    let mut datadir = None;
    let mut map = None;
    let mut game = None;
    let mut archive = None;
    let mut file = None;
    let mut extract = None;
    let mut thumbnails = false;
    let mut heightmap = false;
    let mut height_field = false;
    let mut metalmap = false;
    let mut typemap = false;
    let mut map_catalog = false;
    let mut keys_only = false;
    let mut maps_file = None;
    let mut map_info = false;
    let mut map_meta = false;
    let mut map_skybox = false;
    let mut config = false;
    let mut config_set = false;
    let mut config_key = None;
    let mut config_value = None;
    let mut skirmish_ais = false;
    let mut game_headers = false;
    let mut unit_buildpics = false;
    let mut unit_dataset = false;
    let mut unit_model = false;
    let mut unit_script = false;
    let mut unit_models = false;
    let mut unit_render = false;
    let mut model_digest = None;
    let mut source_member = None;
    let mut source_archive = None;
    let mut unit_render_keys = false;
    let mut units_file = None;
    let mut angle = None;
    let mut angles = None;
    let mut pixels = None;
    let mut width = 0u32;
    let mut height = 0u32;
    let mut footprint_x = 0u32;
    let mut footprint_z = 0u32;
    let mut renderer_version = 0u32;
    let mut object = None;
    let mut unit = None;
    let mut units: Vec<String> = Vec::new();
    let mut faction_logos = false;
    let mut sides: Vec<String> = Vec::new();
    let mut lua = false;
    let mut source_file = None;
    let mut chunks_file = None;
    let mut mip = 1; // 512x512 by default
    let mut max_side = 512u32;
    let mut cache_dir = None;
    let mut asset_dir = None;
    let mut seed = false;
    let mut dry_run = false;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--lib" => lib = it.next(),
            "--datadir" => datadir = it.next(),
            "--map" => map = it.next(),
            "--game" => game = it.next(),
            "--archive" => archive = it.next(),
            "--file" => file = it.next(),
            "--extract" => extract = it.next(),
            "--thumbnails" => thumbnails = true,
            "--heightmap" => heightmap = true,
            "--height-field" => height_field = true,
            "--metalmap" => metalmap = true,
            "--typemap" => typemap = true,
            "--map-catalog" => map_catalog = true,
            "--keys-only" => keys_only = true,
            "--maps-file" => maps_file = it.next(),
            "--map-info" => map_info = true,
            "--map-meta" => map_meta = true,
            "--map-skybox" => map_skybox = true,
            "--max-side" => {
                max_side = it
                    .next()
                    .and_then(|s| s.parse().ok())
                    .ok_or("--max-side needs an integer")?
            }
            "--cache-dir" => cache_dir = it.next(),
            "--asset-dir" => asset_dir = it.next(),
            "--seed" => seed = true,
            "--dry-run" => dry_run = true,
            "--config" => config = true,
            "--config-set" => config_set = true,
            "--config-key" => config_key = it.next(),
            "--config-value" => config_value = it.next(),
            "--skirmish-ais" => skirmish_ais = true,
            "--game-headers" => game_headers = true,
            "--unit-buildpics" => unit_buildpics = true,
            "--unit-dataset" => unit_dataset = true,
            "--unit-model" => unit_model = true,
            "--unit-script" => unit_script = true,
            "--unit-models" => unit_models = true,
            "--unit-render" => unit_render = true,
            "--model-digest" => model_digest = it.next(),
            "--source-member" => source_member = it.next(),
            "--source-archive" => source_archive = it.next(),
            "--unit-render-keys" => unit_render_keys = true,
            "--units-file" => units_file = it.next(),
            "--angle" => angle = it.next(),
            "--angles" => {
                angles = it.next().map(|list| {
                    list.split(',')
                        .map(str::trim)
                        .filter(|a| !a.is_empty())
                        .map(str::to_owned)
                        .collect()
                })
            }
            "--pixels" => pixels = it.next(),
            "--width" => {
                width = it
                    .next()
                    .and_then(|s| s.parse().ok())
                    .ok_or("--width needs an integer")?
            }
            "--height" => {
                height = it
                    .next()
                    .and_then(|s| s.parse().ok())
                    .ok_or("--height needs an integer")?
            }
            "--footprint-x" => {
                footprint_x = it
                    .next()
                    .and_then(|s| s.parse().ok())
                    .ok_or("--footprint-x needs an integer")?
            }
            "--footprint-z" => {
                footprint_z = it
                    .next()
                    .and_then(|s| s.parse().ok())
                    .ok_or("--footprint-z needs an integer")?
            }
            "--renderer-version" => {
                renderer_version = it
                    .next()
                    .and_then(|s| s.parse().ok())
                    .ok_or("--renderer-version needs an integer")?
            }
            "--object" => object = it.next(),
            "--unit" => unit = it.next(),
            "--units" => {
                units = it
                    .next()
                    .map(|s| {
                        s.split(',')
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default()
            }
            "--faction-logos" => faction_logos = true,
            "--sides" => {
                sides = it
                    .next()
                    .map(|s| {
                        s.split(',')
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default()
            }
            "--lua" => lua = true,
            "--source-file" => source_file = it.next(),
            "--chunks-file" => chunks_file = it.next(),
            "--mip" => {
                mip = it
                    .next()
                    .and_then(|s| s.parse().ok())
                    .ok_or("--mip needs an integer")?
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(Args {
        lib: lib.ok_or("missing --lib <path-to-libunitsync>")?,
        datadir: datadir.ok_or("missing --datadir <content-root>")?,
        map,
        game,
        archive,
        file,
        extract,
        thumbnails,
        heightmap,
        height_field,
        metalmap,
        typemap,
        map_catalog,
        keys_only,
        maps_file,
        map_info,
        map_meta,
        map_skybox,
        config,
        config_set,
        config_key,
        config_value,
        skirmish_ais,
        game_headers,
        unit_buildpics,
        unit_dataset,
        unit_model,
        unit_script,
        unit_models,
        unit_render,
        model_digest,
        source_member,
        source_archive,
        unit_render_keys,
        units_file,
        angle,
        angles,
        pixels,
        width,
        height,
        footprint_x,
        footprint_z,
        renderer_version,
        object,
        unit,
        units,
        faction_logos,
        sides,
        lua,
        source_file,
        chunks_file,
        mip,
        max_side,
        cache_dir,
        asset_dir,
        seed,
        dry_run,
    })
}

/// Resolve every caller-supplied path against the current directory, which at
/// this point is still the one the worker was started in.
///
/// `run` chdirs into the engine directory so libunitsync's sibling libraries
/// load, and that happens before any mode reads its paths, so a relative one
/// would land beside the engine rather than beside the caller (issue #1653).
/// The library and data directory are read by unitsync itself and get the same
/// treatment for the same reason.
///
/// Only paths this worker opens or writes are listed. `--config-key`,
/// `--map`, `--game` and `--archive` are unitsync names, not paths.
fn absolutize(args: &mut Args) {
    for path in [
        Some(&mut args.lib),
        Some(&mut args.datadir),
        args.cache_dir.as_mut(),
        args.asset_dir.as_mut(),
        args.extract.as_mut(),
        args.source_file.as_mut(),
        args.chunks_file.as_mut(),
        args.pixels.as_mut(),
        args.units_file.as_mut(),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(abs) = absolute_path(path) {
            *path = abs;
        }
    }
}

/// `path` joined onto the current directory when it is relative, and `None`
/// when it is already absolute or the current directory cannot be read.
///
/// Deliberately not `canonicalize`: an output directory that does not exist yet
/// is the normal case for `--asset-dir`, and canonicalizing it would fail.
fn absolute_path(path: &str) -> Option<String> {
    if Path::new(path).is_absolute() {
        return None;
    }
    let cwd = std::env::current_dir().ok()?;
    Some(cwd.join(path).to_string_lossy().into_owned())
}

/// Prepend `dir` to the platform's shared-library search variable.
fn prepend_loader_path(dir: &Path) {
    let var = if cfg!(target_os = "macos") {
        "DYLD_LIBRARY_PATH"
    } else if cfg!(windows) {
        "PATH"
    } else {
        "LD_LIBRARY_PATH"
    };
    let existing = std::env::var(var).unwrap_or_default();
    let dir = dir.display().to_string();
    let value = if existing.is_empty() {
        dir
    } else {
        format!("{dir}{LIST_SEP}{existing}")
    };
    std::env::set_var(var, value);
}

/// Load unitsync, initialise once, and enumerate everything we render.
fn scan(lib: &str) -> Result<ScanOutput, String> {
    let timings = std::env::var("COILBOX_UNITSYNC_TIMINGS").is_ok();
    let t0 = std::time::Instant::now();
    let us = unsafe { Unitsync::load(Path::new(lib))? };

    let mut errors = Vec::new();
    if us.init(false, 0) == 0 {
        errors.push("unitsync Init returned 0 (failure); results may be empty".into());
    }
    errors.extend(us.drain_errors());
    if timings {
        eprintln!("[unitsync-timing] init={}ms", t0.elapsed().as_millis());
    }

    let sync_version = us.spring_version();

    let tm = std::time::Instant::now();
    let maps = collect_maps(&us);
    if timings {
        eprintln!(
            "[unitsync-timing] maps={} in {}ms",
            maps.len(),
            tm.elapsed().as_millis()
        );
    }

    let tg = std::time::Instant::now();
    let games = collect_games(&us);
    if timings {
        eprintln!(
            "[unitsync-timing] games={} in {}ms",
            games.len(),
            tg.elapsed().as_millis()
        );
    }

    us.uninit();

    Ok(ScanOutput {
        maps,
        games,
        errors,
        sync_version,
    })
}

/// Load one map's archive set and read its options (+ attributed diagnostics).
/// Disk-cached under `cache_dir` (keyed on the map archive's file identity) — a
/// hit skips the costly `GetMapChecksumFromName` whole-archive hash.
fn map_info(lib: &str, map_name: &str, cache_dir: Option<&Path>) -> model::MapInfoOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(us) => us,
        Err(e) => {
            return model::MapInfoOutput {
                errors: vec![e],
                ..Default::default()
            };
        }
    };
    let mut errors = Vec::new();
    if us.init(false, 0) == 0 {
        errors.push("unitsync Init returned 0 (failure)".into());
    }

    // Cheap file-identity cache: a hit returns before the expensive checksum hash.
    let key = infocache::map_key(&us, map_name);
    let cache = cache_dir.zip(key.as_deref());
    if let Some((dir, key)) = cache {
        if let Some(hit) = infocache::read::<model::MapInfoOutput>(dir, key) {
            us.uninit();
            return hit;
        }
    }

    let options = read_options(&us, us.map_option_count(map_name));
    // A zero CRC means "unknown" here, so omit it rather than show a misleading 0.
    let checksum = us
        .map_checksum_from_name(map_name)
        .filter(|&c| c != 0)
        .map(|c| format!("{c:08x}"));
    let warnings = drain_attributed(&us);
    us.uninit();
    let out = model::MapInfoOutput {
        options,
        checksum,
        warnings,
        errors,
    };
    // Only cache a syncable result; leave a failed hash uncached so a retry re-runs.
    if let Some((dir, key)) = cache {
        if out.checksum.is_some() {
            infocache::write(dir, key, &out);
        }
    }
    out
}

/// Drain unitsync's error queue, returning the diagnostics accumulated while
/// processing one map or game (so they can be attached to that item). The
/// expected "no options file" case (maps/games without options, including old
/// TDF maps) is dropped as benign noise.
fn drain_attributed(us: &Unitsync) -> Vec<String> {
    us.drain_errors()
        .into_iter()
        .filter(|e| {
            let lower = e.to_lowercase();
            !(lower.contains("could not open file") && lower.contains("options.lua"))
        })
        .collect()
}

/// Build an [`Archive`]. `GetArchivePath` returns the *containing directory* and
/// only resolves for filename-style archive names (e.g. a game's primary
/// archive), so we join it with the name for the full path and stat that for the
/// size. Display-name archives (maps, dependencies) won't resolve — path/size
/// stay `None`. The checksum is left `None` here — it's SHA512-hashing work,
/// deferred to the lazy per-item detail loaders (game/archive detail).
fn archive(us: &Unitsync, name: String) -> Archive {
    let full = us
        .archive_path(&name)
        .map(|dir| Path::new(&dir).join(&name));
    let size = full.as_deref().and_then(entry_size);
    let path = full.map(|p| p.to_string_lossy().into_owned());
    Archive {
        name,
        path,
        checksum: None,
        size,
    }
}

/// On-disk size of an archive: file length, or recursive total for a `.sdd` dir.
fn entry_size(p: &Path) -> Option<u64> {
    let md = std::fs::metadata(p).ok()?;
    if md.is_dir() {
        Some(dir_size(p))
    } else {
        Some(md.len())
    }
}

fn dir_size(p: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(p) {
        for e in entries.flatten() {
            match e.metadata() {
                Ok(md) if md.is_dir() => total += dir_size(&e.path()),
                Ok(md) => total += md.len(),
                Err(_) => {}
            }
        }
    }
    total
}

/// Build config options from the global table set by the most recent
/// `GetMapOptionCount` / `GetModOptionCount` call, including each option's type,
/// default and (for numbers/lists) bounds/items so the UI can render a proper
/// control. `GetOptionType`: 1 bool, 2 list, 3 number, 4 string, 5 section.
/// Sections are group headers carrying no value; they keep their place in the
/// list so the UI can group the options that name them via `section`.
pub(crate) fn read_options(us: &Unitsync, count: i32) -> Vec<ConfigOption> {
    (0..count)
        .filter_map(|i| {
            let key = us.option_key(i)?;
            let name = us.option_name(i).unwrap_or_else(|| key.clone());
            let description = us.option_desc(i);
            let section = us.option_section(i);
            let mut opt = ConfigOption {
                key,
                name,
                description,
                section,
                ..Default::default()
            };
            match us.option_type(i) {
                1 => {
                    opt.kind = Some("bool".into());
                    opt.default = Some(if us.option_bool_def(i) { "1" } else { "0" }.into());
                }
                2 => {
                    opt.kind = Some("list".into());
                    opt.default = us.option_list_def(i);
                    opt.list_items = us
                        .option_list_items(i)
                        .into_iter()
                        .map(|(key, name)| OptionListItem { key, name })
                        .collect();
                }
                3 => {
                    opt.kind = Some("number".into());
                    opt.default = us.option_number_def(i).map(fmt_num);
                    opt.number_min = us.option_number_min(i);
                    opt.number_max = us.option_number_max(i);
                    opt.number_step = us.option_number_step(i);
                }
                4 => {
                    opt.kind = Some("string".into());
                    opt.default = us.option_string_def(i);
                }
                // A section has no value or default of its own; leaving it
                // untyped made the UI render it as an empty text box.
                5 => opt.kind = Some("section".into()),
                _ => {}
            }
            Some(opt)
        })
        .collect()
}

/// Format a unitsync option float without a trailing `.0` (so `1.0` -> `1`).
fn fmt_num(v: f32) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

fn collect_maps(us: &Unitsync) -> Vec<MapItem> {
    let count = us.map_count();
    let mut maps = Vec::with_capacity(count.max(0) as usize);
    for i in 0..count {
        let Some(name) = us.map_name(i) else {
            continue;
        };
        let archives = us
            .map_archives(&name)
            .into_iter()
            .map(|a| archive(us, a))
            .collect();
        maps.push(MapItem {
            file_name: us.map_file_name(i),
            archives,
            // Proportions come from the thumbnail batch, which already reads them
            // while it has the archive open, and mapinfo from `--map-meta`. Both
            // open every archive at about 86ms a map, so reading them here made
            // the maps list wait on the whole library before showing a name.
            info: Default::default(),
            width: None,
            height: None,
            name: name.clone(),
        });
    }
    maps
}

fn collect_games(us: &Unitsync) -> Vec<GameItem> {
    let count = us.mod_count();
    let mut games = Vec::with_capacity(count.max(0) as usize);
    for i in 0..count {
        let primary_name = us.mod_archive(i).unwrap_or_default();
        let info = us.mod_info(i);
        let name = info
            .get("name")
            .filter(|s| !s.is_empty())
            .cloned()
            .unwrap_or_else(|| primary_name.clone());

        let primary_archive = archive(us, primary_name.clone());
        // The archive list includes the game's own archive — but under its
        // display name (the mod name) rather than its filename, so exclude both
        // forms so a game never lists itself as a dependency.
        let dependency_archives = us
            .mod_archives(i)
            .into_iter()
            .filter(|a| a != &primary_name && a != &name)
            .map(|a| archive(us, a))
            .collect();

        // Drain after the accessors above, so any queued diagnostics attach to
        // this game.
        let warnings = drain_attributed(us);
        games.push(GameItem {
            name: name.clone(),
            primary_archive,
            dependency_archives,
            info,
            warnings,
        });
    }
    games
}

fn emit_error(msg: String) {
    print_json(&ScanOutput {
        errors: vec![msg],
        ..Default::default()
    });
}

fn print_json(out: &ScanOutput) {
    match serde_json::to_string(out) {
        Ok(s) => println!("{s}"),
        Err(e) => eprintln!("failed to serialize unitsync output: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args_with(cache_dir: Option<&str>, asset_dir: Option<&str>) -> Args {
        Args {
            lib: "/engines/one/libunitsync.dylib".into(),
            datadir: "data".into(),
            map: None,
            game: None,
            archive: None,
            file: None,
            extract: None,
            thumbnails: false,
            heightmap: false,
            height_field: false,
            metalmap: false,
            typemap: false,
            map_catalog: false,
            keys_only: false,
            maps_file: None,
            map_info: false,
            map_meta: false,
            map_skybox: false,
            config: false,
            config_set: false,
            config_key: None,
            config_value: None,
            skirmish_ais: false,
            game_headers: false,
            unit_buildpics: false,
            unit_dataset: false,
            unit_model: false,
            unit_models: false,
            unit_render: false,
            model_digest: None,
            source_member: None,
            source_archive: None,
            unit_render_keys: false,
            units_file: None,
            angle: None,
            angles: None,
            pixels: None,
            width: 0,
            height: 0,
            footprint_x: 0,
            footprint_z: 0,
            renderer_version: 0,
            object: None,
            unit: None,
            unit_script: false,
            units: Vec::new(),
            faction_logos: false,
            sides: Vec::new(),
            lua: false,
            source_file: None,
            chunks_file: None,
            mip: 1,
            max_side: 512,
            cache_dir: cache_dir.map(str::to_string),
            asset_dir: asset_dir.map(str::to_string),
            seed: false,
            dry_run: false,
        }
    }

    /// The whole of issue #1653: a relative output directory has to mean the
    /// caller's, and the only chance to say so is before the chdir into the
    /// engine directory.
    #[test]
    fn a_relative_path_resolves_against_the_directory_the_worker_was_run_in() {
        let cwd = std::env::current_dir().expect("cwd");
        let mut args = args_with(Some("cache"), Some("seed/out"));
        absolutize(&mut args);

        assert_eq!(
            args.asset_dir.as_deref(),
            Some(cwd.join("seed/out").to_string_lossy().as_ref())
        );
        assert_eq!(
            args.cache_dir.as_deref(),
            Some(cwd.join("cache").to_string_lossy().as_ref())
        );
        assert_eq!(
            args.datadir,
            cwd.join("data").to_string_lossy().into_owned()
        );
    }

    #[test]
    fn an_absolute_path_is_left_exactly_as_it_was_given() {
        let mut args = args_with(Some("/var/cache"), Some("/var/seed"));
        absolutize(&mut args);
        assert_eq!(args.asset_dir.as_deref(), Some("/var/seed"));
        assert_eq!(args.cache_dir.as_deref(), Some("/var/cache"));
        assert_eq!(args.lib, "/engines/one/libunitsync.dylib");
        assert_eq!(absolute_path("/already/there"), None);
    }

    #[test]
    fn a_path_nobody_gave_stays_absent() {
        let mut args = args_with(None, None);
        absolutize(&mut args);
        assert_eq!(args.asset_dir, None);
        assert_eq!(args.cache_dir, None);
    }

    /// The three fields of a render's identity travel together or not at all
    /// (issue #1720). Two of them is a caller that meant to hand the key down and
    /// mis-wired it, and mounting the archive instead would hide that.
    #[test]
    fn the_handed_down_render_key_is_all_three_fields_or_none() {
        let with = |digest: Option<&str>, member: Option<&str>, archive: Option<&str>| {
            let mut args = args_with(None, None);
            args.model_digest = digest.map(str::to_string);
            args.source_member = member.map(str::to_string);
            args.source_archive = archive.map(str::to_string);
            args
        };

        let none = with(None, None, None);
        assert!(render_source(&none)
            .expect("no key is the mounting path")
            .is_none());

        let all = with(Some("digest"), Some("objects3d/armsolar.s3o"), Some("BAR"));
        let source = render_source(&all)
            .expect("all three is the fast path")
            .expect("a source");
        assert_eq!(source.model_digest, "digest");
        assert_eq!(source.source_member, "objects3d/armsolar.s3o");
        assert_eq!(source.source_archive, "BAR");

        for partial in [
            with(Some("digest"), None, None),
            with(Some("digest"), Some("member"), None),
            with(None, Some("member"), Some("BAR")),
        ] {
            assert!(render_source(&partial).is_err());
        }

        // An empty digest hashes as happily as a real one, into a `source_hash`
        // naming a picture of nothing.
        assert!(render_source(&with(Some(""), Some("member"), Some("BAR"))).is_err());
        assert!(render_source(&with(Some("digest"), Some(""), Some("BAR"))).is_err());
        assert!(render_source(&with(Some("digest"), Some("member"), Some(""))).is_err());
    }
}
