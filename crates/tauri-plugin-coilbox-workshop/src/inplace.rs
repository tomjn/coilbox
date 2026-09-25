//! Writing a project's field changes into the game's own unit files (issue
//! #2635), the edit-in-place route #2631 offers for a loose `.sdd`.
//!
//! Each changed unit's file is found under `units/`, patched one field at a
//! time through `coilbox-unitpatch`, and written through
//! `coilbox_gamebackup::Markers`. The first write to a file renames the
//! original aside, so undo and accept work from the files on disk alone.
//!
//! A write is all or nothing. Every change is patched in memory first, and if
//! the patcher refuses any of them, nothing is written and every refusal is
//! reported. Writing the rest would leave the game holding part of what the
//! user asked for with no sign on disk of which part.
//!
//! Only field changes to the game's own units go this way. Copies, build
//! menus, words and switched-off units have no in-place form yet, and the
//! outcome says which of them the project holds rather than dropping them
//! quietly.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use coilbox_gamebackup::{key, Markers};
use coilbox_unitpatch::{patch, Edit, Location, Op, RefusalKind, Segment, Value as PatchValue};
use serde::Serialize;
use serde_json::Value;

use crate::model::ModProject;

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
    /// The unit's file, relative to the game, when one was found.
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
fn require_loose_game(game_dir: &Path) -> Result<(), String> {
    if !coilbox_gamebackup::is_sdd(game_dir) || !coilbox_gamebackup::in_games_dir(game_dir) {
        return Err(format!(
            "{} is not a loose .sdd game directly in a games folder, so coilbox will not write into it.",
            game_dir.display()
        ));
    }
    Ok(())
}

/// A project path step of digits is a list position counted from zero, the
/// rule `overrides.ts` writes paths under. The patcher counts from one, as
/// Lua does.
fn segments(path: &str) -> Option<Vec<Segment>> {
    let mut out = Vec::new();
    for step in path.split('.') {
        if step.is_empty() {
            return None;
        }
        if step.bytes().all(|b| b.is_ascii_digit()) {
            out.push(Segment::Index(step.parse::<usize>().ok()? + 1));
        } else {
            out.push(Segment::Key(step.to_string()));
        }
    }
    Some(out)
}

fn patch_value(value: &Value) -> Option<PatchValue> {
    match value {
        Value::Bool(b) => Some(PatchValue::Bool(*b)),
        Value::Number(n) => n.as_f64().map(PatchValue::Number),
        Value::String(s) => Some(PatchValue::String(s.clone())),
        _ => None,
    }
}

/// Every `.lua` file under the game's `units` folder, which is where the
/// engine's own `gamedata/unitdefs.lua` loads unit definitions from. The
/// folder name is matched without regard to case, as the engine's archive
/// lookups are.
fn unit_files(game_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(game_dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && entry.file_name().eq_ignore_ascii_case("units") {
            walk_lua(&path, &mut out);
        }
    }
    out.sort();
    out
}

fn walk_lua(at: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(at) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_lua(&path, out);
        } else if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("lua"))
        {
            out.push(path);
        }
    }
}

