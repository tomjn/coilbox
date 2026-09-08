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
//! `workshop_preflight` (issue #1276) is the other command this plugin
//! exposes. It compiles the same way, then checks the result before it ever
//! leaves the app: syntax through `coilbox-springlua`, plus the cheap static
//! checks `preflight` documents.

mod compile;
mod lua;
mod model;
mod preflight;

pub use compile::{compile, Chunk, CompiledFile, CompiledMod, LuaForm};
pub use model::{GameEdits, ModProject};
pub use preflight::{preflight, PreflightReport};

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

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-workshop")
        .invoke_handler(tauri::generate_handler![
            workshop_compile,
            workshop_preflight
        ])
        .build()
}
