//! A whole relayed battle, against a TURN server that is really running.
//!
//! Everything else written for relayed hosting is tested against something we
//! wrote ourselves: a UDP socket standing in for a relay, a hand-rolled fake
//! TURN server that answers just enough of RFC 5766, a pair of pipes standing in
//! for the sidecar. Each of those says the code does what we believe. None of
//! them can say whether what we believe about TURN is true.
//!
//! This one puts the real pieces together. coturn is the server, the sidecar is
//! the real binary talking to it over UDP, [`RelayAgent`] is coilbox's real end
//! of the control channel, and the only thing faked is the engine, which is a
//! UDP echo that writes down who spoke to it.
//!
//! ## What it proves
//!
//! - A real TURN server grants the agent an allocation with the long-term
//!   credential dance in `coilbox-relay-agent`'s `allocation.rs`, and the
//!   address the agent reports is the one the server handed out.
//! - coturn really does drop traffic from an address with no permission, and
//!   the single byte `allowlist.rs` sends is really what puts one in its table.
//!   The same player socket is refused before the permission and carried after
//!   it, with nothing else changed.
//! - Several players down one allocation reach the engine from one source port
//!   each, and each one's reply comes back to the player it belongs to. That is
//!   the property the whole sidecar exists for, now measured through a real
//!   TURN relay rather than a loopback socket pretending to be one.
//!
//! ## What it does not prove
//!
//! The engine's own behaviour on a relayed connection. The engine here is a UDP
//! echo, so this says the datagrams arrive at distinct endpoints and come back,
//! and says nothing about what a real engine makes of them. That end is argued
//! from the engine's source in issue #1696 and only a real game between two
//! machines on real connections settles it.
//!
//! It also runs entirely on loopback, so every player shares one IP. A TURN
//! permission is per-IP, so one permission covers all of them here where on a
//! real network there would be one each. The permission mechanism is proved,
//! the per-player bookkeeping around it is not, and it has no bookkeeping to
//! get wrong: `allowlist.rs` holds a set of addresses and sends one byte to
//! each.
//!
//! ## Running it
//!
//! Ignored, in the same way and for the same reason as
//! `tauri-plugin-coilbox-direct/tests/reachability.rs`: it needs something real
//! that a CI runner does not have. Install coturn with `brew install coturn` on
//! macOS or `apt-get install coturn` on Debian and Ubuntu, then:
//!
//! ```text
//! cargo build -p coilbox-relay-agent
//! cargo test -p tauri-plugin-coilbox-multiplayer --test relayed_battle -- --ignored --nocapture
//! ```
//!
//! The build comes first because this test spawns the sidecar binary and cargo
//! does not build another package's binaries for it.
//!
//! It runs coturn as a process rather than in a container, which is what issue
//! #2025 imagined, because a container only works where the host can send UDP
//! to it. Docker Desktop and a Linux docker can. colima, which is what this was
//! written on, forwards published ports with ssh, so its UDP ports are not
//! forwarded at all and a TURN server in a container there is unreachable.
//! Spawning `turnserver` is the same coturn either way and works everywhere.
//! Written against coturn 4.17.2.

use std::collections::BTreeSet;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use coilbox_relay_protocol::Event;
use tauri_plugin_coilbox_multiplayer::relay_agent::RelayAgent;

/// How many players take a seat. Four, matching the demux's own test, which is
/// enough for "one endpoint each" to mean something and small enough to read.
const SEATS: usize = 4;

/// How long anything here waits for something that should take milliseconds.
/// Spent in full only when a test is about to fail.
const PATIENCE: Duration = Duration::from_secs(20);

/// How long to wait before deciding a datagram is not coming back.
///
/// Only used for the send that is supposed to be dropped, so it is waited out
/// in full on every run. Two hundred times the round trip the rest of this test
/// measures, and short enough not to be noticed.
const SILENCE: Duration = Duration::from_millis(500);

