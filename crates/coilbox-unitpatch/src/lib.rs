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
//! Nothing here writes to disk. The caller gets the patched text or a
//! [`Refusal`] that says why, with the place in the file it is about.

mod check;
mod locate;
mod render;

use std::fmt;
use std::path::Path;

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

/// A value the patcher can write. Only plain literals: anything else would
/// need the patcher to write code, which is the author's job.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum Value {
    Bool(bool),
    Number(f64),
    String(String),
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
    pub text: String,
    /// False when the field already held the value. `text` is then the
    /// original, untouched.
    pub changed: bool,
    /// Where in the original file the edit went: the value that was replaced,
    /// or the point a new field or list entry was inserted.
    pub location: Location,
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
}

/// A refusal to patch, with a reason a person can read and, where there is
/// one, the place in the file the reason is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refusal {
    pub kind: RefusalKind,
    pub message: String,
    pub location: Option<Location>,
}

impl Refusal {
    pub(crate) fn new(kind: RefusalKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            location: None,
        }
    }

    pub(crate) fn at(mut self, location: Location) -> Self {
        self.location = Some(location);
        self
    }
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.location {
            Some(location) => write!(
                f,
                "{} (line {}, column {})",
                self.message, location.start.line, location.start.column
            ),
            None => f.write_str(&self.message),
        }
    }
}

impl std::error::Error for Refusal {}

/// Apply `edit` to the unit file `source` and return the patched text.
///
/// `game_root` is the game's folder. The post-check evaluates the file with
/// its `VFS` rooted there, so a unit file that includes a sibling file still
/// evaluates.
pub fn patch(source: &str, edit: &Edit, game_root: &Path) -> Result<Patched, Refusal> {
    let value = validate(edit)?;
    let plan = locate::plan(source, edit)?;
    let before = evaluate_original(source, game_root)?;

    let mut expected = expected_path(edit);
    if let Op::Push(_) = edit.op {
        let length = check::list_length(&before, &expected);
        expected.push(format!("[{}]", length + 1));
    } else if check::holds(&before, &expected, value) {
        return Ok(Patched {
            text: source.to_string(),
            changed: false,
            location: plan.location,
        });
    }

    let text = plan.apply(source);
    post_check(&text, &before, &expected, value, plan.location, game_root)?;

    Ok(Patched {
        text,
        changed: true,
        location: plan.location,
    })
}

/// Where `edit` would go in `source`, worked out from the file's text alone.
/// Nothing is evaluated, so this is cheap, and it only refuses what the
/// file's shape decides. A refusal only the post-check can give, such as a
/// table two units share, is not found here.
pub fn locate_edit(source: &str, edit: &Edit) -> Result<Location, Refusal> {
    validate(edit)?;
    locate::plan(source, edit).map(|plan| plan.location)
}

/// Whether each of `fields` of `unit` could be changed in `source`, without
/// writing anything (issue #2633). Each answer is the place in the file the
/// change would go, or the refusal [`patch`] would give.
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
/// rather than two.
pub fn check_fields(
    source: &str,
    unit: &str,
    fields: &[(Vec<Segment>, Value)],
    game_root: &Path,
) -> Vec<Result<Location, Refusal>> {
    let mut before: Option<Result<serde_json::Value, Refusal>> = None;
    fields
        .iter()
        .map(|(path, value)| {
            let edit = Edit {
                unit: unit.to_string(),
                path: path.clone(),
                op: Op::Set(value.clone()),
            };
            validate(&edit)?;
            locate::plan(source, &edit)?;
            let before = before
                .get_or_insert_with(|| evaluate_original(source, game_root))
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
            let plan = locate::plan(source, &edit)?;
            let text = plan.apply(source);
            post_check(&text, before, &expected, &value, plan.location, game_root)?;
            Ok(plan.location)
        })
        .collect()
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
    evaluate_original(source, game_root)
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
/// Every edit is tried, so the refusals list all of those the copy cannot
/// take rather than only the first.
pub fn clone_unit(
    source: &str,
    unit: &str,
    new_unit: &str,
    edits: &[(Vec<Segment>, Op)],
    game_root: &Path,
) -> Result<String, Vec<CloneRefusal>> {
    let whole = |refusal| {
        vec![CloneRefusal {
            edit: None,
            refusal,
        }]
    };
    let plan = locate::rename(source, unit, new_unit).map_err(whole)?;
    let before = evaluate_original(source, game_root).map_err(whole)?;
    let Some(mut expected) = before.get(unit.to_lowercase()).cloned() else {
        return Err(whole(Refusal::new(
            RefusalKind::EvalFailed,
            format!("The file does not return `{unit}` when it runs, so there is nothing to copy."),
        )));
    };
    let key = new_unit.to_lowercase();
    let mut text = plan.apply(source);
    confirm_copy(&text, &key, &expected, plan.location, game_root).map_err(whole)?;

    let mut refused = Vec::new();
    for (at, (path, op)) in edits.iter().enumerate() {
        let edit = Edit {
            unit: new_unit.to_string(),
            path: path.clone(),
            op: op.clone(),
        };
        match patch(&text, &edit, game_root) {
            Ok(patched) => {
                text = patched.text;
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
    confirm_copy(&text, &key, &expected, plan.location, game_root).map_err(whole)?;
    Ok(text)
}

/// Run a copy's file and confirm it returns only `key`, holding `expected`.
fn confirm_copy(
    text: &str,
    key: &str,
    expected: &serde_json::Value,
    location: Location,
    game_root: &Path,
) -> Result<(), Refusal> {
    let refuse = |message: String| Refusal::new(RefusalKind::PostCheckFailed, message).at(location);
    let after = check::evaluate(text, game_root, "copy")
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
    }
}

/// The value an edit writes, once it is known to be one the patcher can
/// write at a path it can follow.
fn validate(edit: &Edit) -> Result<&Value, Refusal> {
    let value = match &edit.op {
        Op::Set(value) | Op::Push(value) => value,
    };
    if let Value::Number(number) = value {
        if !number.is_finite() {
            return Err(Refusal::new(
                RefusalKind::InvalidValue,
                format!("{number} cannot be written as a Lua number."),
            ));
        }
    }
    if edit.path.is_empty() {
        return Err(Refusal::new(
            RefusalKind::InvalidValue,
            "The edit names no field.",
        ));
    }
    Ok(value)
}

fn evaluate_original(source: &str, game_root: &Path) -> Result<serde_json::Value, Refusal> {
    check::evaluate(source, game_root, "original").map_err(|e| {
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

/// Run the patched `text` and confirm it differs from `before` only at
/// `expected`, where it now holds `value`.
fn post_check(
    text: &str,
    before: &serde_json::Value,
    expected: &[String],
    value: &Value,
    location: Location,
    game_root: &Path,
) -> Result<(), Refusal> {
    let after = check::evaluate(text, game_root, "patched").map_err(|e| {
        Refusal::new(
            RefusalKind::PostCheckFailed,
            format!("The patched file does not run: {e}"),
        )
        .at(location)
    })?;
    check::confirm(before, &after, expected, value)
        .map_err(|message| Refusal::new(RefusalKind::PostCheckFailed, message).at(location))
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
