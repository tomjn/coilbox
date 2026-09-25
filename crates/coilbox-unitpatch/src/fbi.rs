//! The same edits as the rest of this crate, for a unit written in Total
//! Annihilation's `.fbi` format rather than Lua (issue #2638).
//!
//! The engine's base content reads every `units/*.fbi` through
//! `gamedata/parse_fbi.lua`, which takes the file's `[UNITINFO]` section,
//! names the unit after the file, and moves a few old-style keys into the
//! shape a Lua unit has. A field's path on the unit page is that shape, so
//! each edit is turned back into the key the file holds before
//! `coilbox_tdf::set` writes it:
//!
//! - `metalcost` is `[UNITINFO] metalcost`, and `customparams.cost` is the
//!   `cost` key in the `[customParams]` section inside it.
//! - `weapons[2].name` is `Weapon2`, and the other weapon fields the parser
//!   moves are their numbered keys, such as `OnlyTargetCategory2`.
//! - `sfxtypes.explosiongenerators[1]` is `explosiongenerator0`, since the
//!   parser counts those from 0 and the list from 1.
//!
//! A field the parser works out from somewhere other than the unit's file is
//! refused: its name comes from the file name, its build menu from
//! `gamedata/sidedata.tdf` and its sounds from `gamedata/sound.tdf`.
//!
//! `coilbox_tdf::set` does the post-check. It parses the file before and
//! after and refuses the change unless exactly the one key differs, so the
//! mapping above cannot quietly write the wrong key.

use std::path::Path;

use coilbox_tdf::{Document, Node, SetError};
use serde_json::{Map, Value as Json};

use crate::{
    different, validate, CloneRefusal, Cloned, Edit, Location, Op, Patched, Place, Refusal,
    RefusalKind, Segment, Value,
};

/// Whether `path` is a unit file in the `.fbi` format, by its extension in
/// any case. Games from the Total Annihilation era spell it `.FBI` as often
/// as `.fbi`.
pub fn is_fbi(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("fbi"))
}

