//! A library weapon equipped on a unit is a weapon the engine can find (issue
//! #3068).
//!
//! The engine finds a slot's weapon, and a death explosion, by full name in
//! the shared weapon table. Both routes write an equipped weapon into the
//! unit's own `weapondefs` and point the slot at `<unit>_<key>`, and only a
//! game's `gamedata/weapondefs_post.lua` puts a unit's own weapons into the
//! shared table under that name. SpringMCLegacy and THIS ship post files that
//! never do, so the weapon has to reach the table another way: a file under
//! `weapons/`, which the base content's `gamedata/weapondefs.lua` reads into
//! the table before any post file runs.
//!
//! Each test here loads a game the way the engine does, through the base
//! content's own `gamedata/defs.lua`, read out of the installed engine's
//! `springcontent.sdz`, with the game's own files read from its installed
//! folder. Both games and the base content are GPL and this repository is MIT,
//! so none of their files are copied in, and a test with nothing installed
//! says so and checks nothing.
//!
//! The sandbox differs from the engine's parser in two ways the loader makes
//! up for. `VFS.Include` ignores the environment it is handed, so the globals
//! the base content's `gamedata/system.lua` gives each def file are set
//! globally instead. And there is no `loadstring`, which SpringMCLegacy's
//! `table.unserialize` needs, so the loader supplies one that reads back the
//! data `table.serialize` writes and nothing else.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use coilbox_springlua::SpringLua;
use serde_json::{json, Map, Value};
use tauri_plugin_coilbox_workshop::{compile, write_in_place, ModProject};

#[allow(dead_code)]
#[path = "../../coilbox-unitsync-worker/src/beforepost.rs"]
mod beforepost;

use beforepost::BeforePost;

/// The newest `springcontent.sdz` among the installed engines, or the one
/// `COILBOX_SPRINGCONTENT` names.
fn springcontent() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("COILBOX_SPRINGCONTENT") {
        return Some(PathBuf::from(path));
    }
    let engines = PathBuf::from(std::env::var_os("HOME")?).join(".spring/engine");
    let mut found = Vec::new();
    for platform in std::fs::read_dir(engines).ok()?.flatten() {
        let Ok(engines) = std::fs::read_dir(platform.path()) else {
            continue;
        };
        for engine in engines.flatten() {
            let path = engine.path().join("base/springcontent.sdz");
            if path.is_file() {
                found.push(path);
            }
        }
    }
    found.sort();
    found.pop()
}

/// The base content's `gamedata/*.lua`, by path.
fn base_content(path: &Path) -> BTreeMap<String, String> {
    let file = std::fs::File::open(path).expect("springcontent.sdz");
    let mut archive = zip::ZipArchive::new(file).expect("a zip");
    let mut out = BTreeMap::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).expect("an entry");
        let name = entry.name().to_string();
        if !name.to_lowercase().starts_with("gamedata/") || !name.ends_with(".lua") {
            continue;
        }
        let mut text = String::new();
        if entry.read_to_string(&mut text).is_ok() {
            out.insert(name, text);
        }
    }
    out
}

/// An installed game and the base content to load it with.
struct Game {
    dir: PathBuf,
    base: BTreeMap<String, String>,
}

fn installed(folder: &str) -> Option<Game> {
    let dir = PathBuf::from(std::env::var_os("HOME")?)
        .join(".spring/games")
        .join(folder);
    if !dir.is_dir() {
        eprintln!("{folder} is not installed, so this checks nothing");
        return None;
    }
    let Some(base) = springcontent() else {
        eprintln!("no engine's springcontent.sdz is installed, so this checks nothing");
        return None;
    };
    Some(Game {
        dir,
        base: base_content(&base),
    })
}

/// One load of a game: the units asked for and every weapon, after
/// post-processing, what the post files changed, and every error the def
/// loaders logged.
struct Loaded {
    units: Map<String, Value>,
    weapons: Map<String, Value>,
    before_post: BeforePost,
    errors: Vec<String>,
}

