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
//! `workshop_pack_tweak_slots` (issue #1277) is the fifth: it checks the same
//! way the other two export routes do, then packs the compiled chunks across
//! a game's numbered `tweakdefs`/`tweakunits` mod options (a convention Beyond
//! All Reason's `modoptions.lua` popularized, but the mod options themselves
//! predate it), for a player who is not hosting their own lobby. See
//! `tweak_pack`'s own doc comment for the size and ordering rules this
//! follows.
//!
//! `workshop_decode_tweak_set` (issue #1280) is the sixth, and the inverse of
//! the fifth: given a payload, or a whole set of slots read from a battle's
//! mod options, it decodes each one back to Lua, classifies it as data or a
//! program, and evaluates the data ones. See `decode`'s own doc comment for
//! what it will and will not run through the Lua VM.
//!
//! `workshop_change_ledger` (issue #2653) is the seventh, and reads rather
//! than writes: it traces every edit in a project to the mutator file and,
//! where the trace can place it, the numbered tweak slot that carries it. See
//! `ledger`'s own doc comment for why that is a read over the other six
//! commands' output rather than a new compiled artefact of its own.
//!
//! `workshop_write_in_place` (issue #2635) is the one command that writes
//! into a game's own folder, and three more go with it: a status count of the
//! backups it left, undo and accept. `workshop_check_in_place` (issue #2633)
//! is the same patching as a dry run for one unit, which the unit page asks
//! at edit time. `workshop_check_clone_in_place` (issue #3035) is the same
//! question for a copy: which of its own changes have no edit a file can
//! carry, worked out from values alone. See `inplace`'s own doc comment.
//!
//! `workshop_in_place_diffs` (issue #2636) reads rather than writes: a line
//! diff of every file the edit-in-place route has touched, backup against
//! current, so a game author can see what changed on disk before accepting or
//! undoing it. See `diff`'s own doc comment.

mod before_post;
mod compile;
mod decode;
mod diff;
mod inplace;
mod inplace_clone;
mod ledger;
pub mod loads_as;
mod lua;
mod model;
mod mutator;
mod package;
mod preflight;
mod tweak_pack;

pub use compile::{compile, Chunk, CompiledFile, CompiledMod, LuaForm};
pub use decode::{decode_many, DecodedSlot, DecodedTweakSet, SlotKind};
pub use inplace::{
    dry_run as inplace_dry_run, write as write_in_place, WriteOutcome as InPlaceWriteOutcome,
};
pub use ledger::{
    build_ledger, ChangeLedger, LedgerChange, TweakSlotMiss, TweakSlotRef, UnitLedger,
};
pub use model::{GameEdits, ModProject, ReadOnlyLuaBlock};
pub use preflight::{preflight, PreflightReport};
pub use tweak_pack::{pack as pack_tweak_slots, TweakSlotPack};

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

