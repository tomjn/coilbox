//! Downloads plugin (Rust half), wrapping the pr-downloader sidecar. Proves the
//! picoframe sidecar path:
//! a bundled `externalBin` binary the crate shells out to, with results returned
//! as a [`CliResult`]. Adds rapid-repo browsing (HTTP + gzip) so the frontend can
//! list downloadable content before downloading a tag.

mod progress;
mod rapid;
mod sidecar;
mod sources;

use picoframe_core::CliResult;
use progress::DownloadProgress;
use serde_json::json;
use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Default rapid master index. User-overridable from the frontend — the Spring
/// rapid repo is one of several (BAR, mod-specific repos, etc.).
const DEFAULT_MASTER: &str = "https://repos.springrts.com";

const SIDECAR_MISSING: &str =
    "pr-downloader sidecar not found. Bundle the `prdownloader` resource folder (scripts/assemble-prdownloader.sh) or set PRD_SIDECAR.";

/// Poll interval for the download watchdog and the reqwest cancel checks.
const DL_POLL: Duration = Duration::from_secs(1);

/// Kill a download that transfers no data for this long. This is the "stalled
/// mirror / dead TCP / DNS wedge" case that would otherwise spin forever with no
/// escape — the watchdog (sidecar) and reqwest read-timeout both use it.
const DL_IDLE_LIMIT: Duration = Duration::from_secs(120);

/// Bound the initial connect so a dead host can't hang before any bytes flow.
const DL_CONNECT_LIMIT: Duration = Duration::from_secs(30);

const STALL_MSG: &str =
    "Download stalled — no data received for 2 minutes. Check your connection or try a different mirror, then retry.";
const CANCELLED_MSG: &str = "Download cancelled.";

/// A running download's cancel controls: a `flag` the reqwest chunk loops poll,
/// and (for sidecar downloads) the `child` process to kill. `dl_cancel` looks
/// these up by the caller-supplied op id and trips both.
struct CancelHandle {
    flag: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

/// Maps a caller-supplied op id to its cancel controls, so `dl_cancel` can stop a
/// running download. Mirrors the unitsync plugin's cancel registry; the extra
/// `child` slot is what lets us kill a hung sidecar child (a flag alone can't
/// interrupt a blocking pipe read).
fn cancel_registry() -> &'static Mutex<HashMap<String, CancelHandle>> {
    static REG: OnceLock<Mutex<HashMap<String, CancelHandle>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register cancel controls for `op_id` (replacing any stale entry) and return
/// them. The `child` slot starts empty; the sidecar path fills it once spawned.
fn register_cancel(op_id: &str) -> (Arc<AtomicBool>, Arc<Mutex<Option<Child>>>) {
    let flag = Arc::new(AtomicBool::new(false));
    let child = Arc::new(Mutex::new(None));
    cancel_registry().lock().unwrap().insert(
        op_id.to_string(),
        CancelHandle {
            flag: flag.clone(),
            child: child.clone(),
        },
    );
    (flag, child)
}

/// Drop the entry for `op_id` once its download finishes.
fn unregister_cancel(op_id: &str) {
    cancel_registry().lock().unwrap().remove(op_id);
}

/// Cancel controls for a download. When the caller supplied an `op_id` they are
/// registered (so `dl_cancel` can find them); otherwise they are standalone —
/// the stall watchdog / read-timeout still protect the download, it just can't be
/// user-cancelled. This keeps `op_id` optional so the many background/best-effort
/// callers need no change while still gaining stall protection.
fn cancel_slots(op_id: &Option<String>) -> (Arc<AtomicBool>, Arc<Mutex<Option<Child>>>) {
    match op_id {
        Some(id) => register_cancel(id),
        None => (Arc::new(AtomicBool::new(false)), Arc::new(Mutex::new(None))),
    }
}

/// A reqwest client with idle read + connect timeouts, so a stalled transfer
/// errors out instead of hanging forever. Built per download (cheap) rather than
/// shared, matching the existing per-call `reqwest::get` usage.
fn timed_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(DL_CONNECT_LIMIT)
        .read_timeout(DL_IDLE_LIMIT)
        .build()
        .map_err(|e| e.to_string())
}

/// Fetch a gzipped rapid index over HTTPS and inflate it to text.
async fn fetch_gz(url: String) -> Result<String, String> {
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let resp = resp.error_for_status().map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let mut decoder = flate2::read::GzDecoder::new(&bytes[..]);
    let mut body = String::new();
    decoder
        .read_to_string(&mut body)
        .map_err(|e| format!("gunzip failed: {e}"))?;
    Ok(body)
}

