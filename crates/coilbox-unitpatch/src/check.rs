//! The post-check. Both the original and the patched file are run through
//! the sandboxed Spring Lua evaluator, and the two tables they return are
//! compared.
//!
//! A unit file on its own does not run: it calls `lowerkeys`, and it may
//! build its unit from a class such as `Tank` that the game defines in
//! `gamedata/unitdefs_pre.lua`. Running the whole game to get those would pull
//! in engine calls the sandbox does not have. The file runs instead with
//! `lowerkeys` defined and with every global it reads but nobody set standing
//! in as an empty class whose `New` merges tables as the games' own class
//! helpers do. That gives the same answer before and after the edit, which is
//! all the comparison needs. It is not the unit as the engine sees it.
//!
//! `Spring.GetModOptions()` is stood in too (issue #3038): it reads the
//! game's own `ModOptions.lua` for a declared option's default, and answers
//! `1` for one nobody declared, so a unit file that multiplies by a mod
//! option still runs.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use coilbox_springlua::SpringLua;
use serde_json::{Map, Value as Json};

use crate::{TableKey, Value};

/// Run before the unit file. Defines `lowerkeys`, the stand-in class, and a
/// function that turns the returned table into one JSON can hold: keys
/// lowercased as the engine lowercases them, and numeric keys written as
/// `[1]` so they cannot collide with string keys.
const PRELUDE: &str = r#"
if rawget(_G, "lowerkeys") == nil then lowerkeys = __lowerkeys end
local __cbx_class = {}
local __cbx_meta = { __index = __cbx_class }
local function __cbx_merge(target, source)
  for key, value in pairs(source) do
    if type(key) == "string" then key = string.lower(key) end
    if type(value) == "table" then
      if target[key] == nil then target[key] = {} end
      if type(target[key]) == "table" then __cbx_merge(target[key], value) end
    elseif type(value) ~= "function" and target[key] == nil then
      target[key] = value
    end
  end
end
function __cbx_class.New(self, attributes)
  local object = setmetatable({}, __cbx_meta)
  if type(attributes) == "table" then __cbx_merge(object, attributes) end
  __cbx_merge(object, self)
  return object
end
function __cbx_class.Clone(self)
  return __cbx_class.New(self)
end
function __cbx_class.Append(self, attributes)
  local object = __cbx_class.New(self)
  for key, value in pairs(attributes or {}) do
    if type(key) == "string" then key = string.lower(key) end
    if type(value) == "string" then object[key] = value .. " " .. (object[key] or "") end
  end
  return object
