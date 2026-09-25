//! A project's copied unit written into the game's own folder as a new unit
//! file (issue #2634), for the edit-in-place route in `inplace.rs`.
//!
//! The copy's file is the source unit's own file, renamed and patched by
//! `coilbox_unitpatch::clone_unit`, written beside it. What to patch is the
//! difference between the copy's definition and the game's own read of the
//! source unit, which the page already holds and sends with the write. The
//! file alone cannot say it: a unit inherits most of its fields from classes
//! and post-processing the file never mentions, so the file's table and the
//! copy's definition differ in every one of those whether the user changed it
//! or not.
//!
//! A copy that stands in for a unit the game already has is not written this
//! way. It was made to replace that unit, and a new file under the same name
//! would make the game define it twice.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use coilbox_unitpatch::{Op, RefusalKind, Segment, Value as PatchValue};
use serde::Serialize;
use serde_json::{Map, Value};

use crate::model::{BuildMenuOp, GameEdits, UnitClone};

/// Whether the route writes this copy as a new file: it was copied from a
/// game unit, under a name the game did not use.
pub(crate) fn writable(clone: &UnitClone) -> bool {
    clone.source.is_some() && !clone.replaces_game_unit
}

/// One change to make to the copy's file.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CopyEdit {
    /// The field's dotted path as the project spells one, list positions
    /// counted from zero.
    pub field: String,
    pub path: Vec<Segment>,
    pub op: Op,
}

/// A difference between the copy and its source that no edit to a file can
/// make, with the sentence saying why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unwritable {
    pub field: String,
    pub message: String,
}

/// The edits that turn the source unit's table into the copy's, and the
/// differences no edit can make.
///
/// A changed value is a set. Entries added to the end of a list are pushes,
/// which is how a copy's own build menu grows. A table added, a field taken
/// out, or a list that lost entries has no edit the patcher makes, so each is
/// refused, apart from a top-level `name` or `humanName` the copy dropped:
/// `clones.ts` drops those for a game that reads names from its language
/// files, which never reads them from the definition.
pub(crate) fn copy_edits(source: &Value, copy: &Value) -> (Vec<CopyEdit>, Vec<Unwritable>) {
    let mut walk = Walk::default();
    walk.step(source, copy);
    (walk.edits, walk.refused)
}

#[derive(Default)]
struct Walk {
    edits: Vec<CopyEdit>,
    refused: Vec<Unwritable>,
    path: Vec<Segment>,
    label: Vec<String>,
}

fn scalar(value: &Value) -> Option<PatchValue> {
    match value {
        Value::Bool(b) => Some(PatchValue::Bool(*b)),
        Value::Number(n) => n.as_f64().map(PatchValue::Number),
        Value::String(s) => Some(PatchValue::String(s.clone())),
        _ => None,
    }
}

fn same_scalar(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        _ => a == b,
    }
}

/// An empty table as the frontend may hold it, either shape.
fn is_empty_table(value: &Value) -> bool {
    matches!(value, Value::Object(m) if m.is_empty())
        || matches!(value, Value::Array(a) if a.is_empty())
}

fn as_list(value: &Value) -> Option<&[Value]> {
    match value {
        Value::Array(items) => Some(items),
        other if is_empty_table(other) => Some(&[]),
        _ => None,
    }
}

/// A key of a table read as an object. A key of digits is a Lua number key,
/// since the unitsync worker sends a numbered table with a gap in it as an
/// object keyed by its numbers (issue #3041).
fn map_segment(key: &str) -> Segment {
    match key.parse::<usize>() {
        Ok(n) if key.bytes().all(|b| b.is_ascii_digit()) => Segment::Index(n),
        _ => Segment::Key(key.to_string()),
    }
}

fn as_map<'a>(value: &'a Value, empty: &'a Map<String, Value>) -> Option<&'a Map<String, Value>> {
    match value {
        Value::Object(map) => Some(map),
        other if is_empty_table(other) => Some(empty),
        _ => None,
    }
}

