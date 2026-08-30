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

/// How long to wait for the lobby to answer a `MOVERELAYEDHOST` before deciding
/// it never will, and telling the host their battle cannot be reached.
///
/// The login handshake's budget, because it is the same round trip to the same
/// server. `mp_turn_credentials` and the `OPENBATTLE` wait already reuse
/// [`crate::conn::READY_TIMEOUT`] on that argument, and the move is a plainer
/// case than either: one line out, one line back, on a connection that is
/// already up and logged in.
///
/// Measured on 30 August 2026 against the three TASServer lobbies coilbox ships
/// with, 30 `LISTCOMPFLAGS`-to-`COMPFLAGS` round trips each, no login. Slowest
/// of the 90 was 234 ms, on `lobby.springrts.com`. Medians were 33.5 ms there,
/// 17.9 ms on `lobby.techa-rts.com` and 32.8 ms on
/// `server4.beyondallreason.info` over TLS. So the budget is around 85 times the
/// worst round trip anybody measured, which is the headroom a real
/// `MOVERELAYEDHOST` needs and `LISTCOMPFLAGS` does not: the answer is a
/// broadcast to every client that asked for relay support, not a constant read
/// back out of memory.
///
/// Being generous costs only how late the warning is, because nothing waits on
/// it and the host is playing. Being mean costs an error toast telling somebody
/// their working battle is unreachable, which is the failure worth avoiding.
pub const MOVE_ANSWER_PATIENCE: Duration = crate::conn::READY_TIMEOUT;

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
    /// What the lobby has made of the moves this battle has asked for. See
    /// [`MoveWatch`].
    pub moves: MoveWatch,
    /// How much life is left in the credential the sidecar is signing with. See
    /// [`CredentialWatch`].
    pub credential: CredentialWatch,
}

/// What has become of the `MOVERELAYEDHOST` lines this battle has sent.
///
/// It lives on the [`RelayHost`] so that its life is the battle's. A new
/// hosting attempt builds a new `RelayHost` and so starts with a clean one, and
/// a battle that has ended leaves an empty [`HostedRelay`] with nothing here to
/// warn about. There is no reset to forget to call.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MoveWatch {
    /// How many moves this battle has asked for, which is also what numbers
    /// them. A wait that finds a higher number than the one it armed on has been
    /// overtaken by a later rebuild, and it is that rebuild's wait that decides
    /// whether the lobby is listening.
    sent: u64,
    /// Whether the lobby has answered move number [`Self::sent`], either way.
    answered: bool,
    /// Whether the host has already been told this battle cannot be reached.
    ///
    /// Told once per battle, not once per rebuild. No lobby server implements
    /// the move yet (ScarylePoo/uberserver#43), so every rebuild on every server
    /// there is goes unanswered, and a relay that keeps losing its allocation
    /// would otherwise put the same error in front of the host every time it
    /// came back. The first one is news. The second says nothing the first did
    /// not, because the battle has been unreachable since then.
    told: bool,
}

/// How much life is left in the credential the sidecar is signing with, and
/// whether the host has been told it has run out.
///
/// It lives on the [`RelayHost`] for the same reason [`MoveWatch`] does: its
/// life is the battle's, a new hosting attempt starts with a clean one, and
/// there is no reset to forget.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CredentialWatch {
    /// Unix millis, the moment the credential the sidecar is holding stops
    /// being good.
    ///
    /// `None` is a relay whose credential nobody recorded, which is a
    /// hand-built [`RelayHost`] in a test and nothing else. Nothing is renewed
    /// and nobody is warned, because there is no schedule to work out.
    expires_at: Option<u64>,
    /// Whether the host has already been told this battle is running on a
    /// credential that has run out.
    ///
    /// Once per battle, on the same argument as [`MoveWatch::told`]: the second
    /// warning says nothing the first did not, because the battle has been on
    /// borrowed time since then.
    told: bool,
}

