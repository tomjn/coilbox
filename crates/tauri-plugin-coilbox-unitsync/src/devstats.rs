//! Dev-build counts and wall times of unitsync reads (issue #3713).
//!
//! A worker used to be one process, one `Init` and one read, so one line said
//! all three. Workers now stay running (issue #3722), so each is counted on a
//! line of its own, all on stderr:
//!
//! ```text
//! [unitsync-worker-start] n=2 pid=4711 kind="page"
//! [unitsync-worker-init] n=2 what="map skybox" init_lock_wait=0ms init_call=190ms
//! [unitsync-worker-run] n=12 what="minimap" what_n=3 ms=274 t_end=1791559800123
//! ```
//!
//! `unitsync-worker-start` is a worker process starting. `kind` is `page` or
//! `library` for one that stays running and `one-shot` for one started for a
//! single read. `n` counts them all.
//!
//! `unitsync-worker-init` is one call to the engine's `Init`, with the read that
//! caused it and how long it took. `n` counts them all.
//!
//! `unitsync-worker-run` is one read a worker was asked for. `n` counts every
//! read this process has asked for and `what_n` counts the ones for this
//! command, so the last line of a session carries the totals. `ms` runs from
//! the read being asked for, which includes any wait behind other reads, to its
//! answer, and `t_end` is the Unix time in milliseconds at that answer. A read
//! that ran `Init` carries the same timings as its init line. A one-shot
//! worker's line ends with whatever else it printed when [`TIMINGS_ENV`] is set.
//!
//! The whole module is compiled only with `debug_assertions`, so a release
//! build has none of it.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Set on the worker so it reports its own timings on stderr.
pub const TIMINGS_ENV: &str = "COILBOX_UNITSYNC_TIMINGS";

/// The prefix of a timing line the worker prints.
const TIMING_PREFIX: &str = "[unitsync-timing] ";

/// Worker processes started so far.
static STARTS: Mutex<u64> = Mutex::new(0);

/// Calls to the engine's `Init` so far.
static INITS: Mutex<u64> = Mutex::new(0);

/// Log one worker process starting.
pub fn worker_started(pid: u32, kind: &str) {
    let mut starts = STARTS.lock().unwrap_or_else(|e| e.into_inner());
    *starts += 1;
    eprintln!(
        "[unitsync-worker-start] n={} pid={pid} kind={kind:?}",
        *starts
    );
}

/// Log one `Init`, with what the worker said of how long it took.
fn init_ran(what: &str, timing: &str) {
    let mut inits = INITS.lock().unwrap_or_else(|e| e.into_inner());
    *inits += 1;
    eprintln!("[unitsync-worker-init] n={} what={what:?} {timing}", *inits);
}

/// Reads asked for so far, in total and per command.
static COUNTS: Mutex<(u64, BTreeMap<String, u64>)> = Mutex::new((0, BTreeMap::new()));

/// One read asked of a worker. Logs its line when dropped, so every way out of
/// the caller is counted: an answer, a timeout, a cancel and a failed spawn.
pub struct WorkerRun {
    what: String,
    start: Instant,
    worker_timings: Vec<String>,
}

impl WorkerRun {
    pub fn start(what: &str) -> Self {
        Self {
            what: what.to_string(),
            start: Instant::now(),
            worker_timings: Vec::new(),
        }
    }

    /// Keep a one-shot worker's timing lines for this read's log line, and hand
    /// back the rest of its stderr so they are not printed twice.
    pub fn take_timings(&mut self, stderr: String) -> String {
        let (timings, rest) = split_timings(&stderr);
        for timing in timings.iter().filter(|t| t.contains("init_call=")) {
            init_ran(&self.what, timing);
        }
        self.worker_timings = timings;
        rest
    }

    /// Note that a running worker called `Init` to answer this read.
    pub fn ran_init(&mut self, lock_wait_ms: u64, call_ms: u64) {
        let timing = format!("init_lock_wait={lock_wait_ms}ms init_call={call_ms}ms");
        init_ran(&self.what, &timing);
        self.worker_timings.push(timing);
    }
}

impl Drop for WorkerRun {
    fn drop(&mut self) {
        let ms = self.start.elapsed().as_millis();
        let t_end = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let (n, what_n) = count(&self.what);
        let mut line = format!(
            "[unitsync-worker-run] n={n} what={:?} what_n={what_n} ms={ms} t_end={t_end}",
            self.what
        );
        for timing in &self.worker_timings {
            line.push(' ');
            line.push_str(timing);
        }
        eprintln!("{line}");
    }
}

/// Reads answered from the cache without a worker, in total and per command.
static HITS: Mutex<(u64, BTreeMap<String, u64>)> = Mutex::new((0, BTreeMap::new()));

/// Log one read answered from the cache (issue #3714), in the same shape as the
/// worker line so the two can be counted from one log:
///
/// ```text
/// [unitsync-cache-hit] n=3 what="game info" what_n=1 t_end=1791559800123
/// ```
pub fn cache_hit(what: &str) {
    let t_end = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut hits = HITS.lock().unwrap_or_else(|e| e.into_inner());
    hits.0 += 1;
    let n = hits.0;
    let what_n = hits.1.entry(what.to_string()).or_insert(0);
    *what_n += 1;
    eprintln!(
        "[unitsync-cache-hit] n={n} what={what:?} what_n={what_n} t_end={t_end}",
        what_n = *what_n
    );
}

/// Count one more run of `what`, returning the new total and the new count for
/// this command.
fn count(what: &str) -> (u64, u64) {
    let mut counts = COUNTS.lock().unwrap_or_else(|e| e.into_inner());
    counts.0 += 1;
    let total = counts.0;
    let what_n = counts.1.entry(what.to_string()).or_insert(0);
    *what_n += 1;
    (total, *what_n)
}

/// Split a worker's stderr into its timing lines, with the prefix removed, and
/// everything else.
fn split_timings(stderr: &str) -> (Vec<String>, String) {
    let mut timings = Vec::new();
    let mut rest = Vec::new();
    for line in stderr.lines() {
        match line.strip_prefix(TIMING_PREFIX) {
            Some(timing) => timings.push(timing.trim().to_string()),
            None => rest.push(line),
        }
    }
    (timings, rest.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timing_lines_are_split_from_the_rest_of_stderr() {
        let stderr =
            "[unitsync-timing] init_lock_wait=0ms init_call=190ms\nwarning: something\n[unitsync-timing] maps=3 in 5ms\n";
        let (timings, rest) = split_timings(stderr);
        assert_eq!(
            timings,
            vec!["init_lock_wait=0ms init_call=190ms", "maps=3 in 5ms"]
        );
        assert_eq!(rest, "warning: something");
    }

    #[test]
    fn stderr_without_timings_is_left_alone() {
        let (timings, rest) = split_timings("one\ntwo");
        assert!(timings.is_empty());
        assert_eq!(rest, "one\ntwo");
    }

    #[test]
    fn each_command_keeps_its_own_count() {
        let (first_total, first) = count("devstats test a");
        let (_, other) = count("devstats test b");
        let (second_total, second) = count("devstats test a");
        assert_eq!(first, 1);
        assert_eq!(other, 1);
        assert_eq!(second, 2);
        assert!(second_total >= first_total + 2);
    }
}
