//! Change one field in a unit's Lua file without rewriting the file.
//!
//! A game's unit files are source code its author reads, diffs and commits.
//! Regenerating a file from a table would lose its comments, key order and
//! layout, so this crate edits the text instead. It parses the file with a
//! parser that keeps every byte, finds the table the unit is written in, and
//! splices the new value over the old one. Nothing outside the edited value
//! moves.
//!
//! Two file shapes are understood, plus the ways games mix them:
//!
//! - `return { armdfly = { metalcost = 320, ... } }`, as Beyond All Reason
//!   and most Recoil games write it.
//! - `local BRV = Tank:New{ ... }` followed by
//!   `return lowerkeys({ ["BRV"] = BRV:New() })`, where the unit is built from
//!   a parent class. SpringMCLegacy and flove write units this way.
//!
//! After splicing, the original and the patched text are both evaluated
//! through [`coilbox_springlua`], and the patch is only returned if the two
//! resulting tables differ in the edited field and nowhere else.
//!
//! A unit file may hold no table at all and include a second file that sets
//! the unit's table as a global, as SplinterFaction's include their
//! `basedefs` files (issue #3021). The patcher follows one such
//! `VFS.Include` and edits the second file, and says so in [`Patched::file`].
//! A second file that more than one unit file includes is refused, since an
//! edit to it would change every unit that includes it.
//!
//! A unit written in Total Annihilation's older `.fbi` format goes through
//! [`fbi`] instead, which makes the same edits with the same refusals
//! (issue #2638).
//!
//! Nothing here writes to disk. The caller gets the patched text or a
//! [`Refusal`] that says why, with the place in the file it is about.

mod check;
pub mod fbi;
mod locate;
mod render;

use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// One step of a path into a unit's table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum Segment {
    /// A named field, such as `metalcost` or `customparams`. Matched without
    /// regard to case, because the engine lowercases unit keys before it
    /// reads them.
    Key(String),
    /// A position in a list, counted from 1 as Lua counts. `weapons[1]` is
    /// the first entry of `weapons`.
    Index(usize),
}

impl Segment {
    /// The segment as the post-check spells it: keys lowercased, positions in
    /// brackets so `[1]` can never be mistaken for a key named `1`.
    fn canonical(&self) -> String {
        match self {
            Segment::Key(key) => key.to_lowercase(),
            Segment::Index(index) => format!("[{index}]"),
        }
    }
}

impl fmt::Display for Segment {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Segment::Key(key) => f.write_str(key),
            Segment::Index(index) => write!(f, "[{index}]"),
        }
    }
}

/// Parse a dotted path such as `customparams.tonnage` or `weapons[1].def`.
/// Returns `None` for an empty path or an empty or malformed step.
pub fn parse_path(path: &str) -> Option<Vec<Segment>> {
    let mut segments = Vec::new();
    for part in path.split('.') {
        let (name, mut rest) = match part.find('[') {
            Some(at) => (&part[..at], &part[at..]),
            None => (part, ""),
        };
        if name.is_empty() && segments.is_empty() {
            return None;
        }
        if !name.is_empty() {
            segments.push(Segment::Key(name.to_string()));
        } else if rest.is_empty() {
            return None;
        }
        while !rest.is_empty() {
            let close = rest.find(']')?;
            let index: usize = rest[1..close].parse().ok()?;
            if index == 0 || !rest.starts_with('[') {
                return None;
            }
            segments.push(Segment::Index(index));
            rest = &rest[close + 1..];
        }
    }
    (!segments.is_empty()).then_some(segments)
}

/// A value the patcher can write. Only literals and tables of literals:
/// anything else would need the patcher to write code, which is the author's
/// job.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum Value {
    Bool(bool),
    Number(f64),
    String(String),
    /// A whole table, such as a weapon definition added to a unit's
    /// `weapondefs` (issue #3055). Entries are written in this order, so
    /// build one with [`Value::from_json`] for a stable order.
    Table(Vec<(TableKey, Value)>),
}

