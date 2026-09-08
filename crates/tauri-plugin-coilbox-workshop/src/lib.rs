//! The workshop's compiler, over a Tauri command (issue #1275).
//!
//! The editor holds the project and the game reads Lua. This is the step
//! between them, and everything else in the workshop milestone is either an
//! interface over its input or a way of delivering its output.
//!
//! It lives in Rust rather than beside the project model in TypeScript because
//! of what happens next to what it produces. The preflight parses it with
//! `coilbox-springlua` (issue #1276), the local test run writes it into a `.sdd`
//! under the content root, and packing it for somebody else builds an archive.
//! All three are Rust already, and a compiler on this side of the boundary hands
//! them a value rather than a string it has to send back.
//!
//! The command takes the whole project and returns the whole compilation. It
//! reads nothing off disk and writes nothing, so it is safe to call on every
//! keystroke and there is nothing to clean up if the user closes the drawer.
//!
//! `workshop_preflight` (issue #1276) is the second command this plugin
//! exposes. It compiles the same way, then checks the result before it ever
//! leaves the app: syntax through `coilbox-springlua`, plus the cheap static
//! checks `preflight` documents.
//!
//! `workshop_test_mutator` (issue #1278) is the third: it writes a compiled
//! project into a generated game under the content root, the local play
//! route every game supports. See `mutator`'s own doc comment.
//!
//! `workshop_package_mutator` (issue #1283) is the fourth: it checks the same
//! way `workshop_preflight` does, then packs a compiled project into a `.sdz`
//! at a caller-chosen path, versioned for handing to somebody else rather
//! than for the local test route's own fixed folder. See `package`'s own doc
//! comment.
//!
//! `workshop_pack_bar_slots` (issue #1277) is the fifth: it checks the same
//! way the other two export routes do, then packs the compiled chunks across
//! Beyond All Reason's numbered `tweakdefs`/`tweakunits` mod options, for a
//! player who is not hosting their own lobby. See `bar_pack`'s own doc
//! comment for the size and ordering rules this follows.
//!
//! `workshop_decode_tweak_set` (issue #1280) is the sixth, and the inverse of
//! the fifth: given a payload, or a whole set of slots read from a battle's
//! mod options, it decodes each one back to Lua, classifies it as data or a
//! program, and evaluates the data ones. See `decode`'s own doc comment for
//! what it will and will not run through the Lua VM.

mod bar_pack;
mod compile;
mod decode;
mod lua;
mod model;
mod mutator;
mod package;
mod preflight;

pub use bar_pack::{pack as pack_bar_slots, BarSlotPack};
pub use compile::{compile, Chunk, CompiledFile, CompiledMod, LuaForm};
pub use decode::{decode_many, DecodedSlot, DecodedTweakSet, SlotKind};
pub use model::{GameEdits, ModProject, ReadOnlyLuaBlock};
pub use preflight::{preflight, PreflightReport};

use picoframe_core::CliResult;
use serde::Serialize;
use std::collections::BTreeMap;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// A payload in the envelope the frontend unwraps.
///
/// Every picoframe plugin command answers with a [`CliResult`], and the
/// `defineCommand` bindings in `src/workshop/*.ts` read `success` off it before
/// they hand anything back. A command that returns its payload bare therefore
/// looks like a failure to the caller however well it ran, which is what issue
/// #2751 was: preflight computed a clean report and the button said the check
/// could not run.
fn envelope<T: Serialize>(value: &T) -> CliResult {
    match serde_json::to_value(value) {
        Ok(value) => CliResult::ok(value),
        Err(e) => CliResult::err(format!("could not report the result: {e}")),
    }
}

/// Compile a saved project into the Lua a game reads.
#[tauri::command]
fn workshop_compile(project: ModProject) -> CliResult {
    envelope(&compile(&project))
}

/// Compile a saved project and check the result before it ever leaves the
/// app (issue #1276).
#[tauri::command]
fn workshop_preflight(project: ModProject) -> CliResult {
    let compiled = compile(&project);
    envelope(&preflight(&project, &compiled))
}

