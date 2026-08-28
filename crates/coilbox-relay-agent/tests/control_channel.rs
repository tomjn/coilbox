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
use std::path::Path;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

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
        Running::start_with(None)
    }

    fn start_with(run_file: Option<&Path>) -> Running {
        // Somewhere for the agent to point its loopback sockets. Nothing
        // listens, and nothing in this test sends game traffic.
        let engine = UdpSocket::bind("127.0.0.1:0").expect("a free loopback port");
        let engine_port = engine.local_addr().expect("a bound address").port();

        let mut command = Command::new(env!("CARGO_BIN_EXE_coilbox-relay-agent"));
        command.args([
            "--engine-port",
            &engine_port.to_string(),
            "--max-peers",
            "4",
            "--relay-bind",
            "127.0.0.1:0",
        ]);
        if let Some(run_file) = run_file {
            command.arg("--run-file").arg(run_file);
        }
        let mut child = command
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

    /// Wait for the process to actually end, which is the assertion a pipe
    /// going quiet cannot make.
    fn ends(&mut self) -> ExitStatus {
        let deadline = Instant::now() + PATIENCE;
        while Instant::now() < deadline {
            if let Some(status) = self.child.try_wait().expect("a child we spawned") {
                return status;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("the agent is still running");
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        // Killed rather than asked, because a test that has finished with the
        // agent has usually finished mid-battle, and mid-battle is exactly
        // when it is designed not to stop.
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

/// coilbox asking it to stop, which is the ordinary end of a battle and the
/// only signal that beats every other. The answer has to come out before the
/// process does, or a coilbox waiting on it learns the battle ended from a
/// pipe closing rather than from the agent.
#[test]
fn an_agent_that_is_asked_to_stop_answers_and_then_exits() {
    let mut agent = Running::start();
    assert!(agent.hears().starts_with("{\"type\":\"relayOpen\""));

    agent.ask("{\"type\":\"stop\",\"id\":4}");
    assert_eq!(agent.hears(), "{\"type\":\"done\",\"id\":4}");
    let last = agent.hears();
    assert!(
        last.starts_with("{\"type\":\"stopping\",\"reason\":\""),
        "the agent says why it is going before it goes, got: {last}"
    );
    assert!(
        agent.ends().success(),
        "a battle that ended normally is not a failure"
    );
}

/// Naming the engine is a request like any other and has to be answered like
/// one. Nothing here can prove the agent then outlives it, because that takes
/// four minutes of relay traffic. `stopping.rs` tests that on a wound-forward
/// clock.
#[test]
fn naming_the_engine_is_answered() {
    let mut agent = Running::start();
    assert!(agent.hears().starts_with("{\"type\":\"relayOpen\""));

    agent.ask("{\"type\":\"watchEngine\",\"id\":5,\"pid\":4021}");
    assert_eq!(agent.hears(), "{\"type\":\"done\",\"id\":5}");

    // And the channel carries on, since watching an engine is not the end of
    // anything.
    agent.ask("{\"type\":\"allowPeer\",\"id\":6,\"ip\":\"127.0.0.1\"}");
    assert_eq!(agent.hears(), "{\"type\":\"done\",\"id\":6}");
}

/// The failure the run file exists to prevent: a second agent relaying the
/// same battle to a second address, while the players in it are still going
/// through the first.
#[test]
fn a_second_agent_will_not_start_over_a_running_one() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let run_file = dir.path().join("relay").join("agent.json");

    let mut first = Running::start_with(Some(&run_file));
    assert!(first.hears().starts_with("{\"type\":\"relayOpen\""));
    assert!(
        run_file.exists(),
        "a running agent has to leave something to be found by"
    );

    let mut second = Running::start_with(Some(&run_file));
    let refused = second.hears();
    assert!(
        refused.starts_with("{\"type\":\"stopping\",\"reason\":\"relay agent "),
        "the second agent has to say why it will not start, got: {refused}"
    );
    assert!(
        !second.ends().success(),
        "a refusal to start is a failure, so a caller watching the process sees it"
    );

    // And the first is untouched, which is the whole point.
    first.ask("{\"type\":\"allowPeer\",\"id\":7,\"ip\":\"127.0.0.1\"}");
    assert_eq!(first.hears(), "{\"type\":\"done\",\"id\":7}");
}

/// An agent that has stopped leaves nothing behind, so the next battle starts
/// a relay rather than being told one is already running.
#[test]
fn an_agent_that_stops_gives_its_run_file_back() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let run_file = dir.path().join("relay").join("agent.json");

    let mut agent = Running::start_with(Some(&run_file));
    assert!(agent.hears().starts_with("{\"type\":\"relayOpen\""));
    assert!(run_file.exists());

    agent.ask("{\"type\":\"stop\",\"id\":8}");
    assert!(agent.ends().success());
    assert!(
        !run_file.exists(),
        "a run file outliving its agent means no relayed battle can ever start again"
    );
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