/// Suppress the console window Windows would otherwise pop for the console-mode
/// pr-downloader child (CREATE_NO_WINDOW). No-op on other platforms.
fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// Run the sidecar with the given args on a blocking thread, returning its output.
async fn run_sidecar(args: Vec<String>) -> Result<std::process::Output, String> {
    run_sidecar_env(args, Vec::new()).await
}

/// Like [`run_sidecar`] but sets extra environment variables on the child — used
/// to point pr-downloader at a non-default rapid master (`PRD_RAPID_REPO_MASTER`)
/// or HTTP search URL for repos like Beyond All Reason.
async fn run_sidecar_env(
    args: Vec<String>,
    envs: Vec<(String, String)>,
) -> Result<std::process::Output, String> {
    let path = sidecar::resolve_sidecar().ok_or(SIDECAR_MISSING)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&path);
        cmd.args(&args);
        for (k, v) in &envs {
            cmd.env(k, v);
        }
        hide_console(&mut cmd);
        cmd.output()
    })
    .await
    .map_err(|e| format!("sidecar task failed: {e}"))?
    .map_err(|e| format!("failed to run pr-downloader: {e}"))
}

/// Captured result of a streamed sidecar run, shaped for [`sidecar::parse_download`].
struct SidecarRun {
    stdout: String,
    stderr: String,
    code: Option<i32>,
    /// Set when the run was killed by the user (`dl_cancel`) or the stall
    /// watchdog — carries the actionable message to surface instead of the
    /// generic non-zero-exit verdict.
    aborted: Option<String>,
}

/// Like [`run_sidecar_env`] but streams stdout line-by-line, forwarding any
/// progress lines to `on_progress` as they arrive, while still collecting the
/// full stdout/stderr for the final outcome verdict. stderr is drained on a
/// helper thread so a full pipe can't deadlock the child.
///
/// `cancel`/`child_slot` are the cancel controls: the spawned child is handed to
/// `child_slot` so `dl_cancel` (or the stall watchdog) can kill it. Killing
/// closes stdout, ending the read loop; the run then reports `aborted`.
async fn run_sidecar_streaming(
    args: Vec<String>,
    envs: Vec<(String, String)>,
    on_progress: Channel<DownloadProgress>,
    cancel: Arc<AtomicBool>,
    child_slot: Arc<Mutex<Option<Child>>>,
) -> Result<SidecarRun, String> {
    use std::io::BufReader;
    let path = sidecar::resolve_sidecar().ok_or(SIDECAR_MISSING)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&path);
        cmd.args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (k, v) in &envs {
            cmd.env(k, v);
        }
        hide_console(&mut cmd);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("failed to run pr-downloader: {e}"))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        // Hand the child to the shared slot so the watchdog / dl_cancel can kill
        // it. We keep reading its (already-taken) stdout below.
        *child_slot.lock().unwrap() = Some(child);

        // Drain stderr on a thread, collecting it for the verdict.
        let err_handle = stderr.map(|s| {
            std::thread::spawn(move || {
                let mut buf = String::new();
                let _ = BufReader::new(s).read_to_string(&mut buf);
                buf
            })
        });

        // Watchdog: kill the child on user cancel or after DL_IDLE_LIMIT with no
        // stdout activity. `activity` is set by the read loop on every byte; a
        // stalled connection produces none, so the idle timer runs out and we
        // kill — turning a permanent spinner into an actionable error.
        let activity = Arc::new(AtomicBool::new(true));
        let done = Arc::new(AtomicBool::new(false));
        let stalled = Arc::new(AtomicBool::new(false));
        {
            let child_slot = child_slot.clone();
            let cancel = cancel.clone();
            let activity = activity.clone();
            let done = done.clone();
            let stalled = stalled.clone();
            std::thread::spawn(move || {
                let mut idle = Duration::ZERO;
                loop {
                    std::thread::sleep(DL_POLL);
                    if done.load(Ordering::Relaxed) {
                        return;
                    }
                    if activity.swap(false, Ordering::Relaxed) {
                        idle = Duration::ZERO;
                    } else {
                        idle += DL_POLL;
                    }
                    let is_stall = idle >= DL_IDLE_LIMIT;
                    if cancel.load(Ordering::Relaxed) || is_stall {
                        if is_stall {
                            stalled.store(true, Ordering::Relaxed);
                        }
                        if let Some(c) = child_slot.lock().unwrap().as_mut() {
                            let _ = c.kill();
                        }
                        return;
                    }
                }
            });
        }

        // Read stdout, splitting on BOTH '\n' and '\r': pr-downloader redraws its
        // progress bar in place with carriage returns, so '\n'-only line splitting
        // would buffer the entire 0->100% sequence into one chunk and defer every
        // progress event to the end. Each completed segment is emitted as it arrives.
        // A mid-stream read error ends the loop as if EOF; the collected output still
        // feeds parse_download for the verdict, and the exit code is authoritative.
        let mut out = String::new();
        if let Some(s) = stdout {
            let mut reader = BufReader::new(s);
            let mut seg: Vec<u8> = Vec::new();
            let mut byte = [0u8; 1];
            let flush = |seg: &mut Vec<u8>, out: &mut String| {
                if seg.is_empty() {
                    return;
                }
                let line = String::from_utf8_lossy(seg).into_owned();
                if let Some(p) = sidecar::parse_progress_line(&line) {
                    let _ = on_progress.send(p);
                }
                out.push_str(&line);
                out.push('\n');
                seg.clear();
            };
            loop {
                match reader.read(&mut byte) {
                    Ok(0) => break,
                    Ok(_) => {
                        activity.store(true, Ordering::Relaxed);
                        if byte[0] == b'\n' || byte[0] == b'\r' {
                            flush(&mut seg, &mut out);
                        } else {
                            seg.push(byte[0]);
                        }
                    }
                    Err(_) => break,
                }
            }
            flush(&mut seg, &mut out); // trailing segment with no terminator
        }

        let err = err_handle.and_then(|h| h.join().ok()).unwrap_or_default();
        // Stop the watchdog, then reclaim the child to reap it. Taking it out of
        // the slot (rather than waiting while holding the lock) avoids deadlocking
        // against a concurrent kill.
        done.store(true, Ordering::Relaxed);
        let status = match child_slot.lock().unwrap().take() {
            Some(mut c) => c.wait().map_err(|e| e.to_string())?,
            None => return Err("download child was lost".to_string()),
        };
        let code = status.code();
        let aborted = if stalled.load(Ordering::Relaxed) {
            Some(STALL_MSG.to_string())
        } else if cancel.load(Ordering::Relaxed) {
            Some(CANCELLED_MSG.to_string())
        } else {
            None
        };
        // Only signal completion on a clean, un-aborted exit; otherwise the
        // command turns the output (or the abort reason) into an error verdict.
        if code == Some(0) && aborted.is_none() {
            let _ = on_progress.send(DownloadProgress::done(0, None));
        }
        Ok(SidecarRun {
            stdout: out,
            stderr: err,
            code,
            aborted,
        })
    })
    .await
    .map_err(|e| format!("sidecar task failed: {e}"))?
}

