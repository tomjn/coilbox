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
//! ## What is not here yet
//!
//! - Permissions, so joiners the host has not written to first get through,
//!   and the control channel coilbox tells the agent about them over (issue
//!   #2015). For now the engine port, the seat count and the TURN credentials
//!   are arguments, the relay address is printed on stdout each time one is
//!   opened, and a lost allocation goes to stderr with an exit code to match.
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
mod demux;
mod relay;

use std::net::{Ipv4Addr, SocketAddr};
use std::process::ExitCode;
use std::time::Duration;

use allocation::{AllocationFailure, TurnAllocation, TurnCredentials};
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
/// answer by starting the agent again with the same credential. Until there is
/// a control channel to say it properly (issue #2015), the exit code is how
/// coilbox can tell.
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

    let mut backoff = FIRST_BACKOFF;
    loop {
        let relay = match Transport::open(&args).await {
            Ok(relay) => relay,
            Err(failure) if failure.is_credential_failure() => {
                eprintln!("coilbox-relay-agent: the TURN credential was refused: {failure}");
                return ExitCode::from(EXIT_CREDENTIAL_REFUSED);
            }
            Err(failure) => {
                eprintln!("coilbox-relay-agent: no relay: {failure}");
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(LONGEST_BACKOFF);
                continue;
            }
        };
        match relay.public_addr() {
            // The line the caller reads. With `--relay-bind` left at port 0
            // this is the only way to learn where players should send, and a
            // rebuilt relay says it again because the address will have moved.
            Ok(addr) => println!("{addr}"),
            Err(e) => {
                eprintln!("coilbox-relay-agent: {e}");
                return ExitCode::FAILURE;
            }
        }

        let opened_at = Instant::now();
        let stopped = agent.run(&relay).await;
        match relay.failure() {
            Some(failure) => {
                eprintln!("coilbox-relay-agent: allocation lost: {failure}");
                if failure.is_credential_failure() {
                    relay.close().await;
                    return ExitCode::from(EXIT_CREDENTIAL_REFUSED);
                }
            }
            None => match stopped {
                Ok(()) => eprintln!("coilbox-relay-agent: relay stopped"),
                Err(e) => eprintln!("coilbox-relay-agent: relay stopped: {e}"),
            },
        }
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
