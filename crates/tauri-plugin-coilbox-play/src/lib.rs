//! Singleplayer/skirmish launcher plugin (Rust half). It generates the engine's
//! `script.txt` from a typed [`BattleConfig`], writes it under app-data, launches
//! the resolved engine binary with it, and tracks the child so the UI can freeze
//! its settings while a game runs and unfreeze when the engine exits.
//!
//! We don't capture the engine's logs (it writes its own infolog file); the value
//! this plugin adds is a byte-correct start script and a reliable "game finished"
//! signal — the `play_launch` command simply resolves when the process exits.

mod launch;
mod script;

use launch::build_engine_args;
use picoframe_core::CliResult;
use script::{generate_script, BattleConfig};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime, State,
};

/// Running engine processes keyed by frontend-supplied run id, so `play_cancel`
/// can kill one and the launch poll-loop can detect cancellation. A run removes
/// its own entry when the engine exits.
type RunRegistry = Arc<Mutex<HashMap<String, Child>>>;

/// Lifecycle event streamed to the frontend over a [`Channel`]. The authoritative
/// unfreeze signal is `play_launch` resolving; this just lets the UI show a
/// "running" state before then.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum LaunchEvent {
    Started,
    Exited { code: Option<i32> },
}

/// Poll interval while waiting for the engine to exit. Coarse: the engine runs for
/// minutes, and cancellation only needs to be noticed promptly, not instantly.
const POLL_INTERVAL: Duration = Duration::from_millis(150);

/// Path the generated start script is written to: `<app-data>/play/script.txt`.
fn script_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?
        .join("play");
    Ok(dir.join("script.txt"))
}

/// `play_generate_script` — render a `BattleConfig` to start-script text without
/// launching anything (used by tests and to write the file before launch).
#[tauri::command]
async fn play_generate_script(config: BattleConfig) -> CliResult {
    CliResult::ok(json!({ "script": generate_script(&config) }))
}

/// Synchronous launch body (runs on a blocking thread). Spawns the engine, records
/// the child, emits `Started`, then polls for exit — re-checking the registry each
/// tick so `play_cancel` can remove/kill it. Returns the exit code, or `None` if
/// the run was cancelled.
fn launch_blocking(
    bin: PathBuf,
    args: Vec<String>,
    data_dir: String,
    run_id: String,
    reg: RunRegistry,
    on_event: Channel<LaunchEvent>,
) -> Result<Option<i32>, String> {
    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .env("SPRING_DATADIR", &data_dir)
        // The engine writes its own infolog file; detach its stdio so we don't
        // hold pipes open or pop a console.
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch engine: {e}"))?;
    reg.lock().unwrap().insert(run_id.clone(), child);
    let _ = on_event.send(LaunchEvent::Started);

    loop {
        // Hold the lock only long enough to poll; releasing it between ticks lets
        // play_cancel remove and kill the child.
        let exited = {
            let mut map = reg.lock().unwrap();
            match map.get_mut(&run_id) {
                Some(child) => match child.try_wait().map_err(|e| e.to_string())? {
                    Some(status) => {
                        map.remove(&run_id);
                        Some(status.code())
                    }
                    None => None,
                },
                // Gone from the registry -> play_cancel took it.
                None => return Ok(None),
            }
        };
        if let Some(code) = exited {
            let _ = on_event.send(LaunchEvent::Exited { code });
            return Ok(Some(code.unwrap_or(0)));
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// `play_launch` — write the start script and launch the engine, resolving when
/// the engine process exits (the UI's unfreeze signal). Refuses to start a second
/// game while one is already running.
#[tauri::command]
async fn play_launch<R: Runtime>(
    app: AppHandle<R>,
    reg: State<'_, RunRegistry>,
    config: BattleConfig,
    executable: String,
    data_dir: String,
    run_id: String,
    on_event: Channel<LaunchEvent>,
) -> Result<CliResult, ()> {
    let bin = PathBuf::from(&executable);
    if !bin.is_file() {
        return Ok(CliResult::err(format!(
            "engine executable not found: {executable}"
        )));
    }
    // Single game at a time.
    if !reg.lock().unwrap().is_empty() {
        return Ok(CliResult::err("a game is already running"));
    }

    let path = match script_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Ok(CliResult::err(format!("could not create script dir: {e}")));
        }
    }
    if let Err(e) = std::fs::write(&path, generate_script(&config)) {
        return Ok(CliResult::err(format!("could not write script.txt: {e}")));
    }

    let args = build_engine_args(&path.to_string_lossy(), None);
    let reg = reg.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        launch_blocking(bin, args, data_dir, run_id, reg, on_event)
    })
    .await;

    Ok(match result {
        Ok(Ok(Some(code))) => CliResult::ok(json!({ "exitCode": code })),
        Ok(Ok(None)) => CliResult::ok(json!({ "exitCode": serde_json::Value::Null })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("launch task failed: {e}")),
    })
}

/// `play_cancel` — kill an in-flight game by run id (its launch resolves shortly
/// after, unfreezing the UI).
#[tauri::command]
async fn play_cancel(reg: State<'_, RunRegistry>, run_id: String) -> Result<CliResult, ()> {
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

/// Build the plugin. Registered as `"coilbox-play"` (crate name minus the
/// `tauri-plugin-` prefix); the frontend invokes `plugin:coilbox-play|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-play")
        .setup(|app, _api| {
            app.manage(RunRegistry::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            play_generate_script,
            play_launch,
            play_cancel
        ])
        .build()
}
