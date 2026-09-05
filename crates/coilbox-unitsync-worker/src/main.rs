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

use coilbox_unitsync_worker::Mode;
use ffi::Unitsync;
use model::{Archive, ConfigOption, GameItem, MapItem, OptionListItem, ScanOutput};
use std::path::Path;

const LIST_SEP: char = if cfg!(windows) { ';' } else { ':' };

/// Parsed CLI: always a lib + data dir. `--map` switches to single-minimap mode;
/// `--thumbnails` switches to batch-thumbnail mode; otherwise it's a full scan.
struct Args {
    lib: String,
    datadir: String,
    /// `--map` alone (typemap's own `--map`, checked ahead of the default
    /// minimap render). `--typemap` is the one mode left with no shared
    /// contract (issue #2517), so this stays a raw field for it.
    map: Option<String>,
    /// A bare `--game` with no other mode flag: game detail. Its field lives
    /// once in `coilbox_unitsync_worker::GameArgs`, shared with the sidecar
    /// plugin that builds this flag's argv (issue #2448).
    game: Option<Mode>,
    /// `--archive`: browse, preview or extract one archive's member. Its
    /// fields live once in `coilbox_unitsync_worker::ArchiveArgs`, shared
    /// with the sidecar plugin that builds this flag's argv (issue #2448).
    archive: Option<Mode>,
    /// `--thumbnails`: render a small minimap for every installed map in one
    /// Init. Its fields live once in
    /// `coilbox_unitsync_worker::ThumbnailsArgs`, shared with the sidecar
    /// plugin that builds this flag's argv (issue #2448).
    thumbnails: Option<Mode>,
    /// `--heightmap`: render one map's height infomap as a downscaled preview
    /// PNG, and with `--asset-dir` also store the full resolution 16 bit
    /// samples as the hub's asset. Its fields live once in
    /// `coilbox_unitsync_worker::HeightmapArgs`, shared with the sidecar
    /// plugin that builds this flag's argv (issue #2448).
    heightmap: Option<Mode>,
    /// `--height-field`: write one map's raw 16 bit heights to the cache, for
    /// the terrain check to read without a PNG in the way (issue #1490). Its
    /// field lives once in `coilbox_unitsync_worker::HeightFieldArgs`, shared
    /// with the sidecar plugin that builds this flag's argv (issue #2448).
    height_field: Option<Mode>,
    /// `--metalmap`: render one map's metal infomap as an RGBA overlay PNG,
    /// and with `--asset-dir` also store the raw density as the hub's asset.
    /// Its fields live once in `coilbox_unitsync_worker::MetalmapArgs`,
    /// shared with the sidecar plugin that builds this flag's argv (issue
    /// #2448).
    metalmap: Option<Mode>,
    /// `--typemap`: store one map's terrain-type infomap as the hub's asset.
    /// Needs `--asset-dir`: nothing in coilbox draws a type map, so there is no
    /// other output for this mode to produce.
    typemap: bool,
    /// `--map-catalog`: assemble a map's facts into the entry the hub takes.
    /// With `--map`, one map. Without it, the whole installed library,
    /// narrowed by `--maps-file` and stopped at the archive hash alone with
    /// `--keys-only`. Its fields live once in
    /// `coilbox_unitsync_worker::MapCatalogArgs`, shared with the sidecar
    /// plugin that builds this flag's argv (issue #2448).
    map_catalog: Option<Mode>,
    /// `--map-minimaps`: name every installed map's minimap, and with
    /// `--asset-dir` encode it as the hub's `minimap` asset too (issue #2379).
    /// `--maps-file` narrows it to the maps the hub said it wanted. Its
    /// fields live once in `coilbox_unitsync_worker::MapMinimapsArgs`, shared
    /// with the sidecar plugin that builds this flag's argv (issue #2448).
    map_minimaps: Option<Mode>,
    /// `--map-info`: lazily read one map's options (combined with `--map`).
    /// Its field and cross field rule (`--map` is required) live once in
    /// `coilbox_unitsync_worker::MapInfoArgs`, shared with the sidecar plugin
    /// that builds this flag's argv (issue #2448).
    map_info: Option<Mode>,
    /// `--map-meta`: batch-read every map's mapinfo metadata in one Init. Its
    /// field lives once in `coilbox_unitsync_worker::MapMetaArgs`, shared
    /// with the sidecar plugin that builds this flag's argv (issue #2448).
    map_meta: Option<Mode>,
    /// `--map-skybox`: read one map's `atmosphere.skyBox` DDS (combined with
    /// `--map`). Its field and cross field rule (`--map` is required) live
    /// once in `coilbox_unitsync_worker::MapSkyboxArgs`, shared with the
    /// sidecar plugin that builds this flag's argv (issue #2448).
    map_skybox: Option<Mode>,
    /// `--config`: read the curated set of engine settings. Carries no
    /// fields of its own, so `Some` is always `Mode::Config`, shared with the
    /// sidecar plugin only in that the flag itself now comes from
    /// `Mode::to_args` rather than a literal string (issue #2448).
    config: Option<Mode>,
    /// `--config-set`: write one curated engine setting back to
    /// `springsettings.cfg` via `SetSpringConfig*`. Its field (`--config-key`
    /// is required, `--config-value` defaults to empty) lives once in
    /// `coilbox_unitsync_worker::ConfigSetArgs`, shared with the sidecar
    /// plugin that builds this flag's argv (issue #2448).
    config_set: Option<Mode>,
    /// `--skirmish-ais`: list native skirmish AIs (+ a game's Lua AIs when
    /// combined with `--game`). Its field lives once in
    /// `coilbox_unitsync_worker::SkirmishAisArgs`, shared with the sidecar
    /// plugin that builds this flag's argv (issue #2448).
    skirmish_ais: Option<Mode>,
    /// `--game-headers`: batch-resolve every game's header art in one Init.
    /// Its field lives once in `coilbox_unitsync_worker::GameHeadersArgs`,
    /// shared with the sidecar plugin that builds this flag's argv (issue
    /// #2448).
    game_headers: Option<Mode>,
    /// `--unit-buildpics`: resolve start-unit build icons for a game, for the
    /// units listed by name. Its fields live once in
    /// `coilbox_unitsync_worker::UnitBuildpicsArgs`, shared with the sidecar
    /// plugin that builds this flag's argv (issue #2448).
    unit_buildpics: Option<Mode>,
    /// `--unit-dataset`: read a game's reusable unit graph (units + their
    /// `buildoptions` edges), for the build-tree viewer and unit filters. Its
    /// fields live once in `coilbox_unitsync_worker::UnitDatasetArgs`, shared
    /// with the sidecar plugin that builds this flag's argv (issue #2448).
    unit_dataset: Option<Mode>,
    /// `--unit-model`: read one unit's model out of a game, named by the
    /// unitdef `objectname`. Its fields live once in
    /// `coilbox_unitsync_worker::UnitModelArgs`, shared with the sidecar
    /// plugin that builds this flag's argv (issue #2448).
    unit_model: Option<Mode>,
    /// `--unit-models`: read a batch of units' models out of a game in one
    /// mount, named by the `objectname`s in a units file, and write each into
    /// a cache directory. Its fields and cross field rule (both the units
    /// file and the cache directory are required, since there is nothing to
    /// read without the first and nowhere to write without the second) live
    /// once in `coilbox_unitsync_worker::UnitModelsArgs`, shared with the
    /// sidecar plugin that builds this flag's argv (issue #2448).
    unit_models: Option<Mode>,
    /// `--unit-script`: find and read a unit's animation script inside a
    /// game, following the unit script framework's own resolution order. Its
    /// fields live once in `coilbox_unitsync_worker::UnitScriptArgs`, shared
    /// with the sidecar plugin that builds this flag's argv (issue #2448).
    unit_script: Option<Mode>,
    /// `--unit-render`: encode a top down render the webview drew as the hub's
    /// `render:<angle>` asset. Its fields and cross field rules (needs
    /// `--asset-dir`, needs `--pixels`, the render source is all three fields
    /// or none) live once in `coilbox_unitsync_worker::UnitRenderArgs`, shared
    /// with the sidecar plugin that builds this flag's argv (issue #2448).
    unit_render: Option<Mode>,
    /// `--unit-render-keys`: what a batch of units' renders would be called,
    /// without drawing any of them. Its fields and cross field rule (needs
    /// `--units-file`, an absent `--angles` means every angle the vocabulary
    /// lists) live once in `coilbox_unitsync_worker::UnitRenderKeysArgs`,
    /// shared with the sidecar plugin that builds this flag's argv (issue
    /// #2448).
    unit_render_keys: Option<Mode>,
    /// `--faction-logos`: resolve `Sidepics/<side>` emblems for a game, for
    /// the side names listed by name. Its fields live once in
    /// `coilbox_unitsync_worker::FactionLogosArgs`, shared with the sidecar
    /// plugin that builds this flag's argv (issue #2448).
    faction_logos: Option<Mode>,
    /// `--lua`: run a Lua snippet through the parser against an archive, or
    /// replay a JSON array of chunks in REPL mode. Its fields live once in
    /// `coilbox_unitsync_worker::LuaArgs`, shared with the sidecar plugin
    /// that builds this flag's argv (issue #2448).
    lua: Option<Mode>,
    /// A bare `--map` with no other mode flag: the default minimap render.
    /// Its fields live once in `coilbox_unitsync_worker::MinimapArgs`,
    /// shared with the sidecar plugin that builds this flag's argv (issue
    /// #2448).
    minimap: Option<Mode>,
    /// Directory for the on-disk seed-corpus cache (`--seed` only: every
    /// other mode with a cache directory keeps its own copy in its `Mode`
    /// payload).
    cache_dir: Option<String>,
    /// `--asset-dir`: where to write encoded hub assets, for `--seed` and
    /// `--typemap` (the two modes left with no shared contract). Set only
    /// when something intends to upload them, since the pictures the app
    /// itself draws come back in the JSON and need no file.
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
    if let Some(Mode::Lua(mode)) = &args.lua {
        // REPL replay mode: `--chunks-file` holds a JSON array of session chunks.
        if let Some(p) = mode.chunks_file.as_deref() {
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
            return match std::panic::catch_unwind(|| {
                lua::run_repl(&args.lib, &mode.archive, &chunks)
            }) {
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
        let source = match mode.source_file.as_deref() {
            Some(p) => match std::fs::read_to_string(p) {
                Ok(s) => s,
                Err(e) => {
                    lua::emit_error(format!("could not read source file {p}: {e}"));
                    return 1;
                }
            },
            None => String::new(),
        };
        return match std::panic::catch_unwind(|| lua::run(&args.lib, &mode.archive, &source)) {
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
    if let Some(Mode::Thumbnails(mode)) = &args.thumbnails {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| {
            minimap::render_all(&args.lib, mode.mip, cache_dir)
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
    if let Some(Mode::MapMeta(mode)) = &args.map_meta {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
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
    if let Some(Mode::GameHeaders(mode)) = &args.game_headers {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
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
    if let Some(Mode::UnitBuildpics(mode)) = &args.unit_buildpics {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        let asset_dir = mode.asset_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| {
            buildpic::render(&args.lib, &mode.game, &mode.units, cache_dir, asset_dir)
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
    if let Some(Mode::FactionLogos(mode)) = &args.faction_logos {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| {
            factionlogo::render(&args.lib, &mode.game, &mode.sides, cache_dir)
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
    if let Some(Mode::UnitDataset(mode)) = &args.unit_dataset {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| dataset::render(&args.lib, &mode.game, cache_dir))
        {
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
    if let Some(Mode::UnitModel(mode)) = &args.unit_model {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| {
            unitmodel::render(&args.lib, &mode.game, &mode.object, cache_dir)
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
    if let Some(Mode::UnitScript(mode)) = &args.unit_script {
        return match std::panic::catch_unwind(|| {
            unitscriptfile::render(&args.lib, &mode.game, &mode.unit)
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
    // #1684). Both the units file and the cache directory are required, a
    // rule that now lives in `UnitModelsArgs::from_args`, not here.
    if let Some(Mode::UnitModels(mode)) = &args.unit_models {
        let objects: Vec<String> = match std::fs::read_to_string(&mode.units_file)
            .map_err(|e| format!("could not read units file {}: {e}", mode.units_file))
            .and_then(|raw| {
                serde_json::from_str(&raw)
                    .map_err(|e| format!("could not parse units file {}: {e}", mode.units_file))
            }) {
            Ok(v) => v,
            Err(e) => {
                unitmodels::emit_error(e);
                return 1;
            }
        };
        return match std::panic::catch_unwind(|| {
            unitmodels::render(&args.lib, &mode.game, &objects, Path::new(&mode.cache_dir))
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
    if let Some(Mode::UnitRender(mode)) = &args.unit_render {
        let source = mode.source.as_ref().map(|s| unitrender::RenderSource {
            model_digest: &s.model_digest,
            source_member: &s.source_member,
            source_archive: &s.source_archive,
        });
        let req = unitrender::RenderRequest {
            game_archive: &mode.game,
            object_name: &mode.object,
            angle: &mode.angle,
            footprint_x: mode.footprint_x,
            footprint_z: mode.footprint_z,
            renderer_version: mode.renderer_version,
            pixels: Path::new(&mode.pixels),
            width: mode.width,
            height: mode.height,
            asset_dir: Path::new(&mode.asset_dir),
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
    // checked alongside them. Both the units file requirement and the empty
    // `angles` shape now live in `UnitRenderKeysArgs::from_args`, not here.
    if let Some(Mode::UnitRenderKeys(mode)) = &args.unit_render_keys {
        let requests: Vec<model::UnitRenderKeyRequest> =
            match std::fs::read_to_string(&mode.units_file)
                .map_err(|e| format!("could not read units file {}: {e}", mode.units_file))
                .and_then(|raw| {
                    serde_json::from_str(&raw)
                        .map_err(|e| format!("could not parse units file {}: {e}", mode.units_file))
                }) {
                Ok(v) => v,
                Err(e) => {
                    renderkey::emit_error(e);
                    return 1;
                }
            };
        // Every angle the vocabulary lists unless the caller narrows it, since a
        // batch costs one mount whether it answers for one angle or four
        // (issue #1951).
        let angles = if mode.angles.is_empty() {
            coilbox_assets::vocabulary().unit.render_angles.clone()
        } else {
            mode.angles.clone()
        };
        return match std::panic::catch_unwind(|| {
            renderkey::render(
                &args.lib,
                &mode.game,
                &requests,
                &angles,
                mode.renderer_version,
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
    if let Some(Mode::Archive(mode)) = &args.archive {
        if let (Some(inner), Some(dest)) = (mode.file.as_deref(), mode.extract.as_deref()) {
            return match std::panic::catch_unwind(|| {
                archive::extract(&args.lib, &mode.archive, inner, dest)
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
        if let Some(inner) = mode.file.as_deref() {
            return match std::panic::catch_unwind(|| archive::file(&args.lib, &mode.archive, inner))
            {
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
        return match std::panic::catch_unwind(|| archive::tree(&args.lib, &mode.archive)) {
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
    if let Some(Mode::SkirmishAis(mode)) = &args.skirmish_ais {
        let game = mode.game.clone();
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
    if let Some(Mode::Game(mode)) = &args.game {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| game::render(&args.lib, &mode.game, cache_dir)) {
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
    if args.config.is_some() {
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
    // `--config-key` being required now lives in `ConfigSetArgs::from_args`,
    // not here.
    if let Some(Mode::ConfigSet(mode)) = &args.config_set {
        return match std::panic::catch_unwind(|| config::apply(&args.lib, &mode.key, &mode.value)) {
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
    // `--map` being required now lives in `MapInfoArgs::from_args`, not here.
    if let Some(Mode::MapInfo(mode)) = &args.map_info {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| map_info(&args.lib, &mode.map, cache_dir)) {
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

    // Map skybox: read one map's `atmosphere.skyBox` DDS cube map as raw bytes.
    // `--map` being required now lives in `MapSkyboxArgs::from_args`, not here.
    if let Some(Mode::MapSkybox(mode)) = &args.map_skybox {
        return match std::panic::catch_unwind(|| archive::map_skybox(&args.lib, &mode.map)) {
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

    // Heightmap: render one map's height infomap to a grayscale PNG data URL.
    if let Some(Mode::Heightmap(mode)) = &args.heightmap {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        let asset_dir = mode.asset_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| {
            heightmap::render(&args.lib, &mode.map, cache_dir, asset_dir)
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

    // Height field: write one map's raw heights out for the terrain check.
    if let Some(Mode::HeightField(mode)) = &args.height_field {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| {
            heightfield::render(&args.lib, &mode.map, cache_dir)
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

    // Metalmap: render one map's metal infomap to a green-on-transparent RGBA PNG.
    if let Some(Mode::Metalmap(mode)) = &args.metalmap {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        let asset_dir = mode.asset_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| {
            metalmap::render(&args.lib, &mode.map, mode.max_side, cache_dir, asset_dir)
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
    if let Some(Mode::MapCatalog(mode)) = &args.map_catalog {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        if let Some(map) = &mode.map {
            return match std::panic::catch_unwind(|| mapcatalog::read(&args.lib, map, cache_dir)) {
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
        let only = match mode.maps_file.as_deref() {
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
        let keys_only = mode.keys_only;
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

    // Map minimaps: name every map's minimap, and with --asset-dir encode it as
    // the hub's asset too (issue #2379). Both passes of one sweep run through
    // here. The first takes no asset dir and stops at the identity, and the
    // second is given the maps the hub asked for.
    if let Some(Mode::MapMinimaps(mode)) = &args.map_minimaps {
        let only = match mode.maps_file.as_deref() {
            None => None,
            Some(path) => match std::fs::read_to_string(path)
                .map_err(|e| e.to_string())
                .and_then(|text| {
                    serde_json::from_str::<Vec<String>>(&text).map_err(|e| e.to_string())
                }) {
                Ok(names) => Some(names),
                Err(e) => {
                    minimap::emit_assets_error(format!("could not read maps file {path}: {e}"));
                    return 1;
                }
            },
        };
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        let asset_dir = mode.asset_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| {
            minimap::assets(&args.lib, only.as_deref(), cache_dir, asset_dir)
        }) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                minimap::emit_assets_error(
                    "worker panicked while reading the maps' minimaps".into(),
                );
                1
            }
        };
    }

    // Single minimap renders one map. The default mode scans everything.
    if let Some(Mode::Minimap(mode)) = &args.minimap {
        let cache_dir = mode.cache_dir.as_deref().map(Path::new);
        let asset_dir = mode.asset_dir.as_deref().map(Path::new);
        return match std::panic::catch_unwind(|| {
            minimap::render(&args.lib, &mode.map, mode.mip, cache_dir, asset_dir)
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

fn parse_args() -> Result<Args, String> {
    let mut lib = None;
    let mut datadir = None;
    // `--map`'s presence alone (no other mode flag) is what gates
    // `Mode::Minimap` below. `--typemap` still reads this same local
    // directly, since it is the one mode left with no shared contract (issue
    // #2517).
    let mut map = None;
    // `--game`'s presence alone (no other mode flag) is what gates
    // `Mode::Game` below. `Mode::Game`'s own `from_args` re-scans `raw` for
    // its fields, the same treatment `Mode::Minimap`'s below gets (issue
    // #2448).
    let mut game = None;
    // `--archive`'s presence alone is what gates `Mode::Archive` below (or,
    // combined with `--lua`, is `Mode::Lua`'s own field instead). Both
    // `from_args` functions re-scan `raw` for it independently.
    let mut archive = None;
    // `--thumbnails`' own fields (mip, cache directory) are not collected
    // into locals here for its own use: `Mode::Thumbnails`'s `from_args`
    // below re-scans `raw` for those, the same treatment `--heightmap` and
    // its siblings got above (issue #2448).
    let mut thumbnails_flag = false;
    // `--heightmap`'s own fields (map, cache directory, asset directory) are
    // not collected into locals here for its own use: `Mode::Heightmap`'s
    // `from_args` below re-scans `raw` for those, the same treatment
    // `--map-info` and its siblings got above (issue #2448).
    let mut heightmap_flag = false;
    // `--height-field`'s own fields (map, cache directory) are not collected
    // into locals here for its own use, the same treatment as above:
    // `Mode::HeightField`'s `from_args` below re-scans `raw` for those
    // (issue #2448).
    let mut height_field_flag = false;
    // `--metalmap`'s own fields (map, max side, cache directory, asset
    // directory) are not collected into locals here for its own use, the
    // same treatment as above: `Mode::Metalmap`'s `from_args` below re-scans
    // `raw` for those (issue #2448). `--max-side` match arm below stays a
    // shared consuming placeholder rather than a local.
    let mut metalmap_flag = false;
    let mut typemap = false;
    // `--map-catalog`'s own fields (single map, maps file, keys-only,
    // cache directory) are not collected into locals here for its own use:
    // `Mode::MapCatalog`'s `from_args` below re-scans `raw` for those, the
    // same treatment `--unit-models` and its siblings got above (issue
    // #2448). `--keys-only` and `--maps-file` are not shared with any
    // unmigrated mode, so their match arms below only consume the tokens.
    let mut map_catalog_flag = false;
    // `--map-minimaps`' own fields (maps file, cache directory, asset
    // directory) are not collected into locals here for its own use, the
    // same treatment `--map-catalog` got above: `Mode::MapMinimaps`'s
    // `from_args` below re-scans `raw` for those (issue #2448).
    let mut map_minimaps_flag = false;
    // `--map-info`'s own fields (map, cache directory) are not collected
    // into locals here for its own use: `Mode::MapInfo`'s `from_args` below
    // re-scans `raw` for those (issue #2448).
    let mut map_info_flag = false;
    // `--map-meta`'s own field (cache directory) is not collected into a
    // local here for its own use: `Mode::MapMeta`'s `from_args` below
    // re-scans `raw` for it (issue #2448).
    let mut map_meta_flag = false;
    // `--map-skybox`'s own field (map) is not collected into a local here
    // for its own use: `Mode::MapSkybox`'s `from_args` below re-scans `raw`
    // for it (issue #2448).
    let mut map_skybox_flag = false;
    // `--config` has no fields of its own beyond the flag, so there is no
    // local to collect: the match arm below sets this straight to `true`.
    let mut config_flag = false;
    // `--config-set`'s own fields (`--config-key`, `--config-value`) are not
    // collected into locals here for its own use: `Mode::ConfigSet`'s
    // `from_args` below re-scans `raw` for those, the same treatment
    // `--unit-models`, `--unit-render` and `--unit-render-keys` got above
    // (issue #2448). The match arms for those flags below still recognise
    // them, so the shared loop does not reject them as unknown.
    let mut config_set_flag = false;
    // `--skirmish-ais`' own field (game) is not collected into a local here
    // for its own use: `Mode::SkirmishAis`'s `from_args` below re-scans
    // `raw` for it (issue #2448).
    let mut skirmish_ais_flag = false;
    // `--game-headers`' own field (cache directory) is not collected into a
    // local here for its own use: `Mode::GameHeaders`'s `from_args` below
    // re-scans `raw` for it (issue #2448).
    let mut game_headers_flag = false;
    // `--unit-buildpics`' own fields (game, units, cache directory, asset
    // directory) are not collected into locals here for its own use:
    // `Mode::UnitBuildpics`'s `from_args` below re-scans `raw` for those
    // (issue #2448).
    let mut unit_buildpics_flag = false;
    // `--unit-dataset`'s own fields (game, cache directory) are not
    // collected into locals here for its own use: `Mode::UnitDataset`'s
    // `from_args` below re-scans `raw` for those (issue #2448).
    let mut unit_dataset_flag = false;
    // `--unit-model`'s own fields (game, object, cache directory) are not
    // collected into locals here for its own use: `Mode::UnitModel`'s
    // `from_args` below re-scans `raw` for those (issue #2448).
    let mut unit_model_flag = false;
    // `--unit-script`'s own fields (game, unit) are not collected into
    // locals here for its own use: `Mode::UnitScript`'s `from_args` below
    // re-scans `raw` for those (issue #2448).
    let mut unit_script_flag = false;
    // `--unit-models`' own fields (units file, cache directory) are not
    // collected into locals here for its own use: `Mode::UnitModels`'s
    // `from_args` below re-scans `raw` for those, the single place that
    // mode's fields and cross field rule are defined (issue #2448).
    let mut unit_models_flag = false;
    // `--unit-render`'s own flags (angle, footprint, pixels, dimensions, render
    // source) are not collected into locals here: `Mode::UnitRender`'s
    // `from_args` below re-scans `raw` for those, which is the single place
    // that mode's fields and cross field rules are defined (issue #2448). The
    // match arms for those flags below still recognise them, so the shared
    // loop does not reject them as unknown, but their values are otherwise
    // unused here.
    let mut unit_render_flag = false;
    // `--unit-render-keys`' own flags (units file, angles, renderer version)
    // are not collected into locals here for its own use, the same treatment
    // `--unit-models` and `--unit-render` got above: `Mode::UnitRenderKeys`'s
    // `from_args` below re-scans `raw` for those (issue #2448). `--renderer-version`
    // is also `--unit-render`'s own flag, so its match arm below stays a
    // shared consuming placeholder rather than belonging to either mode alone.
    let mut unit_render_keys_flag = false;
    // `--faction-logos`' own fields (game, sides, cache directory) are not
    // collected into locals here for its own use: `Mode::FactionLogos`'s
    // `from_args` below re-scans `raw` for those (issue #2448).
    let mut faction_logos_flag = false;
    // `--lua`'s own fields (archive, source file, chunks file) are not
    // collected into locals here for its own use: `Mode::Lua`'s `from_args`
    // below re-scans `raw` for those (issue #2448).
    let mut lua_flag = false;
    // `--seed`'s cache directory. `Mode::Minimap`'s own `from_args` re-scans
    // `raw` for its own copy, the same treatment `Mode::Thumbnails` and its
    // siblings got above (issue #2448). This local stays because `--seed` is
    // deliberate manual maintainer tooling that has never moved onto `Mode`.
    let mut cache_dir = None;
    // `--seed` and `--typemap`'s asset directory, for the same reason.
    let mut asset_dir = None;
    let mut seed = false;
    let mut dry_run = false;
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let mut it = raw.iter().cloned();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--lib" => lib = it.next(),
            "--datadir" => datadir = it.next(),
            "--map" => map = it.next(),
            "--game" => game = it.next(),
            "--archive" => archive = it.next(),
            // Consumed by `Mode::Archive`'s `from_args` below, not stored
            // here.
            "--file" | "--extract" => {
                it.next();
            }
            "--thumbnails" => thumbnails_flag = true,
            "--heightmap" => heightmap_flag = true,
            "--height-field" => height_field_flag = true,
            "--metalmap" => metalmap_flag = true,
            "--typemap" => typemap = true,
            "--map-catalog" => map_catalog_flag = true,
            // Consumed by `Mode::MapCatalog`'s `from_args` below, not stored
            // here.
            "--keys-only" => {}
            // Consumed by `Mode::MapCatalog`'s and `Mode::MapMinimaps`'s
            // `from_args` below, not stored here.
            "--maps-file" => {
                it.next();
            }
            "--map-minimaps" => map_minimaps_flag = true,
            "--map-info" => map_info_flag = true,
            "--map-meta" => map_meta_flag = true,
            "--map-skybox" => map_skybox_flag = true,
            // Consumed by `Mode::Metalmap`'s `from_args` below, not stored
            // here.
            "--max-side" => {
                it.next();
            }
            "--cache-dir" => cache_dir = it.next(),
            "--asset-dir" => asset_dir = it.next(),
            "--seed" => seed = true,
            "--dry-run" => dry_run = true,
            "--config" => config_flag = true,
            "--config-set" => config_set_flag = true,
            // Consumed by `Mode::ConfigSet`'s `from_args` below, not stored
            // here.
            "--config-key" | "--config-value" => {
                it.next();
            }
            "--skirmish-ais" => skirmish_ais_flag = true,
            "--game-headers" => game_headers_flag = true,
            "--unit-buildpics" => unit_buildpics_flag = true,
            "--unit-dataset" => unit_dataset_flag = true,
            "--unit-model" => unit_model_flag = true,
            "--unit-script" => unit_script_flag = true,
            "--unit-models" => unit_models_flag = true,
            "--unit-render" => unit_render_flag = true,
            // Consumed by `Mode::UnitRender`'s `from_args` below, not stored here.
            "--model-digest" | "--source-member" | "--source-archive" | "--angle" => {
                it.next();
            }
            "--unit-render-keys" => unit_render_keys_flag = true,
            // Consumed by `Mode::UnitRenderKeys`'s `from_args` below, not
            // stored here.
            "--units-file" | "--angles" => {
                it.next();
            }
            // Consumed by `Mode::UnitRender`'s `from_args` below, not stored here.
            "--pixels" | "--width" | "--height" | "--footprint-x" | "--footprint-z" => {
                it.next();
            }
            // `--renderer-version` is `Mode::UnitRender`'s and
            // `Mode::UnitRenderKeys`'s own flag: each re-scans `raw` for it in
            // its own `from_args`, so this arm only has to consume the token.
            "--renderer-version" => {
                it.next();
            }
            // Consumed by `Mode::UnitModel`'s and `Mode::UnitRender`'s
            // `from_args` below, not stored here.
            "--object" => {
                it.next();
            }
            // Consumed by `Mode::UnitScript`'s `from_args` below, not stored
            // here.
            "--unit" => {
                it.next();
            }
            // Consumed by `Mode::UnitBuildpics`'s `from_args` below, not
            // stored here.
            "--units" => {
                it.next();
            }
            "--faction-logos" => faction_logos_flag = true,
            // Consumed by `Mode::FactionLogos`'s `from_args` below, not
            // stored here.
            "--sides" => {
                it.next();
            }
            "--lua" => lua_flag = true,
            // Consumed by `Mode::Lua`'s `from_args` below, not stored here.
            "--source-file" | "--chunks-file" => {
                it.next();
            }
            // Consumed by `Mode::Minimap`'s and `Mode::Thumbnails`'s
            // `from_args` below, not stored here.
            "--mip" => {
                it.next();
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(Args {
        lib: lib.ok_or("missing --lib <path-to-libunitsync>")?,
        datadir: datadir.ok_or("missing --datadir <content-root>")?,
        map: map.clone(),
        game: if game.is_some() {
            Some(Mode::Game(coilbox_unitsync_worker::GameArgs::from_args(
                &raw,
            )?))
        } else {
            None
        },
        archive: if archive.is_some() {
            Some(Mode::Archive(
                coilbox_unitsync_worker::ArchiveArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        thumbnails: if thumbnails_flag {
            Some(Mode::Thumbnails(
                coilbox_unitsync_worker::ThumbnailsArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        heightmap: if heightmap_flag {
            Some(Mode::Heightmap(
                coilbox_unitsync_worker::HeightmapArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        height_field: if height_field_flag {
            Some(Mode::HeightField(
                coilbox_unitsync_worker::HeightFieldArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        metalmap: if metalmap_flag {
            Some(Mode::Metalmap(
                coilbox_unitsync_worker::MetalmapArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        typemap,
        map_catalog: if map_catalog_flag {
            Some(Mode::MapCatalog(
                coilbox_unitsync_worker::MapCatalogArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        map_minimaps: if map_minimaps_flag {
            Some(Mode::MapMinimaps(
                coilbox_unitsync_worker::MapMinimapsArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        map_info: if map_info_flag {
            Some(Mode::MapInfo(
                coilbox_unitsync_worker::MapInfoArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        map_meta: if map_meta_flag {
            Some(Mode::MapMeta(
                coilbox_unitsync_worker::MapMetaArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        map_skybox: if map_skybox_flag {
            Some(Mode::MapSkybox(
                coilbox_unitsync_worker::MapSkyboxArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        config: if config_flag {
            Some(Mode::Config)
        } else {
            None
        },
        config_set: if config_set_flag {
            Some(Mode::ConfigSet(
                coilbox_unitsync_worker::ConfigSetArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        skirmish_ais: if skirmish_ais_flag {
            Some(Mode::SkirmishAis(
                coilbox_unitsync_worker::SkirmishAisArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        game_headers: if game_headers_flag {
            Some(Mode::GameHeaders(
                coilbox_unitsync_worker::GameHeadersArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        unit_buildpics: if unit_buildpics_flag {
            Some(Mode::UnitBuildpics(
                coilbox_unitsync_worker::UnitBuildpicsArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        unit_dataset: if unit_dataset_flag {
            Some(Mode::UnitDataset(
                coilbox_unitsync_worker::UnitDatasetArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        unit_model: if unit_model_flag {
            Some(Mode::UnitModel(
                coilbox_unitsync_worker::UnitModelArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        unit_script: if unit_script_flag {
            Some(Mode::UnitScript(
                coilbox_unitsync_worker::UnitScriptArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        unit_models: if unit_models_flag {
            Some(Mode::UnitModels(
                coilbox_unitsync_worker::UnitModelsArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        unit_render: if unit_render_flag {
            Some(Mode::UnitRender(
                coilbox_unitsync_worker::UnitRenderArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        unit_render_keys: if unit_render_keys_flag {
            Some(Mode::UnitRenderKeys(
                coilbox_unitsync_worker::UnitRenderKeysArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        faction_logos: if faction_logos_flag {
            Some(Mode::FactionLogos(
                coilbox_unitsync_worker::FactionLogosArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
        lua: if lua_flag {
            Some(Mode::Lua(coilbox_unitsync_worker::LuaArgs::from_args(
                &raw,
            )?))
        } else {
            None
        },
        minimap: if map.is_some() {
            Some(Mode::Minimap(
                coilbox_unitsync_worker::MinimapArgs::from_args(&raw)?,
            ))
        } else {
            None
        },
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
/// `--map`, `--game`, `--archive` and `--file` are unitsync/member names,
/// not paths.
fn absolutize(args: &mut Args) {
    for path in [
        Some(&mut args.lib),
        Some(&mut args.datadir),
        args.cache_dir.as_mut(),
        args.asset_dir.as_mut(),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(abs) = absolute_path(path) {
            *path = abs;
        }
    }
    // `Mode::UnitRender` holds its own copy of `--pixels`/`--asset-dir`, read
    // separately from `raw` in `parse_args`, so it needs the same treatment.
    if let Some(Mode::UnitRender(mode)) = args.unit_render.as_mut() {
        if let Some(abs) = absolute_path(&mode.pixels) {
            mode.pixels = abs;
        }
        if let Some(abs) = absolute_path(&mode.asset_dir) {
            mode.asset_dir = abs;
        }
    }
    // `Mode::UnitModels` holds its own copy of `--units-file`/`--cache-dir`,
    // read separately from `raw` in `parse_args`, so it needs the same
    // treatment.
    if let Some(Mode::UnitModels(mode)) = args.unit_models.as_mut() {
        if let Some(abs) = absolute_path(&mode.units_file) {
            mode.units_file = abs;
        }
        if let Some(abs) = absolute_path(&mode.cache_dir) {
            mode.cache_dir = abs;
        }
    }
    // `Mode::UnitRenderKeys` holds its own copy of `--units-file`, read
    // separately from `raw` in `parse_args`, so it needs the same treatment.
    if let Some(Mode::UnitRenderKeys(mode)) = args.unit_render_keys.as_mut() {
        if let Some(abs) = absolute_path(&mode.units_file) {
            mode.units_file = abs;
        }
    }
    // `Mode::MapMeta` holds its own copy of `--cache-dir`, read separately
    // from `raw` in `parse_args`, so it needs the same treatment.
    if let Some(Mode::MapMeta(mode)) = args.map_meta.as_mut() {
        if let Some(dir) = &mut mode.cache_dir {
            if let Some(abs) = absolute_path(dir) {
                *dir = abs;
            }
        }
    }
    // `Mode::MapInfo` holds its own copy of `--cache-dir`, read separately
    // from `raw` in `parse_args`, so it needs the same treatment. `--map` is
    // a unitsync name, not a path, so it is left alone.
    if let Some(Mode::MapInfo(mode)) = args.map_info.as_mut() {
        if let Some(dir) = &mut mode.cache_dir {
            if let Some(abs) = absolute_path(dir) {
                *dir = abs;
            }
        }
    }
    // `Mode::MapCatalog` holds its own copy of `--maps-file`/`--cache-dir`,
    // read separately from `raw` in `parse_args`, so it needs the same
    // treatment. `--map` is a unitsync name, not a path, so it is left alone.
    if let Some(Mode::MapCatalog(mode)) = args.map_catalog.as_mut() {
        for path in [mode.maps_file.as_mut(), mode.cache_dir.as_mut()]
            .into_iter()
            .flatten()
        {
            if let Some(abs) = absolute_path(path) {
                *path = abs;
            }
        }
    }
    // `Mode::MapMinimaps` holds its own copy of
    // `--maps-file`/`--cache-dir`/`--asset-dir`, read separately from `raw`
    // in `parse_args`, so it needs the same treatment.
    if let Some(Mode::MapMinimaps(mode)) = args.map_minimaps.as_mut() {
        for path in [
            mode.maps_file.as_mut(),
            mode.cache_dir.as_mut(),
            mode.asset_dir.as_mut(),
        ]
        .into_iter()
        .flatten()
        {
            if let Some(abs) = absolute_path(path) {
                *path = abs;
            }
        }
    }
    // `Mode::MapSkybox` has no path field of its own: `--map` is a unitsync
    // name, not a path, so there is nothing here for it to do.
    // `Mode::Heightmap` holds its own copy of `--cache-dir`/`--asset-dir`,
    // read separately from `raw` in `parse_args`, so it needs the same
    // treatment. `--map` is a unitsync name, not a path, so it is left
    // alone.
    if let Some(Mode::Heightmap(mode)) = args.heightmap.as_mut() {
        for path in [mode.cache_dir.as_mut(), mode.asset_dir.as_mut()]
            .into_iter()
            .flatten()
        {
            if let Some(abs) = absolute_path(path) {
                *path = abs;
            }
        }
    }
    // `Mode::HeightField` holds its own copy of `--cache-dir`, read
    // separately from `raw` in `parse_args`, so it needs the same
    // treatment. `--map` is a unitsync name, not a path, so it is left
    // alone.
    if let Some(Mode::HeightField(mode)) = args.height_field.as_mut() {
        if let Some(dir) = &mut mode.cache_dir {
            if let Some(abs) = absolute_path(dir) {
                *dir = abs;
            }
        }
    }
    // `Mode::Metalmap` holds its own copy of `--cache-dir`/`--asset-dir`,
    // read separately from `raw` in `parse_args`, so it needs the same
    // treatment. `--map` is a unitsync name, not a path, so it is left
    // alone.
    if let Some(Mode::Metalmap(mode)) = args.metalmap.as_mut() {
        for path in [mode.cache_dir.as_mut(), mode.asset_dir.as_mut()]
            .into_iter()
            .flatten()
        {
            if let Some(abs) = absolute_path(path) {
                *path = abs;
            }
        }
    }
    // `Mode::UnitBuildpics` holds its own copy of
    // `--cache-dir`/`--asset-dir`, read separately from `raw` in
    // `parse_args`, so it needs the same treatment. `--game` and `--units`
    // are unitsync names, not paths, so they are left alone.
    if let Some(Mode::UnitBuildpics(mode)) = args.unit_buildpics.as_mut() {
        for path in [mode.cache_dir.as_mut(), mode.asset_dir.as_mut()]
            .into_iter()
            .flatten()
        {
            if let Some(abs) = absolute_path(path) {
                *path = abs;
            }
        }
    }
    // `Mode::FactionLogos` holds its own copy of `--cache-dir`, read
    // separately from `raw` in `parse_args`, so it needs the same treatment.
    // `--game` and `--sides` are unitsync names, not paths, so they are left
    // alone.
    if let Some(Mode::FactionLogos(mode)) = args.faction_logos.as_mut() {
        if let Some(dir) = &mut mode.cache_dir {
            if let Some(abs) = absolute_path(dir) {
                *dir = abs;
            }
        }
    }
    // `Mode::UnitDataset` holds its own copy of `--cache-dir`, read
    // separately from `raw` in `parse_args`, so it needs the same treatment.
    // `--game` is a unitsync name, not a path, so it is left alone.
    if let Some(Mode::UnitDataset(mode)) = args.unit_dataset.as_mut() {
        if let Some(dir) = &mut mode.cache_dir {
            if let Some(abs) = absolute_path(dir) {
                *dir = abs;
            }
        }
    }
    // `Mode::UnitModel` holds its own copy of `--cache-dir`, read separately
    // from `raw` in `parse_args`, so it needs the same treatment. `--game`
    // and `--object` are unitsync names, not paths, so they are left alone.
    if let Some(Mode::UnitModel(mode)) = args.unit_model.as_mut() {
        if let Some(dir) = &mut mode.cache_dir {
            if let Some(abs) = absolute_path(dir) {
                *dir = abs;
            }
        }
    }
    // `Mode::UnitScript` has no path field of its own: `--game` and `--unit`
    // are unitsync names, not paths, so there is nothing here for it to do.
    // `Mode::SkirmishAis` has no path field of its own for the same reason:
    // `--game` is a unitsync name, not a path.
    // `Mode::GameHeaders` holds its own copy of `--cache-dir`, read
    // separately from `raw` in `parse_args`, so it needs the same treatment.
    if let Some(Mode::GameHeaders(mode)) = args.game_headers.as_mut() {
        if let Some(dir) = &mut mode.cache_dir {
            if let Some(abs) = absolute_path(dir) {
                *dir = abs;
            }
        }
    }
    // `Mode::Thumbnails` holds its own copy of `--cache-dir`, read
    // separately from `raw` in `parse_args`, so it needs the same
    // treatment. `--mip` is a number, not a path, so it is left alone.
    if let Some(Mode::Thumbnails(mode)) = args.thumbnails.as_mut() {
        if let Some(dir) = &mut mode.cache_dir {
            if let Some(abs) = absolute_path(dir) {
                *dir = abs;
            }
        }
    }
    // `Mode::Lua` holds its own copy of `--source-file`/`--chunks-file`,
    // read separately from `raw` in `parse_args`, so it needs the same
    // treatment. `--archive` is a unitsync name, not a path, so it is left
    // alone.
    if let Some(Mode::Lua(mode)) = args.lua.as_mut() {
        for path in [mode.source_file.as_mut(), mode.chunks_file.as_mut()]
            .into_iter()
            .flatten()
        {
            if let Some(abs) = absolute_path(path) {
                *path = abs;
            }
        }
    }
    // `Mode::Archive` holds its own copy of `--extract`'s destination path,
    // read separately from `raw` in `parse_args`, so it needs the same
    // treatment. `--archive` and `--file` name an archive and a member
    // inside it, not paths on this machine, so they are left alone.
    if let Some(Mode::Archive(mode)) = args.archive.as_mut() {
        if let Some(dest) = &mut mode.extract {
            if let Some(abs) = absolute_path(dest) {
                *dest = abs;
            }
        }
    }
    // `Mode::Game` holds its own copy of `--cache-dir`, read separately from
    // `raw` in `parse_args`, so it needs the same treatment. `--game` is a
    // unitsync name, not a path, so it is left alone.
    if let Some(Mode::Game(mode)) = args.game.as_mut() {
        if let Some(dir) = &mut mode.cache_dir {
            if let Some(abs) = absolute_path(dir) {
                *dir = abs;
            }
        }
    }
    // `Mode::Minimap` holds its own copy of `--cache-dir`/`--asset-dir`,
    // read separately from `raw` in `parse_args`, so it needs the same
    // treatment. `--map` is a unitsync name, not a path, so it is left
    // alone.
    if let Some(Mode::Minimap(mode)) = args.minimap.as_mut() {
        for path in [mode.cache_dir.as_mut(), mode.asset_dir.as_mut()]
            .into_iter()
            .flatten()
        {
            if let Some(abs) = absolute_path(path) {
                *path = abs;
            }
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
            thumbnails: None,
            heightmap: None,
            height_field: None,
            metalmap: None,
            typemap: false,
            map_catalog: None,
            map_minimaps: None,
            map_info: None,
            map_meta: None,
            map_skybox: None,
            config: None,
            config_set: None,
            skirmish_ais: None,
            game_headers: None,
            unit_buildpics: None,
            unit_dataset: None,
            unit_model: None,
            unit_models: None,
            unit_render: None,
            unit_render_keys: None,
            unit_script: None,
            faction_logos: None,
            lua: None,
            minimap: None,
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

    // `--unit-render`'s cross field rule (the render source is all three
    // fields or none) moved with the mode to
    // `coilbox_unitsync_worker::UnitRenderArgs::from_args`, and its test moved
    // there too (issue #2448).
}