/// A key in a [`Value::Table`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum TableKey {
    Name(String),
    /// A list position, counted from 1.
    Index(usize),
}

impl Value {
    /// `json` as a value the patcher can write.
    ///
    /// An array is a list numbered from 1. An object's key of digits is a
    /// number key, since the unitsync worker sends a Lua table numbered with
    /// a gap as an object keyed by its numbers. A `null` entry is left out,
    /// which is what Lua makes of a key set to `nil`. Entries are sorted,
    /// positions first and then names without regard to case, so the same
    /// table is always written the same way. Two names that differ only in
    /// case are refused, because the engine lowercases keys and would read
    /// only one of them.
    pub fn from_json(json: &serde_json::Value) -> Result<Value, String> {
        use serde_json::Value as Json;
        match json {
            Json::Bool(b) => Ok(Value::Bool(*b)),
            Json::Number(n) => n
                .as_f64()
                .map(Value::Number)
                .ok_or_else(|| format!("{n} cannot be written as a Lua number.")),
            Json::String(s) => Ok(Value::String(s.clone())),
            Json::Null => Err("A missing value cannot be written as a field.".into()),
            Json::Array(items) => {
                let mut entries = Vec::new();
                for (at, item) in items.iter().enumerate() {
                    if !item.is_null() {
                        entries.push((TableKey::Index(at + 1), Value::from_json(item)?));
                    }
                }
                Ok(Value::Table(entries))
            }
            Json::Object(map) => {
                let mut entries = Vec::new();
                for (key, item) in map {
                    if item.is_null() {
                        continue;
                    }
                    let key = match key.parse::<usize>() {
                        Ok(n) if n > 0 && key.bytes().all(|b| b.is_ascii_digit()) => {
                            TableKey::Index(n)
                        }
                        _ => TableKey::Name(key.clone()),
                    };
                    entries.push((key, Value::from_json(item)?));
                }
                entries.sort_by(|(a, _), (b, _)| match (a, b) {
                    (TableKey::Index(x), TableKey::Index(y)) => x.cmp(y),
                    (TableKey::Index(_), TableKey::Name(_)) => std::cmp::Ordering::Less,
                    (TableKey::Name(_), TableKey::Index(_)) => std::cmp::Ordering::Greater,
                    (TableKey::Name(x), TableKey::Name(y)) => x
                        .to_lowercase()
                        .cmp(&y.to_lowercase())
                        .then_with(|| x.cmp(y)),
                });
                for pair in entries.windows(2) {
                    if let [(TableKey::Name(a), _), (TableKey::Name(b), _)] = pair {
                        if a.eq_ignore_ascii_case(b) {
                            return Err(format!(
                                "The table holds both {a} and {b}, which the engine reads as one key."
                            ));
                        }
                    }
                }
                Ok(Value::Table(entries))
            }
        }
    }
}

/// What to do at the end of the path.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum Op {
    /// Replace the field's value, or add the field to the end of its table if
    /// the file does not have it yet.
    Set(Value),
    /// Add an entry to the end of the list at the path, as a unit's
    /// `buildoptions` grows by one.
    Push(Value),
}

/// One change to one unit.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    /// The unit's name as the file's returned table keys it, such as `armdfly`
    /// or `BRV`. Matched without regard to case.
    pub unit: String,
    pub path: Vec<Segment>,
    pub op: Op,
}

/// A place in the original file. Lines and columns count from 1, and columns
/// count characters, not bytes. `end` is exclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub start: Point,
    pub end: Point,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub line: usize,
    pub column: usize,
    /// Offset into the file's text, for a caller that wants to highlight it.
    pub byte: usize,
}

impl Location {
    /// The location of the byte range `start..end` in `source`.
    pub(crate) fn of(source: &str, start: usize, end: usize) -> Self {
        Self {
            start: Point::of(source, start),
            end: Point::of(source, end),
        }
    }
}

impl Point {
    fn of(source: &str, byte: usize) -> Self {
        let before = &source[..byte];
        let line = before.matches('\n').count() + 1;
        let line_start = before.rfind('\n').map_or(0, |at| at + 1);
        let column = source[line_start..byte].chars().count() + 1;
        Self { line, column, byte }
    }
}