/// What `workshop_test_mutator` wrote.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestMutatorResult {
    /// The mutator's folder, absolute.
    dir: String,
    /// [`mutator::FOLDER`], so the frontend can recognise the archive
    /// unitsync reports back without hard-coding it a second time.
    folder: &'static str,
    /// Every file written, relative to `dir`.
    files: Vec<String>,
}

/// Compile a saved project and write it into coilbox's own test game under
/// `data_dir` (issue #1278), the mutator route every Spring and Recoil game
/// supports. An empty compile (a project with no edits, or one whose only
/// edits are text that cannot compile to a mutator at all) is refused rather
/// than writing an empty archive: there is nothing to test.
#[tauri::command]
fn workshop_test_mutator(data_dir: String, project: ModProject) -> CliResult {
    let compiled = compile(&project);
    if compiled.files.is_empty() {
        return CliResult::err(
            "This project has no edits a mutator archive can carry, so there is nothing to test.",
        );
    }
    let dir = match mutator::mutator_dir(&data_dir) {
        Ok(dir) => dir,
        Err(e) => return CliResult::err(e),
    };
    if let Err(e) = mutator::write_mutator(&dir, &compiled.files) {
        return CliResult::err(e);
    }
    envelope(&TestMutatorResult {
        dir: dir.to_string_lossy().into_owned(),
        folder: mutator::FOLDER,
        files: compiled.files.into_iter().map(|f| f.path).collect(),
    })
}

/// What `workshop_package_mutator` wrote.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagedMutatorResult {
    /// Where the archive was written, absolute.
    path: String,
    /// Every file the archive holds, relative to its own root.
    files: Vec<String>,
    /// The version written into `modinfo.lua`, echoed back so the caller
    /// records what actually shipped.
    version: u32,
}

/// Compile a saved project, check it, and pack it as a `.sdz` at `dest`
/// (issue #1283), for somebody else to play rather than for this machine's
/// own test route. Refused the same way `workshop_test_mutator` is when
/// there is nothing to package, and refused again when preflight finds a
/// blocker: a file going out to other people is exactly the case a blocker
/// should stop rather than only flag (issue #2748).
#[tauri::command]
fn workshop_package_mutator(project: ModProject, version: u32, dest: String) -> CliResult {
    let compiled = compile(&project);
    if compiled.files.is_empty() {
        return CliResult::err(
            "This project has no edits a mutator archive can carry, so there is nothing to package.",
        );
    }
    let report = preflight(&project, &compiled);
    if !report.blockers.is_empty() {
        return CliResult::err(format!(
            "{} blocker{} would reach whoever plays this broken, so it was not packaged: {}",
            report.blockers.len(),
            if report.blockers.len() == 1 { "" } else { "s" },
            report.blockers.join("; "),
        ));
    }
    let files = package::versioned_files(&project, compiled.files, version);
    let dest_path = std::path::Path::new(&dest);
    if let Err(e) = package::write_sdz(dest_path, &files) {
        return CliResult::err(e);
    }
    envelope(&PackagedMutatorResult {
        path: dest_path.to_string_lossy().into_owned(),
        files: files.into_iter().map(|f| f.path).collect(),
        version,
    })
}

/// Compile a saved project, check it, and pack its chunks across Beyond All
/// Reason's numbered tweak slots (issue #1277), for a player who is not
/// hosting their own lobby. Refused the same way the other export routes are
/// when there is nothing to pack or preflight finds a blocker: a lobby chat
/// line going out to other people is exactly the case a blocker should stop
/// rather than only flag (issue #2748). A chunk `bar_pack::pack` could not
/// place, whether too big for any slot or simply out of slots, is not a
/// refusal: the caller decides what to do with a partial pack, since some of
/// the project reaching a lobby is better than none of it silently vanishing.
#[tauri::command]
fn workshop_pack_bar_slots(project: ModProject) -> CliResult {
    let compiled = compile(&project);
    if compiled.chunks.is_empty() {
        return CliResult::err(
            "This project has no edits, so there is nothing to pack for a Beyond All Reason lobby.",
        );
    }
    let report = preflight(&project, &compiled);
    if !report.blockers.is_empty() {
        return CliResult::err(format!(
            "{} blocker{} would reach the lobby broken, so it was not packed: {}",
            report.blockers.len(),
            if report.blockers.len() == 1 { "" } else { "s" },
            report.blockers.join("; "),
        ));
    }
    envelope(&bar_pack::pack(&compiled.chunks))
}