/// Compile a saved project into the Lua a game reads. `written` is what a
/// settle worked out for the route the result is for (issue #3092), which the
/// local tweak slot launch needs because it writes `tweakdefs` itself.
#[tauri::command]
fn workshop_compile(project: ModProject, written: Option<loads_as::Written>) -> CliResult {
    envelope(&loads_as::compile_written(
        &project,
        &written.unwrap_or_default(),
    ))
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
///
/// `written` is what `workshop_settle_typed_values` worked out for this
/// project (issue #3059): values the game's post files turn into the typed
/// ones, each proven by loading the game with exactly these files.
#[tauri::command]
fn workshop_test_mutator(
    data_dir: String,
    project: ModProject,
    written: Option<loads_as::Written>,
) -> CliResult {
    let compiled = loads_as::compile_written(&project, &written.unwrap_or_default());
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
///
/// `written` is as `workshop_test_mutator` takes it (issue #3059).
#[tauri::command]
fn workshop_package_mutator(
    project: ModProject,
    version: u32,
    dest: String,
    written: Option<loads_as::Written>,
) -> CliResult {
    let project = loads_as::with_written(&project, &written.unwrap_or_default());
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

/// Compile a saved project, check it, and pack its chunks across the game's
/// numbered tweak slots (issue #1277), for a player who is not hosting their
/// own lobby. Refused the same way the other export routes are when there is
/// nothing to pack or preflight finds a blocker: a lobby chat line going out
/// to other people is exactly the case a blocker should stop rather than
/// only flag (issue #2748). A chunk `tweak_pack::pack` could not place,
/// whether too big for any slot or simply out of slots, is not a refusal:
/// the caller decides what to do with a partial pack, since some of the
/// project reaching a lobby is better than none of it silently vanishing.
///
/// `written` is what `workshop_settle_typed_values_tweaks` worked out for the
/// numbered slots (issue #3092), as `workshop_test_mutator` takes it.
#[tauri::command]
fn workshop_pack_tweak_slots(project: ModProject, written: Option<loads_as::Written>) -> CliResult {
    let project = loads_as::with_written(&project, &written.unwrap_or_default());
    // A numbered slot is still a tweak slot: it carries a field that names a
    // generator, never the effects/<key>.lua file the name resolves to
    // (`compile.rs`'s own note on `tweakdefs`). Refused outright, the same
    // way an empty project is, rather than packed with a reference nothing
    // in the lobby will deliver.
    if !project.edits.explosion_generators.is_empty() {
        return CliResult::err(
            "This project has a custom explosion effect. A tweak slot cannot carry the effects file it needs, so packing it into a lobby chat line would silently break it. Use the mutator or edit-in-place route instead.",
        );
    }
    let compiled = compile(&project);
    if compiled.chunks.is_empty() {
        return CliResult::err(
            "This project has no edits, so there is nothing to pack for a lobby.",
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
    envelope(&tweak_pack::pack(&compiled.chunks))
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

/// Trace every edit in a project to what it compiled into (issue #2653): the
/// mutator file, and, where the trace could place it, the numbered BAR slot.
/// Reads nothing off disk and writes nothing, the same as `workshop_compile`
/// it is built over.
#[tauri::command]
fn workshop_change_ledger(project: ModProject) -> CliResult {
    envelope(&ledger::build_ledger(&project))
}

/// What `workshop_settle_typed_values` answers with.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettledResult {
    #[serde(flatten)]
    settled: loads_as::Settled,
    /// How long the whole thing took, loads and all.
    elapsed_ms: u64,
}

/// What the unitsync worker's `--defs-probe` mode prints.
#[derive(serde::Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    runs: Vec<loads_as::ProbeResult>,
    #[serde(default)]
    errors: Vec<String>,
}

/// The unitsync worker's `--defs-probe` mode over the game at `archive`, as
/// `loads_as`'s loader.
fn worker_loader<'a>(
    engine_path: &'a str,
    data_dir: &'a str,
    archive: &'a str,
) -> impl FnMut(&[loads_as::ProbeRun]) -> Result<Vec<loads_as::ProbeResult>, String> + 'a {
    move |runs: &[loads_as::ProbeRun]| {
        let input = serde_json::to_string(&serde_json::json!({ "runs": runs }))
            .map_err(|e| format!("could not write the probe: {e}"))?;
        let out = tauri_plugin_coilbox_unitsync::defs_probe_blocking(
            engine_path,
            data_dir,
            archive,
            &input,
        )?;
        let out: ProbeOutput = serde_json::from_str(&out)
            .map_err(|e| format!("could not read the probe's answer: {e}"))?;
        if out.runs.len() != runs.len() {
            return Err(if out.errors.is_empty() {
                "the game could not be loaded".to_string()
            } else {
                out.errors.join("; ")
            });
        }
        Ok(out.runs)
    }
}

/// Work out, for every number a project typed, a value that the game at
/// `archive` loads as that number on the mutator route, proven by loading the
/// game with the compiled mutator on top (issue #3059). Loads the game at
/// least once whenever the project types a number, so it is asked for before
/// a test or a package rather than on every keystroke.
#[tauri::command]
async fn workshop_settle_typed_values(
    engine_path: String,
    data_dir: String,
    archive: String,
    project: ModProject,
) -> CliResult {
    blocking("settle", move || {
        let start = std::time::Instant::now();
        let mut load = worker_loader(&engine_path, &data_dir, &archive);
        let settled = loads_as::settle(&project, loads_as::Precision::F32, &mut load)?;
        Ok(SettledResult {
            settled,
            elapsed_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
        })
    })
    .await
}

/// [`workshop_settle_typed_values`], for edit in place rather than the
/// mutator route (issue #3093): loads `archive` at `gameDir` with the game's
/// own files patched the way `workshop_write_in_place` would leave them
/// (`inplace::dry_run`), for exactly the fields that route carries, a clone's
/// override left out (its own numbers are settled separately, straight out
/// of its `def`, since they never go through an override at all, issue
/// #3095) and a field sent to the mutator route on purpose left out.
/// `sources` is the same read of game units the write itself takes.
#[tauri::command]
async fn workshop_settle_typed_values_in_place(
    engine_path: String,
    data_dir: String,
    archive: String,
    game_dir: String,
    project: ModProject,
    sources: Option<std::collections::BTreeMap<String, serde_json::Value>>,
) -> CliResult {
    let game = std::path::PathBuf::from(game_dir);
    let sources = sources.unwrap_or_default();
    blocking("settle in place", move || {
        let start = std::time::Instant::now();
        let mut load = worker_loader(&engine_path, &data_dir, &archive);
        let mut compile = |p: &ModProject, w: &loads_as::Written| {
            let patched = if w.is_empty() {
                p.clone()
            } else {
                loads_as::with_written(p, w)
            };
            inplace::dry_run(&game, &patched, &sources).map(loads_as::Overlay::files)
        };
        let carries_field = |unit: &str, field: &str| {
            !project.edits.clones.contains_key(unit) && !project.is_mutator_only(unit, field)
        };
        // A copy this route actually writes: sent to the mutator route on
        // purpose, or otherwise not writable at all (it replaces a game unit,
        // or was built with no source), never reaches the game through edit
        // in place, so neither its equipped weapons nor its own numbers do
        // (`inplace::write_copies`).
        let carries_copy = |unit: &str| {
            project.edits.clones.get(unit).is_some_and(|clone| {
                inplace_clone::writable(clone) && !project.is_clone_mutator_only(unit)
            })
        };
        let carries_equip =
            |unit: &str| !project.edits.clones.contains_key(unit) || carries_copy(unit);
        let settled = loads_as::settle_scoped(
            &project,
            &sources,
            loads_as::Precision::F32,
            &loads_as::RouteScope {
                carries_field: &carries_field,
                carries_equip: &carries_equip,
                carries_clone_field: &carries_copy,
            },
            &mut compile,
            &mut load,
        )?;
        Ok(SettledResult {
            settled,
            elapsed_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
        })
    })
    .await
}

/// [`workshop_settle_typed_values`], for the tweak slot route (issue #3092):
/// loads `archive` with the project handed over as mod options on `route`,
/// the bare `tweakdefs` slot a local launch writes or the numbered slots a
/// lobby gets, and lets the game's own Lua decide what to do with them.
#[tauri::command]
async fn workshop_settle_typed_values_tweaks(
    engine_path: String,
    data_dir: String,
    archive: String,
    project: ModProject,
    route: loads_as::TweakRoute,
) -> CliResult {
    blocking("settle for tweak slots", move || {
        let start = std::time::Instant::now();
        let mut load = worker_loader(&engine_path, &data_dir, &archive);
        let settled = loads_as::settle_tweaks(&project, route, &mut load)?;
        Ok(SettledResult {
            settled,
            elapsed_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
        })
    })
    .await
}

/// Run a blocking in-place operation off the async runtime and wrap its
/// answer. The patcher evaluates each unit file twice, so a project with many
/// changes is too slow to run on the thread that answers the window.
async fn blocking<T, F>(what: &str, job: F) -> CliResult
where
    T: Serialize + Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(job).await {
        Ok(Ok(value)) => envelope(&value),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("{what} task failed: {e}")),
    }
}

