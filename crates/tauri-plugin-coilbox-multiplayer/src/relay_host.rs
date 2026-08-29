//! Hosting a battle through the lobby's relay, from the credential to the
//! address the battle is advertised at.
//!
//! Everything the milestone before this built is a piece of this: the route
//! decision in `src/direct/hostingRoute.ts` says a relay is what is left,
//! [`crate::turn::credentials`] gets a credential to open one with,
//! [`crate::relay_sidecar`] says where the sidecar is and what to run it with,
//! and [`crate::relay_agent`] drives its control channel. None of them had a
//! caller. This is the caller.
//!
//! ## The ordering, and why it is a type rather than a comment
//!
//! The allocation has to exist before the battle is advertised. Advertise
//! first and players see a battle at an address nothing answers on, which is
//! indistinguishable from a host whose router is shut, and the whole point of
//! relay hosting is to stop producing exactly that.
//!
//! Sequencing it correctly would be a rule somebody reorders. So the address a
//! battle is advertised at is [`Advertised`], and there are two ways to build
//! one: [`Advertised::direct`] from a port the caller already had, and
//! [`Advertised::relayed`] from a [`RelayHost`]. A `RelayHost` is only ever
//! returned by [`waiting_on`], and only on the branch where the agent has said
//! `relayOpen`. There is no path from "we would like a relay" to a relayed
//! `OPENBATTLE` line that does not pass through an allocation that is open.
//!
//! ## What a host sees when it does not work
//!
//! A sentence, in the form they were about to host in. [`NoRelay`] renders
//! every failure as one, the same way [`crate::turn::NoCredential`] does, and
//! `mp_open_battle` returns it as the command's error so the hosting popover
//! shows it where the Host button is. Nothing is opened, so there is nothing
//! for anybody to fail to join.
//!
//! ## An attempt that ends in no battle takes its agent with it
//!
//! A sidecar left running holds a TURN allocation and, worse, leaves the run
//! file that makes [`RelayAgent::spawn`] refuse the next attempt. Nothing in
//! coilbox will clear that, so one battle that did not open costs somebody
//! hosting for the rest of the session (issue #2058).
//!
//! So every way of not getting a battle stops the agent it started. There are
//! two halves to that and they are in different places because they know
//! different things. Here, [`waiting_on`] covers the allocation never opening.
//! Above, `open_battle` covers the lobby refusing the battle after the
//! allocation is up, using [`confirmed`] to hear the answer.
//!
//! Both are safe for the same reason, which is worth being precise about
//! because the opposite case is a game cut off mid-match. The agent either of
//! them stops was started seconds earlier by this same attempt,
//! [`RelayAgent::spawn`] refuses to start one over a battle already being
//! relayed, and no engine is launched until there is a battle to launch into.
//! An agent that is carrying a game has been through `remember_relay` and is
//! held against the connection, where neither of these can see it. Stopping
//! that one is issue #2018, and its rules are the opposite of these.
//!
//! ## What is deliberately somebody else's
//!
//! A rebuilt allocation arrives as a second `relayOpen` and re-advertising the
//! battle at the new address is issue #2031. It plugs into the listener
//! [`allocate`] installs, which already runs on the agent's own thread and sees
//! every event: a rebuild happens while a host is doing something else, so it
//! has to arrive rather than be waited for, which is why the seam is a callback
//! and not a queue somebody polls.
//!
//! Releasing the allocation when a game is over is #2018, and the check that a
//! credential has enough life left in it is #2042.

use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

use coilbox_lobby_protocol::{Delta, LobbyState};
use coilbox_relay_protocol::Event;
use tokio::sync::watch;

use crate::conn::Registry;
use crate::lock_or_recover;
use crate::relay_agent::{NotStarted, RelayAgent};
use crate::relay_sidecar::{self, Battle};
use crate::turn::{self, NoCredential};