/// What the sandbox is missing that the def loaders use. See the module's own
/// doc comment.
const SHIM: &str = r#"
LOG = { DEBUG = 'debug', INFO = 'info', NOTICE = 'notice', WARNING = 'warning', ERROR = 'error', FATAL = 'fatal' }
local ERRORS = {}
Spring.Log = function(section, level, ...)
  if level == LOG.ERROR or level == LOG.FATAL then
    ERRORS[#ERRORS + 1] = tostring(section) .. ': ' .. table.concat({ ... }, ' ')
  end
end
Spring.Echo = function() end
Spring.TimeCheck = function(_, fn, ...) return fn(...) end
Spring.GetModOptions = function() return {} end

-- Reads back `return <data>`, as table.serialize writes it.
loadstring = function(src)
  local s = string.gsub(src, '^%s*return%s*', '')
  local i = 1
  local function skip() i = string.find(s, '[^%s]', i) or (#s + 1) end
  local value
  local escapes = { n = '\n', t = '\t', r = '\r', ['\\'] = '\\', ['"'] = '"', ["'"] = "'", ['\n'] = '\n' }
  local function text()
    local quote = string.sub(s, i, i)
    i = i + 1
    local out = {}
    while true do
      local c = string.sub(s, i, i)
      if c == '' then error('an unfinished string') end
      if c == quote then i = i + 1; break end
      if c == '\\' then
        local digits = string.match(s, '^%d%d?%d?', i + 1)
        if digits then
          out[#out + 1] = string.char(tonumber(digits)); i = i + 1 + #digits
        else
          local n = string.sub(s, i + 1, i + 1)
          out[#out + 1] = escapes[n] or n; i = i + 2
        end
      else
        out[#out + 1] = c; i = i + 1
      end
    end
    return table.concat(out)
  end
  value = function()
    skip()
    local c = string.sub(s, i, i)
    if c == '{' then
      i = i + 1
      local t, n = {}, 0
      while true do
        skip()
        if string.sub(s, i, i) == '}' then i = i + 1; return t end
        local key
        if string.sub(s, i, i) == '[' then
          i = i + 1
          key = value()
          skip(); i = i + 1
          skip(); i = i + 1
        else
          local name = string.match(s, '^[%a_][%w_]*%s*=', i)
          if name and string.sub(s, i + #name, i + #name) ~= '=' then
            key = string.match(name, '^[%a_][%w_]*')
            i = i + #name
          end
        end
        local v = value()
        if key == nil then n = n + 1; key = n end
        t[key] = v
        skip()
        local sep = string.sub(s, i, i)
        if sep == ',' or sep == ';' then i = i + 1 end
      end
    elseif c == '"' or c == "'" then
      return text()
    end
    local word = string.match(s, '^[%w_%.%-%+]+', i)
    i = i + #word
    if word == 'true' then return true elseif word == 'false' then return false elseif word == 'nil' then return nil end
    return tonumber(word)
  end
  local result = value()
  return function() return result end
end

for k, v in pairs(VFS.Include('gamedata/system.lua')) do
  if rawget(_G, k) == nil then rawset(_G, k, v) end
end

-- The tables as the post files are handed them, the moment the unitsync
-- worker keeps its copy (`unitdefs.rs`).
local function copy(v, seen)
  if type(v) ~= 'table' then return v end
  if seen[v] then return seen[v] end
  local out = {}
  seen[v] = out
  for k, x in pairs(v) do out[copy(k, seen)] = copy(x, seen) end
  return out
end
local rawUnits, rawWeapons
local include = VFS.Include
VFS.Include = function(name, ...)
  local lower = string.lower(name)
  if lower == 'gamedata/unitdefs_post.lua' and type(UnitDefs) == 'table' then rawUnits = copy(UnitDefs, {}) end
  if lower == 'gamedata/weapondefs_post.lua' and type(WeaponDefs) == 'table' then rawWeapons = copy(WeaponDefs, {}) end
  return include(name, ...)
end
"#;

/// Load the game in `dir` through the base content's `gamedata/defs.lua`,
/// with `mutator`'s files on top: each one takes the place of a game file of
/// the same name, and the loaders' folder listings see it.
fn load(game: &Game, dir: &Path, mutator: &[(String, String)], units: &[&str]) -> Loaded {
    let mut files: BTreeMap<PathBuf, String> = BTreeMap::new();
    for (path, text) in &game.base {
        if !coilbox_springlua::resolve_case(dir, Path::new(path)).exists() {
            files.insert(dir.join(path), text.clone());
        }
    }
    for (path, text) in mutator {
        files.insert(dir.join(path), text.clone());
    }
    let quoted = |items: &mut dyn Iterator<Item = &str>| {
        items
            .map(|item| format!("{item:?}"))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let source = format!(
        r#"(function()
{SHIM}
  local added = {{ {added} }}
  local dirList = VFS.DirList
  VFS.DirList = function(dir, pattern, mode, recursive)
    local out = dirList(dir, pattern, mode, recursive)
    local lowerDir = string.lower(dir)
    local ext = string.lower(string.match(pattern or '', '%.[^.]+$') or '')
    for _, path in ipairs(added) do
      local lower = string.lower(path)
      if string.sub(lower, 1, #lowerDir) == lowerDir and string.sub(lower, -#ext) == ext then
        out[#out + 1] = path
      end
    end
    return out
  end
  local ok, defs = pcall(VFS.Include, 'gamedata/defs.lua')
  if not ok then ERRORS[#ERRORS + 1] = tostring(defs); defs = {{}} end
  -- Data only. SpringMCLegacy's class-built tables carry their methods, and
  -- its text colours are bytes that are not UTF-8, which come back escaped.
  local function plain(v, seen)
    if type(v) == 'function' then return nil end
    if type(v) == 'string' then
      return (string.gsub(v, '[\128-\255]', function(c) return string.format('\\%03d', string.byte(c)) end))
    end
    if type(v) ~= 'table' then return v end
    if seen[v] then return seen[v] end
    local out = {{}}
    seen[v] = out
    for k, x in pairs(v) do out[k] = plain(x, seen) end
    return out
  end
  -- The units asked for, or every one when none are named.
  local wanted = {{ {units} }}
  local function pick(t)
    local out = {{}}
    if #wanted == 0 then
      for name, def in pairs(t or {{}}) do out[name] = plain(def, {{}}) end
    end
    for _, name in ipairs(wanted) do out[name] = t and plain(t[name], {{}}) end
    return out
  end
  return {{
    errors = ERRORS,
    units = pick(defs.unitdefs),
    weapons = plain(defs.weapondefs or {{}}, {{}}),
    rawUnits = pick(rawUnits),
    rawWeapons = plain(rawWeapons or {{}}, {{}}),
  }}
end)()"#,
        added = quoted(&mut mutator.iter().map(|(path, _)| path.as_str())),
        units = quoted(&mut units.iter().copied()),
    );
    let vm = SpringLua::with_files(dir, files).expect("vm");
    let out = vm
        .eval_expr_value(&source, "load.lua")
        .unwrap_or_else(|e| panic!("{e}"));
    let table = |key: &str| -> Map<String, Value> {
        match &out[key] {
            Value::Object(map) => map.clone(),
            _ => Map::new(),
        }
    };
    let errors = match &out["errors"] {
        Value::Array(items) => items
            .iter()
            .map(|e| e.as_str().unwrap_or_default().to_string())
            .collect(),
        _ => Vec::new(),
    };
    let (units, weapons) = (table("units"), table("weapons"));
    let before_post = BeforePost::read(&units, &weapons, &table("rawUnits"), &table("rawWeapons"));
    Loaded {
        units,
        weapons,
        before_post,
        errors,
    }
}

fn project(game: &str, edits: Value) -> ModProject {
    serde_json::from_value(json!({
        "name": "TEST library weapons (delete me)",
        "gameName": game,
        "edits": edits,
    }))
    .expect("parse")
}

fn mutator(project: &ModProject) -> Vec<(String, String)> {
    compile(project)
        .files
        .into_iter()
        .map(|file| (file.path, file.contents))
        .collect()
}

/// A copy of the game weapon `source` into the library under `key`, as the
/// Weapons tab makes one.
fn copied_weapon(game: &Loaded, source: &str, key: &str) -> Value {
    json!({
        "key": key,
        "source": source,
        "def": game.weapons[source],
        "beforePost": game.before_post.weapon_defs.get(source),
    })
}

/// The name the unit's slot at `step`, counted from zero, fires.
fn slot_weapon(loaded: &Loaded, unit: &str, step: usize) -> String {
    let weapons = &loaded.units[unit]["weapons"];
    let slot = match weapons {
        Value::Array(items) => &items[step],
        Value::Object(map) => &map[&(step + 1).to_string()],
        _ => panic!("{unit} has no weapons"),
    };
    slot["name"]
        .as_str()
        .unwrap_or_else(|| panic!("{unit}'s slot {step} names nothing"))
        .to_lowercase()
}

/// The engine's own lookup: a weapon by its name, lowercased.
fn weapon<'a>(loaded: &'a Loaded, name: &str) -> Option<&'a Value> {
    loaded.weapons.get(&name.to_lowercase())
}

/// A library copy of the weapon in `unit`'s first slot, equipped back into
/// that slot and as its death explosion on the mutator route, loads as a
/// weapon the engine finds, equal to the one it was copied from.
fn equipped_through_the_mutator(game: &Game, name: &str, unit: &str) {
    let alone = load(game, &game.dir, &[], &[unit]);
    assert_eq!(alone.errors, Vec::<String>::new(), "{name} alone");
    let source = slot_weapon(&alone, unit, 0);
    let key = format!("{source}_copy");
    let project = project(
        name,
        json!({
            "weapons": { &key: copied_weapon(&alone, &source, &key) },
            "equipped": { unit: { "0": &key, "explodeas": &key } },
        }),
    );
    let modded = load(game, &game.dir, &mutator(&project), &[unit]);
    assert_eq!(
        modded.errors,
        Vec::<String>::new(),
        "{name} with the mutator"
    );
    let full = format!("{unit}_{key}");
    assert_eq!(slot_weapon(&modded, unit, 0), full, "the slot's weapon");
    let fired = weapon(&modded, &full)
        .unwrap_or_else(|| panic!("{unit}'s slot fires {full}, which is not in the weapon table"));
    assert_eq!(
        fired, &modded.weapons[&source],
        "the copy against the weapon it was copied from"
    );
    let explodes = modded.units[unit]["explodeas"]
        .as_str()
        .expect("an explodeas")
        .to_lowercase();
    assert_eq!(explodes, full);
    assert!(
        weapon(&modded, &explodes).is_some(),
        "{unit} explodes as {explodes}, which is not in the weapon table"
    );
}

/// A copy of `game` to write into: every def file and every other file as an
/// empty stand-in, so a check for a model or texture still finds one, in a
/// `games` folder as the in-place route requires.
fn scratch_copy(game: &Game, into: &Path) -> PathBuf {
    let dir = into
        .join("games")
        .join(game.dir.file_name().expect("a folder"));
    fn walk(from: &Path, to: &Path) {
        std::fs::create_dir_all(to).expect("mkdir");
        for entry in std::fs::read_dir(from).expect("read_dir").flatten() {
            let path = entry.path();
            let target = to.join(entry.file_name());
            if path.is_dir() {
                walk(&path, &target);
                continue;
            }
            let text = path.extension().is_some_and(|e| {
                ["lua", "fbi", "tdf", "txt"]
                    .iter()
                    .any(|x| e.eq_ignore_ascii_case(x))
            });
            if text {
                std::fs::copy(&path, &target).expect("copy");
            } else {
                std::fs::write(&target, b"").expect("stand-in");
            }
        }
    }
    walk(&game.dir, &dir);
    dir
}

/// Every unit in `units` with a weapon, or every unit in the game when it is
/// empty, given a library copy of its first slot's weapon in that slot and as
/// its death explosion, written into a copy of the game in place. Each equip
/// the write carries has to load as a weapon the engine finds, equal to the
/// one it was copied from. Returns how many the write carried, and the
/// sentences it gave for the rest.
fn equipped_in_place(game: &Game, name: &str, units: &[&str]) -> (usize, Vec<String>) {
    let scratch = tempfile::tempdir().expect("tempdir");
    let dir = scratch_copy(game, scratch.path());
    let alone = load(game, &dir, &[], units);
    assert_eq!(alone.errors, Vec::<String>::new(), "{name} alone");
    let mut weapons = Map::new();
    let mut equipped = Map::new();
    let mut sources = BTreeMap::new();
    for (unit, def) in &alone.units {
        let has_weapon = match &def["weapons"] {
            Value::Array(items) => items.first().is_some_and(|slot| slot["name"].is_string()),
            Value::Object(map) => map.get("1").is_some_and(|slot| slot["name"].is_string()),
            _ => false,
        };
        if !has_weapon {
            continue;
        }
        let source = slot_weapon(&alone, unit, 0);
        if !alone.weapons.contains_key(&source) {
            continue;
        }
        let key = format!("{source}_copy");
        weapons.insert(key.clone(), copied_weapon(&alone, &source, &key));
        equipped.insert(unit.clone(), json!({ "0": key, "explodeas": key }));
        sources.insert(unit.clone(), def.clone());
    }
    assert!(!equipped.is_empty(), "{name} has none of those units armed");
    let project = project(name, json!({ "weapons": weapons, "equipped": equipped }));
    let outcome = write_in_place(&dir, &project, &sources).expect("write");
    assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
    let written = load(game, &dir, &[], units);
    assert_eq!(written.errors, Vec::<String>::new(), "{name} as written");
    for equip in &outcome.equipped {
        let unit = equip.unit.as_str();
        let key = &equip.weapon;
        let full = format!("{unit}_{key}");
        let fired = if equip.at == "0" {
            assert_eq!(slot_weapon(&written, unit, 0), full, "{unit}'s slot");
            full.clone()
        } else {
            written.units[unit][&equip.at]
                .as_str()
                .unwrap_or_else(|| panic!("{unit} has no {}", equip.at))
                .to_lowercase()
        };
        let loaded = weapon(&written, &fired).unwrap_or_else(|| {
            panic!(
                "{unit}'s {} is {fired}, which is not in the weapon table",
                equip.at
            )
        });
        let source = key.strip_suffix("_copy").expect("a copy");
        assert_eq!(loaded, &written.weapons[source], "{fired} against {source}");
    }
    (outcome.equipped.len(), outcome.not_carried)
}

/// SpringMCLegacy's own `gamedata/unitdefs_post.lua` gives every unit its
/// model, so a mutator that covers it with one of its own, as any equip does,
/// loads a game with no units at all (issue #2744, which the project's checks
/// report). What this issue can put right is the weapon: it is in the table
/// under the name the slot is given.
#[test]
fn a_library_weapon_reaches_the_weapon_table_through_the_mutator_in_springmclegacy() {
    let Some(game) = installed("SpringMCLegacy.sdd") else {
        return;
    };
    let unit = "cc_hunchback_hbk4g";
    let alone = load(&game, &game.dir, &[], &[unit]);
    assert_eq!(alone.errors, Vec::<String>::new());
    let source = slot_weapon(&alone, unit, 0);
    let key = format!("{source}_copy");
    let project = project(
        "SpringMCLegacy",
        json!({
            "weapons": { &key: copied_weapon(&alone, &source, &key) },
            "equipped": { unit: { "0": &key } },
        }),
    );
    let modded = load(&game, &game.dir, &mutator(&project), &[unit]);
    assert!(
        modded
            .errors
            .iter()
            .any(|e| e.contains(&format!("removed {unit} unitDef, missing objectname param"))),
        "the mutator no longer loses the game's units, so this test can check the slot too: {:?}",
        modded.errors
    );
    let full = format!("{unit}_{key}");
    let loaded =
        weapon(&modded, &full).unwrap_or_else(|| panic!("{full} is not in the weapon table"));
    assert_eq!(loaded, &modded.weapons[&source]);
}

#[test]
fn a_library_weapon_reaches_the_weapon_table_through_the_mutator_in_this() {
    let Some(game) = installed("THIS.sdd") else {
        return;
    };
    // One unit written in Lua and one in the `.fbi` format.
    equipped_through_the_mutator(&game, "THIS", "carrier");
    equipped_through_the_mutator(&game, "THIS", "dagger");
}

/// Most of SpringMCLegacy's units share one table between factions, which the
/// write refuses to change for one of them and says so. Every one it does
/// write has to load.
#[test]
fn a_library_weapon_written_in_place_reaches_the_weapon_table_in_springmclegacy() {
    let Some(game) = installed("SpringMCLegacy.sdd") else {
        return;
    };
    let (written, not_carried) = equipped_in_place(&game, "SpringMCLegacy", &[]);
    eprintln!(
        "{written} equips written, {} left to the mutator",
        not_carried.len()
    );
    assert!(written > 0, "nothing was written: {not_carried:?}");
}

/// THIS writes most of its units in the `.fbi` format, which has no table for
/// a unit's own weapons, so the weapon file is the only way one reaches them.
#[test]
fn a_library_weapon_written_in_place_reaches_the_weapon_table_in_this() {
    let Some(game) = installed("THIS.sdd") else {
        return;
    };
    let (written, not_carried) = equipped_in_place(&game, "THIS", &["carrier", "dagger"]);
    assert_eq!(written, 4, "{not_carried:?}");
}

/// The weapon files change nothing in a game that keeps the base content's
/// own `gamedata/weapondefs_post.lua`, as XTA does: it writes the unit's own
/// entry over each one under the same name, so every unit and weapon loads
/// the same with them as without them.
#[test]
fn weapon_files_change_nothing_under_the_base_contents_own_post_file() {
    let Some(base) = springcontent() else {
        eprintln!("no engine's springcontent.sdz is installed, so this checks nothing");
        return;
    };
    let root = tempfile::tempdir().expect("tempdir");
    let dir = root.path().join("games/model.sdd");
    for (path, text) in [
        (
            "units/armcom.lua",
            "return { armcom = {\n  objectname = \"armcom.s3o\",\n  explodeas = \"COMMANDER_BLAST\",\n  weapons = { [1] = { def = \"ARMCOMLASER\" } },\n  weapondefs = { armcomlaser = { range = 300, weapontype = \"LaserCannon\" } },\n} }\n",
        ),
        (
            "weapons/commander_blast.lua",
            "return { commander_blast = { areaofeffect = 720, weapontype = \"Cannon\" } }\n",
        ),
        // The base content drops a unit whose model is missing.
        ("objects3d/armcom.s3o", ""),
    ] {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    let game = Game {
        dir: dir.clone(),
        base: base_content(&base),
    };
    let alone = load(&game, &dir, &[], &["armcom"]);
    assert_eq!(alone.errors, Vec::<String>::new());
    let project = project(
        "model",
        json!({
            "weapons": {
                "laser_copy": copied_weapon(&alone, "armcom_armcomlaser", "laser_copy"),
                "blast_copy": copied_weapon(&alone, "commander_blast", "blast_copy"),
            },
            "equipped": { "armcom": { "0": "laser_copy", "explodeas": "blast_copy" } },
        }),
    );
    let files = mutator(&project);
    let without: Vec<(String, String)> = files
        .iter()
        .filter(|(path, _)| !path.starts_with("weapons/"))
        .cloned()
        .collect();
    assert_eq!(files.len() - without.len(), 2, "two weapon files");
    let with_them = load(&game, &dir, &files, &["armcom"]);
    let without_them = load(&game, &dir, &without, &["armcom"]);
    assert_eq!(with_them.errors, Vec::<String>::new());
    assert_eq!(with_them.units, without_them.units);
    assert_eq!(with_them.weapons, without_them.weapons);
    assert_eq!(slot_weapon(&with_them, "armcom", 0), "armcom_laser_copy");
}
