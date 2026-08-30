//! `coilbox-relay-agent`, the host side of a relayed battle, as a process of its
//! own.
//!
//! A relayed battle arrives at the host down one connection, but the engine
//! tells its players apart by the UDP endpoint their traffic came from. This
//! binary is what stops those two facts contradicting each other: it gives every
//! peer its own loopback socket into the engine, so N relayed players look like
//! N ordinary clients. [`demux`] is where that happens, and it carries the
//! reasoning.
//!
//! ## Why it is not part of coilbox
//!
//! The engine already outlives the app. `tauri-plugin-coilbox-play` spawns it
//! with a plain `std::process::Command` and only ever kills it from
//! `play_cancel`, which is a button somebody presses. Nothing in `src-tauri/`
//! reaps it on shutdown, and `std::process::Child` does not kill on drop.
//!
//! A relay that lived inside coilbox would therefore fail in the worst way
//! available: close the window mid-game and the host plays on while every other
//! player times out, with nothing on anyone's screen to say why. So the relay is
//! a sidecar, in the shape of the unitsync worker, pr-downloader and mapconv
//! binaries this repo already ships.
//!
//! ## Which transport it runs over
//!
//! With `--turn-server` it allocates a relay on a TURN server and runs over
//! that, which is the case a player behind CGNAT needs: their battle advertises
//! an address on the server's machine, which anybody can reach.
//! [`allocation`] carries that side.
//!
//! Without it, the relay is a plain UDP socket bound at `--relay-bind`. That is
//! a working transport for a relay that can already reach the host, and it is
//! what the demux tests drive.
//!
//! ## How coilbox talks to it
//!
//! The engine port, the seat count and the TURN credentials are arguments,
//! because they are settled before the process starts and never change.
//! Everything after that goes over the control channel: one JSON object per
//! line, requests in on stdin and events out on stdout, defined in
//! `coilbox_relay_protocol` and carried by [`control`]. stderr stays sentences
//! for a human.
//!
//! The credentials are the exception to "settled before the process starts".
//! They arrive as arguments and can be replaced later, because a game can
//! outlive the lifetime the lobby minted them with and a rebuild signed with a
//! dead one ends the battle (issue #2092). [`HeldCredential`] is where they
//! live once the process is up.
//!
//! The main thing that channel carries is "let this address through the relay",
//! which is what a relayed battle cannot work without and the reason the
//! channel exists (issue #2015). [`allowlist`] is what does it.
//!
//! ## When it stops
//!
//! [`stopping`] owns that, and carries the reasoning. The short version is
//! that while coilbox is there coilbox decides, and once coilbox has gone the
//! agent watches the engine and its own traffic and decides for itself.
//!
//! [`run_file`] is the other half of the same problem: an agent that is
//! running has to be findable, or a coilbox that reopens mid-game starts a
//! second one over the top of it. It also carries the note such a coilbox
//! leaves when it wants this agent to stop, which is the only thing it can say
//! to a process whose pipes belong to a coilbox that has gone.
//!
//! ## Giving the allocation back
//!
//! An allocation costs the relay server a port and its bandwidth for as long as
//! it exists, so this process hands one back on its way out however it is
//! leaving: told to stop, judged for itself that nobody is left, or given up on
//! a credential it cannot replace. [`HandBack`] is that call and
//! [`until_nobody_needs_it`] is where the ordinary end of a battle reaches it.
//!
//! It is best effort and cannot be anything else. A process killed outright
//! runs none of this, and the server's own idle timeout is the real backstop.
//! That is a reason to keep the polite version rather than to skip it: the
//! polite one costs a single datagram and frees the port now, where the timeout
//! frees it minutes later.
//!
//! ## What is not here yet
//!
//! - Fetching the credentials from the lobby (issue #2016).
//!
//! Usage:
//!
//! ```text
//! coilbox-relay-agent --engine-port <port> --max-peers <n> [--relay-bind <addr>]
//!                     [--turn-server <host:port> --turn-user <name>]
//!                     [--run-file <path>]
//! ```
//!
//! The TURN password is read from `COILBOX_TURN_PASSWORD` rather than taken as
//! an argument, because everything on this machine can read another process's
//! command line and a relay credential is worth stealing.

mod allocation;
mod allowlist;
mod control;
mod demux;
mod relay;
mod run_file;
mod stopping;
mod traffic;

use std::convert::Infallible;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use allocation::{AllocationFailure, TurnAllocation, TurnCredentials};
use allowlist::Allowlist;
use coilbox_relay_protocol::{Event, Request};
use control::{Reporter, Requests};
use demux::Agent;
use relay::RelayLink;
use run_file::Claim;
use stopping::{Counted, Reason, Stopping};
use tokio::net::UdpSocket;
use tokio::time::Instant;
use traffic::Traffic;