/// How long to wait for the agent to open an allocation before deciding it is
/// not going to.
///
/// The agent retransmits its Allocate on the `turn` crate's own schedule and
/// takes about 16 seconds to give up on a server that never answers, which
/// `tauri-plugin-coilbox-multiplayer/tests/relayed_battle.rs` measured while
/// waiting for a coturn to come up. Anything shorter than that turns a relay
/// that was about to report a real refusal into a coilbox timeout with nothing
/// useful in it, so this has to outlast the agent's own patience rather than
/// race it.
///
/// Spent in full only when a host is about to be told they cannot host, which
/// is the one case where waiting beats guessing.
pub const ALLOCATION_PATIENCE: Duration = Duration::from_secs(25);

/// A relay carrying a battle, once its allocation is open.
///
/// Cannot be constructed anywhere but [`waiting_on`], and only from an agent
/// that has said `relayOpen`. That is the ordering guarantee: everything that
/// needs the relayed address needs one of these, and one of these means the
/// allocation exists.
pub struct RelayHost {
    /// The port the host's own engine binds, on loopback, which is where the
    /// agent sends every player's traffic. Not the port the battle is
    /// advertised at, and keeping the two apart is the whole of why the host
    /// can play in their own battle.
    pub engine_port: u16,
    /// Where players send, on the relay server.
    pub relayed: SocketAddr,
    /// The control channel, held so the battle can be admitted through and
    /// stopped. `allow_joiner` still has no caller (see
    /// [`crate::relay_agent`]), and `stop` is called when an open fails after
    /// the allocation is already up.
    pub agent: RelayAgent,
}

/// Hand-written because the control channel is a boxed writer and cannot be
/// derived, and because the two numbers are the whole of what anybody debugging
/// a relayed battle wants to see.
impl std::fmt::Debug for RelayHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RelayHost")
            .field("engine_port", &self.engine_port)
            .field("relayed", &self.relayed)
            .finish_non_exhaustive()
    }
}

/// Why there is no relay to host through.
///
/// Every one of these reaches a person, so every one of them says what happened
/// rather than which function returned it.
#[derive(Debug)]
pub enum NoRelay {
    /// The lobby would not give us a credential, in its own words.
    NoCredential(NoCredential),
    /// The sidecar would not start, or one is already relaying.
    NotStarted(NotStarted),
    /// The agent started and said it has no relay, with the reason the TURN
    /// server gave.
    NoAllocation(String),
    /// The agent gave up rather than trying again, which is what a refused
    /// credential looks like from here.
    GaveUp(String),
    /// The agent started and then said nothing at all.
    Silent(Duration),
}

impl std::fmt::Display for NoRelay {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NoRelay::NoCredential(why) => write!(f, "{why}"),
            NoRelay::NotStarted(why) => write!(f, "{why}"),
            NoRelay::NoAllocation(why) => {
                write!(f, "the relay would not open an allocation: {why}")
            }
            NoRelay::GaveUp(why) => write!(f, "the relay agent gave up: {why}"),
            NoRelay::Silent(waited) => write!(
                f,
                "the relay agent said nothing for {} seconds, so there is no address to host at",
                waited.as_secs()
            ),
        }
    }
}

impl std::error::Error for NoRelay {}

/// Where a battle is advertised, which is what a joiner dials.
///
/// `ip` is `None` on every route but the relay, because the lobby works a
/// direct host's address out from the connection it is talking to and is right
/// to. Only a relayed battle lives somewhere the lobby cannot see.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Advertised {
    pub ip: Option<IpAddr>,
    pub port: u16,
}

impl Advertised {
    /// A battle at the host's own address, on the port the host chose or the
    /// one their router opened for it.
    pub fn direct(port: u16) -> Advertised {
        Advertised { ip: None, port }
    }

