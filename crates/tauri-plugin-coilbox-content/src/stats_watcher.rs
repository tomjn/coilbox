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
//!
//! A replay the engine is still recording is a special case of "mid-write"
//! (issue #1133). The demo file sits at zero length for the whole match and
//! is finalised in one write at game over, which is also the last event that
//! folder will ever emit for it. So before an ingest pass runs, every
//! relevant file's mtime is checked, and one touched in the last
//! [`FRESH_WINDOW_MS`] is left alone rather than decoded (a truncated read
//! reads exactly like an aborted recording with no stats, which is a real,
//! different state that must not be conflated with this one). That file's
//! next touch may never come, so [`IngestScheduler`] arms its own retry for
//! the exact moment the freshest deferred file ages out, and the pass runs
//! on schedule rather than waiting for a filesystem event that never
//! arrives.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Runtime};

use crate::demo::{self, DEMO_DIRS};
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

/// How recently a file must have been touched to be treated as still being
/// written, and so skipped rather than decoded. The engine finalises a
/// replay in one write at game over (see the module docs), so this mostly
/// guards against reading that very write moments before it is fully
/// flushed, not against a slow multi-write copy, which the coalescer's quiet
/// period already settles first.
const FRESH_WINDOW_MS: u64 = 10_000;

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

/// Whether a file last touched at `modified_ms` is still within the
/// "recently written, might not be fully flushed yet" window as of
/// `now_ms`. `saturating_sub` means a `modified_ms` momentarily ahead of
/// `now_ms` (clock skew) reads as maximally fresh rather than wrapping
/// negative, which is the safe direction: the failure this guards against is
/// decoding too early, not waiting a little longer than strictly needed.
fn is_fresh(modified_ms: u64, now_ms: u64, window_ms: u64) -> bool {
    now_ms.saturating_sub(modified_ms) < window_ms
}

/// The instant a file last touched at `modified_ms` stops being fresh.
fn eligible_at(modified_ms: u64, window_ms: u64) -> u64 {
    modified_ms.saturating_add(window_ms)
}

/// Given the mtimes of every file an ingest pass would otherwise visit,
/// whether the pass should be deferred, and if so, exactly when to retry.
/// `None` means nothing is currently fresh, so it's safe to ingest now.
/// `Some(retry_at)` is the earliest instant any currently-fresh file ages
/// out, i.e. the next moment worth reconsidering even absent a new
/// filesystem event. A file that keeps being touched keeps pushing this
/// forward each time it's recomputed, which is correct: it means the file is
/// still being written, not stuck.
fn next_eligible_check(
    modified_ms: impl Iterator<Item = u64>,
    now_ms: u64,
    window_ms: u64,
) -> Option<u64> {
    modified_ms
        .filter(|&m| is_fresh(m, now_ms, window_ms))
        .map(|m| eligible_at(m, window_ms))
        .min()
}

/// Owns the event coalescer and the self-armed retry time across loop
/// ticks, so the coalesce-then-defer-then-retry sequence a live match
/// exercises is one unit, testable end to end by feeding it synthetic ticks
/// with no real clock, thread, or filesystem.
struct IngestScheduler {
    coalescer: EventCoalescer,
    next_check: Option<u64>,
}

impl IngestScheduler {
    fn new(quiet_ms: u64) -> Self {
        Self {
            coalescer: EventCoalescer::new(quiet_ms),
            next_check: None,
        }
    }

    /// Record a relevant fs event at `now_ms`.
    fn note_event(&mut self, now_ms: u64) {
        self.coalescer.note_event(now_ms);
    }

