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
use model::{Archive, ConfigOption, GameItem, MapItem, ScanOutput};
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

    let maps = collect_maps(&us, &mut errors);
    let games = collect_games(&us, &mut errors);

    us.uninit();

    Ok(ScanOutput {
        maps,
        games,
        errors,
        sync_version,
    })
}

/// Drain unitsync's error queue and attribute each message to `who` (the map or
/// game being processed), so a diagnostic names what it failed on. The expected
/// "no options file" case (maps/games without options, including old TDF maps) is
/// dropped as benign noise.
fn drain_attributed(us: &Unitsync, who: &str, errors: &mut Vec<String>) {
    for e in us.drain_errors() {
        let lower = e.to_lowercase();
        if lower.contains("could not open file") && lower.contains("options.lua") {
            continue;
        }
        errors.push(format!("{who}: {e}"));
    }
}

/// Build an [`Archive`]. `GetArchivePath` returns the *containing directory* and
/// only resolves for filename-style archive names (e.g. a game's primary
/// archive), so we join it with the name for the full path and stat that for the
/// size. Display-name archives (maps, dependencies) won't resolve — path/size
/// stay `None`.
fn archive(us: &Unitsync, name: String, checksum: Option<u32>) -> Archive {
    let full = us
        .archive_path(&name)
        .map(|dir| Path::new(&dir).join(&name));
    let size = full.as_deref().and_then(entry_size);
    let path = full.map(|p| p.to_string_lossy().into_owned());
    // A zero CRC means "unknown" here, so omit it rather than show a misleading 0.
    let checksum = checksum
        .or_else(|| us.archive_checksum(&name))
        .filter(|&c| c != 0)
        .map(|c| format!("{c:08x}"));
    Archive {
        name,
        path,
        checksum,
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
/// `GetMapOptionCount` / `GetModOptionCount` call.
pub(crate) fn read_options(us: &Unitsync, count: i32) -> Vec<ConfigOption> {
    (0..count)
        .filter_map(|i| {
            let key = us.option_key(i)?;
            Some(ConfigOption {
                name: us.option_name(i).unwrap_or_else(|| key.clone()),
                description: us.option_desc(i),
                key,
            })
        })
        .collect()
}

fn collect_maps(us: &Unitsync, errors: &mut Vec<String>) -> Vec<MapItem> {
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
        // Read options last: the GetOption* accessors read a global set by
        // GetMapOptionCount, so populate and consume it back-to-back.
        let options = read_options(us, us.map_option_count(&name));
        maps.push(MapItem {
            file_name: us.map_file_name(i),
            checksum: us.map_checksum(i).map(|c| format!("{c:08x}")),
            archives,
            info: us.map_info(i),
            width: dims.map(|(w, _)| w),
            height: dims.map(|(_, h)| h),
            options,
            name: name.clone(),
        });
        drain_attributed(us, &name, errors);
    }
    maps
}

fn collect_games(us: &Unitsync, errors: &mut Vec<String>) -> Vec<GameItem> {
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
            name: name.clone(),
            checksum: checksum.map(|c| format!("{c:08x}")),
            primary_archive,
            dependency_archives,
            info,
        });
        drain_attributed(us, &name, errors);
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