/// `dl_version` — run the sidecar's `--version`, proving the binary is bundled
/// and runnable across the IPC boundary.
#[tauri::command]
async fn dl_version() -> CliResult {
    match run_sidecar(vec!["--version".into()]).await {
        Err(e) => CliResult::err(e),
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            match sidecar::parse_version(&stdout) {
                Some(version) => CliResult::ok(json!({ "version": version })),
                None => CliResult::err("could not parse pr-downloader version output"),
            }
        }
    }
}

/// `dl_cancel` — stop a running download by its `op_id`: trip its cancel flag
/// (reqwest loops break) and kill its sidecar child if any (the pipe closes and
/// the read loop ends). No-op for an unknown/finished id.
#[tauri::command]
fn dl_cancel(op_id: String) -> CliResult {
    if let Some(h) = cancel_registry().lock().unwrap().get(&op_id) {
        h.flag.store(true, Ordering::Relaxed);
        if let Some(child) = h.child.lock().unwrap().as_mut() {
            let _ = child.kill();
        }
    }
    CliResult::ok(json!({}))
}

/// `dl_repos` — list rapid repositories from a master index (default springrts).
#[tauri::command]
async fn dl_repos(master_url: Option<String>) -> CliResult {
    let base = master_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MASTER.into());
    let url = format!("{}/repos.gz", base.trim_end_matches('/'));
    match fetch_gz(url).await {
        Ok(body) => CliResult::ok(json!({ "repos": rapid::parse_repos(&body) })),
        Err(e) => CliResult::err(format!("failed to fetch rapid repos: {e}")),
    }
}

/// `dl_versions` — list downloadable tags within one rapid repository.
#[tauri::command]
async fn dl_versions(repo_url: String) -> CliResult {
    if repo_url.trim().is_empty() {
        return CliResult::err("repo_url is required");
    }
    let url = format!("{}/versions.gz", repo_url.trim_end_matches('/'));
    match fetch_gz(url).await {
        Ok(body) => CliResult::ok(json!({ "versions": rapid::parse_versions(&body) })),
        Err(e) => CliResult::err(format!("failed to fetch rapid versions: {e}")),
    }
}

