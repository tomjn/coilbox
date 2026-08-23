//! Finding and reading the engine's `infolog.txt`, for crash triage (issue #379).
//!
//! The log does not live where you would expect. `CLogOutput::CreateFilePath`
//! writes it into the process's current working directory, and the engine chdirs
//! to its *write dir* first (`DataDirLocater::ChangeCwdToWriteDir`). Coilbox only
//! sets `SPRING_DATADIR`, which the engine treats as a LEVEL 3 data dir behind the
//! home dirs, and `IsWriteableDir` creates a missing candidate rather than skipping
//! it. So on unix `~/.config/spring` wins and the log never lands in the content
//! root coilbox named.
//!
//! Rather than mirror that whole search, this looks for `infolog.txt` in every dir
//! the engine could have chosen and takes the newest. Whether that log belongs to a
//! particular run is the caller's question: it knows when its launch started, and
//! this deliberately does not.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// The one file this looks for, in every candidate dir.
const LOG_NAME: &str = "infolog.txt";

/// Which platform's candidate dirs to build. Injected rather than read from
/// `cfg!`, so the ordering can be tested for all three from any one of them.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Os {
    Windows,
    Unix,
}

/// The environment a candidate list is built from. Injected for the same reason
/// as `Os`: the ordering is the part worth testing, and it cannot be tested
/// against a real home directory.
#[derive(Default, Clone, Debug)]
pub struct LogBaseDirs {
    pub home: Option<PathBuf>,
    pub documents: Option<PathBuf>,
    /// `$XDG_CONFIG_HOME`, or `~/.config` as the engine's own default.
    pub config: Option<PathBuf>,
    pub program_data: Option<PathBuf>,
    /// `$SPRING_WRITEDIR`, which outranks every automatic candidate.
    pub spring_writedir: Option<PathBuf>,
}

impl LogBaseDirs {
    /// Read the environment the engine would have read. `documents` has no
    /// environment variable on unix, so the caller passes the one Tauri resolves.
    pub fn from_env(documents: Option<PathBuf>) -> Self {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from);
        let config = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| home.as_ref().map(|h| h.join(".config")));
        Self {
            documents: documents.or_else(|| home.as_ref().map(|h| h.join("Documents"))),
            config,
            program_data: std::env::var_os("ProgramData").map(PathBuf::from),
            spring_writedir: std::env::var_os("SPRING_WRITEDIR").map(PathBuf::from),
            home,
        }
    }
}

/// Every dir the engine might have used as its write dir, in the engine's own
/// order (`DataDirLocater::LocateDataDirs`). `data_dir` is the content root
/// coilbox passed as `SPRING_DATADIR`, which comes last because that is where the
/// engine ranks it. Order only decides ties. The caller picks by mtime.
pub fn candidate_dirs(os: Os, base: &LogBaseDirs, data_dir: &str) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut push = |p: Option<PathBuf>| {
        if let Some(p) = p {
            if !out.contains(&p) {
                out.push(p);
            }
        }
    };

    // LEVEL 1: the only write dir the user can force.
    push(base.spring_writedir.clone());

    // LEVEL 2b: home dirs, in the engine's order.
    match os {
        Os::Windows => {
            push(
                base.documents
                    .as_ref()
                    .map(|d| d.join("My Games").join("Spring")),
            );
            push(base.documents.as_ref().map(|d| d.join("Spring")));
            push(
                base.program_data
                    .as_ref()
                    .map(|p| p.join("Applications").join("Spring")),
            );
        }
        Os::Unix => {
            push(base.config.as_ref().map(|c| c.join("spring")));
            push(base.home.as_ref().map(|h| h.join(".spring")));
        }
    }

    // LEVEL 3: what coilbox itself asked for.
    if !data_dir.is_empty() {
        push(Some(PathBuf::from(data_dir)));
    }
    out
}

/// The platform this build runs on, for the live command.
pub fn current_os() -> Os {
    if cfg!(target_os = "windows") {
        Os::Windows
    } else {
        Os::Unix
    }
}

/// A log's tail, plus enough about the file for the caller to judge whether it
/// belongs to a given run.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InfologTail {
    pub path: String,
    /// Last modified, milliseconds since the unix epoch.
    pub modified_ms: u64,
    /// Lines in the whole file, not just the tail.
    pub total_lines: usize,
    /// The last `max_lines` lines.
    pub lines: Vec<String>,
    /// Whether anything was left off the front.
    pub truncated: bool,
}

/// Milliseconds since the unix epoch for a file's mtime, or 0 when the platform
/// won't say. A log whose age is unknown sorts oldest, which is the safe way
/// round: it can only lose to one we can date.
fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The newest `infolog.txt` among `dirs`, or `None` when no dir holds one.
pub fn newest_log(dirs: &[PathBuf]) -> Option<PathBuf> {
    dirs.iter()
        .map(|d| d.join(LOG_NAME))
        .filter(|p| p.is_file())
        .max_by_key(|p| modified_ms(p))
}

