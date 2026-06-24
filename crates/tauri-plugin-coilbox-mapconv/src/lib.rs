//! mapconv plugin (Rust half). Shells out to the bundled SpringMapConvNG
//! sidecars — `mapcompile` (build a `.smf`/`.smt` from source images) and
//! `mapdecompile` (extract source images from a `.smf`) — streaming the live log
//! over a Tauri [`Channel`]. Results are returned as a [`CliResult`] envelope,
//! matching every other picoframe plugin.

mod settings;
mod sidecar;

use picoframe_core::CliResult;
use serde_json::json;
use settings::{load_settings, save_settings, Settings};
use sidecar::{build_compile_args, build_decompile_args, match_sources, resolve_sidecar, CompileOpts, DecompileOpts, LogLine};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime, State,
};

/// Running children keyed by frontend-supplied run id, so `mc_cancel` can kill a
/// run in flight. A run removes its own entry when it finishes reaping.
type SharedRegistry = Arc<Mutex<HashMap<String, Child>>>;

/// Human-readable "sidecar missing" message naming the dev env override.
fn missing(name: &str) -> String {
    format!(
        "{name} sidecar not found. Bundle it via tauri.conf.json `externalBin` or set MAPCONV_{}_SIDECAR.",
        name.to_uppercase()
    )
}

/// The plugin's settings-file path under app-data.
fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?
        .join("mapconv");
    Ok(base.join("settings.json"))
}

/// Read one pipe line-by-line, forwarding each line to the frontend channel.
fn stream_pipe<Rd: std::io::Read>(rd: Rd, stream: &str, log: Channel<LogLine>) {
    use std::io::BufRead;
    for line in std::io::BufReader::new(rd).lines() {
        match line {
            Ok(l) => {
                let _ = log.send(LogLine { stream: stream.into(), line: l });
            }
            Err(_) => break,
        }
    }
}

/// Synchronous run body (called on a blocking thread). Spawns a sidecar in
/// `cwd` (if given), streams stdout/stderr to `on_log`, then reaps it. Returns
/// the exit status, or an error if the run was cancelled mid-flight.
fn run_blocking(
    bin: PathBuf,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    run_id: String,
    reg: SharedRegistry,
    on_log: Channel<LogLine>,
) -> Result<std::process::ExitStatus, String> {
    let mut cmd = Command::new(&bin);
    cmd.args(&args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(d) = &cwd {
        cmd.current_dir(d);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start {}: {e}", bin.display()))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    reg.lock().unwrap().insert(run_id.clone(), child);

    let out_log = on_log.clone();
    let out_handle = stdout.map(|s| std::thread::spawn(move || stream_pipe(s, "out", out_log)));
    let err_handle = stderr.map(|s| std::thread::spawn(move || stream_pipe(s, "err", on_log)));
    if let Some(h) = out_handle {
        let _ = h.join();
    }
    if let Some(h) = err_handle {
        let _ = h.join();
    }

    // Reap. If the entry is gone, mc_cancel killed it.
    match reg.lock().unwrap().remove(&run_id) {
        Some(mut c) => c.wait().map_err(|e| e.to_string()),
        None => Err("run was cancelled".into()),
    }
}

/// `mc_probe` — report which sidecars are bundled, without spawning anything
/// (these getopt binaries have no clean `--version`). Lets the UI warn up front.
#[tauri::command]
async fn mc_probe() -> CliResult {
    let compile = resolve_sidecar("mapcompile").is_some();
    let decompile = resolve_sidecar("mapdecompile").is_some();
    CliResult::ok(json!({ "available": compile && decompile, "compile": compile, "decompile": decompile }))
}

/// `mc_suggest_sources` — given a chosen main texture, scan its folder for
/// conventional sibling source files (heightmap.png, metalmap.png, …) and return
/// the matches as absolute paths so the UI can prefill empty fields.
#[tauri::command]
async fn mc_suggest_sources(texture_path: String) -> CliResult {
    let p = PathBuf::from(&texture_path);
    let dir = match p.parent() {
        Some(d) => d.to_path_buf(),
        None => return CliResult::ok(json!({})),
    };
    let mut files = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            if let Some(name) = e.file_name().to_str() {
                files.push(name.to_string());
            }
        }
    }
    let s = match_sources(&files);
    let abs = |o: Option<String>| o.map(|f| dir.join(f).to_string_lossy().to_string());
    CliResult::ok(json!({
        "heightmap": abs(s.heightmap),
        "metalmap": abs(s.metalmap),
        "typemap": abs(s.typemap),
        "minimap": abs(s.minimap),
        "vegmap": abs(s.vegmap),
        "features": abs(s.features),
    }))
}