/// `dl_download` — download a rapid tag via the sidecar, parsing its log output
/// into a success/error envelope. `master_url` (optional) points pr-downloader at
/// a specific rapid master, e.g. Beyond All Reason; absent, the sidecar's default
/// (springrts) is used. `op_id` (optional) makes the download user-cancellable.
#[tauri::command]
async fn dl_download(
    tag: String,
    master_url: Option<String>,
    write_path: Option<String>,
    op_id: Option<String>,
    on_progress: Channel<DownloadProgress>,
) -> CliResult {
    if tag.trim().is_empty() {
        return CliResult::err("tag is required");
    }
    let mut args = vec!["--download-game".to_string(), tag.clone()];
    if let Some(wp) = write_path.filter(|s| !s.trim().is_empty()) {
        args.push("--filesystem-writepath".to_string());
        args.push(wp);
    }
    let mut envs = Vec::new();
    if let Some(m) = master_url.filter(|s| !s.trim().is_empty()) {
        let master = format!("{}/repos.gz", m.trim_end_matches('/'));
        envs.push(("PRD_RAPID_REPO_MASTER".to_string(), master));
        envs.push(("PRD_RAPID_USE_STREAMER".to_string(), "false".to_string()));
    }
    let (cancel, child_slot) = cancel_slots(&op_id);
    let res = run_sidecar_streaming(args, envs, on_progress, cancel, child_slot).await;
    if let Some(id) = &op_id {
        unregister_cancel(id);
    }
    match res {
        Err(e) => CliResult::err(e),
        Ok(run) => {
            if let Some(msg) = run.aborted {
                return CliResult::err(msg);
            }
            let outcome = sidecar::parse_download(&run.stdout, &run.stderr, run.code);
            if outcome.success {
                CliResult::ok(json!({ "message": format!("Downloaded {tag}"), "tag": tag }))
            } else {
                CliResult::err(outcome.message)
            }
        }
    }
}

/// Fetch a URL as text. springfiles/BAR serve plain (non-gzipped) JSON.
async fn fetch_text(url: String) -> Result<String, String> {
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let resp = resp.error_for_status().map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

/// Stream a URL into `dest_dir/filename` (creating the directory), emitting
/// progress over `on_progress` as bytes arrive. Used for non-rapid content (e.g.
/// springfiles game mirrors) the sidecar can't fetch. Removes the partial file
/// if the transfer fails partway. `cancel` (polled each chunk) and the client's
/// idle read-timeout turn a stalled or cancelled transfer into an error.
async fn download_to(
    url: &str,
    dest_dir: &str,
    filename: &str,
    on_progress: &Channel<DownloadProgress>,
    cancel: &Arc<AtomicBool>,
) -> Result<String, String> {
    use std::io::Write;
    use std::time::Instant;

    let mut resp = timed_client()?
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total = resp.content_length();

    let dir = std::path::Path::new(dest_dir);
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {dest_dir}: {e}"))?;
    let path = dir.join(filename);
    let mut file = std::fs::File::create(&path)
        .map_err(|e| format!("could not create {}: {e}", path.display()))?;

    let start = Instant::now();
    let mut last_emit = Instant::now();
    let mut downloaded: u64 = 0;

    let stream_result: Result<(), String> = loop {
        if cancel.load(Ordering::Relaxed) {
            break Err(CANCELLED_MSG.to_string());
        }
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if let Err(e) = file.write_all(&chunk) {
                    break Err(format!("could not write {}: {e}", path.display()));
                }
                downloaded += chunk.len() as u64;
                // Throttle emits to ~10/sec to avoid flooding the channel.
                if last_emit.elapsed().as_millis() >= 100 {
                    last_emit = Instant::now();
                    let _ = on_progress.send(DownloadProgress {
                        phase: "downloading".into(),
                        downloaded_bytes: downloaded,
                        total_bytes: total,
                        percent: progress::percent(downloaded, total),
                        bytes_per_sec: progress::bytes_per_sec(
                            downloaded,
                            start.elapsed().as_secs_f64(),
                        ),
                    });
                }
            }
            Ok(None) => break Ok(()),
            Err(e) if e.is_timeout() => break Err(STALL_MSG.to_string()),
            Err(e) => break Err(e.to_string()),
        }
    };

    if let Err(e) = stream_result {
        let _ = std::fs::remove_file(&path);
        return Err(e);
    }

    let _ = on_progress.send(DownloadProgress::done(downloaded, total));
    Ok(path.display().to_string())
}

