//! Downloads plugin (Rust half), wrapping the pr-downloader sidecar. Proves the
//! picoframe sidecar path:
//! a bundled `externalBin` binary the crate shells out to, with results returned
//! as a [`CliResult`]. Adds rapid-repo browsing (HTTP + gzip) so the frontend can
//! list downloadable content before downloading a tag.

mod rapid;
mod sidecar;
mod sources;

use picoframe_core::CliResult;
use serde_json::json;
use std::io::Read;
use std::process::Command;
use tauri::{
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
    match run_sidecar_env(args, envs).await {
        Err(e) => CliResult::err(e),
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let outcome = sidecar::parse_download(&stdout, &stderr, out.status.code());
            if outcome.success {
                CliResult::ok(json!({ "message": outcome.message, "tag": tag }))
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

/// Stream a URL into `dest_dir/filename` (creating the directory). Used for
/// non-rapid content (e.g. springfiles game mirrors) the sidecar can't fetch.
async fn download_to(url: &str, dest_dir: &str, filename: &str) -> Result<String, String> {
    let resp = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let resp = resp.error_for_status().map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let dir = std::path::Path::new(dest_dir);
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {dest_dir}: {e}"))?;
    let path = dir.join(filename);
    std::fs::write(&path, &bytes)
        .map_err(|e| format!("could not write {}: {e}", path.display()))?;
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

/// `dl_download_map` — download a map by spring name via the sidecar. `search_url`
/// overrides `PRD_HTTP_SEARCH_URL` (springrts by default; BAR's files-cdn when
/// downloading a BAR map).
#[tauri::command]
async fn dl_download_map(
    spring_name: String,
    search_url: Option<String>,
    write_path: Option<String>,
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
    match run_sidecar_env(args, envs).await {
        Err(e) => CliResult::err(e),
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let outcome = sidecar::parse_download(&stdout, &stderr, out.status.code());
            if outcome.success {
                CliResult::ok(json!({ "message": outcome.message, "springName": spring_name }))
            } else {
                CliResult::err(outcome.message)
            }
        }
    }
}

/// `dl_download_file` — directly download a file (e.g. a springfiles game mirror)
/// into `dest_dir/filename`, for non-rapid content the sidecar can't fetch.
#[tauri::command]
async fn dl_download_file(url: String, dest_dir: String, filename: String) -> CliResult {
    if url.trim().is_empty() || filename.trim().is_empty() {
        return CliResult::err("url and filename are required");
    }
    match download_to(&url, &dest_dir, &filename).await {
        Ok(path) => CliResult::ok(json!({ "message": format!("Saved {path}"), "path": path })),
        Err(e) => CliResult::err(e),
    }
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
            dl_bar_maps,
            dl_download_map,
            dl_download_file
        ])
        .build()
}
