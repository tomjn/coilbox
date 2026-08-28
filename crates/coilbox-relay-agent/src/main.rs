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
//! everything after that goes over the control channel: one JSON object per
//! line, requests in on stdin and events out on stdout, defined in
//! `coilbox_relay_protocol` and carried by [`control`]. stderr stays sentences
//! for a human.
//!
//! Today that channel carries one request, "let this address through the
//! relay", which is the thing a relayed battle cannot work without and the
//! reason the channel exists (issue #2015). [`allowlist`] is what does it.
//!
//! ## What is not here yet
//!
//! - Fetching the credentials from the lobby (issue #2016).
//! - When the agent decides to stop (issue #2027). Until then it keeps
//!   rebuilding the relay, because the engine it is feeding is still running.
//!
//! Usage:
//!
//! ```text
//! coilbox-relay-agent --engine-port <port> --max-peers <n> [--relay-bind <addr>]
//!                     [--turn-server <host:port> --turn-user <name>]
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

use std::convert::Infallible;
use std::net::{Ipv4Addr, SocketAddr};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use allocation::{AllocationFailure, TurnAllocation, TurnCredentials};
use allowlist::Allowlist;
use coilbox_relay_protocol::{Event, Request};
use control::{Reporter, Requests};
use demux::Agent;
use relay::RelayLink;
use tokio::net::UdpSocket;
use tokio::time::Instant;

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
/// than reading its stdout. Which of the two coilbox acts on is issue #2027's
/// to settle, since that is the issue that owns when the agent stops at all.
const EXIT_CREDENTIAL_REFUSED: u8 = 2;

/// How long to wait before rebuilding a relay that failed, doubling each time
/// up to [`LONGEST_BACKOFF`].
///
/// The same schedule the TURN client uses for its own retransmits, 500 ms
/// doubling until it gives up around 63 s (`turn::client`, the table above
/// `ClientConfig`), and for the same reason: a server that is briefly
/// unreachable comes back quickly, and one that is not should not be hammered.
const FIRST_BACKOFF: Duration = Duration::from_millis(500);
const LONGEST_BACKOFF: Duration = Duration::from_secs(32);

fn parse_args() -> Result<Args, String> {
    let mut engine_port = None;
    let mut max_peers = None;
    let mut relay_bind = SocketAddr::from(([0, 0, 0, 0], 0));
    let mut turn_server = None;
    let mut turn_user = None;

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
    })
}

/// Whatever the relay is running over this time round.
enum Transport {
    /// A plain UDP socket, for a relay that can already reach the host.
    Direct(UdpSocket),
    /// A TURN allocation, for a host nothing can reach.
    Relayed(TurnAllocation),
}

impl Transport {
    async fn open(args: &Args) -> Result<Transport, AllocationFailure> {
        match &args.turn {
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

    async fn close(&self) {
        match self {
            Transport::Direct(_) => {}
            Transport::Relayed(allocation) => allocation.close().await,
        }
    }
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
async fn serve(
    relay: &Transport,
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
                // Remembered before the send, and kept whether or not it works.
                // coilbox has vouched for this address, and a probe that failed
                // says something about the relay rather than about the player.
                allowlist.remember(ip);
                let done = allowlist::let_through(relay, ip).await;
                control::answer(reporter, id, done).await;
            }
        }
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
    let reporter = Arc::new(Reporter::new());
    let mut requests = Requests::listen(Arc::clone(&reporter));

    let mut backoff = FIRST_BACKOFF;
    loop {
        let relay = match Transport::open(&args).await {
            Ok(relay) => relay,
            Err(failure) if failure.is_credential_failure() => {
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
        match relay.public_addr() {
            // Where players send. With `--relay-bind` left at port 0 this is
            // the only way to learn it, and a rebuilt relay says it again
            // because the address will have moved (issue #2031).
            Ok(addr) => reporter.say(Event::RelayOpen { addr }).await,
            Err(e) => {
                eprintln!("coilbox-relay-agent: {e}");
                reporter.say(Event::Stopping { reason: e }).await;
                return ExitCode::FAILURE;
            }
        }
        // Before a single datagram is forwarded, because this is a brand new
        // allocation with an empty permission table and the players it is for
        // are already mid-game.
        allowlist::let_everybody_through(&relay, &allowlist).await;

        let opened_at = Instant::now();
        let stopped = tokio::select! {
            stopped = agent.run(&relay) => stopped,
            // Never finishes, so the relay is always what ends this. Serving
            // requests here rather than in a task of its own is what lets a
            // request act on the relay that is open right now, and what makes a
            // request that arrives during a rebuild wait for the next one
            // instead of being answered with a lie.
            impossible = serve(&relay, &allowlist, &mut requests, &reporter) => match impossible {},
        };
        let down = match relay.failure() {
            Some(failure) => {
                eprintln!("coilbox-relay-agent: allocation lost: {failure}");
                if failure.is_credential_failure() {
                    reporter
                        .say(Event::Stopping {
                            reason: format!("the TURN credential was refused: {failure}"),
                        })
                        .await;
                    relay.close().await;
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
        relay.close().await;
        // A relay that stayed up longer than the agent would ever wait to
        // rebuild one was working, so its failure starts the backoff over
        // rather than inheriting the last one's. Without this, a relay that
        // opens and dies straight away every time would be rebuilt twice a
        // second for the rest of the game.
        if opened_at.elapsed() > LONGEST_BACKOFF {
            backoff = FIRST_BACKOFF;
        }
        // Keep going. The engine this is feeding is still running, so giving up
        // here would strand it. Issue #2027 is what decides when to stop.
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(LONGEST_BACKOFF);
    }
}