/// The patched file.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Patched {
    /// The whole text of the file the edit went into.
    pub text: String,
    /// False when the field already held the value. `text` is then the
    /// original, untouched.
    pub changed: bool,
    /// Where in the original file the edit went: the value that was replaced,
    /// or the point a new field or list entry was inserted.
    pub location: Location,
    /// The file the edit went into, when it is not the unit file: the file
    /// the unit file includes for its table, as a full path under the game's
    /// folder. `None` means the unit file itself.
    pub file: Option<PathBuf>,
}

/// Where an edit would go: a place in the unit file, or in the file it
/// includes for its table when `file` is set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub location: Location,
    pub file: Option<PathBuf>,
}

/// Why the patcher would not make the edit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RefusalKind {
    /// The file is not valid Lua 5.1.
    Syntax,
    /// The file does not return a table written out in the file, so there is
    /// no text to edit.
    ReturnNotLiteral,
    /// No unit of that name is in the returned table.
    UnitNotFound,
    /// The unit is defined more than once in the file.
    UnitAmbiguous,
    /// The unit's table is built by code the patcher does not follow, such as
    /// a call to a helper function.
    UnitComputed,
    /// The field's value is worked out by code rather than written as a
    /// literal, or the file sets it again after the table is built.
    FieldComputed,
    /// The same field is written twice in one table, spelled differently.
    FieldAmbiguous,
    /// A step of the path goes through a value that is not a table.
    NotATable,
    /// A table the path goes through is not in the file, so a new field
    /// would have nowhere to go.
    ParentMissing,
    /// A push was asked for, but the table at the path is not a plain list.
    NotAList,
    /// The value cannot be written as Lua, such as a number that is not
    /// finite.
    InvalidValue,
    /// The original file could not be evaluated, so the edit cannot be
    /// checked.
    EvalFailed,
    /// Evaluating the patched file did not show exactly the requested change.
    PostCheckFailed,
    /// A new unit's name, or its file's, is one the game already uses.
    NameTaken,
    /// The unit's table is in a file that other unit files include too, so
    /// an edit to it would change their units as well.
    FileShared,
}

/// A refusal to patch, with a reason a person can read and, where there is
/// one, the place in the file the reason is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refusal {
    pub kind: RefusalKind,
    pub message: String,
    pub location: Option<Location>,
    /// The file the refusal is about, when it is not the unit file: the file
    /// the unit file includes for its table, as a full path under the game's
    /// folder. `location` is in this file when it is set.
    pub file: Option<PathBuf>,
}

impl Refusal {
    pub(crate) fn new(kind: RefusalKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            location: None,
            file: None,
        }
    }

    pub(crate) fn at(mut self, location: Location) -> Self {
        self.location = Some(location);
        self
    }

    /// The refusal as one about `file` rather than the unit file.
    pub(crate) fn in_file(mut self, file: &Path) -> Self {
        self.file = Some(file.to_path_buf());
        self
    }
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)?;
        match (self.location, &self.file) {
            (Some(location), Some(file)) => write!(
                f,
                " ({}, line {}, column {})",
                file.display(),
                location.start.line,
                location.start.column
            ),
            (Some(location), None) => write!(
                f,
                " (line {}, column {})",
                location.start.line, location.start.column
            ),
            (None, Some(file)) => write!(f, " ({})", file.display()),
            (None, None) => Ok(()),
        }
    }
}

impl std::error::Error for Refusal {}

/// A game's folder, and text for files in it that the caller has patched but
/// not written yet.
pub(crate) struct Game<'a> {
    root: &'a Path,
    pending: &'a BTreeMap<PathBuf, String>,
}

