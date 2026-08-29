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
use tauri_plugin_coilbox_multiplayer::relay_sidecar::{self, Battle};

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

/// Wait for the sidecar named in `run_file` to go, or say it did not.
///
/// Polled on the sidecar's own interval, the same way the command does, and
/// given the same budget. `false` means it is still there, which for a sidecar
/// that took the note means it is carrying a game.
fn goes_within_the_budget(run_file: &std::path::Path) -> bool {
    let deadline = std::time::Instant::now() + relay_sidecar::NOTE_PATIENCE;
    while std::time::Instant::now() < deadline {
        if relay_sidecar::already_relaying(run_file).is_none() {
            return true;
        }
        std::thread::sleep(coilbox_relay_protocol::NOTE_LOOKED_FOR_EVERY);
    }
    false
}

/// The one seam neither side's own tests can reach: coilbox's note writer
/// against a real sidecar (issue #2062).
///
/// The sidecar's tests write the note by hand and coilbox's write it for a
/// sidecar that is not there. Between them a note written to the wrong path, or
/// in a shape the sidecar reads as somebody else's, would leave both green and
/// ship a button that does nothing.
///
/// Nothing was ever played through this relay, so the sidecar takes the note and
/// goes, and the run file that was refusing the host's next battle goes with it.
#[test]
fn coilbox_can_ask_a_sidecar_it_has_no_pipe_to_to_stop() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let run_file = dir.path().join("relay").join("agent.json");

    let (agent, seen) = start(&run_file);
    assert!(matches!(hears(&seen), Event::RelayOpen { .. }));
    let pid = relay_sidecar::already_relaying(&run_file).expect("a running sidecar");

    // The crash this issue is about: coilbox goes and the sidecar carries on,
    // with nobody holding its control channel any more.
    drop(agent);

    relay_sidecar::leave_a_stop_note(&run_file, pid).expect("a writable temp dir");
    assert!(
        goes_within_the_budget(&run_file),
        "a leftover sidecar with nothing to carry has to act on the note inside the budget \
         the command gives it, or the host is told it would not stop"
    );
    assert!(
        relay_sidecar::note_was_taken(&run_file),
        "the note has to be taken, because that is the only proof of life coilbox can get \
         from a process it holds no pipe to"
    );
}

/// The same ask against a relay that is carrying a game, which is what somebody
/// who closed coilbox mid-match and opened it again is looking at.
///
/// The sidecar reads the note, so coilbox knows it is alive, and keeps relaying,
/// so nobody in that match is cut off. Both halves matter: without the first the
/// host would be told nothing is listening, and without the second they would
/// have ended everybody else's game.
#[test]
fn asking_a_sidecar_that_is_carrying_a_game_does_not_end_it() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let run_file = dir.path().join("relay").join("agent.json");

    let (agent, seen) = start(&run_file);
    let Event::RelayOpen { addr } = hears(&seen) else {
        panic!("the first thing a sidecar says is where players send");
    };
    let pid = relay_sidecar::already_relaying(&run_file).expect("a running sidecar");

    // A player's engine talking through the relay, which is what a game in
    // progress looks like from the sidecar's side. The sidecar binds every
    // interface, so loopback reaches the port it reported.
    let player = UdpSocket::bind("127.0.0.1:0").expect("a free loopback port");
    let relay = std::net::SocketAddr::from(([127, 0, 0, 1], addr.port()));
    player
        .send_to(b"a datagram from a player", relay)
        .expect("the relay is bound");
    // Given the sidecar a moment to read it, on its own interval, so the note
    // below cannot land first.
    std::thread::sleep(coilbox_relay_protocol::NOTE_LOOKED_FOR_EVERY);

    drop(agent);
    relay_sidecar::leave_a_stop_note(&run_file, pid).expect("a writable temp dir");
    // Checked before the wait as well as after it. Without this the test would
    // pass on a note that was never written, since a note that does not exist
    // reads as one that has been taken.
    assert!(
        !relay_sidecar::note_was_taken(&run_file),
        "there has to be a note outstanding, or the rest of this proves nothing"
    );

    assert!(
        !goes_within_the_budget(&run_file),
        "the note ended a relay that was carrying a game, so every other player in that \
         match was cut off"
    );
    assert!(
        relay_sidecar::note_was_taken(&run_file),
        "the sidecar has to read the note even when it refuses it, or coilbox cannot tell a \
         relay carrying a game from a process id that belongs to something else"
    );
}

/// The half of issue #2078 that only a real sidecar can prove: it holds its own
/// run file open for as long as it runs, and its record says so.
///
/// Everything coilbox does about a recycled process number rests on that. Both
/// sides' unit tests stand in for the sidecar with a lock they take themselves,
/// so a sidecar that wrote the promise and never took the lock, or took it and
/// let it go, would leave every one of them green and have coilbox clearing a
/// record belonging to a relay carrying a game.
#[test]
fn a_running_sidecar_holds_its_own_run_file_and_says_it_does() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let run_file = dir.path().join("relay").join("agent.json");

    let (agent, seen) = start(&run_file);
    assert!(matches!(hears(&seen), Event::RelayOpen { .. }));

    let record = coilbox_relay_protocol::RunFile::from_json(
        &std::fs::read_to_string(&run_file).expect("a running sidecar left a run file"),
    )
    .expect("the sidecar writes a record coilbox can read");
    assert!(
        record.locked,
        "a sidecar that does not promise the lock leaves coilbox back on the process id alone"
    );
    assert!(
        coilbox_relay_protocol::run_file_is_still_held(&run_file),
        "the promise has to be kept, or coilbox reads a live relay as a leftover and starts a \
         second one over the game it is carrying"
    );

    agent.stop().expect("a running sidecar is still reachable");
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