/// `dl_springfiles_list` — the full springfiles catalog for a category
/// (`map` / `game`). Search/filtering happens client-side over the list.
#[tauri::command]
async fn dl_springfiles_list(category: String) -> CliResult {
    let url = sources::springfiles_list_url(&category);
    match fetch_text(url).await {
        Ok(body) => match serde_json::from_str::<Vec<sources::SpringFile>>(&body) {
            Ok(results) => CliResult::ok(json!({ "results": results })),
            Err(e) => CliResult::err(format!("could not parse springfiles response: {e}")),
        },
        Err(e) => CliResult::err(format!("failed to fetch springfiles catalog: {e}")),
    }
}

/// `dl_springfiles_engines` — springfiles engines for the current platform,
/// deduped to one row per version (the download id `--download-engine` wants).
#[tauri::command]
async fn dl_springfiles_engines() -> CliResult {
    let token = sources::springfiles_engine_token();
    let url = sources::springfiles_list_url("engine");
    match fetch_text(url).await {
        Ok(body) => match serde_json::from_str::<Vec<sources::SpringFile>>(&body) {
            Ok(all) => {
                let engines = sources::engines_for_platform(all, token);
                CliResult::ok(json!({ "engines": engines, "platform": std::env::consts::OS }))
            }
            Err(e) => CliResult::err(format!("could not parse springfiles engines: {e}")),
        },
        Err(e) => CliResult::err(format!("failed to fetch springfiles engines: {e}")),
    }
}

/// `dl_bar_maps` — the Beyond All Reason validated maps list (with thumbnails).
#[tauri::command]
async fn dl_bar_maps() -> CliResult {
    match fetch_text(sources::BAR_MAPS_URL.to_string()).await {
        Ok(body) => match serde_json::from_str::<Vec<sources::BarMap>>(&body) {
            Ok(maps) => CliResult::ok(json!({ "maps": maps })),
            Err(e) => CliResult::err(format!("could not parse BAR maps list: {e}")),
        },
        Err(e) => CliResult::err(format!("failed to fetch BAR maps list: {e}")),
    }
}

/// `dl_hakora_maps` — the hakora.xyz maps mirror (an Apache autoindex of map
/// archives, HTTP only). Returns filename + url + size; downloads go through the
/// direct `dl_download_file` path (no springname, so no sidecar).
#[tauri::command]
async fn dl_hakora_maps() -> CliResult {
    match fetch_text(sources::HAKORA_MAPS_URL.to_string()).await {
        Ok(body) => CliResult::ok(json!({ "maps": sources::parse_hakora_index(&body) })),
        Err(e) => CliResult::err(format!("failed to fetch hakora maps: {e}")),
    }
}

/// `dl_download_map` — download a map by spring name via the sidecar. `search_url`
/// overrides `PRD_HTTP_SEARCH_URL` (springrts by default; BAR's files-cdn when
/// downloading a BAR map). `op_id` (optional) makes it user-cancellable.
#[tauri::command]
async fn dl_download_map(
    spring_name: String,
    search_url: Option<String>,
    write_path: Option<String>,
    op_id: Option<String>,
    on_progress: Channel<DownloadProgress>,
) -> CliResult {
    if spring_name.trim().is_empty() {
        return CliResult::err("spring_name is required");
    }
    let mut args = vec!["--download-map".to_string(), spring_name.clone()];
    if let Some(wp) = write_path.filter(|s| !s.trim().is_empty()) {
        args.push("--filesystem-writepath".to_string());
        args.push(wp);
    }
    let mut envs = Vec::new();
    if let Some(s) = search_url.filter(|s| !s.trim().is_empty()) {
        envs.push(("PRD_HTTP_SEARCH_URL".to_string(), s));
    }
    let (cancel, child_slot) = cancel_slots(&op_id);
    let res = run_sidecar_streaming(args, envs, on_progress, cancel, child_slot).await;
    if let Some(id) = &op_id {
        unregister_cancel(id);
    }
    match res {
        Err(e) => CliResult::err(e),
        Ok(run) => {
            if let Some(msg) = run.aborted {
                return CliResult::err(msg);
            }
            let outcome = sidecar::parse_download(&run.stdout, &run.stderr, run.code);
            if outcome.success {
                CliResult::ok(
                    json!({ "message": format!("Downloaded {spring_name}"), "springName": spring_name }),
                )
            } else {
                CliResult::err(outcome.message)
            }
        }
    }
}

