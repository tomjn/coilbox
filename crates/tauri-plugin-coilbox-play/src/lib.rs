//! Singleplayer/skirmish launcher plugin (Rust half). It generates the engine's
//! `script.txt` from a typed [`BattleConfig`], writes it under app-data, launches
//! the resolved engine binary with it, and tracks the child so the UI can freeze
//! its settings while a game runs and unfreeze when the engine exits.
//!
//! We don't capture the engine's logs (it writes its own infolog file); the value
//! this plugin adds is a byte-correct start script and a reliable "game finished"
//! signal — the `play_launch` command simply resolves when the process exits.

mod focus;
mod infolog;
mod launch;
pub mod script;

use launch::build_engine_args;
use picoframe_core::CliResult;
use script::{generate_script, BattleConfig};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, ExitStatus, Stdio};
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

/// The process id of the engine a run is still running, or `None` when it is
/// not running one.
///
/// Everything that wants an engine's pid goes through this, and the reason is
/// what the registry is rather than what is convenient. An entry only exists
/// between the spawn and the `try_wait` that reaps the child, both of which
/// happen under this lock in [`launch_blocking`], so a pid read here belongs to
/// a process nothing has waited on and the OS is therefore not free to have
/// given to anything else. A pid handed out once and remembered somewhere makes
/// no such promise.
///
/// That distinction is the whole of why [`engine_pid`] exists. The relay
/// sidecar stops relaying when the process it was told to watch exits, so it
/// being told about a process that has already gone would end a game that other
/// people are still playing.
fn pid_of(reg: &RunRegistry, run_id: &str) -> Option<u32> {
    reg.lock().unwrap().get(run_id).map(Child::id)
}

/// The process id of the engine `run_id` is still running, for a caller outside
/// this plugin.
///
/// The one thing another plugin has to know about a running engine, and it is
/// asked for rather than announced. `tauri-plugin-coilbox-multiplayer` uses it
/// to tell the relay sidecar which process to watch (issue #2065), and the
/// answer has to be true at the moment it is asked. See [`pid_of`] for what
/// makes that true here and why nothing weaker would do.
pub fn engine_pid<R: Runtime>(app: &AppHandle<R>, run_id: &str) -> Option<u32> {
    let reg = app.try_state::<RunRegistry>()?;
    pid_of(&reg, run_id)
}

/// How the engine process ended.
///
/// Both halves matter, and neither alone is enough. A crash kills the engine with
/// a signal, so `ExitStatus::code()` answers `None` and flattening it to 0 reports
/// a segfault as a clean exit (issue #379). Windows has no signals, so `signal` is
/// always `None` there and a failure shows up in `code`.
#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitOutcome {
    code: Option<i32>,
    signal: Option<i32>,
}

impl ExitOutcome {
    fn from_status(status: &ExitStatus) -> Self {
        #[cfg(unix)]
        let signal = {
            use std::os::unix::process::ExitStatusExt;
            status.signal()
        };
        #[cfg(not(unix))]
        let signal = None;
        Self {
            code: status.code(),
            signal,
        }
    }
}

/// Lifecycle event streamed to the frontend over a [`Channel`]. The authoritative
/// unfreeze signal is `play_launch` resolving; this just lets the UI show a
/// "running" state before then.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum LaunchEvent {
    Started,
    Exited {
        code: Option<i32>,
        signal: Option<i32>,
    },
}

/// Poll interval while waiting for the engine to exit. Coarse: the engine runs for
/// minutes, and cancellation only needs to be noticed promptly, not instantly.
const POLL_INTERVAL: Duration = Duration::from_millis(150);

/// Path the generated start script is written to: `<app-data>/play/script.txt`.
fn script_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = coilbox_portable::data_dir(app)?.join("play");
    Ok(dir.join("script.txt"))
}

/// `play_generate_script` — render a `BattleConfig` to start-script text without
/// launching anything (used by tests and to write the file before launch).
#[tauri::command]
async fn play_generate_script(config: BattleConfig) -> CliResult {
    CliResult::ok(json!({ "script": generate_script(&config) }))
}

/// `play_export_script` — render a `BattleConfig` and write it to a caller-chosen
/// path (the frontend picks `dest` via the save dialog). There is no frontend fs
/// plugin, so the write happens here.
#[tauri::command]
async fn play_export_script(config: BattleConfig, dest: String) -> CliResult {
    match std::fs::write(&dest, generate_script(&config)) {
        Ok(()) => CliResult::ok(json!({ "dest": dest })),
        Err(e) => CliResult::err(format!("could not write start script: {e}")),
    }
}

/// `play_export_preset` — write a preset's JSON (already serialized by the
/// frontend) to a caller-chosen path, so users can share a saved setup. Like
/// `play_export_script`, the write lives here because there's no frontend fs
/// plugin; the plugin treats the preset as an opaque string and never models its
/// shape.
#[tauri::command]
async fn play_export_preset(json: String, dest: String) -> CliResult {
    match std::fs::write(&dest, json) {
        Ok(()) => CliResult::ok(json!({ "dest": dest })),
        Err(e) => CliResult::err(format!("could not write preset: {e}")),
    }
}