    /// Called once per loop tick. Returns whether a real ingest pass should
    /// run now. `modified_ms` is a closure rather than a value so a tick
    /// that turns out not to be due (coalescer not flushed, no armed retry
    /// reached) never pays for a directory listing.
    fn tick(&mut self, now_ms: u64, modified_ms: impl FnOnce() -> Vec<u64>) -> bool {
        let flushed = self.coalescer.try_flush(now_ms);
        let due = self.next_check.is_some_and(|t| now_ms >= t);
        if !flushed && !due {
            return false;
        }
        match next_eligible_check(modified_ms().into_iter(), now_ms, FRESH_WINDOW_MS) {
            Some(retry_at) => {
                self.next_check = Some(retry_at);
                false
            }
            None => {
                self.next_check = None;
                true
            }
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
/// skipped for now, but the directory it would sit in is still watched
/// non-recursively so a folder later created there is picked up and watched in
/// turn (no restart needed). Returns an error only if the underlying OS watch
/// can't be constructed at all, which the caller should treat as "no live
/// watcher this session", not fatal: scan-on-open still ingests independently.
///
/// The watched set is each root's [`demo::demo_search_dirs`], so a replay an
/// engine writes into its own directory under Portable Mode reaches the stats
/// database as it lands, the same as one written to the root. An engine
/// installed after the watcher started is only picked up on the next start.
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

    let watched: Vec<PathBuf> = roots
        .iter()
        .flat_map(|r| demo::demo_search_dirs(r))
        .collect();
    for base in &watched {
        // Best-effort: a directory that has since vanished simply isn't watched.
        let _ = watcher.watch(base, RecursiveMode::NonRecursive);
        for dir in DEMO_DIRS {
            let sub = base.join(dir);
            if sub.is_dir() {
                let _ = watcher.watch(&sub, RecursiveMode::NonRecursive);
            }
        }
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread_stop = stop_flag.clone();
    let target = IngestTarget {
        roots,
        engine_dir,
        stats_path,
    };
    let thread =
        std::thread::spawn(move || run_loop(app, rx, watcher, thread_stop, watched, target));

    *registry().lock().unwrap_or_else(|p| p.into_inner()) =
        Some(RunningWatcher { stop_flag, thread });
    Ok(())
}

/// What an ingest pass needs: the content roots to scan, the engine folder
/// holding `demotool`, and where the stats store lives. Separate from the
/// watched directory list, which is derived from the roots and is only about
/// where filesystem events come from.
struct IngestTarget {
    roots: Vec<PathBuf>,
    engine_dir: PathBuf,
    stats_path: PathBuf,
}

/// The watcher thread body: drain fs events (dynamically watching a
/// demos/replays folder as soon as it appears), coalesce them, and run one
/// ingest pass per settled burst.
fn run_loop<R: Runtime>(
    app: AppHandle<R>,
    rx: mpsc::Receiver<notify::Result<Event>>,
    mut watcher: RecommendedWatcher,
    stop_flag: Arc<AtomicBool>,
    watched: Vec<PathBuf>,
    target: IngestTarget,
) {
    let mut scheduler = IngestScheduler::new(QUIET_PERIOD_MS);
    while !stop_flag.load(Ordering::Relaxed) {
        match rx.recv_timeout(POLL_INTERVAL) {
            Ok(Ok(event)) => handle_event(&event, &mut watcher, &watched, &mut scheduler),
            Ok(Err(_)) => {} // a single watch error, keep running
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if scheduler.tick(now_ms(), || demo_modified_ms(&target.roots)) {
            run_ingest(&app, &target);
        }
    }
}

/// React to one fs event: note it in the scheduler when it touches a demo
/// file, and start watching a demos/replays folder the moment it's created
/// (covers a root whose demos folder didn't exist when watching started).
fn handle_event(
    event: &Event,
    watcher: &mut RecommendedWatcher,
    watched: &[PathBuf],
    scheduler: &mut IngestScheduler,
) {
    for path in &event.paths {
        if is_relevant_demo_path(path) {
            scheduler.note_event(now_ms());
            continue;
        }
        if matches!(event.kind, EventKind::Create(_)) && is_new_demo_dir(path, watched) {
            let _ = watcher.watch(path, RecursiveMode::NonRecursive);
        }
    }
}

/// The mtime of every relevant demo file an ingest pass over `roots` would
/// visit, fresh off the filesystem. Mirrors [`stats::ingest`]'s own file set
/// (each root's [`demo::demo_file_entries`]) so the freshness check gates
/// exactly what the pass would otherwise decode.
fn demo_modified_ms(roots: &[PathBuf]) -> Vec<u64> {
    roots
        .iter()
        .flat_map(|r| demo::demo_file_entries(r))
        .filter(|e| is_relevant_demo_path(&e.path))
        .map(|e| e.modified_ms)
        .collect()
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
fn run_ingest<R: Runtime>(app: &AppHandle<R>, target: &IngestTarget) {
    let Ok(mut store) = stats::load(&target.stats_path) else {
        return;
    };
    let summary = stats::ingest(&target.roots, &target.engine_dir, &mut store);
    if summary.added == 0 && summary.updated == 0 {
        return;
    }
    if stats::save(&target.stats_path, &store).is_err() {
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

    // ---- freshness window (issue #1133) ------------------------------------

    #[test]
    fn is_fresh_just_after_touch() {
        assert!(is_fresh(1_000, 1_000, 10_000));
        assert!(is_fresh(1_000, 10_999, 10_000));
    }

    #[test]
    fn is_fresh_false_once_the_window_elapses() {
        // Exactly at the boundary is no longer fresh: "modified within the
        // last ten seconds" is a strict window, not an inclusive one.
        assert!(!is_fresh(1_000, 11_000, 10_000));
        assert!(!is_fresh(1_000, 50_000, 10_000));
    }

    #[test]
    fn is_fresh_treats_a_future_mtime_as_fresh() {
        // Clock skew putting mtime ahead of "now" must not wrap negative and
        // read as stale: the failure being guarded against is decoding too
        // early, so an ambiguous case should stay on the "wait" side.
        assert!(is_fresh(5_000, 1_000, 10_000));
    }

    #[test]
    fn eligible_at_is_modified_plus_window() {
        assert_eq!(eligible_at(1_000, 10_000), 11_000);
    }

    #[test]
    fn next_eligible_check_is_none_with_no_files() {
        assert_eq!(
            next_eligible_check(std::iter::empty(), 100_000, 10_000),
            None
        );
    }

    #[test]
    fn next_eligible_check_is_none_when_every_file_is_stale() {
        let modified = [0_u64, 5_000, 89_000];
        assert_eq!(
            next_eligible_check(modified.into_iter(), 100_000, 10_000),
            None
        );
    }

    #[test]
    fn next_eligible_check_returns_the_earliest_fresh_file_to_age_out() {
        // Three files: one already stale (ignored), two fresh with different
        // mtimes. The earlier of the two fresh ones' eligible-at wins, not
        // the later one and not the stale one.
        let modified = [50_000_u64, 95_000, 98_000];
        let now = 100_000;
        assert_eq!(
            next_eligible_check(modified.into_iter(), now, 10_000),
            Some(105_000) // 95_000 + 10_000, earlier than 98_000 + 10_000
        );
    }

    #[test]
    fn scheduler_ingests_immediately_when_nothing_is_fresh() {
        let mut s = IngestScheduler::new(1_000);
        s.note_event(100_000);
        // Quiet period elapsed and the only file on disk is old (well
        // outside the 10s freshness window).
        assert!(s.tick(101_000, || vec![0]));
    }

    #[test]
    fn scheduler_defers_a_fresh_file_and_does_not_wait_for_another_event() {
        let mut s = IngestScheduler::new(1_000);
        s.note_event(0);
        // Coalescer flushes at t=1_000, but the file was touched at t=900,
        // well inside the 10s freshness window: defer, don't ingest.
        assert!(!s.tick(1_000, || vec![900]));

        // No new fs event arrives (the finalising write is the last event
        // that folder will ever emit for this file). A poll tick before the
        // armed retry (900 + 10_000 = 10_900) must still not ingest, because
        // otherwise the "timer" half of this fix is a no-op and the file
        // waits for an event that never comes.
        assert!(!s.tick(10_899, || vec![900]));

        // The armed retry itself must fire the ingest, with no new event.
        assert!(s.tick(10_900, || vec![900]));
    }

    #[test]
    fn scheduler_never_ingests_a_file_that_keeps_being_touched() {
        let mut s = IngestScheduler::new(1_000);
        s.note_event(0);
        assert!(!s.tick(1_000, || vec![900]));

        // The file is touched again right before its retry would fire, so
        // the retry keeps pushing forward rather than reading it early.
        assert!(!s.tick(10_900, || vec![10_800]));
        assert!(!s.tick(20_800, || vec![20_700]));

        // Once it stops being touched, the next retry does fire.
        assert!(s.tick(30_700, || vec![20_700]));
    }

    #[test]
    fn scheduler_ignores_a_tick_that_is_neither_flushed_nor_due() {
        let mut s = IngestScheduler::new(1_000);
        s.note_event(0);
        // Not enough quiet time has passed yet, and no retry is armed.
        assert!(!s.tick(500, || panic!("must not stat files on an idle tick")));
    }

    #[test]
    fn scheduler_reevaluates_freshness_on_a_new_event_before_the_old_retry() {
        let mut s = IngestScheduler::new(1_000);
        s.note_event(0);
        assert!(!s.tick(1_000, || vec![900])); // defers, retry armed for 10_900

        // A second file lands and its own event flushes before the armed
        // retry. The fresh set is re-read from scratch at that point.
        s.note_event(5_000);
        assert!(!s.tick(6_000, || vec![900, 5_900])); // still fresh, re-armed later
        assert!(s.tick(15_900, || vec![900, 5_900])); // both now stale
    }
}
