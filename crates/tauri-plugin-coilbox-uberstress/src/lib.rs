//! uberstress load-test plugin (Rust half). Shells out to the bundled
//! `uberstress` sidecar to list scenarios, run load/bench tests (streaming the
//! live log over a Tauri [`Channel`]), browse the JSON reports uberstress writes,
//! persist the server list/config, and generate seed SQL. Results are returned as
//! a [`CliResult`] envelope, matching every other picoframe plugin.

mod report;
mod settings;
mod sidecar;

use picoframe_core::CliResult;
use report::{list_report_files, parse_scenarios, Report, ReportSummary};
use serde_json::json;
use settings::{load_settings, save_settings, Settings};
use sidecar::{build_args, resolve_sidecar, LogLine, RunOpts};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime, State,
};

const SIDECAR_MISSING: &str =
    "uberstress sidecar not found. Bundle it via tauri.conf.json `externalBin` or set UBERSTRESS_SIDECAR.";

/// Running children keyed by frontend-supplied run id, so `us_cancel` can kill a
/// run in flight. A run removes its own entry when it finishes reaping.
type SharedRegistry = Arc<Mutex<HashMap<String, Child>>>;

/// Resolve the plugin's settings-file path and results directory under app-data.
fn data_dirs<R: Runtime>(app: &AppHandle<R>) -> Result<(PathBuf, PathBuf), String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?
        .join("uberstress");
    Ok((base.join("settings.json"), base.join("results")))
}

/// Run the sidecar to completion and capture its output (for short commands like
/// `list-scenarios` / `gen-seed-sql`).
async fn run_capture(args: Vec<String>) -> Result<std::process::Output, String> {
    let path = resolve_sidecar().ok_or(SIDECAR_MISSING)?;
    tauri::async_runtime::spawn_blocking(move || Command::new(&path).args(&args).output())
        .await
        .map_err(|e| format!("sidecar task failed: {e}"))?
        .map_err(|e| format!("failed to run uberstress: {e}"))
}

/// `us_scenarios` — list available scenarios; doubles as the "binary runnable?"
/// probe for the UI.
#[tauri::command]
async fn us_scenarios() -> CliResult {
    match run_capture(vec!["list-scenarios".into()]).await {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            CliResult::ok(json!({ "scenarios": parse_scenarios(&stdout) }))
        }
        Err(e) => CliResult::err(e),
    }
}

/// Read one pipe line-by-line, forwarding each line to the frontend channel.
fn stream_pipe<Rd: std::io::Read>(rd: Rd, stream: &str, log: Channel<LogLine>) {
    use std::io::BufRead;
    for line in std::io::BufReader::new(rd).lines() {
        match line {
            Ok(l) => {
                let _ = log.send(LogLine {
                    stream: stream.into(),
                    line: l,
                });
            }
            Err(_) => break,
        }
    }
}

/// Synchronous run body (called on a blocking thread). Spawns the sidecar, streams
/// stdout/stderr, reaps it, then loads the report it wrote. Returns
/// `(report_filename, report)`.
fn run_blocking(
    bin: PathBuf,
    args: Vec<String>,
    run_id: String,
    reg: SharedRegistry,
    on_log: Channel<LogLine>,
    results_dir: PathBuf,
    started: SystemTime,
) -> Result<(String, Report), String> {
    let mut child = Command::new(&bin)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start uberstress: {e}"))?;

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

    // Reap. If the entry is gone, us_cancel killed it — report no result.
    let status = match reg.lock().unwrap().remove(&run_id) {
        Some(mut c) => c.wait().map_err(|e| e.to_string())?,
        None => return Err("run was cancelled".into()),
    };

    // uberstress writes its report after the timed phase (even on scenario error),
    // so prefer returning it. Only accept a file written by this run.
    let newest = list_report_files(&results_dir).into_iter().find(|p| {
        std::fs::metadata(p)
            .and_then(|m| m.modified())
            .map(|m| m >= started)
            .unwrap_or(false)
    });
    let newest = newest.ok_or_else(|| match status.code() {
        Some(0) | None => "run finished but no report file was written".to_string(),
        Some(c) => format!("uberstress exited with code {c} and wrote no report"),
    })?;

    let content = std::fs::read_to_string(&newest).map_err(|e| e.to_string())?;
    let rep: Report =
        serde_json::from_str(&content).map_err(|e| format!("could not parse report: {e}"))?;
    let name = newest
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok((name, rep))
}

