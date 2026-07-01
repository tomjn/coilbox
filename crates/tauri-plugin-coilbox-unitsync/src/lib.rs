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
    build_archive_extract_args, build_archive_file_args, build_archive_tree_args, build_args,
    build_config_args, build_game_args, build_heightmap_args, build_lua_args, build_map_info_args,
    build_minimap_args, build_skirmish_ai_args, build_thumbnails_args, find_unitsync,
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

    #[cfg(debug_assertions)]
    if !err.trim().is_empty() {
        eprintln!("[unitsync-worker stderr] {}", err.trim());
    }

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

/// Write a Lua script to a uniquely-named temp file and return its path. Scripts
/// are passed to the worker by path (not as a CLI arg) because args have length
/// limits and a console script can be large. The caller removes the file after
/// the worker exits.
fn write_temp_script(source: &str) -> Result<PathBuf, String> {
    let mut path = std::env::temp_dir();
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    path.push(format!("coilbox-lua-{pid}-{nanos}.lua"));
    std::fs::write(&path, source).map_err(|e| format!("could not write temp Lua script: {e}"))?;
    Ok(path)
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

/// `unitsync_heightmap` — render one map's height infomap as a downscaled
/// grayscale PNG data URL, with the world `minHeight`/`maxHeight` for correct 3D
/// displacement. `max_side` caps the PNG's longest side (defaults to 512).
#[tauri::command]
async fn unitsync_heightmap<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    map_name: String,
    max_side: Option<i32>,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let cache_dir = thumb_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_heightmap_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &map_name,
        max_side.unwrap_or(512),
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, MINIMAP_TIMEOUT, "heightmap").await)
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

/// `unitsync_map_info` — load one map's archive set to read its options + any
/// attributed diagnostics. Fetched on demand (mounts the map), not during scan.
#[tauri::command]
async fn unitsync_map_info(
    engine_path: String,
    data_dir: String,
    map_name: String,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let args = build_map_info_args(&libpath.to_string_lossy(), &data_dir, &map_name);
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, MINIMAP_TIMEOUT, "map info").await)
}

/// `unitsync_skirmish_ais` — list the skirmish AIs available to play against:
/// native engine AIs, plus the selected game's bundled Lua AIs when
/// `game_archive` is given. Returns `{ ais: [{ shortName, version?, name?,
/// description?, kind }], errors }`.
#[tauri::command]
async fn unitsync_skirmish_ais(
    engine_path: String,
    data_dir: String,
    game_archive: Option<String>,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let args = build_skirmish_ai_args(
        &libpath.to_string_lossy(),
        &data_dir,
        game_archive.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, SCAN_TIMEOUT, "skirmish ais").await)
}

/// `unitsync_engine_config` — read a curated set of engine settings from the
/// user's `springsettings.cfg` via `GetSpringConfig*`. A light unitsync session
/// (no archive scan); `data_dir` selects which data root's config is read.
#[tauri::command]
async fn unitsync_engine_config(engine_path: String, data_dir: String) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let args = build_config_args(&libpath.to_string_lossy(), &data_dir);
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, SCAN_TIMEOUT, "engine config").await)
}

/// `unitsync_archive_tree` — list the member tree of one archive (and resolve its
/// on-disk path). `archive` is the archive name as unitsync knows it.
#[tauri::command]
async fn unitsync_archive_tree(
    engine_path: String,
    data_dir: String,
    archive: String,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let args = build_archive_tree_args(&libpath.to_string_lossy(), &data_dir, &archive);
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, SCAN_TIMEOUT, "archive tree").await)
}

/// `unitsync_archive_file` — read one member of an archive for preview. `file` is
/// the member's slash-separated path within `archive`.
#[tauri::command]
async fn unitsync_archive_file(
    engine_path: String,
    data_dir: String,
    archive: String,
    file: String,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let args = build_archive_file_args(&libpath.to_string_lossy(), &data_dir, &archive, &file);
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, MINIMAP_TIMEOUT, "archive file").await)
}

/// `unitsync_lua_exec` — run a Lua snippet through the engine's Lua parser with
/// `archive` (and its dependencies) mounted in the VFS. `source` is the script;
/// it is handed to the worker via a temp file. Returns `{ result?, error?,
/// errors }`.
#[tauri::command]
async fn unitsync_lua_exec(
    engine_path: String,
    data_dir: String,
    archive: String,
    source: String,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let script = match write_temp_script(&source) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let args = build_lua_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &archive,
        &script.to_string_lossy(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    let result = run_worker(bin, args, envs, MINIMAP_TIMEOUT, "lua exec").await;
    let _ = std::fs::remove_file(&script);
    Ok(result)
}

/// `unitsync_archive_extract` — write one member's full bytes to `dest` (the
/// download action). `file` is the member's slash-separated path within `archive`;
/// `dest` is an absolute path the user picked via a save dialog.
#[tauri::command]
async fn unitsync_archive_extract(
    engine_path: String,
    data_dir: String,
    archive: String,
    file: String,
    dest: String,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let args = build_archive_extract_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &archive,
        &file,
        &dest,
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    Ok(run_worker(bin, args, envs, MINIMAP_TIMEOUT, "archive extract").await)
}

/// Build the plugin. Registered as `"coilbox-unitsync"` (crate name minus the
/// `tauri-plugin-` prefix); the frontend invokes `plugin:coilbox-unitsync|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-unitsync")
        .invoke_handler(tauri::generate_handler![
            unitsync_scan,
            unitsync_minimap,
            unitsync_heightmap,
            unitsync_thumbnails,
            unitsync_game_info,
            unitsync_map_info,
            unitsync_skirmish_ais,
            unitsync_engine_config,
            unitsync_archive_tree,
            unitsync_archive_file,
            unitsync_lua_exec,
            unitsync_archive_extract
        ])
        .build()
}
