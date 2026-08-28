//! When the relay agent stops, which is issue #2027 and is not one rule.
//!
//! Getting this wrong in one direction ends a game that was still being
//! played. Getting it wrong in the other leaves a process holding a TURN
//! allocation and the lobby's bandwidth with nobody left who knows it is
//! there. There is no single condition that avoids both, and the reason is the
//! first state below: the allocation has to be live before the battle is
//! advertised, because the battle advertises the relay's address, so the agent
//! starts well before there is an engine to watch and can sit there for a long
//! time with nothing happening at all.
//!
//! ## The four states and what happens in each
//!
//! | | coilbox | engine | what the agent does |
//! |-|---------|--------|---------------------|
//! | 1 | there | not started | keeps running, no timer, however long it takes |
//! | 2 | there | running | keeps running until coilbox says stop |
//! | 3 | gone | running | keeps running until the engine exits |
//! | 4 | gone | gone | stops |
//!
//! Read down the coilbox column and the rule is simpler than it looks:
//!
//! **While coilbox is there, coilbox decides.** It is the only thing that
//! knows whether a battle sitting open with no engine is a host waiting for
//! players or a host who has wandered off, and it is the common case by a
//! wide margin. Nothing here second-guesses it, which is what makes state 1
//! safe: no timer runs at all while the control channel is open, so a battle
//! can sit open all afternoon.
//!
//! **Once coilbox has gone, the agent decides.** coilbox closing is the case
//! this whole sidecar exists for, so it is not a reason to stop by itself. It
//! is the moment the agent starts judging for itself, and it has two things to
//! judge on.
//!
//! The engine is the good one, and it is why coilbox sends
//! [`Request::WatchEngine`](coilbox_relay_protocol::Request::WatchEngine)
//! the moment it launches one. States 3 and 4 differ by nothing else, and
//! without it state 4 would be caught only by the backstop below, minutes
//! late.
//!
//! Traffic is the backstop, and it is the one that catches everything the
//! other two miss: coilbox killed before it ever named an engine, coilbox and
//! the engine both dying badly, an engine whose pid the agent never got. See
//! [`IDLE_TIMEOUT`] for why it is set where it is.
//!
//! ## What is deliberately not a reason to stop
//!
//! - Losing the relay. The agent rebuilds it, because the game it is feeding
//!   is still being played. `main` owns that loop.
//! - stdin reaching EOF. That is coilbox closing, which is state 3.
//! - Having no peers yet. That is state 1, and it is normal for a long time.

use std::io;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tokio::time::Instant;

use crate::relay::RelayLink;

/// How long the relay may carry nothing before the agent decides, on its own,
/// that there is nobody left to carry anything for.
///
/// Only ever consulted once coilbox has gone. While coilbox is there this
/// number does not exist, because a battle open in the lobby with no players
/// in it yet carries no traffic for as long as the host is prepared to wait.
///
/// It comes from the engine's own verdict rather than from a guess about how
/// long a pause between rounds runs. `NetworkTimeout` in Recoil defaults to
/// 120 seconds and is documented as "Number of seconds before connection to
/// game server is considered lost"
/// (`rts/System/GlobalConfig.cpp`, `CONFIG(int, NetworkTimeout)`). The host's
/// game server acts on it by killing the player outright
/// (`rts/Net/GameServer.cpp`, `playerLink->CheckTimeout`), and a client acts on
/// it by ending its own game (`rts/Game/Game.cpp`, `GameEnd`). So a relayed
/// connection that has carried nothing for 120 seconds is not paused. It is
/// one the engine at both ends has already given up on, and a pause long
/// enough to trip this agent would have ended the game on its own, whatever
/// the agent did.
///
/// Twice that, so the agent is never the first to call it. A game that is
/// still alive by the engine's own rule has two full minutes of margin before
/// this fires, and a leak nothing else notices is gone in four.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(240);

/// How often the agent looks at whether it should stop.
///
/// A granularity, not a threshold. Nothing is waiting on the answer, so being
/// a second late costs a second of an allocation that nobody is using, and the
/// check is one `kill(pid, 0)` and one clock read.
const LOOK_EVERY: Duration = Duration::from_secs(1);

/// Why the agent stopped, for the log and for the
/// [`Stopping`](coilbox_relay_protocol::Event::Stopping) it sends first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reason {
    /// coilbox asked. State 2, and the ordinary end of a battle.
    CoilboxAsked,
    /// coilbox has gone and so has the engine it named. State 4.
    EngineGone { pid: u32 },
    /// coilbox has gone and the relay has carried nothing for
    /// [`IDLE_TIMEOUT`]. The backstop.
    NothingLeftToCarry,
}