/// `mc_compile` — run `mapcompile` in `out_dir`, streaming output. Success means
/// exit 0 AND `<out_dir>/<outSuffix>.smf` exists.
#[tauri::command]
async fn mc_compile(
    reg: State<'_, SharedRegistry>,
    opts: CompileOpts,
    out_dir: String,
    run_id: String,
    on_log: Channel<LogLine>,
) -> Result<CliResult, ()> {
    let bin = match resolve_sidecar("mapcompile") {
        Some(b) => b,
        None => return Ok(CliResult::err(missing("mapcompile"))),
    };
    let out_dir = PathBuf::from(&out_dir);
    if let Err(e) = std::fs::create_dir_all(&out_dir) {
        return Ok(CliResult::err(format!("could not create output dir: {e}")));
    }
    let suffix = opts.out_suffix.clone();
    let args = build_compile_args(&opts);
    let reg = reg.inner().clone();
    let cwd = out_dir.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_blocking(bin, args, Some(cwd), run_id, reg, on_log)
    })
    .await;

    Ok(match result {
        Ok(Ok(status)) => {
            let smf = out_dir.join(format!("{suffix}.smf"));
            if status.success() && smf.exists() {
                CliResult::ok(json!({ "smfPath": smf.to_string_lossy(), "outSuffix": suffix }))
            } else if status.success() {
                CliResult::err(format!("mapcompile finished but {} was not written", smf.display()))
            } else {
                CliResult::err(match status.code() {
                    Some(c) => format!("mapcompile exited with code {c}"),
                    None => "mapcompile was terminated".into(),
                })
            }
        }
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("compile task failed: {e}")),
    })
}

/// `mc_decompile` — run `mapdecompile`, which chdir's into `directory` and
/// extracts source images there. Resolves with the directory + exit code.
#[tauri::command]
async fn mc_decompile(
    reg: State<'_, SharedRegistry>,
    opts: DecompileOpts,
    run_id: String,
    on_log: Channel<LogLine>,
) -> Result<CliResult, ()> {
    let bin = match resolve_sidecar("mapdecompile") {
        Some(b) => b,
        None => return Ok(CliResult::err(missing("mapdecompile"))),
    };
    let directory = opts.directory.clone();
    let args = build_decompile_args(&opts);
    let reg = reg.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_blocking(bin, args, None, run_id, reg, on_log)
    })
    .await;

    Ok(match result {
        Ok(Ok(status)) => {
            let code = status.code().unwrap_or(-1);
            if status.success() {
                CliResult::ok(json!({ "directory": directory, "exitCode": code }))
            } else {
                CliResult::err(format!("mapdecompile exited with code {code}"))
            }
        }
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("decompile task failed: {e}")),
    })
}

/// `mc_cancel` — kill an in-flight run by id.
#[tauri::command]
async fn mc_cancel(reg: State<'_, SharedRegistry>, run_id: String) -> Result<CliResult, ()> {
    let child = reg.lock().unwrap().remove(&run_id);
    Ok(match child {
        Some(mut c) => {
            let _ = c.kill();
            let _ = c.wait();
            CliResult::ok(json!({ "cancelled": true }))
        }
        None => CliResult::ok(json!({ "cancelled": false })),
    })
}

/// `mc_settings_load` — read the whole settings map, backing the frame's
/// `SettingsStorage` adapter at app boot.
#[tauri::command]
async fn mc_settings_load<R: Runtime>(app: AppHandle<R>) -> Result<CliResult, ()> {
    let path = match settings_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    Ok(match load_settings(&path) {
        Ok(entries) => CliResult::ok(json!({ "entries": entries })),
        Err(e) => CliResult::err(e),
    })
}

/// `mc_settings_save` — persist the whole settings map (atomic overwrite).
#[tauri::command]
async fn mc_settings_save<R: Runtime>(app: AppHandle<R>, entries: Settings) -> Result<CliResult, ()> {
    let path = match settings_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    Ok(match save_settings(&path, &entries) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e),
    })
}

/// Build the plugin. Registered as `"coilbox-mapconv"` (crate name minus the
/// `tauri-plugin-` prefix); the frontend invokes `plugin:coilbox-mapconv|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-mapconv")
        .setup(|app, _api| {
            app.manage(SharedRegistry::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mc_probe,
            mc_suggest_sources,
            mc_compile,
            mc_decompile,
            mc_cancel,
            mc_settings_load,
            mc_settings_save
        ])
        .build()
}
