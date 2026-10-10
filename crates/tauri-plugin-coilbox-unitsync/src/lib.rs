//! unitsync content-scan plugin (Rust half). It owns no FFI itself — it spawns
//! the bundled `coilbox-unitsync-worker` sidecar, which loads the engine's
//! `libunitsync` out-of-process so a unitsync crash can't take the app down.
//!
//! Each command resolves the worker and the engine's library, sets the child's
//! loader-path + `SPRING_DATADIR` env at launch (so the dynamic loader can
//! resolve unitsync's sibling libraries on macOS, where env set *after* launch
//! is ignored), has it answered under a timeout, and passes its JSON straight
//! through inside the [`CliResult`] envelope.
//!
//! A read is answered by a worker that stays running between reads, so the
//! engine's `Init` is paid once and not once per read (issue #3722). `pool`
//! keeps those. A few reads still start a worker of their own: see [`Via`].

#[cfg(debug_assertions)]
mod devstats;
mod lastscan;
mod modelcache;
mod pool;
mod renderindex;
mod sidecar;

use base64::Engine;
use coilbox_unitsync_worker::{cached, RenderSource};
use picoframe_core::CliResult;
use sidecar::{
    build_archive_extract_args, build_archive_file_args, build_archive_tree_args, build_args,
    build_config_args, build_config_set_args, build_convert_3do_args, build_custom_params_args,
    build_defs_probe_args, build_faction_logos_args, build_game_args, build_game_headers_args,
    build_height_field_args, build_heightmap_args, build_lua_args, build_lua_repl_args,
    build_map_info_args, build_map_meta_args, build_map_skybox_args, build_metalmap_args,
    build_minimap_args, build_skirmish_ai_args, build_thumbnails_args, build_unit_buildpics_args,
    build_unit_dataset_args, build_unit_defs_args, build_unit_model_args, build_unit_models_args,
    build_unit_render_args, build_unit_render_keys_args, build_unit_script_args, find_unitsync,
    resolve_sidecar,
};
use std::collections::HashMap;
use std::io::{BufRead, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Runtime};

const WORKER_MISSING: &str =
    "unitsync worker not found. Bundle it via tauri.conf.json `externalBin` or set UNITSYNC_WORKER.";

/// Scans/thumbnails rebuild per-archive state on big content roots; give them
/// generous room. Cancellation (below) is the primary stop mechanism; this is a
/// safety net against a wedged worker, not a normal-path limit.
const SCAN_TIMEOUT: Duration = Duration::from_secs(300);
/// A unit model read, one model or a batch (issue #1916).
///
/// The slowest read measured was 36.87s, one of 666 run sixteen at a time over
/// XTA and Basically OTA. A whole roster in one batch took at most 2.96s
/// (Zero-K), and a cold engine archive cache costs 23.4s on top once. This is a
/// little over three times the slowest, so a read that gets here is stuck rather
/// than slow, and the screen asking for it says so and offers a retry.
const MODEL_TIMEOUT: Duration = Duration::from_secs(120);
/// A single minimap is a fast, bounded operation.
const MINIMAP_TIMEOUT: Duration = Duration::from_secs(30);
/// REPL replay re-runs the whole session each eval, so its cost grows with
/// session length — give it more headroom than the one-shot console.
const LUA_TIMEOUT: Duration = Duration::from_secs(60);

/// The timeout error string for an operation, e.g. "unitsync scan timed out after 300s".
fn fmt_timeout(what: &str, timeout: Duration) -> String {
    format!("unitsync {what} timed out after {}s", timeout.as_secs())
}

/// Maps a caller-supplied operation id to its cancel flag, so `unitsync_cancel`
/// can signal a running scan/thumbnail worker to stop.
fn cancel_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REG: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a cancel flag for `op_id` (replacing any stale one) and return it.
fn register_cancel(op_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    cancel_registry()
        .lock()
        .unwrap()
        .insert(op_id.to_string(), flag.clone());
    flag
}

/// Drop the flag for `op_id` once its operation finishes.
fn unregister_cancel(op_id: &str) {
    cancel_registry().lock().unwrap().remove(op_id);
}

/// Subdirectory of the app cache dir holding rendered minimap/thumbnail PNGs.
const THUMB_CACHE_SUBDIR: &str = "coilbox-unitsync-thumbs";

/// Subdirectory of the app cache dir holding resolved game-header JPEGs.
const HEADER_CACHE_SUBDIR: &str = "coilbox-unitsync-headers";

/// Subdirectory of the app cache dir holding resolved unit build icons: one JSON
/// record per unit, and the icon itself as a PNG beside it.
const BUILDPIC_CACHE_SUBDIR: &str = "coilbox-unitsync-buildpics";
const FACTION_LOGO_CACHE_SUBDIR: &str = "coilbox-unitsync-faction-logos";
const INFO_CACHE_SUBDIR: &str = "coilbox-unitsync-info";

/// Subdirectory of the app cache dir holding the last good scan of each target.
const LAST_SCAN_SUBDIR: &str = "coilbox-unitsync-last-scan";

/// Subdirectory of the app cache dir holding textures copied out of a game
/// archive for the unit-model viewer, raw and undecoded.
const MODEL_TEXTURE_SUBDIR: &str = "coilbox-unitsync-model-textures";

/// Subdirectory of the app cache dir holding encoded assets for the hub, named
/// after the hash of their own bytes.
///
/// Under the cache dir rather than the data dir because every file in it can be
/// made again from the archives, and the hub is where they end up rather than
/// here. The uploader (#1633) reads the path off the row it is given.
const HUB_ASSET_SUBDIR: &str = "coilbox-hub-assets";

/// The on-disk PNG cache directory for minimaps/thumbnails, under the app cache
/// dir. `None` when the platform can't resolve a cache dir — caching is then
/// simply skipped (same pattern as the mapconv plugin's thumbnail cache). Public
/// because the asset protocol serves this folder as its `unitsyncthumb` root.
pub fn thumb_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    coilbox_portable::cache_dir(app)
        .ok()
        .map(|d| d.join(THUMB_CACHE_SUBDIR))
}

/// The on-disk header cache directory, under the app cache dir. `None` when the
/// platform can't resolve a cache dir (caching is then skipped). Public because
/// the asset protocol serves this folder as its `unitsyncheader` root.
pub fn header_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    coilbox_portable::cache_dir(app)
        .ok()
        .map(|d| d.join(HEADER_CACHE_SUBDIR))
}

/// The on-disk unit build-icon cache directory, under the app cache dir. `None`
/// when the platform can't resolve a cache dir (caching is then skipped). Public
/// because the asset protocol serves this folder as its `unitsyncbuildpic` root.
pub fn buildpic_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    coilbox_portable::cache_dir(app)
        .ok()
        .map(|d| d.join(BUILDPIC_CACHE_SUBDIR))
}

/// The on-disk faction-logo cache directory, under the app cache dir. `None` when
/// the platform can't resolve a cache dir (caching is then skipped). Public
/// because the asset protocol serves this folder as its `unitsyncfactionlogo`
/// root.
pub fn faction_logo_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    coilbox_portable::cache_dir(app)
        .ok()
        .map(|d| d.join(FACTION_LOGO_CACHE_SUBDIR))
}

/// The on-disk game/map info-blob cache directory, under the app cache dir.
/// `None` when the platform can't resolve a cache dir (caching is then skipped).
fn info_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    coilbox_portable::cache_dir(app)
        .ok()
        .map(|d| d.join(INFO_CACHE_SUBDIR))
}

/// Where the unit-model viewer's extracted textures live, under the app cache
/// dir. Public because the asset protocol serves this folder as its `unitmodel`
/// root: the textures are raw archive bytes, up to a 64 MiB compressed atlas,
/// which the webview loads over the protocol rather than through the IPC.
/// `None` when the platform can't resolve a cache dir, and the viewer then draws
/// the model untextured and says why.
pub fn model_texture_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    coilbox_portable::cache_dir(app)
        .ok()
        .map(|d| d.join(MODEL_TEXTURE_SUBDIR))
}