impl Walk {
    fn field(&self) -> String {
        self.label.join(".")
    }

    fn edit(&mut self, op: Op) {
        self.edits.push(CopyEdit {
            field: self.field(),
            path: self.path.clone(),
            op,
        });
    }

    fn refuse(&mut self, message: String) {
        self.refused.push(Unwritable {
            field: self.field(),
            message,
        });
    }

    fn enter(&mut self, segment: Segment, label: String) {
        self.path.push(segment);
        self.label.push(label);
    }

    fn leave(&mut self) {
        self.path.pop();
        self.label.pop();
    }

    fn step(&mut self, before: &Value, after: &Value) {
        if let (Some(_), Some(value)) = (scalar(before), scalar(after)) {
            if !same_scalar(before, after) {
                self.edit(Op::Set(value));
            }
            return;
        }
        let is_array = matches!(before, Value::Array(_)) || matches!(after, Value::Array(_));
        if is_array {
            if let (Some(b), Some(a)) = (as_list(before), as_list(after)) {
                return self.lists(b, a);
            }
        }
        let empty = Map::new();
        if let (Some(b), Some(a)) = (as_map(before, &empty), as_map(after, &empty)) {
            return self.maps(b, a);
        }
        if before == after {
            return;
        }
        let field = self.field();
        self.refuse(format!(
            "The copy changes {field} between a table and a single value, which coilbox cannot write into a file."
        ));
    }

    fn maps(&mut self, before: &Map<String, Value>, after: &Map<String, Value>) {
        let mut keys: Vec<&String> = before.keys().chain(after.keys()).collect();
        keys.sort();
        keys.dedup();
        for key in keys {
            let b = before.get(key).filter(|v| !v.is_null());
            let a = after.get(key).filter(|v| !v.is_null());
            self.enter(map_segment(key), key.clone());
            match (b, a) {
                (Some(b), Some(a)) => self.step(b, a),
                (None, Some(a)) => match scalar(a) {
                    Some(value) => self.edit(Op::Set(value)),
                    None if is_empty_table(a) => {}
                    None => {
                        let field = self.field();
                        self.refuse(format!(
                            "The copy adds the table {field}, and coilbox can only write single values into a file."
                        ));
                    }
                },
                (Some(_), None) => {
                    let lower = key.to_lowercase();
                    let dropped_name =
                        self.path.len() == 1 && (lower == "name" || lower == "humanname");
                    if !dropped_name {
                        let field = self.field();
                        self.refuse(format!(
                            "The copy takes {field} out, and coilbox cannot take a field out of a file."
                        ));
                    }
                }
                (None, None) => {}
            }
            self.leave();
        }
    }

    fn lists(&mut self, before: &[Value], after: &[Value]) {
        for (at, (b, a)) in before.iter().zip(after).enumerate() {
            self.enter(Segment::Index(at + 1), at.to_string());
            self.step(b, a);
            self.leave();
        }
        if after.len() < before.len() {
            let field = self.field();
            self.refuse(format!(
                "The copy takes entries out of the list {field}, and coilbox can only add to the end of a list in a file."
            ));
            return;
        }
        for added in &after[before.len()..] {
            match scalar(added) {
                Some(value) => self.edit(Op::Push(value)),
                None => {
                    let field = self.field();
                    self.refuse(format!(
                        "The copy adds a table to the list {field}, and coilbox can only add single values to a list in a file."
                    ));
                }
            }
        }
    }
}

