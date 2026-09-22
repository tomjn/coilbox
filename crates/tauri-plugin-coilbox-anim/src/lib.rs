//! animation plugin (Rust half). A from-scratch Rust port of
//! `beyond-all-reason/BARScriptCompiler`: BOS↔COB tooling for Spring/Recoil unit
//! animation scripts. ACL identifier: `coilbox-anim`. See `PORTING.md` for the
//! byte-exact porting spec and golden-test harness.
//!
//! Implemented: `anim_cob_disasm` (disassemble a `.cob`), `anim_bos2cob`
//! (compile a `.bos` to `.cob`, byte-exact vs the Python reference), `anim_cob_run`
//! (play a `.cob`) and `anim_bos2lua` (convert a `.bos` to a Lua unit script,
//! through `coilbox-bos2lua`). See PORTING.md for the porting spec and
//! golden-test harness.

#[cfg(test)]
mod bos2lua_parity;
mod bos_disk;
mod cob;
mod cobrun;
mod compiler;
mod disasm;
mod fold;
mod grammar;
mod opcodes;
mod parser;
mod preprocess;
mod tokenizer;

use picoframe_core::CliResult;
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Compile BOS source to COB bytes: `preprocess -> parse -> fold -> codegen`.
/// `include_dir` resolves `#include` targets. Mirrors the reference pipeline
/// (preprocess, constant folding on, COB version 4).
///
/// Runs on a dedicated large-stack thread so deeply-nested input can't overflow
/// (and abort the process), and catches any unexpected internal panic so even a
/// malformed script surfaces as an error rather than crashing the caller.
pub fn compile_bos(source: &str, include_dir: &Path) -> Result<Vec<u8>, String> {
    compile_bos_with_warnings(source, include_dir).map(|(bytes, _)| bytes)
}

/// Same as [`compile_bos`], plus any warnings gathered along the way (for
/// instance, a bare assignment sitting outside any function).
pub fn compile_bos_with_warnings(
    source: &str,
    include_dir: &Path,
) -> Result<(Vec<u8>, Vec<String>), String> {
    let source = source.to_string();
    let include_dir = include_dir.to_path_buf();
    std::thread::Builder::new()
        .name("bos2cob".into())
        .stack_size(64 * 1024 * 1024)
        .spawn(move || {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                compile_inner(&source, &include_dir)
            }))
            .unwrap_or_else(|p| {
                Err(format!(
                    "internal compiler error: {}",
                    panic_message(p.as_ref())
                ))
            })
        })
        .map_err(|e| format!("could not start compiler thread: {e}"))?
        .join()
        .map_err(|_| "compiler thread panicked".to_string())?
}

fn compile_inner(source: &str, include_dir: &Path) -> Result<(Vec<u8>, Vec<String>), String> {
    let tokens = preprocess::preprocess(source, include_dir)?;
    let mut root = parser::parse_file(tokens)?;
    let warnings = parser::stray_warnings(&root);
    fold::fold_tree(&mut root);
    let bytes = compiler::Compiler::compile(&root, 4)?;
    Ok((bytes, warnings))
}

/// Best-effort message from a caught panic payload.
fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic".to_string()
    }
}

/// `anim_cob_disasm` — read a `.cob` and return a human-readable disassembly
/// listing (scripts, pieces, opcode + operand stream). Not recompilable BOS.
#[tauri::command]
async fn anim_cob_disasm(path: String) -> CliResult {
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let bytes = std::fs::read(&path).map_err(|e| format!("could not read {path}: {e}"))?;
        disasm::disassemble(&bytes)
    })
    .await;
    match result {
        Ok(Ok(listing)) => CliResult::ok(json!({ "listing": listing })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("disasm task failed: {e}")),
    }
}

/// `anim_cob_disasm_bytes`: the same disassembly for a `.cob` that is not a
/// file on disk.
///
/// A unit script read out of a game archive is bytes in memory, and the archive
/// is somebody else's game. Writing them to a temporary file to hand back a
/// path would mean making a copy of a file coilbox has no business copying, so
/// this takes the bytes straight.
///
/// Read only in the strongest sense. Nothing is opened, nothing is written, and
/// the `.cob` inside the archive is never touched.
#[tauri::command]
async fn anim_cob_disasm_bytes(bytes: Vec<u8>) -> CliResult {
    let result = tauri::async_runtime::spawn_blocking(move || disasm::disassemble(&bytes)).await;
    match result {
        Ok(Ok(listing)) => CliResult::ok(json!({ "listing": listing })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("disasm task failed: {e}")),
    }
}