impl Game<'_> {
    /// The full path of `written`, a path as a unit file passes it to
    /// `VFS.Include`, spelled as the game's folder spells it. `None` for a
    /// path that climbs out of the folder.
    pub(crate) fn resolve(&self, written: &str) -> Option<PathBuf> {
        let mut rel = PathBuf::new();
        for part in written.split(['/', '\\']) {
            match part {
                "" | "." => {}
                ".." => return None,
                part => rel.push(part),
            }
        }
        Some(coilbox_springlua::resolve_case(self.root, &rel))
    }

    /// The text of the file at `path`: the pending text if there is some,
    /// otherwise what is on disk.
    pub(crate) fn read(&self, path: &Path) -> Option<String> {
        match self.pending.get(path) {
            Some(text) => Some(text.clone()),
            None => std::fs::read_to_string(path).ok(),
        }
    }

    /// The pending text with `extra` in it too, as the post-check's `VFS`
    /// reads it.
    fn files(&self, extra: Option<(&Path, &str)>) -> BTreeMap<PathBuf, String> {
        let mut files = self.pending.clone();
        if let Some((path, text)) = extra {
            files.insert(path.to_path_buf(), text.to_string());
        }
        files
    }
}

/// Apply `edit` to the unit file `source` and return the patched text.
///
/// `game_root` is the game's folder. The post-check evaluates the file with
/// its `VFS` rooted there, so a unit file that includes a sibling file still
/// evaluates. When the unit's table is in a file `source` includes, that file
/// is patched instead and [`Patched::file`] names it.
pub fn patch(source: &str, edit: &Edit, game_root: &Path) -> Result<Patched, Refusal> {
    patch_pending(source, edit, game_root, &BTreeMap::new())
}

/// [`patch`], with `pending` read in place of the files on disk. Each key is
/// a full path under `game_root`, as [`Patched::file`] gives it. A caller
/// making several edits to a file the unit file includes passes each result
/// back in here, so the next edit starts from it rather than from the disk.
pub fn patch_pending(
    source: &str,
    edit: &Edit,
    game_root: &Path,
    pending: &BTreeMap<PathBuf, String>,
) -> Result<Patched, Refusal> {
    let game = Game {
        root: game_root,
        pending,
    };
    let value = validate(edit)?;
    let plan = locate::plan(source, edit, &game)?;
    let file = plan.file.as_ref().map(|included| included.path.clone());
    if let Some(included) = &plan.file {
        shared(&game, included)?;
    }
    let before = evaluate_original(source, &game)?;

    let mut expected = expected_path(edit);
    if let Op::Push(_) = edit.op {
        let length = check::list_length(&before, &expected);
        expected.push(format!("[{}]", length + 1));
    } else if check::holds(&before, &expected, value) {
        return Ok(Patched {
            text: plan
                .file
                .as_ref()
                .map_or(source, |included| included.text.as_str())
                .to_string(),
            changed: false,
            location: plan.location,
            file,
        });
    }

    let text = plan.apply(source);
    post_check(source, &plan, &text, &before, &expected, value, &game)?;

    Ok(Patched {
        text,
        changed: true,
        location: plan.location,
        file,
    })
}

/// Where `edit` would go in `source`, worked out without evaluating
/// anything, so this is cheap. It only refuses what the text of the unit file
/// and any file it includes for its table decides. A refusal only the
/// post-check can give, such as a table two units share, is not found here.
pub fn locate_edit(source: &str, edit: &Edit, game_root: &Path) -> Result<Place, Refusal> {
    validate(edit)?;
    let game = Game {
        root: game_root,
        pending: &BTreeMap::new(),
    };
    locate::plan(source, edit, &game).map(|plan| Place {
        location: plan.location,
        file: plan.file.map(|included| included.path),
    })
}