/// Fields the game works out from the source unit's name, written into the
/// copy with the source's value so the copy does not work them out afresh
/// from its own.
///
/// SpringMCLegacy's `unitdefs_post.lua` sets `objectname` to
/// `vehicle/<name>.s3o` for a unit whose file does not set one, so a copy
/// named `brv_mk2` would look for a model called `brv_mk2.s3o`, which does
/// not exist, and the engine drops the unit. A field is pinned when the game's
/// read of it is a string holding the source's name, the source's own file
/// does not set it (`file_unit` is that file's table for the unit, from
/// `coilbox_unitpatch::evaluate`), and the copy's definition still has the
/// source's value. A value that is the name and nothing more is the unit's
/// identity rather than an asset, and is left for the game to work out.
///
/// Pinning gives the copy the value the page showed and the mutator route
/// would write, since that route writes the copy's whole definition.
pub(crate) fn name_pins(
    source: &str,
    source_def: &Value,
    copy_def: &Value,
    file_unit: &Value,
) -> Vec<CopyEdit> {
    let name = source.to_lowercase();
    let mut out = Vec::new();
    let mut path = Vec::new();
    pins(
        &name,
        source_def,
        copy_def,
        Some(file_unit),
        &mut path,
        &mut out,
    );
    out
}

fn pins(
    name: &str,
    source: &Value,
    copy: &Value,
    file: Option<&Value>,
    path: &mut Vec<String>,
    out: &mut Vec<CopyEdit>,
) {
    let Value::Object(fields) = source else {
        return;
    };
    for (key, value) in fields {
        let lower = key.to_lowercase();
        let in_file = file.and_then(|f| f.get(&lower));
        let in_copy = copy.get(key);
        path.push(key.clone());
        match value {
            Value::Object(_) => pins(
                name,
                value,
                in_copy.unwrap_or(&Value::Null),
                in_file,
                path,
                out,
            ),
            Value::String(text) => {
                let text_lower = text.to_lowercase();
                if in_file.is_none()
                    && in_copy == Some(value)
                    && text_lower.contains(name)
                    && text_lower != name
                {
                    out.push(CopyEdit {
                        field: path.join("."),
                        path: path.iter().map(|k| Segment::Key(k.clone())).collect(),
                        op: Op::Set(PatchValue::String(text.clone())),
                    });
                }
            }
            _ => {}
        }
        path.pop();
    }
}

/// Why `key` cannot be a new unit in this game, as the file that stops it
/// and a sentence, or `None` when nothing does.
///
/// Any Lua unit file that mentions the name is run to see whether it defines
/// a unit of that name, and an `.fbi` file stops it when the file is named
/// after it. Spring lowercases unit names, and `key` is already
/// lowercase, so a file defining `ArmDfly2` stops `armdfly2`. A file that does
/// not run and whose text does not settle it stops the copy too, since a
/// collision would quietly replace a unit.
pub(crate) fn name_taken(
    key: &str,
    texts: &BTreeMap<PathBuf, String>,
    game_dir: &Path,
) -> Option<(PathBuf, String)> {
    for (file, text) in texts {
        let rel = coilbox_gamebackup::key(file.strip_prefix(game_dir).unwrap_or(file));
        let taken = format!(
            "{rel} already defines a unit called {key}. A new file under that name would replace it."
        );
        // An `.fbi` file defines the unit its file name says (issue #2638).
        if coilbox_unitpatch::fbi::is_fbi(file) {
            if coilbox_unitpatch::fbi::unit_name(file) == key {
                return Some((file.clone(), taken));
            }
            continue;
        }
        if !text.to_lowercase().contains(key) {
            continue;
        }
        match coilbox_unitpatch::evaluate(text, game_dir) {
            Ok(Value::Object(units)) if units.contains_key(key) => return Some((file.clone(), taken)),
            Ok(_) => continue,
            Err(_) => match coilbox_unitpatch::locate_unit(text, key) {
                Ok(_) => return Some((file.clone(), taken)),
                Err(r) if matches!(r.kind, RefusalKind::UnitNotFound | RefusalKind::Syntax) => {
                    continue
                }
                Err(_) => {
                    return Some((
                        file.clone(),
                        format!("{rel} mentions {key}, and coilbox cannot run it to see whether it defines a unit of that name."),
                    ))
                }
            },
        }
    }
    None
}

/// A file already at `path`, compared without regard to case as the engine's
/// archive lookups compare names.
pub(crate) fn file_taken(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_string_lossy().to_lowercase();
    std::fs::read_dir(path.parent()?)
        .ok()?
        .flatten()
        .find(|entry| entry.file_name().to_string_lossy().to_lowercase() == name)
        .map(|entry| entry.path())
}