/// A `MOVERELAYEDHOST` to send, and the number to wait on an answer to it
/// under.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Move {
    /// The line for the lobby.
    pub line: String,
    /// Which of this battle's moves this is. Passed back to [`move_unanswered`]
    /// once the wait is over, so a wait that a later rebuild overtook knows to
    /// stand down.
    pub number: u64,
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
    let credential = turn::credentials(registry, server_key, now_ms, patience)
        .await
        .map_err(NoRelay::NoCredential)?;
    let binary =
        relay_sidecar::resolve_sidecar().ok_or(NoRelay::NotStarted(NotStarted::NoSidecar))?;

    let battle = Battle {
        engine_port,
        max_peers,
        turn: Some(credential.turn),
    };
    let (saw, heard) = mpsc::channel();
    let agent = RelayAgent::spawn(
        &binary,
        &battle,
        run_file,
        listening(registry, server_key, saw, MOVE_ANSWER_PATIENCE),
    )
    .map_err(NoRelay::NotStarted)?;

    let mut host = waiting_on(agent, heard, engine_port, ALLOCATION_PATIENCE)?;
    // Written on here rather than passed into `waiting_on`, because this is the
    // only place that knows it and `waiting_on` is the half that runs without a
    // lobby. [`renewing`] reads it to work out when to ask for the next one.
    host.credential.expires_at = Some(credential.expires_at);
    Ok(host)
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
///
/// `patience` is how long the lobby gets to answer the move a rebuild sends, and
/// it is a parameter for the same reason [`allocate`]'s is: the caller owns the
/// budget and the tests own the clock.
pub(crate) fn listening(
    registry: &Registry,
    server_key: &str,
    saw: mpsc::Sender<Event>,
    patience: Duration,
) -> impl Fn(Event) + Send + 'static {
    let registry = Arc::clone(registry);
    let server_key = server_key.to_string();
    move |event| {
        if let Event::RelayOpen { addr } = &event {
            rebuilt_at(&registry, &server_key, *addr, patience);
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
fn rebuilt_at(registry: &Registry, server_key: &str, addr: SocketAddr, patience: Duration) {
    let held = lock_or_recover(registry)
        .get(server_key)
        .map(|conn| (Arc::clone(&conn.relay), conn.sink.clone()));
    let Some((relay, sink)) = held else { return };
    let Some(moved) = readvertise(&relay, addr) else {
        return;
    };
    // A connection that has gone cannot be told anything about a battle it is no
    // longer advertising, and it cannot answer either, so there is nothing to
    // wait for and nothing to warn about.
    if !crate::enqueue(registry, server_key, moved.line).success {
        return;
    }
    warn_if_unanswered(relay, moved.number, patience, move || {
        crate::conn::emit(
            &sink,
            crate::conn::LobbyEvent::Delta {
                delta: Delta::RelayedHostMoveUnanswered,
            },
        );
    });
}

/// Tell the host their battle cannot be reached if the lobby has not answered
/// move `number` within `patience`.
///
/// ## Why a wait at all
///
/// Because nothing else can tell us. Coilbox only relay-hosts on a server whose
/// compatibility flags carried `r`, which `turn::credentials` makes structural
/// by refusing a credential without one, so there is no relayed battle on a
/// server that never claimed a relay and no move to go unanswered there. But `r`
/// is one flag for the whole of relay hosting and carries no version, and
/// `MOVERELAYEDHOST` was added to the protocol long after it
/// (ScarylePoo/uberserver#43, still open). So a server that advertised `r` says
/// nothing about whether it knows this command, and today none of them do. What
/// the server does with the line is the only evidence there is.
///
/// ## Why a thread
///
/// The same reason [`let_joiner_through`] uses one. The caller is the relay
/// agent's own reading thread, which has no runtime under it, and the wait is
/// long enough that spending the agent's reader on it would stop coilbox hearing
/// anything else the sidecar says.
///
/// One thread per rebuild, each living as long as the lobby has to answer.
fn warn_if_unanswered(
    relay: HostedRelay,
    number: u64,
    patience: Duration,
    unanswered: impl FnOnce() + Send + 'static,
) {
    std::thread::spawn(move || {
        std::thread::sleep(patience);
        if move_unanswered(&relay, number) {
            unanswered();
        }
    });
}

/// The lobby has answered a move of ours, so the wait on it ends.
///
/// Called for both answers, because either is the lobby proving it read the
/// line. Which of the two it was is the reducer's business and the host hears
/// about a refusal from there.
pub fn move_answered(relay: &HostedRelay) {
    if let Some(host) = lock_or_recover(relay).as_mut() {
        host.moves.answered = true;
    }
}

/// Whether move `number` ran out of patience unanswered and the host has not
/// been told about this battle yet. Marks them told, because it is the caller
/// that goes on to tell them.
///
/// False on three counts, all of them ordinary. The lobby answered. A later
/// rebuild has already sent another move, so this wait has been overtaken and
/// the later one is the one that decides. Or the battle is over and the slot is
/// empty, and a battle nobody is in does not need to be reachable.
pub(crate) fn move_unanswered(relay: &HostedRelay, number: u64) -> bool {
    let mut held = lock_or_recover(relay);
    let Some(host) = held.as_mut() else {
        return false;
    };
    if host.moves.sent != number || host.moves.answered || host.moves.told {
        return false;
    }
    host.moves.told = true;
    true
}

/// Whether a delta the reducer just produced is the lobby answering a
/// `MOVERELAYEDHOST` of ours.
///
/// The twin of [`open_answer_in`], and it sits beside it in the same loop.
///
/// `BATTLEHOSTMOVED` goes to everybody watching the battle list, so it only
/// counts when the battle it names is one we are hosting. Somebody else's relay
/// moving says nothing about whether this lobby read our line.
/// `MOVERELAYEDHOSTFAILED` only ever reaches the client that sent one.
pub(crate) fn move_answer_in(delta: &Delta, state: &Mutex<LobbyState>) -> bool {
    match delta {
        Delta::BattleHostMoved { id } => {
            let state = lock_or_recover(state);
            let ours = || Some(state.battles.get(id)?.host == *state.my_username.as_ref()?);
            ours().unwrap_or(false)
        }
        Delta::RelayedHostMoveRefused { .. } => true,
        _ => false,
    }
}

/// Move a hosted battle to the address its relay came back at, and give back the
/// line that tells the lobby along with the number to wait on its answer under.
/// `None` when there is nothing to tell it.
///
/// ## Why one line and not a new battle
///
/// `MOVERELAYEDHOST` carries the port as well as the address
/// (`coilbox_lobby_protocol::command::move_relayed_host`). So a battle that has
/// moved is one line, and the room, its players, its chat and its map choice all
/// stay where they are. Closing the battle and opening another one would throw
/// everybody in the room out to fix an address they never saw.
///
/// ## Why it is not a second `RELAYEDHOST`
///
/// Because the server cannot tell the two apart. A relay host reopening its
/// battle sends `RELAYEDHOST` while the old battle is still open, and the
/// server reads the staged address before the `LEAVEBATTLE` that closes the old
/// one. Under one command that reopen reads as a move, applied to a battle
/// about to be destroyed, and the replacement opens at the host's own
/// unreachable address (issue #2098, ScarylePoo/uberserver#43).
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
/// No lobby server runs the move yet. ScarylePoo/uberserver#43 is the server
/// half and it is open, so today this line is read by nobody and the battle
/// stays advertised where it was.
///
/// ## What the lobby says back
///
/// `BATTLEHOSTMOVED` when it took the move, which everybody watching the battle
/// list gets and which reaches the host as confirmation. `MOVERELAYEDHOSTFAILED`
/// when it did not, which only the host gets and which the host has to see: a
/// refused move is a battle that is live and unreachable. Both are handled where
/// every other line off the wire is, in the reducer, because nothing is waiting
/// on the answer as such. The rebuild that set this off happened while the host
/// was doing something else, very likely playing the game the relay is carrying.
///
/// Or nothing at all, on every lobby that exists today, which is the same
/// unreachable battle as a refusal with nobody saying so. That one is not on the
/// wire to be reduced, so [`warn_if_unanswered`] is what notices it and
/// [`MoveWatch`] is what counts the moves it needs to notice with (issue #2102).
///
/// ## Nothing to tell it
///
/// Two cases, and they are both ordinary. There is no relayed battle on this
/// connection, which is every connection almost all of the time and every
/// connection during the wait for the first allocation. Or the relay came back
/// exactly where it was, which a TURN server is free to do, and a battle that has
/// not moved is not news.
pub fn readvertise(relay: &HostedRelay, addr: SocketAddr) -> Option<Move> {
    let mut held = lock_or_recover(relay);
    let host = held.as_mut()?;
    if host.relayed == addr {
        return None;
    }
    host.relayed = addr;
    // Numbered here rather than by the caller, under the same lock that moved
    // the address, so a second rebuild cannot slip between the two and leave a
    // wait armed on a number that was never sent.
    host.moves.sent += 1;
    host.moves.answered = false;
    Some(Move {
        line: command::move_relayed_host(addr.ip(), addr.port()),
        number: host.moves.sent,
    })
}

/// How long to wait before asking the lobby for the credential after this one,
/// or `None` when there is no longer enough left to be worth asking for.
///
/// Half of whatever is left, which is not a number so much as the convention
/// this exact problem already has two answers in. The `turn` crate refreshes a
/// TURN allocation at half the lifetime the server granted it, which
/// `coilbox-relay-agent`'s `allocation.rs` records and this repo's coturn tests
/// are built around. DHCP renews a lease at half its duration for the same
/// reason, RFC 2131 section 4.4.5's T1.
///
/// What the halving buys is the retry budget. Ask at the halfway point and a
/// lobby that says nothing, or refuses, or is briefly unreachable gets asked
/// again at half of what is left, and again, for as many tries as the remaining
/// life divides into [`crate::turn::REBUILD_HEADROOM`]. On the shortest
/// credential coilbox will host at all, 5115 seconds, that is eight asks spread
/// over eighty-five minutes rather than a fixed interval that either hammers a
/// lobby or gets one chance. `halving_gives_a_lobby_a_bounded_run_of_tries` is
/// where that eight is counted rather than reasoned about.
///
/// `None` at the end of that, and the end is where it matters: a credential with
/// less than the sidecar's worst-case rebuild backoff left cannot survive the
/// rebuild it would have to sign, so there is nothing left to protect and the
/// host is told instead.
fn renew_in(expires_at: u64, now_ms: u64) -> Option<Duration> {
    let left = Duration::from_millis(expires_at.saturating_sub(now_ms));
    (left > crate::turn::REBUILD_HEADROOM).then(|| left / 2)
}

/// Keep the credential this battle's relay signs with ahead of its own expiry,
/// for as long as the battle lasts and coilbox is open (issue #2092).
///
/// ## What it fixes and what it cannot
///
/// A relayed battle survives its credential running out, right up until the
/// relay has to be rebuilt. A rebuild opens a new session, the TURN server
/// judges the credential afresh, and a dead one answers 401 and ends the game
/// for everybody. #2042 stopped a battle opening on a credential too short to
/// see a typical game out. This is the other one in a hundred: the game that
/// runs longer, or the credential that was already part spent when hosting
/// began.
///
/// It works only while the coilbox window is open, and that limit is the honest
/// half of the answer rather than an oversight. The sidecar outlives coilbox on
/// purpose (#2013) and has no lobby connection of its own, so the moment coilbox
/// closes there is nobody left to mint anything. What a host gets from this is
/// that the credential is never more than half spent while coilbox is there, so
/// closing the window leaves the relay with at least half a lifetime of rebuilds
/// in hand rather than however much happened to be left.
///
/// [`renew_before_quitting`] takes the other half of that: one more ask on the
/// way out, so the sidecar carries a whole lifetime rather than somewhere
/// between a whole one and half of one. Playing on for longer than that after
/// quitting is still a battle a rebuild would end, and the reason no client-side
/// design closes it is written down there (issue #2105).
///
/// ## A task rather than a thread
///
/// Unlike [`warn_if_unanswered`], which is set off by the sidecar's reader
/// thread. This is started from `advertise`, which is already on the runtime,
/// and the work it does is an async lobby round trip. One task per relayed
/// battle.
///
/// ## When it stops
///
/// Four ways, and every one of them is the battle no longer being this one: the
/// slot is empty because the host left the battle, it holds a different relay
/// because they opened another, the credential has run down past the point of
/// renewing, or the sidecar will not take a write because it has gone.
pub fn renewing(registry: &Registry, server_key: &str, patience: Duration) {
    let registry = Arc::clone(registry);
    let server_key = server_key.to_string();
    tokio::spawn(async move {
        loop {
            let Some((agent, expires_at)) = still_ours(&registry, &server_key, None) else {
                return;
            };
            let Some(wait) = renew_in(expires_at, crate::conn::now_ms()) else {
                out_of_credential(&registry, &server_key);
                return;
            };
            tokio::time::sleep(wait).await;

            // Read again rather than trusting what was read before the sleep,
            // which on a fresh credential was the better part of an hour ago.
            let Some((agent, held_until)) = still_ours(&registry, &server_key, Some(&agent)) else {
                return;
            };

            match renew_now(&registry, &server_key, &agent, held_until, patience).await {
                // Nothing better came back: the lobby refused, said nothing, or
                // offered one that expires sooner than what the sidecar has. The
                // next turn asks again at half of what is left, and running out
                // of turns is what tells the host.
                Renewed::NotYet => continue,
                Renewed::Until(expires_at) => {
                    credential_now_expires_at(&registry, &server_key, expires_at)
                }
                Renewed::NobodyThere => return,
            }
        }
    });
}

/// What one ask of the lobby came to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Renewed {
    /// The sidecar is now signing with a credential good until this moment.
    Until(u64),
    /// Nothing better came back, and the sidecar is still on the old one.
    NotYet,
    /// The sidecar would not take the write, so it has gone and there is nobody
    /// left to renew for.
    NobodyThere,
}

/// Ask the lobby for the credential after this one and hand it to the sidecar.
///
/// Split from [`renewing`] for the same reason [`waiting_on`] is split from
/// [`allocate`]: it is the half worth testing, and running it inside the loop
/// would mean waiting out half a credential's lifetime to see it happen once.
///
/// `held_until` is when the credential the sidecar is on runs out. A lobby free
/// to mint whatever it likes is free to mint something worse than that, and
/// taking one of those would shorten the battle rather than lengthen it.
pub(crate) async fn renew_now(
    registry: &Registry,
    server_key: &str,
    agent: &RelayAgent,
    held_until: u64,
    patience: Duration,
) -> Renewed {
    let Ok(fresh) = crate::turn::renewed(registry, server_key, patience).await else {
        return Renewed::NotYet;
    };
    if fresh.expires_at <= held_until {
        return Renewed::NotYet;
    }
    match agent.renew_credential(&fresh.turn) {
        Ok(()) => Renewed::Until(fresh.expires_at),
        Err(_) => Renewed::NobodyThere,
    }
}

/// Which of this coilbox's connections are hosting a battle through a relay
/// right now.
///
/// A list rather than an option because the registry holds one entry per lobby
/// and somebody can be logged in to more than one. In practice it is empty or
/// holds one key, because hosting is one battle and one engine.
///
/// Public so that quitting can decide whether there is anything to do before it
/// spawns anything, which is what keeps an ordinary quit free.
pub fn relaying_on(registry: &Registry) -> Vec<String> {
    lock_or_recover(registry)
        .iter()
        .filter(|(_, conn)| lock_or_recover(&conn.relay).is_some())
        .map(|(key, _)| key.clone())
        .collect()
}

/// Ask the lobby for one last credential for every relayed battle, on the way
/// out of coilbox (issue #2105).
///
/// ## What quitting decides
///
/// The number the sidecar carries into the rest of the game. [`renewing`] keeps
/// the credential topped up while coilbox is open, and the moment coilbox goes
/// that stops for good: the sidecar has no lobby connection of its own, so
/// whatever it is holding when the window closes is what it has for the rest of
/// the battle. Rebuild the relay after that runs out and coturn judges the
/// credential afresh, answers 401, and everybody in the game is dropped.
///
/// [`renewing`] on its own leaves that number anywhere between a full lifetime
/// and half of one, because it renews at half life and quitting lands wherever
/// it lands. Asking once more on the way out makes it a full lifetime every
/// time. On 5115 seconds, the shortest credential coilbox will host on at all,
/// that is the difference between 42 minutes of unattended rebuilds and 85.
///
/// What it cannot cover is a kill, a crash or a power cut, where none of our
/// code runs and the sidecar keeps whatever it had, which is what happens today
/// anyway.
///
/// ## Why this is as far as coilbox can go
///
/// Renewing after the window has gone needs the sidecar to hold something it
/// can present to the lobby on its own behalf, and every shape of that costs
/// more than it buys.
///
/// A second lobby login means the sidecar holds something it can be the user
/// with, for the length of a game, where today it holds one short-lived
/// credential scoped to one TURN server. Most TASServer implementations also
/// refuse or displace a second concurrent login for one account, so the sidecar
/// connecting would knock out the host's own session and end the battle it was
/// meant to protect.
///
/// A credential written beside the run file, the way #2062's stop note is,
/// works, and puts a live relay credential in a predictable path for the length
/// of a game. The credential reaches the sidecar in its environment today, and
/// `relay_sidecar::build_args` keeps the password out of argv on purpose, so a
/// file is a step down from where it is rather than a sideways move.
///
/// A narrow token, minted once by the lobby, that buys relay credentials and
/// cannot log in or chat or be the user, is the design that would actually
/// close this. It is a server-side decision and there is nothing to build
/// against: no lobby implements even `TURNCREDENTIALS` yet
/// (ScarylePoo/uberserver#46), so the client half would be guesswork about a
/// protocol nobody has written.
///
/// So the limit is a decision rather than an omission. What is left after this
/// is a host who quits, plays on for longer than a whole credential lifetime,
/// and then loses their relay. The only lever left on that one is the lobby
/// minting longer, which is ScarylePoo/uberserver#27.
///
/// ## Why the host is not warned about it
///
/// [`crate::turn::credentials`] refuses to open a relayed battle on a
/// credential shorter than the 99th percentile game plus a rebuild, so at the
/// moment a battle opens the honest sentence is that it is fine, 99 times in a
/// hundred. A line on every relayed battle about a risk that needs a long game
/// and a quit and a rebuild is a line people learn to skip past.
/// [`MoveWatch::told`] and [`CredentialWatch::told`] are both in this file
/// because a warning repeated was already judged worse than none. The moment it
/// stops being fine is the credential actually running down, and
/// [`out_of_credential`] says so then, while coilbox is open and while hosting
/// again is still something the host can do.
pub async fn renew_before_quitting(registry: &Registry, patience: Duration) {
    for key in relaying_on(registry) {
        let Some((agent, held_until)) = still_ours(registry, &key, None) else {
            continue;
        };
        // The answer is discarded because there is nowhere left to put it:
        // [`credential_now_expires_at`] writes the number that the next turn of
        // a loop reads, and this process will not live to take one. The write
        // to the sidecar is the point, and `renew_now` has already made it by
        // the time this returns.
        let _ = renew_now(registry, &key, &agent, held_until, patience).await;
    }
}

/// The relay this connection is hosting through, if it is still the one
/// `ours` names, along with when its credential runs out.
///
/// `ours` is `None` on the first look, when there is nothing to compare against
/// yet. After that it is the agent the last look found, and a slot holding a
/// different one is a second battle that has taken over: its own [`renewing`]
/// is looking after it and this one has to stand down rather than renew a
/// credential for somebody else's relay.
fn still_ours(
    registry: &Registry,
    server_key: &str,
    ours: Option<&Arc<RelayAgent>>,
) -> Option<(Arc<RelayAgent>, u64)> {
    let relay = lock_or_recover(registry)
        .get(server_key)
        .map(|conn| Arc::clone(&conn.relay))?;
    let held = lock_or_recover(&relay);
    let host = held.as_ref()?;
    if ours.is_some_and(|ours| !Arc::ptr_eq(ours, &host.agent)) {
        return None;
    }
    Some((Arc::clone(&host.agent), host.credential.expires_at?))
}

/// Record that the sidecar is now signing with a credential good until
/// `expires_at`.
///
/// Written back against the connection rather than kept in the loop, because
/// the number is what the next battle's warning is judged against and a loop
/// that stood down would take its copy with it.
fn credential_now_expires_at(registry: &Registry, server_key: &str, expires_at: u64) {
    let Some(relay) = lock_or_recover(registry)
        .get(server_key)
        .map(|conn| Arc::clone(&conn.relay))
    else {
        return;
    };
    let mut held = lock_or_recover(&relay);
    if let Some(host) = held.as_mut() {
        host.credential.expires_at = Some(expires_at);
    }
}

/// Tell the host their battle is running on a credential that has run out, once
/// per battle.
///
/// The one thing left to do when renewal has run out of tries. Nothing here can
/// keep the battle safe any more, and the host is the only person who can: the
/// game they are in carries on, and hosting again is what gets them a live
/// credential.
fn out_of_credential(registry: &Registry, server_key: &str) {
    let held = lock_or_recover(registry)
        .get(server_key)
        .map(|conn| (Arc::clone(&conn.relay), conn.sink.clone()));
    let Some((relay, sink)) = held else { return };
    if !credential_is_dead(&relay) {
        return;
    }
    crate::conn::emit(
        &sink,
        crate::conn::LobbyEvent::Delta {
            delta: Delta::RelayCredentialExpired,
        },
    );
}

/// Whether this battle's credential has run out and the host has not been told
/// yet. Marks them told, because it is the caller that goes on to tell them.
///
/// The twin of [`move_unanswered`], and false on the same kind of ordinary
/// grounds: the host already knows, or the battle is over and the slot is empty,
/// and a battle nobody is in does not need a credential.
pub(crate) fn credential_is_dead(relay: &HostedRelay) -> bool {
    let mut held = lock_or_recover(relay);
    let Some(host) = held.as_mut() else {
        return false;
    };
    if host.credential.told {
        return false;
    }
    host.credential.told = true;
    true
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
                    moves: MoveWatch::default(),
                    // Nothing here knows when the credential runs out, and
                    // nothing here should: this is the half a test can drive
                    // without a lobby. [`allocate`] fills it in from the
                    // credential it fetched, and a relay that never went through
                    // one has nothing to renew.
                    credential: CredentialWatch::default(),
                });
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

    /// Everything coilbox wrote to the agent's stdin, and a way to have the
    /// channel stop taking it.
    #[derive(Clone, Default)]
    struct Written {
        sent: Arc<Mutex<Vec<u8>>>,
        /// Set by [`Written::breaks`], which is a sidecar that has exited.
        broken: Arc<std::sync::atomic::AtomicBool>,
    }

    impl Written {
        fn sent(&self) -> String {
            String::from_utf8(self.sent.lock().unwrap().clone()).expect("the channel is UTF-8")
        }

        fn was_stopped(&self) -> bool {
            self.sent().contains("\"type\":\"stop\"")
        }

        /// The sidecar has gone, so nothing more can be written to it. Chosen
        /// over an agent whose stdout has ended because that one is only noticed
        /// once a wait runs out.
        fn breaks(&self) {
            self.broken
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }

    impl Write for Written {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            if self.broken.load(std::sync::atomic::Ordering::Relaxed) {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "the agent has gone",
                ));
            }
            self.sent.lock().unwrap().extend_from_slice(buf);
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
    ///
    /// The line is `MOVERELAYEDHOST` rather than a second `RELAYEDHOST` because
    /// the server reads a `RELAYEDHOST` from a host who is already hosting as
    /// the address for the battle they are about to open, which is what a relay
    /// host reopening a battle sends (issue #2098).
    #[test]
    fn a_relay_that_comes_back_elsewhere_moves_the_battle_with_it() {
        let relay = relay_slot(silent_agent());

        assert_eq!(
            readvertise(&relay, rebuilt()),
            Some(Move {
                line: "MOVERELAYEDHOST 198.51.100.9 30002".to_string(),
                number: 1,
            })
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

    /// Somewhere else again, which a relay that keeps losing its allocation
    /// produces.
    fn rebuilt_again() -> SocketAddr {
        SocketAddr::from((Ipv4Addr::new(198, 51, 100, 9), 30003))
    }

    /// Issue #2102, and the case that is every lobby server there is. Nobody
    /// implements `MOVERELAYEDHOST`, so nobody refuses it either, and the host
    /// is left with a battle that is still in the list and cannot be joined.
    #[test]
    fn a_move_the_lobby_never_answers_reaches_the_host() {
        let relay = relay_slot(silent_agent());
        let moved = readvertise(&relay, rebuilt()).expect("the relay moved");

        assert!(
            move_unanswered(&relay, moved.number),
            "silence is the same unreachable battle as a refusal, so it has to be told"
        );
    }

    /// The lobby answered, either way, so there is nothing to warn about. A
    /// refusal is the reducer's to raise and an ack is the battle working.
    #[test]
    fn a_move_the_lobby_answers_says_nothing_more() {
        let relay = relay_slot(silent_agent());
        let moved = readvertise(&relay, rebuilt()).expect("the relay moved");

        move_answered(&relay);

        assert!(!move_unanswered(&relay, moved.number));
    }

    /// Told once per battle, not once per rebuild. A relay that keeps losing its
    /// allocation on a lobby that never answers would otherwise raise the same
    /// error every time it came back, about a battle that has been unreachable
    /// since the first one.
    #[test]
    fn a_second_unanswered_move_does_not_tell_the_host_twice() {
        let relay = relay_slot(silent_agent());

        let first = readvertise(&relay, rebuilt()).expect("the relay moved");
        assert!(move_unanswered(&relay, first.number));

        let again = readvertise(&relay, rebuilt_again()).expect("the relay moved again");
        assert_eq!(again.number, 2, "each move is numbered as it goes out");
        assert!(!move_unanswered(&relay, again.number));
    }

    /// A wait that a later rebuild overtook. The lobby has had no time to answer
    /// the newer move, so calling the battle unreachable off the older one would
    /// be a warning about a question that is still open.
    #[test]
    fn a_move_a_later_rebuild_overtook_stands_down() {
        let relay = relay_slot(silent_agent());
        let first = readvertise(&relay, rebuilt()).expect("the relay moved");
        let _second = readvertise(&relay, rebuilt_again()).expect("the relay moved again");

        assert!(!move_unanswered(&relay, first.number));
    }

    /// The battle ended while the lobby was being waited on. Nobody is in it and
    /// nobody is going to join it, so there is nothing to tell the host.
    #[test]
    fn a_battle_that_is_over_before_the_wait_ends_says_nothing() {
        let relay = relay_slot(silent_agent());
        let moved = readvertise(&relay, rebuilt()).expect("the relay moved");

        *lock_or_recover(&relay) = None;

        assert!(!move_unanswered(&relay, moved.number));
    }

    /// The wiring around all of the above: the wait runs on a thread of its own
    /// and calls back when it is over. Driven with a patience a test can afford
    /// rather than [`MOVE_ANSWER_PATIENCE`], because what is under test is that
    /// the callback happens and not how long the real budget is.
    #[test]
    fn the_wait_for_an_answer_runs_off_the_calling_thread() {
        let relay = relay_slot(silent_agent());
        let moved = readvertise(&relay, rebuilt()).expect("the relay moved");
        let told = Arc::new(Mutex::new(false));

        let flag = Arc::clone(&told);
        warn_if_unanswered(
            Arc::clone(&relay),
            moved.number,
            Duration::from_millis(50),
            move || *lock_or_recover(&flag) = true,
        );
        // Nothing has been said yet, which is what makes this a wait rather than
        // a verdict passed at the moment the line went out.
        assert!(!*lock_or_recover(&told));

        let gave_up_at = std::time::Instant::now() + PATIENCE;
        while !*lock_or_recover(&told) && std::time::Instant::now() < gave_up_at {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(
            *lock_or_recover(&told),
            "the host has to be told once the lobby's time is up"
        );
    }

    /// A state with a battle in it, hosted by whoever `host` names, and logged in
    /// as alice. Folded through the real parser so nothing here has to know the
    /// shape of a `BATTLEOPENED`.
    fn watching_a_battle_hosted_by(host: &str) -> Mutex<LobbyState> {
        use coilbox_lobby_protocol::{parse_line, reduce};

        let mut state = LobbyState::new();
        reduce(&mut state, parse_line("ACCEPTED alice"));
        reduce(
            &mut state,
            parse_line(&format!(
                "BATTLEOPENED 9 0 0 {host} 198.51.100.9 30001 8 0 0 -1 spring\t105\tComet \
                 Catcher\tTheirs\tBAR"
            )),
        );
        Mutex::new(state)
    }

    /// Which lines off the wire count as the lobby having read our move.
    ///
    /// `BATTLEHOSTMOVED` is a battle-list line everybody with relay support
    /// gets, so somebody else's relay moving proves nothing about ours. Reading
    /// it as an answer would leave a lobby that ignores the command looking like
    /// one that took it, for as long as anybody else on the server is relaying.
    #[test]
    fn only_a_move_of_our_own_battle_counts_as_an_answer() {
        let ours = watching_a_battle_hosted_by("alice");
        let theirs = watching_a_battle_hosted_by("bob");

        assert!(move_answer_in(&Delta::BattleHostMoved { id: 9 }, &ours));
        assert!(!move_answer_in(&Delta::BattleHostMoved { id: 9 }, &theirs));
        // A battle this client holds nothing for, which the reducer raises a
        // delta for anyway because the list is about to be told about it.
        assert!(!move_answer_in(&Delta::BattleHostMoved { id: 4 }, &ours));
        // The refusal only ever reaches the client that sent the line, so it
        // needs no such check.
        assert!(move_answer_in(
            &Delta::RelayedHostMoveRefused {
                reason: "you are not hosting a battle to move".to_string()
            },
            &theirs
        ));
        // And an unrelated line is not an answer, or every busy lobby would look
        // like one that read the move.
        assert!(!move_answer_in(&Delta::BattleOpened { id: 9 }, &ours));
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

    /// A moment with room either side of it, so a test can talk about a
    /// credential that ran out without arithmetic underflowing.
    use crate::turn::tests::{minted, wired_watching, KEY, NOW};
    use crate::turn::TurnAnswer;

    /// A lobby connection with a relayed battle already hosting through it,
    /// which is the state every renewal test starts in.
    struct Renewing {
        registry: Registry,
        /// The sidecar's end of the control channel, so a test can read what
        /// coilbox sent it.
        written: Written,
        /// The agent behind that channel, taken back out of the relay slot.
        agent: Arc<RelayAgent>,
        answers: tokio::sync::watch::Sender<TurnAnswer>,
        state: Arc<Mutex<coilbox_lobby_protocol::LobbyState>>,
        /// Every event the frontend was sent, as the JSON it would have seen.
        seen: Arc<Mutex<Vec<String>>>,
        /// The lobby's end of the outbound queue. Held and never read, because
        /// dropping it is the connection closing and `turn::renewed` would then
        /// answer that rather than asking anything.
        _sent: tokio::sync::mpsc::UnboundedReceiver<crate::conn::Outbound>,
    }

    fn hosting_and_renewing() -> Renewing {
        let seen: Arc<Mutex<Vec<String>>> = Arc::default();
        let recorder = seen.clone();
        let sink = Arc::new(Mutex::new(tauri::ipc::Channel::new(move |body| {
            let json = match body {
                tauri::ipc::InvokeResponseBody::Json(s) => s,
                tauri::ipc::InvokeResponseBody::Raw(b) => String::from_utf8_lossy(&b).into_owned(),
            };
            lock_or_recover(&recorder).push(json);
            Ok(())
        })));

        let w = wired_watching(crate::conn::ConnProtocol::TasServer, sink);
        let written = Written::default();
        let relay = relay_slot(agent_writing_to(written.clone()));
        let agent = lock_or_recover(&relay)
            .as_ref()
            .map(|host| Arc::clone(&host.agent))
            .expect("the slot was just filled");
        *lock_or_recover(
            &lock_or_recover(&w.registry)
                .get(KEY)
                .expect("the connection is registered")
                .relay,
        ) = lock_or_recover(&relay).take();

        Renewing {
            registry: w.registry,
            written,
            agent,
            answers: w.answers,
            state: w.state,
            seen,
            _sent: w.sent,
        }
    }

    impl Renewing {
        /// Have the lobby answer the next `TURNCREDENTIALS` with a credential
        /// good for `ttl_seconds` from `at`.
        fn lobby_mints(&self, ttl_seconds: u64, at: u64) {
            let state = self.state.clone();
            let answers = self.answers.clone();
            tokio::spawn(async move {
                let _ = answers.send(TurnAnswer::Granted(minted(&state, ttl_seconds, at)));
            });
        }

        /// Whether the frontend was sent a delta of this kind, within
        /// `patience`. Polled, because the thing that raises it is a task.
        async fn told_the_frontend(&self, kind: &str, patience: Duration) -> bool {
            let looking_for = format!("\"kind\":\"{kind}\"");
            let deadline = tokio::time::Instant::now() + patience;
            while tokio::time::Instant::now() < deadline {
                if lock_or_recover(&self.seen)
                    .iter()
                    .any(|told| told.contains(&looking_for))
                {
                    return true;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            false
        }
    }

    /// The schedule, at the two points that decide anything: half of whatever is
    /// left, and nothing at all once there is less left than the rebuild the
    /// credential would have to sign.
    #[test]
    fn a_credential_is_renewed_at_half_of_whatever_it_has_left() {
        let headroom = crate::turn::REBUILD_HEADROOM;

        // The shortest credential coilbox will host on at all.
        assert_eq!(
            renew_in(NOW + 5_115_000, NOW),
            Some(Duration::from_millis(2_557_500))
        );
        // Halved again, which is what a lobby that would not answer the first
        // ask gets.
        assert_eq!(
            renew_in(NOW + 2_557_500, NOW),
            Some(Duration::from_millis(1_278_750))
        );

        // One second the right side of the line is still worth an ask.
        assert_eq!(
            renew_in(NOW + headroom.as_millis() as u64 + 1_000, NOW),
            Some(Duration::from_millis(16_500))
        );
        // On it and past it there is nothing left to protect: a credential with
        // less than the rebuild backoff on it cannot survive the rebuild.
        assert_eq!(renew_in(NOW + headroom.as_millis() as u64, NOW), None);
        assert_eq!(renew_in(NOW, NOW), None);
        assert_eq!(renew_in(NOW - 60_000, NOW), None);
    }

    /// Halving cannot run forever, and this is how many asks a lobby gets before
    /// the host is told instead. Seven, on the shortest credential coilbox will
    /// host on, spread over the whole of its life.
    #[test]
    fn halving_gives_a_lobby_a_bounded_run_of_tries() {
        let mut left = Duration::from_secs(5_115);
        let mut asks = 0;
        while let Some(wait) = renew_in(NOW + left.as_millis() as u64, NOW) {
            left -= wait;
            asks += 1;
            assert!(asks < 100, "the schedule has to run out, and it did not");
        }
        assert_eq!(asks, 8);
    }

    /// Issue #2092's warning. A battle whose credential has run out is told
    /// once, because the second telling says nothing the first did not: the
    /// battle has been on borrowed time since then.
    #[test]
    fn a_battle_out_of_credential_tells_the_host_once() {
        let relay = relay_slot(silent_agent());

        assert!(credential_is_dead(&relay));
        assert!(!credential_is_dead(&relay));
    }

    /// The battle ended before the credential did. Nobody is in it, so there is
    /// nothing to warn anybody about.
    #[test]
    fn a_battle_that_is_over_is_not_warned_about_its_credential() {
        let relay = relay_slot(silent_agent());
        *lock_or_recover(&relay) = None;

        assert!(!credential_is_dead(&relay));
    }

    /// The ask, which is the whole renewal in one turn: the lobby mints
    /// something better than the sidecar is holding, and the sidecar is handed
    /// it down the control channel.
    #[tokio::test]
    async fn a_fresh_credential_reaches_the_sidecar() {
        let w = hosting_and_renewing();
        w.lobby_mints(86_400, NOW);

        let renewed = renew_now(&w.registry, KEY, &w.agent, NOW + 60_000, PATIENCE).await;

        assert_eq!(renewed, Renewed::Until(NOW + 86_400_000));
        let sent = w.written.sent();
        assert!(
            sent.contains("\"type\":\"renewCredential\"")
                && sent.contains("\"user\":\"1786086400:alice\"")
                && sent.contains("\"password\":\"bWFj=\""),
            "the sidecar has to be handed the credential itself: {sent}"
        );
    }

    /// A lobby free to mint whatever it likes can mint something worse than the
    /// sidecar already has. Taking it would shorten the battle, so nothing goes
    /// down the channel at all.
    #[tokio::test]
    async fn a_renewal_that_expires_sooner_than_the_held_one_is_not_taken() {
        let w = hosting_and_renewing();
        w.lobby_mints(60, NOW);

        let renewed = renew_now(&w.registry, KEY, &w.agent, NOW + 3_600_000, PATIENCE).await;

        assert_eq!(renewed, Renewed::NotYet);
        assert!(
            !w.written.sent().contains("renewCredential"),
            "a shorter credential must not replace a longer one: {}",
            w.written.sent()
        );
    }

    /// The sidecar has gone. There is nobody left to renew for, so the loop has
    /// to stand down rather than ask the lobby every half life for the rest of
    /// the session.
    #[tokio::test]
    async fn a_sidecar_that_has_gone_ends_the_renewing() {
        let w = hosting_and_renewing();
        w.written.breaks();
        w.lobby_mints(86_400, NOW);

        assert_eq!(
            renew_now(&w.registry, KEY, &w.agent, NOW, PATIENCE).await,
            Renewed::NobodyThere
        );
    }

    /// The loop itself, on the case it exists for: a battle whose credential has
    /// already run out. There is nothing left to renew, so the host is told and
    /// the loop ends rather than sitting there asking.
    ///
    /// No clock anywhere in it. The credential is expired before the loop starts,
    /// so `renew_in` answers `None` on the first look and nothing is ever slept.
    #[tokio::test]
    async fn a_battle_whose_credential_ran_out_tells_the_host_and_stops() {
        let w = hosting_and_renewing();
        credential_now_expires_at(&w.registry, KEY, NOW);

        renewing(&w.registry, KEY, PATIENCE);

        assert!(
            w.told_the_frontend("relayCredentialExpired", PATIENCE)
                .await,
            "a host on a dead credential has to be told, because hosting again is \
             the only thing that mends it"
        );
        assert!(
            !w.written.sent().contains("renewCredential"),
            "there is nothing left worth renewing: {}",
            w.written.sent()
        );
    }

    /// Issue #2105's half. Quitting is the last moment coilbox can put anything
    /// in the sidecar's hands, so it asks once more whatever the schedule says,
    /// and the sidecar goes into the unattended part of the game on a whole
    /// credential rather than on whatever half life it happened to be at.
    #[tokio::test]
    async fn quitting_hands_the_sidecar_one_last_credential() {
        let w = hosting_and_renewing();
        // Nothing due for the better part of an hour, so a schedule is not what
        // makes this happen.
        credential_now_expires_at(&w.registry, KEY, NOW + 5_115_000);
        w.lobby_mints(86_400, NOW);

        renew_before_quitting(&w.registry, PATIENCE).await;

        let sent = w.written.sent();
        assert!(
            sent.contains("\"type\":\"renewCredential\"")
                && sent.contains("\"user\":\"1786086400:alice\"")
                && sent.contains("\"password\":\"bWFj=\""),
            "the sidecar has to carry a fresh credential out of the quit: {sent}"
        );
    }

    /// The lobby is free to mint something worse than the sidecar already has,
    /// and quitting is not a reason to take it. Shortening the credential on the
    /// way out is the one way this could make #2105 worse rather than better.
    #[tokio::test]
    async fn quitting_does_not_take_a_shorter_credential_than_the_one_held() {
        let w = hosting_and_renewing();
        credential_now_expires_at(&w.registry, KEY, NOW + 5_115_000);
        w.lobby_mints(60, NOW);

        renew_before_quitting(&w.registry, PATIENCE).await;

        assert!(
            !w.written.sent().contains("renewCredential"),
            "a shorter credential must not replace a longer one: {}",
            w.written.sent()
        );
    }

    /// What quitting looks for, which is what keeps an ordinary quit free: a
    /// connection is only worth asking about while it is actually relaying a
    /// battle, and it stops being one the moment the host leaves.
    #[test]
    fn only_a_connection_that_is_relaying_is_worth_asking_about() {
        let w = hosting_and_renewing();
        assert_eq!(relaying_on(&w.registry), vec![KEY.to_string()]);

        let relay = lock_or_recover(&w.registry)
            .get(KEY)
            .map(|conn| Arc::clone(&conn.relay))
            .expect("the connection is registered");
        *lock_or_recover(&relay) = None;

        assert!(relaying_on(&w.registry).is_empty());
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
