//! Writing a project's field changes into the game's own unit files (issue
//! #2635), the edit-in-place route #2631 offers for a loose `.sdd`.
//!
//! Each changed unit's file is found under `units/`, patched one field at a
//! time through `coilbox-unitpatch`, and written through
//! `coilbox_gamebackup::Markers`. The first write to a file renames the
//! original aside, so undo and accept work from the files on disk alone.
//! When a unit file includes another file for its table, as
//! SplinterFaction's include their `basedefs` files, the change goes into
//! that file instead and is backed up the same way (issue #3021).
//!
//! A write is all or nothing. Every change is patched in memory first, and if
//! the patcher refuses any of them, nothing is written and every refusal is
//! reported. Writing the rest would leave the game holding part of what the
//! user asked for with no sign on disk of which part.
//!
//! Field changes to the game's own units go this way, and so do copies of
//! them (issue #2634), each as a new file beside its source's, added to the
//! build menus the project adds it to. `inplace_clone.rs` has the copy's
//! half. A library weapon equipped into a game unit, in a slot or as a death
//! explosion, goes into that unit's own `weapondefs` (issue #3055), or only
//! its name for an `.fbi` unit, which has no such table, or for a unit whose
//! file sets that table again afterwards (issue #3069), and into a new file
//! under `weapons/` that puts it in the game's weapon table (issue #3068).
//! One that cannot be written is reported with the reason rather than
//! stopping the write. Other build menu changes, words, switched-off units and copies that
//! replace a game unit have no in-place form yet, and the outcome says which
//! of them the project holds rather than dropping them quietly.
//!
//! [`check`] is the same patching as a dry run, one unit at a time, for the
//! unit page to ask at edit time (issue #2633). A field it refuses is one the
//! user can send through the mutator route instead, which the project records
//! in `ModProject::mutator_only`. The write skips those changes rather than
//! refusing the whole batch over them, and says a mutator still has to carry
//! them.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use coilbox_gamebackup::{key, Markers};
use coilbox_tdf::Encoding;
use coilbox_unitpatch::fbi::{self, is_fbi};
use coilbox_unitpatch::{
    patch_pending, CloneRefusal, Cloned, Edit, Location, Op, Patched, Place, Refusal, RefusalKind,
    Segment, Value as PatchValue,
};
use serde::Serialize;
use serde_json::Value;

use crate::inplace_clone;
use crate::model::{BuildMenuOp, GameEdits, ModProject, UnitClone, UnitPatch};

/// What the workshop marks its in-place writes with. Distinct from the `.3do`
/// installer's suffix, so undoing one never undoes the other.
pub const MARKERS: Markers = Markers {
    backup: ".coilbox-workshop-backup",
    created: ".coilbox-workshop-created",
};

/// One change the patcher would not make, or that could not be matched to a
/// file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refused {
    pub unit: String,
    /// The field's dotted path, as the project holds it.
    pub field: String,
    /// The file the refusal is about, relative to the game: the unit's
    /// file, or the file it includes for its table when the refusal is about
    /// that one (issue #3021). `None` when no file was found.
    pub file: Option<String>,
    pub kind: RefusalKind,
    pub message: String,
    pub location: Option<Location>,
}

/// One field change the game's files hold once a write has gone through,
/// whether this write put it there or the file already said the same.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Carried {
    pub unit: String,
    /// The field's dotted path, as the project holds it.
    pub field: String,
    /// Whether the unit's file has a workshop backup, so undo takes this
    /// change back out of the game (issue #3023).
    pub undoable: bool,
}

/// What a write did.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    /// Files written, relative to the game. Empty when anything was refused.
    pub written: Vec<String>,
    /// How many field changes the written files now carry.
    pub changed: usize,
    /// Field changes the file already held, so nothing needed writing.
    pub unchanged: usize,
    /// Every change that stopped the write. When this is not empty, nothing
    /// was written.
    pub refused: Vec<Refused>,
    /// Parts of the project this route cannot carry yet, one sentence each.
    pub not_carried: Vec<String>,
    /// Every field change the game's files now hold, so the project can stop
    /// holding it (issue #3023). Empty when anything was refused.
    pub carried: Vec<Carried>,
    /// Every copy written as a new unit file (issue #2634). Empty when
    /// anything was refused.
    pub copies: Vec<WrittenCopy>,
    /// Every library weapon the game's own units now carry (issue #3055).
    /// Empty when anything was refused.
    pub equipped: Vec<WrittenEquip>,
}

/// A library weapon a game unit's file now carries in its own `weapondefs`,
/// with the slot or death explosion pointed at it (issue #3055).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenEquip {
    pub unit: String,
    /// The slot's step as the project holds it, or `explodeas` or
    /// `selfdestructas`.
    pub at: String,
    pub weapon: String,
    /// The file it went into, relative to the game.
    pub file: String,
}

/// A copy the game now holds as a unit file of its own. Undo always reaches
/// it: the file is marked as created and every builder's file has a backup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenCopy {
    pub unit: String,
    /// The new file, relative to the game.
    pub file: String,
    /// The game units whose build lists it was added to.
    pub builders: Vec<String>,
}

/// How many files carry a workshop backup or created marker.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusOutcome {
    pub backups: usize,
    pub created: usize,
}

/// What an undo did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoOutcome {
    pub restored: Vec<String>,
    pub deleted: Vec<String>,
}

/// What an accept did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptOutcome {
    pub kept: Vec<String>,
}

/// `game_dir` must be a loose `.sdd` directly in a `games` folder, the same
/// rule `isEditInPlaceEligible` applies before the route is offered.
pub(crate) fn require_loose_game(game_dir: &Path) -> Result<(), String> {
    if !coilbox_gamebackup::is_sdd(game_dir) || !coilbox_gamebackup::in_games_dir(game_dir) {
        return Err(format!(
            "{} is not a loose .sdd game directly in a games folder, so coilbox will not write into it.",
            game_dir.display()
        ));
    }
    Ok(())
}

/// A project path as the patcher's steps.
///
/// A step of digits is a key into `def`, the game's read of the unit, which
/// is the table the unit page showed when it wrote the path. The unitsync
/// worker sends a Lua table numbered 1 to n as a JSON array and any other
/// table as an object keyed by its Lua keys, so one step can mean two
/// things. `weapons.1` is the second weapon of a list with no gap, and
/// `weapons[1]` itself in a list with one, such as a Total Annihilation
/// commander with `Weapon1` and `Weapon3` and no `Weapon2` (issue #3041).
/// Each digit step is read against the table it lands in. A step into a
/// table the read does not have is a list position counted from zero, since
/// that is what `writePath` in `overrides.ts` makes of it.
///
/// Without the read, a digit step could mean either, so the path is refused
/// rather than guessed.
fn segments(path: &str, def: Option<&Value>) -> Result<Vec<Segment>, String> {
    let not_a_path = || format!("{path:?} is not a field path.");
    let mut out = Vec::new();
    let mut at = def;
    for step in path.split('.') {
        if step.is_empty() {
            return Err(not_a_path());
        }
        if !step.bytes().all(|b| b.is_ascii_digit()) {
            out.push(Segment::Key(step.to_string()));
            at = at.and_then(|table| entry(table, step));
            continue;
        }
        if def.is_none() {
            return Err(format!(
                "Coilbox was not given the game's read of this unit, so it cannot tell which entry {path} is."
            ));
        }
        let n: usize = step.parse().map_err(|_| not_a_path())?;
        let (index, next) = match at {
            Some(Value::Object(map)) if !map.is_empty() => (n, map.get(step)),
            Some(Value::Array(items)) => (n.checked_add(1).ok_or_else(not_a_path)?, items.get(n)),
            _ => (n.checked_add(1).ok_or_else(not_a_path)?, None),
        };
        out.push(Segment::Index(index));
        at = next;
    }
    Ok(out)
}

/// `table`'s value for `key`, matched without regard to case when no key is
/// spelled the same, as the patcher matches keys.
fn entry<'a>(table: &'a Value, key: &str) -> Option<&'a Value> {
    let map = table.as_object()?;
    map.get(key).or_else(|| {
        map.iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v)
    })
}

fn patch_value(value: &Value) -> Option<PatchValue> {
    match value {
        Value::Bool(b) => Some(PatchValue::Bool(*b)),
        Value::Number(n) => n.as_f64().map(PatchValue::Number),
        Value::String(s) => Some(PatchValue::String(s.clone())),
        _ => None,
    }
}

/// Every `.lua` and `.fbi` file under the game's `units` folder, which is
/// where the engine's own `gamedata/unitdefs.lua` loads unit definitions
/// from. The folder name and the extensions are matched without regard to
/// case, as the engine's archive lookups are.
fn unit_files(game_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(game_dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && entry.file_name().eq_ignore_ascii_case("units") {
            walk_units(&path, &mut out);
        }
    }
    out.sort();
    out
}

fn walk_units(at: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(at) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_units(&path, out);
        } else if is_fbi(&path)
            || path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("lua"))
        {
            out.push(path);
        }
    }
}

/// The `gamedata` folder directly under `game_dir`, matched without regard to
/// case as the engine's archive lookups are.
fn gamedata_dir(game_dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(game_dir)
        .ok()?
        .flatten()
        .find(|entry| entry.path().is_dir() && entry.file_name().eq_ignore_ascii_case("gamedata"))
        .map(|entry| entry.path())
}

/// A file directly under `dir` named `name`, matched without regard to case.
fn find_file_ci(dir: &Path, name: &str) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .find(|entry| entry.file_name().eq_ignore_ascii_case(name))
        .map(|entry| entry.path())
}

/// The Lua file that overrides this game's build menus instead of the engine
/// reading them from `gamedata/sidedata.tdf`'s `[CANBUILD]` section (issue
/// #3040), or `None` when nothing does.
///
/// `gamedata/buildoptions.lua` exists in a game for exactly this: setting
/// `UnitDefs[x].buildoptions` itself, as THIS's does for three of its
/// factories. A game may instead do it inline in `unitdefs_post.lua`, so that
/// file is checked too, for whether it mentions `buildoptions` at all. Either
/// way, a `canbuild` key written into `sidedata.tdf` would be a change the
/// engine never reads, so a copy is refused from that builder's menu rather
/// than silently writing a file with no effect.
fn lua_build_menu_override(game_dir: &Path) -> Option<PathBuf> {
    let gamedata = gamedata_dir(game_dir)?;
    if let Some(file) = find_file_ci(&gamedata, "buildoptions.lua") {
        return Some(file);
    }
    let post = find_file_ci(&gamedata, "unitdefs_post.lua")?;
    let text = std::fs::read_to_string(&post).ok()?;
    text.to_lowercase().contains("buildoptions").then_some(post)
}

/// [`patch_pending`], or its `.fbi` form for a unit written in that format
/// (issue #2638). An `.fbi` unit never includes another file, so `included`
/// does not apply to it.
fn patch_file(
    file: &Path,
    text: &str,
    edit: &Edit,
    game_dir: &Path,
    included: &BTreeMap<PathBuf, String>,
) -> Result<Patched, Refusal> {
    if is_fbi(file) {
        fbi::patch(text, edit, file)
    } else {
        patch_pending(text, edit, game_dir, included)
    }
}

fn locate_edit(file: &Path, text: &str, edit: &Edit, game_dir: &Path) -> Result<Place, Refusal> {
    if is_fbi(file) {
        fbi::locate_edit(text, edit, file)
    } else {
        coilbox_unitpatch::locate_edit(text, edit, game_dir)
    }
}

fn locate_unit(file: &Path, text: &str, unit: &str) -> Result<Location, Refusal> {
    if is_fbi(file) {
        fbi::locate_unit(text, unit, file)
    } else {
        coilbox_unitpatch::locate_unit(text, unit)
    }
}

pub(crate) fn evaluate(file: &Path, text: &str, game_dir: &Path) -> Result<Value, Refusal> {
    if is_fbi(file) {
        fbi::evaluate(text, file)
    } else {
        coilbox_unitpatch::evaluate(text, game_dir)
    }
}

fn clone_unit(
    file: &Path,
    text: &str,
    unit: &str,
    new_unit: &str,
    edits: &[(Vec<Segment>, Op)],
    game_dir: &Path,
) -> Result<Cloned, Vec<CloneRefusal>> {
    if is_fbi(file) {
        fbi::clone_unit(text, unit, new_unit, edits, file)
    } else {
        coilbox_unitpatch::clone_unit(text, unit, new_unit, edits, game_dir)
    }
}

/// The parts of a project this route does not write, one sentence each.
fn not_carried(project: &ModProject) -> Vec<String> {
    let edits = &project.edits;
    let mut out = Vec::new();
    let replacing = edits
        .clones
        .values()
        .filter(|clone| clone.replaces_game_unit)
        .count();
    if replacing > 0 {
        out.push(format!(
            "{replacing} cop{} that replace{} a unit the game already has {} not written into the game, because the game would then define that unit twice. {} still need{} a mutator.",
            if replacing == 1 { "y" } else { "ies" },
            if replacing == 1 { "s" } else { "" },
            if replacing == 1 { "is" } else { "are" },
            if replacing == 1 { "It" } else { "They" },
            if replacing == 1 { "s" } else { "" },
        ));
    }
    let unsourced = edits
        .clones
        .values()
        .filter(|clone| clone.source.is_none() && !clone.replaces_game_unit)
        .count();
    if unsourced > 0 {
        out.push(format!(
            "{unsourced} unit{} not copied from a unit in the game {} not written into the game, because there is no unit file to copy.",
            if unsourced == 1 { "" } else { "s" },
            if unsourced == 1 { "is" } else { "are" },
        ));
    }
    let clone_routed = edits
        .clones
        .values()
        .filter(|clone| inplace_clone::writable(clone))
        .filter(|clone| project.is_clone_mutator_only(&clone.key))
        .count();
    if clone_routed > 0 {
        out.push(format!(
            "{clone_routed} cop{} you sent to the mutator route {} not written into the game. {} still need{} a mutator.",
            if clone_routed == 1 { "y" } else { "ies" },
            if clone_routed == 1 { "is" } else { "are" },
            if clone_routed == 1 { "It" } else { "They" },
            if clone_routed == 1 { "s" } else { "" },
        ));
    }
    if inplace_clone::menu_ops_not_carried(edits) > 0 {
        out.push(
            "Build menu changes, other than adding a copy written here, are not written into the game yet."
                .to_string(),
        );
    }
    if !edits.disabled.is_empty() {
        out.push("Switched-off units are not written into the game yet.".to_string());
    }
    if edits.text_edit_count() > 0 {
        out.push("Name and description changes are not written into the game yet.".to_string());
    }
    if !project.read_only_lua.is_empty() {
        out.push("Lua carried from an import is not written into the game.".to_string());
    }
    let routed = edits
        .overrides
        .iter()
        .filter(|(unit, _)| !edits.clones.contains_key(*unit))
        .flat_map(|(unit, fields)| fields.keys().map(move |field| (unit, field)))
        .filter(|(unit, field)| project.is_mutator_only(unit, field))
        .count();
    if routed > 0 {
        out.push(format!(
            "{routed} field change{} you sent to the mutator route {} not written into the game. {} still need{} a mutator.",
            if routed == 1 { "" } else { "s" },
            if routed == 1 { "is" } else { "are" },
            if routed == 1 { "It" } else { "They" },
            if routed == 1 { "s" } else { "" },
        ));
    }
    out
}

/// Why a list or a table cannot go in place, said the same way by the write
/// and by the dry run the unit page asks for.
const NOT_A_PLAIN_VALUE: &str = "Only a number, a string or true or false can be written into the file. A list or a table has to go through the mutator route.";

/// How many lines either side of a refusal's location the unit page shows.
const EXCERPT_CONTEXT: usize = 3;

/// The most lines an excerpt holds, so a refusal about a whole unit's table
/// shows where it starts rather than all of it.
const EXCERPT_MAX: usize = 16;

/// Some lines of a unit file around a refusal's location.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Excerpt {
    /// The first line's number, counted from 1.
    pub first_line: usize,
    pub lines: Vec<String>,
}

fn excerpt(text: &str, location: &Location) -> Excerpt {
    let lines: Vec<&str> = text.lines().collect();
    let start = location
        .start
        .line
        .saturating_sub(1 + EXCERPT_CONTEXT)
        .min(lines.len());
    let end = (location.end.line + EXCERPT_CONTEXT)
        .min(lines.len())
        .min(start + EXCERPT_MAX)
        .max(start);
    Excerpt {
        first_line: start + 1,
        lines: lines[start..end].iter().map(|l| l.to_string()).collect(),
    }
}

/// One field the unit page asks about, with the value to try: the project's
/// change when it has one, otherwise the game's own value. `null` stands for
/// a field the game does not set.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct FieldProbe {
    pub field: String,
    #[serde(default)]
    pub value: Value,
}

