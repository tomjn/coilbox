//! Locate and run the bundled `pr-downloader` sidecar, plus pure parsers for its
//! human-readable output (it has no `--json` mode).
//!
//! The binary is bundled as a Tauri *resource folder* (`prdownloader/`), not an
//! `externalBin`: the Windows build is MinGW and loads libcurl/zlib/winpthread
//! DLLs from its own directory, so it must ship beside those DLLs (externalBin
//! copies only the lone binary — a clean Windows machine then hits
//! STATUS_DLL_NOT_FOUND). We resolve it under `resource_dir()/prdownloader/`
//! rather than going through the shell plugin, so the plugin's ACL grant stays
//! uniform with every other picoframe plugin (just `coilbox-downloads:default`,
//! no extra shell-execute scope).

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

/// App resource dir, captured once at plugin setup (where the `AppHandle` is
/// available) so the handle-free `run_sidecar*` helpers can resolve the bundled
/// folder without threading an `AppHandle` through every command.
static RESOURCE_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Directories of installed engines, each of which may hold its own
/// pr-downloader beside a complete, self-matched set of runtime DLLs (a Recoil
/// build ships pr-downloader next to `spring`). Registered from the frontend via
/// `dl_set_engine_dirs` and consulted on every resolve, so a freshly installed
/// engine is used without a restart. Preferred over the bundled bootstrap copy.
static ENGINE_DIRS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Record the app resource dir at plugin setup. First write wins; later calls are
/// no-ops (there is only one resource dir per process).
pub fn set_resource_dir(dir: Option<PathBuf>) {
    let _ = RESOURCE_DIR.set(dir);
}

/// Replace the set of installed-engine directories to search for a bundled
/// pr-downloader. Called whenever the content roots / engines change.
pub fn set_engine_dirs(dirs: Vec<PathBuf>) {
    if let Ok(mut guard) = ENGINE_DIRS.lock() {
        *guard = dirs;
    }
}

/// First registered engine directory that actually contains a pr-downloader
/// binary named `name`, if any.
fn engine_sidecar(name: &str) -> Option<PathBuf> {
    let dirs = ENGINE_DIRS.lock().ok()?;
    dirs.iter().map(|d| d.join(name)).find(|c| c.exists())
}

