//! Lazy per-game detail: a game's sides (with their start units) and unit count.
//!
//! Unlike the bulk scan, this loads the game's whole archive set into the VFS
//! (`AddAllArchives`) so its sidedata and units are queryable, then resets it
//! (`RemoveAllArchives`). It's fetched on demand when a game detail page opens.

use crate::ffi::Unitsync;
use crate::infocache;
use crate::model::{GameInfoOutput, Side, UnitEntry};
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

    // Native enumeration. Some engine builds can't build the unitdef table here
    // (e.g. a libunitsync whose `Spring.TimeCheck` stub never runs its callback,
    // so the shipped `gamedata/defs.lua` loads nothing) and return zero units with
    // a "root unitdef table invalid" error. When that happens, drop that error and
    // load the unit list ourselves through the Lua parser, shimming in the game
    // environment unitsync omits. Patched engines take the native path and never
    // pay for the fallback.
    let mut units = collect_units_native(&us);
    let unit_errors = us.drain_errors();
    if units.is_empty() {
        let shimmed = units_via_shim(&us);
        let _ = us.drain_errors();
        match shimmed {
            Ok(shimmed) if !shimmed.is_empty() => units = shimmed,
            Ok(_) => errors.extend(unit_errors),
            Err(e) => {
                errors.extend(unit_errors);
                errors.push(format!("could not read this game's units: {}", e.trim()));
            }
        }
    } else {
        errors.extend(unit_errors);
    }
    units.sort_by(|a, b| a.name.cmp(&b.name));
    let unit_count = units.len() as u32;

    // Map internal unit name -> friendly full name, to resolve side start units.
    let full_by_name: HashMap<String, String> = units
        .iter()
        .filter_map(|u| {
            u.full_name
                .as_ref()
                .map(|full| (u.name.to_lowercase(), full.clone()))
        })
        .collect();

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
        unit_count,
        units,
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

/// VFS modes for the fallback parser: raw + map + mod + base (the same set the
/// Lua console and buildpic resolver use), so `VFS.Include` reaches both the
/// game's own files and the base `springcontent` def scripts.
const VFS_ALL_MODES: &str = "rmMbe";

/// The Lua that [`units_via_shim`] runs, with [`crate::lua::CHUNKED_RESULT`]
/// prepended. The inline comments explain each shim.
const UNIT_DEFS_SHIM_SCRIPT: &str = r#"
-- Load the game's unit defs through unitsync's Lua parser, supplying the slice
-- of the game environment unitsync doesn't provide but the shipped def scripts
-- assume. Without these, gamedata/defs.lua either loads nothing (an engine build
-- whose Spring.TimeCheck no-ops never runs the def-loading callback) or raises
-- (missing Spring.GetModOptions / Game), so no units come back.
if type(Spring) == 'table' then
  Spring.TimeCheck = function(_, fn, ...)
    if type(fn) == 'function' then return fn(...) end
  end
  if type(Spring.GetModOptions) ~= 'function' then
    Spring.GetModOptions = function() return {} end
  end
end
if type(Game) ~= 'table' then Game = { gameSpeed = 30 } end

local ok, defs = pcall(VFS.Include, 'gamedata/defs.lua')
if not ok then return { __error = tostring(defs) } end
local ud = (type(defs) == 'table') and defs.unitdefs or nil
if type(ud) ~= 'table' then return { __error = 'defs.lua produced no unitdefs table' } end

local names = {}
for k in pairs(ud) do names[#names + 1] = k end
table.sort(names)

local lines = {}
for _, k in ipairs(names) do
  local d = ud[k]
  local full = (type(d) == 'table' and type(d.name) == 'string' and d.name ~= '') and d.name or k
  full = tostring(full):gsub('[\t\r\n]', ' ')
  lines[#lines + 1] = tostring(k) .. '\t' .. full
end
-- Sent back in pieces: a big game's list is longer than unitsync can return in
-- one string.
return __cb_chunk(table.concat(lines, '\n'))
"#;

/// Native unit enumeration: `ProcessUnits` must have populated the unitdef table
/// first (the caller drives that). Returns empty when this engine's unitsync
/// couldn't build the table.
fn collect_units_native(us: &Unitsync) -> Vec<UnitEntry> {
    let count = us.unit_count().max(0);
    let mut units = Vec::with_capacity(count as usize);
    for i in 0..count {
        if let Some(name) = us.unit_name(i) {
            let full_name = us.full_unit_name(i);
            units.push(UnitEntry { name, full_name });
        }
    }
    units
}

/// Fallback unit loader: run the game's `gamedata/defs.lua` through the Lua
/// parser (archives already mounted by the caller) with the missing game
/// environment shimmed in, and read back `name\tfullname` per unit. The failure
/// is returned so the caller can report why a game has no units.
fn units_via_shim(us: &Unitsync) -> Result<Vec<UnitEntry>, String> {
    let script = format!("{}{UNIT_DEFS_SHIM_SCRIPT}", crate::lua::CHUNKED_RESULT);
    us.run_lua_source(&script, VFS_ALL_MODES)
        .map(|raw| parse_shim_units(&raw))
}

/// Parse the `name\tfullname` lines [`UNIT_DEFS_SHIM_SCRIPT`] returns into
/// `UnitEntry`s. A full name equal to the internal name (the script's fallback)
/// or missing collapses to `None`, matching the native path's `full_unit_name`.
fn parse_shim_units(raw: &str) -> Vec<UnitEntry> {
    raw.lines()
        .filter_map(|line| {
            let (name, full) = line.split_once('\t')?;
            if name.is_empty() {
                return None;
            }
            Some(UnitEntry {
                name: name.to_string(),
                full_name: Some(full.to_string()).filter(|s| !s.is_empty() && s != name),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tab_separated_shim_units() {
        let units = parse_shim_units("armcom\tArmada Commander\ncube\tcube\n\tskip\nlone\t");
        // Two usable rows: the empty-name row and the trailing-empty-name are dropped.
        assert_eq!(units.len(), 3);
        assert_eq!(units[0].name, "armcom");
        assert_eq!(units[0].full_name.as_deref(), Some("Armada Commander"));
        // Full name equal to the internal name collapses to None.
        assert_eq!(units[1].name, "cube");
        assert_eq!(units[1].full_name, None);
        // Missing full name is None.
        assert_eq!(units[2].name, "lone");
        assert_eq!(units[2].full_name, None);
    }
}