/// Whether one field can be written in place, and why not when it cannot.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldCheck {
    pub field: String,
    /// Absent when the field can be written.
    pub refusal: Option<Refused>,
    /// The unit file's Lua around the refusal's location, when it has one.
    pub excerpt: Option<Excerpt>,
}

/// What a dry run found for one unit.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckOutcome {
    /// The unit's file, relative to the game, when one defines it.
    pub file: Option<String>,
    pub fields: Vec<FieldCheck>,
}

/// Whether each of `fields` of `unit` could be written into the game's own
/// files, without writing anything (issue #2633). The unit page asks this at
/// edit time so a field the route cannot carry is marked before the user
/// reaches the write. `def` is the game's read of the unit, which a field
/// through a list position is read against (see [`segments`]).
pub fn check(
    game_dir: &Path,
    unit: &str,
    fields: &[FieldProbe],
    def: Option<&Value>,
) -> Result<CheckOutcome, String> {
    require_loose_game(game_dir)?;
    let refusal = |field: &str, template: &Refused| FieldCheck {
        field: field.to_string(),
        refusal: Some(Refused {
            field: field.to_string(),
            ..template.clone()
        }),
        excerpt: None,
    };
    let invalid = |file: Option<String>, message: String| Refused {
        unit: unit.to_string(),
        field: String::new(),
        file,
        kind: RefusalKind::InvalidValue,
        message,
        location: None,
    };

    // Each field as an edit, or the reason it cannot be one.
    let edits: Vec<Result<(Vec<Segment>, PatchValue), String>> = fields
        .iter()
        .map(|probe| {
            let path = segments(&probe.field, def)?;
            let value = match &probe.value {
                // Any literal shows whether the file has somewhere to put
                // one, and a number is the commonest kind of field.
                Value::Null => PatchValue::Number(1.0),
                value => patch_value(value).ok_or_else(|| NOT_A_PLAIN_VALUE.to_string())?,
            };
            Ok((path, value))
        })
        .collect();

    let texts = unit_texts(game_dir);
    let files: Vec<PathBuf> = texts.keys().cloned().collect();
    let Some(first) = edits.iter().find_map(|e| e.as_ref().ok()) else {
        return Ok(CheckOutcome {
            file: None,
            fields: fields
                .iter()
                .zip(&edits)
                .map(|(probe, edit)| {
                    let message = edit.as_ref().err().cloned().unwrap_or_default();
                    refusal(&probe.field, &invalid(None, message))
                })
                .collect(),
        });
    };
    let first = Edit {
        unit: unit.to_string(),
        path: first.0.clone(),
        op: Op::Set(first.1.clone()),
    };
    let file = match find_unit_file(unit, &files, &texts, |file, text| {
        locate_edit(file, text, &first, game_dir)
    }) {
        Found::File(file, _) => file,
        Found::None(file_level) => {
            let shown = file_level
                .as_ref()
                .and_then(|(file, r)| Some(excerpt(&texts[file], r.location.as_ref()?)));
            let refused = no_file_refusal(unit, file_level, game_dir);
            return Ok(CheckOutcome {
                file: refused.file.clone(),
                fields: fields
                    .iter()
                    .map(|probe| FieldCheck {
                        excerpt: shown.clone(),
                        ..refusal(&probe.field, &refused)
                    })
                    .collect(),
            });
        }
    };
    let text = &texts[&file];
    let rel = key(file.strip_prefix(game_dir).unwrap_or(&file));

    let valid: Vec<(Vec<Segment>, PatchValue)> = edits
        .iter()
        .filter_map(|e| e.as_ref().ok().cloned())
        .collect();
    let answers = if is_fbi(&file) {
        fbi::check_fields(text, unit, &valid, &file)
    } else {
        coilbox_unitpatch::check_fields(text, unit, &valid, game_dir)
    };
    let mut answers = answers.into_iter();
    let fields = fields
        .iter()
        .zip(&edits)
        .map(|(probe, edit)| match edit {
            Err(message) => refusal(&probe.field, &invalid(Some(rel.clone()), message.clone())),
            Ok(_) => match answers.next() {
                Some(Err(r)) => {
                    // A refusal about the file the unit file includes shows
                    // that file's Lua (issue #3021).
                    let (shown, text) = match &r.file {
                        Some(path) => (
                            key(path.strip_prefix(game_dir).unwrap_or(path)),
                            std::fs::read_to_string(path).ok(),
                        ),
                        None => (rel.clone(), Some(text.clone())),
                    };
                    FieldCheck {
                        field: probe.field.clone(),
                        excerpt: r
                            .location
                            .as_ref()
                            .zip(text.as_deref())
                            .map(|(at, text)| excerpt(text, at)),
                        refusal: Some(Refused {
                            unit: unit.to_string(),
                            field: probe.field.clone(),
                            file: Some(shown),
                            kind: r.kind,
                            message: r.message,
                            location: r.location,
                        }),
                    }
                }
                _ => FieldCheck {
                    field: probe.field.clone(),
                    refusal: None,
                    excerpt: None,
                },
            },
        })
        .collect();
    Ok(CheckOutcome {
        file: Some(rel),
        fields,
    })
}

/// What a dry run found for one copy (issue #3035).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneCheckOutcome {
    /// Every change the copy makes that no edit to a file can carry. Empty
    /// for a copy the write does not attempt in place at all: one with no
    /// source, or one that replaces a game unit (see [`inplace_clone::writable`]).
    pub unwritable: Vec<inplace_clone::Unwritable>,
}

/// Whether a copy's own changes could be written into the game's own files,
/// without writing anything and without reading any file (issue #3035). A
/// copy's differences from its source are worked out from values alone, the
/// same way [`inplace_clone::copy_edits`] does for the write, so the unit
/// page can ask this the moment the copy is edited rather than at write time.
///
/// `overrides` and `menu_ops` are the project's own edits to this one copy,
/// which `resolved_clone_def` folds into `clone.def` the same way the write
/// does, so the answer matches what the write would actually try.
pub fn check_clone(
    game_dir: &Path,
    clone: &UnitClone,
    overrides: Option<&UnitPatch>,
    menu_ops: Option<&[BuildMenuOp]>,
    source_def: &Value,
) -> Result<CloneCheckOutcome, String> {
    require_loose_game(game_dir)?;
    if !inplace_clone::writable(clone) {
        return Ok(CloneCheckOutcome {
            unwritable: Vec::new(),
        });
    }
    let mut edits = GameEdits::default();
    if let Some(patch) = overrides {
        edits.overrides.insert(clone.key.clone(), patch.clone());
    }
    if let Some(ops) = menu_ops {
        edits.menus.insert(clone.key.clone(), ops.to_vec());
    }
    let def = crate::compile::resolved_clone_def(clone, &edits);
    let (_, unwritable) = inplace_clone::copy_edits(source_def, &def);
    Ok(CloneCheckOutcome { unwritable })
}

/// One unit's field changes, ready to patch.
struct UnitChanges<'a> {
    unit: &'a str,
    /// Each change as the project spells its path, and the edit it becomes.
    edits: Vec<(&'a str, Edit)>,
}

/// Which file defines `unit`, and the result of the first attempt on it.
///
/// A file is a candidate when its text names the unit at all. The patcher
/// then settles it: a file that does not define the unit is refused as
/// `UnitNotFound` before anything is evaluated, so trying each candidate is
/// cheap. Files whose name matches the unit are tried first, because that is
/// how most games lay their units out.
///
/// An `.fbi` file is a candidate when its name is the unit's, since the
/// engine names an `.fbi` unit after its file whatever the text says (issue
/// #2638). A `.lua` file is tried before an `.fbi` one, because the engine
/// loads the Lua ones second and a unit defined in both is the Lua one.
enum Found<T> {
    /// The file, and the first attempt's result against it.
    File(PathBuf, Result<T, coilbox_unitpatch::Refusal>),
    /// No file under `units/` defines the unit. The refusal, when there is
    /// one, is the most useful thing a candidate file said.
    None(Option<(PathBuf, coilbox_unitpatch::Refusal)>),
}

fn find_unit_file<T>(
    unit: &str,
    files: &[PathBuf],
    texts: &BTreeMap<PathBuf, String>,
    attempt: impl Fn(&Path, &str) -> Result<T, coilbox_unitpatch::Refusal>,
) -> Found<T> {
    let wanted = unit.to_lowercase();
    let mut candidates: Vec<&PathBuf> = files
        .iter()
        .filter(|f| {
            if is_fbi(f) {
                fbi::unit_name(f) == wanted
            } else {
                texts[*f].to_lowercase().contains(&wanted)
            }
        })
        .collect();
    candidates.sort_by_key(|f| {
        let stem = f.file_stem().map(|s| s.to_string_lossy().to_lowercase());
        (is_fbi(f), stem.as_deref() != Some(wanted.as_str()))
    });
    let mut file_level: Option<(PathBuf, coilbox_unitpatch::Refusal)> = None;
    for file in candidates {
        match attempt(file, &texts[file]) {
            Err(refusal) if refusal.kind == RefusalKind::UnitNotFound => continue,
            // A file that does not parse or does not return a table might be
            // a helper that merely mentions the unit, so keep looking, and
            // report it only if no other file turns out to define the unit.
            Err(refusal)
                if matches!(
                    refusal.kind,
                    RefusalKind::Syntax | RefusalKind::ReturnNotLiteral
                ) =>
            {
                file_level.get_or_insert((file.clone(), refusal));
            }
            result => return Found::File(file.clone(), result),
        }
    }
    Found::None(file_level)
}

/// The refusal for every change to `unit` when no file under `units/`
/// defines it, with an empty `field` for the caller to fill in.
fn no_file_refusal(
    unit: &str,
    file_level: Option<(PathBuf, coilbox_unitpatch::Refusal)>,
    game_dir: &Path,
) -> Refused {
    match file_level {
        Some((file, refusal)) => Refused {
            unit: unit.to_string(),
            field: String::new(),
            file: Some(key(file.strip_prefix(game_dir).unwrap_or(&file))),
            kind: refusal.kind,
            message: refusal.message,
            location: refusal.location,
        },
        None => Refused {
            unit: unit.to_string(),
            field: String::new(),
            file: None,
            kind: RefusalKind::UnitNotFound,
            message: format!("No file under units/ defines {unit}."),
            location: None,
        },
    }
}

/// Every unit file's text, by path. A Lua file that is not UTF-8 cannot be a
/// unit file the patcher reads, so it is left out of the search rather than
/// failing the whole request. An `.fbi` file that is not UTF-8 is read one
/// character per byte instead, since games of that era have a Windows-1252
/// character here and there, and [`unit_encodings`] says so for the write.
fn unit_texts(game_dir: &Path) -> BTreeMap<PathBuf, String> {
    unit_files(game_dir)
        .into_iter()
        .filter_map(|file| {
            let text = read_unit_file(&file)?.0;
            Some((file, text))
        })
        .collect()
}

fn read_unit_file(file: &Path) -> Option<(String, Encoding)> {
    if is_fbi(file) {
        Some(coilbox_tdf::decode(&std::fs::read(file).ok()?))
    } else {
        Some((std::fs::read_to_string(file).ok()?, Encoding::Utf8))
    }
}

/// The unit files [`unit_texts`] did not read as UTF-8, so the write puts
/// them back in the bytes they came in.
fn unit_encodings(files: &[PathBuf]) -> BTreeMap<PathBuf, Encoding> {
    files
        .iter()
        .filter(|file| is_fbi(file))
        .filter_map(|file| Some((file.clone(), read_unit_file(file)?.1)))
        .filter(|(_, encoding)| *encoding != Encoding::Utf8)
        .collect()
}

/// Patch every field change in `project` into the game's unit files under
/// `game_dir`, add each copy as a unit file of its own, and write them if the
/// patcher accepted every one.
///
/// `sources` is the game's own read of units, keyed by unit: each unit a copy
/// was made from, which is what a copy's changes are worked out against, and
/// each unit with a field change through a list position, which [`segments`]
/// reads that position against. See `inplace_clone.rs` for why the unit's
/// file cannot stand in for it.
pub fn write(
    game_dir: &Path,
    project: &ModProject,
    sources: &BTreeMap<String, Value>,
) -> Result<WriteOutcome, String> {
    require_loose_game(game_dir)?;
    let mut outcome = WriteOutcome {
        not_carried: not_carried(project),
        ..WriteOutcome::default()
    };
    let rel = |path: &Path| key(path.strip_prefix(game_dir).unwrap_or(path));

    // Turn each change into an edit, refusing what the patcher cannot write.
    let mut units = Vec::new();
    for (unit, fields) in &project.edits.overrides {
        if project.edits.clones.contains_key(unit) {
            continue; // Counted in `not_carried` with its copy.
        }
        let mut edits = Vec::new();
        for (field, value) in fields {
            if project.is_mutator_only(unit, field) {
                continue; // Counted in `not_carried`.
            }
            let refuse = |message: String| Refused {
                unit: unit.clone(),
                field: field.clone(),
                file: None,
                kind: RefusalKind::InvalidValue,
                message,
                location: None,
            };
            let path = match segments(field, sources.get(unit)) {
                Ok(path) => path,
                Err(message) => {
                    outcome.refused.push(refuse(message));
                    continue;
                }
            };
            let Some(value) = patch_value(value) else {
                outcome.refused.push(refuse(NOT_A_PLAIN_VALUE.to_string()));
                continue;
            };
            edits.push((
                field.as_str(),
                Edit {
                    unit: unit.clone(),
                    path,
                    op: Op::Set(value),
                },
            ));
        }
        if !edits.is_empty() {
            units.push(UnitChanges { unit, edits });
        }
    }

    let mut texts = unit_texts(game_dir);
    let files: Vec<PathBuf> = texts.keys().cloned().collect();
    let originals = texts.clone();
    // Files outside `units/` that a unit file includes for its table (issue
    // #3021), as patched so far. Each patch reads them in place of the disk.
    let mut included: BTreeMap<PathBuf, String> = BTreeMap::new();
    // Which file each accepted change landed in, to say whether undo reaches it.
    let mut held: Vec<(&str, &str, PathBuf)> = Vec::new();

    for UnitChanges { unit, edits } in units {
        let (_, first) = &edits[0];
        let found = find_unit_file(unit, &files, &texts, |file, text| {
            patch_file(file, text, first, game_dir, &included)
        });
        let (file, first_result) = match found {
            Found::File(file, result) => (file, result),
            Found::None(file_level) => {
                let refused = no_file_refusal(unit, file_level, game_dir);
                for (field, _) in &edits {
                    outcome.refused.push(Refused {
                        field: field.to_string(),
                        ..refused.clone()
                    });
                }
                continue;
            }
        };
        let mut pending = Some(first_result);
        for (field, edit) in &edits {
            let result = match pending.take() {
                Some(result) => result,
                None => patch_file(&file, &texts[&file], edit, game_dir, &included),
            };
            match result {
                Ok(patched) => {
                    let into = patched.file.clone().unwrap_or_else(|| file.clone());
                    if patched.changed {
                        outcome.changed += 1;
                        match patched.file {
                            Some(path) => included.insert(path, patched.text),
                            None => texts.insert(file.clone(), patched.text),
                        };
                    } else {
                        outcome.unchanged += 1;
                    }
                    held.push((unit, *field, into));
                }
                Err(refusal) => outcome.refused.push(Refused {
                    unit: unit.to_string(),
                    field: field.to_string(),
                    file: Some(rel(refusal.file.as_deref().unwrap_or(&file))),
                    kind: refusal.kind,
                    message: refusal.message,
                    location: refusal.location,
                }),
            }
        }
    }

    // The weapon file each equipped library weapon goes into the game's
    // shared weapon table by (issue #3068), whether this write adds the
    // weapon to a game unit or to a copy.
    let mut weapon_files: BTreeMap<PathBuf, String> = BTreeMap::new();
    write_equipped(
        game_dir,
        project,
        sources,
        &files,
        &mut texts,
        &mut included,
        &mut weapon_files,
        &mut outcome,
    );

    // A game's own `gamedata/sidedata.tdf`, read and patched as a copy joins
    // an `.fbi` builder's menu (issue #3040), cached here so a second copy or
    // builder in the same write sees the first one's change.
    let mut gamedata: BTreeMap<PathBuf, (String, Encoding)> = BTreeMap::new();
    let created = write_copies(
        game_dir,
        project,
        sources,
        &files,
        &originals,
        &mut texts,
        &mut included,
        &mut gamedata,
        &mut weapon_files,
        &mut outcome,
    );

    // Every file to write, as the bytes to write, in the order the outcome
    // lists them. A file read one character per byte goes back the same way,
    // and a change that brings in a character it has no byte for is refused
    // before anything is written.
    let encodings = unit_encodings(&files);
    let changed = texts
        .iter()
        .filter(|(file, text)| originals.get(*file) != Some(*text))
        .map(|(file, text)| (file, text, encodings.get(file).copied()));
    // A weapon file already holding the same text needs no write.
    weapon_files.retain(|file, text| std::fs::read_to_string(file).ok().as_deref() != Some(text));
    let others = included
        .iter()
        .chain(weapon_files.iter())
        .map(|(file, text)| (file, text, None))
        .chain(
            created
                .iter()
                .map(|(file, text, encoding)| (file, text, Some(*encoding))),
        )
        .chain(
            gamedata
                .iter()
                .map(|(file, (text, encoding))| (file, text, Some(*encoding))),
        );
    let mut writes = Vec::new();
    for (file, text, encoding) in changed.chain(others) {
        let encoding = encoding.unwrap_or(Encoding::Utf8);
        match encoding.encode(text) {
            Some(bytes) => writes.push((file.clone(), bytes)),
            None => outcome.refused.push(Refused {
                unit: file
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_lowercase())
                    .unwrap_or_default(),
                field: String::new(),
                file: Some(rel(file)),
                kind: RefusalKind::InvalidValue,
                message: "This file is not UTF-8, and a change to it holds a character it has no byte for, such as one outside Western European text.".into(),
                location: None,
            }),
        }
    }

    if !outcome.refused.is_empty() {
        outcome.changed = 0;
        outcome.unchanged = 0;
        outcome.copies.clear();
        outcome.equipped.clear();
        return Ok(outcome);
    }

    for (file, bytes) in &writes {
        // A game with no `weapons` folder gets one for its first weapon file.
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not make {}: {e}", parent.display()))?;
        }
        MARKERS.write(file, bytes)?;
        outcome.written.push(rel(file));
    }
    outcome.carried = held
        .into_iter()
        .map(|(unit, field, file)| Carried {
            unit: unit.to_string(),
            field: field.to_string(),
            undoable: coilbox_gamebackup::with_suffix(&file, MARKERS.backup).exists()
                || coilbox_gamebackup::with_suffix(&file, MARKERS.created).exists(),
        })
        .collect();
    // The unitsync worker and the engine's own archive cache both key a loose
    // game on its folder's own mtime (issue #2637), which a write under
    // `units/` never moves on its own.
    if !outcome.written.is_empty() {
        coilbox_gamebackup::touch(game_dir);
    }
    Ok(outcome)
}