/// Patch a project's field changes into the loose `.sdd` game at `gameDir`
/// (issue #2635), and add its copies as unit files of their own (issue
/// #2634). `sources` is the game's own read of each unit a copy was made
/// from, and of each unit with a field change through a list position
/// (issue #3041). Answers with what was written, or with every refusal and
/// nothing written.
///
/// `written` is what `workshop_settle_typed_values_in_place` worked out for
/// this project (issue #3093): values the game's own files turn into the
/// typed ones on this route, each proven by loading the game with exactly
/// these files.
#[tauri::command]
async fn workshop_write_in_place(
    game_dir: String,
    project: ModProject,
    sources: Option<std::collections::BTreeMap<String, serde_json::Value>>,
    written: Option<loads_as::Written>,
) -> CliResult {
    let game = std::path::PathBuf::from(game_dir);
    let sources = sources.unwrap_or_default();
    let project = match written {
        Some(w) if !w.is_empty() => loads_as::with_written(&project, &w),
        _ => project,
    };
    blocking("write", move || inplace::write(&game, &project, &sources)).await
}

/// How many files under `gameDir` hold a workshop backup or created marker,
/// so undo is offered after a restart too.
#[tauri::command]
async fn workshop_in_place_status(game_dir: String) -> CliResult {
    let game = std::path::PathBuf::from(game_dir);
    blocking("status", move || Ok(inplace::status(&game))).await
}