/// Where encoded hub assets are written, under the app cache dir. `None` when the
/// platform cannot resolve a cache dir, and a render then has nowhere to go and
/// says so rather than writing somewhere arbitrary.
///
/// Public because the asset protocol serves this folder as its `hubasset` root:
/// a render coilbox drew is a picture of a unit whether or not it ever reaches
/// the hub, and the webview reads it back through `./renderindex.rs` (issue
/// #1724).
pub fn hub_asset_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    coilbox_portable::cache_dir(app)
        .ok()
        .map(|d| d.join(HUB_ASSET_SUBDIR))
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

/// Env to set on the worker child: point unitsync at the content root, name the
/// other content folders for it to read after that one, and put the engine dir
/// on the loader path so libunitsync's sibling libraries resolve.
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
    let mut envs = vec![
        ("SPRING_DATADIR".into(), datadir.to_string()),
        (
            "COILBOX_EXTRA_DATADIRS".into(),
            coilbox_proc::extra_datadirs(datadir),
        ),
        (var.to_string(), value),
    ];
    envs.extend(coilbox_proc::isolation_env(
        coilbox_portable::is_portable(),
        engine_dir,
    ));
    envs
}

/// Run a one-shot worker to completion, reading stdout on a thread (so a large
/// JSON dump can't deadlock against a full pipe) and killing it past the timeout. The
/// worker emits its JSON — including any in-band error list — on stdout even when
/// it exits non-zero, so non-empty stdout is always preferred.
fn run_worker_blocking(
    bin: PathBuf,
    args: Vec<String>,
    envs: Vec<(String, String)>,
    timeout: Duration,
    what: String,
    cancel: Option<Arc<AtomicBool>>,
) -> Result<String, String> {
    let mut cmd = coilbox_proc::command(&bin);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in &envs {
        cmd.env(k, v);
    }
    #[cfg(debug_assertions)]
    cmd.env(devstats::TIMINGS_ENV, "1");
    #[cfg(debug_assertions)]
    let mut dev_run = devstats::WorkerRun::start(&what);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start unitsync worker: {e}"))?;
    #[cfg(debug_assertions)]
    devstats::worker_started(child.id(), "one-shot");

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out_handle = std::thread::spawn(move || read_to_string(stdout));
    let err_handle = std::thread::spawn(move || read_to_string(stderr));

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => {
                if cancel.as_ref().is_some_and(|c| c.load(Ordering::Relaxed)) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("unitsync {what} cancelled"));
                }
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(fmt_timeout(&what, timeout));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("error waiting for unitsync worker: {e}")),
        }
    };

    let out = out_handle.join().unwrap_or_default();
    let err = err_handle.join().unwrap_or_default();
    #[cfg(debug_assertions)]
    let err = dev_run.take_timings(err);

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

/// Run the worker, forwarding the progress lines it prints as it goes and
/// keeping the last line as the result.
///
/// The other modes here answer in one JSON blob at the end, which is fine when
/// the end is a second away. Converting a game's models is 720 files on
/// Balanced Annihilation, and a window that sits still for the length of that
/// is a window nobody can tell from a hung one. So `--convert-3do` prints a
/// line per model as it works, this reads them a line at a time rather than
/// waiting for the pipe to close, and each one goes straight to the webview.
///
/// A progress line is a JSON object with a `progress` key and the result is a
/// JSON object without one, so telling them apart needs no sentinel prefix and
/// no second stream. The last line that is not progress is the result, which
/// means a worker that printed nothing at all is an error rather than an empty
/// success.
fn run_worker_streaming(
    bin: PathBuf,
    args: Vec<String>,
    envs: Vec<(String, String)>,
    timeout: Duration,
    what: String,
    cancel: Option<Arc<AtomicBool>>,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> Result<String, String> {
    let mut cmd = coilbox_proc::command(&bin);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in &envs {
        cmd.env(k, v);
    }
    #[cfg(debug_assertions)]
    cmd.env(devstats::TIMINGS_ENV, "1");
    #[cfg(debug_assertions)]
    let mut dev_run = devstats::WorkerRun::start(&what);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start unitsync worker: {e}"))?;
    #[cfg(debug_assertions)]
    devstats::worker_started(child.id(), "one-shot");

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out_handle = std::thread::spawn(move || {
        let mut result = String::new();
        let Some(stdout) = stdout else { return result };
        for line in std::io::BufReader::new(stdout)
            .lines()
            .map_while(Result::ok)
        {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(value) if value.get("progress").is_some() => {
                    let _ = on_progress.send(value["progress"].clone());
                }
                // Anything else is the result, or a line from a worker that
                // died mid-write. Keeping the last one either way means a
                // partial line cannot be mistaken for the answer.
                _ => result = line,
            }
        }
        result
    });
    let err_handle = std::thread::spawn(move || read_to_string(stderr));

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => {
                if cancel.as_ref().is_some_and(|c| c.load(Ordering::Relaxed)) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("unitsync {what} cancelled"));
                }
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(fmt_timeout(&what, timeout));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("error waiting for unitsync worker: {e}")),
        }
    };

    let out = out_handle.join().unwrap_or_default();
    let err = err_handle.join().unwrap_or_default();
    #[cfg(debug_assertions)]
    let err = dev_run.take_timings(err);

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

/// Write a render's RGBA to a uniquely-named temp file and return its path, for
/// the same reason `write_temp_script` exists: the payload is far past what an
/// argument holds. The caller removes it once the worker has exited.
fn write_temp_pixels(rgba: &[u8]) -> Result<PathBuf, String> {
    let mut path = std::env::temp_dir();
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    path.push(format!("coilbox-render-{pid}-{nanos}.rgba"));
    std::fs::write(&path, rgba).map_err(|e| format!("could not write the render's pixels: {e}"))?;
    Ok(path)
}

/// Write the units of a render-key batch to a uniquely-named temp file, for the
/// same reason the two above exist: a whole game's roster is tens of kilobytes,
/// which is past what Windows takes on a command line. The caller removes it once
/// the worker has exited.
fn write_temp_list(what: &str, list: &str) -> Result<PathBuf, String> {
    let mut path = std::env::temp_dir();
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    path.push(format!("coilbox-{what}-{pid}-{nanos}.json"));
    std::fs::write(&path, list).map_err(|e| format!("could not write the {what} list: {e}"))?;
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

/// The thumbnail cache key for a map, from what the content scan knows of it.
fn thumb_key(
    map_name: &str,
    archive_path: Option<&str>,
    file_name: Option<&str>,
) -> Option<String> {
    cached::thumb_key_for(map_name, archive_path.map(Path::new), file_name)
}

/// A read answered from the cache, or `None` when there is no answer there and a
/// worker has to be asked (issue #3714). Dev builds log each one beside the
/// worker runs, so a screen's cost can be counted from one log.
fn answered(what: &str, hit: Option<serde_json::Value>) -> Option<CliResult> {
    let value = hit?;
    #[cfg(debug_assertions)]
    devstats::cache_hit(what);
    #[cfg(not(debug_assertions))]
    let _ = what;
    Some(CliResult::ok(value))
}

/// Which worker answers a read.
#[derive(Clone, Copy)]
enum Via {
    /// One that stays running, of the kind named, unless the read ahead of this
    /// one has held it for `patience` or longer. Nearly every read.
    Running {
        kind: pool::Kind,
        patience: Duration,
    },
    /// One started for this read alone. Two sorts of read:
    ///
    /// The engine config read and write, which a running worker refuses
    /// (`serve.rs` in the worker says why) and which run no `Init`, so there is
    /// nothing to save.
    ///
    /// The Lua console, the Lua REPL and the defs probe, which run code the
    /// user wrote. A loop that never ends there holds its worker until the
    /// timeout, and in a worker of its own that holds up nothing else.
    OneShot,
}

/// How long one read may hold a running worker before the reads queued behind
/// it stop waiting and each start a worker of their own.
///
/// [`MINIMAP_TIMEOUT`], the time this file already gives a fast single read
/// before calling it stuck. A read queued behind one that has run that long is
/// behind a read that is stuck or as good as, and without this would wait out
/// the whole of that read's timeout, up to [`SCAN_TIMEOUT`]. Over thirty
/// uncached map pages the longest any read took from being asked for to being
/// answered, its own wait in the queue included, was 13.4s, so ordinary reads
/// stay well under it and still share one `Init`.
const HELD_TOO_LONG: Duration = MINIMAP_TIMEOUT;

/// The value given for `flag` in a worker argument list.
fn flag_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    let at = args.iter().position(|a| a == flag)?;
    args.get(at + 1).map(String::as_str)
}

