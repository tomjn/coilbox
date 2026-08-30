//! How much the relay is carrying, said out loud once a second.
//!
//! A host relaying a battle is carrying every player's traffic on their own
//! machine, and until now nothing said so and nothing said whether it was still
//! working. A relay that has quietly stopped looks exactly like one that is
//! fine: the battle is still open, the sidecar is still running, and the first
//! anybody hears is players saying the game froze. This module is the number
//! that tells those two apart (issue #2024).
//!
//! ## One meter, in the place traffic already passes through
//!
//! [`crate::stopping::Counted`] already wraps the relay so that carrying a
//! datagram is what keeps the agent alive once coilbox has gone. Every datagram
//! in either direction goes through it, so it is where the bytes are counted
//! too, and there is deliberately no second place that counts anything. A
//! meter of its own would drift from the one the stopping rule uses, and then
//! the pill and the backstop would disagree about whether a game was still
//! being played.
//!
//! ## Why the agent works the rate out rather than sending a total
//!
//! It owns the clock. It knows exactly how long the interval it just finished
//! ran for, where a reader would have to assume, and on a machine that is busy
//! running a game the interval is the thing most likely to stretch. Working the
//! rate out here from the elapsed time it measured means a tick that ran late
//! reports the traffic it really carried rather than a figure that is low by
//! however late it was.
//!
//! ## Why the same figure is also written down
//!
//! The event goes down a pipe that belongs to the coilbox which started this
//! process, and that coilbox is the one thing guaranteed to have gone by the
//! time anybody needs to ask. Somebody who closes coilbox mid-game and opens it
//! again finds this agent through its run file and can hear nothing it says
//! (issue #2074), so the figure is written beside that run file as well as sent.
//! [`coilbox_relay_protocol::Carrying`] is the record and carries the rest of
//! the reasoning.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use coilbox_relay_protocol::{carrying_path, Carrying, Event, TRAFFIC_EVERY};
use tokio::time::Instant;

use crate::control::Reporter;

/// Bytes carried since the last time anybody asked.
///
/// An atomic rather than a lock because every write is one addition from the
/// forwarding path, which is the hottest code in this process, and the only
/// reader takes the whole count and leaves nothing behind.
#[derive(Default)]
pub struct Traffic {
    since_last_report: AtomicU64,
}

impl Traffic {
    pub fn new() -> Traffic {
        Traffic::default()
    }

    /// A datagram of `bytes` went through the relay.
    ///
    /// Both directions into one count, because [`Event::Traffic`] carries one
    /// number and says why.
    pub fn carried(&self, bytes: usize) {
        self.since_last_report
            .fetch_add(bytes as u64, Ordering::Relaxed);
    }

    /// Everything carried since the last call, and start counting again.
    pub(crate) fn take(&self) -> u64 {
        self.since_last_report.swap(0, Ordering::Relaxed)
    }
}

/// Say how much is being carried, every [`TRAFFIC_EVERY`], for as long as this
/// process lives, and write it down beside `run_file` for whoever cannot hear
/// it said.
///
/// Never returns. Nothing waits on it and nothing else has to be told to stop
/// it: the process exiting is what ends it, which is the same moment coilbox
/// stops having anything to draw.
///
/// Reported whether or not anything moved. See [`Event::Traffic`] for why the
/// zero is the half that matters.
///
/// The record is written before the event is sent, and the order is on purpose.
/// [`Reporter::say`] holds a lock across a write to a pipe, and a pipe nobody is
/// draining does not fail, it fills. Writing second would mean a coilbox that
/// had stopped reading stdout could stop the record from ever being updated,
/// and the reader of the record is by definition a different coilbox.
///
/// `run_file` is optional because the agent runs perfectly well without one,
/// which is how the tests drive it. coilbox always passes one.
pub async fn report_forever(
    traffic: &Traffic,
    reporter: &Reporter,
    run_file: Option<&Path>,
) -> std::convert::Infallible {
    let mut counted_from = Instant::now();
    loop {
        tokio::time::sleep(TRAFFIC_EVERY).await;
        let bytes = traffic.take();
        let now = Instant::now();
        let interval = now.duration_since(counted_from);
        counted_from = now;
        let bytes_per_second = per_second(bytes, interval);
        if let Some(run_file) = run_file {
            write_down(run_file, bytes_per_second);
        }
        reporter.say(Event::Traffic { bytes_per_second }).await;
    }
}