/// Put every file the workshop wrote under `gameDir` back as it was.
#[tauri::command]
async fn workshop_undo_in_place(game_dir: String) -> CliResult {
    let game = std::path::PathBuf::from(game_dir);
    blocking("undo", move || inplace::undo(&game)).await
}

/// Keep every change the workshop wrote under `gameDir`, and delete the
/// backups.
#[tauri::command]
async fn workshop_accept_in_place(game_dir: String) -> CliResult {
    let game = std::path::PathBuf::from(game_dir);
    blocking("accept", move || inplace::accept(&game)).await
}

/// Say which of `fields` of `unit` could be written into the loose `.sdd`
/// game at `gameDir`, writing nothing (issue #2633). Answers with a refusal
/// and the unit file's Lua around it for each field that cannot. `def` is the
/// game's read of the unit, which a field through a list position needs
/// (issue #3041).
#[tauri::command]
async fn workshop_check_in_place(
    game_dir: String,
    unit: String,
    fields: Vec<inplace::FieldProbe>,
    def: Option<serde_json::Value>,
) -> CliResult {
    let game = std::path::PathBuf::from(game_dir);
    blocking("check", move || {
        inplace::check(&game, &unit, &fields, def.as_ref())
    })
    .await
}

/// Say which of a copy's own changes could be written into the loose `.sdd`
/// game at `gameDir`, writing nothing and reading no file (issue #3035). A
/// copy's changes are worked out from values alone (`inplace_clone.rs`), so
/// this needs only the copy, the project's edits to it, and the game's own
/// read of the unit it was copied from, which `writeSources` on the frontend
/// already builds for the write.
#[tauri::command]
async fn workshop_check_clone_in_place(
    game_dir: String,
    clone: crate::model::UnitClone,
    overrides: Option<crate::model::UnitPatch>,
    menu_ops: Option<Vec<crate::model::BuildMenuOp>>,
    source_def: serde_json::Value,
) -> CliResult {
    let game = std::path::PathBuf::from(game_dir);
    blocking("check clone", move || {
        inplace::check_clone(
            &game,
            &clone,
            overrides.as_ref(),
            menu_ops.as_deref(),
            &source_def,
        )
    })
    .await
}