/// Have a running worker answer one read, and return what it printed.
///
/// The same contract as [`run_worker_blocking`]: the worker prints its JSON,
/// including any error list in it, whatever its exit code, so output is
/// preferred and only a read that printed nothing is an error.
fn run_served_blocking(
    bin: PathBuf,
    args: Vec<String>,
    #[cfg_attr(not(debug_assertions), allow(unused_mut))] mut envs: Vec<(String, String)>,
    timeout: Duration,
    what: String,
    cancel: Option<Arc<AtomicBool>>,
    (kind, patience): (pool::Kind, Duration),
) -> Result<String, String> {
    let (Some(lib), Some(datadir)) = (flag_value(&args, "--lib"), flag_value(&args, "--datadir"))
    else {
        return run_worker_blocking(bin, args, envs, timeout, what, cancel);
    };
    #[cfg(debug_assertions)]
    envs.push((devstats::TIMINGS_ENV.into(), "1".into()));
    #[cfg(debug_assertions)]
    let mut dev_run = devstats::WorkerRun::start(&what);

    let ran = pool::lane(&bin, lib, datadir, &envs, kind).run(&pool::Job {
        args: &args,
        timeout,
        what: &what,
        cancel: cancel.as_deref(),
        patience,
    })?;
    let served = match ran {
        pool::Ran::Served(served) => served,
        pool::Ran::Busy => {
            // The one-shot run logs this read itself.
            #[cfg(debug_assertions)]
            dev_run.handed_on(kind.name());
            return run_worker_blocking(bin, args, envs, timeout, what, cancel);
        }
    };
    #[cfg(debug_assertions)]
    {
        if let Some(pid) = served.started {
            devstats::worker_started(pid, kind.name());
        }
        if let Some(init) = served.init {
            dev_run.ran_init(init.lock_wait_ms, init.call_ms);
        }
    }

    if served.output.iter().all(u8::is_ascii_whitespace) {
        return Err(format!(
            "unitsync worker produced no output (exit {})",
            served.code
        ));
    }
    String::from_utf8(served.output)
        .map_err(|e| format!("unitsync worker output is not valid UTF-8: {e}"))
}

/// Have a worker answer one read and parse its JSON into a `CliResult`. `what`
/// names the operation for error messages.
async fn run_via(
    via: Via,
    bin: PathBuf,
    args: Vec<String>,
    envs: Vec<(String, String)>,
    timeout: Duration,
    what: &str,
    cancel: Option<Arc<AtomicBool>>,
) -> CliResult {
    let what_owned = what.to_string();
    let result = tauri::async_runtime::spawn_blocking(move || match via {
        Via::Running { kind, patience } => {
            let queue = (kind, patience);
            run_served_blocking(bin, args, envs, timeout, what_owned, cancel, queue)
        }
        Via::OneShot => run_worker_blocking(bin, args, envs, timeout, what_owned, cancel),
    })
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

/// A read of one map, game or archive, answered by the engine's page worker.
async fn run_worker(
    bin: PathBuf,
    args: Vec<String>,
    envs: Vec<(String, String)>,
    timeout: Duration,
    what: &str,
    cancel: Option<Arc<AtomicBool>>,
) -> CliResult {
    let via = Via::Running {
        kind: pool::Kind::Page,
        patience: HELD_TOO_LONG,
    };
    run_via(via, bin, args, envs, timeout, what, cancel).await
}

/// A walk of every map or every game, answered by the engine's library worker
/// so a page read never queues behind it.
async fn run_library_worker(
    bin: PathBuf,
    args: Vec<String>,
    envs: Vec<(String, String)>,
    timeout: Duration,
    what: &str,
    cancel: Option<Arc<AtomicBool>>,
) -> CliResult {
    let via = Via::Running {
        kind: pool::Kind::Library,
        patience: HELD_TOO_LONG,
    };
    run_via(via, bin, args, envs, timeout, what, cancel).await
}

/// The scan, answered by the engine's library worker when that is free and by a
/// worker of its own when it is not.
///
/// The lists on screen wait on the scan, and the walks that share the library
/// worker ran for 27.9s, 14.4s and 3.6s with coilbox's caches empty. So a scan
/// waits behind none of them. Its patience is zero, which costs it one `Init`
/// when the worker is busy, the same as it cost before workers stayed running.
async fn run_scan_worker(
    bin: PathBuf,
    args: Vec<String>,
    envs: Vec<(String, String)>,
    cancel: Option<Arc<AtomicBool>>,
) -> CliResult {
    let via = Via::Running {
        kind: pool::Kind::Library,
        patience: Duration::ZERO,
    };
    run_via(via, bin, args, envs, SCAN_TIMEOUT, "scan", cancel).await
}

/// `unitsync_scan` — scan one content root with one engine's libunitsync,
/// returning its maps, games, archives and metadata. `engine_path` is the engine
/// dir holding `libunitsync.*`; `data_dir` is the content root to enumerate.
#[tauri::command]
async fn unitsync_scan(engine_path: String, data_dir: String, op_id: Option<String>) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let args = build_args(&libpath.to_string_lossy(), &data_dir);
    let envs = loader_envs(&engine_dir, &data_dir);
    let cancel = op_id.as_deref().map(register_cancel);
    let res = run_scan_worker(bin, args, envs, cancel).await;
    if let Some(id) = op_id.as_deref() {
        unregister_cancel(id);
    }
    res
}

/// `unitsync_last_scan_write` keeps a good scan on disk as the next launch's first
/// paint. The caller writes only a scan that succeeded, so a failed one never
/// replaces a good one.
#[tauri::command]
async fn unitsync_last_scan_write<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    scan: serde_json::Value,
) -> CliResult {
    let Some(dir) = coilbox_portable::cache_dir(&app)
        .ok()
        .map(|d| d.join(LAST_SCAN_SUBDIR))
    else {
        return CliResult::err("no cache directory on this platform".to_string());
    };
    match lastscan::save(&dir, &engine_path, &data_dir, &scan) {
        Ok(()) => CliResult::ok(serde_json::Value::Null),
        Err(e) => CliResult::err(e),
    }
}

/// `unitsync_last_scan_read` returns the saved scan for a target, or null when
/// there is none, it is unreadable, or it is from another format version.
#[tauri::command]
async fn unitsync_last_scan_read<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
) -> CliResult {
    let saved = coilbox_portable::cache_dir(&app)
        .ok()
        .and_then(|d| lastscan::load(&d.join(LAST_SCAN_SUBDIR), &engine_path, &data_dir));
    CliResult::ok(saved.unwrap_or(serde_json::Value::Null))
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
    archive_path: Option<String>,
    file_name: Option<String>,
) -> CliResult {
    if let Some(hit) = answered(
        "minimap",
        thumb_cache_dir(&app)
            .zip(thumb_key(
                &map_name,
                archive_path.as_deref(),
                file_name.as_deref(),
            ))
            .and_then(|(dir, key)| cached::minimap(&dir, &key, mip.unwrap_or(1)))
            .and_then(|out| serde_json::to_value(out).ok()),
    ) {
        return hit;
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
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
    run_worker(bin, args, envs, MINIMAP_TIMEOUT, "minimap", None).await
}

/// `unitsync_heightmap` — render one map's height infomap as a downscaled
/// grey WebP, with the world heights its black and white stand for so the 3D
/// preview displaces by the right relief. The size is the shared vocabulary's
/// rather than the caller's, so the preview and the hub's `overlay:height` asset
/// are the same bytes (issue #1730).
#[tauri::command]
async fn unitsync_heightmap<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    map_name: String,
    archive_path: Option<String>,
    file_name: Option<String>,
) -> CliResult {
    if let Some(hit) = answered(
        "heightmap",
        thumb_cache_dir(&app)
            .zip(thumb_key(
                &map_name,
                archive_path.as_deref(),
                file_name.as_deref(),
            ))
            .and_then(|(dir, key)| cached::heightmap(&dir, &key))
            .and_then(|out| serde_json::to_value(out).ok()),
    ) {
        return hit;
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = thumb_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_heightmap_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &map_name,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, MINIMAP_TIMEOUT, "heightmap", None).await
}