/// The longest allocation the two loss tests let coturn grant.
///
/// An allocation is only lost once its lifetime has run out or a Refresh has
/// been refused, and the client refreshes at half the lifetime it was granted.
/// coturn's default hour would mean a test that waits half an hour for the
/// first refresh, so `--max-allocate-lifetime` cuts it.
///
/// coturn clamps its own minimum, so what it grants is not necessarily what it
/// was asked for, which is why the tests below time how long the agent takes to
/// notice rather than asserting a number this constant made up.
const SHORT_LIFETIME: Duration = Duration::from_secs(2);

/// The credential coturn is configured with and the agent is handed. Issue
/// #2016 is what makes these come from the lobby.
const TURN_USER: &str = "battle-host";
const TURN_PASSWORD: &str = "a-short-lived-secret";
const TURN_REALM: &str = "coilbox.test";

/// The ports coturn may hand out an allocation on.
///
/// Pinned rather than left at coturn's default of 49152 upwards for two
/// reasons. It lets the test assert the relayed address really came from the
/// server rather than from anything of ours, and it keeps the allocation away
/// from port 49152, which is where `allowlist.rs` addresses its permission
/// probe. An allocation on that port would relay the probe back to itself and
/// the agent would see a peer nobody is playing.
///
/// Below 32768, which is where Linux starts handing out ephemeral ports, and
/// well below the 49152 macOS starts at, so nothing else on the machine is
/// likely to be sitting here.
const RELAY_PORTS: (u16, u16) = (30000, 30099);

/// The point of the whole exercise: several players, one allocation on a real
/// TURN server, one engine, and everybody's traffic arriving where it belongs.
#[test]
#[ignore = "needs coturn installed and a few seconds: see this file's comment for the command"]
fn a_relayed_battle_carries_every_player_to_the_engine_and_back() {
    let coturn = Coturn::start();
    let engine = FakeEngine::start();
    let sidecar = Sidecar::start(&coturn, engine.addr);

    let relayed = sidecar.relay_open();
    assert_eq!(
        relayed.ip(),
        IpAddr::V4(Ipv4Addr::LOCALHOST),
        "the battle has to be advertised at the server's address"
    );
    assert!(
        (RELAY_PORTS.0..=RELAY_PORTS.1).contains(&relayed.port()),
        "the relayed address has to be one coturn allocated, and {relayed} is not in the range \
         coturn was told to allocate from"
    );

    // The half of this that has never been observed against a real server.
    // coturn is supposed to drop traffic from an address its allocation has no
    // permission for, and `allowlist.rs` is supposed to install one by sending
    // a single byte to that address. Both halves are asserted with the same
    // socket sending to the same place, so the permission is the only thing
    // that changed between the two.
    let first = FakePlayer::dialling(relayed);
    first.gets_nowhere(b"before anybody vouched for me", SILENCE);
    assert!(
        engine.callers().is_empty(),
        "a player nobody has vouched for reached the engine, so the TURN permission is not \
         doing anything and letting joiners through is not what makes a relayed battle work"
    );

    // The seam. Nothing in coilbox calls this yet, because coilbox has no route
    // to a joiner's address (see `relay_agent.rs`), so this is the one place it
    // is driven against a real allocation.
    sidecar
        .agent
        .allow_joiner(IpAddr::V4(Ipv4Addr::LOCALHOST), PATIENCE)
        .expect("the agent let the joiner through the allocation");

    first.round_trip(b"after somebody vouched for me");

    let players: Vec<FakePlayer> = (1..SEATS).map(|_| FakePlayer::dialling(relayed)).collect();
    for (seat, player) in players.iter().enumerate() {
        player.round_trip(format!("hello from seat {seat}").as_bytes());
    }

    // Said in the same terms the engine states it in: `UDPListener::Update`
    // keys its connection table on the endpoint a datagram arrived from
    // (`rts/System/Net/UDPListener.cpp:134`), so this count is how many players
    // the engine thinks it has.
    let ports = engine.distinct_ports();
    assert_eq!(
        ports.len(),
        SEATS,
        "the engine has to see one endpoint per player, not one for all of them, and it saw \
         {ports:?}"
    );
    assert!(
        engine
            .callers()
            .iter()
            .all(|caller| caller.ip() == IpAddr::V4(Ipv4Addr::LOCALHOST)),
        "every peer socket the agent binds is on loopback"
    );
}

