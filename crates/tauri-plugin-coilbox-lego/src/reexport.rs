//! Exporting a built unit into a game that already has its files (issue #3245).
//!
//! The unit definition and the unit script are the game maker's to edit, so a
//! re-export used to leave both alone once they existed. That kept hand edits,
//! and it also meant a change to the build never reached the game: a longer
//! hull kept the old footprint, and a build arm added later never made the
//! unit a builder.
//!
//! The definition is now brought up to date one field at a time. The frontend
//! names the fields the build decides (`DERIVED_FIELDS` in `unitDef.ts`) with
//! the value this build gives each and the value the last export wrote. A
//! field the file still holds at the last export's value is rewritten, or
//! removed when the build no longer writes it. A field holding anything else
//! was changed by somebody, in a text editor or through the workshop's edit in
//! place route, and stays. Every other field, and the comments and order of the
//! file, are left as they are, because the change goes through
//! `coilbox-unitpatch` rather than a rewrite.
//!
//! The script is one generated file rather than a table of fields, so it gets
//! the build picture's rule instead: rewritten while it is still exactly what
//! the last export wrote, and left alone once it is not.

use std::path::{Path, PathBuf};

use coilbox_unitpatch::{field_value, parse_path, patch, remove, same_value, Edit, Op, Value};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use crate::hex_digest;

/// One field the build decides, as the frontend sends it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedField {
    /// The field's dotted path in the unit's table, such as `footprintx` or
    /// `customparams.unitdefbuildtime`.
    pub path: String,
    /// What this build gives it. `None` when the build leaves it out, such as
    /// the builder keys on a unit with no build arm.
    pub now: Option<Json>,
    /// What the last export wrote there. `None` when it wrote nothing.
    pub last: Option<Json>,
}

/// What a re-export did to one field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Change {
    /// The file held the last export's value, and now holds this build's.
    Updated,
    /// The file did not have the field, and the last export did not write it.
    Added,
    /// The build no longer writes the field, and the file still held the last
    /// export's value for it.
    Removed,
    /// The file holds something other than the last export's value, so it was
    /// changed by hand and stays.
    Kept,
    /// The field was due an update the patcher would not make.
    Refused,
}

/// One field a re-export changed or would not change. A field already holding
/// this build's value is not listed.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldChange {
    pub path: String,
    pub change: Change,
    /// What the file held before, as the file evaluates. `None` when it did
    /// not have the field.
    pub was: Option<Json>,
    /// Why, for a refused field.
    pub message: Option<String>,
}

/// Why the whole definition was left as it was.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "reason")]
pub enum KeptWhole {
    /// The workshop has an unaccepted in place backup of the file. Undo puts
    /// the backup back over the file, which would throw this export away with
    /// no warning.
    WorkshopBackup,
    /// Nothing records coilbox writing the file, so it may be the game's own
    /// unit of the same name.
    NotOurs,
    /// The file does not run, so its fields cannot be compared.
    Unreadable { message: String },
}

/// What exporting the unit definition did.
#[derive(Debug, Clone, PartialEq)]
pub struct UnitDefWrite {
    pub path: PathBuf,
    /// The text written, or `None` when the file was left exactly as it was.
    pub written: Option<String>,
    pub fields: Vec<FieldChange>,
    pub kept: Option<KeptWhole>,
}