/// `unitsync_height_field` — write one map's raw 16 bit heights to the thumb
/// cache and report the file, for the terrain check to read them at the depth
/// the engine holds them (issue #1490).
#[tauri::command]
async fn unitsync_height_field<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    map_name: String,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = thumb_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_height_field_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &map_name,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, MINIMAP_TIMEOUT, "height-field", None).await
}

/// `unitsync_metalmap` — render one map's metal infomap as a downscaled green-on-
/// transparent RGBA PNG data URL, for overlaying mex spots on a minimap.
/// `max_side` caps the PNG's longest side (defaults to 1024).
#[tauri::command]
async fn unitsync_metalmap<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    map_name: String,
    max_side: Option<i32>,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = thumb_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_metalmap_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &map_name,
        max_side.unwrap_or(1024),
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, MINIMAP_TIMEOUT, "metalmap", None).await
}

/// `unitsync_thumbnails` — render a small minimap for every map in one session,
/// for the Maps grid. `mip` defaults to 3 (128px).
///
/// `maps` lists every map of the last scan with what its cache key is made from.
/// When each one has a saved thumbnail the plugin answers for those maps itself,
/// and when any one does not a worker answers for the whole library, as it does
/// when no list is given (issue #3736). A map in the library but not in the list
/// is not in the plugin's answer, which is fine for a caller that draws the maps
/// its scan lists.
#[tauri::command]
async fn unitsync_thumbnails<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    mip: Option<i32>,
    op_id: Option<String>,
    maps: Option<Vec<cached::MapRef>>,
) -> CliResult {
    if let Some(hit) = answered(
        "thumbnails",
        thumb_cache_dir(&app)
            .zip(maps.as_deref())
            .and_then(|(dir, maps)| cached::thumbnails(&dir, mip.unwrap_or(3), maps))
            .and_then(|out| serde_json::to_value(out).ok()),
    ) {
        return hit;
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = thumb_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_thumbnails_args(
        &libpath.to_string_lossy(),
        &data_dir,
        mip.unwrap_or(3),
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    let cancel = op_id.as_deref().map(register_cancel);
    let res = run_library_worker(bin, args, envs, SCAN_TIMEOUT, "thumbnails", cancel).await;
    if let Some(id) = op_id.as_deref() {
        unregister_cancel(id);
    }
    res
}

/// `unitsync_game_info` — load one game's archives to read its sides (with start
/// units) and unit count. `game_archive` is the game's primary archive name.
/// `unitsync_map_meta`: read every map's mapinfo metadata in one session, for the
/// map detail page and the singleplayer map card. Disk-cached per map, so after
/// the first run only new or replaced archives cost anything.
#[tauri::command]
async fn unitsync_map_meta<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    op_id: Option<String>,
    maps: Option<Vec<cached::MapRef>>,
) -> CliResult {
    if let Some(hit) = answered(
        "map metadata",
        info_cache_dir(&app)
            .zip(maps.as_deref())
            .and_then(|(dir, maps)| cached::map_metas(&dir, maps))
            .and_then(|out| serde_json::to_value(out).ok()),
    ) {
        return hit;
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = info_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_map_meta_args(&libpath.to_string_lossy(), &data_dir, cache_dir.as_deref());
    let envs = loader_envs(&engine_dir, &data_dir);
    let cancel = op_id.as_deref().map(register_cancel);
    let res = run_library_worker(bin, args, envs, SCAN_TIMEOUT, "map metadata", cancel).await;
    if let Some(id) = op_id.as_deref() {
        unregister_cancel(id);
    }
    res
}

#[tauri::command]
async fn unitsync_game_info<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game_archive: String,
    archive_path: Option<String>,
) -> CliResult {
    if let Some(hit) = answered(
        "game info",
        info_cache_dir(&app)
            .zip(archive_path.as_deref())
            .and_then(|(dir, path)| cached::game_info(&dir, Path::new(path))),
    ) {
        return hit;
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = info_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_game_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &game_archive,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, SCAN_TIMEOUT, "game info", None).await
}

/// `unitsync_unit_buildpics` — resolve build icons for a game's start units in one
/// session. `game_archive` is the game's primary archive; `units` are the units'
/// internal names (e.g. `armcom`). Disk-cached under the app cache dir, keyed on
/// cheap file identity. Returns `{ buildpics: { name: dataUrl }, errors }`.
///
/// `assets` additionally encodes each one as the hub's `buildpic` asset and puts
/// the file where the uploader can read it, reporting it as `asset` on the unit.
/// Off by default: only the blueprint backfill wants it (issue #1636), and the
/// pages that draw icons would be paying for a WebP encode nobody sends.
#[tauri::command]
async fn unitsync_unit_buildpics<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game_archive: String,
    units: Vec<String>,
    assets: Option<bool>,
    archive_path: Option<String>,
) -> CliResult {
    // An asset run wants files only a worker writes, so it never reads the cache.
    if assets != Some(true) {
        if let Some(hit) = answered(
            "unit buildpics",
            buildpic_cache_dir(&app)
                .zip(archive_path.as_deref())
                .and_then(|(dir, path)| cached::unit_buildpics(&dir, Path::new(path), &units))
                .and_then(|out| serde_json::to_value(out).ok()),
        ) {
            return hit;
        }
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = buildpic_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let asset_dir = match assets {
        Some(true) => match hub_asset_dir(&app) {
            Some(dir) => Some(dir.to_string_lossy().into_owned()),
            None => return CliResult::err(
                "no cache directory on this platform, so there is nowhere to write the build pics"
                    .to_string(),
            ),
        },
        _ => None,
    };
    let args = build_unit_buildpics_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &game_archive,
        &units,
        cache_dir.as_deref(),
        asset_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, SCAN_TIMEOUT, "unit buildpics", None).await
}

/// `unitsync_faction_logos` — resolve each side's `Sidepics/<side>` faction emblem
/// for a game in one session. `sides` are the side names (from `unitsync_game_info`).
/// Disk-cached under the app cache dir, keyed on cheap file identity. Returns
/// `{ logos: [{ side, dataUri, maxDim }], errors }`.
#[tauri::command]
async fn unitsync_faction_logos<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game_archive: String,
    sides: Vec<String>,
    archive_path: Option<String>,
) -> CliResult {
    if let Some(hit) = answered(
        "faction logos",
        faction_logo_cache_dir(&app)
            .zip(archive_path.as_deref())
            .and_then(|(dir, path)| cached::faction_logos(&dir, Path::new(path), &sides))
            .and_then(|out| serde_json::to_value(out).ok()),
    ) {
        return hit;
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = faction_logo_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_faction_logos_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &game_archive,
        &sides,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, SCAN_TIMEOUT, "faction logos", None).await
}