/// `anim_bos2cob` — compile a `.bos` file to `.cob`, written next to the source
/// (`<basename>.cob`) unless `output` is given. If the output already exists and
/// `overwrite` is not set, it compiles but does NOT write, returning
/// `needsOverwrite: true` so the UI can ask before clobbering. Otherwise returns
/// the output path and byte count with `needsOverwrite: false`.
/// `anim_cob_run`: play a `.cob` and report where its pieces are on each frame.
///
/// The disassembly above makes a compiled script legible. This makes it move,
/// which is the thing somebody opening a unit out of an older game actually
/// wanted. `pieces` is the model's own piece names, and the timeline that comes
/// back is the same one the Lua unit script runtime produces, so the viewport
/// plays both the same way.
///
/// Read only, like the disassembly and for the same reason: bytes in, poses
/// out, and the `.cob` inside somebody's game archive is never touched.
///
/// A script that will not decode or that loops without sleeping is not an
/// error. It comes back as a timeline carrying the reason.
#[tauri::command]
async fn anim_cob_run(
    bytes: Vec<u8>,
    pieces: Vec<String>,
    events: Vec<coilbox_unitpose::ScriptEvent>,
    frames: u32,
    rest: Option<Vec<coilbox_unitpose::Rest>>,
) -> CliResult {
    let rest = rest.unwrap_or_default();
    let result = tauri::async_runtime::spawn_blocking(move || {
        cobrun::run(&bytes, &pieces, &events, frames, &rest)
    })
    .await;
    match result {
        Ok(timeline) => match serde_json::to_value(&timeline) {
            Ok(value) => CliResult::ok(value),
            Err(e) => CliResult::err(format!("could not report the run: {e}")),
        },
        Err(e) => CliResult::err(format!("the run failed to start: {e}")),
    }
}

/// `anim_bos2lua`: a `.bos` as a Lua unit script that runs as it is.
///
/// `includes` is the files it may `#include`, by path, and `pieces` the model's
/// piece names, so the Lua asks for each piece by the model's own spelling.
/// `cob` is the compiled script beside the source when there is one, which
/// settles how long `[1]` is: Scriptor, which built the older games, made it two
/// and a half elmos, and today's compilers make it one.
///
/// `path` is where the source was loaded from, when it was a file. Then the
/// headers it includes are read from its game folder, exactly as the game
/// import reads them from the archive, the script is named by its path in that
/// folder rather than `name`, and the `.cob` beside it is read when `cob` is not
/// given. Otherwise nothing is read, and nothing is ever written.
///
/// What nothing uses is left out unless `prune` is false, which the converter
/// page sends to compare the two.
#[tauri::command]
async fn anim_bos2lua(
    source: String,
    name: String,
    includes: Option<HashMap<String, String>>,
    pieces: Option<Vec<String>>,
    cob: Option<Vec<u8>>,
    path: Option<String>,
    prune: Option<bool>,
) -> CliResult {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut includes = includes.unwrap_or_default();
        let mut name = name;
        let mut cob = cob;
        if let Some(path) = path.as_deref().map(Path::new) {
            let (root, in_game) = bos_disk::locate(path);
            for (key, text) in bos_disk::includes(&source, &root, &in_game) {
                includes.entry(key).or_insert(text);
            }
            name = in_game;
            if cob.is_none() {
                cob = bos_disk::cob_beside(path);
            }
        }
        let linear_scale = cob
            .as_deref()
            .and_then(|cob| coilbox_bos2lua::linear_scale(&source, cob))
            .unwrap_or(coilbox_bos2lua::MODERN_LINEAR);
        let precedence = cob
            .as_deref()
            .and_then(|cob| coilbox_bos2lua::precedence(&source, cob))
            .unwrap_or_default();
        coilbox_bos2lua::convert(
            &source,
            &coilbox_bos2lua::Options {
                name: &name,
                includes: &includes,
                pieces: pieces.as_deref(),
                linear_scale,
                precedence,
                prune: prune.unwrap_or(true),
            },
        )
        .map(|conversion| (conversion, linear_scale))
    })
    .await;
    match result {
        Ok(Ok((conversion, linear_scale))) => CliResult::ok(json!({
            "lua": conversion.lua,
            "warnings": conversion.warnings.iter().map(|w| json!({
                "file": w.file,
                "line": w.line,
                "message": w.message,
                "main": w.main,
            })).collect::<Vec<_>>(),
            "linearScale": linear_scale,
            "cobVars": conversion
                .shared_values
                .then_some(coilbox_bos2lua::COB_VARS_POLYFILL),
            "missingIncludes": conversion.missing_includes,
        })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("conversion task failed: {e}")),
    }
}

