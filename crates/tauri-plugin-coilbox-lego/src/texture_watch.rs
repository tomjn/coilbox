//! Noticing that a texture file an open unit came from has been edited
//! (issue #3225).
//!
//! The frontend hands over the source file of each texture on the open unit and
//! gets one event per edit, once the file has stopped changing. It then offers
//! the user a reload. Nothing here reads the file or touches the store.
//!
//! An image editor does not write a file in one step. Some write it in several
//! passes, and some write a temporary file and rename it over the original. So
//! the parent folder is watched rather than the file, because a rename replaces
//! the file's inode and a watch on the old one goes quiet. An event only counts
//! when it names a watched file, and a burst of events for one file is held
//! until it has been quiet for [`SETTLE_MS`] before anything is emitted, or the
//! reload would read half a file.
//!
//! Once settled, the file is only reported if its length or modified time
//! differ from the last time it was reported, so an editor that touches a file
//! twice, or saves identical bytes, does not offer twice.
//!
//! The same shape as the replay folder watcher in `tauri-plugin-coilbox-content`
//! (`stats_watcher.rs`), whose quiet period and poll interval are used here
//! unchanged.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{Event, RecursiveMode, Watcher};

/// How long a file must go quiet before it is reported. The value the replay
/// folder watcher uses for the same problem: a multi-write save settles first.
pub const SETTLE_MS: u64 = 1500;

/// How often the thread wakes on its own to check whether a file has settled.
/// The replay folder watcher's value.
const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// A file's length and modified time, in milliseconds since the epoch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fingerprint {
    len: u64,
    modified_ms: u64,
}

impl Fingerprint {
    /// `None` when the file is not there, which is the moment between a
    /// rename's removal and its replacement as often as it is a real deletion.
    pub fn of(path: &Path) -> Option<Self> {
        let meta = std::fs::metadata(path).ok()?;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        Some(Self {
            len: meta.len(),
            modified_ms,
        })
    }
}

/// Whether a settled file is worth an offer: it is there, and it is not what was
/// last reported. A file that has gone is not offered, since there is nothing to
/// reload.
pub fn is_new_version(last: Option<Fingerprint>, now: Option<Fingerprint>) -> bool {
    match now {
        Some(now) => last != Some(now),
        None => false,
    }
}

/// Holds each file's burst of events until it has been quiet for `quiet_ms`.
/// Time is passed in rather than read, so this is testable without sleeping.
pub struct Settle {
    quiet_ms: u64,
    last_event: HashMap<PathBuf, u64>,
}

impl Settle {
    pub fn new(quiet_ms: u64) -> Self {
        Self {
            quiet_ms,
            last_event: HashMap::new(),
        }
    }

    /// An event for `path` at `now_ms`. A later event restarts that file's clock.
    pub fn note(&mut self, path: &Path, now_ms: u64) {
        self.last_event.insert(path.to_path_buf(), now_ms);
    }

    /// The files that have been quiet for long enough as of `now_ms`, which are
    /// forgotten once returned.
    pub fn take_settled(&mut self, now_ms: u64) -> Vec<PathBuf> {
        let quiet_ms = self.quiet_ms;
        let settled: Vec<PathBuf> = self
            .last_event
            .iter()
            .filter(|(_, &at)| now_ms.saturating_sub(at) >= quiet_ms)
            .map(|(p, _)| p.clone())
            .collect();
        for path in &settled {
            self.last_event.remove(path);
        }
        settled
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// One watched file: where it is once its folder's symlinks are resolved, which
/// is how the OS names it in an event, and the path the caller gave.
struct Target {
    given: PathBuf,
    resolved: PathBuf,
    last: Option<Fingerprint>,
}

/// Resolve a path's folder but not the file itself, so a file that does not
/// exist yet still resolves.
fn resolve(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?;
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty());
    let folder = match parent {
        Some(p) => p.canonicalize().ok()?,
        None => std::env::current_dir().ok()?,
    };
    Some(folder.join(name))
}

/// The watched file an event path names, if any.
fn target_for<'a>(targets: &'a mut [Target], event_path: &Path) -> Option<&'a mut Target> {
    let resolved = resolve(event_path)?;
    targets.iter_mut().find(|t| t.resolved == resolved)
}

