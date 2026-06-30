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
use std::io::Read;
use std::process::{Command, Stdio};
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Default rapid master index. User-overridable from the frontend — the Spring
/// rapid repo is one of several (BAR, mod-specific repos, etc.).
const DEFAULT_MASTER: &str = "https://repos.springrts.com";

const SIDECAR_MISSING: &str =
    "pr-downloader sidecar not found. Bundle it via tauri.conf.json `externalBin` or set PRD_SIDECAR.";

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
}

/// Like [`run_sidecar_env`] but streams stdout line-by-line, forwarding any
/// progress lines to `on_progress` as they arrive, while still collecting the
/// full stdout/stderr for the final outcome verdict. stderr is drained on a
/// helper thread so a full pipe can't deadlock the child.
async fn run_sidecar_streaming(
    args: Vec<String>,
    envs: Vec<(String, String)>,
    on_progress: Channel<DownloadProgress>,
) -> Result<SidecarRun, String> {
    use std::io::BufReader;
    let path = sidecar::resolve_sidecar().ok_or(SIDECAR_MISSING)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&path);
        cmd.args(&args).stdout(Stdio::piped()).stderr(Stdio::piped());
        for (k, v) in &envs {
            cmd.env(k, v);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("failed to run pr-downloader: {e}"))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Drain stderr on a thread, collecting it for the verdict.
        let err_handle = stderr.map(|s| {
            std::thread::spawn(move || {
                let mut buf = String::new();
                let _ = BufReader::new(s).read_to_string(&mut buf);
                buf
            })
        });

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
        let status = child.wait().map_err(|e| e.to_string())?;
        let code = status.code();
        // Only signal completion on a clean exit; on failure the command turns the
        // collected output into an error verdict and the UI reports that instead.
        if code == Some(0) {
            let _ = on_progress.send(DownloadProgress::done(0, None));
        }
        Ok(SidecarRun {
            stdout: out,
            stderr: err,
            code,
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
/// (springrts) is used.
#[tauri::command]
async fn dl_download(
    tag: String,
    master_url: Option<String>,
    write_path: Option<String>,
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
    match run_sidecar_streaming(args, envs, on_progress).await {
        Err(e) => CliResult::err(e),
        Ok(run) => {
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
/// if the transfer fails partway.
async fn download_to(
    url: &str,
    dest_dir: &str,
    filename: &str,
    on_progress: &Channel<DownloadProgress>,
) -> Result<String, String> {
    use std::io::Write;
    use std::time::Instant;

    let mut resp = reqwest::get(url)
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total = resp.content_length();

    let dir = std::path::Path::new(dest_dir);
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {dest_dir}: {e}"))?;
    let path = dir.join(filename);
    let mut file =
        std::fs::File::create(&path).map_err(|e| format!("could not create {}: {e}", path.display()))?;

    let start = Instant::now();
    let mut last_emit = Instant::now();
    let mut downloaded: u64 = 0;

    let stream_result: Result<(), String> = loop {
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
/// downloading a BAR map).
#[tauri::command]
async fn dl_download_map(
    spring_name: String,
    search_url: Option<String>,
    write_path: Option<String>,
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
    match run_sidecar_streaming(args, envs, on_progress).await {
        Err(e) => CliResult::err(e),
        Ok(run) => {
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
#[tauri::command]
async fn dl_download_file(
    url: String,
    dest_dir: String,
    filename: String,
    on_progress: Channel<DownloadProgress>,
) -> CliResult {
    if url.trim().is_empty() || filename.trim().is_empty() {
        return CliResult::err("url and filename are required");
    }
    match download_to(&url, &dest_dir, &filename, &on_progress).await {
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

/// Download a Recoil `.7z` release and extract it into `<write_path>/engine/<version>/`,
/// emitting download progress then an indeterminate `extracting` phase.
async fn install_recoil_engine(
    version: &str,
    asset_url: &str,
    write_path: &str,
    on_progress: &Channel<DownloadProgress>,
) -> Result<String, String> {
    use std::io::Write;
    use std::time::Instant;

    let engine_root = std::path::Path::new(write_path).join("engine");
    let dest = engine_root.join(version);
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("could not create {}: {e}", dest.display()))?;

    let mut resp = reqwest::get(asset_url)
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total = resp.content_length();
    let tmp = engine_root.join(format!(".{version}.7z"));
    let mut file = std::fs::File::create(&tmp)
        .map_err(|e| format!("could not write engine archive: {e}"))?;

    let start = Instant::now();
    let mut last_emit = Instant::now();
    let mut downloaded: u64 = 0;
    let stream_result: Result<(), String> = loop {
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
/// content root's `engine/<version>/` (download + 7z extract).
#[tauri::command]
async fn dl_download_engine_recoil(
    version: String,
    asset_url: String,
    write_path: String,
    on_progress: Channel<DownloadProgress>,
) -> CliResult {
    if version.trim().is_empty() || asset_url.trim().is_empty() || write_path.trim().is_empty() {
        return CliResult::err("version, asset_url and write_path are required");
    }
    match install_recoil_engine(&version, &asset_url, &write_path, &on_progress).await {
        Ok(dir) => {
            CliResult::ok(json!({ "message": format!("Installed engine {version}"), "path": dir }))
        }
        Err(e) => CliResult::err(e),
    }
}

/// `dl_download_engine_spring` — download a classic Spring engine via the sidecar's
/// `--download-engine`, which resolves the per-platform build and extracts it.
#[tauri::command]
async fn dl_download_engine_spring(
    version: String,
    write_path: Option<String>,
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
    match run_sidecar_streaming(args, Vec::new(), on_progress).await {
        Err(e) => CliResult::err(e),
        Ok(run) => {
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

/// Build the plugin. Registered as `"coilbox-downloads"` (crate name minus
/// the `tauri-plugin-` prefix); the frontend invokes
/// `plugin:coilbox-downloads|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-downloads")
        .invoke_handler(tauri::generate_handler![
            dl_version,
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
            dl_download_engine_recoil,
            dl_download_engine_spring,
            dl_installed_content
        ])
        .build()
}
