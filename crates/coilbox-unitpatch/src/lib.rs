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

    let plan = locate::plan(source, edit)?;
    let before = check::evaluate(source, game_root, "original").map_err(|e| {
        Refusal::new(
            RefusalKind::EvalFailed,
            format!("Coilbox could not run this file to check the edit: {e}"),
        )
    })?;

    let mut expected = vec![edit.unit.to_lowercase()];
    expected.extend(edit.path.iter().map(Segment::canonical));
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
    let after = check::evaluate(&text, game_root, "patched").map_err(|e| {
        Refusal::new(
            RefusalKind::PostCheckFailed,
            format!("The patched file does not run: {e}"),
        )
        .at(plan.location)
    })?;
    check::confirm(&before, &after, &expected, value)
        .map_err(|message| Refusal::new(RefusalKind::PostCheckFailed, message).at(plan.location))?;

    Ok(Patched {
        text,
        changed: true,
        location: plan.location,
    })
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
