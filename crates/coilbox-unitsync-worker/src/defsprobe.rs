//! `--defs-probe` mode: load a game's definitions with some files on top of
//! it, and read numbers back out of the loaded tables (issue #3059).
//!
//! The workshop works out a value to write in place of a typed one by
//! loading the game with the project's own compiled mutator on top and
//! reading what the game ends up with (`loads_as.rs` in the workshop plugin).
//! This is that load. Each run is one full load of `gamedata/defs.lua`
//! through unitsync's Lua parser, the same route `--unit-defs` takes, in one
//! session with the game's archives mounted once for all of them.
//!
//! The files go on top in Lua rather than on disk. A mutator is an archive
//! that depends on the game, and the engine puts its files first, so a file
//! at a path the game also has covers the game's, and a listing of a folder
//! holds both archives' files. Writing a real archive would mean a rescan of
//! the content folder for every run. So `VFS.Include`, `VFS.LoadFile`,
//! `VFS.FileExists` and `VFS.DirList` are wrapped to answer from the files
//! first, for any read the game's own mode string lets reach a game archive.
//!
//! A run can carry mod options too, for the `tweakdefs` and `tweakunits`
//! slots (issue #3092). Those reach the game through `Spring.GetModOptions()`, so
//! the run installs one that answers with them before anything else runs.
//!
//! Two things about the numbers. The engine's Lua holds them as 32 bit
//! floats (`LUA_NUMBER` is `float` in `rts/lib/lua/include/luaconf.h`), and
//! `tostring` prints at most ten characters of one, which is not enough to
//! tell two neighbouring floats apart. So each value comes back as
//! `math.frexp`'s two halves, with the fraction scaled to a whole number of
//! 24 bits, which `tostring` prints exactly. And whether a value equals the
//! typed one is decided in the same Lua, against the typed value parsed the
//! way a compiled file's is, so "loads as the typed value" means the same
//! float the game would hold had it done nothing to it.

use crate::ffi::Unitsync;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// VFS modes for the parser, the set `unitdefs.rs` uses.
const VFS_ALL_MODES: &str = "rmMbe";

#[derive(Debug, Deserialize)]
struct Input {
    #[serde(default)]
    runs: Vec<Run>,
}

