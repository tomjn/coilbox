//! Lazy `--unit-defs` mode: every key the game declares for every unit, read out
//! of the game's own def pipeline (issue #1269).
//!
//! `--unit-dataset` next door reads a fixed, curated set of fields, which is what
//! a tech tree and an encyclopedia page need. An editor needs the rest: the keys
//! nobody has thought to curate, the `customparams` whose meaning belongs to the
//! game that reads them, and the `weapondefs` a unit points at. So this mode
//! reads the whole table and types none of it.
//!
//! It runs `gamedata/defs.lua` through unitsync's Lua parser with the game's
//! archives mounted, the same route `dataset.rs` and the archive Lua console
//! take, with [`crate::lua::DEFS_ENV_SHIM`] supplying the game environment
//! unitsync leaves out. Reading `units/*.lua` directly would be a different and
//! wrong answer: every game post-processes its raw unit files, so the values in
//! them are not the values the engine runs.

use crate::ffi::Unitsync;
use crate::infocache;
use crate::model::UnitDefsOutput;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::path::Path;

/// VFS modes for the parser: raw + map + mod + base, the same set `dataset.rs`,
/// `game.rs` and the Lua console use, so `VFS.Include` reaches both the game's
/// own files and the base `springcontent` def scripts.
const VFS_ALL_MODES: &str = "rmMbe";