/// A line diff of every file under `gameDir` that carries a workshop backup or
/// created marker, backup against current (issue #2636). A read, and it
/// changes nothing undo or accept would need.
#[tauri::command]
async fn workshop_in_place_diffs(game_dir: String) -> CliResult {
    let game = std::path::PathBuf::from(game_dir);
    blocking("diff", move || diff::disk_diffs(&game)).await
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-workshop")
        .invoke_handler(tauri::generate_handler![
            workshop_compile,
            workshop_preflight,
            workshop_test_mutator,
            workshop_package_mutator,
            workshop_pack_tweak_slots,
            workshop_settle_typed_values_tweaks,
            workshop_decode_tweak_set,
            workshop_change_ledger,
            workshop_write_in_place,
            workshop_in_place_status,
            workshop_undo_in_place,
            workshop_accept_in_place,
            workshop_check_in_place,
            workshop_check_clone_in_place,
            workshop_in_place_diffs,
            workshop_settle_typed_values,
            workshop_settle_typed_values_in_place
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

        let compiled = unwrap_as_the_frontend_does(workshop_compile(project.clone(), None));
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
            None,
        ));
        assert!(written.get("files").is_some_and(Value::is_array));

        let dest = dir.path().join("packaged.sdz");
        let packaged = unwrap_as_the_frontend_does(workshop_package_mutator(
            project.clone(),
            1,
            dest.to_string_lossy().into_owned(),
            None,
        ));
        assert!(packaged.get("files").is_some_and(Value::is_array));
        assert_eq!(packaged["version"], Value::from(1));

        // Cleared for this one call: a custom explosion generator (issue
        // #2643) makes the numbered-slot route refuse outright, checked on
        // its own in `packing_tweak_slots_refuses_a_project_with_an_explosion_generator`.
        let mut project = project;
        project.edits.explosion_generators.clear();
        let tweak_pack = unwrap_as_the_frontend_does(workshop_pack_tweak_slots(project, None));
        assert!(tweak_pack.get("tweakdefs").is_some_and(Value::is_array));

        let mut entries = std::collections::BTreeMap::new();
        entries.insert("pasted".to_string(), "not valid base64 !!!".to_string());
        let decoded = unwrap_as_the_frontend_does(workshop_decode_tweak_set(entries));
        assert!(decoded.get("tweakdefs").is_some_and(Value::is_array));
        assert!(decoded.get("tweakunits").is_some_and(Value::is_array));
        assert!(decoded.get("unrecognised").is_some_and(Value::is_array));

        let ledger = unwrap_as_the_frontend_does(workshop_change_ledger(saved_project()));
        assert!(ledger.get("units").is_some_and(Value::is_array));
    }

    /// A written value reaches the test mutator's files in place of the typed
    /// one, and only while the project still holds that typed value (issue
    /// #3059).
    #[test]
    fn the_test_mutator_writes_what_settling_worked_out() {
        let project: ModProject = serde_json::from_value(serde_json::json!({
            "name": "TEST written (delete me)",
            "gameName": "g",
            "edits": { "overrides": { "armcom": { "maxdamage": 0.5 } } },
        }))
        .expect("parse");
        let written: loads_as::Written = serde_json::from_value(serde_json::json!({
            "units": { "armcom": { "maxdamage": { "typed": 0.5, "written": 5.5 } } }
        }))
        .expect("parse");
        let dir = tempfile::tempdir().expect("temp dir");
        let out = unwrap_as_the_frontend_does(workshop_test_mutator(
            dir.path().to_string_lossy().into_owned(),
            project,
            Some(written),
        ));
        let post = std::path::Path::new(out["dir"].as_str().expect("a dir"))
            .join("gamedata/unitdefs_post.lua");
        let text = std::fs::read_to_string(post).expect("the post file");
        assert!(text.contains("5.5"), "{text}");
        assert!(!text.contains("0.5,"), "{text}");
    }

    /// The in-place commands answer in the same envelope (issue #2635), and a
    /// refusal to write outside a loose game reaches the caller as its own
    /// words.
    #[test]
    fn the_in_place_commands_answer_in_the_envelope() {
        let root = tempfile::tempdir().expect("temp dir");
        let game = root.path().join("games/dev.sdd");
        std::fs::create_dir_all(game.join("units")).expect("game dir");
        std::fs::write(
            game.join("units/armcom.lua"),
            "return { armcom = { metalcost = 1 } }\n",
        )
        .expect("unit file");
        let dir = || game.to_string_lossy().into_owned();
        let project: ModProject = serde_json::from_value(serde_json::json!({
            "name": "In place",
            "gameName": "Dev",
            "edits": { "overrides": { "armcom": { "metalcost": 2 } } },
        }))
        .expect("parse");

        let written = unwrap_as_the_frontend_does(tauri::async_runtime::block_on(
            workshop_write_in_place(dir(), project, None, None),
        ));
        assert_eq!(written["written"], serde_json::json!(["units/armcom.lua"]));
        let status = unwrap_as_the_frontend_does(tauri::async_runtime::block_on(
            workshop_in_place_status(dir()),
        ));
        assert_eq!(status["backups"], Value::from(1));
        let undone = unwrap_as_the_frontend_does(tauri::async_runtime::block_on(
            workshop_undo_in_place(dir()),
        ));
        assert_eq!(undone["restored"], serde_json::json!(["units/armcom.lua"]));
        let accepted = unwrap_as_the_frontend_does(tauri::async_runtime::block_on(
            workshop_accept_in_place(dir()),
        ));
        assert_eq!(accepted["kept"], serde_json::json!([]));
        let checked =
            unwrap_as_the_frontend_does(tauri::async_runtime::block_on(workshop_check_in_place(
                dir(),
                "armcom".into(),
                serde_json::from_value(serde_json::json!([{ "field": "metalcost", "value": 1 }]))
                    .expect("probes"),
                None,
            )));
        assert_eq!(checked["file"], serde_json::json!("units/armcom.lua"));
        assert_eq!(checked["fields"][0]["refusal"], Value::Null);

        let clone: crate::model::UnitClone = serde_json::from_value(serde_json::json!({
            "key": "armcom2",
            "source": "armcom",
            "replacesGameUnit": false,
            "def": { "metalcost": 1 },
        }))
        .expect("clone");
        let clone_checked = unwrap_as_the_frontend_does(tauri::async_runtime::block_on(
            workshop_check_clone_in_place(
                dir(),
                clone,
                None,
                None,
                serde_json::json!({ "metalcost": 1, "maxvelocity": 2 }),
            ),
        ));
        assert_eq!(clone_checked["unwritable"][0]["field"], "maxvelocity");

        let outside = root.path().join("dev.sdd");
        std::fs::create_dir_all(&outside).expect("outside dir");
        let response = serde_json::to_value(tauri::async_runtime::block_on(
            workshop_undo_in_place(outside.to_string_lossy().into_owned()),
        ))
        .expect("the answer serialises");
        assert_eq!(response.get("success"), Some(&Value::Bool(false)));
        assert!(response
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|e| e.contains("games folder")));
    }

    /// A project that changes nothing is what the editor holds for the whole
    /// of the first session, and it is what both of the saved projects on the
    /// machine #2751 was reported from held. Both commands answer it rather
    /// than refusing it: an empty compile and an empty report are answers.
    #[test]
    fn a_project_with_no_edits_is_answered_not_refused() {
        let empty = ModProject::default();

        let compiled = unwrap_as_the_frontend_does(workshop_compile(empty.clone(), None));
        assert_eq!(compiled["files"].as_array().map(Vec::len), Some(0));
        assert_eq!(compiled["tweakdefs"], Value::Null);

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
            None,
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
            None,
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

        let result =
            workshop_package_mutator(project, 1, dest.to_string_lossy().into_owned(), None);
        let response = serde_json::to_value(&result).expect("the answer serialises");

        assert_eq!(response.get("success"), Some(&Value::Bool(false)));
        assert!(response
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|e| e.contains("blocker") && e.contains("supercom")));
        assert!(!dest.exists(), "nothing should have been written");
    }

    /// The same empty-project refusal, for the tweak-slot route (issue
    /// #1277). Nothing to compile means nothing to pack.
    #[test]
    fn packing_tweak_slots_for_an_empty_project_is_refused_with_its_own_reason() {
        let response = serde_json::to_value(workshop_pack_tweak_slots(ModProject::default(), None))
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
    fn packing_tweak_slots_is_refused_when_preflight_finds_a_blocker() {
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

        let response = serde_json::to_value(workshop_pack_tweak_slots(project, None))
            .expect("the answer serialises");

        assert_eq!(response.get("success"), Some(&Value::Bool(false)));
        assert!(response
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|e| e.contains("blocker") && e.contains("supercom")));
    }

    /// A patch against a unit's second weapon and not its first (issue
    /// #2964). Refused at the command boundary, so the whole project could
    /// not reach a lobby over one indexed path, although the Lua was correct
    /// and the compiler was right to write it that way. A change through a
    /// list position is a block since issue #3041, so it packs as `tweakdefs`.
    #[test]
    fn a_project_patching_one_weapon_of_several_packs() {
        let project: ModProject = serde_json::from_value(serde_json::json!({
            "name": "Second weapon only",
            "gameName": "Balanced Annihilation V15.9.8",
            "edits": { "overrides": { "armcom": { "weapons.1.name": "CANNON" } } },
        }))
        .expect("parse");

        let pack = unwrap_as_the_frontend_does(workshop_pack_tweak_slots(project, None));
        let tweakdefs = pack["tweakdefs"].as_array().expect("tweakdefs array");
        assert_eq!(tweakdefs.len(), 1);
    }

    /// The saved fixture carries both a table-form edit (an override) and
    /// several block-form ones (a copy, a menu, a disabled unit), so packing
    /// it is a real check that both forms reach a `tweakdefs` slot and none
    /// is left for `tweakunits` (issue #3126). It also carries a
    /// custom explosion generator (issue #2643), which the numbered-slot
    /// route cannot deliver, so that store is cleared here and checked on
    /// its own in the refusal test below.
    #[test]
    fn packing_tweak_slots_for_the_saved_project_puts_both_forms_in_tweakdefs() {
        let mut project = saved_project();
        project.edits.explosion_generators.clear();
        let pack = unwrap_as_the_frontend_does(workshop_pack_tweak_slots(project, None));

        let tweakdefs = pack["tweakdefs"].as_array().expect("tweakdefs array");
        assert!(!tweakdefs.is_empty(), "the saved project has edits");
        assert!(pack.get("tweakunits").is_none());
        assert!(pack["oversized"].as_array().is_some_and(Vec::is_empty));
        assert!(pack["unplaced"].as_array().is_some_and(Vec::is_empty));
    }

    /// The engine only ever loads a CEG from a real file under `effects/`
    /// (`ExplosionGenerator.cpp:208`), which a numbered tweak slot has no way
    /// to carry, so the saved project (which has one, unmodified) is refused
    /// outright rather than packed with a broken reference (issue #2643).
    #[test]
    fn packing_tweak_slots_refuses_a_project_with_an_explosion_generator() {
        let project = saved_project();
        let result = workshop_pack_tweak_slots(project, None);
        let response = serde_json::to_value(&result).expect("the answer serialises");
        assert_eq!(response.get("success"), Some(&Value::Bool(false)));
        assert!(response["error"]
            .as_str()
            .expect("error string")
            .contains("explosion effect"));
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
        // Beside `edits`, and read by the in-place write (issue #2633).
        assert!(project.is_mutator_only("armcom", "weapondefs.disintegrator.range"));
        assert!(!project.is_mutator_only("armcom", "maxDamage"));

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

        // The weapon library and the slot that fires from it (issue #2640).
        let weapon = &edits.weapons["heavylaser"];
        assert_eq!(weapon.key, "heavylaser");
        assert_eq!(weapon.source.as_deref(), Some("armcom_disintegrator"));
        assert_eq!(weapon.source_checksum.as_deref(), Some("c6a15f1f"));
        assert_eq!(weapon.changes["range"], serde_json::json!(450));
        assert_eq!(edits.equipped["armcom"]["0"], "heavylaser");

        // A unit moved to a different armour class, and the snapshot the
        // compiler needs to write the whole file back (issue #2645).
        assert_eq!(edits.armor_classes.moves["armflash"], "heavyunits");
        assert_eq!(
            edits.armor_classes.base["commanders"],
            vec!["armcom", "corcom"]
        );

        // A custom explosion generator: two spawns and a ground flash
        // together (issues #2643 and #3066).
        let generator = &edits.explosion_generators["purpleflash"];
        assert_eq!(generator.spawns.len(), 2);
        assert_eq!(
            generator.spawns[0].class,
            crate::model::SpawnClass::CBitmapMuzzleFlame
        );
        assert_eq!(generator.spawns[0].texture.as_deref(), Some("flare.tga"));
        assert_eq!(generator.spawns[0].size, Some(8.0));
        assert_eq!(
            generator.spawns[1].class,
            crate::model::SpawnClass::CSimpleParticleSystem
        );
        assert_eq!(generator.spawns[1].particles, Some(12));
        assert!(generator.ground_flash.is_some());
        assert!(generator.use_default_explosions);
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