/// `unitsync_unit_dataset` — load one game's archives to read its reusable unit
/// graph (every unit plus the internal names it can build, `buildoptions`). Feeds
/// the per-faction build-tree viewer and unit include/exclude filters. Fetched on
/// demand (mounts the game), disk-cached in the info-blob cache dir.
#[tauri::command]
async fn unitsync_unit_dataset<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game_archive: String,
    archive_path: Option<String>,
) -> CliResult {
    if let Some(hit) = answered(
        "unit dataset",
        info_cache_dir(&app)
            .zip(archive_path.as_deref())
            .and_then(|(dir, path)| cached::unit_dataset(&dir, Path::new(path))),
    ) {
        return hit;
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = info_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_unit_dataset_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &game_archive,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, SCAN_TIMEOUT, "unit dataset", None).await
}

/// `unitsync_unit_defs`: load one game's archives and read every key it
/// declares for every unit, out of the game's own def pipeline (issue #1269).
/// The read the unit editor works against, where `unitsync_unit_dataset` above
/// is the curated read a tech tree wants. Disk-cached on the game's sync
/// checksum, so a game update invalidates it.
#[tauri::command]
async fn unitsync_unit_defs<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game_archive: String,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = info_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_unit_defs_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &game_archive,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, SCAN_TIMEOUT, "unit defs", None).await
}

/// `unitsync_custom_params`: load one game's archives and index which of its own
/// Lua files name each custom parameter (issue #2661).
///
/// The engine ignores custom parameters completely, so `unitsync_unit_defs`
/// above can say a unit carries `techlevel` and nothing about what it does. This
/// is the other half: a text search over the game's Lua for the file that reads
/// it. Disk-cached on the game's sync checksum, so a game update invalidates it.
#[tauri::command]
async fn unitsync_custom_params<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game_archive: String,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = info_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_custom_params_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &game_archive,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, SCAN_TIMEOUT, "custom parameters", None).await
}

/// `unitsync_map_info` — load one map's archive set to read its options + any
/// attributed diagnostics. Fetched on demand (mounts the map), not during scan.
/// `unitsync_unit_model`: read one unit's model (`.s3o` or `.3do`) out of a
/// game's archive, flattened into pieces the viewer can draw. `object` is the
/// unitdef's `objectname` verbatim. The model's textures are copied into the
/// model-texture cache dir, which the `unitmodel` asset-protocol root serves, so
/// a 64 MiB compressed atlas never travels through the IPC as base64.
#[tauri::command]
async fn unitsync_unit_model<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game_archive: String,
    object: String,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = model_texture_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_unit_model_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &game_archive,
        &object,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, MODEL_TIMEOUT, "unit model", None).await
}

/// `unitsync_unit_script`: find and read one unit's animation script inside a
/// game's archive.
///
/// `unit` is the unit definition's own key. The script it names is resolved the
/// way the unit script framework resolves it, which is not a plain path lookup:
/// see `unitscriptfile` in the worker.
///
/// A Lua script comes back as text the builder can adopt. A `.cob` comes back
/// as bytes, because it is compiled bytecode rather than something an export
/// could write.
#[tauri::command]
async fn unitsync_unit_script(
    engine_path: String,
    data_dir: String,
    game_archive: String,
    unit: String,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let args = build_unit_script_args(&libpath.to_string_lossy(), &data_dir, &game_archive, &unit);
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, SCAN_TIMEOUT, "unit script", None).await
}

/// `unitsync_unit_models` reads a batch of units' models in one archive mount
/// (issue #1684).
///
/// `unitsync_unit_model` above mounts the game's archive set to read one model,
/// so a blueprint of twenty buildings drew itself in twenty mounts, a second or
/// more each on a game like Beyond All Reason. This is the same read for a list.
///
/// The models come back as file names rather than as models. Each is written into
/// the model-texture cache dir the `unitmodel` asset-protocol root serves, beside
/// the textures it names, so a whole blueprint's geometry never crosses the IPC
/// bridge at once.
#[tauri::command]
async fn unitsync_unit_models<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game_archive: String,
    objects: Vec<String>,
    archive_path: Option<String>,
) -> CliResult {
    if let Some(hit) = answered(
        "unit models",
        model_texture_dir(&app)
            .zip(archive_path.as_deref())
            .and_then(|(dir, path)| cached::unit_models(&dir, Path::new(path), &objects))
            .and_then(|out| serde_json::to_value(out).ok()),
    ) {
        return hit;
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let Some(cache_dir) = model_texture_dir(&app) else {
        return CliResult::err(
            "no cache directory on this platform, so there is nowhere to write the models"
                .to_string(),
        );
    };
    let list = match serde_json::to_string(&objects) {
        Ok(s) => s,
        Err(e) => return CliResult::err(format!("could not send the unit list: {e}")),
    };
    let units_file = match write_temp_list("render-keys", &list) {
        Ok(p) => p,
        Err(e) => return CliResult::err(e),
    };

    let args = build_unit_models_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &game_archive,
        &units_file.to_string_lossy(),
        &cache_dir.to_string_lossy(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    let out = run_worker(bin, args, envs, MODEL_TIMEOUT, "unit models", None).await;
    let _ = std::fs::remove_file(&units_file);
    out
}

/// `unitsync_unit_render` encodes a top down render the webview drew as the
/// hub's `render:<angle>` asset (issue #1631).
///
/// `pixels` is base64 RGBA, top row first, straight alpha: `width * height * 4`
/// bytes once decoded. It goes to the worker in a temp file rather than as an
/// argument, because a 256 square render is a quarter of a megabyte and no
/// platform takes that on a command line.
///
/// The webview draws it and the worker encodes it, which is the split the corpus
/// needs. Drawing needs a GL context and the model readers, which are here.
/// Encoding needs to be the one libwebp the rest of the corpus went through, and
/// letting the canvas write its own WebP would put a second one on the same
/// corpus. So the pixels take the long way round.
///
/// `model_digest`, `source_member` and `source_archive` are what the render was
/// drawn from, and a caller that already has them from `unitsync_unit_render_keys`
/// should pass them (issue #1720). Given, the worker does not mount the game's
/// archive set at all, which on a blueprint of twenty buildings is twenty mounts
/// saved. Left out, the worker mounts and works them out for itself, which is
/// what a caller with no key needs.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn unitsync_unit_render<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game_archive: String,
    object: String,
    angle: String,
    footprint_x: u32,
    footprint_z: u32,
    renderer_version: u32,
    pixels: String,
    width: u32,
    height: u32,
    model_digest: Option<String>,
    source_member: Option<String>,
    source_archive: Option<String>,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let Some(asset_dir) = hub_asset_dir(&app) else {
        return CliResult::err(
            "no cache directory on this platform, so there is nowhere to write the render"
                .to_string(),
        );
    };
    // All three or none, checked before the quarter of a megabyte of pixels is
    // written anywhere. Two of them is a caller that meant to hand the key down
    // and got it wrong, and mounting anyway would hide that behind a slow render
    // nobody would look twice at.
    let source = match (
        model_digest.as_deref(),
        source_member.as_deref(),
        source_archive.as_deref(),
    ) {
        (None, None, None) => None,
        (Some(model_digest), Some(source_member), Some(source_archive)) => Some(RenderSource {
            model_digest: model_digest.to_string(),
            source_member: source_member.to_string(),
            source_archive: source_archive.to_string(),
        }),
        _ => {
            return CliResult::err(
                "a render's model digest, source member and source archive travel together or \
                 not at all"
                    .to_string(),
            )
        }
    };
    let rgba = match base64::engine::general_purpose::STANDARD.decode(&pixels) {
        Ok(bytes) => bytes,
        Err(e) => return CliResult::err(format!("render pixels are not base64: {e}")),
    };
    let pixel_file = match write_temp_pixels(&rgba) {
        Ok(p) => p,
        Err(e) => return CliResult::err(e),
    };

    let args = build_unit_render_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &game_archive,
        &object,
        &angle,
        footprint_x,
        footprint_z,
        renderer_version,
        &pixel_file.to_string_lossy(),
        width,
        height,
        &asset_dir.to_string_lossy(),
        source,
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    let out = run_worker(bin, args, envs, SCAN_TIMEOUT, "unit render", None).await;
    let _ = std::fs::remove_file(&pixel_file);
    out
}

/// One unit of a render-key batch, as the frontend sends it. Passed through to
/// the worker verbatim, so the field names are the worker's.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnitRenderKeyRequest {
    unit: String,
    object: String,
    footprint_x: u32,
    footprint_z: u32,
}