end
local __cbx_stubs = {}
setmetatable(_G, { __index = function(_, name)
  local stub = __cbx_stubs[name]
  if stub == nil then
    stub = setmetatable({}, __cbx_meta)
    __cbx_stubs[name] = stub
  end
  return stub
end })
-- Spring.GetModOptions(), stood in so a unit file that reads it can still
-- run (issue #3038). A declared option reads as the game's own default from
-- its ModOptions.lua (matched case-insensitively, as the engine matches
-- files); an option nobody declared, such as SplinterFaction's
-- chicken_queentimemult, reads as 1, which is enough for the arithmetic a
-- unit file does with it to run. Both the original and the patched run read
-- this same table, so the comparison the post-check makes never sees it move.
local __cbx_modoptions_declared = {}
do
  local ok, declared = pcall(VFS.Include, "modoptions.lua")
  if ok and type(declared) == "table" then
    for _, option in pairs(declared) do
      if type(option) == "table" and type(option.key) == "string"
        and option.type ~= "section" and option.def ~= nil then
        __cbx_modoptions_declared[string.lower(option.key)] = option.def
      end
    end
  end
end
local __cbx_modoptions = setmetatable({}, { __index = function(_, key)
  if type(key) == "string" then
    local declared = __cbx_modoptions_declared[string.lower(key)]
    if declared ~= nil then return declared end
  end
  return 1
end })
if type(Spring.GetModOptions) ~= "function" then
  Spring.GetModOptions = function() return __cbx_modoptions end
end
local function __cbx_plain(value, depth)
  local kind = type(value)
  if kind == "number" or kind == "string" or kind == "boolean" then return value end
  if kind ~= "table" then return "<" .. kind .. ">" end
  if depth > 40 then return "<nested too deep>" end
  local out = {}
  for key, item in pairs(value) do
    if type(key) == "string" then key = string.lower(key)
    elseif type(key) == "number" then key = "[" .. tostring(key) .. "]"
    else key = "<" .. type(key) .. " key>" end
    out[key] = __cbx_plain(item, depth + 1)
  end
  return out
end
"#;

/// Run `source` as a unit file and return what it returned, in the form
/// described on [`PRELUDE`]. `VFS` reads `files` in place of the disk.
pub fn evaluate(
    source: &str,
    game_root: &Path,
    name: &str,
    files: BTreeMap<PathBuf, String>,
) -> Result<Json, String> {
    let lua = SpringLua::with_files(game_root, files).map_err(|e| e.to_string())?;
    let chunk = format!(
        "{PRELUDE}\nlocal __cbx_unit = function(...)\n{source}\nend\nreturn __cbx_plain(__cbx_unit(), 0)\n"
    );
    let value = lua
        .eval_value_raw(&chunk, name)
        .map_err(|e| e.to_string())?;
    Ok(tidy(value))
}

/// An empty Lua table crosses as an empty JSON array, a filled one as an
/// object. Make both objects so the comparison sees one shape.
fn tidy(value: Json) -> Json {
    match value {
        Json::Array(items) if items.is_empty() => Json::Object(Map::new()),
        Json::Object(map) => Json::Object(map.into_iter().map(|(k, v)| (k, tidy(v))).collect()),
        other => other,
    }
}

fn at<'a>(root: &'a Json, path: &[String]) -> Option<&'a Json> {
    path.iter()
        .try_fold(root, |value, key| value.as_object()?.get(key))
}

/// How many entries the list at `path` holds, counting `[1]`, `[2]`, ... up
/// to the first gap, as Lua's `#` would for a list written out in a file.
pub fn list_length(root: &Json, path: &[String]) -> usize {
    let Some(Json::Object(map)) = at(root, path) else {
        return 0;
    };
    (1..)
        .take_while(|n| map.contains_key(&format!("[{n}]")))
        .count()
}

/// Whether the value at `path` is already `value`.
pub fn holds(root: &Json, path: &[String], value: &Value) -> bool {
    at(root, path).is_some_and(|found| matches(found, value))
}

fn matches(found: &Json, value: &Value) -> bool {
    match (found, value) {
        (Json::Bool(a), Value::Bool(b)) => a == b,
        (Json::Number(a), Value::Number(b)) => a.as_f64() == Some(*b),
        (Json::String(a), Value::String(b)) => a == b,
        (found @ Json::Object(_), Value::Table(_)) => differing(found, &json(value)).is_empty(),
        _ => false,
    }
}

/// Every path at which `before` and `after` differ. A path that is present
/// on one side only counts, and so does a table on one side where the other
/// has something else.
fn differences(before: &Json, after: &Json, path: &mut Vec<String>, out: &mut Vec<Vec<String>>) {
    match (before, after) {
        (Json::Object(a), Json::Object(b)) => {
            let mut keys: Vec<&String> = a.keys().chain(b.keys()).collect();
            keys.sort();
            keys.dedup();
            for key in keys {
                path.push(key.clone());
                match (a.get(key), b.get(key)) {
                    (Some(x), Some(y)) => differences(x, y, path, out),
                    _ => out.push(path.clone()),
                }
                path.pop();
            }
        }
        (Json::Number(a), Json::Number(b)) if a.as_f64() == b.as_f64() => {}
        (a, b) if a == b => {}
        _ => out.push(path.clone()),
    }
}

