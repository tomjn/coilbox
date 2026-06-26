//! animation plugin (Rust half). A from-scratch Rust port of
//! `beyond-all-reason/BARScriptCompiler`: BOS↔COB tooling for Spring/Recoil unit
//! animation scripts. ACL identifier: `coilbox-anim`. See `PORTING.md` for the
//! byte-exact porting spec and golden-test harness.
//!
//! Implemented: `anim_cob_disasm` (disassemble a `.cob`) and `anim_bos2cob`
//! (compile a `.bos` to `.cob`, byte-exact vs the Python reference's `--nopcpp`
//! mode). See PORTING.md for the porting spec and golden-test harness.

mod cob;
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
use std::path::Path;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Compile BOS source to COB bytes: `preprocess -> parse -> fold -> codegen`.
/// `include_dir` resolves `#include` targets. Mirrors the reference `--nopcpp`
/// pipeline (builtin preprocessor, constant folding on, COB version 4).
///
/// Runs on a dedicated large-stack thread so deeply-nested input can't overflow
/// (and abort the process), and catches any unexpected internal panic so even a
/// malformed script surfaces as an error rather than crashing the caller.
pub fn compile_bos(source: &str, include_dir: &Path) -> Result<Vec<u8>, String> {
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
                Err(format!("internal compiler error: {}", panic_message(p.as_ref())))
            })
        })
        .map_err(|e| format!("could not start compiler thread: {e}"))?
        .join()
        .map_err(|_| "compiler thread panicked".to_string())?
}

fn compile_inner(source: &str, include_dir: &Path) -> Result<Vec<u8>, String> {
    let tokens = preprocess::preprocess(source, include_dir)?;
    let mut root = parser::parse_file(tokens)?;
    fold::fold_tree(&mut root);
    compiler::Compiler::compile(&root, 4)
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

/// `anim_bos2cob` — compile a `.bos` file to `.cob`, written next to the source
/// (`<basename>.cob`) unless `output` is given. If the output already exists and
/// `overwrite` is not set, it compiles but does NOT write, returning
/// `needsOverwrite: true` so the UI can ask before clobbering. Otherwise returns
/// the output path and byte count with `needsOverwrite: false`.
#[tauri::command]
async fn anim_bos2cob(path: String, output: Option<String>, overwrite: Option<bool>) -> CliResult {
    let overwrite = overwrite.unwrap_or(false);
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(String, usize, bool), String> {
        let source = std::fs::read_to_string(&path)
            .map_err(|e| format!("could not read {path}: {e}"))?;
        let src_path = Path::new(&path);
        let include_dir = src_path.parent().unwrap_or_else(|| Path::new("."));
        // Compile first so compile errors surface regardless of the output state.
        let bytes = compile_bos(&source, include_dir)?;
        let out_path = output.unwrap_or_else(|| {
            src_path.with_extension("cob").to_string_lossy().into_owned()
        });
        if Path::new(&out_path).exists() && !overwrite {
            return Ok((out_path, bytes.len(), true)); // ask before overwriting
        }
        std::fs::write(&out_path, &bytes)
            .map_err(|e| format!("could not write {out_path}: {e}"))?;
        Ok((out_path, bytes.len(), false))
    })
    .await;
    match result {
        Ok(Ok((out_path, len, needs_overwrite))) => CliResult::ok(json!({
            "output": out_path,
            "bytes": len,
            "needsOverwrite": needs_overwrite,
        })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("compile task failed: {e}")),
    }
}

/// `anim_reveal` — reveal a file in the OS file manager (selecting it where the
/// platform supports it), so the user can get at the compiled `.cob` or the
/// `.cob` they disassembled.
#[tauri::command]
async fn anim_reveal(path: String) -> CliResult {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return CliResult::err(format!("path does not exist: {path}"));
    }
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg("-R").arg(&p).spawn();
    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("explorer")
        .arg(format!("/select,{}", p.display()))
        .spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = {
        // xdg-open has no "select"; open the containing folder instead.
        let dir = p.parent().unwrap_or_else(|| std::path::Path::new("."));
        std::process::Command::new("xdg-open").arg(dir).spawn()
    };

    match spawned {
        Ok(_) => CliResult::ok(json!({ "revealed": true })),
        Err(e) => CliResult::err(format!("could not reveal path: {e}")),
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-anim")
        .invoke_handler(tauri::generate_handler![
            anim_cob_disasm,
            anim_bos2cob,
            anim_reveal
        ])
        .build()
}
