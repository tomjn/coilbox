//! Lazy `--unit-dataset` mode: a game's reusable unit graph — every unit plus the
//! internal names of the units it can build (`buildoptions`).
//!
//! Like `game::render` this loads the game's whole archive set into the VFS
//! (`AddAllArchives`) so its unitdefs are queryable, then resets it. It's a
//! general, cacheable dataset (not a build-tree-specific payload): the build-tree
//! viewer, unit include/exclude settings, and the campaign unit restrictions can
//! all read from it. Fetched on demand when a game detail page opens — never
//! during the enumeration scan.
//!
//! `buildoptions` is only reachable through the Lua parser (native FFI unit
//! enumeration doesn't expose it), so — mirroring `game::units_via_shim` — we run
//! `gamedata/defs.lua` through the parser with the game environment unitsync omits
//! shimmed in, and read back `name\tfullname\topt1,opt2,...` per unit.

use crate::ffi::Unitsync;
use crate::infocache;
use crate::model::{UnitDatasetEntry, UnitDatasetOutput};
use std::path::Path;

/// VFS modes for the parser: raw + map + mod + base — the same set `game.rs`, the
/// Lua console and the buildpic resolver use, so `VFS.Include` reaches both the
/// game's own files and the base `springcontent` def scripts.
const VFS_ALL_MODES: &str = "rmMbe";

