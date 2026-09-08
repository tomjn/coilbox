//! Writing Lua source out of JSON values.
//!
//! A port of `src/lib/lua.ts`, kept to the same output rules so that Lua
//! coilbox writes reads the same wherever it was written: bare keys where Lua
//! allows one, double quoted strings, a trailing comma on every entry, a
//! sequence written with its indices, and a table of nothing but scalars kept
//! on one line up to sixty columns.
//!
//! Matching that file matters more than it looks. The unit page already prints
//! a game's own definitions back as Lua through `luaLiteral`, and a modder
//! comparing what they read there against what this compiler emitted should not
//! have to work out whether two spellings of the same table are the same table.

use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt::Write as _;

/// Indent per level. Spaces rather than tabs, as `src/lib/lua.ts` explains.
const INDENT: &str = "  ";

/// Width at which a table of nothing but scalars stays on one line.
const INLINE_WIDTH: usize = 60;

/// Lua's reserved words, which cannot be used as a bare table key.
const KEYWORDS: &[&str] = &[
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in", "local",
    "nil", "not", "or", "repeat", "return", "then", "true", "until", "while",
];

/// Quote a string as a Lua literal.
///
/// Anything above ASCII is left alone: Lua strings are byte strings and the
/// file is written as UTF-8, so the bytes survive unchanged, which is what a
/// unit named in Russian needs. Control characters become three digit `\ddd`
/// escapes, and the padding is not optional: `\0` followed by `5` would
/// otherwise read back as byte 5.
pub fn lua_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {
                let _ = write!(out, "\\{:03}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Whether `key` can be written as a bare table key. Not cosmetic: `repeat` is
/// both a Lua keyword and a real field name.
pub fn is_lua_identifier(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return false;
    }
    !KEYWORDS.contains(&key)
}

/// Whether a JSON object key is one Lua indexes as a number.
///
/// A JavaScript object cannot hold a numeric key, so a Lua table indexed by
/// number arrives from the unitsync worker with string keys. Writing `["1"]`
/// would produce a table the engine reads differently from the one the game
/// wrote.
fn integer_key(key: &str) -> Option<i64> {
    let digits = key.strip_prefix('-').unwrap_or(key);
    if digits.is_empty() || digits.len() > 15 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if digits.len() > 1 && digits.starts_with('0') {
        return None;
    }
    if key == "-0" {
        return None;
    }
    key.parse().ok()
}

/// One key of a table, as Lua source.
fn table_key(key: &str) -> String {
    if is_lua_identifier(key) {
        return key.to_string();
    }
    match integer_key(key) {
        Some(n) => format!("[{n}]"),
        None => format!("[{}]", lua_string(key)),
    }
}

/// A number as Lua source. JSON carries neither infinity nor NaN, so the only
/// job here is to keep an integer looking like one rather than printing `5.0`
/// where the game wrote `5`.
fn lua_number(value: &serde_json::Number) -> String {
    value.to_string()
}

/// A JSON value as a Lua literal, one table entry per line.
///
/// A JSON array is written with its indices, `[1] = "armsolar"`, rather than as
/// a positional list, because both Balanced Annihilation and Beyond All Reason
/// write their own sequences that way.
pub fn lua_literal(value: &Value, indent: &str) -> String {
    match value {
        Value::Null => "nil".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => lua_number(n),
        Value::String(s) => lua_string(s),
        Value::Array(items) => {
            let entries: Vec<(String, &Value)> = items
                .iter()
                .enumerate()
                .map(|(i, item)| (format!("[{}]", i + 1), item))
                .collect();
            render_table(&entries, indent)
        }
        Value::Object(map) => {
            let entries: Vec<(String, &Value)> =
                map.iter().map(|(k, v)| (table_key(k), v)).collect();
            render_table(&entries, indent)
        }
    }
}

/// The shared table body, so an array and an object are laid out identically.
fn render_table(entries: &[(String, &Value)], indent: &str) -> String {
    if entries.is_empty() {
        return "{}".to_string();
    }
    let inner = format!("{indent}{INDENT}");
    let parts: Vec<String> = entries
        .iter()
        .map(|(key, item)| format!("{key} = {}", lua_literal(item, &inner)))
        .collect();

    // A collision volume or a colour reads far better on one line than as four.
    let inline = format!("{{ {} }}", parts.join(", "));
    let scalars = entries
        .iter()
        .all(|(_, item)| !matches!(item, Value::Array(_) | Value::Object(_)));
    if scalars && inline.chars().count() + indent.chars().count() <= INLINE_WIDTH {
        return inline;
    }

    let body = parts
        .iter()
        .map(|part| format!("{inner}{part},"))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{{\n{body}\n{indent}}}")
}

/// A key in a patch tree: either a field name or a Lua array index.
///
/// Ordered so that indices come first and in numeric order, which is how a
/// patch against `weapons[1]` and `weapons[2]` reads, and names after them in
/// alphabetical order. The whole point is that two runs of the compiler over
/// the same project produce byte-identical Lua.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum PatchKey {
    Index(i64),
    Name(String),
}