/// What the agent was asked to do.
struct Args {
    /// The engine's host port on this machine, which every peer socket is
    /// connected to.
    engine_port: u16,
    /// The battle's seat count, which is the ceiling on how many loopback
    /// sockets the agent will ever bind.
    max_peers: usize,
    /// Where to listen for relayed traffic. `0.0.0.0:0` unless asked otherwise,
    /// because the port is the relay's to choose and the agent reports it back.
    ///
    /// With `turn` set this is only where the agent talks to the TURN server
    /// from. The address players use is the one the server hands back.
    relay_bind: SocketAddr,
    /// The TURN server to allocate on, if the battle is going through one.
    turn: Option<TurnCredentials>,
    /// Where to record that this agent is running, so a coilbox that reopens
    /// mid-game finds it instead of starting a second one. See [`run_file`].
    ///
    /// Optional because the agent is perfectly usable without it, which is how
    /// the tests drive it. coilbox always passes one.
    run_file: Option<PathBuf>,
}

/// The environment variable the TURN password arrives in.
///
/// Not an argument, because `ps` shows one process's arguments to every other
/// process on the machine and a relay credential is worth stealing.
const PASSWORD_VAR: &str = "COILBOX_TURN_PASSWORD";

/// Exit code for a credential the TURN server will not accept.
///
/// Distinct from a plain failure because it is the one the caller must not
/// answer by starting the agent again with the same credential. The control
/// channel says it properly now, as a [`Event::Stopping`] carrying the reason,
/// and this stays alongside it for a caller that is watching the process rather
/// than reading its stdout.
const EXIT_CREDENTIAL_REFUSED: u8 = 2;

/// Exit code for an agent that found another one already relaying.
///
/// Its own code for the same reason as the one above: it is the one failure a
/// caller must not answer by trying again, because trying again would be
/// starting a second agent over a battle the first one is still carrying. See
/// [`run_file`].
const EXIT_ALREADY_RUNNING: u8 = 3;

/// How long to wait before rebuilding a relay that failed, doubling each time
/// up to [`LONGEST_BACKOFF`].
///
/// The same schedule the TURN client uses for its own retransmits, 500 ms
/// doubling until it gives up around 63 s (`turn::client`, the table above
/// `ClientConfig`), and for the same reason: a server that is briefly
/// unreachable comes back quickly, and one that is not should not be hammered.
const FIRST_BACKOFF: Duration = Duration::from_millis(500);
const LONGEST_BACKOFF: Duration = Duration::from_secs(32);

/// How long the agent will spend giving an allocation back before leaving
/// anyway.
///
/// The same budget `tauri-plugin-coilbox-direct` gives a router to be told its
/// port mapping is free (`EXIT_RELEASE_BUDGET`), and the job here is strictly
/// smaller: one Refresh with a lifetime of zero, sent and not waited on, so
/// nothing in the call is a network round trip. What this guards against is not
/// a slow server but a lock the `turn` client never lets go of, and an agent
/// that hangs on the way out is worse than an allocation left to the server's
/// own timeout.
const RELEASE_BUDGET: Duration = Duration::from_millis(500);

fn parse_args() -> Result<Args, String> {
    let mut engine_port = None;
    let mut max_peers = None;
    let mut relay_bind = SocketAddr::from(([0, 0, 0, 0], 0));
    let mut turn_server = None;
    let mut turn_user = None;
    let mut run_file = None;

    let mut argv = std::env::args().skip(1);
    while let Some(flag) = argv.next() {
        let mut value = || argv.next().ok_or(format!("{flag} needs a value"));
        match flag.as_str() {
            "--turn-server" => turn_server = Some(value()?),
            "--turn-user" => turn_user = Some(value()?),
            "--engine-port" => {
                engine_port = Some(
                    value()?
                        .parse::<u16>()
                        .map_err(|e| format!("--engine-port: {e}"))?,
                )
            }
            "--max-peers" => {
                max_peers = Some(
                    value()?
                        .parse::<usize>()
                        .map_err(|e| format!("--max-peers: {e}"))?,
                )
            }
            "--relay-bind" => {
                relay_bind = value()?.parse().map_err(|e| format!("--relay-bind: {e}"))?
            }
            "--run-file" => run_file = Some(PathBuf::from(value()?)),
            other => return Err(format!("unknown argument {other}")),
        }
    }

    let engine_port = engine_port.ok_or("--engine-port is required")?;
    let max_peers = max_peers.ok_or("--max-peers is required")?;
    if engine_port == 0 {
        return Err("--engine-port has to be the port the engine is listening on".to_string());
    }
    if max_peers == 0 {
        return Err("--max-peers of 0 would refuse every player".to_string());
    }

    // All three or none of them: a server with nobody to be is as useless as a
    // credential with nowhere to send it, and failing here beats failing after
    // the battle has been advertised.
    let turn = match (turn_server, turn_user, std::env::var(PASSWORD_VAR).ok()) {
        (Some(server), Some(username), Some(password)) => Some(TurnCredentials {
            server,
            username,
            password,
        }),
        (None, None, _) => None,
        _ => {
            return Err(format!(
                "--turn-server, --turn-user and {PASSWORD_VAR} go together"
            ))
        }
    };

    Ok(Args {
        engine_port,
        max_peers,
        relay_bind,
        turn,
        run_file,
    })
}

