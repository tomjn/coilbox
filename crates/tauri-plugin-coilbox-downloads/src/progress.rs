//! Progress events streamed to the frontend over a Tauri `Channel` during a
//! download. One flat, camelCase-serialized struct covers both download paths
//! (HTTP byte streaming and the pr-downloader sidecar); fields that a given
//! source can't supply are `None` (e.g. the sidecar rarely reports speed).

use serde::Serialize;

/// A single progress sample for an in-flight download.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// Coarse stage: `"downloading"`, `"extracting"`, or `"done"`.
    pub phase: String,
    pub downloaded_bytes: u64,
    /// Total size if known; `None` for chunked responses without a
    /// `Content-Length` and for indeterminate phases (e.g. extraction).
    pub total_bytes: Option<u64>,
    /// 0..=100, or `None` when the total is unknown.
    pub percent: Option<f64>,
    /// Average transfer rate; `None` when unknown.
    pub bytes_per_sec: Option<f64>,
}

impl DownloadProgress {
    /// A terminal "done" sample; `percent` is forced to 100 when a total was known.
    pub fn done(downloaded_bytes: u64, total_bytes: Option<u64>) -> Self {
        DownloadProgress {
            phase: "done".into(),
            downloaded_bytes,
            total_bytes,
            percent: total_bytes.map(|_| 100.0),
            bytes_per_sec: None,
        }
    }
}

/// Percentage `done` is of `total` (0..=100), or `None` when `total` is absent
/// or zero. Clamps to 100 in case a source over-reports.
pub fn percent(done: u64, total: Option<u64>) -> Option<f64> {
    match total {
        Some(t) if t > 0 => Some(((done as f64 / t as f64) * 100.0).min(100.0)),
        _ => None,
    }
}

/// Average bytes/sec for `done` bytes over `elapsed_secs`, or `None` when no
/// measurable time has passed.
pub fn bytes_per_sec(done: u64, elapsed_secs: f64) -> Option<f64> {
    if elapsed_secs > 0.0 {
        Some(done as f64 / elapsed_secs)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_basic() {
        assert_eq!(percent(50, Some(200)), Some(25.0));
    }

    #[test]
    fn percent_unknown_total_is_none() {
        assert_eq!(percent(50, None), None);
        assert_eq!(percent(50, Some(0)), None);
    }

    #[test]
    fn percent_clamps_to_100() {
        assert_eq!(percent(300, Some(200)), Some(100.0));
    }

    #[test]
    fn speed_basic() {
        assert_eq!(bytes_per_sec(1000, 2.0), Some(500.0));
    }

    #[test]
    fn speed_zero_elapsed_is_none() {
        assert_eq!(bytes_per_sec(1000, 0.0), None);
    }

    #[test]
    fn done_forces_full_percent_when_total_known() {
        let p = DownloadProgress::done(200, Some(200));
        assert_eq!(p.percent, Some(100.0));
        assert_eq!(p.phase, "done");
    }
}