/// A TURN server that goes away and stays away. Nothing answers the refreshes,
/// the lifetime coturn granted runs out, and the agent has to say so.
///
/// This is the loss the `turn` crate is silent about. Its own refresh loop
/// retries three times, logs at warn level and carries on, so without the
/// watchdog in `allocation.rs` the host would sit in a battle nobody can reach
/// until the game ended.
#[test]
#[ignore = "needs coturn installed and a few seconds: see this file's comment for the command"]
fn a_turn_server_that_stops_answering_is_noticed_before_the_game_ends() {
    let mut coturn = Coturn::granting_at_most(SHORT_LIFETIME);
    let engine = FakeEngine::start();
    let sidecar = Sidecar::start(&coturn, engine.addr);

    let relayed = sidecar.relay_open();
    sidecar
        .agent
        .allow_joiner(IpAddr::V4(Ipv4Addr::LOCALHOST), PATIENCE)
        .expect("the agent let the joiner through the allocation");
    let player = FakePlayer::dialling(relayed);
    player.round_trip(b"the relay is working");

    let taken_away = std::time::Instant::now();
    coturn.stop();

    let reason = sidecar.waits_for_relay_down();
    let noticed_in = taken_away.elapsed();
    assert!(
        reason.contains("lifetime ran out"),
        "a server that stopped answering has to be reported as the allocation expiring, and the \
         agent said: {reason}"
    );
    // Loose on purpose. The exact number is coturn's to choose and the client
    // refreshes on its own timer, so what is being asserted is the shape of the
    // answer: the agent notices within one granted lifetime of the last one it
    // was answered, rather than within the ten minutes a default allocation
    // would have taken or not at all.
    assert!(
        noticed_in < PATIENCE,
        "the agent took {noticed_in:?} to notice, which is longer than any battle would wait"
    );
    println!("relay down after {noticed_in:?}, because {reason}");
}

/// A TURN server that comes back with no memory of the allocation, which is
/// what a restart on somebody else's machine looks like from here.
///
/// Two things are being asked. What a real coturn says to a signed Refresh for
/// an allocation it has never heard of, which decides whether the agent treats
/// the loss as retryable or gives up, and whether the players survive the
/// rebuild.
///
/// The second one is the property the sidecar is built around. The engine
/// identifies a player by the UDP endpoint their traffic arrives from, so a
/// rebuild that gave everybody a new loopback socket would look to the engine
/// like every player leaving and a set of strangers arriving, mid-game, which
/// it does not recover from. `demux.rs` keeps the peer table outside the relay
/// precisely so that cannot happen, and until now nothing has checked it
/// against a relay that really was rebuilt.
#[test]
#[ignore = "needs coturn installed and a few seconds: see this file's comment for the command"]
fn a_restarted_turn_server_costs_the_allocation_but_not_the_players() {
    let mut coturn = Coturn::granting_at_most(SHORT_LIFETIME);
    let engine = FakeEngine::start();
    let sidecar = Sidecar::start(&coturn, engine.addr);

    let first_relay = sidecar.relay_open();
    sidecar
        .agent
        .allow_joiner(IpAddr::V4(Ipv4Addr::LOCALHOST), PATIENCE)
        .expect("the agent let the joiner through the allocation");
    let players: Vec<FakePlayer> = (0..SEATS).map(|_| FakePlayer::dialling(first_relay)).collect();
    for (seat, player) in players.iter().enumerate() {
        player.round_trip(format!("hello from seat {seat}").as_bytes());
    }
    let before = engine.distinct_ports();
    assert_eq!(before.len(), SEATS, "every player reached the engine first");

    // Fast, so that the next Refresh lands on a coturn that is running and has
    // never heard of this allocation. Leave it down for longer than the
    // lifetime and the allocation simply expires instead, which is the test
    // above.
    coturn.stop();
    coturn.start_again();

    let reason = sidecar.waits_for_relay_down();
    // The observation the whole test was written for. coturn 4.17.2 answers a
    // signed Refresh for an allocation it has no record of with 437, and with
    // no reason phrase, so the words here are the ones `allocation.rs` fills in
    // from the STUN registry. 437 is not one of the codes it treats as a
    // credential it cannot recover from, so the agent rebuilds rather than
    // stopping the battle. Asserted rather than assumed because a server that
    // answered 401 or 441 to the same loss would end the battle instead, and
    // this is what would say so.
    assert_eq!(
        reason, "the server refused it (error 437 Allocation Mismatch)",
        "a restarted coturn refuses the Refresh for an allocation it has forgotten, and the host \
         has to be told which refusal it was"
    );

    let second_relay = sidecar.relay_open();
    assert_ne!(
        second_relay, first_relay,
        "a rebuilt allocation is a new one, so the battle has to be advertised again (issue \
         #2031)"
    );

    for (seat, player) in players.iter().enumerate() {
        player.redial(second_relay);
        player.round_trip_once_it_can(format!("still here, seat {seat}").as_bytes());
    }

    assert_eq!(
        engine.distinct_ports(),
        before,
        "every player has to reach the engine on the port they had before the relay was rebuilt, \
         or the engine sees the whole battle leave and a set of strangers arrive"
    );
}

