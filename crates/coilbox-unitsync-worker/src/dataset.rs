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
//! enumeration doesn't expose it), so, mirroring `game::units_via_shim`, we run
//! `gamedata/defs.lua` through the parser with [`crate::lua::DEFS_ENV_SHIM`]
//! supplying the game environment unitsync omits, and read back
//! `name\tfullname\topt1,opt2,...` per unit.

use crate::ffi::Unitsync;
use crate::infocache;
use crate::model::{UnitDatasetEntry, UnitDatasetOutput};
use serde_json::{Map, Value};
use std::path::Path;

/// VFS modes for the parser: raw + map + mod + base — the same set `game.rs`, the
/// Lua console and the buildpic resolver use, so `VFS.Include` reaches both the
/// game's own files and the base `springcontent` def scripts.
const VFS_ALL_MODES: &str = "rmMbe";

/// The Lua that [`units_via_shim`] runs, with [`crate::lua::CHUNKED_RESULT`] and
/// [`crate::lua::DEFS_ENV_SHIM`] prepended. It mirrors `game.rs`'s unit-list shim
/// but also collects each unit's `buildoptions`. Keys and buildoptions are
/// lowercased so the graph's edges match its node names.
///
/// The last column is different from the rest: it is a JSON object of the stats
/// the unitdef declares (issue #1876), rather than one more scalar. A unit's
/// weapons are a list of objects, and a tab-separated line can only carry one by
/// inventing a third delimiter that some game's weapon name will eventually
/// contain. `shared/unitdef-stats.json` writes down what goes in it.
const UNIT_DATASET_SHIM_SCRIPT: &str = r#"
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

-- A number as JSON, or nil for anything that is not one. An infinity or a NaN
-- is not JSON at all, and a def that wrote one has said nothing usable.
--
-- A whole number is printed whole, and everything else to the four decimal
-- places the rest of this shim writes, which is more precision than a unitdef's
-- numbers ever carry. Two things rule out the obvious `%g`: the parser this
-- runs in holds numbers as 32 bit floats, so a def declaring a reload of 8.6
-- hands over 8.600000381 and the noise has to be dropped, and its `%g` is not
-- C's - it prints fixed point and keeps every trailing zero, so `%.7g` of that
-- reload comes back as 8.6000004 rather than 8.6.
local function json_number(n)
  n = tonumber(n)
  if n == nil or n ~= n or n == math.huge or n == -math.huge then return nil end
  if n == math.floor(n) and math.abs(n) < 1e15 then return string.format('%d', n) end
  local s = string.format('%.4f', n):gsub('0+$', ''):gsub('%.$', '')
  -- A value too small to write in four places is one this cannot report, and
  -- no number is better than a zero the def never claimed.
  if tonumber(s) == 0 then return nil end
  return s
end

-- A string as JSON, with every control character escaped, so nothing a game
-- wrote can put a tab or a newline into the line this column sits in.
local function json_string(s)
  local escaped = tostring(s):gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    return string.format('\\u%04x', string.byte(c))
  end)
  return '"' .. escaped .. '"'
end

-- A def's keys in whatever case its author typed them: a Lua def keeps them as
-- written, a legacy `.fbi` arrives lowercased from the TDF parser, and the
-- engine's own table lookups do not care either way. Reading a def by name has
-- to go through an index like this or it finds a field in one game and not in
-- the next.
local function lowered(t)
  local out = {}
  if type(t) ~= 'table' then return out end
  for k, v in pairs(t) do
    if type(k) == 'string' then out[string.lower(k)] = v end
  end
  return out
end

-- The first of these fields the def declares, as a finite number. nil when it
-- declares none of them, which is the whole point: zero is a claim about the
-- game and absence is a fact about the reader.
local function stat(t, ...)
  for _, key in ipairs({...}) do
    local n = tonumber(t[key])
    if n ~= nil and n == n and n ~= math.huge and n ~= -math.huge then return n end
  end
  return nil
end

-- What one of this weapon's shots does. A weapondef's `damage` is a table keyed
-- by armour class with a `default` for the classes it does not name, which is
-- the number a unit page shows. A game that names every class and no default
-- gets the largest of them, because that is the shot it advertises.
local function damage_of(wd)
  local dmg = lowered(wd['damage'])
  local declared = stat(dmg, 'default')
  if declared then return declared end
  local most = nil
  for _, v in pairs(dmg) do
    local n = tonumber(v)
    if n ~= nil and n == n and n ~= math.huge then
      if most == nil or n > most then most = n end
    end
  end
  return most