/// `unitsync_unit_render_keys` works out what a batch of units' renders will be
/// called, without drawing any of them (issues #1672 and #1666).
///
/// This is what lets the have check come first for renders. A render's
/// `source_hash` is over the model and its textures, so it can be read out of the
/// archive on its own, and until this existed the only route to one was to draw
/// the picture and encode it, which is the cost the check exists to avoid.
///
/// One call is one archive mount however many units it names, which is the other
/// half of the same change: a blueprint naming twenty buildings used to be twenty
/// mounts, a second or more each on a game like Beyond All Reason.
///
/// `angles` left off means every angle the vocabulary lists, which is the
/// ordinary call: they all come out of that one mount (issue #1951).
#[tauri::command]
async fn unitsync_unit_render_keys<R: Runtime>(
    _app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game_archive: String,
    angles: Option<Vec<String>>,
    renderer_version: u32,
    units: Vec<UnitRenderKeyRequest>,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let list = match serde_json::to_string(&units) {
        Ok(s) => s,
        Err(e) => return CliResult::err(format!("could not send the unit list: {e}")),
    };
    let units_file = match write_temp_list("render-keys", &list) {
        Ok(p) => p,
        Err(e) => return CliResult::err(e),
    };

    let args = build_unit_render_keys_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &game_archive,
        &units_file.to_string_lossy(),
        &angles.unwrap_or_default(),
        renderer_version,
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    let out = run_worker(bin, args, envs, SCAN_TIMEOUT, "unit render keys", None).await;
    let _ = std::fs::remove_file(&units_file);
    out
}

/// `unitsync_remember_render` writes down which unit a drawn render is of, so it
/// can be found again on this machine (issue #1724).
///
/// The encoded file is named after the sha256 of its own bytes, which is the name
/// the hub's object path wants and is unusable to anybody who has not already got
/// the bytes. This records the other name: the game, the unit and the angle a
/// reader actually holds.
///
/// The arguments are the fields `unitsync_unit_render` handed back, so the caller
/// passes them through rather than assembling anything. Called whether or not the
/// picture is then uploaded: see `./renderindex.rs`.
///
/// `path` is the absolute path the encode answered with, and only its file name is
/// kept: the folder is this plugin's own, and a record naming somewhere else would
/// be a record the asset protocol cannot serve.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn unitsync_remember_render<R: Runtime>(
    app: AppHandle<R>,
    game: String,
    unit: String,
    variant: String,
    path: String,
    mime: String,
    encode_profile: String,
    source_hash: String,
    model_digest: String,
    source_archive: String,
    renderer_version: u32,
    width: u32,
    height: u32,
) -> CliResult {
    let Some(dir) = hub_asset_dir(&app) else {
        return CliResult::err(
            "no cache directory on this platform, so there is nowhere to keep the render"
                .to_string(),
        );
    };
    let Some(file) = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
    else {
        return CliResult::err(format!("{path} does not name a file"));
    };
    if !dir.join(&file).is_file() {
        return CliResult::err(format!(
            "{file} is not in the render folder, so there is nothing to point at"
        ));
    }
    let record = renderindex::RenderRecord {
        game,
        unit: unit.to_lowercase(),
        variant,
        file,
        mime,
        encode_profile,
        source_hash,
        model_digest,
        source_archive,
        renderer_version,
        width,
        height,
    };
    if !renderindex::remember(&dir, &record) {
        return CliResult::err("could not write the render's index record".to_string());
    }
    CliResult::ok(serde_json::json!({ "remembered": true }))
}

/// `unitsync_local_renders` finds the renders this machine has already drawn for a
/// batch of units (issue #1724).
///
/// One call for a whole layout, and it reads a few hundred bytes per unit off
/// disk. Nothing is mounted, nothing is drawn, and a unit with no render is simply
/// absent from the answer.
///
/// `renderer_version` is the caller's `RENDER_VERSION` and a record that does not
/// match it is not answered with, so a bump misses everything ever drawn.
/// `source_archive` is the game's archive when the caller knows it, and a record
/// of a different one is then refused too. A caller that does not know gets the
/// version check alone: see `./renderindex.rs` for what that costs.
#[tauri::command]
async fn unitsync_local_renders<R: Runtime>(
    app: AppHandle<R>,
    game: String,
    variant: String,
    renderer_version: u32,
    source_archive: Option<String>,
    units: Vec<String>,
) -> CliResult {
    let Some(dir) = hub_asset_dir(&app) else {
        return CliResult::ok(serde_json::json!({ "renders": serde_json::Map::new() }));
    };
    let found = renderindex::look_up(
        &dir,
        &game,
        &variant,
        renderer_version,
        source_archive.as_deref(),
        &units,
    );
    match serde_json::to_value(found) {
        Ok(renders) => CliResult::ok(serde_json::json!({ "renders": renders })),
        Err(e) => CliResult::err(format!("could not read back the local renders: {e}")),
    }
}

/// `unitsync_map_catalog` reads the installed map library into the entries the
/// hub takes (issue #1737).
///
/// Two passes and the caller chooses which. `keys_only` gives each map\'s name,
/// the sha256 of its archive and the catalog version, which is a have check\'s
/// whole question, and `maps` then names the ones the hub said it wanted so the
/// expensive half is paid for those alone. A map\'s facts cost a read of its
/// whole height grid, and a library is almost entirely maps the hub already
/// holds.
///
/// One call is one `Init` however many maps it covers, and the archive hashes are
/// cached on file identity, so a second sweep over an unchanged library reads no
/// archives at all.
///
/// `on_progress` takes a sample per map as the walk reads it, the same way
/// `unitsync_convert_3do`'s does, so a library that takes tens of seconds to hash
/// is not a window that sits at zero the whole time (issue #3147).
#[tauri::command]
async fn unitsync_map_catalog<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    maps: Option<Vec<String>>,
    keys_only: bool,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let maps_file = match maps {
        None => None,
        Some(names) => {
            let list = match serde_json::to_string(&names) {
                Ok(s) => s,
                Err(e) => return CliResult::err(format!("could not send the map list: {e}")),
            };
            match write_temp_list("map-catalog", &list) {
                Ok(p) => Some(p),
                Err(e) => return CliResult::err(e),
            }
        }
    };
    let cache_dir = info_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = sidecar::build_map_catalog_args(
        &libpath.to_string_lossy(),
        &data_dir,
        maps_file.as_ref().map(|p| p.to_string_lossy()).as_deref(),
        keys_only,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_worker_streaming(
            bin,
            args,
            envs,
            SCAN_TIMEOUT,
            "map catalog".to_string(),
            None,
            on_progress,
        )
    })
    .await;
    if let Some(path) = maps_file {
        let _ = std::fs::remove_file(&path);
    }
    match result {
        Ok(Ok(stdout)) => match serde_json::from_str::<serde_json::Value>(&stdout) {
            Ok(value) => CliResult::ok(value),
            Err(e) => CliResult::err(format!("could not parse unitsync output: {e}")),
        },
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("map catalog task failed: {e}")),
    }
}

