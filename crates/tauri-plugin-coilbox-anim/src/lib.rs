//! animation plugin (Rust half). A from-scratch Rust port of
//! `beyond-all-reason/BARScriptCompiler`: BOS↔COB tooling for Spring/Recoil unit
//! animation scripts. ACL identifier: `coilbox-anim`. See `PORTING.md` for the
//! byte-exact porting spec and golden-test harness.
//!
//! Implemented: `anim_cob_disasm` (disassemble a `.cob`), `anim_cob_decompile`
//! (rebuild recompilable BOS from a `.cob`), `anim_bos2cob`
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
mod decompile;
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
    on_large_stack("bos2cob", move || compile_inner(&source, &include_dir))
}

pub use decompile::Decompiled;

/// Rebuild BOS source from COB bytes, written so that [`compile_bos`] turns it
/// back into the same bytes. A script BOS cannot express is left as a comment
/// that fails to compile, and named in `warnings`.
///
/// On the same large-stack thread as the compiler, since each nested block in
/// the script is one level of recursion.
pub fn decompile_cob(bytes: &[u8]) -> Result<Decompiled, String> {
    let bytes = bytes.to_vec();
    on_large_stack("cob2bos", move || decompile::decompile(&bytes))
}

/// Run `work` on a dedicated large-stack thread so deeply nested input cannot
/// overflow and abort the process, turning any internal panic into an error.
fn on_large_stack<T: Send + 'static>(
    name: &str,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    std::thread::Builder::new()
        .name(name.into())
        .stack_size(64 * 1024 * 1024)
        .spawn(move || {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)).unwrap_or_else(|p| {
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
    let mut warnings = parser::stray_warnings(&root);
    fold::fold_tree(&mut root);
    let (bytes, codegen_warnings) = compiler::Compiler::compile(&root, 4)?;
    // One line per warning, however many statements raised it.
    for warning in codegen_warnings {
        if !warnings.contains(&warning) {
            warnings.push(warning);
        }
    }
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
    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<disasm::Disassembly, String> {
            let bytes = std::fs::read(&path).map_err(|e| format!("could not read {path}: {e}"))?;
            disasm::disassemble(&bytes)
        })
        .await;
    match result {
        Ok(Ok(result)) => {
            CliResult::ok(json!({ "listing": result.text, "lineOffsets": result.line_offsets }))
        }
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
        Ok(Ok(result)) => {
            CliResult::ok(json!({ "listing": result.text, "lineOffsets": result.line_offsets }))
        }
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("disasm task failed: {e}")),
    }
}

/// `anim_cob_decompile`: rebuild BOS source from a `.cob`, which `anim_bos2cob`
/// compiles back into the same bytes. Writes it to `output` as well when given,
/// which must be a `.bos`.
#[tauri::command]
async fn anim_cob_decompile(path: String, output: Option<String>) -> CliResult {
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Decompiled, String> {
        if let Some(output) = &output {
            if !output.to_lowercase().ends_with(".bos") {
                return Err(format!("{output} is not a .bos file"));
            }
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("could not read {path}: {e}"))?;
        let decompiled = decompile_cob(&bytes)?;
        if let Some(output) = &output {
            std::fs::write(output, &decompiled.source)
                .map_err(|e| format!("could not write {output}: {e}"))?;
        }
        Ok(decompiled)
    })
    .await;
    match result {
        Ok(Ok(d)) => CliResult::ok(json!({ "source": d.source, "warnings": d.warnings })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("decompile task failed: {e}")),
    }
}

/// `anim_cob_decompile_bytes`: the same rebuild for a `.cob` that is not a file
/// on disk, and never written back.
///
/// The builder shows a game's compiled script as BOS, and that script comes out
/// of somebody else's archive as bytes in memory. There is no `output` here for
/// the same reason `anim_cob_disasm_bytes` has no path: nothing about reading
/// an archive's script should put a file anywhere.
#[tauri::command]
async fn anim_cob_decompile_bytes(bytes: Vec<u8>) -> CliResult {
    let result = tauri::async_runtime::spawn_blocking(move || decompile_cob(&bytes)).await;
    match result {
        Ok(Ok(d)) => CliResult::ok(json!({ "source": d.source, "warnings": d.warnings })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("decompile task failed: {e}")),
    }
}

/// `anim_cob_hex`: the bytes of a `.cob` as a hex dump, for reading the file
/// itself rather than the scripts in it.
#[tauri::command]
async fn anim_cob_hex(path: String) -> CliResult {
    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<(String, usize), String> {
            let bytes = std::fs::read(&path).map_err(|e| format!("could not read {path}: {e}"))?;
            Ok((hex_dump(&bytes), bytes.len()))
        })
        .await;
    match result {
        Ok(Ok((dump, len))) => CliResult::ok(json!({ "dump": dump, "bytes": len })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("hex dump task failed: {e}")),
    }
}

/// Sixteen bytes a line: offset, the bytes, then the printable ones.
fn hex_dump(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 5);
    for (row, chunk) in bytes.chunks(16).enumerate() {
        let _ = write!(out, "{:08x} ", row * 16);
        for (i, b) in chunk.iter().enumerate() {
            let _ = write!(out, "{}{b:02x}", if i == 8 { "  " } else { " " });
        }
        let padding = (16 - chunk.len()) * 3 + usize::from(chunk.len() <= 8);
        let text: String = chunk
            .iter()
            .map(|b| {
                if b.is_ascii_graphic() || *b == b' ' {
                    *b as char
                } else {
                    '.'
                }
            })
            .collect();
        let _ = writeln!(out, "{:padding$}  |{text}|", "");
    }
    out
}

#[cfg(test)]
mod hex_tests {
    #[test]
    fn dumps_sixteen_bytes_a_line() {
        let bytes: Vec<u8> = (0u8..=20).collect();
        let dump = super::hex_dump(&bytes);
        let lines: Vec<&str> = dump.lines().collect();
        assert_eq!(
            lines[0],
            "00000000  00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f  |................|"
        );
        assert!(
            lines[1].starts_with("00000010  10 11 12 13 14  "),
            "{}",
            lines[1]
        );
        assert!(lines[1].ends_with("|.....|"), "{}", lines[1]);
        // A short last line keeps the text column where the full lines put it.
        assert_eq!(
            lines[0].find('|'),
            lines[1].find('|'),
            "{}\n{}",
            lines[0],
            lines[1]
        );
        let text = super::hex_dump(b"Create\0AB");
        assert!(text.ends_with("|Create.AB|\n"), "{text}");
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
    values: Option<HashMap<i32, i32>>,
) -> CliResult {
    let rest = rest.unwrap_or_default();
    let values = values.unwrap_or_default();
    let result = tauri::async_runtime::spawn_blocking(move || {
        cobrun::run(&bytes, &pieces, &events, frames, &rest, &values)
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
            anim_cob_decompile,
            anim_cob_decompile_bytes,
            anim_cob_hex,
            anim_cob_run,
            anim_bos2cob,
            anim_bos2lua,
            anim_bos_lint,
            anim_bos_read
        ])
        .build()
}