/// Every path, dotted, at which `a` and `b` differ.
pub fn differing(a: &Json, b: &Json) -> Vec<String> {
    let mut found = Vec::new();
    differences(a, b, &mut Vec::new(), &mut found);
    found.iter().map(|path| path.join(".")).collect()
}

/// `value` in the form [`evaluate`] returns: keys lowercased, positions
/// written `[1]`.
fn json(value: &Value) -> Json {
    match value {
        Value::Bool(b) => Json::Bool(*b),
        Value::Number(n) => serde_json::Number::from_f64(*n).map_or(Json::Null, Json::Number),
        Value::String(s) => Json::String(s.clone()),
        Value::Table(entries) => Json::Object(
            entries
                .iter()
                .map(|(key, item)| {
                    let key = match key {
                        TableKey::Name(name) => name.to_lowercase(),
                        TableKey::Index(index) => format!("[{index}]"),
                    };
                    (key, json(item))
                })
                .collect(),
        ),
    }
}

/// The table at `path` in `root`, made on the way where it is missing.
fn table_at<'a>(root: &'a mut Json, path: &[String]) -> &'a mut Map<String, Json> {
    let mut current = root;
    for key in path {
        if !current.is_object() {
            *current = Json::Object(Map::new());
        }
        current = current
            .as_object_mut()
            .expect("made an object above")
            .entry(key.clone())
            .or_insert_with(|| Json::Object(Map::new()));
    }
    if !current.is_object() {
        *current = Json::Object(Map::new());
    }
    current.as_object_mut().expect("made an object above")
}

/// `root` with `value` at `path`, as a set would leave it.
pub fn set(root: &mut Json, path: &[String], value: &Value) {
    let Some((last, parent)) = path.split_last() else {
        return;
    };
    table_at(root, parent).insert(last.clone(), json(value));
}

/// `root` with `value` on the end of the list at `path`, as a push would
/// leave it.
pub fn push(root: &mut Json, path: &[String], value: &Value) {
    let length = list_length(root, path);
    table_at(root, path).insert(format!("[{}]", length + 1), json(value));
}

/// Confirm `after` is `before` with only the value at `expected` changed, to
/// `value`, and each path in `linked` also changed to `value` (issue #3079):
/// a field that reads the very same global as the edited one, such as
/// `selfDestructAs` reading `explodeAs`'s global too. The error is a sentence
/// for the person who asked for the edit.
pub fn confirm(
    before: &Json,
    after: &Json,
    expected: &[String],
    value: &Value,
    linked: &[Vec<String>],
) -> Result<(), String> {
    if let Value::Table(_) = value {
        return confirm_table(before, after, expected, value);
    }
    let mut found = Vec::new();
    differences(before, after, &mut Vec::new(), &mut found);
    let others: Vec<String> = found
        .iter()
        .filter(|path| {
            path.as_slice() != expected
                && !linked.iter().any(|linked| {
                    linked.as_slice() == path.as_slice()
                        && at(after, linked).is_some_and(|found| matches(found, value))
                })
        })
        .map(|path| path.join("."))
        .collect();
    if !others.is_empty() {
        let shown: Vec<&str> = others.iter().take(5).map(String::as_str).collect();
        let more = if others.len() > shown.len() {
            format!(" and {} more", others.len() - shown.len())
        } else {
            String::new()
        };
        return Err(format!(
            "The edit would also change {}{more}, so it was not made.",
            shown.join(", ")
        ));
    }
    if found.is_empty() {
        return Err(
            "The edit made no difference to what the file returns. Something later in the file, or a table it inherits from, decides this value."
                .into(),
        );
    }
    match at(after, expected) {
        Some(found) if matches(found, value) => Ok(()),
        _ => Err(format!(
            "After the edit the file returns a different value for {} than the one asked for.",
            expected.join(".")
        )),
    }
}