    /// A battle at the relay's allocation.
    ///
    /// Takes a [`RelayHost`], which cannot exist before the allocation does. A
    /// version of this that took an address would be a version somebody could
    /// call with an address they were hoping for.
    pub fn relayed(relay: &RelayHost) -> Advertised {
        Advertised {
            ip: Some(relay.relayed.ip()),
            port: relay.relayed.port(),
        }
    }
}

/// Get a credential, start the relay agent, and wait until it has an
/// allocation.
///
/// `run_file` comes from [`relay_sidecar::run_file_path`] rather than being
/// worked out here, so the one part that needs an app handle stays in the
/// command.
///
/// `now_ms` and `patience` are parameters for the same reason
/// [`turn::credentials`] takes them: the caller owns the budget and the tests
/// own the clock.
pub async fn allocate(
    registry: &Registry,
    server_key: &str,
    run_file: &Path,
    engine_port: u16,
    max_peers: usize,
    now_ms: u64,
    patience: Duration,
) -> Result<RelayHost, NoRelay> {
    let turn = turn::credentials(registry, server_key, now_ms, patience)
        .await
        .map_err(NoRelay::NoCredential)?;
    let binary =
        relay_sidecar::resolve_sidecar().ok_or(NoRelay::NotStarted(NotStarted::NoSidecar))?;

    let battle = Battle {
        engine_port,
        max_peers,
        turn: Some(turn),
    };
    // Every event the agent produces goes down this channel until the wait below
    // ends and drops the reading half. Issue #2031's reader belongs in this
    // closure alongside the send, because a rebuilt allocation arrives long
    // after anybody is waiting on one.
    let (saw, heard) = mpsc::channel();
    let agent = RelayAgent::spawn(&binary, &battle, run_file, move |event| {
        let _ = saw.send(event);
    })
    .map_err(NoRelay::NotStarted)?;

    waiting_on(agent, heard, engine_port, ALLOCATION_PATIENCE)
}

/// Wait for an agent that is already being driven to open an allocation.
///
/// Split from [`allocate`] for the same reason [`RelayAgent::driving`] is split
/// from [`RelayAgent::spawn`]: it is the half a test can run without a process,
/// and it is the half that decides whether there is an address to advertise.
///
/// Blocking rather than async because the channel behind it is a thread's, and
/// because the caller cannot do anything until this answers anyway.
pub fn waiting_on(
    agent: RelayAgent,
    heard: Receiver<Event>,
    engine_port: u16,
    patience: Duration,
) -> Result<RelayHost, NoRelay> {
    let deadline = std::time::Instant::now() + patience;
    let why = loop {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        match heard.recv_timeout(left) {
            Ok(Event::RelayOpen { addr }) => {
                return Ok(RelayHost {
                    engine_port,
                    relayed: addr,
                    agent,
                })
            }
            // The agent is going to try again, and it may well succeed, but the
            // host is standing in front of a form waiting to hear. Reporting
            // the first refusal beats holding them for a rebuild that has its
            // own backoff, and hosting again is one press.
            Ok(Event::RelayDown { reason }) => break NoRelay::NoAllocation(reason),
            Ok(Event::Stopping { reason }) => break NoRelay::GaveUp(reason),
            // An answer to a request nobody made, or an event from a newer
            // agent than this coilbox. Neither says anything about whether
            // there is an allocation.
            Ok(_) => continue,
            // The agent's output ended without it saying why, which is a
            // sidecar that died rather than one that refused.
            Err(RecvTimeoutError::Disconnected) => {
                break NoRelay::GaveUp("its output ended".to_string())
            }
            Err(RecvTimeoutError::Timeout) => break NoRelay::Silent(patience),
        }
    };

    // Every way out of that loop but the address is a battle that is not going
    // to happen, and the sidecar has no idea. It would sit there rebuilding an
    // allocation nobody is going to use, and its run file would refuse the
    // host's next attempt with a pid they would have to end by hand.
    //
    // Sent on the branches where the agent said it is exiting as well as the
    // ones where it is not, because the alternative is trusting a sidecar's
    // manners with the whole of the next attempt. The write is discarded: a
    // process that has already gone cannot be told anything, which is the
    // outcome we wanted anyway.
    let _ = agent.stop();
    Err(why)
}