/// `play_import_preset` — read a preset JSON file the user picked and hand its raw
/// contents back for the frontend to parse and validate.
#[tauri::command]
async fn play_import_preset(src: String) -> CliResult {
    match std::fs::read_to_string(&src) {
        Ok(json) => CliResult::ok(json!({ "json": json })),
        Err(e) => CliResult::err(format!("could not read preset: {e}")),
    }
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
) -> Result<Option<ExitOutcome>, String> {
    let mut cmd = coilbox_proc::command(&bin);
    cmd.args(&args)
        .env("SPRING_DATADIR", &data_dir)
        // The engine writes its own infolog file; detach its stdio so we don't
        // hold pipes open or pop a console.
        .stdout(Stdio::null())
        .stderr(Stdio::null());

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
                        Some(ExitOutcome::from_status(&status))
                    }
                    None => None,
                },
                // Gone from the registry -> play_cancel took it.
                None => return Ok(None),
            }
        };
        if let Some(outcome) = exited {
            let _ = on_event.send(LaunchEvent::Exited {
                code: outcome.code,
                signal: outcome.signal,
            });
            return Ok(Some(outcome));
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Turn a finished launch task into the command's reply, shared by the three
/// launch commands.
///
/// A cancelled run reports no exit status at all, which is how the frontend tells
/// a cancel from a crash: `play_cancel` takes the child out of the registry, so
/// the poll loop never sees it exit.
fn launch_result<E: std::fmt::Display>(
    result: Result<Result<Option<ExitOutcome>, String>, E>,
) -> CliResult {
    match result {
        Ok(Ok(Some(o))) => CliResult::ok(json!({ "exitCode": o.code, "signal": o.signal })),
        Ok(Ok(None)) => CliResult::ok(json!({ "exitCode": null, "signal": null })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("launch task failed: {e}")),
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

    Ok(launch_result(result))
}

/// `play_launch_replay` — launch the engine to play back a demo (`.sdfz`). Unlike
/// `play_launch` this writes no start script: the engine reads map/game/players
/// from the demo when it's passed as the positional argument. Shares the run
/// registry, so it refuses to start while any game/replay is already running.
#[tauri::command]
async fn play_launch_replay<R: Runtime>(
    _app: AppHandle<R>,
    reg: State<'_, RunRegistry>,
    demo_path: String,
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
    if !PathBuf::from(&demo_path).is_file() {
        return Ok(CliResult::err(format!("replay not found: {demo_path}")));
    }
    // Single game/replay at a time.
    if !reg.lock().unwrap().is_empty() {
        return Ok(CliResult::err("a game is already running"));
    }

    let args = build_engine_args(&demo_path, None);
    let reg = reg.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        launch_blocking(bin, args, data_dir, run_id, reg, on_event)
    })
    .await;

    Ok(launch_result(result))
}

/// `play_launch_save` — resume a savegame (`.ssf`/`.slsf`). Like `play_launch_replay`
/// this writes no start script: the engine reads everything from the save when it's
/// passed as the positional argument (it dispatches on the extension). Shares the
/// run registry, so it refuses to start while any game/replay is already running.
#[tauri::command]
async fn play_launch_save<R: Runtime>(
    _app: AppHandle<R>,
    reg: State<'_, RunRegistry>,
    save_path: String,
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
    if !PathBuf::from(&save_path).is_file() {
        return Ok(CliResult::err(format!("savegame not found: {save_path}")));
    }
    // Single game/replay at a time.
    if !reg.lock().unwrap().is_empty() {
        return Ok(CliResult::err("a game is already running"));
    }

    let args = build_engine_args(&save_path, None);
    let reg = reg.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        launch_blocking(bin, args, data_dir, run_id, reg, on_event)
    })
    .await;

    Ok(launch_result(result))
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

/// `play_focus` — bring the running game's window back to the foreground (the user
/// alt-tabbed to Coilbox mid-game). Maps the run id to the live child's PID so the
/// PID never crosses the IPC boundary. Best-effort: returns `focused: false` when
/// no window could be raised (e.g. Wayland, or the process has no window yet).
#[tauri::command]
async fn play_focus(reg: State<'_, RunRegistry>, run_id: String) -> Result<CliResult, ()> {
    let pid = pid_of(&reg, &run_id);
    Ok(match pid {
        Some(pid) => CliResult::ok(json!({ "focused": focus::focus_pid(pid) })),
        None => CliResult::err("no running game with that id"),
    })
}