#[derive(Debug, Deserialize)]
struct Run {
    #[serde(default)]
    files: Vec<File>,
    #[serde(default)]
    reads: Vec<Read>,
    /// The mod options a lobby would hand the game, key to value, the way
    /// `Spring.GetModOptions()` answers in a running game (issue #3092).
    #[serde(default, rename = "modOptions")]
    mod_options: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct File {
    path: String,
    contents: String,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Table {
    Units,
    Weapons,
}

#[derive(Debug, Deserialize)]
struct Read {
    table: Table,
    key: String,
    path: Vec<String>,
    expect: f64,
}

/// What the mode prints: a result per run, in order.
#[derive(Debug, Serialize, Default)]
pub struct DefsProbeOutput {
    pub runs: Vec<RunOutput>,
    pub errors: Vec<String>,
}

/// One run's readings, one per read in order, or why the load failed.
#[derive(Debug, Serialize, Default)]
pub struct RunOutput {
    pub reads: Vec<Reading>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct Reading {
    /// The loaded value, exactly. `None` where there is no finite number.
    pub value: Option<f64>,
    /// Whether it equals the typed value in the engine's number type.
    pub equal: bool,
}

/// Load `game` once per run in `input`, each time with that run's files on
/// top, and read each run's values back.
pub fn render(lib: &str, game: &str, input: &str) -> DefsProbeOutput {
    let input: Input = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(e) => {
            return DefsProbeOutput {
                errors: vec![format!("could not read the probe: {e}")],
                ..Default::default()
            }
        }
    };
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return DefsProbeOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();
    if !us.add_all_archives(game) {
        errors.push("this engine's libunitsync can't load game archives".into());
        us.uninit();
        return DefsProbeOutput {
            errors,
            ..Default::default()
        };
    }
    errors.extend(us.drain_errors());
    let runs = input
        .runs
        .iter()
        .map(|run| {
            let script = format!(
                "{}{}{}{}",
                crate::lua::CHUNKED_RESULT,
                mod_options_script(&run.mod_options),
                crate::lua::DEFS_ENV_SHIM,
                probe_script(run)
            );
            let out = match us.run_lua_source(&script, VFS_ALL_MODES) {
                Ok(raw) => parse_readings(&raw, run.reads.len()),
                Err(e) => RunOutput {
                    reads: Vec::new(),
                    error: Some(e.trim().to_string()),
                },
            };
            // The parser's own log is per session, so each run's goes with it
            // rather than piling up under the last.
            errors.extend(us.drain_errors());
            out
        })
        .collect();
    us.remove_all_archives();
    us.uninit();
    DefsProbeOutput { runs, errors }
}

/// Print an error envelope to stdout (used on the panic path in `main`).
pub fn emit_error(msg: String) {
    let out = DefsProbeOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

/// A Lua string literal holding exactly `text`, in ASCII.
fn lua_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for byte in text.bytes() {
        match byte {
            b'"' => out.push_str("\\\""),
            b'\\' => out.push_str("\\\\"),
            b' '..=b'~' => out.push(byte as char),
            _ => out.push_str(&format!("\\{byte:03}")),
        }
    }
    out.push('"');
    out
}

/// A Lua number literal the parser reads as `x`, or `nil` for one it cannot.
fn lua_number(x: f64) -> String {
    if x.is_finite() {
        format!("{x}")
    } else {
        "nil".to_string()
    }
}

/// `Spring.GetModOptions()` answering with `options`, installed ahead of
/// [`crate::lua::DEFS_ENV_SHIM`] so the shim's empty stand-in never takes its
/// place. Nothing at all when there are none, which leaves the shim's.
///
/// The engine's own answers with a new table of strings on every call
/// (`LuaSyncedRead::GetModOptions`), so this does too. What a game does with
/// the answer is its own business. Beyond All Reason, for example, converts
/// each value by the type its `modoptions.lua` declares, and runs the
/// `tweakdefs` and `tweakunits` slots from that in `gamedata/unitdefs_post.lua`.
fn mod_options_script(options: &BTreeMap<String, String>) -> String {
    if options.is_empty() {
        return String::new();
    }
    let entries: String = options
        .iter()
        .map(|(key, value)| format!("  [{}] = {},\n", lua_string(key), lua_string(value)))
        .collect();
    format!(
        "if type(Spring) == 'table' then\n  local __cb_modoptions = {{\n{entries}  }}\n  Spring.GetModOptions = function()\n    local copy = {{}}\n    for k, v in pairs(__cb_modoptions) do copy[k] = v end\n    return copy\n  end\nend\n"
    )
}

/// The overlay, the load and the reads for one run.
fn probe_script(run: &Run) -> String {
    let files: String = run
        .files
        .iter()
        .map(|f| {
            format!(
                "  [{}] = {{ name = {}, text = {} }},\n",
                lua_string(&f.path.to_lowercase()),
                lua_string(&f.path),
                lua_string(&f.contents)
            )
        })
        .collect();
    let reads: String = run
        .reads
        .iter()
        .map(|r| {
            let steps: Vec<String> = r.path.iter().map(|s| lua_string(s)).collect();
            format!(
                "  {{ t = {}, k = {}, p = {{ {} }}, e = {} }},\n",
                lua_string(match r.table {
                    Table::Units => "unitdefs",
                    Table::Weapons => "weapondefs",
                }),
                lua_string(&r.key),
                steps.join(", "),
                lua_number(r.expect)
            )
        })
        .collect();
    format!("local __cb_files = {{\n{files}}}\nlocal __cb_reads = {{\n{reads}}}\n{PROBE_SCRIPT}")
}

/// Everything after the two tables [`probe_script`] writes.
const PROBE_SCRIPT: &str = r#"
-- A read the mode string lets reach a game archive. The default mode, when a
-- script gives none, is the parser's own, which includes it.
local function __cb_ours(name, modes)
  if type(name) ~= 'string' then return nil end
  if modes ~= nil and not string.find(modes, 'M', 1, true) then return nil end
  return __cb_files[string.lower(name)]
end

local __cb_include, __cb_load = VFS.Include, VFS.LoadFile
local __cb_exists, __cb_dirlist = VFS.FileExists, VFS.DirList

VFS.Include = function(name, env, modes)
  -- The engine runs an include in its caller's environment when it is given
  -- none, and this wrapper is now the caller, so it names the real one.
  if type(env) ~= 'table' then env = getfenv(2) end
  local file = __cb_ours(name, modes)
  if file == nil then return __cb_include(name, env, modes) end
  local chunk, err = loadstring(file.text, name)
  if chunk == nil then error(err, 2) end
  setfenv(chunk, env)
  return chunk()
end

VFS.LoadFile = function(name, modes, ...)
  local file = __cb_ours(name, modes)
  if file ~= nil then return file.text end
  return __cb_load(name, modes, ...)
end

VFS.FileExists = function(name, modes, ...)
  if __cb_ours(name, modes) ~= nil then return true end
  return __cb_exists(name, modes, ...)
end

-- A file name pattern as the engine takes one, `*` and `?` and nothing else,
-- as a Lua pattern matched without regard to case.
local function __cb_glob(pattern)
  local p = string.lower(pattern or '*')
  p = string.gsub(p, '[%^%$%(%)%%%.%[%]%+%-]', '%%%0')
  p = string.gsub(p, '%*', '.*')
  p = string.gsub(p, '%?', '.')
  return '^' .. p .. '$'
end

VFS.DirList = function(dir, pattern, modes, recursive, ...)
  local out = __cb_dirlist(dir, pattern, modes, recursive, ...)
  if type(out) ~= 'table' then out = {} end
  if modes ~= nil and not string.find(modes, 'M', 1, true) then return out end
  local folder = string.lower(dir or '')
  if folder ~= '' and string.sub(folder, -1) ~= '/' then folder = folder .. '/' end
  local seen = {}
  for _, path in ipairs(out) do seen[string.lower(path)] = true end
  local glob = __cb_glob(pattern)
  local added = false
  for lower, file in pairs(__cb_files) do
    if not seen[lower] and string.sub(lower, 1, #folder) == folder then
      local rest = string.sub(lower, #folder + 1)
      local deeper = string.find(rest, '/', 1, true) ~= nil
      if (recursive or not deeper) and string.find(string.match(rest, '[^/]*$'), glob) then
        out[#out + 1] = file.name
        added = true
      end
    end
  end
  if added then
    table.sort(out, function(a, b) return string.lower(a) < string.lower(b) end)
  end
  return out
end

-- A game's own `print` writes to the worker's stdout under unitsync, which is
-- where this mode's answer goes, so it says nothing while the defs load.
local __cb_print = print
print = function() end
local ok, defs = pcall(VFS.Include, 'gamedata/defs.lua')
print = __cb_print
VFS.Include, VFS.LoadFile = __cb_include, __cb_load
VFS.FileExists, VFS.DirList = __cb_exists, __cb_dirlist
if not ok then return { __error = tostring(defs) } end
if type(defs) ~= 'table' or type(defs.unitdefs) ~= 'table' then
  return { __error = 'defs.lua produced no unitdefs table' }
end

-- One step into a table: a position counted from zero in a list numbered 1
-- to n, the Lua key itself in any other table, and any spelling of a name.
local function __cb_step(t, step)
  if type(t) ~= 'table' then return nil end
  if string.find(step, '^%d+$') then
    local n = tonumber(step)
    local count = 0
    for _ in pairs(t) do count = count + 1 end
    if count > 0 and count == #t then return t[n + 1] end
    if t[n] ~= nil then return t[n] end
  end
  if t[step] ~= nil then return t[step] end
  local lower = string.lower(step)
  for k, v in pairs(t) do
    if type(k) == 'string' and string.lower(k) == lower then return v end
  end
  return nil
end

local parts = {}
for i, read in ipairs(__cb_reads) do
  local v = __cb_step(defs[read.t], read.k)
  for _, step in ipairs(read.p) do v = __cb_step(v, step) end
  if type(v) == 'number' and v == v and v ~= math.huge and v ~= -math.huge then
    local m, e = math.frexp(v)
    parts[i] = '{"m":' .. tostring(m * 16777216) .. ',"e":' .. tostring(e)
      .. ',"q":' .. ((read.e ~= nil and v == read.e) and 'true' or 'false') .. '}'
  else
    parts[i] = 'null'
  end
end
return __cb_chunk('[' .. table.concat(parts, ',') .. ']')
"#;

/// One reading as the script writes it.
#[derive(Debug, Deserialize)]
struct Raw {
    m: f64,
    e: i32,
    q: bool,
}

/// Turn the script's readings into values. `m` is a whole number below
/// 2^24, so `m * 2^(e - 24)` is the float exactly.
fn parse_readings(raw: &str, count: usize) -> RunOutput {
    let parsed: Vec<Option<Raw>> = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(e) => {
            return RunOutput {
                reads: Vec::new(),
                error: Some(format!("could not read the probe's readings: {e}")),
            }
        }
    };
    if parsed.len() != count {
        return RunOutput {
            reads: Vec::new(),
            error: Some(format!("the probe read {} values of {count}", parsed.len())),
        };
    }
    RunOutput {
        reads: parsed
            .into_iter()
            .map(|raw| match raw {
                Some(raw) => Reading {
                    value: Some(raw.m * 2f64.powi(raw.e - 24)),
                    equal: raw.q,
                },
                None => Reading {
                    value: None,
                    equal: false,
                },
            })
            .collect(),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reading_is_the_float_exactly() {
        let out = parse_readings(
            r#"[{"m":8388609,"e":0,"q":false},null,{"m":-12582912,"e":2,"q":true}]"#,
            3,
        );
        assert_eq!(out.error, None);
        assert_eq!(out.reads[0].value, Some(f64::from(0.5f32.next_up())));
        assert_eq!(
            out.reads[1],
            Reading {
                value: None,
                equal: false
            }
        );
        assert_eq!(
            out.reads[2],
            Reading {
                value: Some(-3.0),
                equal: true
            }
        );
    }

    #[test]
    fn a_short_answer_is_an_error() {
        let out = parse_readings("[null]", 2);
        assert!(out.error.is_some());
    }

    #[test]
    fn a_lua_string_holds_any_text_in_ascii() {
        assert_eq!(
            lua_string("a\"b\\c\nd\u{e9}"),
            "\"a\\\"b\\\\c\\010d\\195\\169\""
        );
    }

    #[test]
    fn no_mod_options_leave_the_shim_to_answer() {
        assert_eq!(mod_options_script(&BTreeMap::new()), "");
    }

    #[test]
    fn mod_options_are_installed_as_strings_the_game_reads() {
        let options = BTreeMap::from([("tweakdefs".to_string(), "ZG8gZW5k".to_string())]);
        let script = mod_options_script(&options);
        assert!(
            script.contains("[\"tweakdefs\"] = \"ZG8gZW5k\","),
            "{script}"
        );
        assert!(
            script.contains("Spring.GetModOptions = function()"),
            "{script}"
        );
    }

    #[test]
    fn a_number_prints_so_the_parser_reads_it_back() {
        assert_eq!(lua_number(0.5), "0.5");
        assert_eq!(lua_number(f64::from(5.555_555_3_f32)), "5.55555534362793");
        assert_eq!(lua_number(f64::NAN), "nil");
    }
}