/// `anim_bos_lint`: the diagnostics a BOS lint pass finds in `source`.
///
/// Same inputs as `anim_bos2lua`, minus `prune`, which no rule cares about.
/// `path`, when given, reads the script's includes from disk exactly as
/// `anim_bos2lua` does, and still settles the linear scale and precedence
/// from the `.cob` beside it when `cob` is not given.
///
/// A script that fails to parse comes back `{ diagnostics: [], error }`
/// rather than a thrown error, so the UI can show the parse failure next to
/// whatever partial source is on screen instead of losing it to a toast.
#[tauri::command]
async fn anim_bos_lint(
    source: String,
    name: String,
    includes: Option<HashMap<String, String>>,
    pieces: Option<Vec<String>>,
    cob: Option<Vec<u8>>,
    path: Option<String>,
) -> CliResult {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut includes = includes.unwrap_or_default();
        let mut name = name;
        let mut cob = cob;
        if let Some(path) = path.as_deref().map(Path::new) {
            let (root, in_game) = bos_disk::locate(path);
            for (key, text) in bos_disk::includes(&source, &root, &in_game) {
                includes.entry(key).or_insert(text);
            }
            name = in_game;
            if cob.is_none() {
                cob = bos_disk::cob_beside(path);
            }
        }
        let linear_scale = cob
            .as_deref()
            .and_then(|cob| coilbox_bos2lua::linear_scale(&source, cob))
            .unwrap_or(coilbox_bos2lua::MODERN_LINEAR);
        let precedence = cob
            .as_deref()
            .and_then(|cob| coilbox_bos2lua::precedence(&source, cob))
            .unwrap_or_default();
        coilbox_bos2lua::lint(
            &source,
            &coilbox_bos2lua::LintOptions {
                name: &name,
                includes: &includes,
                pieces: pieces.as_deref(),
                linear_scale,
                precedence,
            },
        )
    })
    .await;
    match result {
        Ok(Ok(diagnostics)) => CliResult::ok(json!({
            "diagnostics": diagnostics.iter().map(|d| json!({
                "rule": d.rule,
                "severity": d.severity.as_str(),
                "line": d.line,
                "message": d.message,
            })).collect::<Vec<_>>(),
        })),
        Ok(Err(e)) => CliResult::ok(json!({ "diagnostics": [], "error": e })),
        Err(e) => CliResult::err(format!("lint task failed: {e}")),
    }
}

/// `anim_bos_read`: the text of a `.bos` on disk, for the converter page to
/// show and edit.
#[tauri::command]
async fn anim_bos_read(path: String) -> CliResult {
    let result =
        tauri::async_runtime::spawn_blocking(move || bos_disk::read_text(Path::new(&path))).await;
    match result {
        Ok(Ok(source)) => CliResult::ok(json!({ "source": source })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("read task failed: {e}")),
    }
}

#[tauri::command]
async fn anim_bos2cob(path: String, output: Option<String>, overwrite: Option<bool>) -> CliResult {
    let overwrite = overwrite.unwrap_or(false);
    let result = tauri::async_runtime::spawn_blocking(
        move || -> Result<(String, usize, bool, Vec<String>), String> {
            let source = std::fs::read_to_string(&path)
                .map_err(|e| format!("could not read {path}: {e}"))?;
            let src_path = Path::new(&path);
            let include_dir = src_path.parent().unwrap_or_else(|| Path::new("."));
            // Compile first so compile errors surface regardless of the output state.
            let (bytes, warnings) = compile_bos_with_warnings(&source, include_dir)?;
            let out_path = output.unwrap_or_else(|| {
                src_path
                    .with_extension("cob")
                    .to_string_lossy()
                    .into_owned()
            });
            if Path::new(&out_path).exists() && !overwrite {
                return Ok((out_path, bytes.len(), true, warnings)); // ask before overwriting
            }
            std::fs::write(&out_path, &bytes)
                .map_err(|e| format!("could not write {out_path}: {e}"))?;
            Ok((out_path, bytes.len(), false, warnings))
        },
    )
    .await;
    match result {
        Ok(Ok((out_path, len, needs_overwrite, warnings))) => CliResult::ok(json!({
            "output": out_path,
            "bytes": len,
            "needsOverwrite": needs_overwrite,
            "warnings": warnings,
        })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("compile task failed: {e}")),
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-anim")
        .invoke_handler(tauri::generate_handler![
            anim_cob_disasm,
            anim_cob_disasm_bytes,
            anim_cob_run,
            anim_bos2cob,
            anim_bos2lua,
            anim_bos_lint,
            anim_bos_read
        ])
        .build()
}
