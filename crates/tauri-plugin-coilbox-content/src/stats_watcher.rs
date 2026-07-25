//! Live filesystem watcher for the demos/replays folders (issue #462), so a
//! replay lands in the stats database (`stats.rs`, #414) as soon as it
//! arrives, not only when the Stats view is opened and triggers its scan.
//!
//! `notify` is the only new dependency this needs. There was no existing
//! filesystem-watch mechanism anywhere in the workspace (checked `Cargo.lock`
//! and every plugin: `tauri-plugin-fs` doesn't expose a watch command in this
//! Tauri version, and nothing here already wraps a notify-style API).
//!
//! A background thread owns the `notify` watcher and a short quiet-period
//! coalescer ([`EventCoalescer`]). A replay write touches its file more than
//! once (and a slow copy keeps touching it), so rather than ingest on every
//! event, the thread waits for the folder to go quiet before running one
//! `stats::ingest` pass, the same incremental, idempotent pass the Stats
//! view's scan-on-open already uses. A file still mid-copy simply fails the
//! existing header/script decode and is skipped (never fatal). Once the copy
//! finishes, its `(size, mtime)` changes again, which re-triggers the watcher
//! and the next pass picks up the now-complete file.
//!
//! Only one watcher runs at a time, tracked in a process-wide registry (same
//! shape as the downloads plugin's cancel registry). Starting a new one stops
//! whatever was running first, and the plugin's `on_event` hook stops it on
//! app exit.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Runtime};

use crate::demo::DEMO_DIRS;
use crate::stats;

/// The event emitted to every window once a watcher-triggered ingest pass has
/// written new/changed records, carrying the pass's [`stats::IngestSummary`].
pub const STATS_UPDATED_EVENT: &str = "coilbox-content://stats-updated";

/// How long the folder must go quiet before a burst of fs events triggers one
/// ingest pass. Long enough that a multi-write copy settles first, short
/// enough that the view still feels live.
const QUIET_PERIOD_MS: u64 = 1500;

/// How often the watcher thread wakes on its own (absent a new fs event) to
/// check whether the quiet period has elapsed.
const POLL_INTERVAL: Duration = Duration::from_millis(250);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---- pure logic (tested without a real filesystem or real sleeps) ---------

/// Whether a filesystem event path is a demo file worth ingesting: a `.sdfz`/
/// `.sdf` file, not a hidden/temp staging file. The remix rewrite
/// (`demo::rewrite_demo`) atomically writes via a leading-dot `.name.tmp`
/// sibling that is renamed into place, and that rename is itself a relevant
/// event on the final name, so the staging file must never count as one.
pub fn is_relevant_demo_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if name.starts_with('.') {
        return false;
    }
    let lower = name.to_lowercase();
    lower.ends_with(".sdfz") || lower.ends_with(".sdf")
}

/// Coalesces a burst of relevant fs events into a single trigger once the
/// stream goes quiet for `quiet_ms`. Time is passed in as epoch-ms rather than
/// read internally, so this stays a pure state machine, testable without real
/// sleeps.
pub struct EventCoalescer {
    quiet_ms: u64,
    pending_since: Option<u64>,
}

impl EventCoalescer {
    pub fn new(quiet_ms: u64) -> Self {
        Self {
            quiet_ms,
            pending_since: None,
        }
    }

    /// Record a relevant event at `now_ms`, restarting the quiet-period clock
    /// so a later event within the window pushes the flush back out.
    pub fn note_event(&mut self, now_ms: u64) {
        self.pending_since = Some(now_ms);
    }

    /// If a burst is pending and the quiet period has elapsed as of `now_ms`,
    /// clear the pending state and return `true` (the caller should ingest).
    pub fn try_flush(&mut self, now_ms: u64) -> bool {
        match self.pending_since {
            Some(since) if now_ms.saturating_sub(since) >= self.quiet_ms => {
                self.pending_since = None;
                true
            }
            _ => false,
        }
    }
}

// ---- lifecycle: one process-wide watcher -----------------------------------

struct RunningWatcher {
    stop_flag: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

fn registry() -> &'static Mutex<Option<RunningWatcher>> {
    static REG: OnceLock<Mutex<Option<RunningWatcher>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(None))
}

/// Stop the currently running watcher, if any. Idempotent. The thread polls
/// its stop flag at [`POLL_INTERVAL`], so this blocks briefly (never longer
/// than that) rather than indefinitely.
pub fn stop() {
    let running = registry().lock().unwrap_or_else(|p| p.into_inner()).take();
    if let Some(running) = running {
        running.stop_flag.store(true, Ordering::Relaxed);
        let _ = running.thread.join();
    }
}

/// Start watching `roots`' demos/replays folders, replacing any watcher
/// already running. A root's demos/replays folder that doesn't exist yet is
/// skipped for now, but the root itself is still watched non-recursively so a
/// folder later created there is picked up and watched in turn (no restart
/// needed). Returns an error only if the underlying OS watch can't be
/// constructed at all, which the caller should treat as "no live watcher this
/// session", not fatal: scan-on-open still ingests independently.
pub fn start<R: Runtime>(
    app: AppHandle<R>,
    roots: Vec<PathBuf>,
    engine_dir: PathBuf,
    stats_path: PathBuf,
) -> Result<(), String> {
    stop();

    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx)
        .map_err(|e| format!("could not start replay watcher: {e}"))?;

    for root in &roots {
        // Best-effort: a root that has since vanished simply isn't watched.
        let _ = watcher.watch(root, RecursiveMode::NonRecursive);
        for dir in DEMO_DIRS {
            let sub = root.join(dir);
            if sub.is_dir() {
                let _ = watcher.watch(&sub, RecursiveMode::NonRecursive);
            }
        }
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread_stop = stop_flag.clone();
    let thread = std::thread::spawn(move || {
        run_loop(app, rx, watcher, thread_stop, roots, engine_dir, stats_path)
    });

    *registry().lock().unwrap_or_else(|p| p.into_inner()) =
        Some(RunningWatcher { stop_flag, thread });
    Ok(())
}