/// A real coturn, running for the length of one test.
struct Coturn {
    /// Where the agent sends its Allocate. Fixed at construction, so a coturn
    /// that is stopped and started again comes back at the same address and
    /// the agent's next Allocate goes to the same place its last one did.
    addr: SocketAddr,
    /// The configuration and log, thrown away when the test ends.
    dir: PathBuf,
    conf: PathBuf,
    /// `None` while it is stopped, which is a state two of these tests put it
    /// in on purpose.
    child: Option<Child>,
}

impl Coturn {
    /// A coturn with the lifetimes it hands out left alone, which is an hour.
    fn start() -> Coturn {
        Coturn::start_with(None)
    }

    /// A coturn that will not grant an allocation for longer than
    /// `max_lifetime`, so the client refreshes on a timescale a test can wait
    /// out.
    ///
    /// coturn clamps this from below, so what it actually grants is worth
    /// asserting rather than assuming. See [`SHORT_LIFETIME`].
    fn granting_at_most(max_lifetime: Duration) -> Coturn {
        Coturn::start_with(Some(max_lifetime))
    }

    fn start_with(max_lifetime: Option<Duration>) -> Coturn {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, free_udp_port()));
        // Named after the port as well as the process, because the tests in
        // this file run in parallel and each one wants its own coturn with its
        // own configuration.
        let dir = std::env::temp_dir().join(format!(
            "coilbox-relayed-battle-{}-{}",
            std::process::id(),
            addr.port()
        ));
        std::fs::create_dir_all(&dir).expect("somewhere to put coturn's configuration");
        let log = dir.join("coturn.log");
        let conf = dir.join("turnserver.conf");

        // Everything here is either what the agent needs or what stops coturn
        // reaching outside this test. `allow-loopback-peers` is the one worth
        // pausing on: coturn refuses to relay to 127.0.0.0/8 without it, and
        // every player in this test is on loopback. coturn warns that this is
        // not for production, and it is right.
        let mut settings = vec![
            format!("listening-port={}", addr.port()),
            "listening-ip=127.0.0.1".to_string(),
            "relay-ip=127.0.0.1".to_string(),
            format!("min-port={}", RELAY_PORTS.0),
            format!("max-port={}", RELAY_PORTS.1),
            "lt-cred-mech".to_string(),
            format!("user={TURN_USER}:{TURN_PASSWORD}"),
            format!("realm={TURN_REALM}"),
            "allow-loopback-peers".to_string(),
            "fingerprint".to_string(),
            "no-tls".to_string(),
            // Nothing here needs the admin interface, and leaving it on means
            // binding another port for no reason.
            "no-cli".to_string(),
            "simple-log".to_string(),
            format!("log-file={}", log.display()),
            "no-stdout-log".to_string(),
            // Otherwise coturn writes one to /var/tmp and two runs at once
            // fight over it.
            format!("pidfile={}", dir.join("turnserver.pid").display()),
        ];
        if let Some(max_lifetime) = max_lifetime {
            settings.push(format!(
                "max-allocate-lifetime={}",
                max_lifetime.as_secs()
            ));
        }
        std::fs::write(&conf, settings.join("\n") + "\n").expect("a writable temporary directory");

        let mut coturn = Coturn {
            addr,
            dir,
            conf,
            child: None,
        };
        coturn.start_again();
        coturn
    }

    /// Take the server away, the way a machine somebody else owns goes away
    /// mid-game.
    ///
    /// Killed rather than asked to shut down, because a TURN server that hands
    /// its allocations back on the way out is the easy case. What the agent has
    /// to survive is the one that does not.
    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Bring it back, at the same address, with no memory of anything it was
    /// relaying.
    fn start_again(&mut self) {
        self.child = Some(
            Command::new("turnserver")
                .arg("-c")
                .arg(&self.conf)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect(
                    "turnserver on PATH: install coturn with `brew install coturn` or \
                     `apt-get install coturn`",
                ),
        );
        self.wait_until_listening();
    }

    /// Wait for coturn to answer, rather than for it to say it is ready.
    ///
    /// A STUN Binding request is the cheapest question a TURN server answers
    /// without a credential, so a reply to one means the listener is up. That
    /// beats watching the log for a line about being ready, which would tie
    /// this test to the wording of whichever coturn somebody has installed.
    ///
    /// Worth the trouble because the agent is slow to be wrong: with nothing
    /// listening it retransmits on the `turn` crate's own schedule and takes
    /// about 16 seconds to report a server it never reached.
    fn wait_until_listening(&self) {
        let asking = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).expect("a free loopback port");
        asking
            .set_read_timeout(Some(Duration::from_millis(100)))
            .expect("a socket that has just been bound");
        let deadline = std::time::Instant::now() + PATIENCE;
        while std::time::Instant::now() < deadline {
            let _ = asking.send_to(&stun_binding_request(), self.addr);
            let mut answer = [0u8; 512];
            if asking.recv_from(&mut answer).is_ok() {
                return;
            }
        }
        panic!(
            "coturn did not answer a STUN Binding request on {} within {} seconds. Its log is at \
             {}",
            self.addr,
            PATIENCE.as_secs(),
            self.dir.join("coturn.log").display()
        );
    }
}