/// `unitsync_map_minimaps` names what every installed map's minimap would be
/// called, and with `assets` encodes the pictures themselves (issue #2379).
///
/// Two passes and the caller chooses which, the same shape `unitsync_map_catalog`
/// takes and for the same reason. Without `assets` the walk reads each map's
/// texture and hashes it, which is a have check's whole question, and `maps` then
/// names the ones the hub said it wanted so the WebP encode is paid for those
/// alone. A library is almost entirely maps the hub already holds.
///
/// One call is one `Init` however many maps it covers, and what the survey read
/// is cached on file identity beside the map's own thumbnail, so a second sweep
/// over an unchanged library reads no textures at all.
#[tauri::command]
async fn unitsync_map_minimaps<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    maps: Option<Vec<String>>,
    assets: Option<bool>,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let maps_file = match maps {
        None => None,
        Some(names) => {
            let list = match serde_json::to_string(&names) {
                Ok(s) => s,
                Err(e) => return CliResult::err(format!("could not send the map list: {e}")),
            };
            match write_temp_list("map-minimaps", &list) {
                Ok(p) => Some(p),
                Err(e) => return CliResult::err(e),
            }
        }
    };
    let asset_dir = match assets {
        Some(true) => match hub_asset_dir(&app) {
            Some(dir) => Some(dir.to_string_lossy().into_owned()),
            None => return CliResult::err(
                "no cache directory on this platform, so there is nowhere to write the minimaps"
                    .to_string(),
            ),
        },
        _ => None,
    };
    let cache_dir = thumb_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = sidecar::build_map_minimaps_args(
        &libpath.to_string_lossy(),
        &data_dir,
        maps_file.as_ref().map(|p| p.to_string_lossy()).as_deref(),
        cache_dir.as_deref(),
        asset_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    let out = run_library_worker(bin, args, envs, SCAN_TIMEOUT, "map minimaps", None).await;
    if let Some(path) = maps_file {
        let _ = std::fs::remove_file(&path);
    }
    out
}

#[tauri::command]
async fn unitsync_map_info<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    map_name: String,
    archive_path: Option<String>,
    file_name: Option<String>,
) -> CliResult {
    if let Some(hit) = answered(
        "map info",
        info_cache_dir(&app).and_then(|dir| {
            cached::map_info(
                &dir,
                &map_name,
                archive_path.as_deref().map(Path::new),
                file_name.as_deref(),
            )
        }),
    ) {
        return hit;
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = info_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_map_info_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &map_name,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, MINIMAP_TIMEOUT, "map info", None).await
}

/// `unitsync_map_skybox` — read one map's `atmosphere.skyBox` DDS cube map as raw
/// bytes (a `data:` URL the frontend's `DDSLoader` parses), for the 3D preview's
/// sky. Returns `{ dataUrl?, errors }`; `dataUrl` is absent for the common case of
/// a map with no skybox.
#[tauri::command]
async fn unitsync_map_skybox<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    map_name: String,
    archive_path: Option<String>,
    file_name: Option<String>,
) -> CliResult {
    if let Some(hit) = answered(
        "map skybox",
        info_cache_dir(&app)
            .and_then(|dir| {
                cached::map_skybox(
                    &dir,
                    &map_name,
                    archive_path.as_deref().map(Path::new),
                    file_name.as_deref(),
                )
            })
            .and_then(|out| serde_json::to_value(out).ok()),
    ) {
        return hit;
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = info_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_map_skybox_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &map_name,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, MINIMAP_TIMEOUT, "map skybox", None).await
}

/// `unitsync_skirmish_ais` — list the skirmish AIs available to play against:
/// native engine AIs, plus the selected game's bundled Lua AIs when
/// `game_archive` is given. Returns `{ ais: [{ shortName, version?, name?,
/// description?, kind }], errors }`.
#[tauri::command]
async fn unitsync_skirmish_ais<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    game_archive: Option<String>,
    archive_path: Option<String>,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    // A game named without its archive's path has no key to look under, and
    // reading the list against the wrong archive is what the worker refuses to
    // remember too.
    let game_named = game_archive.as_deref().is_some_and(|g| !g.is_empty());
    let game_path = archive_path.as_deref().map(Path::new);
    if !game_named || game_path.is_some() {
        if let Some(hit) = answered(
            "skirmish ais",
            info_cache_dir(&app).and_then(|dir| {
                cached::skirmish_ais(&dir, &libpath, game_path.filter(|_| game_named))
            }),
        ) {
            return hit;
        }
    }
    let cache_dir = info_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_skirmish_ai_args(
        &libpath.to_string_lossy(),
        &data_dir,
        game_archive.as_deref(),
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, SCAN_TIMEOUT, "skirmish ais", None).await
}

/// `unitsync_engine_config` — read a curated set of engine settings from the
/// user's `springsettings.cfg` via `GetSpringConfig*`. A light unitsync session
/// (no archive scan); `data_dir` selects which data root's config is read.
#[tauri::command]
async fn unitsync_engine_config(engine_path: String, data_dir: String) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let args = build_config_args(&libpath.to_string_lossy(), &data_dir);
    let envs = loader_envs(&engine_dir, &data_dir);
    let via = Via::OneShot;
    run_via(via, bin, args, envs, SCAN_TIMEOUT, "engine config", None).await
}

/// `unitsync_engine_config_set` — write one curated engine setting back to the
/// user's `springsettings.cfg` via `SetSpringConfig*`. `data_dir` selects which
/// data root's config is written (same resolution as the read command); `key`
/// must be a curated catalog key.
#[tauri::command]
async fn unitsync_engine_config_set(
    engine_path: String,
    data_dir: String,
    key: String,
    value: String,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let args = build_config_set_args(&libpath.to_string_lossy(), &data_dir, &key, &value);
    let envs = loader_envs(&engine_dir, &data_dir);
    let via = Via::OneShot;
    run_via(
        via,
        bin,
        args,
        envs,
        SCAN_TIMEOUT,
        "engine config write",
        None,
    )
    .await
}

/// `unitsync_archive_tree` — list the member tree of one archive (and resolve its
/// on-disk path). `archive` is the archive name as unitsync knows it.
///
/// `archive_path` is the archive's own path where the scan placed it (a game), and
/// `file_name` the map file where `archive` is a map's name. Either lets the
/// plugin answer from a saved listing without starting a worker (issue #3736).
#[tauri::command]
async fn unitsync_archive_tree<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    archive: String,
    archive_path: Option<String>,
    file_name: Option<String>,
) -> CliResult {
    if let Some(hit) = answered(
        "archive tree",
        info_cache_dir(&app)
            .and_then(|dir| {
                cached::archive_tree(
                    &dir,
                    &archive,
                    archive_path.as_deref().map(Path::new),
                    file_name.as_deref(),
                )
            })
            .and_then(|out| serde_json::to_value(out).ok()),
    ) {
        return hit;
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = info_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_archive_tree_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &archive,
        cache_dir.as_deref(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, SCAN_TIMEOUT, "archive tree", None).await
}

/// `unitsync_archive_file` — read one member of an archive for preview. `file` is
/// the member's slash-separated path within `archive`. `raw` returns the
/// member's own bytes as an `application/octet-stream` data URL instead, for a
/// hand-made map's models and files over the preview caps (issue #3603).
#[tauri::command]
async fn unitsync_archive_file(
    engine_path: String,
    data_dir: String,
    archive: String,
    file: String,
    raw: Option<bool>,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let args = build_archive_file_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &archive,
        &file,
        raw.unwrap_or(false),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, MINIMAP_TIMEOUT, "archive file", None).await
}

