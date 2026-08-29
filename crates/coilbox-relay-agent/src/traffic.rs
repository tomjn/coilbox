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

use std::sync::atomic::{AtomicU64, Ordering};

use coilbox_relay_protocol::{Event, TRAFFIC_EVERY};
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
/// process lives.
///
/// Never returns. Nothing waits on it and nothing else has to be told to stop
/// it: the process exiting is what ends it, which is the same moment coilbox
/// stops having anything to draw.
///
/// Reported whether or not anything moved. See [`Event::Traffic`] for why the
/// zero is the half that matters.
pub async fn report_forever(traffic: &Traffic, reporter: &Reporter) -> std::convert::Infallible {
    let mut counted_from = Instant::now();
    loop {
        tokio::time::sleep(TRAFFIC_EVERY).await;
        let bytes = traffic.take();
        let now = Instant::now();
        let interval = now.duration_since(counted_from);
        counted_from = now;
        reporter
            .say(Event::Traffic {
                bytes_per_second: per_second(bytes, interval),
            })
            .await;
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

    /// The whole point, end to end inside the process: what goes through the
    /// relay comes out of the reporter as a rate.
    ///
    /// On a paused clock, so the interval is exactly the one the protocol
    /// names and the assertion is a number rather than a range.
    #[tokio::test(start_paused = true)]
    async fn what_the_relay_carried_is_what_the_agent_says_it_carried() {
        let (out, read) = tokio::io::duplex(4096);
        let mut said = BufReader::new(read).lines();
        let reporter = Reporter::writing(out);
        let traffic = Traffic::new();

        traffic.carried(4096);
        traffic.carried(2048);

        tokio::select! {
            _ = report_forever(&traffic, &reporter) => unreachable!("it never returns"),
            line = said.next_line() => {
                let line = line.expect("a readable pipe").expect("the reporter said something");
                assert_eq!(
                    read_event(&line),
                    Ok(Event::Traffic { bytes_per_second: 6144 })
                );
            }
        }
    }

    /// A relay that has stopped carrying anything has to say so, rather than
    /// falling silent. An agent that only spoke up when it had a figure would
    /// be indistinguishable from one that had died, and the host would be left
    /// looking at the last number it ever heard.
    #[tokio::test(start_paused = true)]
    async fn a_relay_carrying_nothing_says_nothing_is_going_through_it() {
        let (out, read) = tokio::io::duplex(4096);
        let mut said = BufReader::new(read).lines();
        let reporter = Reporter::writing(out);
        let traffic = Traffic::new();

        tokio::select! {
            _ = report_forever(&traffic, &reporter) => unreachable!("it never returns"),
            line = said.next_line() => {
                let line = line.expect("a readable pipe").expect("the reporter said something");
                assert_eq!(
                    read_event(&line),
                    Ok(Event::Traffic { bytes_per_second: 0 })
                );
            }
        }
    }
}