/// The Lua that [`units_via_shim`] runs, with [`crate::lua::CHUNKED_RESULT`]
/// prepended. It mirrors `game.rs`'s unit-list shim but also collects each unit's
/// `buildoptions`. Keys and buildoptions are lowercased so the graph's edges match
/// its node names.
const UNIT_DATASET_SHIM_SCRIPT: &str = r#"
-- Supply the slice of the game environment unitsync doesn't provide but the
-- shipped def scripts assume (same shims as game.rs's unit-list fallback).
-- Without these, gamedata/defs.lua either loads nothing (an engine build whose
-- Spring.TimeCheck no-ops never runs the def-loading callback) or raises
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

-- A unit is mobile if its unitdef declares a non-zero speed. Games spell this
-- field differently (modern `speed`, legacy `maxvelocity`/`maxVelocity`), so try
-- each; a building leaves them all nil/0.
local function speed_of(d)
  if type(d) ~= 'table' then return 0 end
  return tonumber(d.speed) or tonumber(d.maxvelocity) or tonumber(d.maxVelocity) or 0
end

local lines = {}
for _, k in ipairs(names) do
  local d = ud[k]
  local full = (type(d) == 'table' and type(d.name) == 'string' and d.name ~= '') and d.name or k
  full = tostring(full):gsub('[\t\r\n]', ' ')
  local opts = {}
  if type(d) == 'table' and type(d.buildoptions) == 'table' then
    for _, o in ipairs(d.buildoptions) do
      if type(o) == 'string' and o ~= '' then opts[#opts + 1] = string.lower(o) end
    end
  end
  local mobile = (speed_of(d) > 0) and '1' or '0'
  -- The model file the engine draws the unit with. Often has no extension and
  -- often a different case from the archive member, so it is passed through as
  -- written and resolved against the archive listing later.
  local obj = (type(d) == 'table' and type(d.objectname) == 'string') and d.objectname or ''
  obj = tostring(obj):gsub('[\t\r\n]', ' ')
  lines[#lines + 1] = string.lower(tostring(k)) .. '\t' .. full .. '\t'
    .. table.concat(opts, ',') .. '\t' .. mobile .. '\t' .. obj
end
-- A big game's list runs to hundreds of kilobytes, far past what unitsync can
-- hand back in one string, so it goes back in pieces.
return __cb_chunk(table.concat(lines, '\n'))
"#;

/// Load `game_archive` and read its unit graph (units + `buildoptions` edges).
/// Disk-cached under `cache_dir` (keyed on the archive's file identity) — a hit
/// skips the costly `AddAllArchives` + `GetPrimaryModChecksum` whole-archive hash.
pub fn render(lib: &str, game_archive: &str, cache_dir: Option<&Path>) -> UnitDatasetOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return UnitDatasetOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    // Cheap file-identity cache: a hit returns before mounting the archive set.
    let key = infocache::dataset_key(&us, game_archive);
    let cache = cache_dir.zip(key.as_deref());
    if let Some((dir, key)) = cache {
        if let Some(hit) = infocache::read::<UnitDatasetOutput>(dir, key) {
            us.uninit();
            return hit;
        }
    }

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
        us.uninit();
        return UnitDatasetOutput {
            errors,
            ..Default::default()
        };
    }
    errors.extend(us.drain_errors());

    // Read the whole unitdef table (with buildoptions) through the Lua parser.
    // A game that ships no gamedata/defs.lua (legacy TDF `.fbi` games) has no
    // units to give, and says which of the two it is rather than reading as a
    // game with nothing in it.
    let mut units = match units_via_shim(&us) {
        Ok(units) => units,
        Err(e) => {
            errors.push(format!("could not read this game's units: {}", e.trim()));
            Vec::new()
        }
    };
    let _ = us.drain_errors();
    units.sort_by(|a, b| a.name.cmp(&b.name));

    // Prefer the full primary-mod sync checksum (archive + all dependencies) —
    // the value joiners verify against — over the single-archive
    // `GetArchiveChecksum`, which many engine builds leave 0 for a game's primary
    // archive. Look the mod up by index (games are "primary mods" in unitsync),
    // falling back to the single-archive checksum on builds that lack
    // `GetPrimaryModChecksum`. (Copied from `game::render` so cache-gating matches.)
    let mod_index =
        (0..us.mod_count()).find(|&i| us.mod_archive(i).as_deref() == Some(game_archive));
    let checksum = mod_index
        .and_then(|i| us.mod_checksum(i))
        .or_else(|| us.archive_checksum(game_archive))
        // A zero CRC means "unknown", so omit it rather than show a misleading 0.
        .filter(|&c| c != 0)
        .map(|c| format!("{c:08x}"));

    errors.extend(us.drain_errors());
    us.remove_all_archives();
    us.uninit();

    let out = UnitDatasetOutput {
        units,
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

/// Print a unit-dataset error envelope to stdout (used on the panic path in main).
pub fn emit_error(msg: String) {
    let out = UnitDatasetOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

/// Run the game's `gamedata/defs.lua` through the parser (archives already mounted
/// by the caller) with the missing game environment shimmed in, and parse back the
/// per-unit lines. The failure is returned rather than swallowed, because a game
/// whose units cannot be read has to say so: an empty list is indistinguishable
/// from a game that ships none.
fn units_via_shim(us: &Unitsync) -> Result<Vec<UnitDatasetEntry>, String> {
    let script = format!("{}{UNIT_DATASET_SHIM_SCRIPT}", crate::lua::CHUNKED_RESULT);
    us.run_lua_source(&script, VFS_ALL_MODES)
        .map(|raw| parse_dataset_units(&raw))
}

/// Parse the `name\tfullname\topt1,opt2,...` lines [`UNIT_DATASET_SHIM_SCRIPT`]
/// returns into `UnitDatasetEntry`s. A full name equal to the internal name (the
/// script's fallback) or missing collapses to `None`; an empty options field
/// yields no edges.
fn parse_dataset_units(raw: &str) -> Vec<UnitDatasetEntry> {
    raw.lines()
        .filter_map(|line| {
            let mut it = line.split('\t');
            let name = it.next()?;
            if name.is_empty() {
                return None;
            }
            let full = it.next().unwrap_or("");
            let opts = it.next().unwrap_or("");
            let mobile = it.next().unwrap_or("") == "1";
            let object_name = it.next().unwrap_or("").trim();
            let build_options = opts
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect();
            Some(UnitDatasetEntry {
                name: name.to_string(),
                full_name: Some(full.to_string()).filter(|s| !s.is_empty() && s != name),
                build_options,
                mobile,
                object_name: Some(object_name.to_string()).filter(|s| !s.is_empty()),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tab_separated_dataset_units() {
        let units = parse_dataset_units(
            "armcom\tArmada Commander\tarmsolar,armwin\t1\tARMCOM\ncore\tcore\t\t0\n\tskip\tx\t1\nlone\t\tarmcom\t0",
        );
        // Three usable rows: the empty-name row is dropped.
        assert_eq!(units.len(), 3);
        assert_eq!(units[0].name, "armcom");
        assert_eq!(units[0].full_name.as_deref(), Some("Armada Commander"));
        assert_eq!(units[0].build_options, vec!["armsolar", "armwin"]);
        assert!(units[0].mobile);
        assert_eq!(units[0].object_name.as_deref(), Some("ARMCOM"));
        // Full name equal to the internal name collapses to None; empty options.
        assert_eq!(units[1].name, "core");
        assert_eq!(units[1].full_name, None);
        assert!(units[1].build_options.is_empty());
        assert!(!units[1].mobile);
        assert_eq!(units[1].object_name, None);
        // Missing full name is None; a single build option parses.
        assert_eq!(units[2].name, "lone");
        assert_eq!(units[2].full_name, None);
        assert_eq!(units[2].build_options, vec!["armcom"]);
        assert!(!units[2].mobile);
    }

    #[test]
    fn missing_mobile_field_defaults_to_false() {
        // Older lines without the 4th field parse as static (mobile = false).
        let units = parse_dataset_units("armsolar\tSolar\t");
        assert_eq!(units.len(), 1);
        assert!(!units[0].mobile);
    }

    #[test]
    fn shim_script_reads_buildoptions_and_returns_result() {
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("VFS.Include"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("buildoptions"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("Spring.TimeCheck"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("speed_of"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("objectname"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("return __cb_chunk("));
    }
}
