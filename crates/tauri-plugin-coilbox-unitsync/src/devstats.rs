//! Dev-build count and wall time of unitsync worker runs (issue #3713).
//!
//! Every worker run prints one line to stderr when it ends:
//!
//! ```text
//! [unitsync-worker-run] n=12 what="minimap" what_n=3 ms=274 t_end=1791559800123 init_lock_wait=0ms init_call=190ms
//! ```
//!
//! `n` counts every worker this process has started and `what_n` counts the
//! ones for this command, so the last line of a session carries the totals.
//! `ms` runs from just before the spawn to the worker's exit, and `t_end` is
//! the Unix time in milliseconds at that exit. Whatever follows `t_end` is the
//! worker's own account of where its time went, which it prints when
//! [`TIMINGS_ENV`] is set.
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

/// Runs started so far, in total and per command.
static COUNTS: Mutex<(u64, BTreeMap<String, u64>)> = Mutex::new((0, BTreeMap::new()));

/// One worker run. Logs its line when dropped, so every way out of the caller
/// is counted: a clean exit, a timeout, a cancel and a failed spawn.
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

    /// Keep the worker's timing lines for this run's log line, and hand back
    /// the rest of its stderr so they are not printed twice.
    pub fn take_timings(&mut self, stderr: String) -> String {
        let (timings, rest) = split_timings(&stderr);
        self.worker_timings = timings;
        rest
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