/// The game units whose build menus the project adds `key` to. A copy's own
/// menu is part of its definition, so a copy never appears here.
pub(crate) fn builders_adding<'a>(edits: &'a GameEdits, key: &str) -> Vec<&'a str> {
    edits
        .menus
        .iter()
        .filter(|(builder, _)| !edits.clones.contains_key(*builder))
        .filter(|(_, ops)| {
            ops.iter()
                .any(|op| matches!(op, BuildMenuOp::Add { unit } if unit == key))
        })
        .map(|(builder, _)| builder.as_str())
        .collect()
}

/// How many build menu operations the route does not carry: all of them,
/// apart from adding a copy it writes to a game unit's menu, and apart from
/// copies' own menus, which go with the copy.
pub(crate) fn menu_ops_not_carried(edits: &GameEdits) -> usize {
    edits
        .menus
        .iter()
        .filter(|(builder, _)| !edits.clones.contains_key(*builder))
        .flat_map(|(_, ops)| ops)
        .filter(|op| {
            !matches!(op, BuildMenuOp::Add { unit }
                if edits.clones.get(unit).is_some_and(writable))
        })
        .count()
}

/// Whether `builder`'s build list in `text` already holds `key`, so pushing
/// it again would put it in the menu twice.
pub(crate) fn already_lists(text: &str, builder: &str, key: &str, game_dir: &Path) -> bool {
    if !text.to_lowercase().contains(key) {
        return false;
    }
    let Ok(units) = coilbox_unitpatch::evaluate(text, game_dir) else {
        return false;
    };
    units
        .get(builder.to_lowercase())
        .and_then(|unit| unit.get("buildoptions"))
        .and_then(Value::as_object)
        .is_some_and(|list| {
            list.values()
                .any(|entry| entry.as_str().is_some_and(|s| s.eq_ignore_ascii_case(key)))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fields(edits: &[CopyEdit]) -> Vec<(&str, &Op)> {
        edits.iter().map(|e| (e.field.as_str(), &e.op)).collect()
    }

    #[test]
    fn a_changed_value_is_a_set_and_an_added_entry_a_push() {
        let source = json!({
            "metalcost": 320,
            "acceleration": 0.18000001,
            "customparams": { "tonnage": 80 },
            "buildoptions": ["armsolar"],
            "weapons": [{ "def": "GUN" }],
        });
        let copy = json!({
            "metalcost": 400,
            "acceleration": 0.18000001,
            "customparams": { "tonnage": 80, "variant": "B" },
            "buildoptions": ["armsolar", "armmex"],
            "weapons": [{ "def": "LASER" }],
            "humanname": "Dragonfly Mk2",
        });

        let (edits, refused) = copy_edits(&source, &copy);

        assert!(refused.is_empty(), "{refused:?}");
        assert_eq!(
            fields(&edits),
            vec![
                (
                    "buildoptions",
                    &Op::Push(PatchValue::String("armmex".into()))
                ),
                (
                    "customparams.variant",
                    &Op::Set(PatchValue::String("B".into()))
                ),
                (
                    "humanname",
                    &Op::Set(PatchValue::String("Dragonfly Mk2".into()))
                ),
                ("metalcost", &Op::Set(PatchValue::Number(400.0))),
                (
                    "weapons.0.def",
                    &Op::Set(PatchValue::String("LASER".into()))
                ),
            ]
        );
        assert_eq!(
            edits[4].path,
            vec![
                Segment::Key("weapons".into()),
                Segment::Index(1),
                Segment::Key("def".into())
            ]
        );
    }

    /// A table with a gap reads as an object keyed by its Lua numbers
    /// (issue #3041), so a copy's change to its `"3"` is to `weapons[3]`,
    /// not to a field named 3.
    #[test]
    fn a_number_key_of_a_table_with_a_gap_is_that_lua_key() {
        let source = json!({ "weapons": { "1": { "name": "LASER" }, "3": { "name": "DGUN" } } });
        let copy = json!({ "weapons": { "1": { "name": "LASER" }, "3": { "name": "BIGDGUN" } } });

        let (edits, refused) = copy_edits(&source, &copy);

        assert!(refused.is_empty(), "{refused:?}");
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].field, "weapons.3.name");
        assert_eq!(
            edits[0].path,
            vec![
                Segment::Key("weapons".into()),
                Segment::Index(3),
                Segment::Key("name".into())
            ]
        );
    }

    #[test]
    fn what_no_file_edit_can_do_is_refused_by_field() {
        let source = json!({
            "name": "Dragonfly",
            "buildoptions": ["armsolar", "armwin"],
            "sounds": { "ok": "x" },
            "category": "ALL",
        });
        let copy = json!({
            "buildoptions": ["armsolar"],
            "featuredefs": { "dead": { "metal": 1 } },
            "category": { "a": 1 },
        });

        let (edits, refused) = copy_edits(&source, &copy);

        assert!(edits.is_empty(), "{edits:?}");
        let found: Vec<&str> = refused.iter().map(|r| r.field.as_str()).collect();
        assert_eq!(
            found,
            vec!["buildoptions", "category", "featuredefs", "sounds"]
        );
    }

    #[test]
    fn an_empty_table_matches_either_shape() {
        let (edits, refused) = copy_edits(
            &json!({ "buildoptions": {}, "customparams": [] }),
            &json!({ "buildoptions": ["armcom2"], "customparams": {} }),
        );
        assert!(refused.is_empty(), "{refused:?}");
        assert_eq!(
            fields(&edits),
            vec![(
                "buildoptions",
                &Op::Push(PatchValue::String("armcom2".into()))
            )]
        );
    }

    /// SpringMCLegacy's BRV: the file sets `name` and `customparams`, and
    /// post-processing adds `objectname` and `buildpic` from the unit's name.
    #[test]
    fn a_field_worked_out_from_the_name_is_pinned_to_the_sources_value() {
        let source = json!({
            "name": "Heavy BRV",
            "objectname": "vehicle/brv.s3o",
            "buildpic": "brv.png",
            "unitname": "brv",
            "customparams": { "tonnage": 80, "infocard": "brv_card" },
        });
        let copy = json!({
            "name": "Heavy BRV Mk2",
            "objectname": "vehicle/brv.s3o",
            "buildpic": "custom.png",
            "unitname": "brv",
            "customparams": { "tonnage": 85, "infocard": "brv_card" },
        });
        let file = json!({ "name": "Heavy BRV", "customparams": { "tonnage": 80 } });

        let pinned = name_pins("brv", &source, &copy, &file);

        assert_eq!(
            fields(&pinned),
            vec![
                (
                    "customparams.infocard",
                    &Op::Set(PatchValue::String("brv_card".into()))
                ),
                (
                    "objectname",
                    &Op::Set(PatchValue::String("vehicle/brv.s3o".into()))
                ),
            ]
        );
    }

    #[test]
    fn only_game_builders_that_add_the_copy_are_its_builders() {
        let edits: GameEdits = serde_json::from_value(json!({
            "clones": {
                "armpw2": { "key": "armpw2", "source": "armpw", "def": {} },
                "armlab2": { "key": "armlab2", "source": "armlab", "def": {} },
            },
            "menus": {
                "armlab": [{ "op": "add", "unit": "armpw2" }, { "op": "remove", "unit": "armck" }],
                "armalab": [{ "op": "add", "unit": "armpw2" }],
                "armlab2": [{ "op": "add", "unit": "armpw2" }],
                "armvp": [{ "op": "add", "unit": "armflash" }],
            },
        }))
        .unwrap();

        assert_eq!(builders_adding(&edits, "armpw2"), vec!["armalab", "armlab"]);
        // The remove on armlab and the add of a game unit on armvp.
        assert_eq!(menu_ops_not_carried(&edits), 2);
    }
}