/// `units/<unit>.lua`, written whole the first time and in the scratch game,
/// and field by field after that.
///
/// `fields` is `None` when the receipt holds no proof coilbox wrote this file,
/// in which case an existing file is left alone, as every export did before.
pub fn write_unit_def(
    root: &Path,
    unit_name: &str,
    scratch: bool,
    text: &str,
    fields: Option<&[DerivedField]>,
) -> Result<UnitDefWrite, String> {
    let units = root.join("units");
    std::fs::create_dir_all(&units)
        .map_err(|e| format!("could not create {}: {e}", units.display()))?;
    let path = units.join(format!("{unit_name}.lua"));
    let left = |kept: KeptWhole, path: PathBuf| UnitDefWrite {
        path,
        written: None,
        fields: Vec::new(),
        kept: Some(kept),
    };

    if !path.exists() || scratch {
        std::fs::write(&path, text)
            .map_err(|e| format!("could not write {}: {e}", path.display()))?;
        return Ok(UnitDefWrite {
            path,
            written: Some(text.to_string()),
            fields: Vec::new(),
            kept: None,
        });
    }
    let markers = coilbox_gamebackup::WORKSHOP;
    if coilbox_gamebackup::with_suffix(&path, markers.backup).exists()
        || coilbox_gamebackup::with_suffix(&path, markers.created).exists()
    {
        return Ok(left(KeptWhole::WorkshopBackup, path));
    }
    let Some(fields) = fields else {
        return Ok(left(KeptWhole::NotOurs, path));
    };
    let source = std::fs::read_to_string(&path)
        .map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let refreshed = match refresh(&source, unit_name, fields, root) {
        Ok(refreshed) => refreshed,
        Err(message) => return Ok(left(KeptWhole::Unreadable { message }, path)),
    };
    let written = if refreshed.text == source {
        None
    } else {
        std::fs::write(&path, &refreshed.text)
            .map_err(|e| format!("could not write {}: {e}", path.display()))?;
        Some(refreshed.text)
    };
    Ok(UnitDefWrite {
        path,
        written,
        fields: refreshed.fields,
        kept: None,
    })
}

/// A unit file with its derived fields brought up to date.
#[derive(Debug, Clone, PartialEq)]
pub struct Refreshed {
    pub text: String,
    pub fields: Vec<FieldChange>,
}

/// Whether the file's value for a field is `value`, where both may be absent.
fn holds(found: Option<&Json>, value: Option<&Value>) -> bool {
    match (found, value) {
        (None, None) => true,
        (Some(found), Some(value)) => same_value(found, value),
        _ => false,
    }
}

/// Bring each of `fields` up to date in `source`, the text of `unit`'s file.
///
/// Every comparison is against the file as it was read, and each change is
/// made on the text the one before it left. Fails only when the file does not
/// run, since then no field can be compared.
pub fn refresh(
    source: &str,
    unit: &str,
    fields: &[DerivedField],
    game_root: &Path,
) -> Result<Refreshed, String> {
    let before = coilbox_unitpatch::evaluate(source, game_root).map_err(|e| e.to_string())?;
    let mut text = source.to_string();
    let mut changes = Vec::new();
    for field in fields {
        let Some(path) = parse_path(&field.path) else {
            continue;
        };
        let found = field_value(&before, unit, &path);
        let change = |change: Change, message: Option<String>| FieldChange {
            path: field.path.clone(),
            change,
            was: found.cloned(),
            message,
        };
        let (now, last) = match (
            field.now.as_ref().map(Value::from_json).transpose(),
            field.last.as_ref().map(Value::from_json).transpose(),
        ) {
            (Ok(now), Ok(last)) => (now, last),
            (Err(message), _) => {
                changes.push(change(Change::Refused, Some(message)));
                continue;
            }
            // A last value that cannot be read proves nothing about the file.
            (_, Err(_)) => {
                changes.push(change(Change::Kept, None));
                continue;
            }
        };
        if holds(found, now.as_ref()) {
            continue;
        }
        if !holds(found, last.as_ref()) {
            changes.push(change(Change::Kept, None));
            continue;
        }
        let result = match &now {
            Some(value) => patch(
                &text,
                &Edit {
                    unit: unit.to_string(),
                    path: path.clone(),
                    op: Op::Set(value.clone()),
                },
                game_root,
            ),
            None => remove(&text, unit, &path, game_root),
        };
        match result {
            // A hand edit can make the unit file include another for its
            // table. The export only ever writes its own file.
            Ok(patched) if patched.file.is_some() => changes.push(change(
                Change::Refused,
                Some(
                    "The unit's table is in another file now, which the export does not write."
                        .into(),
                ),
            )),
            Ok(patched) => {
                text = patched.text;
                let kind = match (&now, found) {
                    (None, _) => Change::Removed,
                    (Some(_), None) => Change::Added,
                    (Some(_), Some(_)) => Change::Updated,
                };
                changes.push(change(kind, None));
            }
            Err(refusal) => changes.push(change(Change::Refused, Some(refusal.to_string()))),
        }
    }
    Ok(Refreshed {
        text,
        fields: changes,
    })
}

