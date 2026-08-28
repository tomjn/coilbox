//! coilbox starting the real sidecar, which nothing in coilbox did until now.
//!
//! The unit tests either side of this prove the arguments and the wire text.
//! What they cannot prove is that the two halves meet: that coilbox's spawn
//! produces a process which reads the stdin coilbox writes to and writes the
//! stdout coilbox reads, and that a second spawn over a running one is refused
//! rather than quietly relaying the same battle to two addresses.
//!
//! No TURN server needed. Without a relay the sidecar runs over a plain UDP
//! socket, which is a working transport and is what the sidecar's own tests
//! use. `relayed_battle.rs` is the coturn round trip and is ignored by default.

use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::Duration;

use coilbox_relay_protocol::Event;
use tauri_plugin_coilbox_multiplayer::relay_agent::{NotStarted, RelayAgent};
use tauri_plugin_coilbox_multiplayer::relay_sidecar::Battle;

/// How long to wait for the sidecar to say something before deciding it never
/// will. Generous next to the milliseconds a loopback relay takes to open, and
/// spent in full only when a test is about to fail.
const PATIENCE: Duration = Duration::from_secs(10);

/// The relay agent built alongside this test.
///
/// `CARGO_BIN_EXE_` only names binaries in the package being tested, and this
/// is the package holding coilbox's end of the channel rather than the one
/// holding the sidecar. The layout either side of that is cargo's own:
/// test binaries live in `target/<profile>/deps` and binaries in
/// `target/<profile>`.
fn agent_binary() -> PathBuf {
    let mut path = std::env::current_exe().expect("a test binary knows where it is");
    path.pop();
    if path.ends_with("deps") {
        path.pop();
    }
    path.push(format!(
        "coilbox-relay-agent{}",
        std::env::consts::EXE_SUFFIX
    ));
    assert!(
        path.exists(),
        "no relay agent at {}. Build it first with `cargo build -p coilbox-relay-agent`",
        path.display()
    );
    path
}

/// A battle with somewhere to point its loopback sockets. Nothing listens
/// there, and nothing here sends game traffic.
fn a_battle() -> Battle {
    let engine = UdpSocket::bind("127.0.0.1:0").expect("a free loopback port");
    Battle {
        engine_port: engine.local_addr().expect("a bound address").port(),
        max_peers: 4,
        turn: None,
    }
}

fn start(run_file: &std::path::Path) -> (RelayAgent, Receiver<Event>) {
    let (saw, seen) = mpsc::channel();
    let agent = RelayAgent::spawn(&agent_binary(), &a_battle(), run_file, move |event| {
        let _ = saw.send(event);
    })
    .expect("nothing else is relaying");
    (agent, seen)
}

fn hears(seen: &Receiver<Event>) -> Event {
    match seen.recv_timeout(PATIENCE) {
        Ok(event) => event,
        Err(RecvTimeoutError::Timeout) => panic!("the sidecar said nothing at all"),
        Err(RecvTimeoutError::Disconnected) => panic!("the sidecar's output ended"),
    }
}

/// The gap this closes: coilbox starting the sidecar, and the control channel
/// working over the pipes of a real process rather than over a pair in a test.
#[test]
fn coilbox_starts_the_sidecar_and_can_talk_to_it() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let run_file = dir.path().join("relay").join("agent.json");

    let (agent, seen) = start(&run_file);
    assert!(
        matches!(hears(&seen), Event::RelayOpen { .. }),
        "the first thing a sidecar has to say is where players send"
    );
    assert!(
        run_file.exists(),
        "a running sidecar has to leave something for the next coilbox to find it by"
    );

    // The one thing a relayed battle cannot work without, over a real process.
    agent
        .allow_joiner("127.0.0.1".parse().expect("a loopback address"), PATIENCE)
        .expect("a running sidecar lets a reachable address through");

    agent.stop().expect("a running sidecar is still reachable");
}

/// Somebody who closes coilbox mid-game and opens it again. The battle is
/// still being relayed by the sidecar the old coilbox started, and the new one
/// must find it rather than starting a second relay to a second address while
/// the players carry on through the first.
#[test]
fn a_reopened_coilbox_finds_the_running_sidecar_rather_than_starting_a_second() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let run_file = dir.path().join("relay").join("agent.json");

    let (first, seen) = start(&run_file);
    assert!(matches!(hears(&seen), Event::RelayOpen { .. }));

    // `expect_err` is not available here, because a `RelayAgent` holds pipes
    // and so is not `Debug`. Spelling the match out says the same thing.
    match RelayAgent::spawn(&agent_binary(), &a_battle(), &run_file, |_| {}) {
        Err(NotStarted::AlreadyRelaying(pid)) => assert_ne!(
            pid, 0,
            "a reopened coilbox has to be told which process is relaying"
        ),
        Err(other) => panic!("refused for the wrong reason: {other}"),
        Ok(_) => panic!("a second sidecar started over a battle the first is still relaying"),
    }

    // And the running one is untouched, which is the whole point.
    first
        .allow_joiner("127.0.0.1".parse().expect("a loopback address"), PATIENCE)
        .expect("the sidecar that was already relaying carries on doing so");

    first.stop().expect("a running sidecar is still reachable");
}

/// Once the battle has ended there is nothing to find, so the next one starts
/// a relay instead of being told one is already running.
#[test]
fn a_battle_that_ended_leaves_nothing_for_the_next_one_to_trip_over() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let run_file = dir.path().join("relay").join("agent.json");

    let (agent, seen) = start(&run_file);
    assert!(matches!(hears(&seen), Event::RelayOpen { .. }));
    agent.stop().expect("a running sidecar is still reachable");

    // The sidecar answers, says it is stopping, and goes. Waiting on the
    // event rather than on the clock, so this does not depend on how long an
    // exit takes.
    let mut stopped = false;
    while let Ok(event) = seen.recv_timeout(PATIENCE) {
        if matches!(event, Event::Stopping { .. }) {
            stopped = true;
        }
    }
    assert!(stopped, "a sidecar that was asked to stop has to say so");
    assert!(
        !run_file.exists(),
        "a run file outliving its sidecar means no relayed battle can ever start again"
    );

    let (next, seen) = start(&run_file);
    assert!(matches!(hears(&seen), Event::RelayOpen { .. }));
    next.stop().expect("a running sidecar is still reachable");
}