impl Drop for Coturn {
    fn drop(&mut self) {
        self.stop();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// The 20 bytes of a STUN Binding request: the message type, no attributes, the
/// magic cookie from RFC 5389 section 6, and a transaction id nothing here
/// reads back.
fn stun_binding_request() -> [u8; 20] {
    let mut request = [0u8; 20];
    request[0..2].copy_from_slice(&0x0001u16.to_be_bytes());
    request[2..4].copy_from_slice(&0u16.to_be_bytes());
    request[4..8].copy_from_slice(&0x2112_A442u32.to_be_bytes());
    request[8..20].copy_from_slice(b"coilbox-asks");
    request
}

/// The relay agent sidecar, running, with coilbox's end of its control channel
/// in hand.
struct Sidecar {
    child: Child,
    agent: RelayAgent,
    said: Receiver<Event>,
}

impl Sidecar {
    fn start(coturn: &Coturn, engine: SocketAddr) -> Sidecar {
        let mut child = Command::new(agent_binary())
            .args([
                "--engine-port",
                &engine.port().to_string(),
                "--max-peers",
                &SEATS.to_string(),
                "--turn-server",
                &coturn.addr.to_string(),
                "--turn-user",
                TURN_USER,
            ])
            .env("COILBOX_TURN_PASSWORD", TURN_PASSWORD)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Inherited, because the agent's stderr is sentences for a human
            // and this is a test a human runs by hand.
            .stderr(Stdio::inherit())
            .spawn()
            .expect("the relay agent binary starts");

        let to_agent = child.stdin.take().expect("stdin was piped");
        let from_agent = child.stdout.take().expect("stdout was piped");
        let (saw, said) = mpsc::channel();
        let agent = RelayAgent::driving(from_agent, to_agent, move |event| {
            let _ = saw.send(event);
        });

        Sidecar { child, agent, said }
    }

    /// The address the agent's allocation is at, once it has one.
    fn relay_open(&self) -> SocketAddr {
        match self.said.recv_timeout(PATIENCE) {
            Ok(Event::RelayOpen { addr }) => addr,
            // Everything else the agent can say before it has a relay is a
            // reason it has not got one, and none of them are recoverable
            // inside a test that is about to want one.
            Ok(other) => panic!("the agent said {other:?} instead of opening a relay"),
            Err(RecvTimeoutError::Timeout) => {
                panic!("the agent never opened a relay on the TURN server")
            }
            Err(RecvTimeoutError::Disconnected) => panic!("the agent's output ended"),
        }
    }

    /// Wait for the agent to say the relay is gone, and hand back the reason it
    /// gave.
    ///
    /// The reason is the point. It is the agent's rendering of what the TURN
    /// server actually said, and what the tests below assert against.
    fn waits_for_relay_down(&self) -> String {
        match self.said.recv_timeout(PATIENCE) {
            Ok(Event::RelayDown { reason }) => reason,
            Ok(other) => panic!("the agent said {other:?} instead of noticing its relay had gone"),
            Err(RecvTimeoutError::Timeout) => panic!(
                "the agent never noticed its allocation had gone, so a host would sit in a \
                 battle nobody can reach for the length of the game"
            ),
            Err(RecvTimeoutError::Disconnected) => panic!("the agent's output ended"),
        }
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        // The agent never stops on its own, by design: the engine it feeds
        // outlives coilbox, and issue #2027 owns when that stops being true.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Where cargo put the sidecar.
///
/// `CARGO_BIN_EXE_` only names binaries in the package being tested, and this
/// test is in the package that holds coilbox's end of the channel rather than
/// the package that holds the sidecar. The layout either side of that is
/// cargo's own and has been the same for years: test binaries live in
/// `target/<profile>/deps` and binaries in `target/<profile>`.
fn agent_binary() -> PathBuf {
    let mut path = std::env::current_exe().expect("a test binary knows where it is");
    path.pop();
    if path.ends_with("deps") {
        path.pop();
    }
    path.push("coilbox-relay-agent");
    assert!(
        path.exists(),
        "no relay agent at {}. Build it first with `cargo build -p coilbox-relay-agent`",
        path.display()
    );
    path
}

/// A UDP echo standing in for the host's engine, which writes down every
/// endpoint it was spoken to from.
///
/// That list is the assertion the sidecar exists for. The engine keys its
/// connection table on the endpoint a datagram arrived from, so how many
/// distinct ones it saw is how many players it thinks are in the game.
struct FakeEngine {
    addr: SocketAddr,
    callers: Arc<Mutex<Vec<SocketAddr>>>,
}

impl FakeEngine {
    fn start() -> FakeEngine {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).expect("a free loopback port");
        let addr = socket.local_addr().expect("a bound address");
        let callers: Arc<Mutex<Vec<SocketAddr>>> = Arc::default();
        let record = Arc::clone(&callers);
        std::thread::spawn(move || {
            // The engine's own ceiling on a datagram, from
            // `rts/System/Net/UDPConnection.cpp:27`.
            let mut buf = vec![0u8; 4096];
            loop {
                let Ok((read, from)) = socket.recv_from(&mut buf) else {
                    return;
                };
                record.lock().unwrap().push(from);
                let _ = socket.send_to(&buf[..read], from);
            }
        });
        FakeEngine { addr, callers }
    }

    fn callers(&self) -> Vec<SocketAddr> {
        self.callers.lock().unwrap().clone()
    }

    fn distinct_ports(&self) -> BTreeSet<u16> {
        self.callers().iter().map(SocketAddr::port).collect()
    }
}

/// One player, as far as everything else is concerned: a socket that sends to
/// the relayed address and expects its own words back.
struct FakePlayer {
    socket: UdpSocket,
}

impl FakePlayer {
    fn dialling(relayed: SocketAddr) -> FakePlayer {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).expect("a free loopback port");
        socket.connect(relayed).expect("a loopback address");
        FakePlayer { socket }
    }

    /// Send `what` and wait for the engine's echo of it to find its way back.
    fn round_trip(&self, what: &[u8]) {
        self.socket
            .set_read_timeout(Some(PATIENCE))
            .expect("a bound socket");
        self.socket.send(what).expect("the relay takes the packet");
        let mut buf = vec![0u8; 4096];
        let read = self
            .socket
            .recv(&mut buf)
            .expect("the echo comes back through the relay");
        assert_eq!(
            &buf[..read],
            what,
            "the reply reached the wrong player, so the agent lost track of whose socket is whose"
        );
    }

    /// Send to a different relayed address from now on, keeping the same
    /// socket.
    ///
    /// The same socket is the whole point. A rebuilt allocation is at a new
    /// address, so a player has to be told where to send, but their own source
    /// port does not change and so neither should the loopback socket the agent
    /// speaks to the engine on for them. In a real battle the new address
    /// reaches the players through the lobby (issue #2031). Here the test plays
    /// that part.
    fn redial(&self, relayed: SocketAddr) {
        self.socket.connect(relayed).expect("a loopback address");
    }

    /// Send `what` until the echo comes back, for a relay that has only just
    /// opened.
    ///
    /// [`FakePlayer::round_trip`] sends once, which is right when the
    /// permission is known to be in place because `allow_joiner` has returned.
    /// After a rebuild there is nothing to wait on: the agent says `relayOpen`
    /// and only then lets everybody through the new allocation, so a datagram
    /// sent the instant the address arrives is legitimately dropped by coturn
    /// for having no permission yet. Resending is what a player's engine does
    /// anyway, and it is the only honest way to wait for a permission the test
    /// cannot see being installed.
    fn round_trip_once_it_can(&self, what: &[u8]) {
        self.socket
            .set_read_timeout(Some(SILENCE))
            .expect("a bound socket");
        let deadline = std::time::Instant::now() + PATIENCE;
        let mut buf = vec![0u8; 4096];
        while std::time::Instant::now() < deadline {
            self.socket.send(what).expect("the relay takes the packet");
            if let Ok(read) = self.socket.recv(&mut buf) {
                assert_eq!(
                    &buf[..read],
                    what,
                    "the reply reached the wrong player, so the rebuilt relay lost track of \
                     whose socket is whose"
                );
                return;
            }
        }
        panic!(
            "nothing came back through the rebuilt relay within {} seconds, so a player who was \
             in the battle before it was rebuilt is no longer in it",
            PATIENCE.as_secs()
        );
    }

    /// Send `what` and assert nothing comes back, for a player the TURN server
    /// is supposed to be dropping.
    fn gets_nowhere(&self, what: &[u8], long_enough: Duration) {
        self.socket
            .set_read_timeout(Some(long_enough))
            .expect("a bound socket");
        self.socket.send(what).expect("the relay takes the packet");
        let mut buf = vec![0u8; 4096];
        assert!(
            self.socket.recv(&mut buf).is_err(),
            "a TURN server carried traffic from an address with no permission for it"
        );
    }
}

/// A port nothing is using, by asking the kernel for one and giving it back.
///
/// Racy in principle and settled in practice: the window is microseconds and
/// the alternative is picking a number and hoping.
fn free_udp_port() -> u16 {
    UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
        .expect("a free loopback port")
        .local_addr()
        .expect("a bound address")
        .port()
}