/// The lobby's last answer about a battle we asked it to open.
///
/// The wake-up, in the same shape as [`crate::turn::TurnAnswer`] and for the
/// same reason: the connection task is the only thing reading the wire, and
/// whoever queued the `OPENBATTLE` has to hear what came back on it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpenAnswer {
    /// The lobby has said nothing about a battle of ours. Every connection
    /// starts here and one that never hosts stays here.
    Unasked,
    /// The lobby has a battle of ours, under the id it gave it.
    Opened(u32),
    /// The lobby refused to open one, in its own words.
    Refused(String),
}

/// A connection's slot for [`OpenAnswer`], watched rather than locked so a
/// caller can wait on the next answer rather than poll for it.
pub type OpenSlot = watch::Receiver<OpenAnswer>;

/// Why the battle that was advertised does not exist.
#[derive(Debug)]
pub enum NoBattle {
    /// The lobby said no, in its own words.
    Refused(String),
    /// The connection ended before the lobby said either way, so whatever it
    /// made of the `OPENBATTLE` is not something anybody here can act on.
    Closed,
    /// The lobby said nothing at all.
    Silent(Duration),
}

impl std::fmt::Display for NoBattle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NoBattle::Refused(why) => write!(f, "the lobby would not open the battle: {why}"),
            NoBattle::Closed => write!(
                f,
                "the connection closed before the lobby said whether the battle had opened"
            ),
            NoBattle::Silent(waited) => write!(
                f,
                "the lobby did not say whether the battle had opened within {} seconds",
                waited.as_secs()
            ),
        }
    }
}

impl std::error::Error for NoBattle {}

/// Wait for the lobby to say whether the battle just advertised exists.
///
/// The gap this closes: queueing `OPENBATTLE` is not opening a battle, and on
/// the relay route the difference is an allocation held for something that
/// never happened.
///
/// `answers` has to have been marked seen before the lines were queued, which
/// is [`watch::Receiver::borrow_and_update`], or an answer that arrives while
/// they are still being written is read as the previous attempt's.
pub async fn confirmed(answers: &mut OpenSlot, patience: Duration) -> Result<u32, NoBattle> {
    let answer = tokio::time::timeout(patience, next_answer(answers))
        .await
        .map_err(|_| NoBattle::Silent(patience))?;
    match answer {
        // The connection task holds the only sender, so it dropping is the
        // connection ending. Nothing is going to answer now.
        None => Err(NoBattle::Closed),
        Some(OpenAnswer::Opened(id)) => Ok(id),
        Some(OpenAnswer::Refused(why)) => Err(NoBattle::Refused(why)),
        // The slot only ever changes to an answer, so this is unreachable in
        // practice. Treating it as no answer beats waiting again.
        Some(OpenAnswer::Unasked) => Err(NoBattle::Silent(patience)),
    }
}

/// Wait for the slot to change, or for the connection task to drop its end.
async fn next_answer(answers: &mut OpenSlot) -> Option<OpenAnswer> {
    answers.changed().await.ok()?;
    Some(answers.borrow().clone())
}