/// What exporting the script did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScriptWrite {
    Written(PathBuf),
    /// A script is there that is not the one the last export wrote.
    Kept(PathBuf),
}

/// Write `scripts/<unit>.lua`, unless the file there is not the builder's.
///
/// `known` is the digest the receipt holds for the script the last export
/// wrote. A file that still hashes to it has not been touched since, so it is
/// replaced with this build's script. With no digest, or a different one, the
/// script is the game maker's. The scratch game always gets the current one.
pub fn write_script(
    root: &Path,
    unit_name: &str,
    scratch: bool,
    script: &str,
    known: Option<&str>,
) -> Result<ScriptWrite, String> {
    let scripts = root.join("scripts");
    std::fs::create_dir_all(&scripts)
        .map_err(|e| format!("could not create {}: {e}", scripts.display()))?;
    let target = scripts.join(format!("{unit_name}.lua"));
    if target.exists() && !scratch {
        let ours = match (known, std::fs::read(&target)) {
            (Some(known), Ok(on_disk)) => hex_digest(&on_disk) == known,
            _ => false,
        };
        if !ours {
            return Ok(ScriptWrite::Kept(target));
        }
    }
    std::fs::write(&target, script)
        .map_err(|e| format!("could not write {}: {e}", target.display()))?;
    Ok(ScriptWrite::Written(target))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A unit file the way `buildUnitDef` writes one.
    fn exported(fields: &[(&str, &str)]) -> String {
        let mut lines = vec![
            "-- tank, generated by coilbox's unit builder.".to_string(),
            String::new(),
            "return {".to_string(),
            "  [\"tank\"] = {".to_string(),
        ];
        lines.extend(fields.iter().map(|(k, v)| format!("    {k} = {v},")));
        lines.push("  },".into());
        lines.push("}".into());
        format!("{}\n", lines.join("\n"))
    }

    fn field(path: &str, now: Option<Json>, last: Option<Json>) -> DerivedField {
        DerivedField {
            path: path.into(),
            now,
            last,
        }
    }

    fn game() -> tempfile::TempDir {
        tempfile::tempdir().expect("temp dir")
    }

    fn file(root: &Path) -> String {
        std::fs::read_to_string(root.join("units/tank.lua")).expect("unit file")
    }

    #[test]
    fn a_first_export_writes_the_whole_file() {
        let game = game();
        let text = exported(&[("footprintx", "2")]);
        let wrote = write_unit_def(game.path(), "tank", false, &text, None).expect("export");
        assert_eq!(wrote.written.as_deref(), Some(text.as_str()));
        assert_eq!(wrote.kept, None);
        assert_eq!(file(game.path()), text);
    }

    #[test]
    fn a_re_export_updates_a_derived_field_the_file_still_holds() {
        let game = game();
        let first = exported(&[("footprintx", "2"), ("sightdistance", "0")]);
        std::fs::create_dir_all(game.path().join("units")).unwrap();
        std::fs::write(game.path().join("units/tank.lua"), &first).unwrap();

        let fields = [field("footprintx", Some(json!(3)), Some(json!(2)))];
        let wrote =
            write_unit_def(game.path(), "tank", false, "unused", Some(&fields)).expect("export");
        assert_eq!(
            wrote.fields,
            vec![FieldChange {
                path: "footprintx".into(),
                change: Change::Updated,
                was: Some(json!(2)),
                message: None,
            }]
        );
        assert_eq!(
            file(game.path()),
            first.replace("footprintx = 2", "footprintx = 3")
        );
    }

    #[test]
    fn a_field_changed_by_hand_stays() {
        let game = game();
        let edited = exported(&[("footprintx", "5"), ("speed", "2")]);
        std::fs::create_dir_all(game.path().join("units")).unwrap();
        std::fs::write(game.path().join("units/tank.lua"), &edited).unwrap();

        let fields = [
            field("footprintx", Some(json!(3)), Some(json!(2))),
            field("speed", Some(json!(2.5)), Some(json!(2))),
        ];
        let wrote =
            write_unit_def(game.path(), "tank", false, "unused", Some(&fields)).expect("export");
        assert_eq!(wrote.fields[0].change, Change::Kept);
        assert_eq!(wrote.fields[0].was, Some(json!(5)));
        assert_eq!(wrote.fields[1].change, Change::Updated);
        assert_eq!(
            file(game.path()),
            edited.replace("speed = 2", "speed = 2.5")
        );
    }

    #[test]
    fn a_new_derived_field_is_added_and_a_dropped_one_removed() {
        let source = exported(&[("usepiececollisionvolumes", "true")]);
        let game = game();
        let fields = [
            field("builder", Some(json!(true)), None),
            field("workertime", Some(json!(100)), None),
            field("usepiececollisionvolumes", None, Some(json!(true))),
        ];
        let refreshed = refresh(&source, "tank", &fields, game.path()).expect("runs");
        let kinds: Vec<Change> = refreshed.fields.iter().map(|f| f.change).collect();
        assert_eq!(kinds, vec![Change::Added, Change::Added, Change::Removed]);
        assert_eq!(
            refreshed.text,
            exported(&[("builder", "true"), ("workertime", "100")])
        );
    }

    #[test]
    fn a_field_deleted_by_hand_stays_deleted() {
        let source = exported(&[("objectname", "\"tank\"")]);
        let game = game();
        let fields = [field("maxslope", Some(json!(20)), Some(json!(20)))];
        let refreshed = refresh(&source, "tank", &fields, game.path()).expect("runs");
        assert_eq!(refreshed.fields[0].change, Change::Kept);
        assert_eq!(refreshed.text, source);
    }

    #[test]
    fn comments_and_other_fields_are_left_alone() {
        let source = "-- my notes\nreturn {\n  tank = {\n    -- tuned\n    maxdamage = 900,\n    footprintx = 2, -- wide\n    customparams = { unitdefbuildtime = 100, mine = true },\n  },\n}\n";
        let game = game();
        let fields = [
            field("footprintx", Some(json!(4)), Some(json!(2))),
            field(
                "customparams.unitdefbuildtime",
                Some(json!(250)),
                Some(json!(100)),
            ),
            field("maxdamage", Some(json!(1500)), Some(json!(1000))),
        ];
        let refreshed = refresh(source, "tank", &fields, game.path()).expect("runs");
        assert_eq!(
            refreshed.text,
            source
                .replace("footprintx = 2", "footprintx = 4")
                .replace("unitdefbuildtime = 100", "unitdefbuildtime = 250")
        );
        assert_eq!(refreshed.fields[2].change, Change::Kept);
    }

    #[test]
    fn the_weapons_list_is_one_field() {
        let game = game();
        let source = exported(&[("weapons", r#"{ { name = "gun", maindir = "0 0 1" } }"#)]);
        let last = json!([{ "name": "gun", "mainDir": "0 0 1" }]);
        let now = json!([{ "name": "gun", "mainDir": "0 0 1" }, { "name": "cannon" }]);
        let fields = [field("weapons", Some(now.clone()), Some(last.clone()))];
        let refreshed = refresh(&source, "tank", &fields, game.path()).expect("runs");
        assert_eq!(refreshed.fields[0].change, Change::Updated);
        assert!(refreshed.text.contains("cannon"), "{}", refreshed.text);

        let edited = source.replace("0 0 1", "1 0 0");
        let fields = [field("weapons", Some(now), Some(last))];
        let refreshed = refresh(&edited, "tank", &fields, game.path()).expect("runs");
        assert_eq!(refreshed.fields[0].change, Change::Kept);
        assert_eq!(refreshed.text, edited);
    }

    #[test]
    fn a_workshop_backup_holds_the_file_back() {
        let game = game();
        let units = game.path().join("units");
        std::fs::create_dir_all(&units).unwrap();
        let patched = exported(&[("footprintx", "2"), ("maxdamage", "4000")]);
        std::fs::write(units.join("tank.lua"), &patched).unwrap();
        std::fs::write(
            units.join("tank.lua.coilbox-workshop-backup"),
            exported(&[("footprintx", "2")]),
        )
        .unwrap();

        let fields = [field("footprintx", Some(json!(3)), Some(json!(2)))];
        let wrote =
            write_unit_def(game.path(), "tank", false, "unused", Some(&fields)).expect("export");
        assert_eq!(wrote.kept, Some(KeptWhole::WorkshopBackup));
        assert_eq!(wrote.written, None);
        assert_eq!(file(game.path()), patched);
    }

    #[test]
    fn a_file_coilbox_has_no_record_of_writing_is_left_alone() {
        let game = game();
        let units = game.path().join("units");
        std::fs::create_dir_all(&units).unwrap();
        let theirs = exported(&[("footprintx", "2")]);
        std::fs::write(units.join("tank.lua"), &theirs).unwrap();
        let wrote = write_unit_def(game.path(), "tank", false, "mine", None).expect("export");
        assert_eq!(wrote.kept, Some(KeptWhole::NotOurs));
        assert_eq!(file(game.path()), theirs);
    }

    #[test]
    fn a_file_that_does_not_run_is_left_alone() {
        let game = game();
        let units = game.path().join("units");
        std::fs::create_dir_all(&units).unwrap();
        std::fs::write(units.join("tank.lua"), "return {").unwrap();
        let fields = [field("footprintx", Some(json!(3)), Some(json!(2)))];
        let wrote =
            write_unit_def(game.path(), "tank", false, "unused", Some(&fields)).expect("export");
        assert!(matches!(wrote.kept, Some(KeptWhole::Unreadable { .. })));
        assert_eq!(file(game.path()), "return {");
    }

    #[test]
    fn the_scratch_game_is_always_rewritten() {
        let game = game();
        let units = game.path().join("units");
        std::fs::create_dir_all(&units).unwrap();
        std::fs::write(units.join("tank.lua"), "old").unwrap();
        let wrote = write_unit_def(game.path(), "tank", true, "new", None).expect("export");
        assert_eq!(wrote.written.as_deref(), Some("new"));
        assert_eq!(file(game.path()), "new");
    }

    #[test]
    fn the_script_is_replaced_only_while_it_is_the_last_export() {
        let game = game();
        let path = game.path().join("scripts/tank.lua");

        let first = write_script(game.path(), "tank", false, "one", None).expect("export");
        assert_eq!(first, ScriptWrite::Written(path.clone()));

        let known = hex_digest(b"one");
        let second = write_script(game.path(), "tank", false, "two", Some(&known)).expect("export");
        assert_eq!(second, ScriptWrite::Written(path.clone()));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "two");

        std::fs::write(&path, "edited").unwrap();
        let known = hex_digest(b"two");
        let third =
            write_script(game.path(), "tank", false, "three", Some(&known)).expect("export");
        assert_eq!(third, ScriptWrite::Kept(path.clone()));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "edited");

        let unknown = write_script(game.path(), "tank", false, "four", None).expect("export");
        assert_eq!(unknown, ScriptWrite::Kept(path.clone()));
    }
}