/// Whether each of `fields` of `unit` could be changed in `source`, without
/// writing anything (issue #2633). Each answer is the place the change would
/// go, or the refusal [`patch`] would give.
///
/// A dry run of [`patch`] with [`Op::Set`], one field at a time against the
/// file as it is. When the file already returns the value given for a field,
/// the field is tried with a different value of the same type instead,
/// because `patch` accepts a value that is already there without running the
/// post-check. A table two units share passes that and fails the post-check,
/// so it would read as writable when no change to it ever is.
///
/// The original file is evaluated once for the whole batch rather than once
/// per field, so a unit's whole field list costs one evaluation per field
/// rather than two. Whether another unit file includes the same file is
/// looked up once too.
pub fn check_fields(
    source: &str,
    unit: &str,
    fields: &[(Vec<Segment>, Value)],
    game_root: &Path,
) -> Vec<Result<Place, Refusal>> {
    let game = Game {
        root: game_root,
        pending: &BTreeMap::new(),
    };
    let mut before: Option<Result<serde_json::Value, Refusal>> = None;
    let mut sharing: Option<Result<(), Refusal>> = None;
    fields
        .iter()
        .map(|(path, value)| {
            let edit = Edit {
                unit: unit.to_string(),
                path: path.clone(),
                op: Op::Set(value.clone()),
            };
            validate(&edit)?;
            let plan = locate::plan(source, &edit, &game)?;
            if let Some(included) = &plan.file {
                sharing
                    .get_or_insert_with(|| shared(&game, included))
                    .clone()?;
            }
            let before = before
                .get_or_insert_with(|| evaluate_original(source, &game))
                .as_ref()
                .map_err(Clone::clone)?;
            let expected = expected_path(&edit);
            let value = if check::holds(before, &expected, value) {
                different(value)
            } else {
                value.clone()
            };
            let edit = Edit {
                op: Op::Set(value.clone()),
                ..edit
            };
            let plan = locate::plan(source, &edit, &game)?;
            let text = plan.apply(source);
            post_check(source, &plan, &text, before, &expected, &value, &game)?;
            Ok(Place {
                location: plan.location,
                file: plan.file.map(|included| included.path),
            })
        })
        .collect()
}

/// Refuse an edit to `included` when more than one unit file includes it.
///
/// This looks at every `.lua` file under the game's `units` folder, the
/// folder the engine loads unit definitions from and the one the unit file
/// being patched is in. A file counts when it includes the same file at its
/// top level by a path written out in it, spelled any way that resolves to the
/// same file. Nothing is evaluated: an edit to a value written out in a
/// shared file changes every unit that includes it, unless that unit sets the
/// value again after the include, and the post-check cannot see the others to
/// tell. A file elsewhere in the game that includes it, such as a gadget,
/// does not define a unit and is not looked at.
fn shared(game: &Game, included: &locate::Included) -> Result<(), Refusal> {
    let name = included
        .path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let wanted = included.path.to_string_lossy().to_lowercase();
    let rel = |path: &Path| {
        path.strip_prefix(game.root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    };
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(game.root) {
        for entry in entries.flatten() {
            if entry.file_name().eq_ignore_ascii_case("units") && entry.path().is_dir() {
                lua_files(&entry.path(), &mut files);
            }
        }
    }
    files.sort();
    let including: Vec<String> = files
        .iter()
        .filter(|file| {
            let Some(text) = game.read(file) else {
                return false;
            };
            text.to_lowercase().contains(&name)
                && locate::includes(&text).iter().any(|written| {
                    game.resolve(written)
                        .is_some_and(|path| path.to_string_lossy().to_lowercase() == wanted)
                })
        })
        .map(|file| rel(file))
        .collect();
    if including.len() <= 1 {
        return Ok(());
    }
    let shown: Vec<&str> = including.iter().take(5).map(String::as_str).collect();
    let more = match including.len() - shown.len() {
        0 => String::new(),
        n => format!(" and {n} more"),
    };
    Err(Refusal::new(
        RefusalKind::FileShared,
        format!(
            "This unit's table is in {}, which {} unit files include: {}{more}. A change to it would change all of those units, so coilbox will not make it.",
            rel(&included.path),
            including.len(),
            shown.join(", "),
        ),
    )
    .at(included.statement))
}

fn lua_files(at: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(at) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            lua_files(&path, out);
        } else if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("lua"))
        {
            out.push(path);
        }
    }
}

/// Where the returned table keys `unit` in `source`, worked out from the
/// file's text alone. The cheap way to find which file defines a unit before
/// [`clone_unit`] runs it.
pub fn locate_unit(source: &str, unit: &str) -> Result<Location, Refusal> {
    locate::rename(source, unit, unit).map(|plan| plan.location)
}

