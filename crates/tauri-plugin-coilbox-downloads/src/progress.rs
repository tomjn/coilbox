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
    /// Whether this sample says anything about how far the download has got.
    ///
    /// A sample with no bytes and no percentage is not a measurement of zero, it
    /// is the absence of one: pr-downloader prints `0/0` for a response that
    /// carried no length, and its logger then drops every later line because the
    /// percentage it works out never changes. Anything that reads silence as
    /// trouble has to know the difference between a download that stopped
    /// reporting and one that never reported.
    pub fn is_measured(&self) -> bool {
        self.downloaded_bytes > 0 || self.percent.is_some()
    }

    /// The one thing coilbox says while an archive is being unpacked, whichever
    /// path downloaded it.
    ///
    /// Unpacking has no byte count either path can offer: coilbox hands the file
    /// to `sevenz_rust2` and waits, and pr-downloader prints a path per file and
    /// no numbers at all. So the sample carries none, and reads as unmeasured
    /// rather than as a transfer that has stopped moving. The alternative, an
    /// honest-looking byte count that cannot change until the unpack ends, is
    /// indistinguishable from a stall to anything watching for one (issue #1830).
    ///
    /// Nothing on screen loses a number by this. The caption switches to
    /// "Extracting…" on the phase before it reads any of these fields, the bar is
    /// indeterminate without a percentage, and the topbar badge shows a
    /// percentage or a time left or nothing.
    pub fn extracting() -> Self {
        DownloadProgress {
            phase: "extracting".into(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: None,
            bytes_per_sec: None,
        }
    }

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

    fn sample(downloaded: u64, total: Option<u64>) -> DownloadProgress {
        DownloadProgress {
            phase: "downloading".into(),
            downloaded_bytes: downloaded,
            total_bytes: total,
            percent: percent(downloaded, total),
            bytes_per_sec: None,
        }
    }

    #[test]
    fn bytes_or_a_percentage_count_as_a_measurement() {
        assert!(sample(0, Some(2000)).is_measured());
        assert!(sample(500, Some(2000)).is_measured());
        assert!(sample(500, None).is_measured());
    }

    #[test]
    fn nothing_at_all_is_not_a_measurement_of_zero() {
        // What pr-downloader prints for a response with no length: `0/0`.
        assert!(!sample(0, Some(0)).is_measured());
        assert!(!sample(0, None).is_measured());
    }

    /// Both install paths unpack an archive and both send this, so the sample
    /// has to say "nothing is being measured" rather than carry a number that
    /// happens to be true and cannot move (issue #1830).
    #[test]
    fn an_unpack_carries_no_measurement_of_any_kind() {
        let p = DownloadProgress::extracting();
        assert_eq!(p.phase, "extracting");
        assert_eq!(p.downloaded_bytes, 0);
        assert_eq!(p.total_bytes, None);
        assert_eq!(p.percent, None);
        assert!(!p.is_measured());
    }

    #[test]
    fn done_forces_full_percent_when_total_known() {
        let p = DownloadProgress::done(200, Some(200));
        assert_eq!(p.percent, Some(100.0));
        assert_eq!(p.phase, "done");
    }
}