/// Resolve the sidecar path (`.exe` suffix added on Windows), in priority order:
/// 1. `PRD_SIDECAR` env override (dev and tests);
/// 2. an installed engine's own pr-downloader (a complete, self-matched runtime);
/// 3. the bundled `prdownloader/` resource folder (bootstrap copy);
/// 4. next to the current executable (legacy/fallback layout).
pub fn resolve_sidecar() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PRD_SIDECAR") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    let name = format!("pr-downloader{}", std::env::consts::EXE_SUFFIX);
    if let Some(p) = engine_sidecar(&name) {
        return Some(p);
    }
    if let Some(Some(dir)) = RESOURCE_DIR.get() {
        // The Windows installer tucks the resource folder into `.coilbox` to keep
        // the install root clean; fall back to the plain resource layout (macOS/
        // Linux, and if the move didn't run). The whole `prdownloader/` folder
        // moves together, so its sibling DLLs stay beside the binary.
        let tucked = dir.join(".coilbox").join("prdownloader").join(&name);
        if tucked.exists() {
            return Some(tucked);
        }
        let candidate = dir.join("prdownloader").join(&name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let candidate = exe.parent()?.join(&name);
    candidate.exists().then_some(candidate)
}

/// Extract the version token from `pr-downloader --version` output, e.g.
/// `pr-downloader 0.7-767-g1b95b70 (macos_arm64)` -> `0.7-767-g1b95b70`. Falls
/// back to the first non-empty trimmed line when the expected shape is absent.
pub fn parse_version(output: &str) -> Option<String> {
    let line = output.lines().map(str::trim).find(|l| !l.is_empty())?;
    let rest = line.strip_prefix("pr-downloader ").unwrap_or(line);
    let token = rest.split_whitespace().next().unwrap_or(rest);
    Some(token.to_string())
}

/// Outcome of a download run: success flag plus a one-line human summary.
#[derive(Debug, Clone, PartialEq)]
pub struct DownloadOutcome {
    pub success: bool,
    pub message: String,
}

/// Interpret a finished `pr-downloader` download. Exit code is authoritative for
/// success; the message is the most relevant log line (it has no structured
/// output). `stdout`/`stderr` are searched together since pr-downloader logs to
/// both depending on level.
pub fn parse_download(stdout: &str, stderr: &str, exit_code: Option<i32>) -> DownloadOutcome {
    let combined: Vec<&str> = stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let contains = |needle: &str| {
        combined
            .iter()
            .rev()
            .find(|l| l.to_lowercase().contains(needle))
            .copied()
    };

    if exit_code == Some(0) {
        let message = contains("complete")
            .or_else(|| contains("download"))
            .map(str::to_string)
            .unwrap_or_else(|| "Download finished.".to_string());
        DownloadOutcome {
            success: true,
            message,
        }
    } else {
        let message = contains("error")
            .or_else(|| contains("failed"))
            .map(str::to_string)
            .unwrap_or_else(|| match exit_code {
                Some(c) => format!("pr-downloader exited with code {c}."),
                None => "pr-downloader was terminated.".to_string(),
            });
        DownloadOutcome {
            success: false,
            message,
        }
    }
}

use crate::progress::{percent, DownloadProgress};

/// Parse one line of pr-downloader stdout into a progress sample, or `None` when
/// the line carries no progress. Tolerant by design: matches a line containing a
/// `[Progress]`/`Progress` marker and an `NN%` token, and additionally captures a
/// `downloaded/total` byte pair when present (e.g.
/// `[Progress] 42% [===>   ] 123456/294000`).
pub fn parse_progress_line(line: &str) -> Option<DownloadProgress> {
    let lower = line.to_lowercase();
    if !lower.contains("progress") {
        return None;
    }
    // Percent: the token immediately before a '%'.
    let pct = line.split('%').next().and_then(|head| {
        head.rsplit(|c: char| !(c.is_ascii_digit() || c == '.'))
            .find(|t| !t.is_empty())
            .and_then(|t| t.parse::<f64>().ok())
    })?;

    // Optional "downloaded/total" pair: first whitespace-delimited token of the
    // form <digits>/<digits>.
    let pair = line.split_whitespace().find_map(|tok| {
        let (a, b) = tok.split_once('/')?;
        Some((a.parse::<u64>().ok()?, b.parse::<u64>().ok()?))
    });

    let (downloaded, total) = match pair {
        Some((d, t)) => (d, Some(t)),
        None => (0, None),
    };

    Some(DownloadProgress {
        phase: "downloading".into(),
        downloaded_bytes: downloaded,
        total_bytes: total,
        // Prefer a byte-derived percent when we have the pair, else the printed %.
        percent: percent(downloaded, total).or(Some(pct.min(100.0))),
        bytes_per_sec: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_version_token() {
        assert_eq!(
            parse_version("pr-downloader 0.7-767-g1b95b70 (macos_arm64)\n").as_deref(),
            Some("0.7-767-g1b95b70")
        );
    }

    #[test]
    fn version_falls_back_to_first_line() {
        assert_eq!(
            parse_version("\n  weird-output  \n").as_deref(),
            Some("weird-output")
        );
    }

    #[test]
    fn version_empty_is_none() {
        assert_eq!(parse_version("   \n\n"), None);
    }

    #[test]
    fn download_success_picks_complete_line() {
        let out = "[Progress] 50%\nDownload complete!\n";
        let o = parse_download(out, "", Some(0));
        assert!(o.success);
        assert_eq!(o.message, "Download complete!");
    }

    #[test]
    fn download_success_without_complete_line_has_default() {
        let o = parse_download("[Info] some chatter\n", "", Some(0));
        assert!(o.success);
        assert_eq!(o.message, "Download finished.");
    }

    #[test]
    fn download_failure_picks_error_line() {
        let err = "Failed to find 'nope' for download\n";
        let o = parse_download("", err, Some(1));
        assert!(!o.success);
        assert_eq!(o.message, "Failed to find 'nope' for download");
    }

    #[test]
    fn download_failure_without_error_line_reports_code() {
        let o = parse_download("", "", Some(3));
        assert!(!o.success);
        assert_eq!(o.message, "pr-downloader exited with code 3.");
    }

    #[test]
    fn progress_percent_only() {
        let p = parse_progress_line("[Progress] 50% [=====     ]").unwrap();
        assert_eq!(p.percent, Some(50.0));
        assert_eq!(p.total_bytes, None);
        assert_eq!(p.phase, "downloading");
    }

    #[test]
    fn progress_with_byte_pair() {
        let p = parse_progress_line("[Progress] 42% [==>  ] 123456/294000").unwrap();
        assert_eq!(p.downloaded_bytes, 123456);
        assert_eq!(p.total_bytes, Some(294000));
        // byte-derived percent wins over the printed token
        assert_eq!(p.percent, super::percent(123456, Some(294000)));
    }

    #[test]
    fn progress_non_progress_line_is_none() {
        assert!(parse_progress_line("[Info] connecting to repo").is_none());
        assert!(parse_progress_line("Download complete!").is_none());
    }
}