/// `dl_download_file` — directly download a file (e.g. a springfiles game mirror)
/// into `dest_dir/filename`, for non-rapid content the sidecar can't fetch.
/// `op_id` (optional) makes it user-cancellable.
#[tauri::command]
async fn dl_download_file(
    url: String,
    dest_dir: String,
    filename: String,
    op_id: Option<String>,
    on_progress: Channel<DownloadProgress>,
) -> CliResult {
    if url.trim().is_empty() || filename.trim().is_empty() {
        return CliResult::err("url and filename are required");
    }
    let (cancel, _child_slot) = cancel_slots(&op_id);
    let res = download_to(&url, &dest_dir, &filename, &on_progress, &cancel).await;
    if let Some(id) = &op_id {
        unregister_cancel(id);
    }
    match res {
        Ok(path) => CliResult::ok(json!({ "message": format!("Saved {path}"), "path": path })),
        Err(e) => CliResult::err(e),
    }
}

/// GitHub's API rejects requests without a `User-Agent`; set one explicitly.
async fn fetch_github(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("coilbox")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    let resp = resp.error_for_status().map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

/// `dl_recoil_engines` — Recoil engine releases whose assets match the running
/// platform (`amd64-<os>.7z`). Empty on platforms with no official build (macOS).
#[tauri::command]
async fn dl_recoil_engines() -> CliResult {
    let os = std::env::consts::OS;
    let Some(suffix) = sources::recoil_asset_suffix() else {
        return CliResult::ok(json!({ "releases": [], "platform": os }));
    };
    match fetch_github(sources::RECOIL_RELEASES_URL).await {
        Ok(body) => match serde_json::from_str::<Vec<sources::GithubRelease>>(&body) {
            Ok(rels) => {
                let releases: Vec<_> = rels
                    .iter()
                    .filter_map(|r| sources::match_engine_release(r, suffix))
                    .collect();
                CliResult::ok(json!({ "releases": releases, "platform": os }))
            }
            Err(e) => CliResult::err(format!("could not parse Recoil releases: {e}")),
        },
        Err(e) => CliResult::err(format!("failed to fetch Recoil releases: {e}")),
    }
}

/// `dl_github_latest_release` — the latest GitHub release for an `owner/name`
/// repo, reshaped for the game-updates screen. A distribution profile names the
/// repo whose latest release ships a game archive (and optionally an updated
/// `profile.json`). "Latest" is whatever GitHub's `/releases/latest` returns.
#[tauri::command]
async fn dl_github_latest_release(repo: String) -> CliResult {
    let repo = match sources::validate_repo(&repo) {
        Ok(r) => r,
        Err(e) => return CliResult::err(e),
    };
    let url = sources::latest_release_url(&repo);
    match fetch_github(&url).await {
        Ok(body) => match serde_json::from_str::<sources::GithubRelease>(&body) {
            Ok(rel) => match serde_json::to_value(sources::ReleaseInfo::from(rel)) {
                Ok(v) => CliResult::ok(v),
                Err(e) => CliResult::err(format!("could not encode release: {e}")),
            },
            Err(e) => CliResult::err(format!("could not parse GitHub release: {e}")),
        },
        Err(e) => CliResult::err(format!("failed to fetch latest release: {e}")),
    }
}

/// Download a Recoil `.7z` release and extract it into `<write_path>/engine/<version>/`,
/// emitting download progress then an indeterminate `extracting` phase. `cancel`
/// (polled each chunk) and the idle read-timeout stop a stalled/cancelled fetch;
/// extraction, once started, runs to completion.
async fn install_recoil_engine(
    version: &str,
    asset_url: &str,
    write_path: &str,
    on_progress: &Channel<DownloadProgress>,
    cancel: &Arc<AtomicBool>,
) -> Result<String, String> {
    use std::io::Write;
    use std::time::Instant;

    let engine_root = std::path::Path::new(write_path).join("engine");
    let dest = engine_root.join(version);
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("could not create {}: {e}", dest.display()))?;

    let mut resp = timed_client()?
        .get(asset_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total = resp.content_length();
    let tmp = engine_root.join(format!(".{version}.7z"));
    let mut file =
        std::fs::File::create(&tmp).map_err(|e| format!("could not write engine archive: {e}"))?;

    let start = Instant::now();
    let mut last_emit = Instant::now();
    let mut downloaded: u64 = 0;
    let stream_result: Result<(), String> = loop {
        if cancel.load(Ordering::Relaxed) {
            break Err(CANCELLED_MSG.to_string());
        }
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if let Err(e) = file.write_all(&chunk) {
                    break Err(format!("could not write engine archive: {e}"));
                }
                downloaded += chunk.len() as u64;
                if last_emit.elapsed().as_millis() >= 100 {
                    last_emit = Instant::now();
                    let _ = on_progress.send(DownloadProgress {
                        phase: "downloading".into(),
                        downloaded_bytes: downloaded,
                        total_bytes: total,
                        percent: progress::percent(downloaded, total),
                        bytes_per_sec: progress::bytes_per_sec(
                            downloaded,
                            start.elapsed().as_secs_f64(),
                        ),
                    });
                }
            }
            Ok(None) => break Ok(()),
            Err(e) if e.is_timeout() => break Err(STALL_MSG.to_string()),
            Err(e) => break Err(e.to_string()),
        }
    };
    if let Err(e) = stream_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }

    // Extraction has no easy byte count — report it as an indeterminate phase.
    let _ = on_progress.send(DownloadProgress {
        phase: "extracting".into(),
        downloaded_bytes: downloaded,
        total_bytes: None,
        percent: None,
        bytes_per_sec: None,
    });

    let tmp_for_extract = tmp.clone();
    let dest_for_extract = dest.clone();
    let extracted = tauri::async_runtime::spawn_blocking(move || {
        sevenz_rust2::decompress_file(&tmp_for_extract, &dest_for_extract)
            .map_err(|e| format!("failed to extract engine archive: {e}"))
    })
    .await
    .map_err(|e| format!("extract task failed: {e}"))?;
    let _ = std::fs::remove_file(&tmp);
    extracted?;

    let _ = on_progress.send(DownloadProgress::done(downloaded, total));
    Ok(dest.display().to_string())
}