/// `play_infolog` — read the tail of the engine's most recent `infolog.txt`, for
/// crash triage and for the engine log page in settings (issue #379).
///
/// The log is not in `data_dir`, whatever the content root says: the engine writes
/// it to its own write dir, which on unix is `~/.config/spring` long before it is
/// anything coilbox named. See `infolog::candidate_dirs` for the search, and the
/// module docs for why.
///
/// This reports the newest log it can find and when it was written, and says
/// nothing about which run it belongs to. The caller knows when its launch
/// started, so the caller decides whether this log is that run's.
#[tauri::command]
async fn play_infolog<R: Runtime>(
    app: AppHandle<R>,
    data_dir: String,
    max_lines: usize,
) -> Result<CliResult, ()> {
    let documents = app.path().document_dir().ok();
    let base = infolog::LogBaseDirs::from_env(documents);
    let dirs = infolog::candidate_dirs(infolog::current_os(), &base, &data_dir);
    let Some(path) = infolog::newest_log(&dirs) else {
        return Ok(CliResult::err("no engine log was found"));
    };
    Ok(match infolog::read_tail(&path, max_lines) {
        Ok(tail) => CliResult::ok(json!({ "log": tail })),
        Err(e) => CliResult::err(e),
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
            play_export_script,
            play_export_preset,
            play_import_preset,
            play_launch,
            play_launch_replay,
            play_launch_save,
            play_cancel,
            play_focus,
            play_infolog
        ])
        .build()
}

#[cfg(test)]
mod tests {
    //! What [`pid_of`] promises, driven through [`launch_blocking`] rather than
    //! by writing into the registry by hand. The promise is about when an entry
    //! is there and when it is not, and only the real launch decides that.

    use super::*;

    /// A process that stays up long enough to be asked about, and one that is
    /// over before it is. Two commands rather than one with an argument,
    /// because Windows spells both differently.
    fn a_process_that_lasts() -> (PathBuf, Vec<String>) {
        if cfg!(windows) {
            // No `sleep` on Windows, and `timeout` wants a console it has not
            // got here. Pinging loopback three times is the usual stand-in and
            // takes about two seconds.
            (
                PathBuf::from("cmd"),
                vec!["/C".into(), "ping -n 3 127.0.0.1 >NUL".into()],
            )
        } else {
            (PathBuf::from("sh"), vec!["-c".into(), "sleep 2".into()])
        }
    }

    /// Somewhere to hang a run's data dir that is not somebody's real one. The
    /// engine stand-ins here never read it.
    fn a_data_dir() -> String {
        std::env::temp_dir().to_string_lossy().into_owned()
    }

    /// A channel that throws away whatever the launch says. The lifecycle
    /// events are the frontend's, and these tests are about the registry.
    fn nowhere() -> Channel<LaunchEvent> {
        Channel::new(|_| Ok(()))
    }

    /// Wait for a launch on another thread to have got as far as recording its
    /// child, rather than sleeping for a guess at how long a spawn takes.
    fn eventually_running(reg: &RunRegistry, run_id: &str) -> u32 {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(pid) = pid_of(reg, run_id) {
                return pid;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "the launch never recorded a child"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    /// The whole of what a caller outside this plugin is being promised: while
    /// the run is going, `pid_of` names a process that is genuinely there, and
    /// once it has finished it names nothing at all.
    ///
    /// The second half is the one that matters. The relay sidecar stops
    /// relaying when the process it was told to watch exits, so a registry that
    /// held on to a finished run would hand out a pid that either reads as gone
    /// and ends somebody else's game, or has since been given to an unrelated
    /// process. Neither is a pid worth sending.
    #[test]
    fn a_run_names_a_live_process_while_it_lasts_and_nothing_once_it_is_over() {
        let reg = RunRegistry::default();
        let (bin, args) = a_process_that_lasts();
        let launching = {
            let reg = reg.clone();
            std::thread::spawn(move || {
                launch_blocking(bin, args, a_data_dir(), "a-run".to_string(), reg, nowhere())
            })
        };

        let pid = eventually_running(&reg, "a-run");
        assert!(
            coilbox_proc::is_running(pid),
            "a pid handed out for a live run has to name a process that is there"
        );
        assert_eq!(
            pid_of(&reg, "some-other-run"),
            None,
            "a run id nothing launched under is not the running one"
        );

        launching
            .join()
            .expect("the launch thread")
            .expect("a process that starts and ends")
            .expect("a run nothing cancelled reports how it ended");
        assert_eq!(
            pid_of(&reg, "a-run"),
            None,
            "a finished run has no pid to give out, and giving out its old one would name \
             a process that has gone or, later, one that has nothing to do with coilbox"
        );
    }

    /// A cancelled run is over too, as far as anybody asking is concerned. It
    /// is a separate path through the registry from the one above: `play_cancel`
    /// takes the child out itself rather than the poll loop noticing it exit.
    #[test]
    fn a_cancelled_run_stops_naming_a_process() {
        let reg = RunRegistry::default();
        let (bin, args) = a_process_that_lasts();
        let launching = {
            let reg = reg.clone();
            std::thread::spawn(move || {
                launch_blocking(bin, args, a_data_dir(), "a-run".to_string(), reg, nowhere())
            })
        };
        eventually_running(&reg, "a-run");

        let child = reg.lock().unwrap().remove("a-run");
        let mut child = child.expect("the run is recorded");
        let _ = child.kill();
        let _ = child.wait();

        assert_eq!(pid_of(&reg, "a-run"), None);
        assert!(
            matches!(launching.join().expect("the launch thread"), Ok(None)),
            "a run taken out of the registry reports no exit status, which is how a cancel \
             is told from a crash"
        );
    }
}