/// What `source` returns when it runs, keys lowercased and list positions
/// written `[1]`, `[2]`, as the post-check reads it. Parent classes from
/// other files stand in as empty tables, so this is the file's own table and
/// not the unit as the engine sees it.
pub fn evaluate(source: &str, game_root: &Path) -> Result<serde_json::Value, Refusal> {
    evaluate_original(
        source,
        &Game {
            root: game_root,
            pending: &BTreeMap::new(),
        },
    )
}

/// One reason [`clone_unit`] would not make a copy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneRefusal {
    /// The edit it is about, as a position in the list given, or `None` when
    /// it is about the copy as a whole.
    pub edit: Option<usize>,
    pub refusal: Refusal,
}

/// A copy [`clone_unit`] made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cloned {
    /// The copy's unit file.
    pub text: String,
    /// When the source's table is in a file its unit file includes, a copy
    /// of that file for the copy's unit file to include in its place, as a
    /// full path under the game's folder and its text. Neither exists on
    /// disk yet.
    pub included: Option<(PathBuf, String)>,
}

/// A new unit file for `new_unit`, made from the file `source` that defines
/// `unit`, with `edits` made to the copy (issue #2634).
///
/// The copy is the source file's own text with the unit's key renamed and the
/// file's other units taken out, so it is in the shape the game's author
/// wrote it. Each edit then goes through [`patch`] against the copy, with the
/// post-check that brings. Last, the whole copy is run and has to return
/// exactly one unit, `new_unit`, whose table is the source unit's with the
/// edits made and nothing else different.
///
/// When the source's table is in a file its unit file includes (issue
/// #3021), that file is copied too, beside it, and the copy's unit file
/// includes the copy. Sharing the source's file would leave the copy with no
/// field an edit could change without changing the source as well. The new
/// file's name is the source's with the unit's name swapped for the copy's,
/// or the copy's name put in front when the source's name is not in it.
///
/// Every edit is tried, so the refusals list all of those the copy cannot
/// take rather than only the first.
pub fn clone_unit(
    source: &str,
    unit: &str,
    new_unit: &str,
    edits: &[(Vec<Segment>, Op)],
    game_root: &Path,
) -> Result<Cloned, Vec<CloneRefusal>> {
    let whole = |refusal| {
        vec![CloneRefusal {
            edit: None,
            refusal,
        }]
    };
    let empty = BTreeMap::new();
    let on_disk = Game {
        root: game_root,
        pending: &empty,
    };
    let mut plan = locate::rename(source, unit, new_unit).map_err(whole)?;
    let before = evaluate_original(source, &on_disk).map_err(whole)?;
    let Some(mut expected) = before.get(unit.to_lowercase()).cloned() else {
        return Err(whole(Refusal::new(
            RefusalKind::EvalFailed,
            format!("The file does not return `{unit}` when it runs, so there is nothing to copy."),
        )));
    };

    // A unit whose table the patcher cannot follow into an included file
    // gets no copy of one. Every edit to the copy is then refused for the
    // same reason an edit to the source would be.
    let mut pending = BTreeMap::new();
    let included = match locate::included_table(source, unit, &on_disk) {
        Ok(Some(included)) => {
            let written = copy_name(&included.written, unit, new_unit);
            let path = on_disk.resolve(&written).ok_or_else(|| {
                whole(Refusal::new(
                    RefusalKind::NameTaken,
                    format!("{written} is outside the game's folder."),
                ))
            })?;
            if path.exists() {
                return Err(whole(
                    Refusal::new(
                        RefusalKind::NameTaken,
                        format!(
                            "{} already exists, so the copy of {} has nowhere to go.",
                            written, included.written
                        ),
                    )
                    .in_file(&path),
                ));
            }
            plan.retarget(&included, &written);
            pending.insert(path.clone(), included.text.clone());
            Some(path)
        }
        _ => None,
    };

    let key = new_unit.to_lowercase();
    let mut text = plan.apply(source);
    let game = Game {
        root: game_root,
        pending: &pending,
    };
    confirm_copy(&text, &key, &expected, plan.location, &game).map_err(whole)?;

    let mut refused = Vec::new();
    for (at, (path, op)) in edits.iter().enumerate() {
        let edit = Edit {
            unit: new_unit.to_string(),
            path: path.clone(),
            op: op.clone(),
        };
        match patch_pending(&text, &edit, game_root, &pending) {
            Ok(patched) => {
                match patched.file {
                    Some(file) => {
                        pending.insert(file, patched.text);
                    }
                    None => text = patched.text,
                }
                let steps: Vec<String> = path.iter().map(Segment::canonical).collect();
                match op {
                    Op::Set(value) => check::set(&mut expected, &steps, value),
                    Op::Push(value) => check::push(&mut expected, &steps, value),
                }
            }
            Err(refusal) => refused.push(CloneRefusal {
                edit: Some(at),
                refusal,
            }),
        }
    }
    if !refused.is_empty() {
        return Err(refused);
    }
    let game = Game {
        root: game_root,
        pending: &pending,
    };
    confirm_copy(&text, &key, &expected, plan.location, &game).map_err(whole)?;
    let included = included.map(|path| {
        let text = pending.remove(&path).expect("put in above");
        (path, text)
    });
    Ok(Cloned { text, included })
}

