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
//! ## A relay that comes back somewhere else
//!
//! The sidecar rebuilds an allocation it has lost, and the new one is at a
//! different address. The battle is still advertised at the old one, so it looks
//! alive and nobody can reach it (issue #2031).
//!
//! That arrives as a second `relayOpen`, on the listener [`listening`] builds and
//! [`allocate`] installs. It is a callback rather than something anybody waits on
//! because a rebuild happens while the host is doing something else entirely,
//! very likely playing the game it is carrying. [`readvertise`] is what it does
//! about one.
//!
//! Releasing the allocation when a game is over is #2018, and the check that a
//! credential has enough life left in it is #2042.

use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use coilbox_lobby_protocol::{command, Delta, LobbyState};
use coilbox_relay_protocol::Event;
use tokio::sync::watch;

use crate::conn::{HostedRelay, Registry};
use crate::lock_or_recover;
use crate::relay_agent::{NotAllowed, NotStarted, RelayAgent};
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

/// How long to wait for the agent to let a joiner through before deciding it is
/// not going to.
///
/// The agent's worst case is an allocation it has lost. It waits out its rebuild
/// backoff, at most the 32 seconds of `LONGEST_BACKOFF` in
/// `coilbox-relay-agent`, and only then opens a new allocation, which is what
/// [`ALLOCATION_PATIENCE`] above budgets 25 seconds for. An `allowPeer` is not
/// answered until there is a relay to act on (`control.rs` in that crate says
/// why), so anything shorter than the sum turns a relay that is coming back into
/// a join that failed.
///
/// It can afford to be that long because nothing waits on it. The lobby
/// connection carries on while it runs, and the join it belongs to is a player
/// whose engine is not launched yet.
pub const ALLOW_JOINER_PATIENCE: Duration =
    Duration::from_secs(32).saturating_add(ALLOCATION_PATIENCE);

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
    ///
    /// Moves when the sidecar rebuilds a lost allocation, because the new one is
    /// somewhere else. [`readvertise`] is the only thing that changes it, and it
    /// tells the lobby in the same breath.
    pub relayed: SocketAddr,
    /// The control channel, held so joiners can be let through the relay and so
    /// the battle can be stopped or ended.
    ///
    /// Shared rather than owned because [`let_joiner_through`] blocks for as
    /// long as [`ALLOW_JOINER_PATIENCE`] and must not do it holding the lock on
    /// the [`HostedRelay`] it came out of. Everything that reads that slot is a
    /// command somebody is waiting on, `mp_build_host_config` most of all, and
    /// launching the engine behind a join that is waiting out a relay rebuild
    /// would be a worse failure than the one this fixes.
    pub agent: Arc<RelayAgent>,
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
    let (saw, heard) = mpsc::channel();
    let agent = RelayAgent::spawn(
        &binary,
        &battle,
        run_file,
        listening(registry, server_key, saw),
    )
    .map_err(NoRelay::NotStarted)?;

    waiting_on(agent, heard, engine_port, ALLOCATION_PATIENCE)
}

/// What happens to every event the agent produces, for the life of the sidecar.
///
/// Two things, and they belong to different moments. Everything goes down `saw`,
/// which is what [`waiting_on`] reads while the host is standing in front of the
/// hosting form. That half stops mattering the moment the wait ends and the
/// reading end is dropped. A `relayOpen` also goes to [`rebuilt_at`], and that
/// half only starts mattering once the battle is open, because until then there
/// is nothing advertised anywhere to correct.
///
/// So the two are one listener rather than two, and it outlives the wait
/// deliberately. It runs on the agent's own reading thread.
pub(crate) fn listening(
    registry: &Registry,
    server_key: &str,
    saw: mpsc::Sender<Event>,
) -> impl Fn(Event) + Send + 'static {
    let registry = Arc::clone(registry);
    let server_key = server_key.to_string();
    move |event| {
        if let Event::RelayOpen { addr } = &event {
            rebuilt_at(&registry, &server_key, *addr);
        }
        let _ = saw.send(event);
    }
}

