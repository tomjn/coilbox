//! Skirmish-AI enumeration: native engine AIs plus a game's bundled Lua AIs.
//!
//! `GetSkirmishAICount` lists native AIs (from the engine's AI data dirs) first,
//! then appends any Lua AIs declared inside a mounted mod. So we count once with
//! no game mounted (all native), and — if a game archive is given — mount it and
//! count again: the indices past the native count are that game's Lua AIs. Each
//! AI's `shortName`/`version`/`name`/`description` come from the shared `GetInfo*`
//! accessors, just like map/game metadata.

use crate::ffi::Unitsync;
use crate::model::{SkirmishAi, SkirmishAiOutput};
use std::path::Path;

/// Load unitsync, list native skirmish AIs, and (when `game_archive` is given)
/// the game's Lua AIs, in one `Init` session.
pub fn render(lib: &str, game_archive: Option<&str>) -> SkirmishAiOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return SkirmishAiOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    let native_count = us.skirmish_ai_count().max(0);
    let mut ais: Vec<SkirmishAi> = (0..native_count)
        .map(|i| read_ai(&us, i, "native"))
        .collect();

    if let Some(game) = game_archive.filter(|g| !g.is_empty()) {
        if us.add_all_archives(game) {
            errors.extend(us.drain_errors());
            // Lua AIs are appended after the natives, so anything past the
            // pre-mount count belongs to this game.
            let total = us.skirmish_ai_count().max(0);
            for i in native_count..total {
                ais.push(read_ai(&us, i, "lua"));
            }
            us.remove_all_archives();
        } else {
            errors.push("this engine's libunitsync can't load game archives".into());
        }
    }

    errors.extend(us.drain_errors());
    us.uninit();

    SkirmishAiOutput { ais, errors }
}

/// Read one AI's info block into a [`SkirmishAi`] with the given `kind`.
fn read_ai(us: &Unitsync, i: i32, kind: &str) -> SkirmishAi {
    let info = us.skirmish_ai_info(i);
    SkirmishAi {
        short_name: info.get("shortName").cloned().unwrap_or_default(),
        version: info.get("version").cloned(),
        name: info.get("name").cloned(),
        description: info.get("description").cloned(),
        kind: kind.to_string(),
    }
}

/// Print a skirmish-AI error envelope to stdout (used on panic).
pub fn emit_error(msg: String) {
    let out = SkirmishAiOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}