/// Decode a payload, or a whole set of slots read from a battle's mod
/// options, back to Lua (issue #1280). `entries` is a key to raw pasted text
/// map: a real mod-options set (`tweakdefs`, `tweakunits3`, ...), a single ad
/// hoc paste under the key `"pasted"`, or both at once. A key this plugin
/// does not recognise as a tweak slot is ignored rather than reported on, so
/// a caller can hand over a whole battle's options without expecting a
/// complaint about every other one. Never refused: an empty or unreadable
/// entry decodes to its own reported error rather than failing the batch, so
/// one bad paste never hides what the rest of a lobby's options say.
#[tauri::command]
fn workshop_decode_tweak_set(entries: BTreeMap<String, String>) -> CliResult {
    match decode::decode_many(&entries) {
        Ok(set) => envelope(&set),
        Err(e) => CliResult::err(e),
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-workshop")
        .invoke_handler(tauri::generate_handler![
            workshop_compile,
            workshop_preflight,
            workshop_test_mutator,
            workshop_package_mutator,
            workshop_pack_bar_slots,
            workshop_decode_tweak_set
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BuildMenuOp;
    use serde_json::Value;

    /// One project in the shape the frame settings store really holds, written
    /// by `src/workshop/savedProjectGolden.test.ts` from the five stores' own
    /// functions. See that file for how it stays current.
    const SAVED_PROJECT: &str = include_str!("../tests/fixtures/saved-project.json");

    fn saved_project() -> ModProject {
        serde_json::from_str(SAVED_PROJECT).expect("the saved project parses")
    }

    /// What `defineCommand` does with a command's answer, in Rust.
    ///
    /// `node_modules/@picoframe/plugin-sdk/dist/command.js` reads `success` off
    /// the response and throws `"<plugin>|<command> failed"` when it is not
    /// there, so a command answering with a bare payload reads as a failure
    /// however well it ran. Returns the `data` a caller would have been handed.
    fn unwrap_as_the_frontend_does(result: CliResult) -> Value {
        let response = serde_json::to_value(&result).expect("the answer serialises");
        assert_eq!(
            response.get("success"),
            Some(&Value::Bool(true)),
            "the frontend reads `success` off this and throws when it is missing: {response}"
        );
        response
            .get("data")
            .expect("a successful answer carries its payload under `data`")
            .clone()
    }

    /// Issue #2751. Every one of the three answered with its payload bare, so
    /// the checks button reported "coilbox-workshop|workshop_preflight failed"
    /// on a preflight that had run and come back clean.
    #[test]
    fn every_command_answers_in_the_envelope_the_frontend_unwraps() {
        let project = saved_project();

        let compiled = unwrap_as_the_frontend_does(workshop_compile(project.clone()));
        assert!(compiled.get("files").is_some_and(Value::is_array));

        let report = unwrap_as_the_frontend_does(workshop_preflight(project.clone()));
        for list in ["blockers", "review", "passes"] {
            assert!(
                report.get(list).is_some_and(Value::is_array),
                "the report is missing {list}: {report}"
            );
        }

        let dir = tempfile::tempdir().expect("temp dir");
        let written = unwrap_as_the_frontend_does(workshop_test_mutator(
            dir.path().to_string_lossy().into_owned(),
            project.clone(),
        ));
        assert!(written.get("files").is_some_and(Value::is_array));

        let dest = dir.path().join("packaged.sdz");
        let packaged = unwrap_as_the_frontend_does(workshop_package_mutator(
            project.clone(),
            1,
            dest.to_string_lossy().into_owned(),
        ));
        assert!(packaged.get("files").is_some_and(Value::is_array));
        assert_eq!(packaged["version"], Value::from(1));

        let bar_pack = unwrap_as_the_frontend_does(workshop_pack_bar_slots(project));
        assert!(bar_pack.get("tweakdefs").is_some_and(Value::is_array));
        assert!(bar_pack.get("tweakunits").is_some_and(Value::is_array));

        let mut entries = std::collections::BTreeMap::new();
        entries.insert("pasted".to_string(), "not valid base64 !!!".to_string());
        let decoded = unwrap_as_the_frontend_does(workshop_decode_tweak_set(entries));
        assert!(decoded.get("tweakdefs").is_some_and(Value::is_array));
        assert!(decoded.get("tweakunits").is_some_and(Value::is_array));
        assert!(decoded.get("unrecognised").is_some_and(Value::is_array));
    }

    /// A project that changes nothing is what the editor holds for the whole
    /// of the first session, and it is what both of the saved projects on the
    /// machine #2751 was reported from held. Both commands answer it rather
    /// than refusing it: an empty compile and an empty report are answers.
    #[test]
    fn a_project_with_no_edits_is_answered_not_refused() {
        let empty = ModProject::default();

        let compiled = unwrap_as_the_frontend_does(workshop_compile(empty.clone()));
        assert_eq!(compiled["files"].as_array().map(Vec::len), Some(0));
        assert_eq!(compiled["barTweakdefs"], Value::Null);

        let report = unwrap_as_the_frontend_does(workshop_preflight(empty));
        assert_eq!(report["blockers"].as_array().map(Vec::len), Some(0));
    }

    /// A refusal has to reach the user as its own words. `defineCommand` throws
    /// `error` when there is one, so this is the difference between "there is
    /// nothing to test" and the generic message #2751 was.
    #[test]
    fn a_refusal_carries_its_reason() {
        let result = workshop_test_mutator(
            std::env::temp_dir().to_string_lossy().into_owned(),
            ModProject::default(),
        );
        let response = serde_json::to_value(&result).expect("the answer serialises");

        assert_eq!(response.get("success"), Some(&Value::Bool(false)));
        assert!(response
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|e| e.contains("nothing to test")));
    }

    /// The same empty-project refusal, for the packaging route (issue #1283).
    /// A `.sdz` with nothing in it is no more use to somebody else than an
    /// empty test mutator is to this machine.
    #[test]
    fn packaging_an_empty_project_is_refused_with_its_own_reason() {
        let dest = std::env::temp_dir().join("cbx-workshop-package-empty-test.sdz");
        let result = workshop_package_mutator(
            ModProject::default(),
            1,
            dest.to_string_lossy().into_owned(),
        );
        let response = serde_json::to_value(&result).expect("the answer serialises");

        assert_eq!(response.get("success"), Some(&Value::Bool(false)));
        assert!(response
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|e| e.contains("nothing to package")));
        assert!(!dest.exists(), "nothing should have been written");
    }

    /// A packaged mutator going out to other people is exactly the case a
    /// blocker should stop rather than only flag (issue #2748). Two clones
    /// naming the same unit is `preflight`'s own blocker case.
    #[test]
    fn packaging_is_refused_when_preflight_finds_a_blocker() {
        let project: ModProject = serde_json::from_value(serde_json::json!({
            "name": "Faster commanders",
            "gameName": "Balanced Annihilation V15.9.8",
            "edits": {
                "clones": {
                    "first": { "key": "supercom", "replacesGameUnit": false, "def": { "maxDamage": 1 } },
                    "second": { "key": "supercom", "replacesGameUnit": false, "def": { "maxDamage": 2 } }
                }
            },
        }))
        .expect("parse");
        let dest = std::env::temp_dir().join("cbx-workshop-package-blocker-test.sdz");

        let result = workshop_package_mutator(project, 1, dest.to_string_lossy().into_owned());
        let response = serde_json::to_value(&result).expect("the answer serialises");

        assert_eq!(response.get("success"), Some(&Value::Bool(false)));
        assert!(response
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|e| e.contains("blocker") && e.contains("supercom")));
        assert!(!dest.exists(), "nothing should have been written");
    }

    /// The same empty-project refusal, for the BAR tweak-slot route (issue
    /// #1277). Nothing to compile means nothing to pack.
    #[test]
    fn packing_bar_slots_for_an_empty_project_is_refused_with_its_own_reason() {
        let response = serde_json::to_value(workshop_pack_bar_slots(ModProject::default()))
            .expect("the answer serialises");

        assert_eq!(response.get("success"), Some(&Value::Bool(false)));
        assert!(response
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|e| e.contains("nothing to pack")));
    }

    /// A lobby chat line going out to other people is exactly the case a
    /// blocker should stop rather than only flag (issue #2748), the same
    /// reasoning `workshop_package_mutator` already follows.
    #[test]
    fn packing_bar_slots_is_refused_when_preflight_finds_a_blocker() {
        let project: ModProject = serde_json::from_value(serde_json::json!({
            "name": "Faster commanders",
            "gameName": "Balanced Annihilation V15.9.8",
            "edits": {
                "clones": {
                    "first": { "key": "supercom", "replacesGameUnit": false, "def": { "maxDamage": 1 } },
                    "second": { "key": "supercom", "replacesGameUnit": false, "def": { "maxDamage": 2 } }
                }
            },
        }))
        .expect("parse");

        let response =
            serde_json::to_value(workshop_pack_bar_slots(project)).expect("the answer serialises");

        assert_eq!(response.get("success"), Some(&Value::Bool(false)));
        assert!(response
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|e| e.contains("blocker") && e.contains("supercom")));
    }

    /// The saved fixture carries both a table-form edit (an override) and
    /// several block-form ones (a copy, a menu, a disabled unit), so packing
    /// it is a real check that both slot kinds come back non-empty rather
    /// than only the one the other tests happen to build.
    #[test]
    fn packing_bar_slots_for_the_saved_project_fills_both_kinds_of_slot() {
        let project = saved_project();
        let pack = unwrap_as_the_frontend_does(workshop_pack_bar_slots(project));

        let tweakdefs = pack["tweakdefs"].as_array().expect("tweakdefs array");
        let tweakunits = pack["tweakunits"].as_array().expect("tweakunits array");
        assert!(
            !tweakdefs.is_empty(),
            "the saved project has block-form edits"
        );
        assert!(
            !tweakunits.is_empty(),
            "the saved project has table-form edits"
        );
        assert!(pack["oversized"].as_array().is_some_and(Vec::is_empty));
        assert!(pack["unplaced"].as_array().is_some_and(Vec::is_empty));
    }

    /// The whole point of the fixture: a project saved by the app, through the
    /// real deserialiser rather than through a value built in Rust. Every store
    /// is checked, so a store whose shape moves on the TypeScript side fails
    /// here rather than in front of somebody who saved a project.
    #[test]
    fn a_saved_project_reaches_every_store() {
        let project = saved_project();

        assert_eq!(project.name, "Faster commanders");
        assert_eq!(project.game_name, "Balanced Annihilation V15.9.8");
        assert_eq!(
            project.description.as_deref(),
            Some("What the checked-in fixture is for")
        );

        let edits = &project.edits;
        assert_eq!(
            edits.overrides["armcom"]["weapondefs.disintegrator.range"],
            serde_json::json!(400),
            "a dotted path is one key, not a nested table"
        );
        let clone = &edits.clones["supercom"];
        assert_eq!(clone.key, "supercom");
        assert_eq!(clone.source.as_deref(), Some("armcom"));
        assert!(!clone.replaces_game_unit);
        assert!(clone.def.get("maxDamage").is_some());

        let ops = &edits.menus["armlab"];
        assert!(matches!(&ops[0], BuildMenuOp::Add { unit } if unit == "armstump"));
        assert!(matches!(&ops[1], BuildMenuOp::Remove { unit } if unit == "armflash"));
        assert!(matches!(&ops[2], BuildMenuOp::Move { before: Some(b), .. } if b == "armpw"));

        assert_eq!(
            edits.text["armcom"]["en"].name.as_deref(),
            Some("Commander")
        );
        assert_eq!(
            edits.text["armcom"]["de"].description.as_deref(),
            Some("Kommandant"),
            "text is keyed by unit and then by language"
        );
        assert_eq!(edits.disabled, vec!["armaser", "armbanth"]);
    }

    /// A project somebody saved compiles and passes its own checks. Preflight
    /// had never been run over one: every other test builds its input here.
    #[test]
    fn a_saved_project_passes_preflight() {
        let project = saved_project();
        let report = preflight(&project, &compile(&project));

        assert_eq!(report.blockers, Vec::<String>::new());
        assert!(!report.passes.is_empty());
    }
}
