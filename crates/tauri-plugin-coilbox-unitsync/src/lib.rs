//! unitsync content-scan plugin (Rust half). It owns no FFI itself — it spawns
//! the bundled `coilbox-unitsync-worker` sidecar, which loads the engine's
//! `libunitsync` out-of-process so a unitsync crash can't take the app down.
//!
//! The single `unitsync_scan` command resolves the worker and the engine's
//! library, sets the child's loader-path + `SPRING_DATADIR` env at launch (so the
//! dynamic loader can resolve unitsync's sibling libraries on macOS, where env
//! set *after* launch is ignored), runs it under a timeout, and passes its JSON
//! straight through inside the [`CliResult`] envelope.

mod sidecar;

use picoframe_core::CliResult;
use sidecar::{
    build_args, build_game_args, build_minimap_args, build_thumbnails_args, find_unitsync,
    resolve_sidecar,
};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

const WORKER_MISSING: &str =
    "unitsync worker not found. Bundle it via tauri.conf.json `externalBin` or set UNITSYNC_WORKER.";

/// Scans rebuild the whole VFS, which is slow on big content roots; give it room.
const SCAN_TIMEOUT: Duration = Duration::from_secs(60);
/// A single minimap is a fast, bounded operation.
const MINIMAP_TIMEOUT: Duration = Duration::from_secs(30);

/// Subdirectory of the app cache dir holding rendered minimap/thumbnail PNGs.
const THUMB_CACHE_SUBDIR: &str = "coilbox-unitsync-thumbs";

/// The on-disk PNG cache directory for minimaps/thumbnails, under the app cache
/// dir. `None` when the platform can't resolve a cache dir — caching is then
/// simply skipped (same pattern as the mapconv plugin's thumbnail cache).
fn thumb_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_cache_dir()
        .ok()
        .map(|d| d.join(THUMB_CACHE_SUBDIR))
}

/// The platform's shared-library search variable.
fn loader_var() -> &'static str {
    if cfg!(target_os = "macos") {
        "DYLD_LIBRARY_PATH"
    } else if cfg!(windows) {
        "PATH"
    } else {
        "LD_LIBRARY_PATH"
    }
}

/// Env to set on the worker child: point unitsync at the content root, and put
/// the engine dir on the loader path so libunitsync's sibling libraries resolve.
fn loader_envs(engine_dir: &Path, datadir: &str) -> Vec<(String, String)> {
    let var = loader_var();
    let sep = if cfg!(windows) { ';' } else { ':' };
    let existing = std::env::var(var).unwrap_or_default();
    let dir = engine_dir.display().to_string();
    let value = if existing.is_empty() {
        dir
    } else {
        format!("{dir}{sep}{existing}")
    };
    vec![
        ("SPRING_DATADIR".into(), datadir.to_string()),
        (var.to_string(), value),
    ]
}

/// Run the worker to completion, reading stdout on a thread (so a large JSON
/// dump can't deadlock against a full pipe) and killing it past the timeout. The
/// worker emits its JSON — including any in-band error list — on stdout even when
/// it exits non-zero, so non-empty stdout is always preferred.
fn run_worker_blocking(
    bin: PathBuf,
    args: Vec<String>,
    envs: Vec<(String, String)>,
    timeout: Duration,
) -> Result<String, String> {
    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in &envs {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start unitsync worker: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out_handle = std::thread::spawn(move || read_to_string(stdout));
    let err_handle = std::thread::spawn(move || read_to_string(stderr));

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("unitsync scan timed out".into());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("error waiting for unitsync worker: {e}")),
        }
    };

    let out = out_handle.join().unwrap_or_default();
    let err = err_handle.join().unwrap_or_default();

    if out.trim().is_empty() {
        let code = status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "terminated by signal".into());
        let detail = err.trim();
        return Err(format!(
            "unitsync worker produced no output (exit {code}){}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }
    Ok(out)
}

fn read_to_string<R: Read>(reader: Option<R>) -> String {
    let mut buf = String::new();
    if let Some(mut r) = reader {
        let _ = r.read_to_string(&mut buf);
    }
    buf
}

/// Resolve the worker binary, the engine's `libunitsync.*`, and the engine dir
/// (used for both args and the child's loader-path env). Shared by both commands.
fn prepare(engine_path: &str) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let bin = resolve_sidecar().ok_or_else(|| WORKER_MISSING.to_string())?;
    let libpath = find_unitsync(Path::new(engine_path))
        .ok_or_else(|| format!("no libunitsync found in engine dir {engine_path}"))?;
    let engine_dir = libpath
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(engine_path));
    Ok((bin, libpath, engine_dir))
}

/// Spawn the worker with the given args/env, parse its JSON stdout into a
/// `CliResult`. `what` names the operation for error messages.
async fn run_worker(
    bin: PathBuf,
    args: Vec<String>,
    envs: Vec<(String, String)>,
    timeout: Duration,
    what: &str,
) -> CliResult {
    let result =
        tauri::async_runtime::spawn_blocking(move || run_worker_blocking(bin, args, envs, timeout))
            .await;
    match result {
        Ok(Ok(stdout)) => match serde_json::from_str::<serde_json::Value>(&stdout) {
            Ok(value) => CliResult::ok(value),
            Err(e) => CliResult::err(format!("could not parse unitsync output: {e}")),
        },
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("{what} task failed: {e}")),
    }
}

/// `unitsync_scan` — scan one content root with one engine's libunitsync,
/// returning its maps, games, archives and metadata. `engine_path` is the engine
/// dir holding `libunitsync.*`; `data_dir` is the content root to enumerate.
#[tauri::command]
async fn unitsync_scan(engine_path: String, data_dir: String) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let args = build_args(&libpath.to_string_lossy(), &data_dir);
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, SCAN_TIMEOUT, "scan").await)
}

/// `unitsync_minimap` — render one map's minimap as a PNG data URL. `mip` selects
/// resolution (`1024 >> mip` px per side; defaults to 1 = 512px).
#[tauri::command]
async fn unitsync_minimap<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    map_name: String,
    mip: Option<i32>,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let cache_dir = thumb_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_minimap_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &map_name,
        mip.unwrap_or(1),
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, MINIMAP_TIMEOUT, "minimap").await)
}

/// `unitsync_thumbnails` — render a small minimap for every map in one session,
/// for the Maps grid. `mip` defaults to 3 (128px).
#[tauri::command]
async fn unitsync_thumbnails<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    mip: Option<i32>,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let cache_dir = thumb_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_thumbnails_args(
        &libpath.to_string_lossy(),
        &data_dir,
        mip.unwrap_or(3),
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, SCAN_TIMEOUT, "thumbnails").await)
}

/// `unitsync_game_info` — load one game's archives to read its sides (with start
/// units) and unit count. `game_archive` is the game's primary archive name.
#[tauri::command]
async fn unitsync_game_info(
    engine_path: String,
    data_dir: String,
    game_archive: String,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let args = build_game_args(&libpath.to_string_lossy(), &data_dir, &game_archive);
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, SCAN_TIMEOUT, "game info").await)
}

/// Build the plugin. Registered as `"coilbox-unitsync"` (crate name minus the
/// `tauri-plugin-` prefix); the frontend invokes `plugin:coilbox-unitsync|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-unitsync")
        .invoke_handler(tauri::generate_handler![
            unitsync_scan,
            unitsync_minimap,
            unitsync_thumbnails,
            unitsync_game_info
        ])
        .build()
}
