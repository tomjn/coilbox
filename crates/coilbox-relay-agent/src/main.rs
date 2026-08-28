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
//! ## What is not here yet
//!
//! - The TURN allocation this is really meant to run over (issue #2014). Until
//!   then the relay side is a plain UDP socket, which is a working transport for
//!   a relay that can reach the host directly and is what the tests drive.
//! - The control channel coilbox talks to this over (issue #2015). For now the
//!   engine port and the seat count are arguments and the bound relay address is
//!   printed on stdout.
//! - When the agent decides to stop (issue #2027).
//!
//! Usage:
//!
//! ```text
//! coilbox-relay-agent --engine-port <port> --max-peers <n> [--relay-bind <addr>]
//! ```

mod demux;
mod relay;

use std::net::{Ipv4Addr, SocketAddr};
use std::process::ExitCode;

use demux::Agent;
use tokio::net::UdpSocket;

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
    relay_bind: SocketAddr,
}

fn parse_args() -> Result<Args, String> {
    let mut engine_port = None;
    let mut max_peers = None;
    let mut relay_bind = SocketAddr::from(([0, 0, 0, 0], 0));

    let mut argv = std::env::args().skip(1);
    while let Some(flag) = argv.next() {
        let mut value = || argv.next().ok_or(format!("{flag} needs a value"));
        match flag.as_str() {
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
    Ok(Args {
        engine_port,
        max_peers,
        relay_bind,
    })
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

    let relay = match UdpSocket::bind(args.relay_bind).await {
        Ok(socket) => socket,
        Err(e) => {
            eprintln!(
                "coilbox-relay-agent: could not bind {}: {e}",
                args.relay_bind
            );
            return ExitCode::FAILURE;
        }
    };
    match relay.local_addr() {
        // The one line the caller reads, because with `--relay-bind` left at
        // port 0 this is the only way to learn which port the relay must send
        // to.
        Ok(addr) => println!("{addr}"),
        Err(e) => {
            eprintln!("coilbox-relay-agent: bound socket has no address: {e}");
            return ExitCode::FAILURE;
        }
    }

    let engine = SocketAddr::from((Ipv4Addr::LOCALHOST, args.engine_port));
    let mut agent = Agent::new(engine, args.max_peers);
    // One pass. Rebuilding a failed relay belongs with the transport that can
    // fail in interesting ways (issue #2014), and the agent is built so that
    // rebuilding it here later costs nothing: the peer table lives out here,
    // above `run`.
    if let Err(e) = agent.run(&relay).await {
        eprintln!("coilbox-relay-agent: relay stopped: {e}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
