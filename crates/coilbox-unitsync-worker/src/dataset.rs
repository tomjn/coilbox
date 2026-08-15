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
-- Stand in for the engine's Game table, which unitsync leaves out of the def
-- parser entirely. Its map fields have no answer here, and the engine omits them
-- too when no map is loaded, so they stay nil. mapName is the exception: def
-- scripts read it to pick per-map config and assume it is always there. An empty
-- name is the honest "no map" and matches none, so a script falls through to its
-- map-independent defaults instead of loading some other map's overrides.
if type(Game) ~= 'table' then Game = { gameSpeed = 30, mapName = '' } end

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

-- How much ground a unit stands on, in build squares. The def scripts lowercase
-- their keys, but the field is spelled `footprintX` in a unitdef, so both are
-- tried. The engine takes max(1, floor(n)), so a missing or nonsense value is a
-- single square rather than a building of no size.
local function footprint(d, lower, upper)
  if type(d) ~= 'table' then return 1 end
  local n = tonumber(d[lower]) or tonumber(d[upper]) or 1
  n = math.floor(n)
  if n < 1 then n = 1 end
  return n
end

-- How steep the ground under a building may be, in degrees. The engine reads
-- `maxSlope` and turns it into the height difference it will tolerate across
-- the footprint, clamping the angle to 0..89 first. A def that says nothing
-- gets 0, which is the engine's own default and means perfectly flat ground.
local function maxslope(d)
  if type(d) ~= 'table' then return 0 end
  local n = tonumber(d.maxslope) or tonumber(d.maxSlope) or 0
  if n < 0 then n = 0 end
  if n > 89 then n = 89 end
  return n
end

-- Whether the building sits on the water rather than on the seabed. The engine
-- takes `floater`, or the mere presence of a `waterline` key, and a floater is
-- exempt from the slope test wherever the ground is below sea level.
local function floats(d)
  if type(d) ~= 'table' then return '0' end
  local v = d.floater
  if v == nil then v = d.Floater end
  if v == nil then
    return (d.waterline ~= nil or d.WaterLine ~= nil or d.waterLine ~= nil) and '1' or '0'
  end
  if type(v) == 'number' then return v ~= 0 and '1' or '0' end
  return v and '1' or '0'
end

-- How deep the water under a building may be, in elmos. The engine demands the
-- ground under every square of the footprint lie in
-- [-maxWaterDepth, -minWaterDepth], which is how a naval yard is kept in the sea
-- and a land building out of it. A def that says nothing gets the engine's own
-- defaults of -10e6 and +10e6, a band nothing falls outside.
local function depth(d, lower, upper, fallback)
  if type(d) ~= 'table' then return fallback end
  local n = tonumber(d[lower]) or tonumber(d[upper]) or fallback
  return n
end

-- How far below the water a floater sits. `GetBuildHeight` levels a floater to
-- -waterline rather than to the ground under it, so this is what a floating
-- building is measured against. The engine's default is 0.
local function waterline_of(d)
  if type(d) ~= 'table' then return 0 end
  return tonumber(d.waterline) or tonumber(d.WaterLine) or tonumber(d.waterLine) or 0
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
    .. '\t' .. footprint(d, 'footprintx', 'footprintX')
    .. '\t' .. footprint(d, 'footprintz', 'footprintZ')
    .. '\t' .. string.format('%.4f', maxslope(d))
    .. '\t' .. floats(d)
    .. '\t' .. string.format('%.4f', depth(d, 'minwaterdepth', 'minWaterDepth', -10e6))
    .. '\t' .. string.format('%.4f', depth(d, 'maxwaterdepth', 'maxWaterDepth', 10e6))
    .. '\t' .. string.format('%.4f', waterline_of(d))
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
    let out = resolve(&us, game_archive, cache_dir);
    us.uninit();
    out
}