impl std::fmt::Display for Reason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Reason::CoilboxAsked => write!(f, "coilbox asked it to stop"),
            Reason::EngineGone { pid } => write!(
                f,
                "coilbox has closed and the engine it was relaying for (process {pid}) has exited"
            ),
            Reason::NothingLeftToCarry => write!(
                f,
                "coilbox has closed and the relay has carried nothing for {} seconds, \
                 which is longer than the engine waits before giving up on a connection",
                IDLE_TIMEOUT.as_secs()
            ),
        }
    }
}

/// Everything the agent knows about whether it is still needed.
///
/// Written from the control channel and the forwarding loop, read by
/// [`Stopping::wait`]. Atomics rather than a lock because every write here is
/// one flag or one number and the reader only ever wants the latest.
pub struct Stopping {
    asked: AtomicBool,
    coilbox_gone: AtomicBool,
    /// The engine's pid once coilbox has named one. Zero means it has not,
    /// which is a real pid on no platform coilbox runs on.
    engine: AtomicU32,
    /// When a datagram last went through the relay in either direction.
    last_traffic: Mutex<Instant>,
}

impl Default for Stopping {
    fn default() -> Stopping {
        Stopping::new()
    }
}

impl Stopping {
    pub fn new() -> Stopping {
        Stopping {
            asked: AtomicBool::new(false),
            coilbox_gone: AtomicBool::new(false),
            engine: AtomicU32::new(0),
            // Started here rather than left empty, so an agent that is killed
            // off before it ever carries a datagram is still measured from
            // somewhere.
            last_traffic: Mutex::new(Instant::now()),
        }
    }

    /// coilbox has asked the agent to stop.
    pub fn coilbox_asked(&self) {
        self.asked.store(true, Ordering::Relaxed);
    }

    /// coilbox has named the engine it launched.
    pub fn engine_is(&self, pid: u32) {
        self.engine.store(pid, Ordering::Relaxed);
    }

    /// coilbox's end of the control channel has closed, so from here on the
    /// agent is judging for itself.
    pub fn coilbox_has_gone(&self) {
        self.coilbox_gone.store(true, Ordering::Relaxed);
    }

    /// A datagram went through the relay just now.
    pub fn carried_something(&self) {
        *self.last_traffic.lock().unwrap() = Instant::now();
    }

    /// Wait until there is a reason to stop, and say what it was.
    ///
    /// Never returns while coilbox is there and has not asked, which is the
    /// whole of states 1 and 2.
    pub async fn wait(&self) -> Reason {
        loop {
            if let Some(reason) = self.reason() {
                return reason;
            }
            tokio::time::sleep(LOOK_EVERY).await;
        }
    }

    /// The reason to stop right now, if there is one.
    fn reason(&self) -> Option<Reason> {
        if self.asked.load(Ordering::Relaxed) {
            return Some(Reason::CoilboxAsked);
        }
        if !self.coilbox_gone.load(Ordering::Relaxed) {
            return None;
        }
        let engine = self.engine.load(Ordering::Relaxed);
        if engine != 0 && !coilbox_proc::is_running(engine) {
            return Some(Reason::EngineGone { pid: engine });
        }
        let idle = self.last_traffic.lock().unwrap().elapsed();
        (idle >= IDLE_TIMEOUT).then_some(Reason::NothingLeftToCarry)
    }
}

/// A relay, wrapped so that carrying a datagram is what keeps the agent alive.
///
/// Here rather than in [`crate::demux`] because it is the stopping rule's
/// business and not the forwarding path's, and because it has to sit outside
/// whatever transport is underneath: what matters is that the relay carried
/// something, not which relay it was. The agent gets through several of those
/// in a long game.
pub struct Counted<'a, R> {
    pub relay: &'a R,
    pub stopping: &'a Stopping,
}

impl<R: RelayLink + Sync> RelayLink for Counted<'_, R> {
    async fn recv_from(&self, buf: &mut [u8]) -> io::Result<(usize, SocketAddr)> {
        let arrived = self.relay.recv_from(buf).await;
        // Only a datagram counts. A read that failed is the relay breaking,
        // which says nothing about whether anybody is still playing.
        if arrived.is_ok() {
            self.stopping.carried_something();
        }
        arrived
    }

    async fn send_to(&self, buf: &[u8], peer: SocketAddr) -> io::Result<usize> {
        let sent = self.relay.send_to(buf, peer).await;
        if sent.is_ok() {
            self.stopping.carried_something();
        }
        sent
    }
}

#[cfg(test)]
mod tests {
    //! On a paused clock throughout. Every deadline here is minutes long and
    //! the point of testing them is that they fire at all, so waiting one out
    //! for real would buy nothing and cost four minutes a run.

    use super::*;