/// A running watch. Dropping it does not stop the thread: call [`stop`].
///
/// [`stop`]: TextureWatcher::stop
pub struct TextureWatcher {
    stop_flag: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

impl TextureWatcher {
    /// Stop watching. The thread checks its flag every [`POLL_INTERVAL`], so this
    /// returns within that.
    pub fn stop(self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        let _ = self.thread.join();
    }
}

/// Watch `paths`, calling `on_change` with the path as given once for each edit
/// that has settled. A path whose folder is missing is skipped. An error comes
/// back only if the OS watch cannot be made at all.
pub fn spawn(
    paths: &[PathBuf],
    settle_ms: u64,
    mut on_change: impl FnMut(&Path) + Send + 'static,
) -> Result<TextureWatcher, String> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx)
        .map_err(|e| format!("could not start the texture watcher: {e}"))?;

    let mut targets: Vec<Target> = Vec::new();
    let mut folders: HashSet<PathBuf> = HashSet::new();
    for given in paths {
        let Some(resolved) = resolve(given) else {
            continue;
        };
        if let Some(folder) = resolved.parent() {
            if folders.insert(folder.to_path_buf()) {
                // Best effort, as the replay watcher: a folder that has gone
                // simply is not watched.
                let _ = watcher.watch(folder, RecursiveMode::NonRecursive);
            }
        }
        targets.push(Target {
            given: given.clone(),
            last: Fingerprint::of(&resolved),
            resolved,
        });
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread_stop = stop_flag.clone();
    let thread = std::thread::spawn(move || {
        // The watcher stops when it is dropped, so it lives as long as the loop.
        let _watcher = watcher;
        let mut settle = Settle::new(settle_ms);
        while !thread_stop.load(Ordering::Relaxed) {
            match rx.recv_timeout(POLL_INTERVAL) {
                Ok(Ok(event)) => note_event(&event, &mut targets, &mut settle),
                Ok(Err(_)) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            for resolved in settle.take_settled(now_ms()) {
                let Some(target) = targets.iter_mut().find(|t| t.resolved == resolved) else {
                    continue;
                };
                let now = Fingerprint::of(&target.resolved);
                if is_new_version(target.last, now) {
                    target.last = now;
                    on_change(&target.given);
                }
            }
        }
    });

    Ok(TextureWatcher { stop_flag, thread })
}

fn note_event(event: &Event, targets: &mut [Target], settle: &mut Settle) {
    for path in &event.paths {
        if let Some(target) = target_for(targets, path) {
            settle.note(&target.resolved, now_ms());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fp(len: u64, modified_ms: u64) -> Option<Fingerprint> {
        Some(Fingerprint { len, modified_ms })
    }

    #[test]
    fn a_file_is_held_until_it_has_been_quiet() {
        let mut s = Settle::new(1000);
        s.note(Path::new("/a.png"), 0);
        assert!(s.take_settled(999).is_empty());
        assert_eq!(s.take_settled(1000), vec![PathBuf::from("/a.png")]);
    }

    #[test]
    fn a_settled_file_is_reported_once() {
        let mut s = Settle::new(1000);
        s.note(Path::new("/a.png"), 0);
        assert_eq!(s.take_settled(1000).len(), 1);
        assert!(s.take_settled(5000).is_empty());
    }

    #[test]
    fn a_write_inside_the_window_restarts_the_clock() {
        // An editor writing in several passes: the file is not read between them.
        let mut s = Settle::new(1000);
        s.note(Path::new("/a.png"), 0);
        s.note(Path::new("/a.png"), 800);
        assert!(s.take_settled(1000).is_empty());
        assert!(s.take_settled(1799).is_empty());
        assert_eq!(s.take_settled(1800).len(), 1);
    }

    #[test]
    fn files_settle_independently() {
        let mut s = Settle::new(1000);
        s.note(Path::new("/a.png"), 0);
        s.note(Path::new("/b.png"), 600);
        assert_eq!(s.take_settled(1000), vec![PathBuf::from("/a.png")]);
        assert_eq!(s.take_settled(1600), vec![PathBuf::from("/b.png")]);
    }

    #[test]
    fn a_changed_file_is_offered_and_an_unchanged_one_is_not() {
        assert!(is_new_version(fp(10, 1), fp(10, 2)));
        assert!(is_new_version(fp(10, 1), fp(11, 1)));
        assert!(!is_new_version(fp(10, 1), fp(10, 1)));
    }

    #[test]
    fn a_file_that_was_missing_when_watching_began_is_offered_when_it_appears() {
        assert!(is_new_version(None, fp(10, 1)));
    }

    #[test]
    fn a_file_that_has_gone_is_not_offered() {
        assert!(!is_new_version(fp(10, 1), None));
        assert!(!is_new_version(None, None));
    }

    /// Wait for a path the watcher reports, or `None` after `within`.
    fn next(rx: &mpsc::Receiver<PathBuf>, within: Duration) -> Option<PathBuf> {
        rx.recv_timeout(within).ok()
    }

    fn watch(file: &Path, settle_ms: u64) -> (TextureWatcher, mpsc::Receiver<PathBuf>) {
        let (tx, rx) = mpsc::channel();
        let watcher = spawn(&[file.to_path_buf()], settle_ms, move |p| {
            let _ = tx.send(p.to_path_buf());
        })
        .unwrap();
        (watcher, rx)
    }

    const WAIT: Duration = Duration::from_secs(10);

    #[test]
    fn an_in_place_write_in_several_steps_is_reported_once() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("skin.png");
        std::fs::write(&file, b"one").unwrap();
        let (watcher, rx) = watch(&file, 300);

        for chunk in ["two", "two three", "two three four"] {
            std::fs::write(&file, chunk).unwrap();
        }

        assert_eq!(next(&rx, WAIT), Some(file.clone()));
        assert_eq!(next(&rx, Duration::from_millis(1200)), None);
        watcher.stop();
    }

    #[test]
    fn a_temp_file_renamed_over_it_is_reported_once() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("skin.png");
        std::fs::write(&file, b"one").unwrap();
        let (watcher, rx) = watch(&file, 300);

        let temp = dir.path().join("skin.png.tmp");
        std::fs::write(&temp, b"two, longer than one").unwrap();
        std::fs::rename(&temp, &file).unwrap();

        assert_eq!(next(&rx, WAIT), Some(file.clone()));
        assert_eq!(next(&rx, Duration::from_millis(1200)), None);
        watcher.stop();
    }

    #[test]
    fn a_neighbour_in_the_same_folder_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("skin.png");
        std::fs::write(&file, b"one").unwrap();
        let (watcher, rx) = watch(&file, 300);

        std::fs::write(dir.path().join("other.png"), b"two").unwrap();

        assert_eq!(next(&rx, Duration::from_millis(1500)), None);
        watcher.stop();
    }

    #[test]
    fn a_second_edit_after_the_first_is_reported_again() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("skin.png");
        std::fs::write(&file, b"one").unwrap();
        let (watcher, rx) = watch(&file, 300);

        std::fs::write(&file, b"two!").unwrap();
        assert_eq!(next(&rx, WAIT), Some(file.clone()));
        std::fs::write(&file, b"three!!!").unwrap();
        assert_eq!(next(&rx, WAIT), Some(file.clone()));
        watcher.stop();
    }
}
