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

mod ffi;
mod game;
mod minimap;
mod model;

use ffi::Unitsync;
use model::{Archive, GameItem, MapItem, ScanOutput};
use std::path::Path;

const LIST_SEP: char = if cfg!(windows) { ';' } else { ':' };

/// Parsed CLI: always a lib + data dir. `--map` switches to single-minimap mode;
/// `--thumbnails` switches to batch-thumbnail mode; otherwise it's a full scan.
struct Args {
    lib: String,
    datadir: String,
    map: Option<String>,
    game: Option<String>,
    thumbnails: bool,
    mip: i32,
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

    // Batch thumbnails: a small minimap for every map in one Init.
    if args.thumbnails {
        return match std::panic::catch_unwind(|| minimap::render_all(&args.lib, args.mip)) {
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

    // Game detail: load one game's archives to read its sides + unit count.
    if let Some(game_archive) = args.game.clone() {
        return match std::panic::catch_unwind(|| game::render(&args.lib, &game_archive)) {
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

    // Single minimap renders one map; default mode scans everything.
    if let Some(map) = args.map.clone() {
        return match std::panic::catch_unwind(|| minimap::render(&args.lib, &map, args.mip)) {
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
    let mut thumbnails = false;
    let mut mip = 1; // 512x512 by default
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--lib" => lib = it.next(),
            "--datadir" => datadir = it.next(),
            "--map" => map = it.next(),
            "--game" => game = it.next(),
            "--thumbnails" => thumbnails = true,
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
        thumbnails,
        mip,
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
    let us = unsafe { Unitsync::load(Path::new(lib))? };

    let mut errors = Vec::new();
    if us.init(false, 0) == 0 {
        errors.push("unitsync Init returned 0 (failure); results may be empty".into());
    }
    errors.extend(us.drain_errors());

    let sync_version = us.spring_version();

    let maps = collect_maps(&us);
    errors.extend(us.drain_errors());

    let games = collect_games(&us);
    errors.extend(us.drain_errors());

    us.uninit();

    Ok(ScanOutput {
        maps,
        games,
        errors,
        sync_version,
    })
}

/// Build an [`Archive`], filling its checksum from a known value or, failing
/// that, an on-demand lookup, and its path from the optional accessor.
fn archive(us: &Unitsync, name: String, checksum: Option<u32>) -> Archive {
    let path = us.archive_path(&name);
    // A zero CRC means "unknown" here (the by-name lookup misses when given an
    // archive's display name), so omit it rather than show a misleading 00000000.
    let checksum = checksum
        .or_else(|| us.archive_checksum(&name))
        .filter(|&c| c != 0)
        .map(|c| format!("{c:08x}"));
    Archive {
        name,
        path,
        checksum,
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
            .map(|a| archive(us, a, None))
            .collect();
        let dims = us.map_dimensions(&name);
        maps.push(MapItem {
            file_name: us.map_file_name(i),
            checksum: us.map_checksum(i).map(|c| format!("{c:08x}")),
            archives,
            info: us.map_info(i),
            width: dims.map(|(w, _)| w),
            height: dims.map(|(_, h)| h),
            name,
        });
    }
    maps
}

fn collect_games(us: &Unitsync) -> Vec<GameItem> {
    let count = us.mod_count();
    let mut games = Vec::with_capacity(count.max(0) as usize);
    for i in 0..count {
        let primary_name = us.mod_archive(i).unwrap_or_default();
        let checksum = us.mod_checksum(i);
        let info = us.mod_info(i);
        let name = info
            .get("name")
            .filter(|s| !s.is_empty())
            .cloned()
            .unwrap_or_else(|| primary_name.clone());

        let primary_archive = archive(us, primary_name.clone(), checksum);
        // The archive list includes the game's own archive — but under its
        // display name (the mod name) rather than its filename, so exclude both
        // forms so a game never lists itself as a dependency.
        let dependency_archives = us
            .mod_archives(i)
            .into_iter()
            .filter(|a| a != &primary_name && a != &name)
            .map(|a| archive(us, a, None))
            .collect();

        games.push(GameItem {
            name,
            checksum: checksum.map(|c| format!("{c:08x}")),
            primary_archive,
            dependency_archives,
            info,
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