/// The unit an `.fbi` file defines: its file name without the extension,
/// lowercased, as `parse_fbi.lua` names it whatever the file's own
/// `unitname` says.
pub fn unit_name(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// [`crate::patch`] for the `.fbi` file `file`, whose text is `source`.
pub fn patch(source: &str, edit: &Edit, file: &Path) -> Result<Patched, Refusal> {
    let value = validate(edit)?;
    let doc = unit_document(source, &edit.unit, file)?;
    let at = |start, end| Location::of(source, start, end);
    let keys = match target(&doc, source, &edit.path, &edit.op, &unit_name(file))? {
        Target::Keys(keys) => keys,
        Target::Name => return rename(source, &doc, &unit_name(file)),
    };
    let keys: Vec<&str> = keys.iter().map(String::as_str).collect();
    let existing = doc
        .lookup(&keys)
        .map_err(|e| refusal(e, source, &edit.path))?;
    if let (Some(pair), Op::Set(_)) = (existing, &edit.op) {
        if holds(&pair.value, value) {
            return Ok(Patched {
                text: source.to_string(),
                changed: false,
                location: at(pair.value_start, pair.value_end),
                file: None,
            });
        }
    }
    let change = coilbox_tdf::set(source, &keys, &text(value))
        .map_err(|e| refusal(e, source, &edit.path))?;
    Ok(Patched {
        text: change.text,
        changed: change.changed,
        location: at(change.start, change.end),
        file: None,
    })
}

/// [`crate::locate_edit`] for an `.fbi` file: where `edit` would go, without
/// writing it.
pub fn locate_edit(source: &str, edit: &Edit, file: &Path) -> Result<Place, Refusal> {
    validate(edit)?;
    let doc = unit_document(source, &edit.unit, file)?;
    let keys = match target(&doc, source, &edit.path, &edit.op, &unit_name(file))? {
        Target::Keys(keys) => keys,
        Target::Name => vec!["UNITINFO".into(), "unitname".into()],
    };
    let keys: Vec<&str> = keys.iter().map(String::as_str).collect();
    let location = match doc
        .lookup(&keys)
        .map_err(|e| refusal(e, source, &edit.path))?
    {
        Some(pair) => Location::of(source, pair.value_start, pair.value_end),
        None => header(&doc, source),
    };
    Ok(Place {
        location,
        file: None,
    })
}

/// [`crate::check_fields`] for an `.fbi` file. A field whose value the file
/// already holds is tried with a different value, so the answer is whether
/// the field could be changed at all.
pub fn check_fields(
    source: &str,
    unit: &str,
    fields: &[(Vec<Segment>, Value)],
    file: &Path,
) -> Vec<Result<Place, Refusal>> {
    fields
        .iter()
        .map(|(path, value)| {
            let edit = |value: &Value| Edit {
                unit: unit.to_string(),
                path: path.clone(),
                op: Op::Set(value.clone()),
            };
            let mut patched = patch(source, &edit(value), file)?;
            if !patched.changed {
                patched = patch(source, &edit(&different(value)), file)?;
            }
            Ok(Place {
                location: patched.location,
                file: None,
            })
        })
        .collect()
}

/// [`crate::locate_unit`] for an `.fbi` file: where its `[UNITINFO]` starts,
/// when the file defines `unit`.
pub fn locate_unit(source: &str, unit: &str, file: &Path) -> Result<Location, Refusal> {
    let doc = unit_document(source, unit, file)?;
    Ok(header(&doc, source))
}

/// [`crate::evaluate`] for an `.fbi` file: the unit keyed by its name, its
/// keys lowercased and every value the string the file holds. This is the
/// file's own table, before the engine moves weapons, sounds and effects
/// into their Lua shape.
pub fn evaluate(source: &str, file: &Path) -> Result<Json, Refusal> {
    let doc = unit_document(source, &unit_name(file), file)?;
    let info = match doc.tree().remove("unitinfo") {
        Some(Node::Table(info)) => json(&info),
        _ => Json::Object(Map::new()),
    };
    let mut units = Map::new();
    units.insert(unit_name(file), info);
    Ok(Json::Object(units))
}

/// [`crate::clone_unit`] for an `.fbi` file: the source's own text, with
/// `edits` made to it, for a file named after `new_unit`. The engine names an
/// `.fbi` unit after its file, so nothing in the text has to be renamed. A
/// `unitname` key the file has is set to the new name anyway, so the copy
/// does not claim to be its source to someone reading it.
pub fn clone_unit(
    source: &str,
    unit: &str,
    new_unit: &str,
    edits: &[(Vec<Segment>, Op)],
    file: &Path,
) -> Result<Cloned, Vec<CloneRefusal>> {
    let whole = |refusal| {
        vec![CloneRefusal {
            edit: None,
            refusal,
        }]
    };
    unit_document(source, unit, file).map_err(whole)?;
    let ext = file
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_else(|| "fbi".into());
    let copy = file.with_file_name(format!("{new_unit}.{ext}"));
    let mut text = source.to_string();
    let mut refused = Vec::new();
    for (at, (path, op)) in edits.iter().enumerate() {
        let edit = Edit {
            unit: new_unit.to_string(),
            path: path.clone(),
            op: op.clone(),
        };
        match patch(&text, &edit, &copy) {
            Ok(patched) => text = patched.text,
            Err(refusal) => refused.push(CloneRefusal {
                edit: Some(at),
                refusal,
            }),
        }
    }
    if !refused.is_empty() {
        return Err(refused);
    }
    let doc = coilbox_tdf::parse(&text).map_err(|e| whole(syntax(&text, &e)))?;
    let text = rename(&text, &doc, &new_unit.to_lowercase())
        .map_err(whole)?
        .text;
    Ok(Cloned {
        text,
        included: None,
    })
}

/// What an edit's path is in the file.
enum Target {
    /// The keys to set, section names first.
    Keys(Vec<String>),
    /// The unit's name, which the file name decides.
    Name,
}

/// `source` parsed, once it is known to define `unit` in one `[UNITINFO]`.
fn unit_document(source: &str, unit: &str, file: &Path) -> Result<Document, Refusal> {
    let name = unit_name(file);
    if !unit.eq_ignore_ascii_case(&name) {
        return Err(Refusal::new(
            RefusalKind::UnitNotFound,
            format!("This file defines {name}, which the engine names after the file, not {unit}."),
        ));
    }
    let doc = coilbox_tdf::parse(source).map_err(|e| syntax(source, &e))?;
    let sections: Vec<&coilbox_tdf::Entry> = doc
        .entries
        .iter()
        .filter(|e| {
            matches!(e, coilbox_tdf::Entry::Section(_)) && e.key().eq_ignore_ascii_case("unitinfo")
        })
        .collect();
    match sections.as_slice() {
        [] => Err(Refusal::new(
            RefusalKind::ReturnNotLiteral,
            "This file has no [UNITINFO] section, so the engine reads no unit from it.",
        )),
        [_] => Ok(doc),
        [.., last] => Err(Refusal::new(
            RefusalKind::UnitAmbiguous,
            "This file has more than one [UNITINFO] section. The engine reads only the last, so it is not clear which one to change.",
        )
        .at(Location::of(source, last.start(), last.start()))),
    }
}

fn header(doc: &Document, source: &str) -> Location {
    let start = doc
        .entries
        .iter()
        .find(|e| e.key().eq_ignore_ascii_case("unitinfo"))
        .map_or(0, coilbox_tdf::Entry::start);
    Location::of(
        source,
        start,
        start + "[UNITINFO]".len().min(source.len() - start),
    )
}

fn syntax(source: &str, e: &coilbox_tdf::ParseError) -> Refusal {
    let end = (e.at + 1).min(source.len());
    let end = (end..=source.len())
        .find(|&i| source.is_char_boundary(i))
        .unwrap_or(source.len());
    Refusal::new(
        RefusalKind::Syntax,
        format!("The engine could not read this file: {e}"),
    )
    .at(Location::of(source, e.at, end))
}

/// Set a `unitname` key the file has to `name`, which the file name already
/// gives the unit.
fn rename(source: &str, doc: &Document, name: &str) -> Result<Patched, Refusal> {
    let unchanged = |location| Patched {
        text: source.to_string(),
        changed: false,
        location,
        file: None,
    };
    let keys = ["UNITINFO", "unitname"];
    let pair = doc.lookup(&keys).map_err(|e| refusal(e, source, &[]))?;
    match pair {
        Some(pair) if !pair.value.trim().eq_ignore_ascii_case(name) => {
            let change =
                coilbox_tdf::set(source, &keys, name).map_err(|e| refusal(e, source, &[]))?;
            Ok(Patched {
                text: change.text,
                changed: true,
                location: Location::of(source, change.start, change.end),
                file: None,
            })
        }
        Some(pair) => Ok(unchanged(Location::of(
            source,
            pair.value_start,
            pair.value_end,
        ))),
        None => Ok(unchanged(header(doc, source))),
    }
}

/// `path` as `weapons[1].name` spells it.
fn dotted(path: &[Segment]) -> String {
    let mut out = String::new();
    for segment in path {
        if matches!(segment, Segment::Key(_)) && !out.is_empty() {
            out.push('.');
        }
        out.push_str(&segment.to_string());
    }
    out
}

const NO_LISTS: &str = "An .fbi file has no lists, only keys and sections";

/// The keys an edit to `path` sets, or why no key in the file holds it.
fn target(
    doc: &Document,
    source: &str,
    path: &[Segment],
    op: &Op,
    unit: &str,
) -> Result<Target, Refusal> {
    let shown = dotted(path);
    let computed = |message: String| Refusal::new(RefusalKind::FieldComputed, message);
    let first = match path.first() {
        Some(Segment::Key(key)) => key.to_lowercase(),
        _ => {
            return Err(Refusal::new(
                RefusalKind::NotATable,
                format!("{NO_LISTS}, so {shown} has nowhere to go."),
            ))
        }
    };
    match first.as_str() {
        "unitname" if path.len() == 1 => {
            return match op {
                Op::Set(Value::String(name)) if name.eq_ignore_ascii_case(unit) => {
                    Ok(Target::Name)
                }
                _ => Err(computed(format!(
                    "The engine names an .fbi unit after its file, {unit}, whatever the file says, so its unitname cannot be changed in the file."
                ))),
            }
        }
        "buildoptions" => {
            return Err(computed(
                "An .fbi unit's build menu is not in its file. The engine reads it from gamedata/sidedata.tdf, which coilbox only writes to add a copy to a builder's menu, not for a direct edit here.".into(),
            ))
        }
        "sounds" => {
            return Err(computed(
                "An .fbi unit's sounds are not in its file. The engine looks them up in gamedata/sound.tdf by the unit's soundcategory, so change that instead.".into(),
            ))
        }
        "weapons" => return weapon(doc, source, path, op),
        "sfxtypes"
            if matches!(path.get(1), Some(Segment::Key(k)) if k.eq_ignore_ascii_case("explosiongenerators")) =>
        {
            return explosion(doc, source, path, op)
        }
        _ => {}
    }
    if let Op::Push(_) = op {
        return Err(Refusal::new(
            RefusalKind::NotAList,
            format!("{NO_LISTS}, so nothing can be added to {shown}."),
        ));
    }
    let mut keys = vec!["UNITINFO".to_string()];
    for segment in path {
        match segment {
            Segment::Key(key) => keys.push(key.clone()),
            Segment::Index(_) => {
                return Err(Refusal::new(
                    RefusalKind::NotATable,
                    format!("{NO_LISTS}, so {shown} has nowhere to go."),
                ))
            }
        }
    }
    Ok(Target::Keys(keys))
}

/// The weapon keys `parse_fbi.lua` moves into `weapons`, by the field each
/// becomes.
const WEAPON_KEYS: [(&str, &str); 6] = [
    ("name", "weapon"),
    ("onlytargetcategory", "onlytargetcategory"),
    ("slaveto", "weaponslaveto"),
    ("maindir", "weaponmaindir"),
    ("fuelusage", "weaponfuelusage"),
    ("maxangledif", "maxangledif"),
];

/// The most weapons `parse_fbi.lua` reads from a file.
const MAX_WEAPONS: usize = 32;

fn weapon(doc: &Document, source: &str, path: &[Segment], op: &Op) -> Result<Target, Refusal> {
    let shown = dotted(path);
    let (n, field) = match (path, op) {
        ([_, Segment::Index(n), Segment::Key(field)], Op::Set(_)) => (*n, field.to_lowercase()),
        _ => {
            return Err(Refusal::new(
                RefusalKind::NotATable,
                format!("An .fbi file writes each weapon as numbered keys, such as Weapon1, so coilbox can only change one field of a weapon it already has, not {shown}."),
            ))
        }
    };
    // The weapons the engine reads: `weapon1` to `weapon3` whether or not
    // each is there, then on until the first one missing. Each is keyed by
    // its own number, gap or not, so `weapons[3]` is `Weapon3` in a file
    // with no `Weapon2` (issue #3041).
    let tree = doc.tree();
    let has = |key: &str| matches!(tree.get("unitinfo"), Some(Node::Table(info)) if info.contains_key(key));
    let present: Vec<usize> = (1..=MAX_WEAPONS)
        .take_while(|&w| w <= 3 || has(&format!("weapon{w}")))
        .filter(|&w| has(&format!("weapon{w}")))
        .collect();
    let key = if field == "badtargetcategory" {
        let alias = [
            "wpri_badtargetcategory",
            "wsec_badtargetcategory",
            "wspe_badtargetcategory",
        ]
        .get(n.wrapping_sub(1))
        .filter(|alias| has(alias));
        match alias {
            Some(alias) => alias.to_string(),
            None => format!("badtargetcategory{n}"),
        }
    } else {
        match WEAPON_KEYS.iter().find(|(f, _)| *f == field) {
            Some((_, key)) => format!("{key}{n}"),
            None => {
                return Err(Refusal::new(
                    RefusalKind::FieldComputed,
                    format!("An .fbi file only writes a weapon's name, target categories, slave, main direction, fuel use and angle. The engine works out {shown} from elsewhere."),
                ))
            }
        }
    };
    // A new weapon has to be one the engine goes on to read: any of the
    // first three, or the one straight after the last.
    let exists = present.contains(&n);
    let new_weapon =
        field == "name" && (1..=MAX_WEAPONS).contains(&n) && (n <= 3 || present.contains(&(n - 1)));
    if !exists && !new_weapon {
        let refusal = Refusal::new(
            RefusalKind::ParentMissing,
            format!("This file has no Weapon{n}, so {shown} has no weapon to go with."),
        );
        return Err(refusal.at(header(doc, source)));
    }
    Ok(Target::Keys(vec!["UNITINFO".into(), key]))
}

fn explosion(doc: &Document, source: &str, path: &[Segment], op: &Op) -> Result<Target, Refusal> {
    let shown = dotted(path);
    let tree = doc.tree();
    let sfx = match tree.get("unitinfo") {
        Some(Node::Table(info)) => match info.get("sfxtypes") {
            Some(Node::Table(sfx)) => Some(sfx),
            _ => None,
        },
        _ => None,
    };
    let Some(sfx) = sfx else {
        return Err(Refusal::new(
            RefusalKind::ParentMissing,
            format!("This file has no [SFXTypes] section for {shown} to go in."),
        )
        .at(header(doc, source)));
    };
    let count = (0..)
        .take_while(|i| sfx.contains_key(&format!("explosiongenerator{i}")))
        .count();
    let at = match (&path[2..], op) {
        ([Segment::Index(n)], Op::Set(_)) if *n <= count + 1 => n - 1,
        ([], Op::Push(_)) => count,
        _ => {
            return Err(Refusal::new(
                RefusalKind::ParentMissing,
                format!(
                    "The file lists {count} explosion generators, so {shown} has no place in it."
                ),
            ))
        }
    };
    Ok(Target::Keys(vec![
        "UNITINFO".into(),
        "SFXTypes".into(),
        format!("explosiongenerator{at}"),
    ]))
}

/// Add `unit` to `builder`'s build menu (issue #3040): the next `canbuildN`
/// key in `builder`'s own section under `[CANBUILD]` in `source`, which is
/// `gamedata/sidedata.tdf`'s text. `parse_fbi.lua` reads that section by the
/// builder's name, matched without regard to case as every name in a `.tdf`
/// file is, and sorts whatever `canbuildN` keys it finds by their number
/// rather than requiring them to run without a gap, so a new key only has to
/// be one no existing key in the section already uses.
///
/// `unit` already in the section, under any `canbuildN`, is left alone: the
/// menu already has it, so nothing is added.
///
/// The caller is responsible for knowing this file is what the engine reads
/// for `builder`'s menu at all. A game that works its build menus out in Lua,
/// such as THIS's `gamedata/buildoptions.lua`, ignores this file, and a copy
/// added here would not appear anywhere the engine looks.
pub fn add_to_build_menu(source: &str, builder: &str, unit: &str) -> Result<Patched, Refusal> {
    let doc = coilbox_tdf::parse(source).map_err(|e| syntax(source, &e))?;
    let tree = doc.tree();
    let section = match tree.get("canbuild") {
        Some(Node::Table(canbuild)) => match canbuild.get(&builder.to_lowercase()) {
            Some(Node::Table(section)) => Some(section),
            _ => None,
        },
        _ => None,
    };
    let count = (1..)
        .take_while(|n| section.is_some_and(|s| s.contains_key(&format!("canbuild{n}"))))
        .count();
    for n in 1..=count {
        let key = format!("canbuild{n}");
        if let Ok(Some(pair)) = doc.lookup(&["CANBUILD", builder, &key]) {
            if pair.value.trim().eq_ignore_ascii_case(unit) {
                return Ok(Patched {
                    text: source.to_string(),
                    changed: false,
                    location: Location::of(source, pair.value_start, pair.value_end),
                    file: None,
                });
            }
        }
    }
    let key = format!("canbuild{}", count + 1);
    let change = coilbox_tdf::set(source, &["CANBUILD", builder, &key], unit)
        .map_err(|e| menu_refusal(e, builder))?;
    Ok(Patched {
        text: change.text,
        changed: change.changed,
        location: Location::of(source, change.start, change.end),
        file: None,
    })
}

/// A `coilbox_tdf` refusal from [`add_to_build_menu`], said in terms of
/// `builder`'s build menu rather than a unit's field.
fn menu_refusal(e: SetError, builder: &str) -> Refusal {
    match e {
        SetError::Syntax(e) => Refusal::new(
            RefusalKind::Syntax,
            format!("The engine could not read this file: {e}"),
        ),
        SetError::SectionMissing { section } if section.eq_ignore_ascii_case(builder) => {
            Refusal::new(
                RefusalKind::ParentMissing,
                format!(
                    "This file's [CANBUILD] section has no [{builder}] section, so {builder} has no build menu here to add to."
                ),
            )
        }
        SetError::SectionMissing { section } => Refusal::new(
            RefusalKind::ParentMissing,
            format!("This file has no [{section}] section."),
        ),
        SetError::SectionAmbiguous { section, .. } => Refusal::new(
            RefusalKind::FieldAmbiguous,
            format!(
                "This file has more than one [{section}] section, so it is not clear which one holds {builder}'s build menu."
            ),
        ),
        SetError::NotASection { key, .. } => Refusal::new(
            RefusalKind::NotATable,
            format!("{key} is a single value in this file, not a section."),
        ),
        SetError::KeyAmbiguous { key, .. } => Refusal::new(
            RefusalKind::FieldAmbiguous,
            format!(
                "{key} is written more than once in {builder}'s section, so it is not clear which one to change."
            ),
        ),
        SetError::NotAValue { section, .. } => Refusal::new(
            RefusalKind::NotATable,
            format!("{section} is a section in this file, so it cannot hold a single value."),
        ),
        SetError::InvalidValue(message) => Refusal::new(RefusalKind::InvalidValue, message),
        SetError::PostCheck(message) => Refusal::new(RefusalKind::PostCheckFailed, message),
    }
}

/// A `coilbox_tdf` refusal as this crate says it.
fn refusal(e: SetError, source: &str, path: &[Segment]) -> Refusal {
    let shown = dotted(path);
    let at = |start, end| Location::of(source, start, end);
    match e {
        SetError::Syntax(e) => syntax(source, &e),
        SetError::SectionMissing { section } => Refusal::new(
            RefusalKind::ParentMissing,
            format!("This file has no [{section}] section for {shown} to go in."),
        ),
        SetError::SectionAmbiguous { section, at: starts } => Refusal::new(
            RefusalKind::FieldAmbiguous,
            format!("This file has more than one [{section}] section, so it is not clear which one {shown} is in."),
        )
        .at(at(starts[0], *starts.last().expect("more than one"))),
        SetError::NotASection { key, start, end } => Refusal::new(
            RefusalKind::NotATable,
            format!("{key} is a single value in this file, so {shown} cannot go inside it."),
        )
        .at(at(start, end)),
        SetError::KeyAmbiguous { key, at: spans } => Refusal::new(
            RefusalKind::FieldAmbiguous,
            format!("{key} is written more than once in its section. The engine reads the last one, so it is not clear which one to change."),
        )
        .at(at(spans[0].0, spans.last().expect("more than one").1)),
        SetError::NotAValue { section, at: start } => Refusal::new(
            RefusalKind::NotATable,
            format!("{section} is a section in this file, so it cannot hold a single value."),
        )
        .at(at(start, start)),
        SetError::InvalidValue(message) => Refusal::new(RefusalKind::InvalidValue, message),
        SetError::PostCheck(message) => Refusal::new(RefusalKind::PostCheckFailed, message),
    }
}

/// A value as an `.fbi` file writes it. Every value in the file is text. A
/// whole number is written without a decimal point and true or false as 1 or
/// 0, the way Total Annihilation's files write them.
fn text(value: &Value) -> String {
    match value {
        Value::Bool(b) => if *b { "1" } else { "0" }.to_string(),
        Value::Number(n) if n.fract() == 0.0 && n.abs() < 1e15 => format!("{}", *n as i64),
        Value::Number(n) => format!("{n}"),
        Value::String(s) => s.clone(),
    }
}

/// Whether the text `existing` already says `value`, as the engine would
/// read it.
fn holds(existing: &str, value: &Value) -> bool {
    let trimmed = existing.trim();
    match value {
        Value::Number(n) => trimmed.parse::<f64>().ok() == Some(*n),
        Value::Bool(b) => match trimmed.to_ascii_lowercase().as_str() {
            "1" | "true" => *b,
            "0" | "false" => !*b,
            _ => false,
        },
        Value::String(s) => existing == s,
    }
}

fn json(table: &std::collections::BTreeMap<String, Node>) -> Json {
    Json::Object(
        table
            .iter()
            .map(|(key, node)| {
                let value = match node {
                    Node::Value(v) => Json::String(v.clone()),
                    Node::Table(t) => json(t),
                };
                (key.clone(), value)
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_are_written_as_the_files_write_them() {
        assert_eq!(text(&Value::Number(650.0)), "650");
        assert_eq!(text(&Value::Number(0.08)), "0.08");
        assert_eq!(text(&Value::Bool(true)), "1");
        assert!(holds(" .08", &Value::Number(0.08)));
        assert!(holds("1", &Value::Bool(true)));
        assert!(!holds("Dagger ", &Value::String("Dagger".into())));
    }

    #[test]
    fn paths_read_as_the_unit_page_writes_them() {
        let path = crate::parse_path("weapons[2].name").unwrap();
        assert_eq!(dotted(&path), "weapons[2].name");
    }

    /// XTA's own style for `[CANBUILD]`, tabs and a trailing comment included.
    const SIDEDATA: &str = "[CANBUILD]\n{\n\t[arm_adv_aircraft_plant]\n\t{\n\t\tcanbuild1=arm_adv_construction_aircraft;\n\t\tcanbuild2=arm_peeper;//xtaids\n\t}\n}\n";

    #[test]
    fn adding_to_a_build_menu_appends_the_next_canbuild_key() {
        let patched = add_to_build_menu(SIDEDATA, "arm_adv_aircraft_plant", "armdfly2").unwrap();

        assert!(patched.changed);
        assert_eq!(
            patched.text,
            SIDEDATA.replacen(
                "canbuild2=arm_peeper;//xtaids\n",
                "canbuild2=arm_peeper;//xtaids\n\t\tcanbuild3=armdfly2;\n",
                1
            )
        );
    }

    /// Basically OTA spells its sections in a different case than a copy's
    /// builder key would, since the unit page lowercases everything.
    #[test]
    fn a_builder_section_is_matched_without_regard_to_case() {
        let patched = add_to_build_menu(SIDEDATA, "ARM_ADV_AIRCRAFT_PLANT", "armdfly2").unwrap();

        assert!(patched.text.contains("canbuild3=armdfly2;"));
    }

    #[test]
    fn a_unit_already_in_the_menu_is_not_added_twice() {
        let patched = add_to_build_menu(SIDEDATA, "arm_adv_aircraft_plant", "ARM_Peeper").unwrap();

        assert!(!patched.changed);
        assert_eq!(patched.text, SIDEDATA);
    }

    #[test]
    fn a_builder_with_no_section_is_refused() {
        let refusal = add_to_build_menu(SIDEDATA, "arm_vehicle_plant", "armdfly2").unwrap_err();

        assert_eq!(refusal.kind, RefusalKind::ParentMissing);
        assert!(refusal.message.contains("arm_vehicle_plant"));
    }

    #[test]
    fn a_file_with_no_canbuild_section_is_refused() {
        let refusal =
            add_to_build_menu("[SIDE0]\n{\n\tName=Arm;\n}\n", "armlab", "armdfly2").unwrap_err();

        assert_eq!(refusal.kind, RefusalKind::ParentMissing);
    }
}