/// The edits that equip library weapon `key` at `step` on the game unit
/// `unit` (issue #3055), or why there are none.
///
/// The same changes the mutator's equip block makes at load time
/// (`compile::equip_block`), made to the file instead. The weapon, and each
/// library weapon it names, goes into the unit's own `weapondefs` under its
/// library key, with the values from before the game's post files ran
/// (`compile::library_def`). A slot is pointed at it by `def`, which the
/// base content's `weapondefs_post.lua` and every game's copy of it turn into
/// `<unit>_<key>`, and by `name` set to that full name, for a game that reads
/// only the name. A death explosion field is set to `<unit>_<key>`, which
/// those post files leave alone and the engine then finds as the definition
/// the unit carries (`compile::death_name`).
///
/// An `.fbi` unit has no `weapondefs` table and no `def` in a slot, so for
/// one only the name is written (issue #3068). The weapon file beside it,
/// which [`write_equipped`] adds for every unit, is what puts the weapon in
/// the game's table under that name.
///
/// `def` is the game's read of the unit, which a slot's step is read against
/// the way [`segments`] reads a field's.
fn equip_edits(
    unit: &str,
    step: &str,
    key: &str,
    edits: &GameEdits,
    def: Option<&Value>,
    fbi: bool,
) -> Result<Vec<Edit>, String> {
    let Some(at) = crate::compile::equip_at(step) else {
        return Err(format!(
            "{step:?} is not a weapon slot or a death explosion."
        ));
    };
    if !edits.weapons.contains_key(key) || !crate::compile::valid_unit_key(key) {
        return Err(
            "The weapon is not in the library under a name the compiler can use.".to_string(),
        );
    }
    let set = |path: Vec<Segment>, value: PatchValue| Edit {
        unit: unit.to_string(),
        path,
        op: Op::Set(value),
    };
    let mut out = Vec::new();
    let own = if fbi {
        Vec::new()
    } else {
        crate::compile::library_defs_for(unit, key, &edits.weapons)
    };
    for (name, weapon) in own {
        let value = PatchValue::from_json(&weapon)
            .map_err(|reason| format!("The weapon {name} cannot be written as Lua. {reason}"))?;
        out.push(set(
            vec![Segment::Key("weapondefs".into()), Segment::Key(name)],
            value,
        ));
    }
    let full = crate::compile::death_name(unit, key);
    match at {
        crate::compile::EquipAt::Death(field) => {
            out.push(set(
                vec![Segment::Key(field.to_string())],
                PatchValue::String(full),
            ));
        }
        crate::compile::EquipAt::Slot(_) => {
            let slot = segments(&format!("weapons.{step}"), def)?;
            let at = |field: &str| {
                let mut path = slot.clone();
                path.push(Segment::Key(field.to_string()));
                path
            };
            if !fbi {
                out.push(set(at("def"), PatchValue::String(key.to_string())));
            }
            out.push(set(at("name"), PatchValue::String(full)));
        }
    }
    Ok(out)
}

/// Write each library weapon equipped into a game unit into that unit's file
/// (issue #3055), after the field changes, into `texts` and `included`.
///
/// Each weapon is all or nothing: its edits are made to a scratch copy of the
/// file and kept only if every one goes through. One that cannot be written,
/// such as into a unit whose table other units share, is said in
/// `not_carried` with the reason, and left to the mutator. It does not stop
/// the rest of the write, since it changes nothing on disk.
///
/// Each one written also gets its weapon file under `weapons/`, in
/// `weapon_files`, for the reason `compile::weapon_file_path` gives: a game
/// whose `weapondefs_post.lua` never adds a unit's own weapons to the shared
/// table finds it there (issue #3068).
///
/// A copy's equipped weapons are not written here. They are part of the
/// copy's definition, and go into its own file with it.
#[allow(clippy::too_many_arguments)]
fn write_equipped(
    game_dir: &Path,
    project: &ModProject,
    sources: &BTreeMap<String, Value>,
    files: &[PathBuf],
    texts: &mut BTreeMap<PathBuf, String>,
    included: &mut BTreeMap<PathBuf, String>,
    weapon_files: &mut BTreeMap<PathBuf, String>,
    outcome: &mut WriteOutcome,
) {
    let rel = |path: &Path| key(path.strip_prefix(game_dir).unwrap_or(path));
    let edits = &project.edits;
    for (unit, slots) in &edits.equipped {
        if edits.clones.contains_key(unit) {
            continue;
        }
        for (step, weapon) in slots {
            let about = match crate::compile::equip_at(step) {
                Some(crate::compile::EquipAt::Death(field)) => {
                    format!("Library weapon {weapon} as {unit}'s {field}")
                }
                _ => format!("Library weapon {weapon} in {unit}'s weapon slot {step}"),
            };
            let mut report = |reason: String| {
                outcome.not_carried.push(format!(
                    "{about} is not written into the game, and still needs a mutator. {reason}"
                ));
            };
            let file = match find_unit_file(unit, files, texts, |file, text| {
                locate_unit(file, text, unit)
            }) {
                Found::File(file, Ok(_)) => file,
                Found::File(_, Err(r)) => {
                    report(r.message);
                    continue;
                }
                Found::None(file_level) => {
                    report(no_file_refusal(unit, file_level, game_dir).message);
                    continue;
                }
            };
            let list =
                match equip_edits(unit, step, weapon, edits, sources.get(unit), is_fbi(&file)) {
                    Ok(list) => list,
                    Err(reason) => {
                        report(reason);
                        continue;
                    }
                };
            // A unit whose own `weapondefs` cannot take the weapon, such as
            // a SplinterFaction unit, whose file sets that table again after
            // its basedef builds the unit (issue #3069), still gets the slot
            // pointed at the weapon's full name. The weapon file is what puts
            // the weapon in the game's table under that name, as for an
            // `.fbi` unit.
            let applied = match apply_equip(&file, &texts[&file], included, &list, game_dir) {
                Err(refusal)
                    if refusal.own && crate::compile::weapon_file_name(unit, weapon).is_some() =>
                {
                    let named: Vec<Edit> = list
                        .iter()
                        .filter(|e| !adds_own_weapon(e))
                        .cloned()
                        .collect();
                    apply_equip(&file, &texts[&file], included, &named, game_dir)
                }
                other => other,
            };
            let (text, pending, into, mut changed) = match applied {
                Ok(applied) => applied,
                Err(EquipRefused { refusal, .. }) => {
                    let at = rel(refusal.file.as_deref().unwrap_or(&file));
                    let line = refusal
                        .location
                        .map_or(String::new(), |l| format!(", line {}", l.start.line));
                    report(format!("{} ({at}{line})", refusal.message));
                    continue;
                }
            };
            if let Some((path, contents)) = weapon_file(game_dir, unit, weapon, edits) {
                changed |=
                    std::fs::read_to_string(&path).ok().as_deref() != Some(contents.as_str());
                weapon_files.insert(path, contents);
            }
            texts.insert(file, text);
            *included = pending;
            if changed {
                outcome.changed += 1;
            } else {
                outcome.unchanged += 1;
            }
            outcome.equipped.push(WrittenEquip {
                unit: unit.clone(),
                at: step.clone(),
                weapon: weapon.clone(),
                file: rel(&into),
            });
        }
    }
}

/// Why one equipped weapon's edits could not all go in, and whether the edit
/// refused was one adding a weapon to the unit's own `weapondefs`.
struct EquipRefused {
    refusal: Refusal,
    own: bool,
}

/// The file text, included files, file the slot went into and whether
/// anything changed, once every edit in `list` is made to a scratch copy of
/// `text` and `included`.
type Equipped = (String, BTreeMap<PathBuf, String>, PathBuf, bool);

/// Whether `edit` adds a weapon to the unit's own `weapondefs`.
fn adds_own_weapon(edit: &Edit) -> bool {
    edit.path.first() == Some(&Segment::Key("weapondefs".into()))
}

/// Make one equipped weapon's edits, all or nothing.
fn apply_equip(
    file: &Path,
    text: &str,
    included: &BTreeMap<PathBuf, String>,
    list: &[Edit],
    game_dir: &Path,
) -> Result<Equipped, EquipRefused> {
    let mut text = text.to_string();
    let mut pending = included.clone();
    let mut into = file.to_path_buf();
    let mut changed = false;
    for edit in list {
        let patched =
            patch_file(file, &text, edit, game_dir, &pending).map_err(|refusal| EquipRefused {
                refusal,
                own: adds_own_weapon(edit),
            })?;
        changed |= patched.changed;
        match patched.file {
            Some(path) => {
                into = path.clone();
                if patched.changed {
                    pending.insert(path, patched.text);
                }
            }
            None if patched.changed => text = patched.text,
            None => {}
        }
    }
    Ok((text, pending, into, changed))
}

/// The weapon file that puts library weapon `key` into the game's shared
/// weapon table under the name `unit` fires it by (issue #3068), as its path
/// under `game_dir` and its text: `compile::weapon_file`, in the `weapons`
/// folder the game already has, however it spells it. `None` for a unit whose
/// name cannot be part of a file name.
///
/// A file already there is written over, with a backup like any other, so
/// undo puts back whatever an earlier write left.
fn weapon_file(
    game_dir: &Path,
    unit: &str,
    key: &str,
    edits: &GameEdits,
) -> Option<(PathBuf, String)> {
    let name = crate::compile::weapon_file_name(unit, key)?;
    let dir = std::fs::read_dir(game_dir)
        .ok()?
        .flatten()
        .find(|entry| entry.path().is_dir() && entry.file_name().eq_ignore_ascii_case("weapons"))
        .map_or_else(|| game_dir.join("weapons"), |entry| entry.path());
    let path = inplace_clone::file_taken(&dir.join(&name)).unwrap_or_else(|| dir.join(&name));
    Some((path, crate::compile::weapon_file(unit, key, &edits.weapons)))
}

/// Add `unit` to `builder`'s build menu in `gamedata/sidedata.tdf` (issue
/// #3040), for a builder whose own file is `.fbi` and so does not hold its
/// menu itself. `gamedata` caches the file's text and encoding once it is
/// read or changed, so a second copy or builder added in the same write sees
/// the first one's change rather than the file on disk.
fn add_fbi_builder(
    game_dir: &Path,
    builder: &str,
    unit: &str,
    gamedata: &mut BTreeMap<PathBuf, (String, Encoding)>,
) -> Option<Refused> {
    let rel = |path: &Path| key(path.strip_prefix(game_dir).unwrap_or(path));
    let refuse = |file: Option<String>, kind, message: String| Refused {
        unit: builder.to_string(),
        field: "buildoptions".into(),
        file,
        kind,
        message,
        location: None,
    };
    if let Some(lua_file) = lua_build_menu_override(game_dir) {
        let shown = rel(&lua_file);
        return Some(refuse(
            Some(shown.clone()),
            RefusalKind::FieldComputed,
            format!(
                "This game works out its build menus in {shown}, so a canbuild key in gamedata/sidedata.tdf would not be what the engine reads for {builder}."
            ),
        ));
    }
    let Some(dir) = gamedata_dir(game_dir) else {
        return Some(refuse(
            None,
            RefusalKind::ParentMissing,
            "This game has no gamedata folder, so there is nowhere to add a build menu."
                .to_string(),
        ));
    };
    let Some(path) = find_file_ci(&dir, "sidedata.tdf") else {
        return Some(refuse(
            None,
            RefusalKind::ParentMissing,
            "This game has no gamedata/sidedata.tdf, so there is nowhere to add a build menu."
                .to_string(),
        ));
    };
    let shown = rel(&path);
    let (text, encoding) = match gamedata.get(&path) {
        Some(cached) => cached.clone(),
        None => {
            let Ok(bytes) = std::fs::read(&path) else {
                return Some(refuse(
                    Some(shown),
                    RefusalKind::Syntax,
                    "This file could not be read.".to_string(),
                ));
            };
            coilbox_tdf::decode(&bytes)
        }
    };
    match fbi::add_to_build_menu(&text, builder, unit) {
        Ok(patched) => {
            if patched.changed {
                gamedata.insert(path, (patched.text, encoding));
            }
            None
        }
        Err(r) => Some(Refused {
            unit: builder.to_string(),
            field: "buildoptions".into(),
            file: Some(shown),
            kind: r.kind,
            message: r.message,
            location: r.location,
        }),
    }
}