/// Read the last `max_lines` lines of `path`.
///
/// Decodes lossily. A log with a mangled byte in it is exactly the log somebody
/// needs to read, so refusing to open it would fail at the worst moment.
pub fn read_tail(path: &Path, max_lines: usize) -> Result<InfologTail, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let text = String::from_utf8_lossy(&bytes);
    // `lines()` drops a trailing newline rather than yielding an empty last line,
    // which is what a reader expects to see.
    let all: Vec<&str> = text.lines().collect();
    let total_lines = all.len();
    let start = total_lines.saturating_sub(max_lines);
    Ok(InfologTail {
        path: path.to_string_lossy().into_owned(),
        modified_ms: modified_ms(path),
        total_lines,
        lines: all[start..].iter().map(|s| (*s).to_string()).collect(),
        truncated: start > 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn base() -> LogBaseDirs {
        LogBaseDirs {
            home: Some(PathBuf::from("/home/u")),
            documents: Some(PathBuf::from("/home/u/Documents")),
            config: Some(PathBuf::from("/home/u/.config")),
            program_data: Some(PathBuf::from("C:/ProgramData")),
            spring_writedir: None,
        }
    }

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("play_infolog_test_{name}"));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    /// The bug this whole module exists for: `~/.config/spring` outranks the
    /// content root, because that is the order the engine searches in.
    #[test]
    fn unix_config_dir_comes_before_the_content_root() {
        let dirs = candidate_dirs(Os::Unix, &base(), "/home/u/.spring");
        assert_eq!(
            dirs,
            vec![
                PathBuf::from("/home/u/.config/spring"),
                PathBuf::from("/home/u/.spring"),
            ]
        );
    }

    #[test]
    fn content_root_is_added_when_it_is_not_already_a_candidate() {
        let dirs = candidate_dirs(Os::Unix, &base(), "/opt/bar/data");
        assert_eq!(dirs.last(), Some(&PathBuf::from("/opt/bar/data")));
        assert_eq!(dirs.len(), 3);
    }

    #[test]
    fn windows_candidates_follow_the_engines_order() {
        let dirs = candidate_dirs(Os::Windows, &base(), "");
        assert_eq!(
            dirs,
            vec![
                PathBuf::from("/home/u/Documents/My Games/Spring"),
                PathBuf::from("/home/u/Documents/Spring"),
                PathBuf::from("C:/ProgramData/Applications/Spring"),
            ]
        );
    }

    #[test]
    fn spring_writedir_outranks_everything() {
        let mut b = base();
        b.spring_writedir = Some(PathBuf::from("/forced"));
        let dirs = candidate_dirs(Os::Unix, &b, "/home/u/.spring");
        assert_eq!(dirs.first(), Some(&PathBuf::from("/forced")));
    }

    #[test]
    fn an_empty_content_root_adds_nothing() {
        assert_eq!(candidate_dirs(Os::Unix, &base(), "").len(), 2);
    }

    #[test]
    fn newest_log_wins_over_candidate_order() {
        let root = tmp("newest");
        let old = root.join("old");
        let new = root.join("new");
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join(LOG_NAME), b"old\n").unwrap();
        // Second write lands later, so `new` is the newer file.
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(new.join(LOG_NAME), b"new\n").unwrap();

        // `old` is listed first and still loses.
        let found = newest_log(&[old.clone(), new.clone()]).unwrap();
        assert_eq!(found, new.join(LOG_NAME));
    }

    #[test]
    fn no_log_anywhere_is_none() {
        let root = tmp("none");
        assert_eq!(newest_log(&[root.join("nope")]), None);
    }

    #[test]
    fn a_short_file_returns_every_line_untruncated() {
        let root = tmp("short");
        let p = root.join(LOG_NAME);
        fs::write(&p, b"one\ntwo\nthree\n").unwrap();
        let tail = read_tail(&p, 10).unwrap();
        assert_eq!(tail.lines, vec!["one", "two", "three"]);
        assert_eq!(tail.total_lines, 3);
        assert!(!tail.truncated);
    }

    #[test]
    fn a_long_file_returns_the_last_lines_and_says_so() {
        let root = tmp("long");
        let p = root.join(LOG_NAME);
        let body: String = (1..=100).map(|n| format!("line {n}\n")).collect();
        fs::write(&p, body).unwrap();
        let tail = read_tail(&p, 3).unwrap();
        assert_eq!(tail.lines, vec!["line 98", "line 99", "line 100"]);
        assert_eq!(tail.total_lines, 100);
        assert!(tail.truncated);
    }

    #[test]
    fn a_mangled_byte_still_reads() {
        let root = tmp("lossy");
        let p = root.join(LOG_NAME);
        fs::write(&p, b"fine\n\xff\xfe broken\nlast\n").unwrap();
        let tail = read_tail(&p, 10).unwrap();
        assert_eq!(tail.total_lines, 3);
        assert_eq!(tail.lines[0], "fine");
        assert_eq!(tail.lines[2], "last");
    }

    #[test]
    fn a_missing_file_is_an_error_not_a_panic() {
        let root = tmp("missing");
        assert!(read_tail(&root.join(LOG_NAME), 10).is_err());
    }
}
