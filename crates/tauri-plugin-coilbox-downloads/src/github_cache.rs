//! A disk copy of each GitHub API response, so a later launch can ask GitHub
//! whether it changed (`If-None-Match`) and reuse the stored body on a 304.
//! Entries are keyed by request URL and never expire, because the ETag is what
//! keeps them current.

use reqwest::header::HeaderMap;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Subdirectory of the app cache dir that holds the entries.
const SUBDIR: &str = "coilbox-github-api";

static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Record where entries are kept, once, at plugin setup. `None` turns the disk
/// copy off, and every request is then a plain one.
pub fn set_dir(cache_dir: Option<PathBuf>) {
    let _ = DIR.set(cache_dir.map(|d| d.join(SUBDIR)));
}

fn dir() -> Option<&'static Path> {
    DIR.get().and_then(|d| d.as_deref())
}

/// One stored response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub url: String,
    pub etag: String,
    pub body: String,
}

/// Stable filesystem-safe name for a URL, as in the branding image cache.
fn file_for(dir: &Path, url: &str) -> PathBuf {
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    dir.join(format!("{:016x}.json", h.finish()))
}

/// The entry in `raw` if it parses, is for `url` and has an ETag. Anything else
/// is a miss, so a damaged file costs one unconditional request.
fn parse_entry(raw: &[u8], url: &str) -> Option<Entry> {
    let entry: Entry = serde_json::from_slice(raw).ok()?;
    (entry.url == url && !entry.etag.is_empty()).then_some(entry)
}

/// The stored response for `url`, if there is a usable one. Blocking.
pub fn read_blocking(url: &str) -> Option<Entry> {
    let raw = std::fs::read(file_for(dir()?, url)).ok()?;
    parse_entry(&raw, url)
}

/// Store a response. Best effort, as a failed write only costs a later request.
pub fn write_blocking(entry: &Entry) {
    let Some(dir) = dir() else { return };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    if let Ok(raw) = serde_json::to_vec(entry) {
        let _ = std::fs::write(file_for(dir, &entry.url), raw);
    }
}

/// What to do with GitHub's answer.
#[derive(Debug, PartialEq)]
pub enum Verdict {
    /// 304, so the stored body is current.
    UseStored,
    /// GitHub is refusing because of a rate limit. Carries the message to show.
    Refused(String),
    /// Anything else: read the body, or report the status as an error.
    Read,
}

pub fn verdict(status: StatusCode, headers: &HeaderMap, has_stored: bool, now: u64) -> Verdict {
    if status == StatusCode::NOT_MODIFIED && has_stored {
        return Verdict::UseStored;
    }
    match rate_limit_message(status, headers, now) {
        Some(msg) => Verdict::Refused(msg),
        None => Verdict::Read,
    }
}

fn header_u64(headers: &HeaderMap, name: &str) -> Option<u64> {
    headers.get(name)?.to_str().ok()?.trim().parse().ok()
}

