//! Locate and run the bundled `pr-downloader` sidecar, plus pure parsers for its
//! human-readable output (it has no `--json` mode).
//!
//! The binary is bundled via Tauri `externalBin`, which places it next to the app
//! executable at runtime (and in the target dir during `tauri dev`). We resolve it
//! there rather than going through the shell plugin, so the plugin's ACL grant
//! stays uniform with every other picoframe plugin (just
//! `coilbox-prdownloader:default`, no extra shell-execute scope).

use std::path::PathBuf;

/// Resolve the sidecar path. `PRD_SIDECAR` overrides everything (handy for dev and
/// tests); otherwise look next to the current executable for `pr-downloader`
/// (`.exe` on Windows), as Tauri's `externalBin` bundling arranges.
pub fn resolve_sidecar() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PRD_SIDECAR") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let candidate = dir.join(format!("pr-downloader{}", std::env::consts::EXE_SUFFIX));
    if candidate.exists() {
        Some(candidate)
    } else {
        None
    }
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
        combined.iter().rev().find(|l| l.to_lowercase().contains(needle)).copied()
    };

    if exit_code == Some(0) {
        let message = contains("complete")
            .or_else(|| contains("download"))
            .map(str::to_string)
            .unwrap_or_else(|| "Download finished.".to_string());
        DownloadOutcome { success: true, message }
    } else {
        let message = contains("error")
            .or_else(|| contains("failed"))
            .map(str::to_string)
            .unwrap_or_else(|| match exit_code {
                Some(c) => format!("pr-downloader exited with code {c}."),
                None => "pr-downloader was terminated.".to_string(),
            });
        DownloadOutcome { success: false, message }
    }
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
        assert_eq!(parse_version("\n  weird-output  \n").as_deref(), Some("weird-output"));
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
}
