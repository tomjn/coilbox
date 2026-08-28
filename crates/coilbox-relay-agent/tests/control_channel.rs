//! The real binary, over real pipes.
//!
//! Everything else in this crate tests a module. This tests the process: that
//! the agent actually reads its stdin, actually writes the lines
//! `coilbox_relay_protocol` describes, and answers what it is asked. That is
//! the part a unit test cannot reach and the part a wrong build breaks
//! silently, because a sidecar that says nothing looks exactly like a sidecar
//! that has nothing to say.
//!
//! The lines are written out by hand rather than built with the protocol crate.
//! Assembling them with the same code the agent parses them with would agree
//! with itself whatever either of them did.
//!
//! No TURN server needed: `--relay-bind` without `--turn-server` gives the
//! plain UDP transport, which is a working relay for anything that can already
//! reach the host. Issue #2025 is the coturn round trip.
//!
//! Everything stays on loopback, joiners included, so no test here puts a byte
//! on a real network. Which address is being let through says nothing about
//! whether the channel carried the request, which is what these are for.

use std::io::{BufRead, BufReader, Write};
use std::net::UdpSocket;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::Duration;

/// How long to wait for a line from the agent before deciding it is never
/// coming. Generous next to the milliseconds a loopback relay takes to open,
/// and spent in full only when a test is about to fail.
const PATIENCE: Duration = Duration::from_secs(10);

/// The agent, running, with its control channel in hand.
struct Running {
    child: Child,
    stdin: ChildStdin,
    said: Receiver<String>,
}

impl Running {
    fn start() -> Running {
        // Somewhere for the agent to point its loopback sockets. Nothing
        // listens, and nothing in this test sends game traffic.
        let engine = UdpSocket::bind("127.0.0.1:0").expect("a free loopback port");
        let engine_port = engine.local_addr().expect("a bound address").port();

        let mut child = Command::new(env!("CARGO_BIN_EXE_coilbox-relay-agent"))
            .args([
                "--engine-port",
                &engine_port.to_string(),
                "--max-peers",
                "4",
                "--relay-bind",
                "127.0.0.1:0",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("the agent binary is built alongside this test");

        let stdin = child.stdin.take().expect("stdin was piped");
        let stdout = child.stdout.take().expect("stdout was piped");
        let (say, said) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { return };
                if say.send(line).is_err() {
                    return;
                }
            }
        });

        Running { child, stdin, said }
    }

    fn ask(&mut self, line: &str) {
        writeln!(self.stdin, "{line}").expect("the agent is still reading its stdin");
        self.stdin.flush().expect("the agent is still reading");
    }

    fn hears(&self) -> String {
        match self.said.recv_timeout(PATIENCE) {
            Ok(line) => line,
            Err(RecvTimeoutError::Timeout) => panic!("the agent said nothing at all"),
            Err(RecvTimeoutError::Disconnected) => panic!("the agent's stdout closed"),
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        // The agent never stops on its own, by design: the engine it is feeding
        // outlives coilbox, and issue #2027 owns when that stops being true.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The whole channel, end to end: the agent says where its relay is, coilbox
/// names an address, and the agent says it is done.
#[test]
fn the_agent_reports_its_relay_and_lets_a_named_address_through() {
    let mut agent = Running::start();

    let opened = agent.hears();
    assert!(
        opened.starts_with("{\"type\":\"relayOpen\",\"addr\":\"127.0.0.1:"),
        "the first thing a relay agent has to say is where players send, got: {opened}"
    );

    agent.ask("{\"type\":\"allowPeer\",\"id\":1,\"ip\":\"127.0.0.1\"}");
    assert_eq!(agent.hears(), "{\"type\":\"done\",\"id\":1}");
}

/// A request the agent cannot act on is answered rather than swallowed, which
/// is what stops a join that will never work from looking like one that has not
/// happened yet.
#[test]
fn a_request_the_agent_cannot_read_is_still_answered() {
    let mut agent = Running::start();
    assert!(agent.hears().starts_with("{\"type\":\"relayOpen\""));

    // A request type from a coilbox newer than this agent, which is exactly the
    // case the id salvage in `read_request` exists for.
    agent.ask("{\"type\":\"rebindPeer\",\"id\":9,\"was\":\"203.0.113.1\"}");
    let answer = agent.hears();
    assert!(
        answer.starts_with("{\"type\":\"failed\",\"id\":9,"),
        "an unreadable request has to be refused against its own id, got: {answer}"
    );

    // And the channel survives it, or one bad line from a newer coilbox would
    // cost the whole battle.
    agent.ask("{\"type\":\"allowPeer\",\"id\":10,\"ip\":\"127.0.0.1\"}");
    assert_eq!(agent.hears(), "{\"type\":\"done\",\"id\":10}");
}

/// Nothing on stdin is a line, and the agent has to keep going regardless. A
/// blank line arrives from any writer that flushes twice.
#[test]
fn a_blank_line_is_not_a_request() {
    let mut agent = Running::start();
    assert!(agent.hears().starts_with("{\"type\":\"relayOpen\""));

    agent.ask("");
    agent.ask("   ");
    agent.ask("{\"type\":\"allowPeer\",\"id\":2,\"ip\":\"127.0.0.2\"}");
    assert_eq!(agent.hears(), "{\"type\":\"done\",\"id\":2}");
}

/// The requirement this issue exists for, seen from the far end: a join that
/// cannot be let through says so, rather than being quietly dropped and read as
/// a player who has not turned up yet.
///
/// The relay here is bound to loopback, so the kernel refuses a send to an
/// address off this machine. That stands in for the real cases, an allocation
/// the TURN server has deleted or a server that has gone, because all of them
/// arrive at the same place: the send fails and the answer carries why.
#[test]
fn an_address_the_relay_cannot_reach_fails_with_a_reason() {
    let mut agent = Running::start();
    assert!(agent.hears().starts_with("{\"type\":\"relayOpen\""));

    agent.ask("{\"type\":\"allowPeer\",\"id\":3,\"ip\":\"198.51.100.4\"}");
    let answer = agent.hears();
    assert!(
        answer.starts_with("{\"type\":\"failed\",\"id\":3,\"reason\":\""),
        "a join that cannot be let through has to fail with a reason, got: {answer}"
    );
    assert!(
        !answer.contains("\"reason\":\"\""),
        "an empty reason is the same as silence, got: {answer}"
    );
}