/// `dl_download_engine_recoil` — install a Recoil engine release into the chosen
/// content root's `engine/<version>/` (download + 7z extract). `op_id` (optional)
/// makes the download phase user-cancellable.
#[tauri::command]
async fn dl_download_engine_recoil(
    version: String,
    asset_url: String,
    write_path: String,
    op_id: Option<String>,
    on_progress: Channel<DownloadProgress>,
) -> CliResult {
    if version.trim().is_empty() || asset_url.trim().is_empty() || write_path.trim().is_empty() {
        return CliResult::err("version, asset_url and write_path are required");
    }
    let (cancel, _child_slot) = cancel_slots(&op_id);
    let res = install_recoil_engine(&version, &asset_url, &write_path, &on_progress, &cancel).await;
    if let Some(id) = &op_id {
        unregister_cancel(id);
    }
    match res {
        Ok(dir) => {
            CliResult::ok(json!({ "message": format!("Installed engine {version}"), "path": dir }))
        }
        Err(e) => CliResult::err(e),
    }
}

/// `dl_download_engine_spring` — download a classic Spring engine via the sidecar's
/// `--download-engine`, which resolves the per-platform build and extracts it.
/// `op_id` (optional) makes it user-cancellable.
#[tauri::command]
async fn dl_download_engine_spring(
    version: String,
    write_path: Option<String>,
    op_id: Option<String>,
    on_progress: Channel<DownloadProgress>,
) -> CliResult {
    if version.trim().is_empty() {
        return CliResult::err("version is required");
    }
    let mut args = vec!["--download-engine".to_string(), version.clone()];
    if let Some(wp) = write_path.filter(|s| !s.trim().is_empty()) {
        args.push("--filesystem-writepath".to_string());
        args.push(wp);
    }
    let (cancel, child_slot) = cancel_slots(&op_id);
    let res = run_sidecar_streaming(args, Vec::new(), on_progress, cancel, child_slot).await;
    if let Some(id) = &op_id {
        unregister_cancel(id);
    }
    match res {
        Err(e) => CliResult::err(e),
        Ok(run) => {
            if let Some(msg) = run.aborted {
                return CliResult::err(msg);
            }
            let outcome = sidecar::parse_download(&run.stdout, &run.stderr, run.code);
            if outcome.success {
                CliResult::ok(
                    json!({ "message": format!("Installed engine {version}"), "version": version }),
                )
            } else {
                CliResult::err(outcome.message)
            }
        }
    }
}