/// Read a game's unit graph in a session the caller has already initialised,
/// mounting the game's archive set and unmounting before it returns.
///
/// Split out for the seed walk (issue #1638), which reads every game's roster
/// over one `Init` to know which units to look for build pics for.
pub(crate) fn resolve(
    us: &Unitsync,
    game_archive: &str,
    cache_dir: Option<&Path>,
) -> UnitDatasetOutput {
    let mut errors = us.drain_errors();

    // Cheap file-identity cache: a hit returns before mounting the archive set.
    let key = infocache::dataset_key(us, game_archive);
    let cache = cache_dir.zip(key.as_deref());
    if let Some((dir, key)) = cache {
        if let Some(hit) = infocache::read::<UnitDatasetOutput>(dir, key) {
            return hit;
        }
    }

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
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
    let mut units = match units_via_shim(us) {
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

/// One footprint field, in build squares. Anything missing, unreadable or below
/// a square is a single square, which is the floor the engine itself applies, so
/// a line written before the fields existed still describes a real building.
fn parse_footprint(field: Option<&str>) -> u32 {
    field
        .and_then(|s| s.trim().parse::<u32>().ok())
        .filter(|&n| n >= 1)
        .unwrap_or(1)
}

/// How steep the ground under a building may be, in degrees, or `None` when the
/// line does not carry it.
///
/// `None` and `Some(0.0)` are different answers and must stay that way. Zero is
/// the engine's own default and it means the ground has to be flat, which is a
/// strong claim. A line written before this field existed is making no claim at
/// all, and a reader that confused the two would call every building on a hill
/// unbuildable.
fn parse_max_slope(field: Option<&str>) -> Option<f32> {
    field
        .and_then(|s| s.trim().parse::<f32>().ok())
        .filter(|n| n.is_finite())
        .map(|n| n.clamp(0.0, 89.0))
}

/// One water field in elmos, or `None` when the line does not carry it.
///
/// Kept apart from a real value for the same reason [`parse_max_slope`] is: a
/// line written before these fields existed is making no claim, and a reader
/// that turned that into the engine's defaults would be putting words in its
/// mouth. Unlike the slope, a negative value is meaningful, because the
/// engine's own `minWaterDepth` default is -10e6.
fn parse_water(field: Option<&str>) -> Option<f32> {
    field
        .and_then(|s| s.trim().parse::<f32>().ok())
        .filter(|n| n.is_finite())
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
            let footprint_x = parse_footprint(it.next());
            let footprint_z = parse_footprint(it.next());
            let max_slope = parse_max_slope(it.next());
            let float_on_water = it.next().unwrap_or("") == "1";
            let min_water_depth = parse_water(it.next());
            let max_water_depth = parse_water(it.next());
            let waterline = parse_water(it.next());
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
                footprint_x,
                footprint_z,
                max_slope,
                float_on_water,
                min_water_depth,
                max_water_depth,
                waterline,
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
    fn reads_a_rectangular_footprint() {
        let units = parse_dataset_units("armlab\tLab\t\t0\tARMLAB\t5\t6");
        assert_eq!(units[0].footprint_x, 5);
        assert_eq!(units[0].footprint_z, 6);
    }

    #[test]
    fn missing_footprint_fields_default_to_one_square() {
        // Older lines stop after the model name. The engine floors a footprint at
        // one square, so that is what a line with nothing to say parses as, not a
        // building of no size.
        let units = parse_dataset_units("armsolar\tSolar\t\t0\tARMSOLAR");
        assert_eq!(units[0].footprint_x, 1);
        assert_eq!(units[0].footprint_z, 1);
    }

    #[test]
    fn a_footprint_of_nothing_is_one_square() {
        // The engine takes max(1, footprintX), so a def declaring 0 stands on a
        // square all the same.
        let units = parse_dataset_units("odd\tOdd\t\t0\t\t0\tx");
        assert_eq!(units[0].footprint_x, 1);
        assert_eq!(units[0].footprint_z, 1);
    }

    #[test]
    fn reads_the_slope_a_building_tolerates() {
        let units = parse_dataset_units("armsolar\tSolar\t\t0\tARMSOLAR\t2\t2\t10.0000\t0");
        assert_eq!(units[0].max_slope, Some(10.0));
        assert!(!units[0].float_on_water);
    }

    #[test]
    fn reads_a_floating_building() {
        let units = parse_dataset_units("armfsolar\tFloating Solar\t\t0\t\t2\t2\t20.0000\t1");
        assert!(units[0].float_on_water);
    }

    #[test]
    fn a_line_without_a_slope_claims_none() {
        // The distinction the whole terrain check rests on. An older line stops
        // after the footprint and is saying nothing, which must not read as the
        // engine's default of zero degrees, meaning flat ground only.
        let units = parse_dataset_units("armsolar\tSolar\t\t0\tARMSOLAR\t2\t2");
        assert_eq!(units[0].max_slope, None);
        let flat = parse_dataset_units("armsolar\tSolar\t\t0\tARMSOLAR\t2\t2\t0.0000\t0");
        assert_eq!(flat[0].max_slope, Some(0.0));
    }

    #[test]
    fn an_unreadable_slope_claims_none() {
        let units = parse_dataset_units("odd\tOdd\t\t0\t\t1\t1\tsteep\t0");
        assert_eq!(units[0].max_slope, None);
    }

    #[test]
    fn a_slope_outside_the_engines_range_is_clamped() {
        // The engine clamps `maxSlope` to 0..89 before it reaches the tangent,
        // which is what keeps the tolerance finite.
        let units = parse_dataset_units("wall\tWall\t\t0\t\t1\t1\t-5.0000\t0");
        assert_eq!(units[0].max_slope, Some(0.0));
        let steep = parse_dataset_units("wall\tWall\t\t0\t\t1\t1\t120.0000\t0");
        assert_eq!(steep[0].max_slope, Some(89.0));
    }

    #[test]
    fn reads_the_water_a_building_needs() {
        let units = parse_dataset_units(
            "armfsolar\tFloating Solar\t\t0\t\t2\t2\t20.0000\t1\t2.0000\t100.0000\t5.0000",
        );
        assert_eq!(units[0].min_water_depth, Some(2.0));
        assert_eq!(units[0].max_water_depth, Some(100.0));
        assert_eq!(units[0].waterline, Some(5.0));
    }

    #[test]
    fn a_line_without_water_fields_claims_none() {
        // Same reasoning as the slope. The engine's own defaults are a band so
        // wide it refuses nothing, and a line that predates the fields is not
        // claiming that band, it is claiming nothing.
        let units = parse_dataset_units("armsolar\tSolar\t\t0\tARMSOLAR\t2\t2\t10.0000\t0");
        assert_eq!(units[0].min_water_depth, None);
        assert_eq!(units[0].max_water_depth, None);
        assert_eq!(units[0].waterline, None);
    }

    #[test]
    fn a_land_building_keeps_its_negative_min_water_depth() {
        // The engine's default `minWaterDepth` is -10e6, so the sign has to
        // survive the round trip or every building would be required to be in
        // the sea.
        let units =
            parse_dataset_units("armsolar\tSolar\t\t0\t\t2\t2\t10.0000\t0\t-10000000\t0.0000\t0");
        assert_eq!(units[0].min_water_depth, Some(-10_000_000.0));
        assert_eq!(units[0].max_water_depth, Some(0.0));
    }

    #[test]
    fn an_unreadable_water_depth_claims_none() {
        let units = parse_dataset_units("odd\tOdd\t\t0\t\t1\t1\t0.0000\t0\tdeep\tdeeper\twet");
        assert_eq!(units[0].min_water_depth, None);
        assert_eq!(units[0].max_water_depth, None);
        assert_eq!(units[0].waterline, None);
    }

    #[test]
    fn shim_script_reads_buildoptions_and_returns_result() {
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("VFS.Include"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("buildoptions"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("Spring.TimeCheck"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("mapName = ''"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("speed_of"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("objectname"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("footprintx"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("footprintz"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("maxslope"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("waterline"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("minwaterdepth"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("maxwaterdepth"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("return __cb_chunk("));
    }
}