/// A message when `status` and `headers` are a GitHub rate limit refusal.
///
/// Per GitHub's REST rate limit docs, a primary limit is a 403 or 429 with
/// `x-ratelimit-remaining: 0`, to be retried after `x-ratelimit-reset` (epoch
/// seconds). A secondary limit is a 403 or 429, with `retry-after` (seconds) when
/// GitHub gives one. A 403 with neither header is an ordinary refusal.
fn rate_limit_message(status: StatusCode, headers: &HeaderMap, now: u64) -> Option<String> {
    if status != StatusCode::FORBIDDEN && status != StatusCode::TOO_MANY_REQUESTS {
        return None;
    }
    let wait = if let Some(secs) = header_u64(headers, "retry-after") {
        Some(secs)
    } else if header_u64(headers, "x-ratelimit-remaining") == Some(0) {
        header_u64(headers, "x-ratelimit-reset").map(|reset| reset.saturating_sub(now))
    } else if status == StatusCode::TOO_MANY_REQUESTS {
        None
    } else {
        return None;
    };
    Some(match wait {
        Some(secs) => {
            let minutes = secs.div_ceil(60).max(1);
            let unit = if minutes == 1 { "minute" } else { "minutes" };
            format!(
                "GitHub is limiting requests from this computer. Try again in {minutes} {unit}."
            )
        }
        None => "GitHub is limiting requests from this computer. Try again later.".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(*k, HeaderValue::from_str(v).unwrap());
        }
        h
    }

    #[test]
    fn primary_limit_names_the_reset_time() {
        let h = headers(&[
            ("x-ratelimit-remaining", "0"),
            ("x-ratelimit-reset", "1300"),
        ]);
        let msg = rate_limit_message(StatusCode::FORBIDDEN, &h, 1000).unwrap();
        assert_eq!(
            msg,
            "GitHub is limiting requests from this computer. Try again in 5 minutes."
        );
        assert!(rate_limit_message(StatusCode::TOO_MANY_REQUESTS, &h, 1000).is_some());
    }

    #[test]
    fn a_reset_less_than_a_minute_away_says_one_minute() {
        let h = headers(&[
            ("x-ratelimit-remaining", "0"),
            ("x-ratelimit-reset", "1010"),
        ]);
        let msg = rate_limit_message(StatusCode::FORBIDDEN, &h, 1000).unwrap();
        assert!(msg.ends_with("in 1 minute."));
    }

    #[test]
    fn secondary_limit_uses_retry_after() {
        let h = headers(&[("retry-after", "120")]);
        let msg = rate_limit_message(StatusCode::FORBIDDEN, &h, 0).unwrap();
        assert!(msg.ends_with("in 2 minutes."));
    }

    #[test]
    fn a_429_with_no_headers_is_still_a_limit() {
        let msg = rate_limit_message(StatusCode::TOO_MANY_REQUESTS, &HeaderMap::new(), 0).unwrap();
        assert!(msg.ends_with("Try again later."));
    }

    #[test]
    fn a_limit_with_no_reset_header_says_try_later() {
        let h = headers(&[("x-ratelimit-remaining", "0")]);
        let msg = rate_limit_message(StatusCode::FORBIDDEN, &h, 0).unwrap();
        assert!(msg.ends_with("Try again later."));
    }

    #[test]
    fn an_ordinary_403_or_404_is_not_a_limit() {
        let h = headers(&[("x-ratelimit-remaining", "12")]);
        assert_eq!(rate_limit_message(StatusCode::FORBIDDEN, &h, 0), None);
        assert_eq!(
            rate_limit_message(StatusCode::FORBIDDEN, &HeaderMap::new(), 0),
            None
        );
        let spent = headers(&[("x-ratelimit-remaining", "0")]);
        assert_eq!(rate_limit_message(StatusCode::NOT_FOUND, &spent, 0), None);
    }

    #[test]
    fn a_304_uses_the_stored_body_only_when_there_is_one() {
        let h = HeaderMap::new();
        assert_eq!(
            verdict(StatusCode::NOT_MODIFIED, &h, true, 0),
            Verdict::UseStored
        );
        assert_eq!(
            verdict(StatusCode::NOT_MODIFIED, &h, false, 0),
            Verdict::Read
        );
        assert_eq!(verdict(StatusCode::OK, &h, true, 0), Verdict::Read);
    }

    #[test]
    fn a_refusal_wins_over_a_stored_entry() {
        let h = headers(&[("retry-after", "60")]);
        assert!(matches!(
            verdict(StatusCode::TOO_MANY_REQUESTS, &h, true, 0),
            Verdict::Refused(_)
        ));
    }

    fn entry(url: &str) -> Entry {
        Entry {
            url: url.into(),
            etag: "\"abc\"".into(),
            body: "[]".into(),
        }
    }

    #[test]
    fn an_entry_round_trips() {
        let e = entry("https://api.github.com/repos/o/n/releases");
        let raw = serde_json::to_vec(&e).unwrap();
        assert_eq!(parse_entry(&raw, &e.url), Some(e));
    }

    #[test]
    fn a_damaged_or_foreign_entry_is_a_miss() {
        let url = "https://api.github.com/repos/o/n/releases";
        assert_eq!(parse_entry(b"{not json", url), None);
        assert_eq!(parse_entry(b"", url), None);
        let raw = serde_json::to_vec(&entry("https://api.github.com/other")).unwrap();
        assert_eq!(parse_entry(&raw, url), None);
        let mut no_etag = entry(url);
        no_etag.etag.clear();
        let raw = serde_json::to_vec(&no_etag).unwrap();
        assert_eq!(parse_entry(&raw, url), None);
    }

    #[test]
    fn urls_get_their_own_files() {
        let d = Path::new("/x");
        assert_eq!(file_for(d, "https://a"), file_for(d, "https://a"));
        assert_ne!(file_for(d, "https://a"), file_for(d, "https://b"));
    }

    #[test]
    fn a_file_on_disk_reads_back_and_a_corrupt_one_does_not() {
        let tmp = tempfile::tempdir().unwrap();
        let url = "https://api.github.com/repos/o/n/releases";
        let e = entry(url);
        let path = file_for(tmp.path(), url);
        std::fs::write(&path, serde_json::to_vec(&e).unwrap()).unwrap();
        let raw = std::fs::read(&path).unwrap();
        assert_eq!(parse_entry(&raw, url), Some(e));
        std::fs::write(&path, b"\0\0 truncated").unwrap();
        let raw = std::fs::read(&path).unwrap();
        assert_eq!(parse_entry(&raw, url), None);
    }
}