/// `written`, an included file's path, with its file name made the copy's:
/// `unit` swapped for `new_unit`, or `new_unit` put in front when the name
/// does not hold `unit`.
fn copy_name(written: &str, unit: &str, new_unit: &str) -> String {
    let at = written.rfind(['/', '\\']).map_or(0, |at| at + 1);
    let (folder, name) = written.split_at(at);
    let lower = name.to_ascii_lowercase();
    let renamed = match lower.find(&unit.to_ascii_lowercase()) {
        Some(start) => format!(
            "{}{new_unit}{}",
            &name[..start],
            &name[start + unit.len()..]
        ),
        None => format!("{new_unit}_{name}"),
    };
    format!("{folder}{renamed}")
}

/// Run a copy's file and confirm it returns only `key`, holding `expected`.
fn confirm_copy(
    text: &str,
    key: &str,
    expected: &serde_json::Value,
    location: Location,
    game: &Game,
) -> Result<(), Refusal> {
    let refuse = |message: String| Refusal::new(RefusalKind::PostCheckFailed, message).at(location);
    let after = check::evaluate(text, game.root, "copy", game.files(None))
        .map_err(|e| refuse(format!("The copy's file does not run: {e}")))?;
    let keys: Vec<&String> = after
        .as_object()
        .map(|units| units.keys().collect())
        .unwrap_or_default();
    if keys != [key] {
        let names: Vec<&str> = keys.iter().map(|k| k.as_str()).collect();
        return Err(refuse(format!(
            "The copy's file returns {} rather than only `{key}`.",
            if names.is_empty() {
                "no units".to_string()
            } else {
                names.join(", ")
            }
        )));
    }
    let differ = check::differing(expected, &after[key]);
    if !differ.is_empty() {
        let shown: Vec<&str> = differ.iter().take(5).map(String::as_str).collect();
        return Err(refuse(format!(
            "The copy's table would differ from the one asked for at {}, so it was not made.",
            shown.join(", ")
        )));
    }
    Ok(())
}

/// A value of the same type as `value` that is not equal to it.
fn different(value: &Value) -> Value {
    match value {
        Value::Bool(b) => Value::Bool(!b),
        // A number so large that adding one does not move it is halved
        // instead, which cannot overflow.
        Value::Number(n) if *n + 1.0 != *n => Value::Number(n + 1.0),
        Value::Number(n) => Value::Number(n / 2.0),
        Value::String(s) => Value::String(format!("{s}_")),
        Value::Table(entries) => {
            let mut entries = entries.clone();
            entries.push((TableKey::Name("coilbox_probe".into()), Value::Bool(true)));
            Value::Table(entries)
        }
    }
}