/// Make each copy's file and add it to its builders' lists (issue #2634).
///
/// The copy is made from the source's file as the game has it now, from
/// `originals`, not from `texts`: a field change to the source written in the
/// same go is the source's, and the copy's definition already says whether it
/// wants that value. The builders' pushes go into `texts`, or `included`
/// when a builder's table is in a file its unit file includes, beside any
/// field change to the same file. Returns the new files to write, and adds
/// every refusal to `outcome`.
///
/// A copy of a unit whose table is in an included file gets a copy of that
/// file as well, beside it, which the copy's unit file includes instead
/// (issue #3021). Both are new files, so undo deletes both.
#[allow(clippy::too_many_arguments)]
fn write_copies(
    game_dir: &Path,
    project: &ModProject,
    sources: &BTreeMap<String, Value>,
    files: &[PathBuf],
    originals: &BTreeMap<PathBuf, String>,
    texts: &mut BTreeMap<PathBuf, String>,
    included: &mut BTreeMap<PathBuf, String>,
    gamedata: &mut BTreeMap<PathBuf, (String, Encoding)>,
    weapon_files: &mut BTreeMap<PathBuf, String>,
    outcome: &mut WriteOutcome,
) -> Vec<(PathBuf, String, Encoding)> {
    let rel = |path: &Path| key(path.strip_prefix(game_dir).unwrap_or(path));
    let mut created = Vec::new();
    // A copy sent to the mutator route (issue #3035) is skipped here exactly
    // as a mutator-only field change is skipped in `write` above: left out of
    // the write, counted in `not_carried`, and never refused, so it does not
    // stop the rest of the project going in. Its own build menu pushes are
    // never generated in the first place, since this loop is the only place
    // that adds them.
    let copies = project
        .edits
        .clones
        .values()
        .filter(|clone| inplace_clone::writable(clone))
        .filter(|clone| !project.is_clone_mutator_only(&clone.key));
    for clone in copies {
        let unit = clone.key.as_str();
        let source = clone
            .source
            .as_deref()
            .expect("a writable copy has a source");
        let refuse = |field: &str, file: Option<String>, kind, message: String| Refused {
            unit: unit.to_string(),
            field: field.to_string(),
            file,
            kind,
            message,
            location: None,
        };
        if !crate::compile::valid_unit_key(unit) {
            outcome.refused.push(refuse(
                "",
                None,
                RefusalKind::InvalidValue,
                format!("{unit:?} cannot be a unit's name. A unit's internal name can only hold lowercase letters, digits and underscores, and it becomes a file name in the game."),
            ));
            continue;
        }
        let Some(source_def) = sources.get(source) else {
            outcome.refused.push(refuse(
                "",
                None,
                RefusalKind::UnitNotFound,
                format!("The game has no unit called {source} to copy {unit} from."),
            ));
            continue;
        };
        if let Some((file, message)) = inplace_clone::name_taken(unit, originals, game_dir) {
            outcome.refused.push(refuse(
                "",
                Some(rel(&file)),
                RefusalKind::NameTaken,
                message,
            ));
            continue;
        }

        let def = crate::compile::resolved_clone_def(clone, &project.edits);
        let (edits, unwritable) = inplace_clone::copy_edits(source_def, &def);
        for u in unwritable {
            outcome
                .refused
                .push(refuse(&u.field, None, RefusalKind::InvalidValue, u.message));
        }

        let file = match find_unit_file(source, files, originals, |file, text| {
            locate_unit(file, text, source)
        }) {
            Found::File(file, Ok(_)) => file,
            Found::File(file, Err(r)) => {
                outcome.refused.push(Refused {
                    location: r.location,
                    ..refuse("", Some(rel(&file)), r.kind, r.message)
                });
                continue;
            }
            Found::None(file_level) => {
                outcome.refused.push(Refused {
                    unit: unit.to_string(),
                    ..no_file_refusal(source, file_level, game_dir)
                });
                continue;
            }
        };
        // A copy of an `.fbi` unit is an `.fbi` file too, extension spelled
        // as its source's is (issue #2638).
        let extension = match file.extension() {
            Some(ext) if is_fbi(&file) => ext.to_string_lossy().into_owned(),
            _ => "lua".to_string(),
        };
        let target = file
            .parent()
            .unwrap_or(game_dir)
            .join(format!("{unit}.{extension}"));
        if let Some(taken) = inplace_clone::file_taken(&target) {
            outcome.refused.push(refuse(
                "",
                Some(rel(&taken)),
                RefusalKind::NameTaken,
                format!(
                    "{} already exists, so {unit} has nowhere to go beside {}.",
                    rel(&taken),
                    rel(&file)
                ),
            ));
            continue;
        }

        let mut edits = edits;
        if let Some(file_unit) = evaluate(&file, &originals[&file], game_dir)
            .ok()
            .and_then(|units| units.get(source.to_lowercase()).cloned())
        {
            let pins = inplace_clone::name_pins(source, source_def, &def, &file_unit);
            // An `.fbi` unit's sounds and build menu come from the game's
            // shared files, not from anything its name decides, so the copy
            // gets the same ones without a pin.
            edits.extend(pins.into_iter().filter(|pin| {
                !is_fbi(&file)
                    || !matches!(pin.path.first(), Some(Segment::Key(k))
                        if ["sounds", "buildoptions"].contains(&k.to_lowercase().as_str()))
            }));
        }
        let list: Vec<_> = edits
            .iter()
            .map(|e| (e.path.clone(), e.op.clone()))
            .collect();
        match clone_unit(&file, &originals[&file], source, unit, &list, game_dir) {
            Ok(cloned) => {
                // The library weapons equipped into the copy are in its
                // definition, and reach the shared table the way a game
                // unit's do (issue #3068).
                let equipped = project.edits.equipped.get(unit).into_iter().flatten();
                for (step, weapon) in equipped {
                    if crate::compile::equip_at(step).is_none()
                        || !project.edits.weapons.contains_key(weapon)
                    {
                        continue;
                    }
                    if let Some((path, contents)) =
                        weapon_file(game_dir, unit, weapon, &project.edits)
                    {
                        weapon_files.insert(path, contents);
                    }
                }
                let encoding = read_unit_file(&file).map_or(Encoding::Utf8, |(_, e)| e);
                created.push((target.clone(), cloned.text, encoding));
                created.extend(
                    cloned
                        .included
                        .map(|(path, text)| (path, text, Encoding::Utf8)),
                );
            }
            Err(refusals) => {
                for r in refusals {
                    let field = r.edit.map_or("", |at| edits[at].field.as_str());
                    let about = rel(r.refusal.file.as_deref().unwrap_or(&file));
                    outcome.refused.push(Refused {
                        location: r.refusal.location,
                        ..refuse(field, Some(about), r.refusal.kind, r.refusal.message)
                    });
                }
            }
        }

        let builders = inplace_clone::builders_adding(&project.edits, unit);
        for builder in &builders {
            let found = find_unit_file(builder, files, texts, |file, text| {
                locate_unit(file, text, builder)
            });
            let file = match found {
                Found::File(file, Ok(_)) => file,
                Found::File(file, Err(r)) => {
                    outcome.refused.push(Refused {
                        unit: builder.to_string(),
                        field: "buildoptions".into(),
                        file: Some(rel(r.file.as_deref().unwrap_or(&file))),
                        kind: r.kind,
                        message: r.message,
                        location: r.location,
                    });
                    continue;
                }
                Found::None(file_level) => {
                    outcome.refused.push(Refused {
                        field: "buildoptions".into(),
                        ..no_file_refusal(builder, file_level, game_dir)
                    });
                    continue;
                }
            };
            // An `.fbi` builder's menu is not in its own file, but in
            // `gamedata/sidedata.tdf`'s `[CANBUILD]` section (issue #3040).
            if is_fbi(&file) {
                if let Some(refused) = add_fbi_builder(game_dir, builder, unit, gamedata) {
                    outcome.refused.push(refused);
                }
                continue;
            }
            if inplace_clone::already_lists(&texts[&file], builder, unit, game_dir) {
                continue;
            }
            let push = Edit {
                unit: builder.to_string(),
                path: vec![Segment::Key("buildoptions".into())],
                op: Op::Push(PatchValue::String(unit.to_string())),
            };
            match patch_file(&file, &texts[&file], &push, game_dir, included) {
                Ok(patched) => match patched.file {
                    Some(path) => {
                        included.insert(path, patched.text);
                    }
                    None => {
                        texts.insert(file, patched.text);
                    }
                },
                Err(r) => outcome.refused.push(Refused {
                    unit: builder.to_string(),
                    field: "buildoptions".into(),
                    file: Some(rel(r.file.as_deref().unwrap_or(&file))),
                    kind: r.kind,
                    message: r.message,
                    location: r.location,
                }),
            }
        }
        outcome.copies.push(WrittenCopy {
            unit: unit.to_string(),
            file: rel(&target),
            builders: builders.iter().map(|b| b.to_string()).collect(),
        });
    }
    created
}

/// How many workshop backups and created markers sit under `game_dir`.
pub fn status(game_dir: &Path) -> StatusOutcome {
    let status = MARKERS.status(game_dir);
    StatusOutcome {
        backups: status.backups,
        created: status.created,
    }
}

/// Put every file the workshop wrote under `game_dir` back as it was.
pub fn undo(game_dir: &Path) -> Result<UndoOutcome, String> {
    require_loose_game(game_dir)?;
    let undone = MARKERS.undo(game_dir)?;
    // Undo puts old content back on disk, which is exactly what a stale
    // unitsync read would otherwise keep answering with (issue #2637).
    if !undone.restored.is_empty() || !undone.deleted.is_empty() {
        coilbox_gamebackup::touch(game_dir);
    }
    Ok(UndoOutcome {
        restored: undone.restored,
        deleted: undone.deleted,
    })
}