/// The parts of a project this route does not write, one sentence each.
fn not_carried(project: &ModProject) -> Vec<String> {
    let edits = &project.edits;
    let mut out = Vec::new();
    if !edits.clones.is_empty() {
        out.push(format!(
            "{} copied unit{} and any field changes to {} are not written into the game yet.",
            edits.clones.len(),
            if edits.clones.len() == 1 { "" } else { "s" },
            if edits.clones.len() == 1 {
                "it"
            } else {
                "them"
            },
        ));
    }
    if !edits.menus.is_empty() {
        out.push("Build menu changes are not written into the game yet.".to_string());
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
    out
}

/// One unit's field changes, ready to patch.
struct UnitChanges<'a> {
    unit: &'a str,
    /// Each change as the project spells its path, and the edit it becomes.
    edits: Vec<(&'a str, Edit)>,
}

/// Which file defines `unit`, and the first edit already applied to it.
///
/// A file is a candidate when its text names the unit at all. The patcher
/// then settles it: a file that does not define the unit is refused as
/// `UnitNotFound` before anything is evaluated, so trying each candidate is
/// cheap. Files whose name matches the unit are tried first, because that is
/// how most games lay their units out.
enum Found {
    /// The file, and the first edit's result against it.
    File(
        PathBuf,
        Result<coilbox_unitpatch::Patched, coilbox_unitpatch::Refusal>,
    ),
    /// No file under `units/` defines the unit. The refusal, when there is
    /// one, is the most useful thing a candidate file said.
    None(Option<(PathBuf, coilbox_unitpatch::Refusal)>),
}

fn find_unit_file(
    unit: &str,
    first: &Edit,
    files: &[PathBuf],
    texts: &BTreeMap<PathBuf, String>,
    game_dir: &Path,
) -> Found {
    let wanted = unit.to_lowercase();
    let mut candidates: Vec<&PathBuf> = files
        .iter()
        .filter(|f| texts[*f].to_lowercase().contains(&wanted))
        .collect();
    candidates.sort_by_key(|f| {
        let stem = f.file_stem().map(|s| s.to_string_lossy().to_lowercase());
        stem.as_deref() != Some(wanted.as_str())
    });
    let mut file_level: Option<(PathBuf, coilbox_unitpatch::Refusal)> = None;
    for file in candidates {
        match patch(&texts[file], first, game_dir) {
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

/// Patch every field change in `project` into the game's unit files under
/// `game_dir`, and write them if the patcher accepted every one.
pub fn write(game_dir: &Path, project: &ModProject) -> Result<WriteOutcome, String> {
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
            let refuse = |message: String| Refused {
                unit: unit.clone(),
                field: field.clone(),
                file: None,
                kind: RefusalKind::InvalidValue,
                message,
                location: None,
            };
            let Some(path) = segments(field) else {
                outcome
                    .refused
                    .push(refuse(format!("{field:?} is not a field path.")));
                continue;
            };
            let Some(value) = patch_value(value) else {
                outcome.refused.push(refuse(
                    "Only a number, a string or true or false can be written into the file. A list or a table has to go through the mutator route.".to_string(),
                ));
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

    let files = unit_files(game_dir);
    let mut texts: BTreeMap<PathBuf, String> = BTreeMap::new();
    for file in &files {
        // A file that is not UTF-8 cannot be a unit file the patcher reads,
        // so it is left out of the search rather than failing the write.
        if let Ok(text) = std::fs::read_to_string(file) {
            texts.insert(file.clone(), text);
        }
    }
    let files: Vec<PathBuf> = texts.keys().cloned().collect();
    let originals = texts.clone();
    // Which file each accepted change landed in, to say whether undo reaches it.
    let mut held: Vec<(&str, &str, PathBuf)> = Vec::new();

    for UnitChanges { unit, edits } in units {
        let (_, first) = &edits[0];
        let (file, first_result) = match find_unit_file(unit, first, &files, &texts, game_dir) {
            Found::File(file, result) => (file, result),
            Found::None(file_level) => {
                let (file, kind, message, location) = match file_level {
                    Some((file, refusal)) => (
                        Some(rel(&file)),
                        refusal.kind,
                        refusal.message,
                        refusal.location,
                    ),
                    None => (
                        None,
                        RefusalKind::UnitNotFound,
                        format!("No file under units/ defines {unit}."),
                        None,
                    ),
                };
                for (field, _) in &edits {
                    outcome.refused.push(Refused {
                        unit: unit.to_string(),
                        field: field.to_string(),
                        file: file.clone(),
                        kind,
                        message: message.clone(),
                        location,
                    });
                }
                continue;
            }
        };
        let mut pending = Some(first_result);
        for (field, edit) in &edits {
            let result = match pending.take() {
                Some(result) => result,
                None => patch(&texts[&file], edit, game_dir),
            };
            match result {
                Ok(patched) if patched.changed => {
                    outcome.changed += 1;
                    texts.insert(file.clone(), patched.text);
                    held.push((unit, *field, file.clone()));
                }
                Ok(_) => {
                    outcome.unchanged += 1;
                    held.push((unit, *field, file.clone()));
                }
                Err(refusal) => outcome.refused.push(Refused {
                    unit: unit.to_string(),
                    field: field.to_string(),
                    file: Some(rel(&file)),
                    kind: refusal.kind,
                    message: refusal.message,
                    location: refusal.location,
                }),
            }
        }
    }

    if !outcome.refused.is_empty() {
        outcome.changed = 0;
        outcome.unchanged = 0;
        return Ok(outcome);
    }

    for (file, text) in &texts {
        if originals.get(file) == Some(text) {
            continue;
        }
        MARKERS.write(file, text.as_bytes())?;
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

    #[test]
    fn a_digit_step_counts_from_one_in_lua() {
        assert_eq!(
            segments("weapons.0.def"),
            Some(vec![
                Segment::Key("weapons".into()),
                Segment::Index(1),
                Segment::Key("def".into())
            ])
        );
        assert_eq!(segments("a..b"), None);
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

    #[test]
    fn a_game_outside_a_games_folder_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let game = root.path().join("elsewhere/dev.sdd");
        std::fs::create_dir_all(&game).unwrap();
        assert!(write(&game, &project(serde_json::json!({}))).is_err());
        assert!(undo(&game).is_err());
        assert!(accept(&game).is_err());
    }
}
