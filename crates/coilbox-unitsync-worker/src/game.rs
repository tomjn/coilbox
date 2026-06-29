//! Lazy per-game detail: a game's sides (with their start units) and unit count.
//!
//! Unlike the bulk scan, this loads the game's whole archive set into the VFS
//! (`AddAllArchives`) so its sidedata and units are queryable, then resets it
//! (`RemoveAllArchives`). It's fetched on demand when a game detail page opens.

use crate::ffi::Unitsync;
use crate::model::{GameInfoOutput, Side};
use std::collections::HashMap;
use std::path::Path;

/// Safety cap on the `ProcessUnits` drain loop.
const PROCESS_UNITS_MAX_ITERS: i32 = 100_000;

/// Load `game_archive` (a game's primary archive) and read its sides + unit count.
pub fn render(lib: &str, game_archive: &str) -> GameInfoOutput {
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

    errors.extend(us.drain_errors());
    us.remove_all_archives();
    us.uninit();

    GameInfoOutput {
        sides,
        unit_count: unit_count as u32,
        errors,
    }
}

/// Print a game-info error envelope to stdout (used on panic).
pub fn emit_error(msg: String) {
    let out = GameInfoOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}
