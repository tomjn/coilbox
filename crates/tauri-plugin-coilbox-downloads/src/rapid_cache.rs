//! A disk copy of each rapid index (`repos.gz`, `versions.gz`) with the time it
//! was fetched, so Browse Rapid can open without a request and say how old the
//! data is. Entries are keyed by URL and never expire on disk. A copy that has
//! not been fetched since the app started counts as stale, so callers can show
//! it at once and fetch a new one behind it once per launch.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Subdirectory of the app cache dir that holds the entries.
const SUBDIR: &str = "coilbox-rapid-index";

static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Record where entries are kept, once, at plugin setup. `None` turns the disk
/// copy off, and every call is then a plain fetch.
pub fn set_dir(cache_dir: Option<PathBuf>) {
    let _ = DIR.set(cache_dir.map(|d| d.join(SUBDIR)));
}

fn dir() -> Option<&'static Path> {
    DIR.get().and_then(|d| d.as_deref())
}

/// URLs fetched since the app started.
static FETCHED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Record that `url` was fetched in this run.
pub fn mark_fetched(url: &str) {
    if let Ok(mut set) = FETCHED.lock() {
        set.get_or_insert_with(HashSet::new).insert(url.to_owned());
    }
}

/// Whether `url` has been fetched in this run. A disk copy of a URL that has
/// not is stale.
pub fn fetched_this_run(url: &str) -> bool {
    FETCHED
        .lock()
        .map(|set| set.as_ref().is_some_and(|s| s.contains(url)))
        .unwrap_or(false)
}

/// One stored index. `body` is the inflated text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub url: String,
    /// Seconds since the Unix epoch when `body` was fetched.
    pub fetched_at: u64,
    pub body: String,
}

impl Entry {
    /// Seconds since this entry was fetched. A clock that moved backwards reads as 0.
    pub fn age_secs(&self, now: u64) -> u64 {
        now.saturating_sub(self.fetched_at)
    }
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn file_for(dir: &Path, url: &str) -> PathBuf {
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    dir.join(format!("{:016x}.json", h.finish()))
}

fn read_in(dir: &Path, url: &str) -> Option<Entry> {
    let raw = std::fs::read(file_for(dir, url)).ok()?;
    let entry: Entry = serde_json::from_slice(&raw).ok()?;
    (entry.url == url).then_some(entry)
}

fn write_in(dir: &Path, entry: &Entry) {
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    if let Ok(raw) = serde_json::to_vec(entry) {
        let _ = std::fs::write(file_for(dir, &entry.url), raw);
    }
}

/// The stored copy of `url`, if there is a usable one. Blocking.
pub fn read_blocking(url: &str) -> Option<Entry> {
    read_in(dir()?, url)
}

/// Store a fetched body. Best effort, as a failed write only costs a later fetch.
pub fn write_blocking(entry: &Entry) {
    if let Some(dir) = dir() {
        write_in(dir, entry);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(url: &str, fetched_at: u64, body: &str) -> Entry {
        Entry {
            url: url.into(),
            fetched_at,
            body: body.into(),
        }
    }

    #[test]
    fn a_written_entry_reads_back_with_its_fetch_time() {
        let tmp = tempfile::tempdir().unwrap();
        let e = entry("https://example.test/versions.gz", 1_000, "a:b,md5,,Name\n");
        write_in(tmp.path(), &e);
        assert_eq!(read_in(tmp.path(), &e.url), Some(e));
    }

    #[test]
    fn an_unknown_url_and_a_damaged_file_are_misses() {
        let tmp = tempfile::tempdir().unwrap();
        let e = entry("https://example.test/repos.gz", 5, "x");
        write_in(tmp.path(), &e);
        assert_eq!(read_in(tmp.path(), "https://example.test/other.gz"), None);
        std::fs::write(file_for(tmp.path(), &e.url), b"not json").unwrap();
        assert_eq!(read_in(tmp.path(), &e.url), None);
    }

    #[test]
    fn a_url_counts_as_fetched_only_after_it_is_marked() {
        let url = "https://example.test/marked/versions.gz";
        assert!(!fetched_this_run(url));
        mark_fetched(url);
        assert!(fetched_this_run(url));
        assert!(!fetched_this_run("https://example.test/other/versions.gz"));
    }

    #[test]
    fn age_is_now_minus_fetch_time_and_never_negative() {
        let e = entry("u", 1_000, "");
        assert_eq!(e.age_secs(1_180), 180);
        assert_eq!(e.age_secs(900), 0);
    }
}
