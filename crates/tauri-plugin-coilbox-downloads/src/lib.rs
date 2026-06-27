//! Downloads plugin (Rust half), wrapping the pr-downloader sidecar. Proves the
//! picoframe sidecar path:
//! a bundled `externalBin` binary the crate shells out to, with results returned
//! as a [`CliResult`]. Adds rapid-repo browsing (HTTP + gzip) so the frontend can
//! list downloadable content before downloading a tag.

mod rapid;
mod sidecar;

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
    let path = sidecar::resolve_sidecar().ok_or(SIDECAR_MISSING)?;
    tauri::async_runtime::spawn_blocking(move || Command::new(&path).args(&args).output())
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
/// into a success/error envelope.
#[tauri::command]
async fn dl_download(tag: String, write_path: Option<String>) -> CliResult {
    if tag.trim().is_empty() {
        return CliResult::err("tag is required");
    }
    let mut args = vec!["--download-game".to_string(), tag.clone()];
    if let Some(wp) = write_path.filter(|s| !s.trim().is_empty()) {
        args.push("--filesystem-writepath".to_string());
        args.push(wp);
    }
    match run_sidecar(args).await {
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

/// Build the plugin. Registered as `"coilbox-downloads"` (crate name minus
/// the `tauri-plugin-` prefix); the frontend invokes
/// `plugin:coilbox-downloads|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-downloads")
        .invoke_handler(tauri::generate_handler![
            dl_version,
            dl_repos,
            dl_versions,
            dl_download
        ])
        .build()
}