/// `unitsync_game_headers` — batch-resolve loading-screen art for every game in
/// one session, for the Games grid. Disk-cached under the app cache dir, keyed on
/// cheap file identity (not sync-checksum), so it needs no per-game checksum.
#[tauri::command]
async fn unitsync_game_headers<R: Runtime>(
    app: AppHandle<R>,
    engine_path: String,
    data_dir: String,
    games: Option<Vec<cached::GameRef>>,
) -> CliResult {
    if let Some(hit) = answered(
        "game headers",
        header_cache_dir(&app)
            .zip(games.as_deref())
            .and_then(|(dir, games)| cached::game_headers(&dir, games))
            .and_then(|out| serde_json::to_value(out).ok()),
    ) {
        return hit;
    }
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let cache_dir = header_cache_dir(&app).map(|p| p.to_string_lossy().into_owned());
    let args = build_game_headers_args(&libpath.to_string_lossy(), &data_dir, cache_dir.as_deref());
    let envs = loader_envs(&engine_dir, &data_dir);
    run_library_worker(bin, args, envs, SCAN_TIMEOUT, "game headers", None).await
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
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let script = match write_temp_script(&source) {
        Ok(p) => p,
        Err(e) => return CliResult::err(e),
    };
    let args = build_lua_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &archive,
        &script.to_string_lossy(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    let via = Via::OneShot;
    let result = run_via(via, bin, args, envs, MINIMAP_TIMEOUT, "lua exec", None).await;
    let _ = std::fs::remove_file(&script);
    result
}

/// Load `archive`'s definitions once per run in `input`, each run with its
/// own files on top, and read numbers back (issue #3059). `input` is the
/// JSON the worker's `--defs-probe` mode reads, and the answer is the JSON it
/// prints.
///
/// Blocking, and not a command of its own: the workshop's
/// `workshop_settle_typed_values` calls it once per load while it works out
/// what to write, from a blocking task.
pub fn defs_probe_blocking(
    engine_path: &str,
    data_dir: &str,
    archive: &str,
    input: &str,
) -> Result<String, String> {
    let (bin, libpath, engine_dir) = prepare(engine_path)?;
    let path = write_temp_list("defs-probe", input)?;
    let args = build_defs_probe_args(
        &libpath.to_string_lossy(),
        data_dir,
        archive,
        &path.to_string_lossy(),
    );
    let envs = loader_envs(&engine_dir, data_dir);
    // One-shot, like the Lua console: see [`Via::OneShot`].
    let out = run_worker_blocking(bin, args, envs, LUA_TIMEOUT, "defs probe".into(), None);
    let _ = std::fs::remove_file(&path);
    out
}

/// `unitsync_lua_repl_exec` — REPL replay: run `chunks` (the session's
/// previously-successful inputs plus the new one) sequentially in one fresh Lua
/// state, with `archive` mounted. The chunks are handed to the worker as a JSON
/// array via a temp file. Returns `{ result?, error?, divergedAt?, prints?,
/// errors }`.
#[tauri::command]
async fn unitsync_lua_repl_exec(
    engine_path: String,
    data_dir: String,
    archive: String,
    chunks: Vec<String>,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let json = match serde_json::to_string(&chunks) {
        Ok(s) => s,
        Err(e) => return CliResult::err(format!("could not serialize chunks: {e}")),
    };
    let script = match write_temp_script(&json) {
        Ok(p) => p,
        Err(e) => return CliResult::err(e),
    };
    let args = build_lua_repl_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &archive,
        &script.to_string_lossy(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    let via = Via::OneShot;
    let result = run_via(via, bin, args, envs, LUA_TIMEOUT, "lua repl", None).await;
    let _ = std::fs::remove_file(&script);
    result
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
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let args = build_archive_extract_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &archive,
        &file,
        &dest,
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    run_worker(bin, args, envs, MINIMAP_TIMEOUT, "archive extract", None).await
}

/// A whole game's worth of models. Balanced Annihilation is 720 and takes three
/// seconds on this machine, Metal Factions is 1532 and takes seven, but a game
/// nobody has looked at could ship far more. Generous, and cancellation is the
/// real stop.
const CONVERT_TIMEOUT: Duration = Duration::from_secs(1800);

/// `unitsync_convert_3do`: turn every `.3do` in a game into an `.s3o`, one
/// shared texture per model folder, into a folder the caller picked (issue
/// #2573).
///
/// Progress goes down `on_progress` as the run works rather than arriving with
/// the answer, and `op_id` is the handle `unitsync_cancel` stops it by. A
/// cancelled run leaves whatever it had already written, which is said out loud
/// in the UI rather than tidied away behind the user's back: the files are the
/// point of the run, and half a conversion is still worth having.
#[tauri::command]
async fn unitsync_convert_3do(
    engine_path: String,
    data_dir: String,
    archive: String,
    out_dir: String,
    op_id: Option<String>,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> CliResult {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return CliResult::err(e),
    };
    let args = build_convert_3do_args(&libpath.to_string_lossy(), &data_dir, &archive, &out_dir);
    let envs = loader_envs(&engine_dir, &data_dir);
    let cancel = op_id.as_deref().map(register_cancel);

    let result = tauri::async_runtime::spawn_blocking(move || {
        run_worker_streaming(
            bin,
            args,
            envs,
            CONVERT_TIMEOUT,
            "3do conversion".to_string(),
            cancel,
            on_progress,
        )
    })
    .await;
    if let Some(id) = op_id.as_deref() {
        unregister_cancel(id);
    }

    match result {
        Ok(Ok(stdout)) => match serde_json::from_str::<serde_json::Value>(&stdout) {
            Ok(value) => CliResult::ok(value),
            Err(e) => CliResult::err(format!("could not parse unitsync output: {e}")),
        },
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("3do conversion task failed: {e}")),
    }
}

/// `unitsync_cancel` — signal the scan/thumbnail worker registered under `op_id`
/// to stop. No-op if the id is unknown (already finished).
#[tauri::command]
async fn unitsync_cancel(op_id: String) -> CliResult {
    if let Some(flag) = cancel_registry().lock().unwrap().get(&op_id) {
        flag.store(true, Ordering::Relaxed);
    }
    CliResult::ok(serde_json::json!({ "cancelled": true }))
}

/// Build the plugin. Registered as `"coilbox-unitsync"` (crate name minus the
/// `tauri-plugin-` prefix); the frontend invokes `plugin:coilbox-unitsync|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-unitsync")
        // The model-texture cache only ever grows (issue #1919): nothing deleted
        // an entry a bumped `CACHE_VERSION` or an uninstalled game orphaned.
        // Swept here, at the one moment nothing can be mid-render, against each
        // key's own archive on disk rather than unitsync: see `modelcache`.
        .setup(|app, _api| {
            // Whatever deletes or replaces an engine folder asks for its files
            // to be let go of first, and the workers here are what hold them.
            coilbox_proc::on_engine_release(pool::shut_down_under);
            if let Some(dir) = model_texture_dir(app) {
                modelcache::sweep(&dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            unitsync_scan,
            unitsync_last_scan_write,
            unitsync_last_scan_read,
            unitsync_minimap,
            unitsync_heightmap,
            unitsync_height_field,
            unitsync_metalmap,
            unitsync_thumbnails,
            unitsync_map_meta,
            unitsync_game_info,
            unitsync_unit_buildpics,
            unitsync_faction_logos,
            unitsync_unit_dataset,
            unitsync_unit_defs,
            unitsync_custom_params,
            unitsync_unit_model,
            unitsync_unit_models,
            unitsync_unit_script,
            unitsync_unit_render,
            unitsync_unit_render_keys,
            unitsync_remember_render,
            unitsync_local_renders,
            unitsync_map_catalog,
            unitsync_map_minimaps,
            unitsync_map_info,
            unitsync_map_skybox,
            unitsync_skirmish_ais,
            unitsync_engine_config,
            unitsync_engine_config_set,
            unitsync_archive_tree,
            unitsync_archive_file,
            unitsync_game_headers,
            unitsync_lua_exec,
            unitsync_lua_repl_exec,
            unitsync_archive_extract,
            unitsync_convert_3do,
            unitsync_cancel
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_message_names_op_and_seconds() {
        assert_eq!(
            fmt_timeout("scan", Duration::from_secs(300)),
            "unitsync scan timed out after 300s"
        );
    }

    #[test]
    fn cancel_flag_registers_and_signals() {
        let flag = register_cancel("op-1");
        assert!(!flag.load(Ordering::Relaxed));
        // A second lookup sees the same flag and can signal it.
        cancel_registry()
            .lock()
            .unwrap()
            .get("op-1")
            .unwrap()
            .store(true, Ordering::Relaxed);
        assert!(flag.load(Ordering::Relaxed));
        unregister_cancel("op-1");
        assert!(cancel_registry().lock().unwrap().get("op-1").is_none());
    }
}