impl PatchKey {
    fn as_lua(&self) -> String {
        match self {
            PatchKey::Index(n) => format!("[{n}]"),
            PatchKey::Name(name) => table_key(name),
        }
    }
}

/// A sparse patch, as a tree rather than as a JSON value.
///
/// JSON cannot express "the fourth element of this array and nothing else": an
/// array with three nulls in front of it says something different, and an
/// object keyed `"4"` says something different again. A patch against
/// `weapons.3.name` has to come out as `weapons = { [4] = { name = ... } }`,
/// with no mention of the three weapons it does not touch, or the merge that
/// applies it would blank them.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct PatchTree(BTreeMap<PatchKey, PatchNode>);

#[derive(Debug, Clone, PartialEq)]
pub enum PatchNode {
    Leaf(Value),
    Branch(PatchTree),
}

impl PatchTree {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Write one dotted path into the tree.
    ///
    /// A step of nothing but digits is an array index, which is the rule
    /// `overrides.ts` writes paths under: its `readPath` indexes a JavaScript
    /// array with the step, so `weapons.0` is the first mount. Lua counts from
    /// one, so the step is written out one higher than it was stored.
    ///
    /// A path that runs through a value already set replaces it, because the
    /// last thing the user said about a field is what they meant.
    pub fn insert(&mut self, path: &str, value: Value) {
        let steps: Vec<&str> = path.split('.').collect();
        let mut node = self;
        for step in &steps[..steps.len() - 1] {
            let entry = node
                .0
                .entry(step_key(step))
                .or_insert_with(|| PatchNode::Branch(PatchTree::new()));
            if !matches!(entry, PatchNode::Branch(_)) {
                *entry = PatchNode::Branch(PatchTree::new());
            }
            let PatchNode::Branch(next) = entry else {
                unreachable!("just replaced with a branch")
            };
            node = next;
        }
        node.0
            .insert(step_key(steps[steps.len() - 1]), PatchNode::Leaf(value));
    }

    /// The tree as Lua source.
    pub fn to_lua(&self, indent: &str) -> String {
        if self.0.is_empty() {
            return "{}".to_string();
        }
        let inner = format!("{indent}{INDENT}");
        let parts: Vec<String> = self
            .0
            .iter()
            .map(|(key, node)| {
                let rendered = match node {
                    PatchNode::Leaf(value) => lua_literal(value, &inner),
                    PatchNode::Branch(tree) => tree.to_lua(&inner),
                };
                format!("{} = {rendered}", key.as_lua())
            })
            .collect();

        let inline = format!("{{ {} }}", parts.join(", "));
        let scalars = self.0.values().all(|node| match node {
            PatchNode::Leaf(value) => !matches!(value, Value::Array(_) | Value::Object(_)),
            PatchNode::Branch(_) => false,
        });
        if scalars && inline.chars().count() + indent.chars().count() <= INLINE_WIDTH {
            return inline;
        }

        let body = parts
            .iter()
            .map(|part| format!("{inner}{part},"))
            .collect::<Vec<_>>()
            .join("\n");
        format!("{{\n{body}\n{indent}}}")
    }
}