/// The credential the next relay will be opened with.
///
/// Shared and mutable rather than read straight off [`Args`], because a game can
/// outlive the credential that started it and the rebuild is where that costs
/// something (issue #2092). coilbox asks the lobby for another one while it is
/// still open and sends it down the control channel as
/// [`Request::RenewCredential`], [`control`] puts it in here, and the next turn
/// of the rebuild loop signs with whatever it finds.
///
/// The allocation that is already open is deliberately left alone. The TURN
/// server worked its key out when it created that session and checks every later
/// request against the key it kept, so a live allocation neither needs the new
/// credential nor notices the old one dying. `allocation.rs` carries the
/// measurement.
///
/// `None` is a relay that is not going through a TURN server at all, which is
/// what `--relay-bind` on its own gives and what the demux tests drive. Nothing
/// can renew a credential that was never there, so a renewal aimed at one of
/// those is refused rather than stored.
pub type HeldCredential = Arc<std::sync::Mutex<Option<TurnCredentials>>>;

/// The credential right now, taken out from under the lock.
fn held(turn: &HeldCredential) -> Option<TurnCredentials> {
    turn.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Whether the credential a relay was signed with is still the one this process
/// is holding.
///
/// This is what makes a refused credential final or not, and it is the whole
/// difference issue #2092 makes to that rule. 401 means the credential that
/// signed the request is no good, and there is no point trying the same one
/// again. It says nothing about a different one. So the agent gives up only when
/// there is no different one to try, and carries on into the rebuild when
/// coilbox has sent a replacement since.
///
/// Measured against a real coturn in
/// `tauri-plugin-coilbox-multiplayer/tests/relayed_battle.rs`, where without
/// this the renewal never got used: the allocation that was already open is
/// refreshed on the old credential, coturn answers that 401 once it has
/// forgotten the session, and the agent stopped there rather than rebuilding on
/// the credential it had just been handed.
fn still_held(turn: &HeldCredential, signed_with: &Option<TurnCredentials>) -> bool {
    *turn.lock().unwrap_or_else(|e| e.into_inner()) == *signed_with
}

/// Whatever the relay is running over this time round.
enum Transport {
    /// A plain UDP socket, for a relay that can already reach the host.
    Direct(UdpSocket),
    /// A TURN allocation, for a host nothing can reach.
    Relayed(TurnAllocation),
}

impl Transport {
    /// Open a relay signed with `credentials`.
    ///
    /// Handed in rather than read out of [`HeldCredential`] here, because the
    /// caller has to keep hold of which credential this relay was signed with:
    /// it is what a later refusal is judged against. See [`still_held`].
    async fn open(
        args: &Args,
        credentials: Option<TurnCredentials>,
    ) -> Result<Transport, AllocationFailure> {
        match &credentials {
            Some(credentials) => TurnAllocation::open(args.relay_bind, credentials)
                .await
                .map(Transport::Relayed),
            None => UdpSocket::bind(args.relay_bind)
                .await
                .map(Transport::Direct)
                .map_err(|e| {
                    AllocationFailure::Unreachable(format!(
                        "could not bind {}: {e}",
                        args.relay_bind
                    ))
                }),
        }
    }

    /// The address players send to.
    fn public_addr(&self) -> Result<SocketAddr, String> {
        match self {
            Transport::Direct(socket) => socket
                .local_addr()
                .map_err(|e| format!("bound socket has no address: {e}")),
            Transport::Relayed(allocation) => Ok(allocation.relayed_addr()),
        }
    }

    /// Why the relay stopped, when the transport knows better than the error
    /// the demux surfaced.
    fn failure(&self) -> Option<AllocationFailure> {
        match self {
            Transport::Direct(_) => None,
            Transport::Relayed(allocation) => allocation.failure(),
        }
    }
}

/// A relay that can be given back to whoever is holding it open for us.
///
/// A trait rather than a plain call on [`Transport`] because what is worth
/// testing is not the call, it is whether the exit path makes it. The case that
/// costs a game is the one where it must not be made, and a fake that records
/// being handed back is the only way to assert the absence of something.
trait HandBack {
    /// Give it back, and do not wait to be thanked.
    async fn hand_back(&self);
}

impl HandBack for Transport {
    async fn hand_back(&self) {
        match self {
            // A socket this process bound. The OS takes it when the process
            // goes and there is nobody else holding anything for us.
            Transport::Direct(_) => {}
            // A port and a share of the bandwidth on somebody else's machine,
            // held until it is given back or until the server times it out.
            // `TurnAllocation::close` is a Refresh with a lifetime of zero,
            // which is the protocol's own way of saying "I am finished with
            // this".
            Transport::Relayed(allocation) => allocation.close().await,
        }
    }
}

/// The relay that is open right now, if there is one.
///
/// A slot rather than a local because two places have to reach it. The loop
/// below rebuilds relays and knows when one has been replaced, and the exit path
/// runs at a moment when that loop has been cancelled out from under it and its
/// local is unreachable. Without this, every allocation the agent ever held
/// would be left to the server's timeout, because the value holding it was
/// dropped rather than closed.
type OpenRelay<R> = Arc<tokio::sync::Mutex<Option<Arc<R>>>>;

/// Give back whatever relay is open, and forget it.
///
/// Safe to call when there is not one, which is most of the ways out of the
/// loop below: an agent that never got an allocation has nothing to hand back
/// and says nothing about it.
async fn hand_back<R: HandBack>(open: &OpenRelay<R>) {
    let Some(relay) = open.lock().await.take() else {
        return;
    };
    if tokio::time::timeout(RELEASE_BUDGET, relay.hand_back())
        .await
        .is_err()
    {
        eprintln!(
            "coilbox-relay-agent: the relay was not given back within {} ms, so it is left to the \
             server's own timeout",
            RELEASE_BUDGET.as_millis()
        );
    }
}

/// Wait until nobody needs this agent, say so, and give the relay back.
///
/// The ordinary end of a relayed battle, and the whole of issue #2018's coilbox
/// facing half. [`Stopping`] owns the decision and carries the reasoning for it.
/// Everything here happens after that decision has been made.
///
/// The one thing to keep in mind while reading it is what it does not do.
/// coilbox closing does not reach this, because coilbox closing is not the end
/// of a game: [`Stopping::wait`] goes on waiting while the engine is alive and
/// the relay is carrying traffic, so a host who quits the app mid-match hands
/// nothing back and their game plays on.
async fn until_nobody_needs_it<R: HandBack>(
    stopping: &Stopping,
    open: &OpenRelay<R>,
    reporter: &Reporter,
) -> Reason {
    let reason = stopping.wait().await;
    eprintln!("coilbox-relay-agent: stopping, because {reason}");
    // Said before the allocation goes, so a coilbox that is still there learns
    // the battle has lost its relay from the agent rather than from a pipe that
    // went quiet.
    reporter
        .say(Event::Stopping {
            reason: reason.to_string(),
        })
        .await;
    hand_back(open).await;
    reason
}

impl RelayLink for Transport {
    async fn recv_from(&self, buf: &mut [u8]) -> std::io::Result<(usize, SocketAddr)> {
        match self {
            Transport::Direct(socket) => RelayLink::recv_from(socket, buf).await,
            Transport::Relayed(allocation) => RelayLink::recv_from(allocation, buf).await,
        }
    }

    async fn send_to(&self, buf: &[u8], peer: SocketAddr) -> std::io::Result<usize> {
        match self {
            Transport::Direct(socket) => RelayLink::send_to(socket, buf, peer).await,
            Transport::Relayed(allocation) => RelayLink::send_to(allocation, buf, peer).await,
        }
    }
}

/// Carry out coilbox's requests against the relay that is open right now.
///
/// Never returns, which is what makes it safe to race against the forwarding
/// loop: the relay failing is the only thing that ends a round of the outer
/// loop, so a request is never half done because the control channel decided to
/// stop.
///
/// The queue is where a request waits when there is no relay, since this is not
/// running then. That is the right place for it to wait. Answering "no" while
/// the agent is a second away from rebuilding a relay would tell coilbox the
/// player cannot get in when they can, and answering "yes" would be a lie. The
/// wait is bounded by the rebuild backoff, and the coilbox end has its own
/// deadline so nothing waits on this forever.
async fn serve<R: RelayLink>(
    relay: &R,
    allowlist: &Allowlist,
    requests: &mut Requests,
    reporter: &Reporter,
) -> Infallible {
    loop {
        let Some(request) = requests.next().await else {
            // coilbox has closed. The engine has not, so this process carries
            // on relaying for the players already in the game and simply stops
            // being asked to do anything.
            std::future::pending::<()>().await;
            continue;
        };
        match request {
            Request::AllowPeer { id, ip } => {
                let done = allowlist::allow(relay, allowlist, ip).await;
                control::answer(reporter, id, done).await;
            }
            // None of these ever arrives here. `control` answers them in the
            // reading task, because none of them needs a relay and waiting for
            // one would mean a battle that is over holding its allocation
            // through a rebuild. Named rather than caught by a wildcard so
            // that a new request has to be placed on purpose.
            //
            // A renewal is the sharpest case of the four: waiting for a relay
            // would hold it until after the rebuild it exists to sign.
            Request::WatchEngine { .. }
            | Request::Stop { .. }
            | Request::BattleOver { .. }
            | Request::RenewCredential { .. } => {}
        }
    }
}

/// Everything one relay does, from the moment it opens to the moment it fails.
///
/// A function rather than the body of the loop so a test can drive it with a
/// relay of its own. What is worth testing here is the first line: a relay is
/// brand new, so it has no permissions on it, and everybody coilbox has already
/// vouched for has to be let through again before a single datagram moves.
/// Forget that and a rebuild that was meant to save a game in progress cuts off
/// every player in it instead.
async fn carry<R: RelayLink>(
    relay: &R,
    agent: &mut Agent,
    allowlist: &Allowlist,
    requests: &mut Requests,
    reporter: &Reporter,
) -> std::io::Result<()> {
    allowlist::let_everybody_through(relay, allowlist).await;
    tokio::select! {
        stopped = agent.run(relay) => stopped,
        // Never finishes, so the relay is always what ends this. Serving
        // requests here rather than in a task of its own is what lets a request
        // act on the relay that is open right now, and what makes a request
        // that arrives during a rebuild wait for the next one instead of being
        // answered with a lie.
        impossible = serve(relay, allowlist, requests, reporter) => match impossible {},
    }
}

/// Open a relay, carry a game over it, rebuild it when it fails, forever.
///
/// Only ever ends by giving up, which is what the returned code says. The
/// ordinary end of a battle is [`Stopping`] cancelling this from the outside,
/// and cancelling it is safe: everything it holds is a socket or a table, and
/// the process is on its way out.
///
/// The relay it has open lives in `open` rather than in a local, because the
/// cancellation above is exactly the moment somebody else needs to reach it. See
/// [`OpenRelay`].
async fn relay_until_it_gives_up(
    args: &Args,
    turn: &HeldCredential,
    stopping: &Stopping,
    traffic: &Traffic,
    open: &OpenRelay<Transport>,
    requests: &mut Requests,
    reporter: &Reporter,
) -> ExitCode {
    let engine = SocketAddr::from((Ipv4Addr::LOCALHOST, args.engine_port));
    // Outside the loop, and that is the whole point of it being here. Every
    // player keeps the loopback socket it was given across as many relays as
    // this process gets through, because the engine reads a changed source port
    // as a different player and will not have one mid-game.
    let mut agent = Agent::new(engine, args.max_peers);

    // Outside the loop for the same reason as the peer table. A permission
    // belongs to one allocation, so everybody coilbox has vouched for has to be
    // let through again every time a relay is rebuilt, and this is the only
    // record of who that is.
    let allowlist = Allowlist::new();

    let mut backoff = FIRST_BACKOFF;
    loop {
        // Read once here rather than inside `Transport::open`, because a refusal
        // has to be judged against the credential that was refused rather than
        // against whatever coilbox has sent since.
        let signed_with = held(turn);
        let relay = match Transport::open(args, signed_with.clone()).await {
            Ok(relay) => relay,
            Err(failure) if failure.is_credential_failure() && still_held(turn, &signed_with) => {
                eprintln!("coilbox-relay-agent: the TURN credential was refused: {failure}");
                reporter
                    .say(Event::Stopping {
                        reason: format!("the TURN credential was refused: {failure}"),
                    })
                    .await;
                return ExitCode::from(EXIT_CREDENTIAL_REFUSED);
            }
            Err(failure) => {
                eprintln!("coilbox-relay-agent: no relay: {failure}");
                reporter
                    .say(Event::RelayDown {
                        reason: failure.to_string(),
                    })
                    .await;
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(LONGEST_BACKOFF);
                continue;
            }
        };
        // Published before anything is advertised on it, so that whatever ends
        // this process from here on can give it back.
        let relay = Arc::new(relay);
        *open.lock().await = Some(Arc::clone(&relay));
        match relay.public_addr() {
            // Where players send. With `--relay-bind` left at port 0 this is
            // the only way to learn it, and a rebuilt relay says it again
            // because the address will have moved (issue #2031).
            Ok(addr) => reporter.say(Event::RelayOpen { addr }).await,
            Err(e) => {
                eprintln!("coilbox-relay-agent: {e}");
                reporter.say(Event::Stopping { reason: e }).await;
                hand_back(open).await;
                return ExitCode::FAILURE;
            }
        }
        let opened_at = Instant::now();
        // Counted, so that carrying a datagram is what keeps this process
        // alive once there is no coilbox left to say so, and so the host can
        // be shown how much is going through it.
        let counted = Counted {
            relay: relay.as_ref(),
            stopping,
            traffic,
        };
        let stopped = carry(&counted, &mut agent, &allowlist, requests, reporter).await;
        let down = match relay.failure() {
            Some(failure) => {
                eprintln!("coilbox-relay-agent: allocation lost: {failure}");
                if failure.is_credential_failure() && still_held(turn, &signed_with) {
                    reporter
                        .say(Event::Stopping {
                            reason: format!("the TURN credential was refused: {failure}"),
                        })
                        .await;
                    hand_back(open).await;
                    return ExitCode::from(EXIT_CREDENTIAL_REFUSED);
                }
                failure.to_string()
            }
            None => match stopped {
                Ok(()) => {
                    eprintln!("coilbox-relay-agent: relay stopped");
                    "the relay stopped".to_string()
                }
                Err(e) => {
                    eprintln!("coilbox-relay-agent: relay stopped: {e}");
                    format!("the relay stopped: {e}")
                }
            },
        };
        reporter.say(Event::RelayDown { reason: down }).await;
        // The relay that failed is finished with either way, and the next turn
        // of this loop opens another. Giving it back here rather than dropping
        // it means a server that is still listening stops holding a port for a
        // relay this agent has already replaced.
        hand_back(open).await;
        // A relay that stayed up longer than the agent would ever wait to
        // rebuild one was working, so its failure starts the backoff over
        // rather than inheriting the last one's. Without this, a relay that
        // opens and dies straight away every time would be rebuilt twice a
        // second for the rest of the game.
        if opened_at.elapsed() > LONGEST_BACKOFF {
            backoff = FIRST_BACKOFF;
        }
        // Keep going. Giving up here would strand a game that is still being
        // played, and this loop is not the thing that knows whether one is.
        // `stopping` is, and it cancels this from the outside.
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(LONGEST_BACKOFF);
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(args) => args,
        Err(reason) => {
            eprintln!("coilbox-relay-agent: {reason}");
            return ExitCode::FAILURE;
        }
    };

    let reporter = Arc::new(Reporter::new());
    let stopping = Arc::new(Stopping::new());

    // Before anything is opened, because the whole point of the claim is that
    // a second agent does not get as far as allocating a relay for a battle
    // the first one is already carrying.
    let _claim = match &args.run_file {
        None => None,
        Some(path) => match Claim::take(path.clone()) {
            Ok(claim) => Some(claim),
            Err(taken) => {
                eprintln!("coilbox-relay-agent: {taken}");
                reporter
                    .say(Event::Stopping {
                        reason: taken.to_string(),
                    })
                    .await;
                return ExitCode::from(EXIT_ALREADY_RUNNING);
            }
        },
    };

    // The only thing a coilbox that reopened after this agent started can say to
    // it, since it holds no pipe to this process (issue #2062). Started
    // alongside the claim because the two are the same channel: the run file is
    // how such a coilbox finds this agent, and the note is what it says.
    if let Some(path) = args.run_file.clone() {
        tokio::spawn({
            let stopping = Arc::clone(&stopping);
            async move {
                run_file::take_notes_asking_us_to_stop(&path, &stopping).await;
            }
        });
    }

    // The credential the arguments started this process with, in the place
    // coilbox can replace it (issue #2092).
    let turn: HeldCredential = Arc::new(std::sync::Mutex::new(args.turn.clone()));

    let mut requests = Requests::listen(
        Arc::clone(&reporter),
        Arc::clone(&stopping),
        Arc::clone(&turn),
    );
    let open: OpenRelay<Transport> = OpenRelay::default();

    // The meter the host's in-game pill reads (issue #2024). Started here
    // rather than inside the relay loop because a relay that is being rebuilt
    // is exactly when somebody wants to know what is going through: reports
    // carry on saying zero across the gap, and a reader that heard nothing at
    // all could not tell that from a sidecar that had died.
    //
    // It writes the same figure beside the run file as well as saying it, which
    // is the only way a coilbox that was closed and reopened can read it: this
    // process's stdout belongs to the coilbox that has gone (issue #2074).
    let traffic = Arc::new(Traffic::new());
    tokio::spawn({
        let traffic = Arc::clone(&traffic);
        let reporter = Arc::clone(&reporter);
        let run_file = args.run_file.clone();
        async move {
            traffic::report_forever(&traffic, &reporter, run_file.as_deref()).await;
        }
    });

    // The relay loop only ever ends by giving up. Everything else that ends
    // this process is a judgement about whether anybody still needs it, and
    // that is `stopping`'s.
    //
    // Losing this race is what frees the peer sockets: the loop future owns the
    // demux and its table of loopback sockets, and it is dropped when this
    // expression finishes. The allocation cannot go the same way, because
    // dropping it tells the relay server nothing, which is why it lives in
    // `open` and is given back by hand.
    tokio::select! {
        gave_up = relay_until_it_gives_up(&args, &turn, &stopping, &traffic, &open, &mut requests, &reporter) => gave_up,
        _ = until_nobody_needs_it(&stopping, &open, &reporter) => ExitCode::SUCCESS,
    }
}

#[cfg(test)]
mod tests {
    //! Three things, and they are the pieces of this file that are not obvious
    //! from reading it and that cost a game in progress if they slip. What
    //! [`carry`] does with a relay it has just been handed, whether the exit
    //! path gives an allocation back, and when a refused credential is the end
    //! of the battle.

    use super::*;
    use allowlist::Allowlist;
    use std::io;
    use std::net::{IpAddr, Ipv4Addr};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use stopping::IDLE_TIMEOUT;
    use tokio::io::{AsyncBufReadExt, BufReader};

    /// How long a test waits for a line before deciding it is never coming.
    const PATIENCE: Duration = Duration::from_secs(5);

    fn a_credential(password: &str) -> TurnCredentials {
        TurnCredentials {
            server: "relay.example.org:3478".to_string(),
            username: "1786086400:alice".to_string(),
            password: password.to_string(),
        }
    }

    /// The rule that decides whether a refused credential ends the battle, which
    /// is the whole of issue #2092 inside this process.
    ///
    /// The coturn test in `tauri-plugin-coilbox-multiplayer` measures it against
    /// a real server and is ignored, so this is the version CI runs. Getting it
    /// backwards costs a game either way: too eager and a battle ends on a
    /// credential that had already been replaced, too shy and it hangs on
    /// retrying one nothing will ever accept.
    #[test]
    fn a_refused_credential_is_final_only_while_it_is_the_one_we_still_hold() {
        let signed_with = Some(a_credential("the-one-that-was-refused"));
        let turn: HeldCredential = Arc::new(std::sync::Mutex::new(signed_with.clone()));

        assert!(
            still_held(&turn, &signed_with),
            "nothing has replaced it, so there is nothing else to sign with and the battle ends"
        );

        *turn.lock().unwrap() = Some(a_credential("the-one-coilbox-just-sent"));
        assert!(
            !still_held(&turn, &signed_with),
            "coilbox sent another one, so the refusal says nothing about the rebuild ahead"
        );
    }

    /// A relay that never went through a TURN server. It has no credential to
    /// be refused, and the comparison has to hold up rather than panic on the
    /// `None`.
    #[test]
    fn a_relay_with_no_credential_is_still_holding_the_nothing_it_started_with() {
        let turn: HeldCredential = Arc::new(std::sync::Mutex::new(None));
        assert!(still_held(&turn, &None));
    }

    /// A relay that writes down who it was asked to send to and otherwise sits
    /// there, which is what a healthy relay carrying no traffic looks like.
    #[derive(Default)]
    struct Recorded {
        sent: Mutex<Vec<IpAddr>>,
    }

    impl RelayLink for Recorded {
        async fn recv_from(&self, _buf: &mut [u8]) -> io::Result<(usize, SocketAddr)> {
            std::future::pending().await
        }

        async fn send_to(&self, buf: &[u8], peer: SocketAddr) -> io::Result<usize> {
            self.sent.lock().unwrap().push(peer.ip());
            Ok(buf.len())
        }
    }

    fn joiner(last: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(198, 51, 100, last))
    }

    /// The agent, wired to a pair of pipes a test can speak into and read back.
    struct Wired {
        agent: Agent,
        allowlist: Allowlist,
        requests: Requests,
        reporter: Arc<Reporter>,
        to_agent: tokio::io::DuplexStream,
        from_agent: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
    }

    impl Wired {
        fn new() -> Wired {
            // Big enough that nothing in a test blocks on a full pipe, and
            // nothing here writes more than a few short lines.
            let (to_agent, agent_stdin) = tokio::io::duplex(4096);
            let (agent_stdout, from_agent) = tokio::io::duplex(4096);
            let reporter = Arc::new(Reporter::writing(agent_stdout));
            Wired {
                // No engine is listening, and nothing in these tests sends game
                // traffic, so the forwarding half has nothing to do.
                agent: Agent::new(SocketAddr::from((Ipv4Addr::LOCALHOST, 1)), 4),
                allowlist: Allowlist::new(),
                requests: Requests::reading(
                    agent_stdin,
                    Arc::clone(&reporter),
                    Arc::new(Stopping::new()),
                    Arc::new(std::sync::Mutex::new(None)),
                ),
                reporter,
                to_agent,
                from_agent: BufReader::new(from_agent).lines(),
            }
        }
    }

    /// Free functions rather than methods, because [`carry`] holds the rest of
    /// the [`Wired`] fields borrowed for as long as a test is talking to it.
    async fn ask(to_agent: &mut tokio::io::DuplexStream, line: &str) {
        use tokio::io::AsyncWriteExt;
        to_agent
            .write_all(format!("{line}\n").as_bytes())
            .await
            .expect("the agent is still reading");
    }

    async fn hears(
        from_agent: &mut tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
    ) -> String {
        tokio::time::timeout(PATIENCE, from_agent.next_line())
            .await
            .expect("the agent said nothing at all")
            .expect("a readable pipe")
            .expect("the agent's output has not ended")
    }

    /// The one that costs a game: a relay is rebuilt, and every player already
    /// vouched for is let through it before anything else happens. A new TURN
    /// allocation has an empty permission table, so skipping this drops every
    /// player in the battle at the moment the reconnect was supposed to save
    /// them.
    #[tokio::test]
    async fn a_relay_lets_everybody_already_vouched_for_through_before_it_carries_anything() {
        let Wired {
            mut agent,
            allowlist,
            mut requests,
            reporter,
            ..
        } = Wired::new();
        allowlist.remember(joiner(4));
        allowlist.remember(joiner(5));
        let rebuilt = Recorded::default();

        // `carry` never returns on its own, so it is raced against the check.
        tokio::select! {
            _ = carry(&rebuilt, &mut agent, &allowlist, &mut requests, &reporter) => {
                panic!("carry returned, so the relay it was handed failed")
            }
            // One turn of the runtime is enough. The sends all happen before
            // `carry` awaits anything on the relay.
            () = tokio::task::yield_now() => {}
        }

        assert_eq!(
            *rebuilt.sent.lock().unwrap(),
            vec![joiner(4), joiner(5)],
            "a new relay starts with no permissions, so everybody has to be let through it again"
        );
    }

    /// The request path end to end inside one process: a line in, an address
    /// let through, an answer out.
    #[tokio::test]
    async fn a_request_over_the_channel_lets_the_address_through_and_is_answered() {
        let Wired {
            mut agent,
            allowlist,
            mut requests,
            reporter,
            mut to_agent,
            mut from_agent,
        } = Wired::new();
        let relay = Recorded::default();

        let answer = tokio::select! {
            _ = carry(&relay, &mut agent, &allowlist, &mut requests, &reporter) => {
                panic!("carry returned, so the relay it was handed failed")
            }
            answer = async {
                ask(&mut to_agent, "{\"type\":\"allowPeer\",\"id\":4,\"ip\":\"198.51.100.4\"}").await;
                hears(&mut from_agent).await
            } => answer,
        };

        assert_eq!(answer, "{\"type\":\"done\",\"id\":4}");
        assert_eq!(*relay.sent.lock().unwrap(), vec![joiner(4)]);
        assert_eq!(
            allowlist.everybody(),
            vec![joiner(4)],
            "a served address has to survive the next rebuild"
        );
    }

    /// A relay that writes down whether it was ever given back, which is the
    /// only way to assert that it was not.
    #[derive(Default)]
    struct Watched(AtomicBool);

    impl Watched {
        fn was_given_back(&self) -> bool {
            self.0.load(Ordering::Relaxed)
        }
    }

    impl HandBack for Watched {
        async fn hand_back(&self) {
            self.0.store(true, Ordering::Relaxed);
        }
    }

    /// An open relay, in the slot the exit path reads it out of.
    fn holding(relay: &Arc<Watched>) -> OpenRelay<Watched> {
        Arc::new(tokio::sync::Mutex::new(Some(Arc::clone(relay))))
    }

    /// A reporter whose events nobody reads, for the tests that are about the
    /// allocation rather than the channel.
    fn unheard() -> Reporter {
        Reporter::writing(tokio::io::sink())
    }

    /// The point of issue #2018. A battle that is over gives its allocation
    /// back, rather than leaving the relay server holding a port and its
    /// bandwidth until an idle timeout notices.
    #[tokio::test(start_paused = true)]
    async fn a_battle_that_is_over_gives_its_allocation_back() {
        let relay = Arc::new(Watched::default());
        let open = holding(&relay);
        let stopping = Stopping::new();
        stopping.coilbox_asked();

        until_nobody_needs_it(&stopping, &open, &unheard()).await;

        assert!(
            relay.was_given_back(),
            "a battle that ended left its allocation standing on the relay server"
        );
        assert!(
            open.lock().await.is_none(),
            "an allocation that has been given back is not still held"
        );
    }

    /// The requirement that is a negative, and the one this whole design exists
    /// to protect. Closing coilbox mid-game is not the end of the game: the
    /// engine is still running and every other player is still connected
    /// through this allocation, so nothing may be given back.
    ///
    /// Written as "the exit path never runs" rather than "the relay was not
    /// closed", because those are the same thing here and the first is what
    /// would actually be wrong.
    #[tokio::test(start_paused = true)]
    async fn closing_coilbox_during_a_game_gives_nothing_back() {
        let relay = Arc::new(Watched::default());
        let open = holding(&relay);
        let stopping = Stopping::new();
        // This test process stands in for the engine, so it is definitely
        // running.
        stopping.engine_is(std::process::id());
        // The window shutting, which is not a battle ending.
        stopping.coilbox_has_gone();
        let reporter = unheard();

        tokio::select! {
            reason = until_nobody_needs_it(&stopping, &open, &reporter) => {
                panic!("gave the allocation back mid-game, because {reason}")
            }
            () = async {
                // Three backstops' worth of a game still being played, so this
                // is not a matter of the test not having waited long enough.
                for _ in 0..6 {
                    tokio::time::sleep(IDLE_TIMEOUT / 2).await;
                    stopping.carried_something();
                }
            } => {}
        }

        assert!(
            !relay.was_given_back(),
            "the allocation carrying a live game was given back, so every player in it was cut off"
        );
    }

    /// An agent with no allocation is most of the ways out of the relay loop:
    /// it never opened one, or it has already given the last one back and is
    /// waiting to build another. Nothing to hand back, and nothing to say.
    #[tokio::test]
    async fn an_agent_with_no_relay_has_nothing_to_give_back() {
        let open: OpenRelay<Watched> = OpenRelay::default();
        hand_back(&open).await;
        assert!(open.lock().await.is_none());
    }

    /// A relay that will not let go inside the budget must not hold the process
    /// open, because an agent that hangs on the way out is worse than an
    /// allocation left to the server's timeout.
    #[tokio::test(start_paused = true)]
    async fn a_relay_that_will_not_let_go_does_not_hold_the_process_open() {
        struct Stuck;
        impl HandBack for Stuck {
            async fn hand_back(&self) {
                std::future::pending::<()>().await;
            }
        }

        let open = Arc::new(tokio::sync::Mutex::new(Some(Arc::new(Stuck))));
        let started = Instant::now();
        hand_back(&open).await;

        assert!(
            started.elapsed() <= RELEASE_BUDGET,
            "the release took {:?}, which is longer than the budget it was given",
            started.elapsed()
        );
    }
}