/// What a delta the reducer just produced says about a battle of ours opening.
///
/// The connection task calls this on every delta and puts what comes back in
/// the connection's slot, which is what wakes [`confirmed`]. The twin of
/// [`crate::turn::answer_in`], and it sits alongside it in the same loop.
///
/// Both ways of hearing that the battle exists count, rather than only the ack.
/// A server sends the broadcast to the founder too, usually first, and the
/// question being asked here is whether the relay is carrying a battle. More
/// evidence that it is can only stop an agent from being stopped, which is the
/// side of that decision it is safe to be wrong on.
pub(crate) fn open_answer_in(delta: &Delta, state: &Mutex<LobbyState>) -> Option<OpenAnswer> {
    match delta {
        // Our own `OPENBATTLE` ack, which is what uberserver sends the founder
        // (`in_OPENBATTLE` in its `Protocol.py`) and what the room server in
        // `coilbox_lobby_protocol::server` sends too.
        Delta::EnteredBattle { id, own: true } => Some(OpenAnswer::Opened(*id)),
        // The `BATTLEOPENED` everybody gets, kept only when the founder is us.
        Delta::BattleOpened { id } => {
            let state = lock_or_recover(state);
            let ours = state.battles.get(id)?.host == *state.my_username.as_ref()?;
            ours.then_some(OpenAnswer::Opened(*id))
        }
        Delta::OpenBattleFailed { reason } => Some(OpenAnswer::Refused(reason.clone())),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    //! Driven through [`waiting_on`] with a scripted agent rather than a real
    //! sidecar, so what is under test is the decision and not the process.
    //! `tests/relayed_battle.rs` runs the same decision against a real coturn.

    use super::*;
    use std::io::{self, Read, Write};
    use std::net::Ipv4Addr;
    use std::sync::{Arc, Mutex};

    const PATIENCE: Duration = Duration::from_secs(5);
    const ENGINE_PORT: u16 = 8452;

    /// A relayed address that is nothing like the engine's own port, so a test
    /// that confused the two says so.
    fn relayed() -> SocketAddr {
        SocketAddr::from((Ipv4Addr::new(198, 51, 100, 9), 30001))
    }

    /// An agent whose stdout never produces anything and whose stdin goes
    /// nowhere. The events under test are fed straight down the channel
    /// [`waiting_on`] reads, which is what `allocate` wires the agent's
    /// listener to.
    fn silent_agent() -> RelayAgent {
        agent_writing_to(Vec::new())
    }

    /// The same agent with its stdin pointed somewhere a test can read, which
    /// is how the tests about issue #2058 ask their question.
    fn agent_writing_to(to_agent: impl Write + Send + 'static) -> RelayAgent {
        struct Nothing;
        impl Read for Nothing {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Ok(0)
            }
        }
        RelayAgent::driving(Nothing, to_agent, |_| {})
    }

    /// Everything coilbox wrote to the agent's stdin.
    #[derive(Clone, Default)]
    struct Written(Arc<Mutex<Vec<u8>>>);

    impl Written {
        fn sent(&self) -> String {
            String::from_utf8(self.0.lock().unwrap().clone()).expect("the channel is UTF-8")
        }

        fn was_stopped(&self) -> bool {
            self.sent().contains("\"type\":\"stop\"")
        }
    }

    impl Write for Written {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    /// The whole point: an address only comes back once the agent has said its
    /// relay is open, and it is the agent's address rather than anything of
    /// ours.
    #[test]
    fn an_open_relay_is_the_address_the_battle_is_advertised_at() {
        let (saw, heard) = mpsc::channel();
        saw.send(Event::RelayOpen { addr: relayed() })
            .expect("the channel is open");

        let host = waiting_on(silent_agent(), heard, ENGINE_PORT, PATIENCE)
            .expect("the agent opened a relay");

        assert_eq!(
            Advertised::relayed(&host),
            Advertised {
                ip: Some(relayed().ip()),
                port: relayed().port(),
            }
        );
    }

    /// The engine's port and the advertised port are different numbers and stay
    /// different. Collapsing them is what would leave the host's own engine
    /// bound to a port on the relay server, which no traffic would ever reach.
    #[test]
    fn the_engines_own_port_is_not_the_one_the_battle_is_advertised_at() {
        let (saw, heard) = mpsc::channel();
        saw.send(Event::RelayOpen { addr: relayed() })
            .expect("the channel is open");

        let host = waiting_on(silent_agent(), heard, ENGINE_PORT, PATIENCE)
            .expect("the agent opened a relay");

        assert_eq!(host.engine_port, ENGINE_PORT);
        assert_ne!(Advertised::relayed(&host).port, host.engine_port);
    }

    /// A relay that would not open stops the host with the TURN server's own
    /// words, rather than handing back an address.
    #[test]
    fn a_relay_that_will_not_open_is_a_sentence_and_not_an_address() {
        let (saw, heard) = mpsc::channel();
        saw.send(Event::RelayDown {
            reason: "the server refused it (error 403 Forbidden)".to_string(),
        })
        .expect("the channel is open");

        let refused = waiting_on(silent_agent(), heard, ENGINE_PORT, PATIENCE)
            .expect_err("there is no allocation to advertise");
        assert!(
            refused.to_string().contains("error 403 Forbidden"),
            "the relay's own reason has to reach the host, got: {refused}"
        );
    }

    /// An agent that gives up rather than retrying, which is what a refused
    /// credential looks like from here.
    #[test]
    fn an_agent_that_gives_up_says_why_rather_than_timing_out() {
        let (saw, heard) = mpsc::channel();
        saw.send(Event::Stopping {
            reason: "the TURN credential was refused".to_string(),
        })
        .expect("the channel is open");

        let stopped = waiting_on(silent_agent(), heard, ENGINE_PORT, PATIENCE)
            .expect_err("an agent that stopped has no relay");
        assert!(
            stopped
                .to_string()
                .contains("the TURN credential was refused"),
            "got: {stopped}"
        );
    }

    /// An agent that says nothing has to end in a sentence rather than holding
    /// somebody in front of a form with a spinner on it.
    #[test]
    fn an_agent_that_says_nothing_gives_up_rather_than_holding_the_host() {
        let (saw, heard) = mpsc::channel();
        let quiet = waiting_on(
            silent_agent(),
            heard,
            ENGINE_PORT,
            Duration::from_millis(50),
        )
        .expect_err("nothing opened a relay");
        assert!(matches!(quiet, NoRelay::Silent(_)), "got: {quiet}");
        drop(saw);
    }

    /// An agent whose output ends without it having said anything, which is a
    /// sidecar that died on startup. Distinct from silence because there is
    /// nothing left to wait for.
    #[test]
    fn an_agent_that_dies_before_saying_anything_does_not_wait_out_the_budget() {
        let (saw, heard) = mpsc::channel::<Event>();
        drop(saw);

        let started = std::time::Instant::now();
        let gone = waiting_on(silent_agent(), heard, ENGINE_PORT, PATIENCE)
            .expect_err("a sidecar that has gone has no relay");
        assert!(matches!(gone, NoRelay::GaveUp(_)), "got: {gone}");
        assert!(
            started.elapsed() < PATIENCE,
            "a dead sidecar has to be noticed rather than waited out"
        );
    }

    /// Answers to requests are not events about the relay, so one arriving
    /// before the address must not be mistaken for the agent's verdict.
    #[test]
    fn an_answer_to_a_request_is_stepped_over_rather_than_read_as_a_verdict() {
        let (saw, heard) = mpsc::channel();
        saw.send(Event::Done { id: 1 })
            .expect("the channel is open");
        saw.send(Event::RelayOpen { addr: relayed() })
            .expect("the channel is open");

        let host = waiting_on(silent_agent(), heard, ENGINE_PORT, PATIENCE)
            .expect("the agent opened a relay after answering something else");
        assert_eq!(host.relayed, relayed());
    }

    /// The first address is the one the battle is advertised at, and a second
    /// one arriving does not change it. Re-advertising after a rebuild is issue
    /// #2031, and it must not happen by accident here.
    #[test]
    fn a_second_address_does_not_quietly_replace_the_one_hosted_at() {
        let (saw, heard) = mpsc::channel();
        saw.send(Event::RelayOpen { addr: relayed() })
            .expect("the channel is open");
        saw.send(Event::RelayOpen {
            addr: SocketAddr::from((Ipv4Addr::new(198, 51, 100, 9), 30002)),
        })
        .expect("the channel is open");

        let host = waiting_on(silent_agent(), heard, ENGINE_PORT, PATIENCE)
            .expect("the agent opened a relay");
        assert_eq!(host.relayed, relayed());
    }

    /// A battle that is not relayed names no address, because the lobby works
    /// that out from the connection and is right to.
    #[test]
    fn a_direct_battle_names_a_port_and_no_address() {
        assert_eq!(
            Advertised::direct(ENGINE_PORT),
            Advertised {
                ip: None,
                port: ENGINE_PORT
            }
        );
    }

    /// The control channel survives into the `RelayHost`, so a battle that is
    /// open can still be told to stop. Asserted by writing on it and reading
    /// the bytes back, rather than by the field existing.
    #[test]
    fn the_control_channel_survives_into_the_open_battle() {
        let written = Written::default();
        let agent = agent_writing_to(written.clone());
        let (saw, heard) = mpsc::channel();
        saw.send(Event::RelayOpen { addr: relayed() })
            .expect("the channel is open");
        let host =
            waiting_on(agent, heard, ENGINE_PORT, PATIENCE).expect("the agent opened a relay");

        host.agent.stop().expect("the channel takes a request");
        assert!(
            written.was_stopped(),
            "the open battle still holds the channel, got: {}",
            written.sent()
        );
    }

    /// Issue #2058 on this side of the seam. Every way of not getting an
    /// address leaves a sidecar that would rebuild an allocation for a battle
    /// that is not coming, and leaves the run file that refuses the next
    /// attempt to host. Each of them has to take its own agent down.
    #[test]
    fn an_attempt_that_ends_without_an_address_stops_the_agent_it_started() {
        let cases: Vec<(&str, Option<Event>)> = vec![
            (
                "a relay that would not open",
                Some(Event::RelayDown {
                    reason: "the server refused it (error 403 Forbidden)".to_string(),
                }),
            ),
            (
                "an agent on its way out",
                Some(Event::Stopping {
                    reason: "the TURN credential was refused".to_string(),
                }),
            ),
            ("an agent that said nothing at all", None),
        ];

        for (what, event) in cases {
            let written = Written::default();
            let (saw, heard) = mpsc::channel();
            if let Some(event) = event {
                saw.send(event).expect("the channel is open");
            }

            waiting_on(
                agent_writing_to(written.clone()),
                heard,
                ENGINE_PORT,
                Duration::from_millis(50),
            )
            .expect_err("there is no address to advertise");

            assert!(
                written.was_stopped(),
                "{what} has to be stopped, got: {}",
                written.sent()
            );
            drop(saw);
        }
    }

    /// And the case that must not fire, which is the whole reason the rest is
    /// safe. An agent that opened a relay is one a battle is about to be
    /// advertised on, so nothing here may take it down.
    #[test]
    fn an_agent_that_opened_a_relay_is_not_stopped() {
        let written = Written::default();
        let (saw, heard) = mpsc::channel();
        saw.send(Event::RelayOpen { addr: relayed() })
            .expect("the channel is open");

        let host = waiting_on(
            agent_writing_to(written.clone()),
            heard,
            ENGINE_PORT,
            PATIENCE,
        )
        .expect("the agent opened a relay");

        assert!(
            !written.was_stopped(),
            "a relay about to carry a battle must be left alone, got: {}",
            written.sent()
        );
        assert_eq!(host.relayed, relayed());
    }

    /// The lobby's verdict, in the three shapes it reaches a host in. Driven
    /// through the slot the connection task fills, because that is the seam.
    #[tokio::test]
    async fn the_lobbys_verdict_reaches_whoever_advertised_the_battle() {
        let (says, mut answers) = watch::channel(OpenAnswer::Unasked);
        answers.borrow_and_update();
        says.send(OpenAnswer::Opened(9)).expect("the slot is open");
        assert_eq!(
            confirmed(&mut answers, PATIENCE)
                .await
                .expect("the lobby opened it"),
            9
        );

        let (says, mut answers) = watch::channel(OpenAnswer::Unasked);
        answers.borrow_and_update();
        says.send(OpenAnswer::Refused("you are not logged in yet".to_string()))
            .expect("the slot is open");
        let refused = confirmed(&mut answers, PATIENCE)
            .await
            .expect_err("the lobby said no");
        assert!(
            refused.to_string().contains("you are not logged in yet"),
            "the lobby's own words have to reach the host, got: {refused}"
        );

        // The connection task holds the only sender, so dropping it is the
        // connection ending. Anybody waiting has to be woken rather than left
        // to spend a budget on a socket that has gone.
        let (says, mut answers) = watch::channel(OpenAnswer::Unasked);
        answers.borrow_and_update();
        drop(says);
        let closed = confirmed(&mut answers, PATIENCE)
            .await
            .expect_err("nothing is going to answer now");
        assert!(matches!(closed, NoBattle::Closed), "got: {closed}");

        let (says, mut answers) = watch::channel(OpenAnswer::Unasked);
        answers.borrow_and_update();
        let quiet = confirmed(&mut answers, Duration::from_millis(50))
            .await
            .expect_err("the lobby said nothing");
        assert!(matches!(quiet, NoBattle::Silent(_)), "got: {quiet}");
        drop(says);
    }

    /// The connection task's half, off real lines through the real parser and
    /// reducer. What a battle of ours opening and a battle of ours being
    /// refused look like by the time they reach the slot.
    #[test]
    fn a_line_off_the_wire_becomes_the_answer_a_waiting_host_gets() {
        use coilbox_lobby_protocol::{parse_line, reduce_at};

        const NOW: u64 = 1_786_000_000_000;
        let state = Mutex::new(LobbyState::new());
        for line in ["ACCEPTED alice", "LOGININFOEND"] {
            reduce_at(&mut lock_or_recover(&state), parse_line(line), NOW);
        }

        // The broadcast, which most servers send the founder before the ack.
        let announced = reduce_at(
            &mut lock_or_recover(&state),
            parse_line(
                "BATTLEOPENED 9 0 0 alice 198.51.100.9 30001 8 0 0 -1 spring\t105\tComet Catcher\tTitle\tBAR",
            ),
            NOW,
        );
        assert_eq!(
            open_answer_in(&announced[0], &state),
            Some(OpenAnswer::Opened(9))
        );

        // Somebody else's battle says nothing about ours, and reading it as
        // ours would leave a relay running that nothing is ever going to stop.
        let theirs = reduce_at(
            &mut lock_or_recover(&state),
            parse_line(
                "BATTLEOPENED 10 0 0 bob 198.51.100.4 30002 8 0 0 -1 spring\t105\tComet Catcher\tTheirs\tBAR",
            ),
            NOW,
        );
        assert_eq!(open_answer_in(&theirs[0], &state), None);

        // Our own ack.
        let acked = reduce_at(
            &mut lock_or_recover(&state),
            parse_line("OPENBATTLE 9"),
            NOW,
        );
        assert_eq!(
            open_answer_in(&acked[0], &state),
            Some(OpenAnswer::Opened(9))
        );

        // And the refusal this whole issue is about.
        let refused = reduce_at(
            &mut lock_or_recover(&state),
            parse_line("OPENBATTLEFAILED you already have a battle open"),
            NOW,
        );
        assert_eq!(
            open_answer_in(&refused[0], &state),
            Some(OpenAnswer::Refused(
                "you already have a battle open".to_string()
            ))
        );

        // Everything else leaves a waiting host waiting.
        let unrelated = reduce_at(
            &mut lock_or_recover(&state),
            parse_line("HOSTPORT 8452"),
            NOW,
        );
        assert_eq!(open_answer_in(&unrelated[0], &state), None);
    }
}
