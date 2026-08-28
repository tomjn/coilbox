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
//! Today that channel carries one request, "let this address through the
//! relay", which is the thing a relayed battle cannot work without and the
//! reason the channel exists (issue #2015). [`allowlist`] is what does it.
//!
//! ## When it stops
//!
//! [`stopping`] owns that, and carries the reasoning. The short version is
//! that while coilbox is there coilbox decides, and once coilbox has gone the
//! agent watches the engine and its own traffic and decides for itself.
//!
//! [`run_file`] is the other half of the same problem: an agent that is
//! running has to be findable, or a coilbox that reopens mid-game starts a
//! second one over the top of it.
//!
//! ## What is not here yet
//!
//! - Fetching the credentials from the lobby (issue #2016).
//! - Handing the allocation back on the way out (issue #2018). Today the
//!   process simply exits and the server expires it.
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
use stopping::{Counted, Stopping};
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
            // Neither of these ever arrives here. `control` answers them in
            // the reading task, because neither needs a relay and waiting for
            // one would mean a battle that is over holding its allocation
            // through a rebuild. Named rather than caught by a wildcard so
            // that a new request has to be placed on purpose.
            Request::WatchEngine { .. } | Request::Stop { .. } => {}
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
async fn relay_until_it_gives_up(
    args: &Args,
    stopping: &Stopping,
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
        let relay = match Transport::open(args).await {
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
        let opened_at = Instant::now();
        // Counted, so that carrying a datagram is what keeps this process
        // alive once there is no coilbox left to say so.
        let counted = Counted {
            relay: &relay,
            stopping,
        };
        let stopped = carry(&counted, &mut agent, &allowlist, requests, reporter).await;
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

    let mut requests = Requests::listen(Arc::clone(&reporter), Arc::clone(&stopping));

    // The relay loop only ever ends by giving up. Everything else that ends
    // this process is a judgement about whether anybody still needs it, and
    // that is `stopping`'s.
    tokio::select! {
        gave_up = relay_until_it_gives_up(&args, &stopping, &mut requests, &reporter) => gave_up,
        reason = stopping.wait() => {
            eprintln!("coilbox-relay-agent: stopping, because {reason}");
            // Said before the process goes, so a coilbox that is still there
            // learns the battle has lost its relay from the agent rather than
            // from a pipe that went quiet. Handing the allocation back is
            // issue #2018 and belongs here when it lands.
            reporter.say(Event::Stopping { reason: reason.to_string() }).await;
            ExitCode::SUCCESS
        }
    }
}

#[cfg(test)]
mod tests {
    //! What [`carry`] does with a relay it has just been handed, which is the
    //! one piece of this loop that is not obvious from reading it and the one
    //! that costs a game in progress if it slips.

    use super::*;
    use allowlist::Allowlist;
    use std::io;
    use std::net::{IpAddr, Ipv4Addr};
    use std::sync::Mutex;
    use tokio::io::{AsyncBufReadExt, BufReader};

    /// How long a test waits for a line before deciding it is never coming.
    const PATIENCE: Duration = Duration::from_secs(5);

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
}
