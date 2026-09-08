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

mod compile;
mod lua;
mod model;
mod mutator;
mod preflight;

pub use compile::{compile, Chunk, CompiledFile, CompiledMod, LuaForm};
pub use model::{GameEdits, ModProject};
pub use preflight::{preflight, PreflightReport};

use serde::Serialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Compile a saved project into the Lua a game reads.
#[tauri::command]
fn workshop_compile(project: ModProject) -> CompiledMod {
    compile(&project)
}

/// Compile a saved project and check the result before it ever leaves the
/// app (issue #1276).
#[tauri::command]
fn workshop_preflight(project: ModProject) -> PreflightReport {
    let compiled = compile(&project);
    preflight(&project, &compiled)
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
fn workshop_test_mutator(
    data_dir: String,
    project: ModProject,
) -> Result<TestMutatorResult, String> {
    let compiled = compile(&project);
    if compiled.files.is_empty() {
        return Err(
            "This project has no edits a mutator archive can carry, so there is nothing to test."
                .to_string(),
        );
    }
    let dir = mutator::mutator_dir(&data_dir)?;
    mutator::write_mutator(&dir, &compiled.files)?;
    Ok(TestMutatorResult {
        dir: dir.to_string_lossy().into_owned(),
        folder: mutator::FOLDER,
        files: compiled.files.into_iter().map(|f| f.path).collect(),
    })
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-workshop")
        .invoke_handler(tauri::generate_handler![
            workshop_compile,
            workshop_preflight,
            workshop_test_mutator
        ])
        .build()
}