    /// A process that has definitely finished, standing in for an engine whose
    /// game is over. Reaped before its pid is used, so the OS has genuinely
    /// let go of it.
    fn an_engine_that_has_exited() -> u32 {
        let (program, args): (&str, &[&str]) = if cfg!(windows) {
            ("cmd", &["/C", "exit"])
        } else {
            ("sh", &["-c", "exit"])
        };
        let mut child = std::process::Command::new(program)
            .args(args)
            .spawn()
            .expect("a shell to run");
        let pid = child.id();
        child.wait().expect("it exits at once");
        pid
    }

    /// State 4, and the one the issue calls the leak: nobody left to ask it to
    /// stop and nothing left to relay for. It has to work this out on its own,
    /// because by definition there is nobody to tell it.
    #[tokio::test(start_paused = true)]
    async fn an_agent_with_no_coilbox_and_no_engine_stops_on_its_own() {
        let stopping = Stopping::new();
        stopping.coilbox_has_gone();

        assert_eq!(stopping.wait().await, Reason::NothingLeftToCarry);
    }

    /// State 1, and the one that makes a single rule impossible. A host who
    /// opens a battle and waits for players carries no traffic at all, for as
    /// long as they are willing to wait. Time it out and the battle dies in
    /// the lobby while somebody is still sitting in front of it.
    #[tokio::test(start_paused = true)]
    async fn a_battle_waiting_for_players_is_never_timed_out() {
        let stopping = Stopping::new();

        tokio::select! {
            reason = stopping.wait() => panic!("stopped while coilbox was still there: {reason}"),
            // Ten times over the backstop, so this is not a matter of the test
            // not having waited long enough.
            () = tokio::time::sleep(IDLE_TIMEOUT * 10) => {}
        }
    }

    /// State 3, which is the case the sidecar was built for. The host has
    /// closed coilbox and is still playing, and the agent has to keep going or
    /// every other player in that game is dropped.
    #[tokio::test(start_paused = true)]
    async fn a_game_still_running_without_coilbox_keeps_its_relay() {
        let stopping = Stopping::new();
        // This test process stands in for the engine: it is definitely running.
        stopping.engine_is(std::process::id());
        stopping.coilbox_has_gone();

        tokio::select! {
            reason = stopping.wait() => panic!("stopped mid-game: {reason}"),
            // Just short of the backstop, which the next test covers.
            () = tokio::time::sleep(IDLE_TIMEOUT - LOOK_EVERY * 2) => {}
        }
    }

    /// The traffic backstop is not overridden by a live engine. An engine can
    /// be sitting in a menu long after the relayed game ended, and by the
    /// engine's own timeout every relayed player was dropped two minutes
    /// before this fires.
    #[tokio::test(start_paused = true)]
    async fn a_live_engine_does_not_keep_a_relay_nobody_is_using() {
        let stopping = Stopping::new();
        stopping.engine_is(std::process::id());
        stopping.coilbox_has_gone();

        assert_eq!(stopping.wait().await, Reason::NothingLeftToCarry);
    }

    /// Traffic is what keeps it alive, so traffic has to be what resets the
    /// clock. Miss this and a busy game is cut off four minutes in.
    #[tokio::test(start_paused = true)]
    async fn traffic_puts_the_backstop_off() {
        let stopping = Stopping::new();
        stopping.coilbox_has_gone();

        tokio::select! {
            reason = stopping.wait() => panic!("stopped with traffic still flowing: {reason}"),
            () = async {
                // A datagram every half a timeout, for three timeouts' worth.
                for _ in 0..6 {
                    tokio::time::sleep(IDLE_TIMEOUT / 2).await;
                    stopping.carried_something();
                }
            } => {}
        }
    }

    /// State 4 arriving the fast way. The engine exiting is what tells states
    /// 3 and 4 apart, and it has to land well inside the backstop or naming
    /// the engine bought nothing.
    #[tokio::test(start_paused = true)]
    async fn an_engine_that_has_exited_stops_the_agent_long_before_the_backstop() {
        let stopping = Stopping::new();
        let pid = an_engine_that_has_exited();
        stopping.engine_is(pid);
        stopping.coilbox_has_gone();

        let started = Instant::now();
        assert_eq!(stopping.wait().await, Reason::EngineGone { pid });
        assert!(
            started.elapsed() < IDLE_TIMEOUT,
            "the engine exiting has to be noticed on its own, not waited out by the backstop"
        );
    }

    /// coilbox asking beats everything, including a game that is still being
    /// played, because coilbox is the only thing that knows the battle is over
    /// rather than guessing at it.
    #[tokio::test(start_paused = true)]
    async fn coilbox_asking_stops_it_even_with_a_live_engine_and_recent_traffic() {
        let stopping = Stopping::new();
        stopping.engine_is(std::process::id());
        stopping.carried_something();
        stopping.coilbox_asked();

        assert_eq!(stopping.wait().await, Reason::CoilboxAsked);
    }
}