/// Lowercased filenames of the regular files directly inside `dir` (empty if the
/// directory is missing). Used to mark already-installed content.
fn list_filenames(dir: &std::path::Path) -> Vec<String> {
    match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .flatten()
            .filter(|e| e.path().is_file())
            .filter_map(|e| e.file_name().to_str().map(str::to_lowercase))
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// `dl_installed_content` — filenames present in `<path>/maps` and `<path>/games`
/// across every given content root, so the browse screens can mark items already
/// installed anywhere (not just the write root — e.g. a skylobby data dir). Names
/// are lowercased and deduped for case-insensitive matching against `filename`.
#[tauri::command]
async fn dl_installed_content(paths: Vec<String>) -> CliResult {
    let mut maps = std::collections::BTreeSet::new();
    let mut games = std::collections::BTreeSet::new();
    for p in &paths {
        let root = std::path::Path::new(p);
        maps.extend(list_filenames(&root.join("maps")));
        games.extend(list_filenames(&root.join("games")));
    }
    CliResult::ok(json!({
        "maps": maps.into_iter().collect::<Vec<_>>(),
        "games": games.into_iter().collect::<Vec<_>>(),
    }))
}

/// `dl_set_engine_dirs` — register installed-engine directories so the sidecar
/// prefers an engine's own pr-downloader (which ships beside a complete, matched
/// set of runtime DLLs) over the bundled bootstrap copy. The frontend pushes
/// these from content state whenever the roots/engines change.
#[tauri::command]
fn dl_set_engine_dirs(dirs: Vec<String>) -> CliResult {
    let paths = dirs
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .map(std::path::PathBuf::from)
        .collect();
    sidecar::set_engine_dirs(paths);
    CliResult::ok(json!({}))
}

/// Try to create and remove a temp file inside `dir`, reporting whether it's
/// writable. A read-only folder silently blocks downloads and release updates, so
/// the health panel probes the write root and the portable `.coilbox/data` dir.
fn probe_writable(dir: &str) -> (bool, Option<String>) {
    let path = std::path::Path::new(dir);
    if !path.is_dir() {
        return (false, Some("folder does not exist".into()));
    }
    let probe = path.join(format!(".coilbox-write-probe-{}", std::process::id()));
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            (true, None)
        }
        Err(e) => (false, Some(e.to_string())),
    }
}

/// `dl_path_writable` — report whether `path` can be written to.
#[tauri::command]
async fn dl_path_writable(path: String) -> CliResult {
    let (writable, error) = probe_writable(&path);
    CliResult::ok(json!({ "writable": writable, "error": error }))
}

/// Build the plugin. Registered as `"coilbox-downloads"` (crate name minus
/// the `tauri-plugin-` prefix); the frontend invokes
/// `plugin:coilbox-downloads|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-downloads")
        // Capture the resource dir once so the handle-free run_sidecar* helpers can
        // find the bundled `prdownloader/` folder (the sidecar + its Windows DLLs).
        .setup(|app, _api| {
            use tauri::Manager;
            sidecar::set_resource_dir(app.path().resource_dir().ok());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            dl_version,
            dl_cancel,
            dl_repos,
            dl_versions,
            dl_download,
            dl_springfiles_list,
            dl_springfiles_engines,
            dl_bar_maps,
            dl_hakora_maps,
            dl_download_map,
            dl_download_file,
            dl_recoil_engines,
            dl_github_latest_release,
            dl_download_engine_recoil,
            dl_download_engine_spring,
            dl_installed_content,
            dl_set_engine_dirs,
            dl_path_writable
        ])
        .build()
}

#[cfg(test)]
mod writable_tests {
    use super::probe_writable;

    #[test]
    fn writable_dir_reports_true() {
        let dir = std::env::temp_dir();
        let (writable, err) = probe_writable(dir.to_str().unwrap());
        assert!(writable, "temp dir should be writable, got err: {err:?}");
        assert!(err.is_none());
    }

    #[test]
    fn missing_dir_reports_false() {
        let (writable, err) = probe_writable("/no/such/path/coilbox-xyz");
        assert!(!writable);
        assert!(err.is_some());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_registers_signals_and_unregisters() {
        let op = "dl-test-op-1";
        let (flag, child) = register_cancel(op);
        assert!(!flag.load(Ordering::Relaxed));

        // dl_cancel trips the flag (and would kill a child if present).
        dl_cancel(op.to_string());
        assert!(flag.load(Ordering::Relaxed), "flag set by dl_cancel");
        assert!(child.lock().unwrap().is_none(), "no child for a reqwest op");

        unregister_cancel(op);
        assert!(
            cancel_registry().lock().unwrap().get(op).is_none(),
            "entry removed after unregister"
        );
    }

    #[test]
    fn cancel_unknown_op_is_noop() {
        // Must not panic or insert anything for an id that was never registered.
        dl_cancel("never-registered".to_string());
        assert!(cancel_registry()
            .lock()
            .unwrap()
            .get("never-registered")
            .is_none());
    }

    #[test]
    fn no_op_id_yields_unregistered_slots() {
        let before = cancel_registry().lock().unwrap().len();
        let (flag, _child) = cancel_slots(&None);
        // Standalone slots are not in the registry, so dl_cancel can't reach them.
        assert_eq!(before, cancel_registry().lock().unwrap().len());
        assert!(!flag.load(Ordering::Relaxed));
    }
}