/// The Lua that [`defs_via_shim`] runs, with [`crate::lua::CHUNKED_RESULT`] and
/// [`crate::lua::DEFS_ENV_SHIM`] prepended.
///
/// It hands back one JSON document rather than the tab separated lines
/// `dataset.rs` uses. There is no delimiter a unitdef cannot contain, and the
/// values here are arbitrarily nested, so a line format would need a serializer
/// on both sides instead of one.
///
/// Three things in it are worth knowing about:
///
///  1. `Spring.Log` is hooked while the defs load. The engine's own
///     `gamedata/unitdefs.lua` runs each unit file under `pcall` and logs the
///     ones that raise, so a single broken unit costs that unit and nothing
///     else. Hooking the log is the only way to find out which, and Beyond All
///     Reason ships one such file today.
///  2. strings are escaped down to ASCII. Every value comes back through
///     unitsync's fixed string buffer in 60,000 byte pieces, and each piece is
///     converted with `to_string_lossy` on its own, so a multi byte character
///     that straddles a piece boundary would come back as two replacement
///     characters. Nothing but ASCII travels, so nothing can straddle.
///  3. numbers go through `tostring`. The parser holds them as 32 bit floats,
///     so a def that declares 8.6 hands over 8.60000038 whatever is done, but
///     `tostring` is the only format here that keeps a small value like 0.00001
///     rather than rounding it to nothing.
const UNIT_DEFS_SHIM_SCRIPT: &str = r#"
-- Capture the game's own per-file parse failures. The def loader logs each unit
-- file it could not read at LOG.ERROR and carries on, so this is where a lost
-- unit says why it is missing. Warnings are left out on purpose: a game reports
-- dozens of them per load and none name a broken unit.
local __cb_notes = {}
local __cb_prev_log = Spring.Log
local __cb_error_level = (type(LOG) == 'table' and tonumber(LOG.ERROR)) or 50
Spring.Log = function(section, level, msg, ...)
  local n = tonumber(level)
  if n ~= nil and n >= __cb_error_level and #__cb_notes < 200 then
    __cb_notes[#__cb_notes + 1] = tostring(section) .. ': ' .. tostring(msg)
  end
  if type(__cb_prev_log) == 'function' then
    return __cb_prev_log(section, level, msg, ...)
  end
end

local ok, defs = pcall(VFS.Include, 'gamedata/defs.lua')
Spring.Log = __cb_prev_log
if not ok then return { __error = tostring(defs) } end
local ud = (type(defs) == 'table') and defs.unitdefs or nil
if type(ud) ~= 'table' then return { __error = 'defs.lua produced no unitdefs table' } end
local wd = (type(defs) == 'table') and defs.weapondefs or nil
if type(wd) ~= 'table' then wd = {} end

-- A JSON string, in ASCII only. The fast path is every string a def actually
-- holds: no quote, no backslash, no control character and no high byte.
local function json_string(s)
  s = tostring(s)
  if not string.find(s, '[%c"\\\128-\255]') then return '"' .. s .. '"' end
  s = string.gsub(s, '[%c"\\]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    return string.format('\\u%04x', string.byte(c))
  end)
  if not string.find(s, '[\128-\255]') then return '"' .. s .. '"' end
  -- Decode the UTF-8 and write it back as escapes. A byte that is not part of a
  -- well formed sequence becomes one replacement character, which is what the
  -- Rust side would have made of it anyway.
  local out = {}
  local i = 1
  local last = #s
  while i <= last do
    local b = string.byte(s, i)
    if b < 128 then
      local j = string.find(s, '[\128-\255]', i)
      if j == nil then
        out[#out + 1] = string.sub(s, i)
        break
      end
      out[#out + 1] = string.sub(s, i, j - 1)
      i = j
    else
      local point, width
      if b >= 240 and b < 248 then point, width = b - 240, 4
      elseif b >= 224 then point, width = b - 224, 3
      elseif b >= 192 then point, width = b - 192, 2
      else point, width = nil, 1 end
      if point ~= nil and i + width - 1 <= last then
        for k = 1, width - 1 do
          local c = string.byte(s, i + k)
          if c < 128 or c > 191 then
            point = nil
            break
          end
          point = point * 64 + (c - 128)
        end
      else
        point = nil
      end
      if point == nil then
        out[#out + 1] = '\\ufffd'
        i = i + 1
      elseif point < 65536 then
        out[#out + 1] = string.format('\\u%04x', point)
        i = i + width
      else
        local rest = point - 65536
        local high = math.floor(rest / 1024)
        out[#out + 1] = string.format('\\u%04x\\u%04x',
          55296 + high, 56320 + (rest - high * 1024))
        i = i + width
      end
    end
  end
  return '"' .. table.concat(out) .. '"'
end

-- A JSON number. An infinity or a NaN is not JSON and is not a value a def can
-- have meant, so it comes back as null: the game declared the key and this
-- cannot say what it holds, which is not the same as the key being absent.
local function json_number(n)
  if n ~= n or n == math.huge or n == -math.huge then return 'null' end
  local s = tostring(n)
  if string.find(s, '^%-?%d+%.?%d*[eE]?[-+]?%d*$') == nil then return 'null' end
  return s
end

-- How deep a def is followed. Nothing a game ships comes close, and a table
-- that did would be a loop the cycle check below missed.
local MAX_DEPTH = 16

-- One value as JSON. A table whose keys are exactly 1..n is an array and
-- everything else is an object, which is how the engine reads them too. A
-- function, a userdata, a value below a table already being written, and a
-- value past the depth limit all become null, for the reason json_number does.
local function json_value(v, open, depth)
  local t = type(v)
  if t == 'number' then return json_number(v) end
  if t == 'string' then return json_string(v) end
  if t == 'boolean' then return v and 'true' or 'false' end
  if t ~= 'table' then return 'null' end
  if open[v] or depth >= MAX_DEPTH then return 'null' end
  open[v] = true
  local parts = {}
  local run = #v
  local total = 0
  for _ in pairs(v) do total = total + 1 end
  if run > 0 and total == run then
    for i = 1, run do
      parts[i] = json_value(v[i], open, depth + 1)
    end
    open[v] = nil
    return '[' .. table.concat(parts, ',') .. ']'
  end
  local keys = {}
  for k in pairs(v) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  for _, k in ipairs(keys) do
    parts[#parts + 1] = json_string(tostring(k)) .. ':' .. json_value(v[k], open, depth + 1)
  end
  open[v] = nil
  return '{' .. table.concat(parts, ',') .. '}'
end

-- Encode one table under its own pcall, so a def that cannot be written costs
-- that def and not the scan. `what` names it in the note the failure leaves.
local function encode_all(source, what, into, notes)
  local keys = {}
  for k in pairs(source) do
    if type(k) == 'string' then keys[#keys + 1] = k end
  end
  table.sort(keys)
  for _, k in ipairs(keys) do
    local encoded_ok, encoded = pcall(json_value, source[k], {}, 0)
    if encoded_ok and type(encoded) == 'string' then
      into[#into + 1] = json_string(string.lower(k)) .. ':' .. encoded
    else
      notes[#notes + 1] = json_string(what .. ' ' .. k .. ': ' .. tostring(encoded))
    end
  end
end

local notes = {}
for _, line in ipairs(__cb_notes) do notes[#notes + 1] = json_string(line) end

local units = {}
encode_all(ud, 'unit', units, notes)
local weapons = {}
encode_all(wd, 'weapondef', weapons, notes)

local doc = '{"units":{' .. table.concat(units, ',')
  .. '},"weaponDefs":{' .. table.concat(weapons, ',')
  .. '},"unitErrors":[' .. table.concat(notes, ',') .. ']}'
-- The document is megabytes on a full game, so it goes back in pieces.
return __cb_chunk(doc)
"#;

/// What [`UNIT_DEFS_SHIM_SCRIPT`] writes. Deserialized straight into the fields
/// of [`UnitDefsOutput`] it fills, so the shim and the struct agree by name
/// rather than by position.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ShimDoc {
    units: Map<String, Value>,
    weapon_defs: Map<String, Value>,
    unit_errors: Vec<String>,
}

/// Load `game_archive` and read every key it declares for every unit.
///
/// Disk-cached under `cache_dir`, keyed on the game's sync checksum, so a game
/// update invalidates it and a cache hit returns before the archive set is
/// mounted.
pub fn render(lib: &str, game_archive: &str, cache_dir: Option<&Path>) -> UnitDefsOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return UnitDefsOutput {
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

/// Read a game's full unit definitions in a session the caller has already
/// initialised, mounting the game's archive set and unmounting before it
/// returns.
pub(crate) fn resolve(
    us: &Unitsync,
    game_archive: &str,
    cache_dir: Option<&Path>,
) -> UnitDefsOutput {
    let mut errors = us.drain_errors();

    // The checksum comes first because it is the cache key. It is read out of
    // the archive scanner's own cache, which `Init` has already populated, so
    // it costs no archive read of its own and a hit still returns before the
    // mount that dominates this call.
    let checksum = crate::dataset::primary_mod_checksum(us, game_archive);
    let key = checksum
        .as_deref()
        .map(|c| infocache::unitdefs_key(game_archive, c));
    let cache = cache_dir.zip(key.as_deref());
    if let Some((dir, key)) = cache {
        if let Some(hit) = infocache::read::<UnitDefsOutput>(dir, key) {
            return hit;
        }
    }

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
        return UnitDefsOutput {
            checksum,
            errors,
            ..Default::default()
        };
    }
    errors.extend(us.drain_errors());

    let doc = match defs_via_shim(us) {
        Ok(doc) => doc,
        Err(e) => {
            errors.push(format!(
                "could not read this game's unit defs: {}",
                e.trim()
            ));
            ShimDoc::default()
        }
    };
    errors.extend(us.drain_errors());

    // What the game calls its units, for a game that does not say so in the
    // defs (issue #2650). Read here rather than left to the curated dataset
    // because the dataset carries a name and no description, and rewriting a
    // unit's tooltip is the edit this page exists for. Every translation the
    // game ships, since renaming a unit in English alone leaves the rest saying
    // the old thing (issue #2672).
    let language = if any_unit_unnamed(&doc.units) {
        crate::dataset::language_texts(us, game_archive)
    } else {
        Default::default()
    };
    errors.extend(us.drain_errors());
    us.remove_all_archives();

    let out = UnitDefsOutput {
        units: doc.units,
        weapon_defs: doc.weapon_defs,
        unit_errors: doc.unit_errors,
        language_text: language,
        checksum,
        errors,
    };
    if let Some((dir, key)) = cache {
        if worth_caching(&out) {
            infocache::write(dir, key, &out);
        }
    }
    out
}

/// Whether any unit is left for a localisation file to name.
///
/// The same guard `dataset::resolve` uses, for the same reason: reading the
/// file means opening the archive a second time and listing every member of it,
/// which is wasted on a game that names its units in its own defs.
fn any_unit_unnamed(units: &Map<String, Value>) -> bool {
    units.iter().any(|(key, def)| !def_names_unit(key, def))
}

/// Whether a unitdef carries a name a person would read.
///
/// The engine's own order, from `rts/Sim/Units/UnitDef.cpp:290`, where
/// `humanName` is read with `name` as its default and the comment beside `name`
/// calls it the internal name. So a `name` that only repeats the def key names
/// nothing, and a def with neither key names nothing at all.
fn def_names_unit(key: &str, def: &Value) -> bool {
    let Some(table) = def.as_object() else {
        return false;
    };
    let read = |wanted: &str| {
        table
            .iter()
            .find(|(k, _)| k.to_lowercase() == wanted)
            .and_then(|(_, v)| v.as_str())
            .map(str::trim)
            .filter(|text| !text.is_empty())
    };
    read("humanname").is_some() || read("name").is_some_and(|name| name != key)
}

/// Whether a read is an answer, and so worth remembering.
///
/// The same test `dataset::worth_caching` applies, for the same reason: the key
/// survives every retry and restart, so a read that failed outright must stay
/// out of the cache or the failure becomes permanent. A game that genuinely
/// ships no units complains about nothing while doing it.
fn worth_caching(out: &UnitDefsOutput) -> bool {
    out.checksum.is_some() && !(out.units.is_empty() && !out.errors.is_empty())
}

/// Print a unit-defs error envelope to stdout (used on the panic path in main).
pub fn emit_error(msg: String) {
    let out = UnitDefsOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

/// Run the game's `gamedata/defs.lua` through the parser (archives already
/// mounted by the caller) and parse back the JSON document it writes. The
/// failure is returned rather than swallowed, because a game whose defs cannot
/// be read has to say so: an empty table is indistinguishable from a game that
/// ships nothing.
fn defs_via_shim(us: &Unitsync) -> Result<ShimDoc, String> {
    let script = format!(
        "{}{}{UNIT_DEFS_SHIM_SCRIPT}",
        crate::lua::CHUNKED_RESULT,
        crate::lua::DEFS_ENV_SHIM
    );
    let raw = us.run_lua_source(&script, VFS_ALL_MODES)?;
    parse_shim_doc(&raw)
}

/// Parse the shim's document. A document that will not parse names its own size
/// in the failure, because the one way this breaks in the field is a value the
/// serializer wrote wrong somewhere in several megabytes, and knowing how much
/// arrived says whether it was truncated or malformed.
fn parse_shim_doc(raw: &str) -> Result<ShimDoc, String> {
    serde_json::from_str(raw).map_err(|e| {
        format!(
            "the unit defs came back as {} bytes this could not read: {e}",
            raw.len()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_document_with_units_weapons_and_notes() {
        let doc = parse_shim_doc(
            r#"{"units":{"armcom":{"health":3000,"customparams":{"iscommander":true}}},
                "weaponDefs":{"armcom_laser":{"range":300}},
                "unitErrors":["unitdefs.lua: Error parsing units/broken.lua"]}"#,
        )
        .expect("valid document");
        let unit = doc.units.get("armcom").expect("armcom");
        assert_eq!(unit["health"], serde_json::json!(3000));
        assert_eq!(unit["customparams"]["iscommander"], serde_json::json!(true));
        assert_eq!(doc.weapon_defs["armcom_laser"]["range"], 300);
        assert_eq!(doc.unit_errors.len(), 1);
    }

    #[test]
    fn a_document_that_will_not_parse_says_how_much_arrived() {
        let err = parse_shim_doc(r#"{"units":{"armcom":}"#).expect_err("invalid document");
        assert!(err.contains("20 bytes"), "got: {err}");
    }

    #[test]
    fn missing_sections_are_empty_rather_than_a_failure() {
        let doc = parse_shim_doc("{}").expect("an empty object is a valid document");
        assert!(doc.units.is_empty());
        assert!(doc.weapon_defs.is_empty());
        assert!(doc.unit_errors.is_empty());
    }

    #[test]
    fn a_read_that_failed_outright_is_not_cached() {
        let failed = UnitDefsOutput {
            checksum: Some("deadbeef".into()),
            errors: vec!["could not read this game's unit defs".into()],
            ..Default::default()
        };
        assert!(!worth_caching(&failed));
    }

    #[test]
    fn a_game_that_ships_no_units_quietly_is_cached() {
        let empty = UnitDefsOutput {
            checksum: Some("deadbeef".into()),
            ..Default::default()
        };
        assert!(worth_caching(&empty));
    }

    #[test]
    fn a_read_with_no_checksum_is_not_cached() {
        let mut units = Map::new();
        units.insert("armcom".into(), Value::Object(Map::new()));
        let unsyncable = UnitDefsOutput {
            units,
            ..Default::default()
        };
        assert!(!worth_caching(&unsyncable));
    }
}