/// The first number in `value` that Lua cannot hold, if there is one.
fn not_finite(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) if !number.is_finite() => Some(*number),
        Value::Table(entries) => entries.iter().find_map(|(_, item)| not_finite(item)),
        _ => None,
    }
}

/// The value an edit writes, once it is known to be one the patcher can
/// write at a path it can follow.
fn validate(edit: &Edit) -> Result<&Value, Refusal> {
    let value = match &edit.op {
        Op::Set(value) | Op::Push(value) => value,
    };
    if let Some(number) = not_finite(value) {
        return Err(Refusal::new(
            RefusalKind::InvalidValue,
            format!("{number} cannot be written as a Lua number."),
        ));
    }
    if let (Op::Push(_), Value::Table(_)) = (&edit.op, value) {
        return Err(Refusal::new(
            RefusalKind::InvalidValue,
            "Only a single value can be added to the end of a list, not a table.",
        ));
    }
    if edit.path.is_empty() {
        return Err(Refusal::new(
            RefusalKind::InvalidValue,
            "The edit names no field.",
        ));
    }
    Ok(value)
}

fn evaluate_original(source: &str, game: &Game) -> Result<serde_json::Value, Refusal> {
    check::evaluate(source, game.root, "original", game.files(None)).map_err(|e| {
        Refusal::new(
            RefusalKind::EvalFailed,
            format!("Coilbox could not run this file to check the edit: {e}"),
        )
    })
}

/// The edited field's path as the post-check spells it, unit first.
fn expected_path(edit: &Edit) -> Vec<String> {
    let mut expected = vec![edit.unit.to_lowercase()];
    expected.extend(edit.path.iter().map(Segment::canonical));
    expected
}

/// Run the unit file with `patched`, the text `plan` made, and confirm it
/// differs from `before` only at `expected`, where it now holds `value`.
/// When the plan went into an included file, the unit file `source` runs as
/// it is and its `VFS` reads `patched` for that file.
fn post_check(
    source: &str,
    plan: &locate::Plan,
    patched: &str,
    before: &serde_json::Value,
    expected: &[String],
    value: &Value,
    game: &Game,
) -> Result<(), Refusal> {
    let location = plan.location;
    let refuse = |message: String| {
        let refusal = Refusal::new(RefusalKind::PostCheckFailed, message).at(location);
        match &plan.file {
            Some(included) => refusal.in_file(&included.path),
            None => refusal,
        }
    };
    let (unit_file, files) = match &plan.file {
        Some(included) => (source, game.files(Some((&included.path, patched)))),
        None => (patched, game.files(None)),
    };
    let after = check::evaluate(unit_file, game.root, "patched", files)
        .map_err(|e| refuse(format!("The patched file does not run: {e}")))?;
    // A field the basedef writes from the same global as the edited one,
    // such as `selfDestructAs` reading `explodeAs`'s global too (issue
    // #3079), moves as well. It is allowed to, but only to `value` itself.
    let linked: Vec<Vec<String>> = plan
        .linked
        .iter()
        .map(|field| {
            let mut path = expected[..expected.len() - 1].to_vec();
            path.push(field.clone());
            path
        })
        .collect();
    check::confirm(before, &after, expected, value, &linked).map_err(refuse)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dotted_and_indexed_paths() {
        assert_eq!(
            parse_path("customparams.tonnage"),
            Some(vec![
                Segment::Key("customparams".into()),
                Segment::Key("tonnage".into())
            ])
        );
        assert_eq!(
            parse_path("weapons[2].def"),
            Some(vec![
                Segment::Key("weapons".into()),
                Segment::Index(2),
                Segment::Key("def".into())
            ])
        );
        assert_eq!(parse_path(""), None);
        assert_eq!(parse_path("a..b"), None);
        assert_eq!(parse_path("a[0]"), None);
        assert_eq!(parse_path("a[x]"), None);
    }

    #[test]
    fn locations_count_lines_and_characters() {
        let source = "ab\nçd = 1";
        let point = Point::of(source, source.find('d').unwrap());
        assert_eq!((point.line, point.column), (2, 2));
    }
}
