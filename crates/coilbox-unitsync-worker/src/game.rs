//! Lazy per-game detail: a game's sides (with their start units) and unit count.
//!
//! Unlike the bulk scan, this loads the game's whole archive set into the VFS
//! (`AddAllArchives`) so its sidedata and units are queryable, then resets it
//! (`RemoveAllArchives`). It's fetched on demand when a game detail page opens.

use crate::ffi::Unitsync;
use crate::infocache;
use crate::model::{GameInfoOutput, Side};
use std::collections::HashMap;
use std::path::Path;

/// Safety cap on the `ProcessUnits` drain loop.
const PROCESS_UNITS_MAX_ITERS: i32 = 100_000;

/// Load `game_archive` (a game's primary archive) and read its sides + unit count.
/// Disk-cached under `cache_dir` (keyed on the archive's file identity) — a hit
/// skips the costly `AddAllArchives` + `GetArchiveChecksum` whole-archive hash.
pub fn render(lib: &str, game_archive: &str, cache_dir: Option<&Path>) -> GameInfoOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return GameInfoOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    // Cheap file-identity cache: a hit returns before mounting the archive set.
    let key = infocache::game_key(&us, game_archive);
    let cache = cache_dir.zip(key.as_deref());
    if let Some((dir, key)) = cache {
        if let Some(hit) = infocache::read::<GameInfoOutput>(dir, key) {
            us.uninit();
            return hit;
        }
    }

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
        us.uninit();
        return GameInfoOutput {
            errors,
            ..Default::default()
        };
    }
    errors.extend(us.drain_errors());

    // Units must be processed before they can be enumerated; ProcessUnits returns
    // the number still pending, so drain it to zero (bounded).
    let mut iters = 0;
    while us.process_units() > 0 && iters < PROCESS_UNITS_MAX_ITERS {
        iters += 1;
    }
    let unit_count = us.unit_count().max(0);

    // Map internal unit name -> friendly full name, to resolve side start units.
    let mut full_by_name: HashMap<String, String> = HashMap::new();
    for i in 0..unit_count {
        if let Some(name) = us.unit_name(i) {
            if let Some(full) = us.full_unit_name(i) {
                full_by_name.insert(name.to_lowercase(), full);
            }
        }
    }

    let mut sides = Vec::new();
    for s in 0..us.side_count() {
        let start_unit = us.side_start_unit(s);
        let start_unit_name = start_unit
            .as_ref()
            .and_then(|u| full_by_name.get(&u.to_lowercase()).cloned());
        sides.push(Side {
            name: us.side_name(s).unwrap_or_default(),
            start_unit,
            start_unit_name,
        });
    }

    let options = crate::read_options(&us, us.mod_option_count());

    // Prefer the full primary-mod sync checksum (archive + all dependencies) — the
    // value joiners verify against — over the single-archive `GetArchiveChecksum`,
    // which many engine builds leave 0 for a game's primary archive. Look the mod
    // up by index (games are "primary mods" in unitsync), falling back to the
    // single-archive checksum on builds that lack `GetPrimaryModChecksum`.
    let mod_index =
        (0..us.mod_count()).find(|&i| us.mod_archive(i).as_deref() == Some(game_archive));
    let checksum = mod_index
        .and_then(|i| us.mod_checksum(i))
        .or_else(|| us.archive_checksum(game_archive))
        // A zero CRC means "unknown", so omit it rather than show a misleading 0.
        .filter(|&c| c != 0)
        .map(|c| format!("{c:08x}"));
    if checksum.is_none() {
        errors.push(format!(
            "no sync checksum for {game_archive} (primary-mod index {mod_index:?}): GetPrimaryModChecksum / GetArchiveChecksum returned 0 or are unavailable in this engine build"
        ));
    }

    errors.extend(us.drain_errors());
    us.remove_all_archives();
    us.uninit();

    let out = GameInfoOutput {
        sides,
        unit_count: unit_count as u32,
        options,
        checksum,
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

/// Print a game-info error envelope to stdout (used on panic).
pub fn emit_error(msg: String) {
    let out = GameInfoOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}