/// Keep every change the workshop wrote under `game_dir`, and drop the
/// backups.
pub fn accept(game_dir: &Path) -> Result<AcceptOutcome, String> {
    require_loose_game(game_dir)?;
    let kept = MARKERS.accept(game_dir)?;
    // Accept does not touch a unit file's own content, but it is offered
    // beside write and undo as one route, and the frontend refreshes after
    // all three (issue #2637): touching here means a scan that raced the
    // write and lost still gets put right once the user accepts.
    if !kept.is_empty() {
        coilbox_gamebackup::touch(game_dir);
    }
    Ok(AcceptOutcome { kept })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A digit step is read against the table the page read it from
    /// (issue #3041): a position counted from zero in a list numbered 1 to n,
    /// and the Lua key itself in a table with a gap.
    #[test]
    fn a_digit_step_is_read_as_the_page_read_it() {
        let steps = |index| {
            vec![
                Segment::Key("weapons".into()),
                Segment::Index(index),
                Segment::Key("def".into()),
            ]
        };
        let listed = serde_json::json!({ "weapons": [{ "def": "A" }, { "def": "B" }] });
        let gapped = serde_json::json!({ "weapons": { "1": { "def": "A" }, "3": { "def": "C" } } });
        assert_eq!(segments("weapons.0.def", Some(&listed)), Ok(steps(1)));
        assert_eq!(segments("weapons.1.def", Some(&listed)), Ok(steps(2)));
        assert_eq!(segments("weapons.1.def", Some(&gapped)), Ok(steps(1)));
        assert_eq!(segments("weapons.3.def", Some(&gapped)), Ok(steps(3)));
        // A table the read does not have is a list the page would create.
        assert_eq!(
            segments("weapons.0.def", Some(&serde_json::json!({}))),
            Ok(steps(1))
        );
        // Keys are matched as the patcher matches them.
        assert_eq!(
            segments("Weapons.1.def", Some(&gapped)).map(|s| s[1].clone()),
            Ok(Segment::Index(1))
        );

        assert!(segments("weapons.0.def", None).is_err());
        assert_eq!(
            segments("customparams.tonnage", None),
            Ok(vec![
                Segment::Key("customparams".into()),
                Segment::Key("tonnage".into())
            ])
        );
        assert!(segments("a..b", Some(&listed)).is_err());
    }

    /// Issue #3041 for a Lua unit: `weapons` numbered 1, 2 and 4 reads as an
    /// object, so the page's `weapons.1` is `weapons[1]`. Taken as a list
    /// position it would have changed `weapons[2]`, which the post-check
    /// cannot catch because that is exactly the change it was asked for.
    #[test]
    fn a_lua_list_with_a_gap_is_written_at_the_entry_the_page_showed() {
        let (_root, game) = game();
        let file = game.join("units/gapped.lua");
        let source = "return {\n  gapped = {\n    weapons = {\n      [1] = { def = \"LASER\" },\n      [2] = { def = \"ROCKET\" },\n      [4] = { def = \"DGUN\" },\n    },\n  },\n}\n";
        std::fs::write(&file, source).unwrap();
        let read_of_unit = serde_json::json!({
            "weapons": {
                "1": { "def": "LASER" },
                "2": { "def": "ROCKET" },
                "4": { "def": "DGUN" },
            },
        });
        let sources = BTreeMap::from([("gapped".to_string(), read_of_unit)]);

        let outcome = super::write(
            &game,
            &project(serde_json::json!({
                "gapped": { "weapons.1.def": "BIGLASER", "weapons.4.def": "BIGDGUN" },
            })),
            &sources,
        )
        .unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(
            read(&file),
            source
                .replacen("\"LASER\"", "\"BIGLASER\"", 1)
                .replacen("\"DGUN\"", "\"BIGDGUN\"", 1)
        );
    }

    /// Issue #2641: a definition the unit carries and no slot mounts takes an
    /// edit in its own file the same as a mounted one, and so does the
    /// reference that names it.
    #[test]
    fn a_supporting_definition_is_written_in_the_units_own_file() {
        let (_root, game) = game();
        let file = game.join("units/ship.lua");
        let source = "return {\n  ship = {\n    weapons = { { def = \"ROCKET\" } },\n    weapondefs = {\n      rocket = { range = 1000, customparams = { speceffect_def = \"ship_rocket_split\" } },\n      rocket_split = { range = 300 },\n      rocket_split2 = { range = 200 },\n    },\n  },\n}\n";
        std::fs::write(&file, source).unwrap();

        let outcome = write(
            &game,
            &project(serde_json::json!({
                "ship": {
                    "weapondefs.rocket_split.range": 450,
                    "weapondefs.rocket.customparams.speceffect_def": "ship_rocket_split2",
                },
            })),
        )
        .unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(
            read(&file),
            source.replacen("range = 300", "range = 450", 1).replacen(
                "\"ship_rocket_split\"",
                "\"ship_rocket_split2\"",
                1
            )
        );
    }

    #[test]
    fn only_plain_values_can_be_written() {
        assert!(patch_value(&serde_json::json!(3)).is_some());
        assert!(patch_value(&serde_json::json!("x")).is_some());
        assert!(patch_value(&serde_json::json!(true)).is_some());
        assert!(patch_value(&serde_json::json!(null)).is_none());
        assert!(patch_value(&serde_json::json!([1])).is_none());
    }

    fn fixture(name: &str) -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../coilbox-unitpatch/tests/fixtures")
            .join(name);
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    /// A loose game in a `games` folder with the two unit file shapes the
    /// patcher knows. SpringMCLegacy's BRV sits in a file not named after it,
    /// as its real `units/HeavyBRV.lua` does, and a second file mentions it
    /// in a build list without defining it.
    fn game() -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().expect("temp dir");
        let game = root.path().join("games/dev.sdd");
        let units = game.join("units");
        std::fs::create_dir_all(units.join("vehicles")).unwrap();
        std::fs::write(units.join("vehicles/HeavyBRV.lua"), fixture("mcl_brv.lua")).unwrap();
        std::fs::write(units.join("armdfly.lua"), fixture("bar_armdfly.lua")).unwrap();
        std::fs::write(
            units.join("factory.lua"),
            "return { factory = { buildoptions = { \"brv\" } } }\n",
        )
        .unwrap();
        (root, game)
    }

    fn project(overrides: Value) -> ModProject {
        serde_json::from_value(serde_json::json!({
            "name": "In place",
            "gameName": "Dev",
            "edits": { "overrides": overrides },
        }))
        .expect("parse")
    }

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    /// A write of a project with no copies, so no source units to send.
    fn write(game_dir: &Path, project: &ModProject) -> Result<WriteOutcome, String> {
        super::write(game_dir, project, &BTreeMap::new())
    }

    #[test]
    fn a_write_patches_each_file_once_and_keeps_the_original() {
        let (_root, game) = game();
        let brv = game.join("units/vehicles/HeavyBRV.lua");
        let dfly = game.join("units/armdfly.lua");
        let (brv_before, dfly_before) = (read(&brv), read(&dfly));

        let outcome = write(
            &game,
            &project(serde_json::json!({
                "brv": { "customparams.tonnage": 85 },
                "armdfly": { "metalcost": 400, "buildtime": 17000 },
            })),
        )
        .expect("write");

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(
            outcome.written,
            vec!["units/armdfly.lua", "units/vehicles/HeavyBRV.lua"]
        );
        assert_eq!(outcome.changed, 3);
        assert_eq!(
            read(&brv),
            brv_before.replacen("tonnage\t\t\t= 80", "tonnage\t\t\t= 85", 1)
        );
        assert_eq!(
            read(&dfly),
            dfly_before
                .replacen("metalcost = 320", "metalcost = 400", 1)
                .replacen("buildtime   =   16000", "buildtime   =   17000", 1)
        );
        assert_eq!(
            read(&coilbox_gamebackup::with_suffix(&dfly, MARKERS.backup)),
            dfly_before
        );
        assert_eq!(status(&game).backups, 2);
        assert_eq!(
            read(&game.join("units/factory.lua")),
            "return { factory = { buildoptions = { \"brv\" } } }\n"
        );
        assert!(
            !coilbox_gamebackup::with_suffix(&game.join("units/factory.lua"), MARKERS.backup)
                .exists()
        );
    }

    #[test]
    fn a_second_write_keeps_the_backup_from_before_the_first() {
        let (_root, game) = game();
        let dfly = game.join("units/armdfly.lua");
        let before = read(&dfly);
        write(
            &game,
            &project(serde_json::json!({ "armdfly": { "metalcost": 400 } })),
        )
        .unwrap();

        let outcome = write(
            &game,
            &project(serde_json::json!({ "armdfly": { "metalcost": 500 } })),
        )
        .unwrap();

        assert_eq!(outcome.written, vec!["units/armdfly.lua"]);
        assert!(read(&dfly).contains("metalcost = 500"));
        assert_eq!(
            read(&coilbox_gamebackup::with_suffix(&dfly, MARKERS.backup)),
            before
        );
        assert_eq!(status(&game).backups, 1);
    }

    #[test]
    fn a_write_says_which_changes_the_game_now_holds_and_which_undo_reaches() {
        let (_root, game) = game();
        // The BRV's tonnage is already 80 in its file, so the write leaves
        // that file alone and no backup of it exists to undo.
        let outcome = write(
            &game,
            &project(serde_json::json!({
                "brv": { "customparams.tonnage": 80 },
                "armdfly": { "metalcost": 400 },
            })),
        )
        .unwrap();

        let mut carried = outcome.carried.clone();
        carried.sort_by(|a, b| a.unit.cmp(&b.unit));
        assert_eq!(
            carried,
            vec![
                Carried {
                    unit: "armdfly".into(),
                    field: "metalcost".into(),
                    undoable: true,
                },
                Carried {
                    unit: "brv".into(),
                    field: "customparams.tonnage".into(),
                    undoable: false,
                },
            ]
        );
    }

    #[test]
    fn a_refused_write_says_the_game_holds_nothing() {
        let (_root, game) = game();
        let outcome = write(
            &game,
            &project(serde_json::json!({
                "armdfly": { "metalcost": 400, "health": 2000 },
            })),
        )
        .unwrap();
        assert!(!outcome.refused.is_empty());
        assert!(outcome.carried.is_empty(), "{:?}", outcome.carried);
    }

    #[test]
    fn one_refused_change_stops_the_whole_write() {
        let (_root, game) = game();
        let dfly = game.join("units/armdfly.lua");
        let brv = game.join("units/vehicles/HeavyBRV.lua");
        let (dfly_before, brv_before) = (read(&dfly), read(&brv));

        let outcome = write(
            &game,
            &project(serde_json::json!({
                "brv": { "customparams.tonnage": 85 },
                "armdfly": { "metalcost": 400, "health": 2000 },
            })),
        )
        .unwrap();

        assert!(outcome.written.is_empty());
        assert_eq!(outcome.refused.len(), 1, "{:?}", outcome.refused);
        let refused = &outcome.refused[0];
        assert_eq!(
            (refused.unit.as_str(), refused.field.as_str()),
            ("armdfly", "health")
        );
        assert_eq!(refused.kind, RefusalKind::FieldComputed);
        assert_eq!(refused.file.as_deref(), Some("units/armdfly.lua"));
        assert!(refused.location.is_some());
        assert_eq!(read(&dfly), dfly_before);
        assert_eq!(read(&brv), brv_before);
        assert_eq!(status(&game).backups, 0);
    }

    #[test]
    fn a_unit_no_file_defines_is_refused_by_name() {
        let (_root, game) = game();
        let outcome = write(
            &game,
            &project(serde_json::json!({ "armcom": { "metalcost": 1 } })),
        )
        .unwrap();

        assert_eq!(outcome.refused.len(), 1);
        assert_eq!(outcome.refused[0].kind, RefusalKind::UnitNotFound);
        assert!(outcome.refused[0].message.contains("armcom"));
        assert!(outcome.written.is_empty());
    }

    #[test]
    fn a_table_value_is_refused_rather_than_written() {
        let (_root, game) = game();
        let outcome = write(
            &game,
            &project(serde_json::json!({ "armdfly": { "buildoptions": ["armsolar"] } })),
        )
        .unwrap();

        assert_eq!(outcome.refused.len(), 1);
        assert_eq!(outcome.refused[0].kind, RefusalKind::InvalidValue);
        assert!(outcome.written.is_empty());
    }

    #[test]
    fn undo_puts_every_file_back_and_accept_keeps_the_change() {
        let (_root, game) = game();
        let dfly = game.join("units/armdfly.lua");
        let before = read(&dfly);
        let edits = project(serde_json::json!({ "armdfly": { "metalcost": 400 } }));

        write(&game, &edits).unwrap();
        let undone = undo(&game).unwrap();
        assert_eq!(undone.restored, vec!["units/armdfly.lua"]);
        assert_eq!(read(&dfly), before);
        assert_eq!(status(&game).backups, 0);

        write(&game, &edits).unwrap();
        let accepted = accept(&game).unwrap();
        assert_eq!(accepted.kept, vec!["units/armdfly.lua"]);
        assert!(read(&dfly).contains("metalcost = 400"));
        assert_eq!(status(&game).backups, 0);
    }

    /// Set `path`'s mtime a day in the past, so a later touch to now has
    /// something older to move away from regardless of filesystem
    /// resolution.
    fn backdate(path: &Path) {
        let day_ago =
            filetime::FileTime::from_unix_time(filetime::FileTime::now().seconds() - 86_400, 0);
        filetime::set_file_mtime(path, day_ago).unwrap();
    }

    fn mtime(path: &Path) -> std::time::SystemTime {
        std::fs::metadata(path).unwrap().modified().unwrap()
    }

    #[test]
    fn a_write_bumps_the_games_own_mtime_so_a_stale_scan_notices() {
        let (_root, game) = game();
        backdate(&game);
        let before = mtime(&game);

        write(
            &game,
            &project(serde_json::json!({ "armdfly": { "metalcost": 400 } })),
        )
        .unwrap();

        assert_ne!(
            mtime(&game),
            before,
            "a write changed a unit file, so the game folder's own mtime must \
             move or the unitsync cache keeps answering with the old content"
        );
    }

    #[test]
    fn a_write_that_changes_nothing_leaves_the_games_mtime_alone() {
        let (_root, game) = game();
        write(
            &game,
            &project(serde_json::json!({ "armdfly": { "metalcost": 400 } })),
        )
        .unwrap();
        backdate(&game);
        let before = mtime(&game);

        // The same edit again: the patcher sees the value already matches
        // and writes nothing.
        let outcome = write(
            &game,
            &project(serde_json::json!({ "armdfly": { "metalcost": 400 } })),
        )
        .unwrap();

        assert!(outcome.written.is_empty());
        assert_eq!(mtime(&game), before);
    }

    #[test]
    fn undo_and_accept_each_bump_the_games_own_mtime() {
        let (_root, game) = game();
        let edits = project(serde_json::json!({ "armdfly": { "metalcost": 400 } }));

        write(&game, &edits).unwrap();
        backdate(&game);
        let before_undo = mtime(&game);
        undo(&game).unwrap();
        assert_ne!(
            mtime(&game),
            before_undo,
            "undo put the old content back, which is as much a content \
             change as the write was"
        );

        write(&game, &edits).unwrap();
        backdate(&game);
        let before_accept = mtime(&game);
        accept(&game).unwrap();
        assert_ne!(mtime(&game), before_accept);
    }

    #[test]
    fn what_the_route_cannot_carry_is_said_not_dropped() {
        let (_root, game) = game();
        let project: ModProject = serde_json::from_value(serde_json::json!({
            "name": "In place",
            "gameName": "Dev",
            "edits": {
                "menus": { "armlab": [{ "op": "add", "unit": "armpw" }] },
                "disabled": ["armflash"],
            },
        }))
        .unwrap();

        let outcome = write(&game, &project).unwrap();

        assert_eq!(outcome.not_carried.len(), 2, "{:?}", outcome.not_carried);
        assert!(outcome.written.is_empty());
    }

    fn probes(fields: Value) -> Vec<FieldProbe> {
        serde_json::from_value(fields).expect("probes")
    }

    /// Issue #2633. The unit page asks before any edit, with the game's own
    /// values, and a field the file computes comes back refused with the
    /// file's Lua around it.
    #[test]
    fn a_dry_run_says_which_fields_can_be_written_and_writes_nothing() {
        let (_root, game) = game();
        let dfly = game.join("units/armdfly.lua");
        let before = read(&dfly);

        let outcome = check(
            &game,
            "armdfly",
            &probes(serde_json::json!([
                { "field": "metalcost", "value": 320 },
                { "field": "health", "value": 1000 },
                { "field": "brandnewfield", "value": null },
                { "field": "buildoptions", "value": ["armsolar"] },
            ])),
            None,
        )
        .unwrap();

        assert_eq!(outcome.file.as_deref(), Some("units/armdfly.lua"));
        let by_field: BTreeMap<&str, &FieldCheck> = outcome
            .fields
            .iter()
            .map(|f| (f.field.as_str(), f))
            .collect();
        assert!(by_field["metalcost"].refusal.is_none());
        assert!(by_field["brandnewfield"].refusal.is_none());
        let health = by_field["health"].refusal.as_ref().expect("computed");
        assert_eq!(health.kind, RefusalKind::FieldComputed);
        assert_eq!(health.field, "health");
        let shown = by_field["health"].excerpt.as_ref().expect("an excerpt");
        let line = health.location.expect("a location").start.line;
        assert!(shown.first_line <= line);
        assert!(shown.lines[line - shown.first_line]
            .to_lowercase()
            .contains("health"));
        assert_eq!(
            by_field["buildoptions"].refusal.as_ref().unwrap().kind,
            RefusalKind::InvalidValue
        );

        assert_eq!(read(&dfly), before);
        assert_eq!(status(&game).backups, 0);
    }

    /// SpringMCLegacy's Direwolf file builds two units out of every variant's
    /// table, so no change to one of them can be written without the other.
    #[test]
    fn a_dry_run_refuses_a_table_two_units_share() {
        let (_root, game) = game();
        std::fs::write(
            game.join("units/Direwolf.lua"),
            "local Direwolf = Assault:New{\n\tname = \"Dire Wolf\",\n\tcustomparams = { tonnage = 100 },\n}\nlocal Prime = Direwolf:New{\n\tdescription = \"Assault Vanguard\",\n}\nreturn lowerkeys({\n\t[\"WF_Direwolf_P\"] = Prime:New(),\n\t[\"SJ_Direwolf_P\"] = Prime:New(),\n})\n",
        )
        .unwrap();

        let outcome = check(
            &game,
            "WF_Direwolf_P",
            &probes(serde_json::json!([
                { "field": "description", "value": "Assault Vanguard" },
                { "field": "customparams.tonnage", "value": 100 },
            ])),
            None,
        )
        .unwrap();

        assert_eq!(outcome.file.as_deref(), Some("units/Direwolf.lua"));
        for field in &outcome.fields {
            let refusal = field.refusal.as_ref().expect("shared with SJ_Direwolf_P");
            assert_eq!(refusal.kind, RefusalKind::PostCheckFailed);
            assert!(
                refusal.message.contains("sj_direwolf_p"),
                "{}",
                refusal.message
            );
        }
    }

    #[test]
    fn a_dry_run_for_a_unit_no_file_defines_refuses_every_field() {
        let (_root, game) = game();
        let outcome = check(
            &game,
            "armcom",
            &probes(serde_json::json!([{ "field": "metalcost", "value": 1 }])),
            None,
        )
        .unwrap();
        assert_eq!(outcome.file, None);
        assert_eq!(
            outcome.fields[0].refusal.as_ref().unwrap().kind,
            RefusalKind::UnitNotFound
        );
    }

    /// A change the user sent to the mutator route is left out of the write,
    /// so it no longer stops the rest, and the outcome says a mutator still
    /// has to carry it.
    #[test]
    fn a_change_sent_to_the_mutator_is_skipped_rather_than_refused() {
        let (_root, game) = game();
        let dfly = game.join("units/armdfly.lua");
        let mut edits = project(serde_json::json!({
            "armdfly": { "metalcost": 400, "health": 2000 },
        }));
        edits
            .mutator_only
            .insert("armdfly".into(), vec!["health".into()]);

        let outcome = write(&game, &edits).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(outcome.written, vec!["units/armdfly.lua"]);
        assert!(read(&dfly).contains("metalcost = 400"));
        assert_eq!(
            outcome.carried,
            vec![Carried {
                unit: "armdfly".into(),
                field: "metalcost".into(),
                undoable: true,
            }]
        );
        assert!(
            outcome
                .not_carried
                .iter()
                .any(|line| line.contains("1 field change you sent to the mutator route")),
            "{:?}",
            outcome.not_carried
        );
    }

    /// The game's own read of the two units the copy tests copy, as unitsync
    /// hands it over: keys lowercased, and fields the file never mentions,
    /// such as the class's `maxvelocity`, present all the same.
    fn sources() -> BTreeMap<String, Value> {
        serde_json::from_value(serde_json::json!({
            "armdfly": {
                "metalcost": 320,
                "health": 1800,
                "maxvelocity": 7.5,
                "customparams": { "subfolder": "ArmAircraft" },
                "buildoptions": ["armsolar", "armwin"],
            },
            "brv": {
                "name": "Heavy BRV",
                // Worked out from the unit's name by the game's
                // post-processing, as SpringMCLegacy's is.
                "objectname": "vehicle/brv.s3o",
                "maxvelocity": 2.1,
                "customparams": { "tonnage": 80, "mods": ["ferrofibrousarmour"] },
            },
        }))
        .unwrap()
    }

    /// A project copying `source` as `key`, its definition the source's read
    /// with `changes` laid over it, plus `extra` merged into the edits.
    fn copying(source: &str, key: &str, changes: Value, extra: Value) -> ModProject {
        let mut def = sources()[source].clone();
        for (field, value) in changes.as_object().unwrap() {
            def[field] = value.clone();
        }
        let mut edits = serde_json::json!({
            "clones": { key: {
                "key": key,
                "source": source,
                "replacesGameUnit": false,
                "def": def,
            } },
        });
        for (store, value) in extra.as_object().unwrap() {
            edits[store] = value.clone();
        }
        serde_json::from_value(serde_json::json!({
            "name": "In place",
            "gameName": "Dev",
            "edits": edits,
        }))
        .unwrap()
    }

    /// Issue #3055. A library weapon equipped into a copy is part of the
    /// copy's definition, so it goes into the copy's own file with it, the
    /// weapon as a whole `weapondefs` table.
    #[test]
    fn a_copys_equipped_death_explosion_goes_into_its_file() {
        let (_root, game) = game();
        let project = copying(
            "armdfly",
            "armdfly2",
            serde_json::json!({}),
            serde_json::json!({
                "weapons": { "blast": { "key": "blast", "def": { "areaofeffect": 300 } } },
                "equipped": { "armdfly2": { "explodeas": "blast" } },
            }),
        );

        let outcome = super::write(&game, &project, &sources()).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert!(outcome.not_carried.is_empty(), "{:?}", outcome.not_carried);
        assert!(
            outcome.equipped.is_empty(),
            "the copy carries it, not a game unit"
        );
        let unit = unit_in(&game, "units/armdfly2.lua", "armdfly2");
        assert_eq!(unit["explodeas"], "armdfly2_blast");
        assert_eq!(
            unit["weapondefs"],
            serde_json::json!({ "blast": { "areaofeffect": 300 } })
        );
    }

    /// Issue #2634, in Beyond All Reason's shape. The copy is the source's
    /// file with the key renamed and its one change made, beside it, and the
    /// factory the project adds it to lists it. Undo takes both back.
    #[test]
    fn a_copy_is_a_new_file_beside_its_source_and_joins_its_builders() {
        let (_root, game) = game();
        let factory = game.join("units/factory.lua");
        let factory_before = read(&factory);
        let project = copying(
            "armdfly",
            "armdfly2",
            serde_json::json!({ "metalcost": 400 }),
            serde_json::json!({ "menus": { "factory": [{ "op": "add", "unit": "armdfly2" }] } }),
        );

        let outcome = super::write(&game, &project, &sources()).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert!(outcome.not_carried.is_empty(), "{:?}", outcome.not_carried);
        assert_eq!(
            outcome.written,
            vec!["units/factory.lua", "units/armdfly2.lua"]
        );
        assert_eq!(
            outcome.copies,
            vec![WrittenCopy {
                unit: "armdfly2".into(),
                file: "units/armdfly2.lua".into(),
                builders: vec!["factory".into()],
            }]
        );
        assert_eq!(
            read(&game.join("units/armdfly2.lua")),
            fixture("bar_armdfly.lua")
                .replacen("\tarmdfly = {", "\tarmdfly2 = {", 1)
                .replacen("metalcost = 320", "metalcost = 400", 1)
        );
        assert_eq!(
            read(&factory),
            "return { factory = { buildoptions = { \"brv\", \"armdfly2\" } } }\n"
        );
        assert_eq!((status(&game).backups, status(&game).created), (1, 1));

        let undone = undo(&game).unwrap();
        assert_eq!(undone.deleted, vec!["units/armdfly2.lua"]);
        assert!(!game.join("units/armdfly2.lua").exists());
        assert_eq!(read(&factory), factory_before);
    }

    /// In SpringMCLegacy's shape the copy keeps the class chain and the
    /// bracketed key, and its new name goes where the source's was, since
    /// this game reads names from the definition. The model path the game
    /// works out from the unit's name is written in, or the copy would look
    /// for a `brv_mk2.s3o` that does not exist.
    #[test]
    fn a_copy_in_a_class_built_file_keeps_its_shape() {
        let (_root, game) = game();
        let project = copying(
            "brv",
            "brv_mk2",
            serde_json::json!({
                "name": "Heavy BRV Mk2",
                "customparams": { "tonnage": 85, "mods": ["ferrofibrousarmour"] },
            }),
            serde_json::json!({}),
        );

        let outcome = super::write(&game, &project, &sources()).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(outcome.written, vec!["units/vehicles/brv_mk2.lua"]);
        assert_eq!(
            read(&game.join("units/vehicles/brv_mk2.lua")),
            fixture("mcl_brv.lua")
                .replacen("[\"BRV\"] = BRV:New()", "[\"brv_mk2\"] = BRV:New()", 1)
                .replacen("\"Heavy BRV\"", "\"Heavy BRV Mk2\"", 1)
                .replacen("tonnage\t\t\t= 80", "tonnage\t\t\t= 85", 1)
                .replacen(
                    "\t\thitchmaxy\t\t= 60,\n\t},\n",
                    "\t\thitchmaxy\t\t= 60,\n\t},\n\tobjectname          = \"vehicle/brv.s3o\",\n",
                    1
                )
        );
    }

    #[test]
    fn a_copy_under_a_name_the_game_uses_is_refused_and_nothing_is_written() {
        let (_root, game) = game();
        // `BRV` is how the file spells it, and Spring lowercases unit names.
        let mut project = copying(
            "armdfly",
            "brv",
            serde_json::json!({}),
            serde_json::json!({}),
        );
        project.edits.overrides.insert(
            "armdfly".into(),
            [("metalcost".to_string(), Value::from(400))].into(),
        );

        let outcome = super::write(&game, &project, &sources()).unwrap();

        assert_eq!(outcome.refused.len(), 1, "{:?}", outcome.refused);
        assert_eq!(outcome.refused[0].kind, RefusalKind::NameTaken);
        assert_eq!(
            outcome.refused[0].file.as_deref(),
            Some("units/vehicles/HeavyBRV.lua")
        );
        assert!(outcome.written.is_empty());
        assert!(outcome.copies.is_empty());
        assert!(read(&game.join("units/armdfly.lua")).contains("metalcost = 320"));
        assert_eq!((status(&game).backups, status(&game).created), (0, 0));
    }

    #[test]
    fn a_copy_whose_file_name_is_taken_is_refused() {
        let (_root, game) = game();
        std::fs::write(game.join("units/ARMDFLY2.lua"), "return {}\n").unwrap();
        let project = copying(
            "armdfly",
            "armdfly2",
            serde_json::json!({}),
            serde_json::json!({}),
        );

        let outcome = super::write(&game, &project, &sources()).unwrap();

        assert_eq!(outcome.refused.len(), 1, "{:?}", outcome.refused);
        assert_eq!(outcome.refused[0].kind, RefusalKind::NameTaken);
        assert!(outcome.refused[0].message.contains("units/ARMDFLY2.lua"));
        assert!(outcome.written.is_empty());
    }

    /// A change to a field the source's file computes has no place in the
    /// copy's file either, so the copy is refused on that field.
    #[test]
    fn a_copy_changing_a_computed_field_is_refused_on_that_field() {
        let (_root, game) = game();
        let project = copying(
            "armdfly",
            "armdfly2",
            serde_json::json!({ "health": 2500 }),
            serde_json::json!({}),
        );

        let outcome = super::write(&game, &project, &sources()).unwrap();

        assert_eq!(outcome.refused.len(), 1, "{:?}", outcome.refused);
        let refused = &outcome.refused[0];
        assert_eq!(
            (refused.unit.as_str(), refused.field.as_str(), refused.kind),
            ("armdfly2", "health", RefusalKind::FieldComputed)
        );
        assert_eq!(refused.file.as_deref(), Some("units/armdfly.lua"));
        assert!(!game.join("units/armdfly2.lua").exists());
    }

    /// A copy made to stand in for a game unit is left to the mutator, and
    /// says so, rather than stopping the rest of the write.
    #[test]
    fn a_copy_that_replaces_a_game_unit_is_not_carried() {
        let (_root, game) = game();
        let mut project = copying(
            "armdfly",
            "brv",
            serde_json::json!({}),
            serde_json::json!({}),
        );
        project
            .edits
            .clones
            .get_mut("brv")
            .unwrap()
            .replaces_game_unit = true;

        let outcome = super::write(&game, &project, &sources()).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert!(outcome.copies.is_empty());
        assert_eq!(outcome.not_carried.len(), 1, "{:?}", outcome.not_carried);
        assert!(outcome.not_carried[0].contains("replaces a unit"));
    }

    /// A project equipping library weapons, with `overrides` beside them.
    fn equipping(weapons: Value, equipped: Value, overrides: Value) -> ModProject {
        serde_json::from_value(serde_json::json!({
            "name": "TEST in place (delete me)",
            "gameName": "Dev",
            "edits": { "weapons": weapons, "equipped": equipped, "overrides": overrides },
        }))
        .expect("parse")
    }

    /// The game's read of armdfly, as the page sends it for a slot.
    fn armdfly_read() -> BTreeMap<String, Value> {
        serde_json::from_value(serde_json::json!({
            "armdfly": { "weapons": [
                { "name": "armdfly_armdfly_paralyzer", "onlytargetcategory": "NOTSUB" }
            ] }
        }))
        .unwrap()
    }

    fn unit_in(game: &Path, file: &str, unit: &str) -> Value {
        let path = game.join(file);
        evaluate(&path, &read(&path), game).expect("runs")[unit].clone()
    }

    /// Issue #3055. A library weapon equipped into a game unit's slot goes
    /// into the unit's own `weapondefs`, created here since armdfly has none,
    /// and the slot names it by `def` and by full name, as the mutator's
    /// block does. Undo puts the file back byte for byte.
    #[test]
    fn an_equipped_library_weapon_is_written_into_the_units_file_and_undo_takes_it_out() {
        let (_root, game) = game();
        let dfly = game.join("units/armdfly.lua");
        let before = read(&dfly);
        let project = equipping(
            serde_json::json!({ "heavylaser": {
                "key": "heavylaser",
                "def": { "range": 300, "damage": { "default": 100 } },
            } }),
            serde_json::json!({ "armdfly": { "0": "heavylaser" } }),
            serde_json::json!({}),
        );

        let outcome = super::write(&game, &project, &armdfly_read()).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert!(outcome.not_carried.is_empty(), "{:?}", outcome.not_carried);
        assert_eq!(
            outcome.written,
            vec![
                "units/armdfly.lua",
                "weapons/coilbox_armdfly_heavylaser.lua"
            ]
        );
        assert_eq!(
            outcome.equipped,
            vec![WrittenEquip {
                unit: "armdfly".into(),
                at: "0".into(),
                weapon: "heavylaser".into(),
                file: "units/armdfly.lua".into(),
            }]
        );
        let unit = unit_in(&game, "units/armdfly.lua", "armdfly");
        assert_eq!(
            unit["weapondefs"],
            serde_json::json!({ "heavylaser": { "range": 300, "damage": { "default": 100 } } })
        );
        assert_eq!(unit["weapons"]["[1]"]["def"], "heavylaser");
        assert_eq!(unit["weapons"]["[1]"]["name"], "armdfly_heavylaser");
        assert_eq!(unit["weapons"]["[1]"]["onlytargetcategory"], "NOTSUB");

        // Issue #3068. The weapon file holds the weapon under its full name.
        let weapon_file = game.join("weapons/coilbox_armdfly_heavylaser.lua");
        assert!(read(&weapon_file).contains("[\"armdfly_heavylaser\"] = {"));

        let diffs = crate::diff::disk_diffs(&game).unwrap();
        assert_eq!(diffs.len(), 2);
        assert!(diffs[0]
            .lines
            .iter()
            .any(|l| l.text.contains("heavylaser = {")));

        undo(&game).unwrap();
        assert_eq!(read(&dfly), before);
        assert!(!weapon_file.exists());
    }

    /// Issue #3055, with #2642. A death explosion is written by the full
    /// name the game gives a definition the unit carries, `<unit>_<key>`,
    /// the same name the mutator's block writes. The file's own spelling of
    /// the field is kept.
    #[test]
    fn a_death_explosion_is_written_by_its_full_name() {
        let (_root, game) = game();
        let file = "units/cloakingtower.lua";
        std::fs::write(game.join(file), fixture("sf_cloakingtower.lua")).unwrap();
        let project = equipping(
            serde_json::json!({ "blast": { "key": "blast", "def": { "areaofeffect": 300 } } }),
            serde_json::json!({ "cloakingtower": { "explodeas": "blast" } }),
            serde_json::json!({}),
        );

        let outcome = write(&game, &project).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert!(outcome.not_carried.is_empty(), "{:?}", outcome.not_carried);
        let text = read(&game.join(file));
        assert!(text.contains("explodeAs                     = \"cloakingtower_blast\""));
        let unit = unit_in(&game, file, "cloakingtower");
        assert_eq!(unit["explodeas"], "cloakingtower_blast");
        assert_eq!(
            unit["selfdestructas"], "smallBuildingExplosionGenericPurple",
            "the self-destruct keeps its own"
        );
        assert_eq!(
            unit["weapondefs"],
            serde_json::json!({ "blast": { "areaofeffect": 300 } })
        );
    }

    /// Issue #3054. A library weapon goes into the file with the values the
    /// game's own files had, so the game post-processes it once.
    #[test]
    fn an_equipped_weapon_is_written_with_the_values_before_post_processing() {
        let (_root, game) = game();
        let project = equipping(
            serde_json::json!({ "heavylaser": {
                "key": "heavylaser",
                "def": { "range": 300, "cratermult": 0.03 },
                "beforePost": { "values": { "cratermult": 0.1 }, "added": [] },
            } }),
            serde_json::json!({ "armdfly": { "0": "heavylaser" } }),
            serde_json::json!({}),
        );
        let outcome = super::write(&game, &project, &armdfly_read()).unwrap();
        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        let unit = unit_in(&game, "units/armdfly.lua", "armdfly");
        assert_eq!(unit["weapondefs"]["heavylaser"]["cratermult"], 0.1);
    }

    /// Writing the same project twice changes nothing the second time, and
    /// a change to the library weapon since replaces the table it wrote.
    #[test]
    fn a_second_write_follows_the_library_weapon() {
        let (_root, game) = game();
        let weapons = |range: u32| serde_json::json!({ "heavylaser": { "key": "heavylaser", "def": { "range": range } } });
        let equipped = serde_json::json!({ "armdfly": { "0": "heavylaser" } });
        let first = equipping(weapons(300), equipped.clone(), serde_json::json!({}));
        super::write(&game, &first, &armdfly_read()).unwrap();

        let again = super::write(&game, &first, &armdfly_read()).unwrap();
        assert!(again.written.is_empty(), "{:?}", again.written);
        assert_eq!(again.unchanged, 1);

        let longer = equipping(weapons(450), equipped, serde_json::json!({}));
        let outcome = super::write(&game, &longer, &armdfly_read()).unwrap();
        assert_eq!(
            outcome.written,
            vec![
                "units/armdfly.lua",
                "weapons/coilbox_armdfly_heavylaser.lua"
            ]
        );
        let unit = unit_in(&game, "units/armdfly.lua", "armdfly");
        assert_eq!(unit["weapondefs"]["heavylaser"]["range"], 450);
        let weapon_file = read(&game.join("weapons/coilbox_armdfly_heavylaser.lua"));
        assert!(weapon_file.contains("range = 450"), "{weapon_file}");
    }

    /// Issue #3068. An `.fbi` unit has no `weapondefs` table, so only its
    /// slot's name and its death explosion are written into its file, and
    /// the weapon file is what puts the weapon in the game's table under that
    /// name. Undo takes both back out.
    #[test]
    fn an_equipped_weapon_on_an_fbi_unit_names_the_weapon_its_file_holds() {
        let (_root, game) = fbi_game();
        let armcom = game.join("units/ARMCOM.FBI");
        let armcom_before = read(&armcom);
        let sources: BTreeMap<String, Value> = serde_json::from_value(serde_json::json!({
            "armcom": { "weapons": [{ "name": "ARM_LIGHTLASER" }] }
        }))
        .unwrap();
        let project = equipping(
            serde_json::json!({ "heavylaser": { "key": "heavylaser", "def": { "range": 300 } } }),
            serde_json::json!({ "armcom": { "0": "heavylaser", "explodeas": "heavylaser" } }),
            serde_json::json!({ "armdfly": { "metalcost": 400 } }),
        );

        let outcome = super::write(&game, &project, &sources).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert!(outcome.not_carried.is_empty(), "{:?}", outcome.not_carried);
        assert_eq!(
            outcome.written,
            vec![
                "units/ARMCOM.FBI",
                "units/armdfly.lua",
                "weapons/coilbox_armcom_heavylaser.lua"
            ]
        );
        assert_eq!(outcome.equipped.len(), 2);
        let text = read(&armcom).to_lowercase();
        assert!(text.contains("weapon1=armcom_heavylaser;"), "{text}");
        assert!(text.contains("explodeas=armcom_heavylaser;"), "{text}");
        assert!(!text.contains("weapondefs"), "{text}");
        let weapon_file = game.join("weapons/coilbox_armcom_heavylaser.lua");
        assert!(read(&weapon_file).contains("[\"armcom_heavylaser\"] = {"));

        undo(&game).unwrap();
        assert_eq!(read(&armcom), armcom_before);
        assert!(!weapon_file.exists());
    }

    /// Issue #3069. SplinterFaction's unit files set the unit's `weaponDefs`
    /// after including its basedef, so a weapon added to the basedef's table
    /// would be thrown away. The slot and the death explosion are still
    /// pointed at the weapon's full name in the basedef, and the weapon file
    /// is what defines it, as for an `.fbi` unit. Undo takes both back out.
    #[test]
    fn an_equipped_weapon_the_units_own_table_cannot_take_names_the_weapon_file() {
        const SCORPION_BASEDEF: &str =
            "Units-Configs-Basedefs/basedefs/Loz Alliance - Faction 2/Tier 1/lozscorpion_basedef.lua";
        let (_root, game) = sf_game();
        let scorpion = game.join(SCORPION_BASEDEF);
        let beacon = game.join(BEACON_BASEDEF);
        let (scorpion_before, beacon_before) = (read(&scorpion), read(&beacon));
        let project = equipping(
            serde_json::json!({ "blast": { "key": "blast", "def": { "areaofeffect": 300 } } }),
            serde_json::json!({
                "beacon": { "explodeas": "blast" },
                "lozscorpion": { "0": "blast" },
            }),
            serde_json::json!({}),
        );
        let sources = serde_json::from_value(serde_json::json!({
            "lozscorpion": { "weapons": [{ "name": "lozscorpion_lightningcannon" }] }
        }))
        .unwrap();

        let outcome = super::write(&game, &project, &sources).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert!(outcome.not_carried.is_empty(), "{:?}", outcome.not_carried);
        assert_eq!(
            outcome.written,
            vec![
                SCORPION_BASEDEF,
                BEACON_BASEDEF,
                "weapons/coilbox_beacon_blast.lua",
                "weapons/coilbox_lozscorpion_blast.lua",
            ]
        );
        let scorpion_unit = unit_in(
            &game,
            "Units/Loz Alliance - Faction 2/Tech 1/lozscorpion.lua",
            "lozscorpion",
        );
        let slot = &scorpion_unit["weapons"]["[1]"];
        assert_eq!(slot["def"], "blast");
        assert_eq!(slot["name"], "lozscorpion_blast");
        assert!(scorpion_unit["weapondefs"].get("blast").is_none());
        assert_eq!(
            unit_in(&game, BEACON, "beacon")["explodeas"],
            "beacon_blast"
        );
        let weapon_file = game.join("weapons/coilbox_lozscorpion_blast.lua");
        assert!(read(&weapon_file).contains("[\"lozscorpion_blast\"] = {"));

        undo(&game).unwrap();
        assert_eq!(read(&scorpion), scorpion_before);
        assert_eq!(read(&beacon), beacon_before);
        assert!(!weapon_file.exists());
        assert!(!game.join("weapons/coilbox_beacon_blast.lua").exists());
    }

    /// Issue #3079. LozScorpion's basedef writes both `explodeAs` and
    /// `selfDestructAs` from the single global its unit file sets, as a
    /// literal, before the include. Equipping a library weapon as the death
    /// explosion changes that line in the unit file itself, which changes
    /// both fields together and leaves the basedef untouched. Undo puts the
    /// unit file back.
    #[test]
    fn an_equipped_death_explosion_reads_through_the_units_own_global() {
        const SCORPION: &str = "Units/Loz Alliance - Faction 2/Tech 1/lozscorpion.lua";
        const SCORPION_BASEDEF: &str =
            "Units-Configs-Basedefs/basedefs/Loz Alliance - Faction 2/Tier 1/lozscorpion_basedef.lua";
        let (_root, game) = sf_game();
        let scorpion = game.join(SCORPION);
        let basedef = game.join(SCORPION_BASEDEF);
        let (scorpion_before, basedef_before) = (read(&scorpion), read(&basedef));
        let project = equipping(
            serde_json::json!({ "blast": { "key": "blast", "def": { "areaofeffect": 300 } } }),
            serde_json::json!({ "lozscorpion": { "explodeas": "blast" } }),
            serde_json::json!({}),
        );
        let sources = serde_json::from_value(serde_json::json!({
            "lozscorpion": { "weapons": [{ "name": "lozscorpion_lightningcannon" }] }
        }))
        .unwrap();

        let outcome = super::write(&game, &project, &sources).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert!(outcome.not_carried.is_empty(), "{:?}", outcome.not_carried);
        assert_eq!(
            outcome.written,
            vec![SCORPION, "weapons/coilbox_lozscorpion_blast.lua"]
        );
        let unit = unit_in(&game, SCORPION, "lozscorpion");
        assert_eq!(unit["explodeas"], "lozscorpion_blast");
        assert_eq!(unit["selfdestructas"], "lozscorpion_blast");
        assert_eq!(read(&basedef), basedef_before, "the basedef is untouched");
        let weapon_file = game.join("weapons/coilbox_lozscorpion_blast.lua");
        assert!(read(&weapon_file).contains("[\"lozscorpion_blast\"] = {"));

        undo(&game).unwrap();
        assert_eq!(read(&scorpion), scorpion_before);
        assert!(!weapon_file.exists());
    }

    /// A loose game whose `weapondefs_post.lua` does what the base content's
    /// does with a unit's own weapons: puts each into the shared table as
    /// `<unit>_<name>`, turns a slot's `def` into that name, and turns a
    /// death explosion naming exactly one of them into it too. Balanced
    /// Annihilation's, Beyond All Reason's and SplinterFaction's do the same.
    fn post_processing_game() -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().expect("temp dir");
        let game = root.path().join("games/model.sdd");
        for (path, text) in [
            (
                "gamedata/weapondefs_post.lua",
                r#"
for udName, ud in pairs(DEFS.unitDefs) do
  if type(ud.weapondefs) == 'table' then
    for wdName, wd in pairs(ud.weapondefs) do WeaponDefs[udName .. '_' .. wdName] = wd end
  end
  if type(ud.weapons) == 'table' then
    for i = 1, 32 do
      local w = ud.weapons[i]
      if type(w) == 'table' then
        if type(w.def) == 'string' then
          local fullName = udName .. '_' .. string.lower(w.def)
          if type(WeaponDefs[fullName]) == 'table' then w.name = fullName end
        end
        w.def = nil
      end
    end
  end
  for _, f in ipairs({ 'explodeas', 'selfdestructas' }) do
    if type(ud[f]) == 'string' and WeaponDefs[udName .. '_' .. ud[f]] then
      ud[f] = udName .. '_' .. ud[f]
    end
  end
end
"#,
            ),
            (
                "units/armcom.lua",
                "return {\n\tarmcom = {\n\t\texplodeas = \"COMMANDER_BLAST\",\n\t\tselfdestructas = \"COMMANDER_BLAST\",\n\t\tweapons = {\n\t\t\t[1] = {\n\t\t\t\tdef = \"ARMCOMLASER\",\n\t\t\t},\n\t\t},\n\t\tweapondefs = {\n\t\t\tarmcomlaser = {\n\t\t\t\trange = 300,\n\t\t\t},\n\t\t},\n\t},\n}\n",
            ),
            (
                "weapons/commander_blast.lua",
                "return { commander_blast = { areaofeffect = 720 } }\n",
            ),
        ] {
            let path = game.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        (root, game)
    }

    /// Load `game` the way the engine's own def loaders do, with `over`
    /// read in place of the files on disk: the unit file, the game's or the
    /// mutator's `unitdefs_post.lua` with `UnitDefs` in scope, the weapon
    /// file, then `weapondefs_post.lua`. The units and the shared weapon
    /// table that come out.
    fn load(game: &Path, over: &[(String, String)]) -> Value {
        let files = over
            .iter()
            .map(|(path, text)| (game.join(path), text.clone()))
            .collect();
        let vm = coilbox_springlua::SpringLua::with_files(game, files).expect("vm");
        vm.eval_expr_value(
            r#"(function()
  Spring.GetModOptions = function() return {} end
  DEFS = {}
  UnitDefs = VFS.Include('units/armcom.lua')
  if VFS.FileExists('gamedata/unitdefs_post.lua') then VFS.Include('gamedata/unitdefs_post.lua') end
  DEFS.unitDefs = UnitDefs
  UnitDefs = nil
  WeaponDefs = VFS.Include('weapons/commander_blast.lua')
  VFS.Include('gamedata/weapondefs_post.lua')
  return { units = DEFS.unitDefs, weapons = WeaponDefs }
end)()"#,
            "load.lua",
        )
        .unwrap_or_else(|e| panic!("{e}"))
    }

    /// Issue #3055. Written in place, a library weapon in a slot and one as
    /// a death explosion load under the same names, holding the same
    /// definitions, as the mutator route loads them.
    #[test]
    fn written_in_place_the_weapons_load_as_the_mutator_loads_them() {
        let (_root, game) = post_processing_game();
        let project = equipping(
            serde_json::json!({
                "heavylaser": { "key": "heavylaser", "def": { "range": 450 } },
                "blast": { "key": "blast", "def": { "areaofeffect": 300 } },
            }),
            serde_json::json!({ "armcom": { "0": "heavylaser", "explodeas": "blast" } }),
            serde_json::json!({}),
        );
        let mutator: Vec<(String, String)> = crate::compile(&project)
            .files
            .into_iter()
            .map(|file| (file.path, file.contents))
            .collect();
        let by_mutator = load(&game, &mutator);

        let sources: BTreeMap<String, Value> = serde_json::from_value(serde_json::json!({
            "armcom": { "weapons": [{ "name": "armcom_armcomlaser" }] }
        }))
        .unwrap();
        let outcome = super::write(&game, &project, &sources).unwrap();
        assert!(outcome.not_carried.is_empty(), "{:?}", outcome.not_carried);
        assert_eq!(outcome.equipped.len(), 2);
        let in_place = load(&game, &[]);

        let armcom = &in_place["units"]["armcom"];
        assert_eq!(armcom["weapons"][0]["name"], "armcom_heavylaser");
        assert_eq!(armcom["explodeas"], "armcom_blast");
        assert_eq!(armcom["selfdestructas"], "COMMANDER_BLAST");
        assert_eq!(in_place["weapons"]["armcom_heavylaser"]["range"], 450);
        assert_eq!(in_place["weapons"]["armcom_blast"]["areaofeffect"], 300);
        for path in [
            "/units/armcom/weapons/0/name",
            "/units/armcom/explodeas",
            "/units/armcom/selfdestructas",
            "/weapons/armcom_heavylaser",
            "/weapons/armcom_blast",
        ] {
            assert_eq!(
                in_place.pointer(path),
                by_mutator.pointer(path),
                "{path} in place against the mutator"
            );
        }
    }

    /// A slot the page sent no read of the unit for cannot be told apart
    /// from a list position, so it is reported rather than guessed.
    #[test]
    fn an_equipped_slot_with_no_read_of_the_unit_is_reported() {
        let (_root, game) = game();
        let project = equipping(
            serde_json::json!({ "heavylaser": { "key": "heavylaser", "def": { "range": 300 } } }),
            serde_json::json!({ "armdfly": { "0": "heavylaser" } }),
            serde_json::json!({}),
        );
        let outcome = write(&game, &project).unwrap();
        assert!(outcome.written.is_empty());
        assert_eq!(outcome.not_carried.len(), 1, "{:?}", outcome.not_carried);
        assert!(outcome.not_carried[0].contains("read of this unit"));
    }

    /// Issue #3035. A copy sent to the mutator route is skipped by the write,
    /// with no refusal, and the rest of the project still goes in. The push
    /// its build menu placement would have made is never generated, since it
    /// is the write loop for the copy itself that makes that push.
    #[test]
    fn a_copy_sent_to_the_mutator_is_skipped_rather_than_refused() {
        let (_root, game) = game();
        let factory = game.join("units/factory.lua");
        let factory_before = read(&factory);
        let mut project = copying(
            "armdfly",
            "armdfly2",
            serde_json::json!({ "health": 2500 }),
            serde_json::json!({ "menus": { "factory": [{ "op": "add", "unit": "armdfly2" }] } }),
        );
        project.clone_mutator_only.push("armdfly2".into());
        project.edits.overrides.insert(
            "brv".into(),
            [("customparams.tonnage".to_string(), Value::from(85))].into(),
        );

        let outcome = super::write(&game, &project, &sources()).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert!(outcome.copies.is_empty());
        assert!(!game.join("units/armdfly2.lua").exists());
        assert_eq!(read(&factory), factory_before);
        assert_eq!(
            outcome.written,
            vec!["units/vehicles/HeavyBRV.lua".to_string()]
        );
        assert!(
            outcome
                .not_carried
                .iter()
                .any(|line| line.contains("1 copy you sent to the mutator route")),
            "{:?}",
            outcome.not_carried
        );
    }

    /// Issue #3035. The dry run for a copy compares its definition against
    /// its source's values alone: a table the copy adds is refused by field,
    /// a change matching what the source already has is not, and nothing is
    /// read off disk.
    #[test]
    fn a_clone_dry_run_says_which_of_its_own_changes_cannot_be_written() {
        let root = tempfile::tempdir().expect("temp dir");
        let game = root.path().join("games/dev.sdd");
        std::fs::create_dir_all(&game).unwrap();
        let mut def = sources()["armdfly"].clone();
        def.as_object_mut().unwrap().remove("maxvelocity");
        let clone: UnitClone = serde_json::from_value(serde_json::json!({
            "key": "armdfly2",
            "source": "armdfly",
            "replacesGameUnit": false,
            "def": def,
        }))
        .unwrap();

        let outcome = check_clone(&game, &clone, None, None, &sources()["armdfly"]).unwrap();

        assert_eq!(outcome.unwritable.len(), 1, "{:?}", outcome.unwritable);
        assert_eq!(outcome.unwritable[0].field, "maxvelocity");
    }

    /// A copy with no source, or one that replaces a game unit, is never
    /// attempted in place at all, so the dry run has nothing to refuse.
    #[test]
    fn a_clone_dry_run_is_silent_for_a_copy_the_write_never_attempts() {
        let root = tempfile::tempdir().expect("temp dir");
        let game = root.path().join("games/dev.sdd");
        std::fs::create_dir_all(&game).unwrap();
        let clone: UnitClone = serde_json::from_value(serde_json::json!({
            "key": "brv",
            "source": "armdfly",
            "replacesGameUnit": true,
            "def": { "featuredefs": { "dead": { "metal": 1 } } },
        }))
        .unwrap();

        let outcome = check_clone(&game, &clone, None, None, &sources()["armdfly"]).unwrap();

        assert!(outcome.unwritable.is_empty());
    }

    #[test]
    fn a_copy_of_a_unit_the_page_did_not_send_is_refused() {
        let (_root, game) = game();
        let project = copying(
            "armdfly",
            "armdfly2",
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let outcome = super::write(&game, &project, &BTreeMap::new()).unwrap();
        assert_eq!(outcome.refused.len(), 1);
        assert_eq!(outcome.refused[0].kind, RefusalKind::UnitNotFound);
    }

    #[test]
    fn an_excerpt_stays_inside_the_file() {
        let text = "a\nb\nc\n";
        let at = |line| coilbox_unitpatch::Point {
            line,
            column: 1,
            byte: 0,
        };
        let shown = excerpt(
            text,
            &Location {
                start: at(1),
                end: at(1),
            },
        );
        assert_eq!(shown.first_line, 1);
        assert_eq!(shown.lines, vec!["a", "b", "c"]);
        let long = (1..=100).map(|n| format!("{n}\n")).collect::<String>();
        let shown = excerpt(
            &long,
            &Location {
                start: at(50),
                end: at(90),
            },
        );
        assert_eq!(shown.first_line, 47);
        assert_eq!(shown.lines.len(), EXCERPT_MAX);
    }

    #[test]
    fn a_game_outside_a_games_folder_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let game = root.path().join("elsewhere/dev.sdd");
        std::fs::create_dir_all(&game).unwrap();
        assert!(write(&game, &project(serde_json::json!({}))).is_err());
        assert!(undo(&game).is_err());
        assert!(accept(&game).is_err());
        assert!(check(&game, "u", &[], None).is_err());
    }

    fn copy_tree(from: &Path, to: &Path) {
        std::fs::create_dir_all(to).unwrap();
        for entry in std::fs::read_dir(from).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                copy_tree(&path, &to.join(entry.file_name()));
            } else {
                std::fs::copy(&path, to.join(entry.file_name())).unwrap();
            }
        }
    }

    const BEACON: &str = "Units/survivalai/beacon.lua";
    const BEACON_BASEDEF: &str = "Units-Configs-Basedefs/basedefs/survivalai/beacon_basedef.lua";

    /// A loose game holding the SplinterFaction files the patcher's own
    /// tests use (issue #3021): each unit file includes a `basedefs` file
    /// that sets the unit's table, and two unit files share one.
    fn sf_game() -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().expect("temp dir");
        let game = root.path().join("games/sf.sdd");
        copy_tree(
            &Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../coilbox-unitpatch/tests/fixtures/sf_game"),
            &game,
        );
        (root, game)
    }

    /// Both changes land in the file the unit file includes, which is backed
    /// up, listed in the diff drawer and put back by undo. The unit file
    /// itself is not touched.
    #[test]
    fn a_change_to_a_unit_whose_table_is_included_is_written_into_that_file() {
        let (_root, game) = sf_game();
        let unit = game.join(BEACON);
        let basedef = game.join(BEACON_BASEDEF);
        let (unit_before, basedef_before) = (read(&unit), read(&basedef));

        let outcome = write(
            &game,
            &project(serde_json::json!({
                "beacon": { "maxdamage": 2500, "workertime": 1600 },
            })),
        )
        .unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(outcome.written, vec![BEACON_BASEDEF]);
        assert_eq!(outcome.changed, 2);
        assert_eq!(read(&unit), unit_before);
        assert_eq!(
            read(&basedef),
            basedef_before
                .replacen(
                    "maxDamage                     = 2000",
                    "maxDamage                     = 2500",
                    1
                )
                .replacen(
                    "workerTime                    = 1500",
                    "workerTime                    = 1600",
                    1
                )
        );
        assert!(
            outcome.carried.iter().all(|c| c.undoable),
            "{:?}",
            outcome.carried
        );
        assert_eq!(status(&game).backups, 1);

        let diffs = crate::diff::disk_diffs(&game).unwrap();
        assert_eq!(
            diffs.iter().map(|d| d.file.as_str()).collect::<Vec<_>>(),
            vec![BEACON_BASEDEF]
        );

        let undone = undo(&game).unwrap();
        assert_eq!(undone.restored, vec![BEACON_BASEDEF]);
        assert_eq!(read(&basedef), basedef_before);
    }

    #[test]
    fn a_change_to_a_file_two_units_include_stops_the_write() {
        let (_root, game) = sf_game();
        let outcome = write(
            &game,
            &project(serde_json::json!({ "lozairplant": { "maxdamage": 5 } })),
        )
        .unwrap();

        assert!(outcome.written.is_empty());
        assert_eq!(outcome.refused.len(), 1, "{:?}", outcome.refused);
        let refused = &outcome.refused[0];
        assert_eq!(refused.kind, RefusalKind::FileShared);
        assert_eq!(
            refused.file.as_deref(),
            Some("Units/Loz Alliance - Faction 2/lozairplant.lua")
        );
        assert_eq!(status(&game).backups, 0);
    }

    /// The "Why?" popover shows the Lua of the file the refusal is about,
    /// which for a value worked out in the included file is that file. A
    /// bare global the unit file sets before the include is now followed
    /// there instead of refused (issue #3079), so this needs a value the
    /// basedef works out some other way: here, a `local` the unit file sets,
    /// which a file it includes can never read.
    #[test]
    fn a_dry_run_shows_the_included_files_lua_for_a_refusal_there() {
        let root = tempfile::tempdir().expect("tempdir");
        let game = root.path().join("games/x.sdd");
        std::fs::create_dir_all(game.join("units")).unwrap();
        std::fs::write(
            game.join("units/beacon.lua"),
            "local humanName = [[Spawn Beacon]]\nVFS.Include(\"basedef.lua\")\nreturn { beacon = unitDef }\n",
        )
        .unwrap();
        std::fs::write(
            game.join("basedef.lua"),
            "unitDef = {\n\tmaxdamage = 2000,\n\tname = humanName,\n}\n",
        )
        .unwrap();

        let outcome = check(
            &game,
            "beacon",
            &probes(serde_json::json!([
                { "field": "maxdamage", "value": 2000 },
                { "field": "name", "value": "Spawn Beacon" },
            ])),
            None,
        )
        .unwrap();

        assert_eq!(outcome.file.as_deref(), Some("units/beacon.lua"));
        assert!(
            outcome.fields[0].refusal.is_none(),
            "{:?}",
            outcome.fields[0]
        );
        let name = &outcome.fields[1];
        let refusal = name.refusal.as_ref().expect("computed");
        assert_eq!(refusal.kind, RefusalKind::FieldComputed);
        assert_eq!(refusal.file.as_deref(), Some("basedef.lua"));
        let shown = name.excerpt.as_ref().expect("an excerpt");
        let line = refusal.location.expect("a location").start.line;
        assert!(shown.lines[line - shown.first_line].contains("humanName"));
        assert_eq!(status(&game).backups, 0);
    }

    /// A copy of such a unit gets its own copy of the included file, so its
    /// change does not reach the source. Undo deletes both new files.
    #[test]
    fn a_copy_of_a_unit_whose_table_is_included_copies_that_file_too() {
        let (_root, game) = sf_game();
        let basedef = game.join(BEACON_BASEDEF);
        let basedef_before = read(&basedef);
        let sources: BTreeMap<String, Value> = serde_json::from_value(serde_json::json!({
            "beacon": { "maxdamage": 2000, "name": "Spawn Beacon" },
        }))
        .unwrap();
        let mut def = sources["beacon"].clone();
        def["maxdamage"] = serde_json::json!(3000);
        let project: ModProject = serde_json::from_value(serde_json::json!({
            "name": "In place",
            "gameName": "SF",
            "edits": { "clones": { "beacon_mk2": {
                "key": "beacon_mk2",
                "source": "beacon",
                "replacesGameUnit": false,
                "def": def,
            } } },
        }))
        .unwrap();

        let outcome = super::write(&game, &project, &sources).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        let copy_basedef = "Units-Configs-Basedefs/basedefs/survivalai/beacon_mk2_basedef.lua";
        assert_eq!(
            outcome.written,
            vec!["Units/survivalai/beacon_mk2.lua", copy_basedef]
        );
        assert_eq!(read(&basedef), basedef_before);
        assert!(read(&game.join(copy_basedef)).contains("maxDamage                     = 3000"));
        assert!(read(&game.join("Units/survivalai/beacon_mk2.lua"))
            .contains("\"units-configs-basedefs/basedefs/survivalai/beacon_mk2_basedef.lua\""));
        assert_eq!(status(&game).created, 2);

        let undone = undo(&game).unwrap();
        assert_eq!(undone.deleted.len(), 2, "{:?}", undone.deleted);
        assert!(!game.join(copy_basedef).exists());
    }

    /// A loose game with units in the `.fbi` format (issue #2638): THIS's
    /// dagger, XTA's commander with its Windows line endings and an
    /// uppercase extension, and a Lua factory.
    fn fbi_game() -> (tempfile::TempDir, PathBuf) {
        let (root, game) = game();
        let units = game.join("units");
        std::fs::write(units.join("dagger.fbi"), fixture("this_dagger.fbi")).unwrap();
        std::fs::write(units.join("ARMCOM.FBI"), fixture("xta_armcom.fbi")).unwrap();
        (root, game)
    }

    #[test]
    fn an_fbi_unit_is_written_one_line_at_a_time_and_undo_puts_it_back() {
        let (_root, game) = fbi_game();
        let dagger = game.join("units/dagger.fbi");
        let armcom = game.join("units/ARMCOM.FBI");
        let (dagger_before, armcom_before) = (read(&dagger), read(&armcom));

        let outcome = write(
            &game,
            &project(serde_json::json!({
                "dagger": { "maxdamage": 700, "customparams.role": "attacker" },
                "armcom": { "buildcostmetal": 2500 },
            })),
        )
        .unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(
            outcome.written,
            vec!["units/ARMCOM.FBI", "units/dagger.fbi"]
        );
        assert_eq!(outcome.changed, 3);
        assert_eq!(
            read(&dagger),
            dagger_before
                .replacen("MaxDamage=650;", "MaxDamage=700;", 1)
                .replacen("\t\tcost=200;\n", "\t\tcost=200;\n\t\trole=attacker;\n", 1)
        );
        assert_eq!(
            read(&armcom),
            armcom_before.replacen("BuildCostMetal=2200;\r\n", "BuildCostMetal=2500;\r\n", 1)
        );
        assert!(outcome.carried.iter().all(|c| c.undoable));

        let diffs = crate::diff::disk_diffs(&game).unwrap();
        let changed: Vec<&str> = diffs
            .iter()
            .flat_map(|d| &d.lines)
            .filter(|l| l.kind != crate::diff::LineChange::Equal)
            .map(|l| l.text.as_str())
            .collect();
        assert_eq!(
            changed,
            vec![
                "\tBuildCostMetal=2200;",
                "\tBuildCostMetal=2500;",
                "\tMaxDamage=650;",
                "\tMaxDamage=700;",
                "\t\trole=attacker;",
            ]
        );

        undo(&game).unwrap();
        assert_eq!(read(&dagger), dagger_before);
        assert_eq!(read(&armcom), armcom_before);
    }

    #[test]
    fn a_dry_run_on_an_fbi_unit_refuses_what_its_file_does_not_hold() {
        let (_root, game) = fbi_game();
        let outcome = check(
            &game,
            "armcom",
            &probes(serde_json::json!([
                { "field": "maxdamage", "value": 3500 },
                { "field": "weapons.3.name", "value": "CSARM_DISINTEGRATOR" },
                { "field": "buildoptions", "value": null },
                { "field": "cloakcost", "value": null },
            ])),
            Some(&armcom_read()),
        )
        .unwrap();

        assert_eq!(outcome.file.as_deref(), Some("units/ARMCOM.FBI"));
        let kinds: Vec<Option<RefusalKind>> = outcome
            .fields
            .iter()
            .map(|f| f.refusal.as_ref().map(|r| r.kind))
            .collect();
        assert_eq!(
            kinds,
            vec![None, None, Some(RefusalKind::FieldComputed), None]
        );
    }

    /// XTA's commander as the unit page reads it: `parse_fbi.lua` keys each
    /// weapon by its number, and with `Weapon1` and `Weapon3` and no
    /// `Weapon2` that is not a list numbered 1 to n, so the unitsync worker
    /// sends an object keyed `"1"` and `"3"`.
    fn armcom_read() -> Value {
        serde_json::json!({
            "buildcostmetal": 2200,
            "weapons": {
                "1": { "name": "CSARMCOMLASER" },
                "3": { "name": "CSARM_DISINTEGRATOR" },
            },
        })
    }

    /// Issue #3041: an edit to either of the commander's weapons lands on the
    /// weapon the page showed it against, and nothing else in the file moves.
    #[test]
    fn an_fbi_commander_with_a_gap_in_its_weapons_takes_an_edit_to_either() {
        let (_root, game) = fbi_game();
        let armcom = game.join("units/ARMCOM.FBI");
        let before = read(&armcom);
        let sources = BTreeMap::from([("armcom".to_string(), armcom_read())]);

        let outcome = super::write(
            &game,
            &project(serde_json::json!({
                "armcom": {
                    "weapons.1.name": "ARM_LIGHTLASER",
                    "weapons.3.name": "ARM_DGUN",
                },
            })),
            &sources,
        )
        .unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(outcome.changed, 2);
        assert_eq!(
            read(&armcom),
            before
                .replacen("weapon1=CSARMCOMLASER;", "weapon1=ARM_LIGHTLASER;", 1)
                .replacen("weapon3=CSARM_DISINTEGRATOR;", "weapon3=ARM_DGUN;", 1)
        );
    }

    /// Without the game's read, `weapons.1` could be `Weapon1` or `Weapon2`,
    /// so the change is refused and nothing is written.
    #[test]
    fn a_list_position_with_no_read_of_the_unit_is_refused() {
        let (_root, game) = fbi_game();
        let armcom = game.join("units/ARMCOM.FBI");
        let before = read(&armcom);

        let outcome = write(
            &game,
            &project(serde_json::json!({ "armcom": { "weapons.1.name": "X" } })),
        )
        .unwrap();

        assert_eq!(outcome.refused.len(), 1, "{:?}", outcome.refused);
        assert_eq!(outcome.refused[0].kind, RefusalKind::InvalidValue);
        assert!(outcome.written.is_empty());
        assert_eq!(read(&armcom), before);
    }

    #[test]
    fn an_fbi_file_the_engine_cannot_read_is_shown_where_it_breaks() {
        let (_root, game) = fbi_game();
        std::fs::write(
            game.join("units/dagger.fbi"),
            "[UNITINFO]\n{\n\tName=Dagger;\n\tMaxDamage=650\n}\n",
        )
        .unwrap();
        let outcome = check(
            &game,
            "dagger",
            &probes(serde_json::json!([{ "field": "maxdamage", "value": 1 }])),
            None,
        )
        .unwrap();
        let field = &outcome.fields[0];
        assert_eq!(field.refusal.as_ref().unwrap().kind, RefusalKind::Syntax);
        let shown = field.excerpt.as_ref().expect("an excerpt");
        assert!(shown.lines.iter().any(|l| l.contains("MaxDamage=650")));
    }

    #[test]
    fn a_copy_of_an_fbi_unit_is_an_fbi_file_beside_it() {
        let (_root, game) = fbi_game();
        let sources: BTreeMap<String, Value> = serde_json::from_value(serde_json::json!({
            "dagger": { "maxdamage": 650, "unitname": "dagger", "name": "Dagger" },
        }))
        .unwrap();
        let mut def = sources["dagger"].clone();
        def["maxdamage"] = serde_json::json!(900);
        def["unitname"] = serde_json::json!("dagger2");
        let project: ModProject = serde_json::from_value(serde_json::json!({
            "name": "In place",
            "gameName": "THIS",
            "edits": { "clones": { "dagger2": {
                "key": "dagger2",
                "source": "dagger",
                "replacesGameUnit": false,
                "def": def,
            } } },
        }))
        .unwrap();

        let outcome = super::write(&game, &project, &sources).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(outcome.written, vec!["units/dagger2.fbi"]);
        assert_eq!(
            read(&game.join("units/dagger2.fbi")),
            fixture("this_dagger.fbi")
                .replacen("MaxDamage=650;", "MaxDamage=900;", 1)
                .replacen("Unitname=dagger;", "Unitname=dagger2;", 1)
        );

        // The name is taken once the copy exists.
        let again = super::write(&game, &project, &sources).unwrap();
        assert_eq!(again.refused[0].kind, RefusalKind::NameTaken);
    }

    /// A project cloning `dagger` as `dagger2` and adding it to `armcom`'s
    /// build menu, `armcom` being XTA's commander in `fbi_game()`.
    fn dagger_copy_project(menus: Value) -> (BTreeMap<String, Value>, ModProject) {
        let sources: BTreeMap<String, Value> = serde_json::from_value(serde_json::json!({
            "dagger": { "maxdamage": 650, "unitname": "dagger", "name": "Dagger" },
        }))
        .unwrap();
        let mut def = sources["dagger"].clone();
        def["unitname"] = serde_json::json!("dagger2");
        let project: ModProject = serde_json::from_value(serde_json::json!({
            "name": "In place",
            "gameName": "THIS",
            "edits": {
                "clones": { "dagger2": {
                    "key": "dagger2",
                    "source": "dagger",
                    "replacesGameUnit": false,
                    "def": def,
                } },
                "menus": menus,
            },
        }))
        .unwrap();
        (sources, project)
    }

    /// Issue #3040: an `.fbi` builder's menu is not in its own file, so a
    /// copy added to it goes into `gamedata/sidedata.tdf`'s `[CANBUILD]`
    /// section instead, as the next `canbuildN` key in the builder's own
    /// subsection. The write backs the shared file up like any other, and
    /// undo puts it back.
    #[test]
    fn a_copy_joins_an_fbi_builders_menu_in_sidedata_tdf() {
        let (_root, game) = fbi_game();
        std::fs::create_dir_all(game.join("gamedata")).unwrap();
        let sidedata = game.join("gamedata/sidedata.tdf");
        let before =
            "[CANBUILD]\n{\n\t[ARMCOM]\n\t{\n\t\tcanbuild1=armsolar;\n\t\tcanbuild2=armmex;\n\t}\n}\n";
        std::fs::write(&sidedata, before).unwrap();
        let (sources, project) = dagger_copy_project(
            serde_json::json!({ "armcom": [{ "op": "add", "unit": "dagger2" }] }),
        );

        let outcome = super::write(&game, &project, &sources).unwrap();

        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        let mut written = outcome.written.clone();
        written.sort();
        assert_eq!(written, vec!["gamedata/sidedata.tdf", "units/dagger2.fbi"]);
        assert_eq!(
            outcome.copies,
            vec![WrittenCopy {
                unit: "dagger2".into(),
                file: "units/dagger2.fbi".into(),
                builders: vec!["armcom".into()],
            }]
        );
        assert_eq!(
            read(&sidedata),
            before.replacen(
                "canbuild2=armmex;\n",
                "canbuild2=armmex;\n\t\tcanbuild3=dagger2;\n",
                1
            )
        );

        let undone = undo(&game).unwrap();
        assert!(undone.deleted.contains(&"units/dagger2.fbi".to_string()));
        assert_eq!(read(&sidedata), before);
    }

    /// A game that works its build menus out in Lua, such as THIS's
    /// `gamedata/buildoptions.lua`, does not read `sidedata.tdf` for them at
    /// all, so the write is refused rather than writing a file the engine
    /// never looks at. Being all-or-nothing, nothing else is written either.
    #[test]
    fn a_game_that_overrides_build_menus_in_lua_refuses_the_fbi_route() {
        let (_root, game) = fbi_game();
        std::fs::create_dir_all(game.join("gamedata")).unwrap();
        std::fs::write(
            game.join("gamedata/sidedata.tdf"),
            "[CANBUILD]\n{\n\t[ARMCOM]\n\t{\n\t\tcanbuild1=armsolar;\n\t}\n}\n",
        )
        .unwrap();
        std::fs::write(
            game.join("gamedata/buildoptions.lua"),
            "for i, v in pairs({}) do UnitDefs[i].buildoptions = v end\n",
        )
        .unwrap();
        let (sources, project) = dagger_copy_project(
            serde_json::json!({ "armcom": [{ "op": "add", "unit": "dagger2" }] }),
        );

        let outcome = super::write(&game, &project, &sources).unwrap();

        assert_eq!(outcome.refused.len(), 1, "{:?}", outcome.refused);
        let refused = &outcome.refused[0];
        assert_eq!(refused.kind, RefusalKind::FieldComputed);
        assert_eq!(refused.file.as_deref(), Some("gamedata/buildoptions.lua"));
        assert!(outcome.written.is_empty());
        assert!(!game.join("units/dagger2.fbi").exists());
    }

    /// A game with no `gamedata/sidedata.tdf` at all has nowhere for the menu
    /// to go, so the copy's placement is refused rather than the copy itself.
    #[test]
    fn an_fbi_builder_with_no_sidedata_file_is_refused() {
        let (_root, game) = fbi_game();
        let (sources, project) = dagger_copy_project(
            serde_json::json!({ "armcom": [{ "op": "add", "unit": "dagger2" }] }),
        );

        let outcome = super::write(&game, &project, &sources).unwrap();

        assert_eq!(outcome.refused.len(), 1, "{:?}", outcome.refused);
        assert_eq!(outcome.refused[0].kind, RefusalKind::ParentMissing);
        assert!(outcome.written.is_empty());
    }

    #[test]
    fn a_unit_in_both_formats_is_changed_where_the_engine_reads_it() {
        let (_root, game) = fbi_game();
        std::fs::write(
            game.join("units/dagger.lua"),
            "return { dagger = { maxdamage = 800 } }\n",
        )
        .unwrap();
        let fbi_before = read(&game.join("units/dagger.fbi"));
        let outcome = write(
            &game,
            &project(serde_json::json!({ "dagger": { "maxdamage": 900 } })),
        )
        .unwrap();
        assert_eq!(outcome.written, vec!["units/dagger.lua"]);
        assert_eq!(read(&game.join("units/dagger.fbi")), fbi_before);
    }

    #[test]
    fn an_fbi_file_that_is_not_utf8_goes_back_in_its_own_bytes() {
        let (_root, game) = fbi_game();
        let path = game.join("units/corcom.fbi");
        let before =
            b"[UNITINFO]\r\n{\r\n\tcopyright=\xa9 1997 Cavedog;\r\n\tMaxDamage=3000;\r\n}\r\n";
        std::fs::write(&path, before).unwrap();

        let outcome = write(
            &game,
            &project(serde_json::json!({ "corcom": { "maxdamage": 3100 } })),
        )
        .unwrap();
        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"[UNITINFO]\r\n{\r\n\tcopyright=\xa9 1997 Cavedog;\r\n\tMaxDamage=3100;\r\n}\r\n"
        );

        let outcome = write(
            &game,
            &project(serde_json::json!({ "corcom": { "name": "Commandant \u{263a}" } })),
        )
        .unwrap();
        assert_eq!(outcome.refused.len(), 1, "{:?}", outcome.refused);
        assert!(outcome.written.is_empty());
    }
}