/// The watcher thread body: drain fs events (dynamically watching a
/// demos/replays folder as soon as it appears), coalesce them, and run one
/// ingest pass per settled burst.
fn run_loop<R: Runtime>(
    app: AppHandle<R>,
    rx: mpsc::Receiver<notify::Result<Event>>,
    mut watcher: RecommendedWatcher,
    stop_flag: Arc<AtomicBool>,
    roots: Vec<PathBuf>,
    engine_dir: PathBuf,
    stats_path: PathBuf,
) {
    let mut coalescer = EventCoalescer::new(QUIET_PERIOD_MS);
    while !stop_flag.load(Ordering::Relaxed) {
        match rx.recv_timeout(POLL_INTERVAL) {
            Ok(Ok(event)) => handle_event(&event, &mut watcher, &roots, &mut coalescer),
            Ok(Err(_)) => {} // a single watch error, keep running
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if coalescer.try_flush(now_ms()) {
            run_ingest(&app, &roots, &engine_dir, &stats_path);
        }
    }
}

/// React to one fs event: note it in the coalescer when it touches a demo
/// file, and start watching a demos/replays folder the moment it's created
/// (covers a root whose demos folder didn't exist when watching started).
fn handle_event(
    event: &Event,
    watcher: &mut RecommendedWatcher,
    roots: &[PathBuf],
    coalescer: &mut EventCoalescer,
) {
    for path in &event.paths {
        if is_relevant_demo_path(path) {
            coalescer.note_event(now_ms());
            continue;
        }
        if matches!(event.kind, EventKind::Create(_)) && is_new_demo_dir(path, roots) {
            let _ = watcher.watch(path, RecursiveMode::NonRecursive);
        }
    }
}

/// Whether `path` is a `demos`/`replays` folder directly under one of `roots`
/// (one just created that the watcher isn't already covering).
fn is_new_demo_dir(path: &Path, roots: &[PathBuf]) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if !DEMO_DIRS.contains(&name) {
        return false;
    }
    let Some(parent) = path.parent() else {
        return false;
    };
    roots.iter().any(|r| r.as_path() == parent) && path.is_dir()
}

/// Run one ingest pass and, only when it actually changed something, persist
/// the store and notify the frontend. A skipped/unreadable pass (store
/// missing, ingest touching nothing new) leaves the watcher running silently.
/// Scan-on-open remains the fallback of record.
fn run_ingest<R: Runtime>(
    app: &AppHandle<R>,
    roots: &[PathBuf],
    engine_dir: &Path,
    stats_path: &Path,
) {
    let Ok(mut store) = stats::load(stats_path) else {
        return;
    };
    let summary = stats::ingest(roots, engine_dir, &mut store);
    if summary.added == 0 && summary.updated == 0 {
        return;
    }
    if stats::save(stats_path, &store).is_err() {
        return;
    }
    let _ = app.emit(STATS_UPDATED_EVENT, &summary);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_relevant_demo_path_matches_extension_case_insensitively() {
        assert!(is_relevant_demo_path(Path::new("/demos/a.sdfz")));
        assert!(is_relevant_demo_path(Path::new("/demos/A.SDF")));
        assert!(!is_relevant_demo_path(Path::new("/demos/readme.txt")));
    }

    #[test]
    fn is_relevant_demo_path_ignores_hidden_temp_files() {
        // The remix rewrite's atomic-write staging file.
        assert!(!is_relevant_demo_path(Path::new("/demos/.a.sdfz.tmp")));
    }

    #[test]
    fn is_relevant_demo_path_requires_a_filename() {
        assert!(!is_relevant_demo_path(Path::new("/")));
    }

    #[test]
    fn coalescer_does_not_flush_before_quiet_period_elapses() {
        let mut c = EventCoalescer::new(1000);
        c.note_event(0);
        assert!(!c.try_flush(500));
        assert!(!c.try_flush(999));
    }

    #[test]
    fn coalescer_flushes_once_quiet_period_elapses() {
        let mut c = EventCoalescer::new(1000);
        c.note_event(0);
        assert!(c.try_flush(1000));
        // Flushing clears the pending state, so a re-check without a new
        // event is a no-op.
        assert!(!c.try_flush(2000));
    }

    #[test]
    fn coalescer_restarts_the_clock_on_a_new_event_within_the_window() {
        let mut c = EventCoalescer::new(1000);
        c.note_event(0);
        c.note_event(800); // a second event arrives before the first would flush
        assert!(!c.try_flush(1000)); // only 200ms quiet since the latest event
        assert!(c.try_flush(1800));
    }

    #[test]
    fn coalescer_with_no_pending_event_never_flushes() {
        let mut c = EventCoalescer::new(1000);
        assert!(!c.try_flush(1_000_000));
    }

    #[test]
    fn is_new_demo_dir_matches_only_direct_children_named_demos_or_replays() {
        let dir = std::env::temp_dir().join("coilbox_watcher_new_dir_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("demos")).unwrap();
        let roots = vec![dir.clone()];

        assert!(is_new_demo_dir(&dir.join("demos"), &roots));
        assert!(!is_new_demo_dir(&dir.join("engines"), &roots));
        assert!(!is_new_demo_dir(&dir.join("demos").join("nested"), &roots));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