/// Write the rate beside `run_file`, replacing whatever was there.
///
/// Written to a temporary name and renamed over the top rather than written in
/// place, so a reader never catches half a record. A torn read is not dangerous
/// here, since an unreadable record means the same thing as no record, but it
/// would take the figure off a host's screen for a moment at random and put it
/// back, which reads as a relay flickering in and out.
///
/// A write that fails is dropped on the floor and tried again next interval.
/// There is nothing useful to do about it, the only channel for saying so is a
/// pipe that may belong to a process that has gone, and the reader treats a
/// record that stopped being updated as nothing to say. Logging it every second
/// would fill the log with the same line.
fn write_down(run_file: &Path, bytes_per_second: u64) {
    let path = carrying_path(run_file);
    let half_written = path.with_extension("tmp");
    let record = Carrying {
        pid: std::process::id(),
        bytes_per_second,
    };
    if std::fs::write(&half_written, record.to_json()).is_ok() {
        let _ = std::fs::rename(&half_written, &path);
    }
}

/// `bytes` spread over `interval`, as whole bytes a second.
///
/// Split out because it is the only arithmetic here and the case that would go
/// unnoticed is an interval of zero, which a paused clock produces and a
/// division would panic on.
fn per_second(bytes: u64, interval: std::time::Duration) -> u64 {
    let millis = interval.as_millis();
    if millis == 0 {
        return 0;
    }
    u64::try_from(u128::from(bytes) * 1000 / millis).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_relay_protocol::read_event;
    use std::time::Duration;
    use tokio::io::{AsyncBufReadExt, BufReader};

    /// The counter hands over everything it has and then starts again, so two
    /// reports of the same busy second do not each claim the whole of it.
    #[test]
    fn taking_the_count_leaves_nothing_behind() {
        let traffic = Traffic::new();
        traffic.carried(1200);
        traffic.carried(300);

        assert_eq!(traffic.take(), 1500);
        assert_eq!(traffic.take(), 0, "the second read is a fresh interval");
    }

    /// The rate is worked out from the interval that really ran, not from the
    /// one that was asked for. A busy machine stretches the tick, and a rate
    /// that assumed a second would be low by however late it was.
    #[test]
    fn a_late_tick_reports_the_traffic_it_really_carried() {
        assert_eq!(per_second(60_000, Duration::from_secs(1)), 60_000);
        assert_eq!(
            per_second(60_000, Duration::from_millis(2000)),
            30_000,
            "an interval that ran twice as long carried half the rate"
        );
        assert_eq!(
            per_second(60_000, Duration::from_millis(500)),
            120_000,
            "and one that ran half as long carried twice it"
        );
    }

    /// A clock that has not moved, which is what a paused test clock hands
    /// over. Nothing to divide by, and a division would take the process down.
    #[test]
    fn an_interval_of_no_time_at_all_is_not_a_division_by_zero() {
        assert_eq!(per_second(9001, Duration::ZERO), 0);
    }

    /// How many intervals a test will wait for a report before deciding one is
    /// not coming.
    ///
    /// A bound rather than a wait, and the reason is what a missing report
    /// looks like on a paused clock. [`report_forever`] sleeps and loops, so a
    /// version that skipped a report would wind the test's own clock forward
    /// forever without ever writing a line, and a test simply waiting for that
    /// line would spin rather than fail. Falsification found exactly that:
    /// making the agent report only when something had moved turned the test
    /// below from a failure into a run that never ended.
    const REPORTS_WITHIN: u32 = 5;

    /// Run the reporter until it says something, or until it has plainly
    /// decided not to.
    async fn first_report(traffic: &Traffic) -> Event {
        first_report_beside(traffic, None).await
    }

    /// The same, with somewhere to write the figure down as well as say it.
    async fn first_report_beside(traffic: &Traffic, run_file: Option<&Path>) -> Event {
        let (out, read) = tokio::io::duplex(4096);
        let mut said = BufReader::new(read).lines();
        let reporter = Reporter::writing(out);

        let line = tokio::select! {
            _ = report_forever(traffic, &reporter, run_file) => unreachable!("it never returns"),
            line = said.next_line() => line,
            () = tokio::time::sleep(TRAFFIC_EVERY * REPORTS_WITHIN) => panic!(
                "the agent said nothing in {REPORTS_WITHIN} reporting intervals, so a host \
                 would have no way to tell this relay from one that had died"
            ),
        };
        let line = line
            .expect("a readable pipe")
            .expect("the reporter said something");
        read_event(&line).expect("an event this build knows")
    }

    /// The whole point, end to end inside the process: what goes through the
    /// relay comes out of the reporter as a rate.
    ///
    /// On a paused clock, so the interval is exactly the one the protocol
    /// names and the assertion is a number rather than a range.
    #[tokio::test(start_paused = true)]
    async fn what_the_relay_carried_is_what_the_agent_says_it_carried() {
        let traffic = Traffic::new();
        traffic.carried(4096);
        traffic.carried(2048);

        assert_eq!(
            first_report(&traffic).await,
            Event::Traffic {
                bytes_per_second: 6144
            }
        );
    }

    /// A relay that has stopped carrying anything has to say so, rather than
    /// falling silent. An agent that only spoke up when it had a figure would
    /// be indistinguishable from one that had died, and the host would be left
    /// looking at the last number it ever heard.
    #[tokio::test(start_paused = true)]
    async fn a_relay_carrying_nothing_says_nothing_is_going_through_it() {
        assert_eq!(
            first_report(&Traffic::new()).await,
            Event::Traffic {
                bytes_per_second: 0
            }
        );
    }

    /// The whole of issue #2074 from this side. The figure has to end up
    /// somewhere a coilbox that never had a pipe to this process can read it,
    /// and it has to be the same figure that went down the pipe, or a host who
    /// closed and reopened coilbox would be shown a different number from the
    /// one they were shown a minute earlier.
    #[tokio::test(start_paused = true)]
    async fn what_the_agent_says_it_is_carrying_is_also_written_down() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");
        let traffic = Traffic::new();
        traffic.carried(41_984);

        let said = first_report_beside(&traffic, Some(&run_file)).await;

        assert_eq!(
            said,
            Event::Traffic {
                bytes_per_second: 41_984
            }
        );
        assert_eq!(
            coilbox_relay_protocol::carrying_now(&run_file, std::process::id()),
            Some(41_984),
            "a coilbox with no pipe to this agent has nowhere else to read the figure"
        );
    }

    /// The record names this process, so that a coilbox reading one can throw
    /// away a figure left behind by an agent that has since gone rather than
    /// showing it as the live relay's.
    #[tokio::test(start_paused = true)]
    async fn the_record_names_the_agent_that_wrote_it() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");

        first_report_beside(&Traffic::new(), Some(&run_file)).await;

        let written = std::fs::read_to_string(carrying_path(&run_file)).expect("a record");
        assert_eq!(
            Carrying::from_json(&written).expect("a record this build wrote"),
            Carrying {
                pid: std::process::id(),
                bytes_per_second: 0,
            }
        );
    }

    /// Replaced whole rather than written over, so a coilbox reading it once a
    /// second never catches half of one. Half a record is not dangerous, it
    /// reads as no figure, but it would take the number off a host's screen at
    /// random and put it back.
    #[tokio::test(start_paused = true)]
    async fn nothing_is_left_half_written_where_a_reader_would_find_it() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let run_file = dir.path().join("agent.json");

        first_report_beside(&Traffic::new(), Some(&run_file)).await;

        assert!(
            carrying_path(&run_file).exists(),
            "there has to be a record, or the rest of this test proves nothing"
        );
        assert!(
            !carrying_path(&run_file).with_extension("tmp").exists(),
            "the half written record has to be renamed into place, not copied and left"
        );
    }
}