/// The sidecar's relay has opened at `addr`. Correct the battle this connection
/// is hosting through it, if it is hosting one.
///
/// Fires for the first allocation as well as every rebuild, and does nothing for
/// the first. Nothing is held against the connection until the lobby has said
/// the battle exists, so there is no battle to move and [`readvertise`] says so.
/// The opening address goes out with the `OPENBATTLE`, once, from [`allocate`]'s
/// caller.
///
/// The registry lock is dropped before the relay's is taken, and taken again
/// afterwards to queue the line. Everything else in coilbox that touches both
/// locks holds the registry's while it takes the relay's, so this must not hold
/// the relay's while it takes the registry's.
fn rebuilt_at(registry: &Registry, server_key: &str, addr: SocketAddr) {
    let relay = lock_or_recover(registry)
        .get(server_key)
        .map(|conn| Arc::clone(&conn.relay));
    let Some(relay) = relay else { return };
    let Some(line) = readvertise(&relay, addr) else {
        return;
    };
    // Discarded because the only failure is a connection that has gone, and a
    // lobby coilbox is no longer talking to cannot be told anything about a
    // battle it is no longer advertising.
    let _ = crate::enqueue(registry, server_key, line);
}

/// Move a hosted battle to the address its relay came back at, and give back the
/// line that tells the lobby. `None` when there is nothing to tell it.
///
/// ## Why one line and not a new battle
///
/// `RELAYEDHOST` carries the port as well as the address, which is the whole
/// reason it does (`coilbox_lobby_protocol::command::relayed_host`). So a battle
/// that has moved is one line, and the room, its players, its chat and its map
/// choice all stay where they are. Closing the battle and opening another one
/// would throw everybody in the room out to fix an address they never saw.
///
/// ## What this does not fix
///
/// Telling the players. Their engines are unaffected, because the sidecar keeps
/// each player's loopback socket across a rebuild, and the sidecar lets
/// everybody it has already vouched for through the new allocation before it
/// carries anything. What is left is the address they were told to send to,
/// which has gone, and the only way to correct it is the line below reaching
/// them through the lobby.
///
/// No lobby server implements `RELAYEDHOST` at all yet
/// (ScarylePoo/uberserver#32), and that issue explicitly leaves out updating a
/// battle that is already open. So today this line is read by nobody and the
/// battle stays advertised where it was, which is the same silent degradation
/// #2017 ships with rather than a new failure.
///
/// ## Nothing to tell it
///
/// Two cases, and they are both ordinary. There is no relayed battle on this
/// connection, which is every connection almost all of the time and every
/// connection during the wait for the first allocation. Or the relay came back
/// exactly where it was, which a TURN server is free to do, and a battle that has
/// not moved is not news.
pub fn readvertise(relay: &HostedRelay, addr: SocketAddr) -> Option<String> {
    let mut held = lock_or_recover(relay);
    let host = held.as_mut()?;
    if host.relayed == addr {
        return None;
    }
    host.relayed = addr;
    Some(command::relayed_host(addr.ip(), addr.port()))
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
                    agent: Arc::new(agent),
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

/// Let a joiner the lobby has just named through the relay, without holding up
/// the lobby connection while it happens.
///
/// The last wire in relay hosting. `CLIENTIP` names the address, the relay agent
/// installs the permission, and this is what carries one to the other.
///
/// ## Why it hands the address off rather than acting on it
///
/// [`RelayAgent::allow_joiner`] blocks until the agent answers, and the agent
/// does not answer an `allowPeer` until it has a relay to act on. So calling it
/// where `CLIENTIP` arrives, which is the connection's own read loop, would stop
/// that connection reading anything at all for as long as
/// [`ALLOW_JOINER_PATIENCE`]. Chat, joins, the battle list and the lobby's own
/// PING would all stop with it, for one player joining.
///
/// The request itself is not deferred, only the wait for its answer. Writing it
/// is the first thing the thread does, and it goes out ahead of the
/// `JOINEDBATTLE` this line precedes, let alone ahead of the joiner's engine,
/// which is not launched until the host starts the game.
///
/// ## A host who is not relaying
///
/// Does nothing, and says nothing. `CLIENTIP` only reaches a host that asked for
/// relay support at login, but asking for it is a session-wide flag and hosting
/// through the relay is a decision made per battle, so a host who took the
/// direct route can be sent one. There is no agent to tell and nothing has gone
/// wrong, and reporting it would put an error about a relay in front of somebody
/// who is not using one.
///
/// `refused` is only called when there was a relay and it would not take the
/// address. That is the case the host has to hear about: the player is in the
/// battle room, they will be in the game, and nothing they send will arrive.
pub fn let_joiner_through(
    relay: &HostedRelay,
    ip: IpAddr,
    patience: Duration,
    refused: impl FnOnce(NotAllowed) + Send + 'static,
) {
    // Taken out from under the lock and not used under it, so the slot is held
    // for a clone of an `Arc` and not for the wait that follows.
    let agent = lock_or_recover(relay)
        .as_ref()
        .map(|host| Arc::clone(&host.agent));
    let Some(agent) = agent else {
        return;
    };
    // A thread rather than a task on the runtime, because `allow_joiner` blocks
    // and because this has to be callable from a test that has no runtime. One
    // per join, and a battle's worth of joins is a battle's worth of threads,
    // each of which lives only as long as the agent takes to answer.
    std::thread::spawn(move || {
        if let Err(why) = agent.allow_joiner(ip, patience) {
            refused(why);
        }
    });
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
    /// The lobby refused the address the battle was to be advertised at, so
    /// whatever it opened is at this machine's own address rather than at the
    /// relay's.
    ///
    /// `battle` is the id of the room the lobby opened anyway, or `None` when it
    /// opened none. That is the difference between having something to close and
    /// having nothing to close, and it is the only reason the id is carried.
    NotRelayed { reason: String, battle: Option<u32> },
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
            NoBattle::NotRelayed {
                reason,
                battle: Some(_),
            } => write!(
                f,
                "the lobby would not advertise your battle at the relay's address, so the room it opened at this machine's own address has been closed: {reason}"
            ),
            NoBattle::NotRelayed {
                reason,
                battle: None,
            } => write!(
                f,
                "the lobby would not advertise your battle at the relay's address: {reason}"
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

/// The lobby's refusal of the address this connection last said its battle
/// lives at, or `None` when it has not refused one since the current attempt
/// started.
///
/// Deliberately not part of [`OpenAnswer`]. `RELAYEDHOSTFAILED` and the
/// `OPENBATTLE` answer are two lines the server writes back to back, so they
/// usually arrive in one read and the connection task handles both before
/// anybody waiting on the slot is polled again. A `watch` keeps only the last
/// value written, so putting the refusal there would have the ack overwrite it
/// and the host would be told their battle was relayed when it was not. A note
/// that is set and never overwritten cannot lose that race.
///
/// It is read after the `OPENBATTLE` answer rather than waited on, which works
/// because the server answers `RELAYEDHOST` where it reads it and only then goes
/// on to the `OPENBATTLE` behind it. So by the time there is an answer about the
/// battle, the note is already set if it is ever going to be.
pub type RefusedRelayAddress = Arc<Mutex<Option<String>>>;

/// Start an attempt with no refusal against it.
///
/// Called before the lines are queued and for the same reason
/// [`watch::Receiver::borrow_and_update`] is: the last attempt's refusal must
/// not be read as this one's.
pub fn forget_refused_address(note: &RefusedRelayAddress) {
    *lock_or_recover(note) = None;
}

/// Record that the lobby would not take the address we named. Called by the
/// connection task off [`Delta::RelayedHostRefused`], which is raised for every
/// `RELAYEDHOSTFAILED` whether or not anybody is waiting on one.
pub fn note_refused_address(note: &RefusedRelayAddress, reason: &str) {
    *lock_or_recover(note) = Some(reason.to_string());
}

/// What the lobby said about the address, if it said anything.
pub fn refused_address(note: &RefusedRelayAddress) -> Option<String> {
    lock_or_recover(note).clone()
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

    /// Where the sidecar's second allocation lands. Same relay server, different
    /// port, which is what a rebuilt allocation looks like.
    fn rebuilt() -> SocketAddr {
        SocketAddr::from((Ipv4Addr::new(198, 51, 100, 9), 30002))
    }

    /// The whole of issue #2031. The relay comes back somewhere else and the
    /// battle the lobby is advertising moves with it, in one line.
    #[test]
    fn a_relay_that_comes_back_elsewhere_moves_the_battle_with_it() {
        let relay = relay_slot(silent_agent());

        assert_eq!(
            readvertise(&relay, rebuilt()).as_deref(),
            Some("RELAYEDHOST 198.51.100.9 30002")
        );
        assert_eq!(
            lock_or_recover(&relay).as_ref().map(|host| host.relayed),
            Some(rebuilt()),
            "the battle has to be at the new address afterwards, or the next thing to read it \
             sends players back to an allocation that has gone"
        );
    }

    /// A TURN server is free to hand the same address back, and a battle that
    /// has not moved is not news. Saying so anyway would put a line on the wire
    /// every time an allocation is rebuilt, for no change.
    #[test]
    fn a_relay_that_comes_back_where_it_was_says_nothing() {
        let relay = relay_slot(silent_agent());
        assert_eq!(readvertise(&relay, relayed()), None);
    }

    /// The first allocation reaches this too, and must not be advertised twice.
    /// Nothing is held against the connection until the lobby has opened the
    /// battle, so during the wait there is no battle to move.
    #[test]
    fn the_address_a_battle_opens_at_is_not_advertised_a_second_time() {
        let opening = HostedRelay::default();
        assert_eq!(readvertise(&opening, relayed()), None);
    }

    /// A joiner's address, nothing like the relayed address above so a test that
    /// confused the two says so.
    fn joiner() -> IpAddr {
        IpAddr::from([203, 0, 113, 7])
    }

    /// A relay slot holding a relay whose agent takes requests and never
    /// answers them, which is the only version of an agent these tests can ask
    /// their question of. One whose stdout has already ended answers everything
    /// instantly with "it has gone", and against that a call that blocked for
    /// the whole patience would look exactly like one that did not.
    fn hosting_through(to_agent: impl Write + Send + 'static) -> HostedRelay {
        struct NeverAnswers(Receiver<()>);
        impl Read for NeverAnswers {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                // Blocks until the sender is dropped, which nothing here does,
                // so this is an agent that is still there and still quiet.
                let _ = self.0.recv();
                Ok(0)
            }
        }
        let (held, quiet) = mpsc::channel();
        std::mem::forget(held);
        relay_slot(RelayAgent::driving(NeverAnswers(quiet), to_agent, |_| {}))
    }

    /// A relay slot holding a relay whose agent has gone: nothing can be written
    /// to it at all, which is what a sidecar that has exited looks like from
    /// here. Chosen over an agent whose stdout has ended because that one is only
    /// noticed once the wait runs out, and a test racing its own patience would
    /// be measuring the clock.
    fn hosting_through_an_agent_that_has_gone() -> HostedRelay {
        struct Broken;
        impl Write for Broken {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "the agent has gone",
                ))
            }

            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        hosting_through(Broken)
    }

    /// Put an agent behind an open allocation and into the slot a connection
    /// holds it in, which is the shape [`let_joiner_through`] reads.
    fn relay_slot(agent: RelayAgent) -> HostedRelay {
        let (saw, heard) = mpsc::channel();
        saw.send(Event::RelayOpen { addr: relayed() })
            .expect("the channel is open");
        let host =
            waiting_on(agent, heard, ENGINE_PORT, PATIENCE).expect("the agent opened a relay");
        Arc::new(Mutex::new(Some(host)))
    }

    /// Wait for something a background thread is going to write.
    fn eventually(written: &Written, wanted: &str) -> bool {
        let deadline = std::time::Instant::now() + PATIENCE;
        while std::time::Instant::now() < deadline {
            if written.sent().contains(wanted) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        false
    }

    /// The whole issue: the lobby names an address and the relay is told to let
    /// it through, with the address the lobby named.
    #[test]
    fn a_named_joiner_is_asked_through_the_relay() {
        let written = Written::default();
        let relay = hosting_through(written.clone());

        let_joiner_through(&relay, joiner(), PATIENCE, |why| panic!("refused: {why}"));

        assert!(
            eventually(&written, "\"type\":\"allowPeer\""),
            "the agent has to be asked to let somebody through, got: {}",
            written.sent()
        );
        assert!(
            written.sent().contains("\"ip\":\"203.0.113.7\""),
            "the address asked for has to be the one the lobby named, got: {}",
            written.sent()
        );
    }

    /// A host on the direct route is still sent `CLIENTIP`, because the login
    /// flag that asks for it is session wide and the route is chosen per battle.
    /// There is no agent to tell, nothing has gone wrong, and an error about a
    /// relay would be shown to somebody who is not using one.
    #[test]
    fn a_host_who_is_not_relaying_is_not_told_anything_went_wrong() {
        let nobody: HostedRelay = HostedRelay::default();
        let (complained, complaints) = mpsc::channel();

        let_joiner_through(&nobody, joiner(), PATIENCE, move |why| {
            let _ = complained.send(why.to_string());
        });

        // Either error means nothing was reported: the callback was never
        // called, and then dropped. Only an `Ok` is a host being shown an error
        // about a relay they are not using.
        if let Ok(told) = complaints.recv_timeout(Duration::from_millis(100)) {
            panic!("a host with no relay has nothing to report, and was told: {told}");
        }
    }

    /// The point of not calling `allow_joiner` where `CLIENTIP` arrives. That
    /// call blocks until the agent answers, and the agent does not answer until
    /// it has a relay, so an inline version of this would stop the connection
    /// reading chat, joins and the lobby's own PING for the whole patience.
    ///
    /// Asserted against an agent that never answers and a patience far longer
    /// than the bound, so the only way to pass is not to wait for it.
    #[test]
    fn the_lobby_connection_is_not_held_while_the_agent_thinks() {
        let relay = hosting_through(Vec::new());

        let started = std::time::Instant::now();
        let_joiner_through(&relay, joiner(), PATIENCE, |_| {});
        let returned_in = started.elapsed();

        assert!(
            returned_in < Duration::from_millis(100),
            "handing the address off took {returned_in:?}, which is the connection being held \
             rather than the address being handed over"
        );
    }

    /// A join that cannot be allowed through fails with the agent's own reason,
    /// which is what the host is shown. The failure this replaces was the
    /// player's traffic being dropped with nothing said to anybody.
    #[test]
    fn a_relay_that_will_not_take_the_address_says_why() {
        let relay = hosting_through_an_agent_that_has_gone();
        let (complained, complaints) = mpsc::channel();

        let_joiner_through(&relay, joiner(), PATIENCE, move |why| {
            let _ = complained.send(why.to_string());
        });

        let why = complaints
            .recv_timeout(PATIENCE)
            .expect("a refusal has to reach the host rather than being swallowed");
        assert!(
            why.contains("could not be reached"),
            "the host has to be told what went wrong, got: {why}"
        );
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

    /// Issue #2064, and the reason the refusal is a note rather than another
    /// value in the answer slot.
    ///
    /// `RELAYEDHOSTFAILED` and the `OPENBATTLE` ack are written back to back by
    /// the server, arrive in one read, and are handled by the connection task
    /// one after the other with nothing waiting on the slot polled in between.
    /// A `watch` keeps only the last value put in it, so a refusal routed
    /// through the slot is overwritten by the ack and the host is told their
    /// battle is relayed when it is not.
    #[tokio::test]
    async fn a_refusal_survives_the_ack_that_lands_in_the_same_read() {
        let note = RefusedRelayAddress::default();
        let (says, mut answers) = watch::channel(OpenAnswer::Unasked);
        answers.borrow_and_update();
        forget_refused_address(&note);

        // Both lines handled before anybody waiting is polled again, which is
        // what the connection task does with one read holding both.
        note_refused_address(&note, "203.0.113.7 is this lobby server, not a relay");
        says.send(OpenAnswer::Opened(9)).expect("the slot is open");

        assert_eq!(
            confirmed(&mut answers, PATIENCE)
                .await
                .expect("the lobby did open a battle"),
            9
        );
        assert_eq!(
            refused_address(&note).as_deref(),
            Some("203.0.113.7 is this lobby server, not a relay"),
            "the ack must not lose the refusal that came with it"
        );
    }

    /// Hosting twice on one connection. The refusal is per attempt, so the
    /// second attempt must not read the first one's: acting on it would close a
    /// battle that opened properly and stop a relay carrying a game.
    #[test]
    fn a_second_attempt_starts_with_no_refusal_against_it() {
        let note = RefusedRelayAddress::default();
        note_refused_address(&note, "This server has no relay configured");
        assert!(refused_address(&note).is_some());

        forget_refused_address(&note);
        assert_eq!(refused_address(&note), None);
    }

    /// The refusal reaches the note off a real line through the real parser and
    /// reducer, whatever words the server chose. The set is written for a person
    /// and will change, so nothing here may read it.
    #[test]
    fn a_line_off_the_wire_becomes_the_refusal_the_host_acts_on() {
        use coilbox_lobby_protocol::{parse_line, reduce_at};

        const NOW: u64 = 1_786_000_000_000;
        let state = Mutex::new(LobbyState::new());
        let refusal = reduce_at(
            &mut lock_or_recover(&state),
            parse_line("RELAYEDHOSTFAILED 203.0.113.7 is this lobby server, not a relay"),
            NOW,
        );
        assert_eq!(
            refusal,
            vec![Delta::RelayedHostRefused {
                reason: "203.0.113.7 is this lobby server, not a relay".to_string(),
            }]
        );
        // And it is not an answer about the battle, which is a separate line the
        // lobby has not sent yet.
        assert_eq!(open_answer_in(&refusal[0], &state), None);
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