/// One step of a dotted path, as a patch key.
fn step_key(step: &str) -> PatchKey {
    if !step.is_empty() && step.bytes().all(|b| b.is_ascii_digit()) {
        if let Ok(n) = step.parse::<i64>() {
            return PatchKey::Index(n + 1);
        }
    }
    PatchKey::Name(step.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_quote_and_a_newline_cannot_end_the_literal() {
        assert_eq!(lua_string("he said \"hi\""), "\"he said \\\"hi\\\"\"");
        assert_eq!(lua_string("a\nb"), "\"a\\nb\"");
        assert_eq!(lua_string("a\\b"), "\"a\\\\b\"");
    }

    /// The padding is the point: `\0` then `5` would read back as byte 5.
    #[test]
    fn a_control_character_is_three_digits() {
        assert_eq!(lua_string("a\u{0}5"), "\"a\\0005\"");
    }

    #[test]
    fn a_unit_named_in_russian_keeps_its_bytes() {
        assert_eq!(lua_string("Танк"), "\"Танк\"");
    }

    #[test]
    fn a_keyword_cannot_be_a_bare_key() {
        assert!(is_lua_identifier("maxDamage"));
        assert!(!is_lua_identifier("repeat"));
        assert!(!is_lua_identifier("2fast"));
        assert_eq!(table_key("repeat"), "[\"repeat\"]");
        assert_eq!(table_key("maxDamage"), "maxDamage");
    }

    /// A Lua table indexed by number arrives as an object with string keys, and
    /// `["1"]` is a different key from `[1]`.
    #[test]
    fn an_integer_key_is_written_as_a_number() {
        assert_eq!(table_key("1"), "[1]");
        assert_eq!(table_key("01"), "[\"01\"]");
        assert_eq!(table_key("-3"), "[-3]");
    }

    #[test]
    fn a_sequence_is_written_with_its_indices_counting_from_one() {
        assert_eq!(
            lua_literal(&json!(["armsolar", "armmex"]), ""),
            "{ [1] = \"armsolar\", [2] = \"armmex\" }"
        );
    }

    #[test]
    fn a_table_of_scalars_stays_on_one_line_and_a_nested_one_does_not() {
        assert_eq!(
            lua_literal(&json!({ "r": 1, "g": 0 }), ""),
            "{ g = 0, r = 1 }"
        );
        assert_eq!(
            lua_literal(&json!({ "a": { "b": 1 } }), ""),
            "{\n  a = { b = 1 },\n}"
        );
    }

    #[test]
    fn an_empty_table_is_a_pair_of_braces() {
        assert_eq!(lua_literal(&json!({}), ""), "{}");
        assert_eq!(lua_literal(&json!([]), ""), "{}");
    }

    /// The one that matters for an override: a patch against the second weapon
    /// must not invent a first one, and it counts from one in Lua.
    #[test]
    fn an_array_step_becomes_a_lua_index_one_higher() {
        let mut tree = PatchTree::new();
        tree.insert("weapons.1.name", json!("CANNON"));
        assert_eq!(
            tree.to_lua(""),
            "{\n  weapons = {\n    [2] = { name = \"CANNON\" },\n  },\n}"
        );
    }

    #[test]
    fn two_paths_under_one_field_share_a_branch() {
        let mut tree = PatchTree::new();
        tree.insert("customParams.a", json!("1"));
        tree.insert("customParams.b", json!("2"));
        assert_eq!(
            tree.to_lua(""),
            "{\n  customParams = { a = \"1\", b = \"2\" },\n}"
        );
    }

    #[test]
    fn a_scalar_path_and_a_branch_under_it_leave_a_branch() {
        let mut tree = PatchTree::new();
        tree.insert("weapons", json!(5));
        tree.insert("weapons.0.name", json!("x"));
        assert_eq!(
            tree.to_lua(""),
            "{\n  weapons = {\n    [1] = { name = \"x\" },\n  },\n}"
        );
    }

    /// Indices before names, and both in order, so the same project compiles to
    /// the same bytes every time.
    #[test]
    fn the_output_is_ordered_rather_than_however_the_map_iterated() {
        let mut tree = PatchTree::new();
        tree.insert("zulu", json!(1));
        tree.insert("alpha", json!(2));
        tree.insert("2", json!(3));
        tree.insert("0", json!(4));
        assert_eq!(tree.to_lua(""), "{ [1] = 4, [3] = 3, alpha = 2, zulu = 1 }");
    }

    #[test]
    fn an_integer_value_does_not_grow_a_decimal_point() {
        assert_eq!(lua_literal(&json!(5), ""), "5");
        assert_eq!(lua_literal(&json!(5.5), ""), "5.5");
    }
}