end

-- One unit's weapons as a JSON array, plus the longest range among them.
--
-- Each entry of a unitdef's `weapons` list names a weapondef, either as a bare
-- string or as a table `weapondefs_post` has already written a `name` onto, and
-- the def itself lives in the shared `defs.weapondefs` table. The engine reads
-- at most 32, so neither does this. A weapon the def says nothing measurable
-- about is left out: an empty object on a unit page is worse than one fewer row.
local function weapons_of(u, wdefs)
  local list = u['weapons']
  if type(list) ~= 'table' then return nil, nil end
  local out = {}
  local longest = nil
  for i = 1, 32 do
    local entry = list[i]
    local name = nil
    if type(entry) == 'string' then
      name = entry
    elseif type(entry) == 'table' then
      name = entry.name or entry.Name
    end
    local wd = (type(name) == 'string') and wdefs[string.lower(name)] or nil
    if wd then
      local parts = {}
      local damage = json_number(damage_of(wd))
      if damage then parts[#parts + 1] = '"damage":' .. damage end
      local reload = json_number(stat(wd, 'reloadtime'))
      if reload then parts[#parts + 1] = '"reload":' .. reload end
      local range = stat(wd, 'range')
      if range then
        parts[#parts + 1] = '"range":' .. json_number(range)
        if longest == nil or range > longest then longest = range end
      end
      local kind = wd['weapontype']
      if type(kind) == 'string' and kind ~= '' then
        parts[#parts + 1] = '"projectile":' .. json_string(kind)
      end
      if #parts > 0 then out[#out + 1] = '{' .. table.concat(parts, ',') .. '}' end
    end
  end
  if #out == 0 then return nil, nil end
  return '[' .. table.concat(out, ',') .. ']', longest
end

-- One unit's stats as a JSON object, in the order a unit page reads them.
local function stats_of(d, wdefs)
  local u = lowered(d)
  local parts = {}
  local function put(key, value)
    local n = (value ~= nil) and json_number(value) or nil
    if n then parts[#parts + 1] = '"' .. key .. '":' .. n end
  end
  put('health', stat(u, 'health', 'maxdamage'))
  put('metalCost', stat(u, 'metalcost', 'buildcostmetal'))
  put('energyCost', stat(u, 'energycost', 'buildcostenergy'))
  put('buildTime', stat(u, 'buildtime'))
  put('sightDistance', stat(u, 'sightdistance'))
  -- Elmos a second, which is what modern `speed` is in. A def that spells its
  -- speed the legacy way is saying elmos a frame, and the engine multiplies by
  -- the 30 frames it runs a second to reach the other. Reporting the two as
  -- written would stand two units in one encyclopedia thirty times apart.
  local speed = stat(u, 'speed')
  if speed == nil then
    local legacy = stat(u, 'maxvelocity')
    if legacy then speed = legacy * 30 end
  end
  put('maxVelocity', speed)
  local weapons, longest = weapons_of(u, wdefs)
  -- How far the unit reaches, which is the longest of its weapons' ranges. A
  -- unitdef declares no range of its own, and this is how the engine works
  -- `maxWeaponRange` out too, so it is the game's own number rather than ours.
  put('range', longest)
  if weapons then parts[#parts + 1] = '"weapons":' .. weapons end
  return '{' .. table.concat(parts, ',') .. '}'
end

-- The game's weapondefs once, indexed by lowercased name: that is how a
-- unitdef's weapons list points at them, and how the engine's own lookup
-- matches them.
local wdefs = {}
if type(defs.weapondefs) == 'table' then
  for k, v in pairs(defs.weapondefs) do
    if type(k) == 'string' and type(v) == 'table' then wdefs[string.lower(k)] = lowered(v) end
  end
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
    .. '\t' .. stats_of(d, wdefs)
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
    let script = format!(
        "{}{}{UNIT_DATASET_SHIM_SCRIPT}",
        crate::lua::CHUNKED_RESULT,
        crate::lua::DEFS_ENV_SHIM
    );
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

/// The stats the line's last column carries, as the shim wrote them.
///
/// A column that is missing, empty, or not a JSON object at all is no stats
/// rather than an error, for the reason [`parse_max_slope`] returns `None`: a
/// line written before the column existed is making no claim, and inventing
/// zeroes for it would put numbers in a game's mouth. What is inside the object
/// is deliberately not typed here - the hub stores stats as schemaless JSON and
/// renders what arrives, so a field added to the shim reaches it without a
/// change on this side.
fn parse_stats(field: Option<&str>) -> Map<String, Value> {
    field
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
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
            let stats = parse_stats(it.next());
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
                stats,
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
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("speed_of"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("objectname"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("footprintx"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("footprintz"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("maxslope"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("waterline"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("minwaterdepth"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("maxwaterdepth"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("weapondefs"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("stats_of"));
        assert!(UNIT_DATASET_SHIM_SCRIPT.contains("return __cb_chunk("));
    }

    // ------------------------------------------------------------- stats column

    #[test]
    fn a_line_without_a_stats_column_carries_no_stats() {
        // The distinction the whole encyclopedia rests on. A line written before
        // the column existed says nothing about a unit's health, which must not
        // read as a unit with no health.
        let units = parse_dataset_units("armsolar\tSolar\t\t0\tARMSOLAR\t2\t2\t10.0000\t0");
        assert!(units[0].stats.is_empty());
    }

    #[test]
    fn a_stats_column_that_is_not_an_object_carries_no_stats() {
        let broken =
            parse_dataset_units("odd\tOdd\t\t0\t\t1\t1\t0.0000\t0\t0\t0\t0\t{not json at all");
        assert!(broken[0].stats.is_empty());
        let list = parse_dataset_units("odd\tOdd\t\t0\t\t1\t1\t0.0000\t0\t0\t0\t0\t[1,2,3]");
        assert!(list[0].stats.is_empty());
    }

    #[test]
    fn the_stats_column_is_read_as_the_object_the_shim_wrote() {
        let units = parse_dataset_units(
            "armcom\tCommander\t\t1\tARMCOM\t2\t2\t10.0000\t0\t0\t0\t0\t{\"health\":3000,\"weapons\":[{\"damage\":110}]}",
        );
        assert_eq!(units[0].stats["health"], serde_json::json!(3000));
        assert_eq!(
            units[0].stats["weapons"],
            serde_json::json!([{ "damage": 110 }])
        );
    }

    // ------------------------------------------------- extraction, in real Lua

    /// Run [`UNIT_DATASET_SHIM_SCRIPT`] over a fixture `defs` table in stock Lua
    /// 5.1 and parse what it wrote back.
    ///
    /// This is the extraction end to end rather than the parser on its own: the
    /// shim is where a stat is turned into a number or dropped, and a Lua `or 0`
    /// slipped into it would quietly turn every absent field into a claim of
    /// zero without any line-parsing test noticing.
    ///
    /// `VFS.Include` and `__cb_chunk` stand in for what the real run gets from
    /// unitsync: the game's `gamedata/defs.lua` and the chunked string return.
    fn extract(defs_lua: &str) -> Vec<UnitDatasetEntry> {
        let lua = mlua::Lua::new();
        let script = format!(
            "VFS = {{ Include = function() return {defs_lua} end }}\n\
             __cb_chunk = function(s) return s end\n\
             return (function()\n{UNIT_DATASET_SHIM_SCRIPT}\nend)()"
        );
        let raw: String = lua
            .load(script)
            .eval()
            .expect("the shim script did not run");
        parse_dataset_units(&raw)
    }

    /// One unit's stat as a number, or `None` when it does not carry one.
    fn stat(unit: &UnitDatasetEntry, key: &str) -> Option<f64> {
        unit.stats.get(key).and_then(Value::as_f64)
    }

    /// A modern def spelling every field, with one weapon.
    const A_MOBILE_UNIT: &str = r#"{
      unitdefs = {
        armflash = {
          name = 'Flash',
          health = 545,
          metalcost = 105,
          energycost = 1050,
          buildtime = 1500,
          sightdistance = 350,
          speed = 90,
          weapons = { { name = 'ARMFLASH_ARM_LASER' } },
        },
      },
      weapondefs = {
        ARMFLASH_ARM_LASER = {
          range = 230,
          reloadtime = 0.3,
          weapontype = 'LaserCannon',
          damage = { default = 32, vtol = 10 },
        },
      },
    }"#;

    #[test]
    fn a_mobile_unit_carries_the_stats_a_player_asks_for_first() {
        let units = extract(A_MOBILE_UNIT);

        assert_eq!(stat(&units[0], "health"), Some(545.0));
        assert_eq!(stat(&units[0], "metalCost"), Some(105.0));
        assert_eq!(stat(&units[0], "energyCost"), Some(1050.0));
        assert_eq!(stat(&units[0], "buildTime"), Some(1500.0));
        assert_eq!(stat(&units[0], "sightDistance"), Some(350.0));
        assert_eq!(stat(&units[0], "maxVelocity"), Some(90.0));
        assert!(units[0].mobile);
    }

    #[test]
    fn a_weapon_is_summarised_and_the_longest_range_is_the_units_reach() {
        let units = extract(A_MOBILE_UNIT);

        assert_eq!(
            units[0].stats["weapons"],
            serde_json::json!([{
                "damage": 32,
                "reload": 0.3,
                "range": 230,
                "projectile": "LaserCannon",
            }])
        );
        assert_eq!(stat(&units[0], "range"), Some(230.0));
    }

    /// A game that names every armour class and declares no default advertises
    /// its biggest number, which is the one a unit page shows.
    #[test]
    fn a_damage_table_with_no_default_reports_its_largest_shot() {
        let units = extract(
            r#"{
              unitdefs = {
                armham = { weapons = { { name = 'gun' } } },
              },
              weapondefs = {
                gun = { damage = { light = 60, heavy = 240, vtol = 15 } },
              },
            }"#,
        );

        assert_eq!(
            units[0].stats["weapons"],
            serde_json::json!([{ "damage": 240 }])
        );
    }

    /// A building declares no speed, and no speed must not read as a speed of
    /// zero: the two say different things about the game.
    #[test]
    fn a_static_building_carries_its_costs_and_no_speed() {
        let units = extract(
            r#"{
              unitdefs = {
                armsolar = {
                  name = 'Solar Collector',
                  health = 355,
                  metalcost = 155,
                  energycost = 0,
                  buildtime = 2600,
                  sightdistance = 273,
                },
              },
              weapondefs = {},
            }"#,
        );

        assert_eq!(stat(&units[0], "health"), Some(355.0));
        // Zero really is what the def says, so zero is what travels.
        assert_eq!(stat(&units[0], "energyCost"), Some(0.0));
        assert_eq!(stat(&units[0], "maxVelocity"), None);
        assert!(!units[0].stats.contains_key("maxVelocity"));
        assert!(!units[0].mobile);
    }

    #[test]
    fn a_weaponless_unit_carries_neither_weapons_nor_a_range() {
        let units = extract(
            r#"{
              unitdefs = {
                armmex = { name = 'Metal Extractor', health = 180, metalcost = 50 },
              },
              weapondefs = {},
            }"#,
        );

        assert!(!units[0].stats.contains_key("weapons"));
        assert!(!units[0].stats.contains_key("range"));
        assert_eq!(stat(&units[0], "health"), Some(180.0));
    }

    /// The case the whole "absent means absent" rule exists for. A def that
    /// declares two of the six fields reports two, not six with four zeroes in
    /// them, because a zero is a claim about the game.
    #[test]
    fn a_def_with_partial_stats_reports_only_what_it_declares() {
        let units = extract(
            r#"{
              unitdefs = {
                armodd = { name = 'Odd', health = 100, sightdistance = 200 },
              },
              weapondefs = {},
            }"#,
        );

        let mut keys: Vec<&String> = units[0].stats.keys().collect();
        keys.sort();
        assert_eq!(keys, vec!["health", "sightDistance"]);
    }

    /// A def that says nothing measurable at all gets an empty table on its
    /// page, not a table of zeroes.
    #[test]
    fn a_def_that_declares_nothing_reports_nothing() {
        let units = extract(
            r#"{
              unitdefs = { armnothing = { name = 'Nothing' } },
              weapondefs = {},
            }"#,
        );

        assert!(units[0].stats.is_empty());
    }

    /// The legacy spellings, and the one conversion in the whole extraction:
    /// `maxvelocity` is elmos a frame and `speed` is elmos a second, so the
    /// engine multiplies the legacy one by the 30 frames it runs a second.
    /// Reporting them as written would stand two units thirty times apart.
    #[test]
    fn a_legacy_def_is_read_in_the_same_units_as_a_modern_one() {
        let units = extract(
            r#"{
              unitdefs = {
                armpw = {
                  maxdamage = 220,
                  buildcostmetal = 46,
                  buildcostenergy = 720,
                  maxvelocity = 1.35,
                },
              },
              weapondefs = {},
            }"#,
        );

        assert_eq!(stat(&units[0], "health"), Some(220.0));
        assert_eq!(stat(&units[0], "metalCost"), Some(46.0));
        assert_eq!(stat(&units[0], "energyCost"), Some(720.0));
        assert_eq!(stat(&units[0], "maxVelocity"), Some(40.5));
    }

    /// A Lua def keeps whatever case its author typed, and the engine's own
    /// lookups do not care, so neither can this.
    #[test]
    fn a_def_is_read_whatever_case_its_author_typed() {
        let units = extract(
            r#"{
              unitdefs = {
                armcom = { MaxDamage = 3000, BuildCostMetal = 2600, SightDistance = 500 },
              },
              weapondefs = {},
            }"#,
        );

        assert_eq!(stat(&units[0], "health"), Some(3000.0));
        assert_eq!(stat(&units[0], "metalCost"), Some(2600.0));
        assert_eq!(stat(&units[0], "sightDistance"), Some(500.0));
    }

    /// A weapon slot pointing at a def the game does not ship is not a weapon
    /// with nothing in it, it is no weapon. The engine skips it too.
    #[test]
    fn a_weapon_naming_no_weapondef_is_left_out() {
        let units = extract(
            r#"{
              unitdefs = {
                armcom = {
                  weapons = {
                    { name = 'missing' },
                    { name = 'armcom_disintegrator' },
                  },
                },
              },
              weapondefs = {
                armcom_disintegrator = { range = 250, weapontype = 'DGun' },
              },
            }"#,
        );

        assert_eq!(
            units[0].stats["weapons"],
            serde_json::json!([{ "range": 250, "projectile": "DGun" }])
        );
        assert_eq!(stat(&units[0], "range"), Some(250.0));
    }

    /// The numbers arrive through a parser that holds them as 32 bit floats, so
    /// a def saying a weapon reloads in 0.4 seconds hands over
    /// 0.40000000596046. Four decimal places is where the game's number ends
    /// and that noise begins, and a whole number stays whole however big.
    #[test]
    fn a_number_is_printed_as_the_game_meant_it_rather_than_as_a_float() {
        let units = extract(
            r#"{
              unitdefs = {
                a = { buildtime = 1234567, health = 0.40000000596046448, speed = 8.600000381469727 },
              },
              weapondefs = {},
            }"#,
        );

        assert_eq!(units[0].stats["buildTime"].to_string(), "1234567");
        assert_eq!(units[0].stats["health"].to_string(), "0.4");
        assert_eq!(units[0].stats["maxVelocity"].to_string(), "8.6");
    }

    /// A number too small to write in four places is one the shim cannot
    /// report, and no key is better than a zero the def never claimed.
    #[test]
    fn a_number_too_small_to_write_is_left_out_rather_than_reported_as_zero() {
        let units = extract(
            r#"{
              unitdefs = { a = { health = 0.0000001, metalcost = 5 } },
              weapondefs = {},
            }"#,
        );

        assert!(!units[0].stats.contains_key("health"));
        assert_eq!(stat(&units[0], "metalCost"), Some(5.0));
    }

    /// Nothing a game wrote can break the line the stats sit in. The column is
    /// the last one, and a tab or a newline inside it would make the next unit
    /// unreadable.
    #[test]
    fn a_weapon_type_carrying_a_tab_cannot_break_the_line() {
        let units = extract(
            r#"{
              unitdefs = {
                a = { health = 1, weapons = { { name = 'odd' } } },
                b = { health = 2 },
              },
              weapondefs = { odd = { weapontype = 'Can\tnon\n"quoted"' } },
            }"#,
        );

        assert_eq!(units.len(), 2);
        assert_eq!(stat(&units[1], "health"), Some(2.0));
        assert_eq!(
            units[0].stats["weapons"][0]["projectile"],
            serde_json::json!("Can\tnon\n\"quoted\"")
        );
    }
}
