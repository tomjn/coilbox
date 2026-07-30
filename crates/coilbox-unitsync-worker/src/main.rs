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
mod buildpic;
mod config;
mod dataset;
mod factionlogo;
mod ffi;
mod game;
mod heightmap;
mod infocache;
mod lua;
mod metalmap;
mod minimap;
mod model;
mod skirmishai;
mod texture;
mod unitmodel;

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
    heightmap: bool,
    /// `--metalmap`: render one map's metal infomap as an RGBA overlay PNG.
    metalmap: bool,
    /// `--map-info`: lazily read one map's options (combined with `--map`).
    map_info: bool,
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
    object: Option<String>,
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
    /// Longest-side pixel cap for the heightmap PNG downscale (heightmap mode).
    max_side: u32,
    /// Directory for the on-disk minimap/thumbnail PNG cache (minimap modes only).
    cache_dir: Option<String>,
}

fn main() {
    std::process::exit(run());
}

fn run() -> i32 {
    let args = match parse_args() {
        Ok(v) => v,
        Err(e) => {
            emit_error(e);
            return 1;
        }
    };

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
        return match std::panic::catch_unwind(|| {
            buildpic::render(&args.lib, &game_archive, &units, cache_dir)
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
            return match std::panic::catch_unwind(|| {
                heightmap::render(&args.lib, &map, args.max_side, cache_dir)
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

    // Metalmap: render one map's metal infomap to a green-on-transparent RGBA PNG.
    if args.metalmap {
        if let Some(map) = args.map.clone() {
            return match std::panic::catch_unwind(|| {
                metalmap::render(&args.lib, &map, args.max_side, cache_dir)
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

    // Single minimap renders one map; default mode scans everything.
    if let Some(map) = args.map.clone() {
        return match std::panic::catch_unwind(|| {
            minimap::render(&args.lib, &map, args.mip, cache_dir)
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
    let mut map = None;
    let mut game = None;
    let mut archive = None;
    let mut file = None;
    let mut extract = None;
    let mut thumbnails = false;
    let mut heightmap = false;
    let mut metalmap = false;
    let mut map_info = false;
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
    let mut object = None;
    let mut units: Vec<String> = Vec::new();
    let mut faction_logos = false;
    let mut sides: Vec<String> = Vec::new();
    let mut lua = false;
    let mut source_file = None;
    let mut chunks_file = None;
    let mut mip = 1; // 512x512 by default
    let mut max_side = 512u32;
    let mut cache_dir = None;
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
            "--metalmap" => metalmap = true,
            "--map-info" => map_info = true,
            "--map-skybox" => map_skybox = true,
            "--max-side" => {
                max_side = it
                    .next()
                    .and_then(|s| s.parse().ok())
                    .ok_or("--max-side needs an integer")?
            }
            "--cache-dir" => cache_dir = it.next(),
            "--config" => config = true,
            "--config-set" => config_set = true,
            "--config-key" => config_key = it.next(),
            "--config-value" => config_value = it.next(),
            "--skirmish-ais" => skirmish_ais = true,
            "--game-headers" => game_headers = true,
            "--unit-buildpics" => unit_buildpics = true,
            "--unit-dataset" => unit_dataset = true,
            "--unit-model" => unit_model = true,
            "--object" => object = it.next(),
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
        metalmap,
        map_info,
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
        object,
        units,
        faction_logos,
        sides,
        lua,
        source_file,
        chunks_file,
        mip,
        max_side,
        cache_dir,
    })
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
        let dims = us.map_dimensions(&name);
        maps.push(MapItem {
            file_name: us.map_file_name(i),
            archives,
            info: us.map_info(i),
            width: dims.map(|(w, _)| w),
            height: dims.map(|(_, h)| h),
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