/// [`confirm`] for a whole table. `after` has to be exactly `before` with the
/// table at `expected`, and any table on the way there that `before` did not
/// have, which is how the file's own table grows a `weapondefs` it did not
/// have. Every key inside the new table is compared, not only its presence.
fn confirm_table(
    before: &Json,
    after: &Json,
    expected: &[String],
    value: &Value,
) -> Result<(), String> {
    let mut wanted = before.clone();
    let Some((last, parent)) = expected.split_last() else {
        return Err("The edit names no field.".into());
    };
    table_at(&mut wanted, parent).insert(last.clone(), json(value));
    let mut off = Vec::new();
    differences(&wanted, after, &mut Vec::new(), &mut off);
    let (inside, others): (Vec<_>, Vec<_>) =
        off.into_iter().partition(|path| path.starts_with(expected));
    if !others.is_empty() {
        let shown: Vec<String> = others.iter().take(5).map(|p| p.join(".")).collect();
        let more = match others.len() - shown.len() {
            0 => String::new(),
            n => format!(" and {n} more"),
        };
        return Err(format!(
            "The edit would also change {}{more}, so it was not made.",
            shown.join(", ")
        ));
    }
    if let Some(path) = inside.first() {
        return Err(format!(
            "After the edit the file returns a different value for {} than the one asked for.",
            path.join(".")
        ));
    }
    if differing(before, after).is_empty() {
        return Err(
            "The edit made no difference to what the file returns. Something later in the file, or a table it inherits from, decides this value."
                .into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn path(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| part.to_string()).collect()
    }

    #[test]
    fn finds_every_differing_path() {
        let before = json!({ "u": { "a": 1, "b": { "c": "x" }, "gone": true } });
        let after = json!({ "u": { "a": 1.0, "b": { "c": "y" }, "new": 2 } });
        let mut found = Vec::new();
        differences(&before, &after, &mut Vec::new(), &mut found);
        assert_eq!(
            found,
            vec![
                path(&["u", "b", "c"]),
                path(&["u", "gone"]),
                path(&["u", "new"])
            ]
        );
    }

    #[test]
    fn confirm_wants_exactly_the_expected_change() {
        let before = json!({ "u": { "a": 1, "b": 2 } });
        let expected = path(&["u", "a"]);
        let one = json!({ "u": { "a": 5, "b": 2 } });
        assert!(confirm(&before, &one, &expected, &Value::Number(5.0), &[]).is_ok());
        let wrong = json!({ "u": { "a": 6, "b": 2 } });
        assert!(confirm(&before, &wrong, &expected, &Value::Number(5.0), &[]).is_err());
        let two = json!({ "u": { "a": 5, "b": 3 } });
        let message = confirm(&before, &two, &expected, &Value::Number(5.0), &[]).unwrap_err();
        assert!(message.contains("u.b"), "{message}");
        assert!(confirm(&before, &before, &expected, &Value::Number(5.0), &[]).is_err());
    }

    #[test]
    fn confirm_allows_a_linked_field_that_moves_to_the_same_value() {
        let before = json!({ "u": { "a": 1, "b": 1 } });
        let expected = path(&["u", "a"]);
        let linked = vec![path(&["u", "b"])];
        let both = json!({ "u": { "a": 5, "b": 5 } });
        assert!(confirm(&before, &both, &expected, &Value::Number(5.0), &linked).is_ok());
        let diverged = json!({ "u": { "a": 5, "b": 3 } });
        let message =
            confirm(&before, &diverged, &expected, &Value::Number(5.0), &linked).unwrap_err();
        assert!(message.contains("u.b"), "{message}");
    }

    #[test]
    fn list_length_stops_at_the_first_gap() {
        let root = json!({ "u": { "l": { "[1]": "a", "[2]": "b", "[4]": "d" } } });
        assert_eq!(list_length(&root, &path(&["u", "l"])), 2);
        assert_eq!(list_length(&root, &path(&["u", "missing"])), 0);
    }
}