/// `us_run` — run a load/bench test, streaming output over `on_log`, resolving
/// with the parsed report when the process exits.
#[tauri::command]
async fn us_run<R: Runtime>(
    app: AppHandle<R>,
    reg: State<'_, SharedRegistry>,
    opts: RunOpts,
    run_id: String,
    on_log: Channel<LogLine>,
) -> Result<CliResult, ()> {
    let bin = match resolve_sidecar() {
        Some(b) => b,
        None => return Ok(CliResult::err(SIDECAR_MISSING)),
    };
    let (_, results_dir) = match data_dirs(&app) {
        Ok(d) => d,
        Err(e) => return Ok(CliResult::err(e)),
    };
    if let Err(e) = std::fs::create_dir_all(&results_dir) {
        return Ok(CliResult::err(format!("could not create results dir: {e}")));
    }
    let args = build_args(&opts, &results_dir.to_string_lossy());
    let reg = reg.inner().clone();
    let started = SystemTime::now();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_blocking(bin, args, run_id, reg, on_log, results_dir, started)
    })
    .await;

    Ok(match result {
        Ok(Ok((file, rep))) => CliResult::ok(json!({ "reportFile": file, "report": rep })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("run task failed: {e}")),
    })
}

/// `us_cancel` — kill an in-flight run by id.
#[tauri::command]
async fn us_cancel(reg: State<'_, SharedRegistry>, run_id: String) -> Result<CliResult, ()> {
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

/// `us_history` — summaries of every saved report, newest first.
#[tauri::command]
async fn us_history<R: Runtime>(app: AppHandle<R>) -> Result<CliResult, ()> {
    let (_, results_dir) = match data_dirs(&app) {
        Ok(d) => d,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let mut runs = Vec::new();
    for f in list_report_files(&results_dir) {
        let Ok(content) = std::fs::read_to_string(&f) else {
            continue;
        };
        let Ok(rep) = serde_json::from_str::<Report>(&content) else {
            continue;
        };
        let name = f
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        runs.push(ReportSummary::from_report(&name, &rep));
    }
    Ok(CliResult::ok(json!({ "runs": runs })))
}

/// `us_report` — full parsed report for one filename (basename only, no traversal).
#[tauri::command]
async fn us_report<R: Runtime>(app: AppHandle<R>, file: String) -> Result<CliResult, ()> {
    let (_, results_dir) = match data_dirs(&app) {
        Ok(d) => d,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let Some(name) = std::path::Path::new(&file).file_name() else {
        return Ok(CliResult::err("invalid report filename"));
    };
    let path = results_dir.join(name);
    Ok(match std::fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<Report>(&content) {
            Ok(rep) => CliResult::ok(json!({ "report": rep })),
            Err(e) => CliResult::err(format!("could not parse report: {e}")),
        },
        Err(e) => CliResult::err(format!("could not read report: {e}")),
    })
}

/// `us_settings_load` — read the whole settings map, backing the frame's
/// `SettingsStorage` adapter at app boot.
#[tauri::command]
async fn us_settings_load<R: Runtime>(app: AppHandle<R>) -> Result<CliResult, ()> {
    let (settings_path, _) = match data_dirs(&app) {
        Ok(d) => d,
        Err(e) => return Ok(CliResult::err(e)),
    };
    Ok(match load_settings(&settings_path) {
        Ok(entries) => CliResult::ok(json!({ "entries": entries })),
        Err(e) => CliResult::err(e),
    })
}

/// `us_settings_save` — persist the whole settings map. The adapter sends the
/// full map on every change, so this is an atomic overwrite (no merge races).
#[tauri::command]
async fn us_settings_save<R: Runtime>(
    app: AppHandle<R>,
    entries: Settings,
) -> Result<CliResult, ()> {
    let (settings_path, _) = match data_dirs(&app) {
        Ok(d) => d,
        Err(e) => return Ok(CliResult::err(e)),
    };
    Ok(match save_settings(&settings_path, &entries) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e),
    })
}

/// `us_seed_sql` — generate seed SQL via uberstress's `gen-seed-sql` subcommand,
/// keeping the password hashing and CTE template single-sourced in uberstress.
#[tauri::command]
async fn us_seed_sql(count: i64, prefix: Option<String>, password: Option<String>) -> CliResult {
    let mut args = vec!["gen-seed-sql".into(), "--count".into(), count.to_string()];
    if let Some(p) = prefix.filter(|s| !s.is_empty()) {
        args.push("--user-prefix".into());
        args.push(p);
    }
    if let Some(p) = password.filter(|s| !s.is_empty()) {
        args.push("--password".into());
        args.push(p);
    }
    match run_capture(args).await {
        Ok(out) if out.status.success() => {
            CliResult::ok(json!({ "sql": String::from_utf8_lossy(&out.stdout) }))
        }
        Ok(out) => CliResult::err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
        Err(e) => CliResult::err(e),
    }
}

/// Build the plugin. Registered as `"coilbox-uberstress"` (crate name minus the
/// `tauri-plugin-` prefix); the frontend invokes `plugin:coilbox-uberstress|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-uberstress")
        .setup(|app, _api| {
            app.manage(SharedRegistry::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            us_scenarios,
            us_run,
            us_cancel,
            us_history,
            us_report,
            us_settings_load,
            us_settings_save,
            us_seed_sql
        ])
        .build()
}
