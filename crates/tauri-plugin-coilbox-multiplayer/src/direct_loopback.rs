//! This client, over a real socket, against a room the direct-hosting plugin is
//! listening for.
//!
//! Everything in the room's own crate is tested against a client the test wrote.
//! That cannot catch the failure this whole design turns on, because the failure
//! is in the client: [`crate::conn::run_loop`] has no read timeout and no idle
//! timeout, so a server that leaves out one line of the handshake does not fail,
//! it hangs, with nothing on screen to say so. Proving that needs the real loop,
//! and the real loop is private to this crate. So the test lives here and the
//! room is a dev dependency.
//!
//! Two servers appear below. [`Room`] is the real one. [`handshake_server`] is a
//! deliberately broken one, used to show what the missing line costs.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use coilbox_lobby_protocol::server::{line, parse_client_line, ClientCommand};
use coilbox_lobby_protocol::{
    command, default_battle_status, password_hash, BattleStatus, ClientStatus, LobbyState,
    LoginConfig, LoginMode, LoginPhase,
};
use futures_util::{SinkExt, StreamExt};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri_plugin_coilbox_direct::room::{Room, RoomOptions, RoomStatus};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::codec::{Framed, LinesCodec};

use crate::conn::{spawn_connection, Outbound, Registry};
use crate::dmlog::DmLog;

/// How long a test waits for something that should happen in milliseconds.
const PATIENCE: Duration = Duration::from_secs(5);

/// How long a test waits before believing something will never happen. Short,
/// because it is spent in full every time, and generous next to a handshake that
/// completes over loopback in single-figure milliseconds.
const LONG_ENOUGH_TO_HANG: Duration = Duration::from_millis(750);

/// One connected client, with everything the test needs to watch it.
struct Client {
    key: String,
    registry: Registry,
    /// Every event the connection has streamed, as the JSON the frontend would
    /// have received. The raw wire lines are in here too, as `console` events.
    events: Arc<Mutex<Vec<String>>>,
}

impl Client {
    /// Open a connection to `addr` and run the login handshake, exactly as
    /// `mp_connect` does.
    async fn connect(registry: &Registry, addr: SocketAddr, name: &str) -> Client {
        let stream = TcpStream::connect(addr)
            .await
            .expect("the server is listening");
        let events: Arc<Mutex<Vec<String>>> = Arc::default();
        let sink = Arc::clone(&events);
        let channel = Channel::new(move |body: InvokeResponseBody| {
            if let InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(json);
            }
            Ok(())
        });
        let key = format!("{name}@{addr}");
        // A directory nothing writes to unless the test sends named-channel
        // chat, and one the run leaves behind either way.
        let logs = std::env::temp_dir().join("coilbox-direct-loopback-tests");
        spawn_connection(
            registry.clone(),
            key.clone(),
            Box::new(stream),
            LoginConfig {
                username: name.to_string(),
                password_hash: password_hash("hunter2"),
                local_ip: "127.0.0.1".to_string(),
                agent: "Coilbox test".to_string(),
                client_id: "1".to_string(),
                compat_flags: vec!["u".to_string(), "sp".to_string()],
                use_stls: false,
                mode: LoginMode::Login,
            },
            channel,
            DmLog::new(&logs, &key),
            DmLog::new(&logs, &key),
        );
        Client {
            key,
            registry: registry.clone(),
            events,
        }
    }

    /// The login phase this connection has reached, or `None` once it has been
    /// torn down and evicted from the registry.
    fn phase(&self) -> Option<LoginPhase> {
        let registry = self.registry.lock().unwrap();
        registry.get(&self.key).map(|c| *c.phase.lock().unwrap())
    }

    /// The lobby state this client has folded for itself.
    fn state(&self) -> LobbyState {
        let registry = self.registry.lock().unwrap();
        // Bound rather than returned straight, so the inner guard is dropped
        // before the outer one it borrows from.
        let state = registry
            .get(&self.key)
            .expect("still connected")
            .state
            .lock()
            .unwrap()
            .clone();
        state
    }

    /// Send one wire line, as `mp_send` does.
    fn send(&self, line: String) {
        let registry = self.registry.lock().unwrap();
        registry
            .get(&self.key)
            .expect("still connected")
            .tx
            .send(Outbound::Line(line))
            .expect("the connection task is alive");
    }

    /// Log out politely, as `mp_disconnect` does.
    fn disconnect(&self) {
        let registry = self.registry.lock().unwrap();
        if let Some(conn) = registry.get(&self.key) {
            let _ = conn.tx.send(Outbound::Shutdown);
        }
    }

    /// Every line the room has sent this client so far.
    fn received(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| {
                let event: serde_json::Value = serde_json::from_str(e).ok()?;
                if event["kind"] != "console" || event["direction"] != "in" {
                    return None;
                }
                Some(event["line"].as_str()?.to_string())
            })
            .collect()
    }

    async fn wait_for_ready(&self) {
        wait_until(
            || self.phase() == Some(LoginPhase::Ready),
            &format!("{} to become ready", self.key),
        )
        .await;
    }
}

/// Poll `done` until it is true, or fail the test saying what never happened.
async fn wait_until(done: impl Fn() -> bool, what: &str) {
    let deadline = Instant::now() + PATIENCE;
    while Instant::now() < deadline {
        if done() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    panic!("timed out waiting for {what}");
}

/// The same, for what the room says about itself. Separate because reading a
/// room's status is a round trip to the task that owns it.
async fn wait_for_room(room: &Room, done: impl Fn(&RoomStatus) -> bool, what: &str) {
    let deadline = Instant::now() + PATIENCE;
    while Instant::now() < deadline {
        if room.status().await.as_ref().is_some_and(&done) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    panic!("timed out waiting for {what}");
}

/// The address the host's own client dials, which is the room's port on
/// loopback.
fn loopback(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port))
}

/// A room with nobody in it yet.
async fn room(host: &str, approve_joins: bool) -> Room {
    Room::start(RoomOptions {
        host: host.to_string(),
        ip: "127.0.0.1".to_string(),
        // Port 0 so the OS picks a free one: the tests run in parallel, and the
        // real default (8200) may well be a room the developer is hosting.
        port: 0,
        approve_joins,
    })
    .await
    .expect("a free port")
}

/// The `OPENBATTLE` the host's client sends, as the battle room builds it.
fn open_battle_line() -> String {
    command::open_battle(
        0,
        0,
        "*",
        8452,
        16,
        -1,
        0,
        -1,
        "spring",
        "105.1.1",
        "Red Comet",
        "Tom's LAN game",
        "Beyond All Reason test-1234",
    )
}

/// The whole point of the milestone: a joiner reaches a battle, over a socket,
/// with no lobby server anywhere.
#[tokio::test]
async fn a_joiner_reaches_the_hosts_battle_over_a_socket() {
    let room = room("alice", false).await;
    let registry = Registry::default();

    let host = Client::connect(&registry, loopback(room.port()), "alice").await;
    host.wait_for_ready().await;
    host.send(open_battle_line());
    wait_until(
        || host.state().current_battle == Some(1),
        "the host to be in its own battle",
    )
    .await;

    let joiner = Client::connect(&registry, loopback(room.port()), "bob").await;
    joiner.wait_for_ready().await;
    joiner.send(command::join_battle(1, None, Some("s3cret")));
    wait_until(
        || joiner.state().current_battle == Some(1),
        "the joiner to be in the battle",
    )
    .await;

    // Both clients hold the same room, built only from what the socket carried.
    let seen = joiner.state();
    let battle = &seen.battles[&1];
    assert_eq!(battle.host, "alice");
    assert_eq!(battle.map, "Red Comet");
    assert_eq!(battle.title, "Tom's LAN game");
    assert_eq!(battle.channel.as_deref(), Some("__battle__1"));
    wait_until(
        || joiner.state().battles[&1].members.len() == 2,
        "both members to be in the joiner's battle",
    )
    .await;
    assert!(seen.users.contains_key("alice"));

    // The host is told the joiner's script password and nobody else is, because
    // it is the host's start script that has to authenticate them.
    wait_until(
        || {
            host.state().battles[&1]
                .members
                .get("bob")
                .and_then(|m| m.script_password.clone())
                == Some("s3cret".to_string())
        },
        "the host to learn bob's script password",
    )
    .await;
    assert_eq!(
        joiner.state().battles[&1].members["bob"].script_password,
        None
    );

    room.stop("done").await;
}

/// There is no start message in the protocol. The host's ingame bit is it, and
/// the joiner's battle room launches the engine off the delta it produces.
#[tokio::test]
async fn the_hosts_ingame_bit_reaches_the_joiner() {
    let room = room("alice", false).await;
    let registry = Registry::default();

    let host = Client::connect(&registry, loopback(room.port()), "alice").await;
    host.wait_for_ready().await;
    host.send(open_battle_line());
    let joiner = Client::connect(&registry, loopback(room.port()), "bob").await;
    joiner.wait_for_ready().await;
    joiner.send(command::join_battle(1, None, Some("s3cret")));
    wait_until(
        || joiner.state().current_battle == Some(1),
        "the joiner to be in the battle",
    )
    .await;
    assert!(!joiner.state().users["alice"].status.ingame);

    host.send(command::my_status(ClientStatus {
        ingame: true,
        ..Default::default()
    }));

    wait_until(
        || joiner.state().users["alice"].status.ingame,
        "the joiner to see the host go ingame",
    )
    .await;

    room.stop("done").await;
}

/// A seat the joiner picks has to reach the host, or the start script gives them
/// the wrong team.
#[tokio::test]
async fn a_seat_the_joiner_picks_reaches_the_host() {
    let room = room("alice", false).await;
    let registry = Registry::default();

    let host = Client::connect(&registry, loopback(room.port()), "alice").await;
    host.wait_for_ready().await;
    host.send(open_battle_line());
    let joiner = Client::connect(&registry, loopback(room.port()), "bob").await;
    joiner.wait_for_ready().await;
    joiner.send(command::join_battle(1, None, Some("s3cret")));
    wait_until(
        || joiner.state().current_battle == Some(1),
        "the joiner to be in the battle",
    )
    .await;

    let seat = BattleStatus {
        mode: true,
        ally: 1,
        team_id: 1,
        ..default_battle_status()
    };
    joiner.send(command::my_battle_status(seat, 16_711_680));

    wait_until(
        || {
            host.state().battles[&1]
                .members
                .get("bob")
                .is_some_and(|m| m.battle_status == seat && m.team_color == 16_711_680)
        },
        "the host to see bob's seat",
    )
    .await;

    room.stop("done").await;
}

/// A joiner the host has to wave through waits, and the wait is invisible on the
/// wire: our own client answers `JOINBATTLEREQUEST` automatically, so the room
/// never sends one.
#[tokio::test]
async fn a_join_the_host_has_to_approve_waits_for_them() {
    let room = room("alice", true).await;
    let registry = Registry::default();

    let host = Client::connect(&registry, loopback(room.port()), "alice").await;
    host.wait_for_ready().await;
    host.send(open_battle_line());
    let joiner = Client::connect(&registry, loopback(room.port()), "bob").await;
    joiner.wait_for_ready().await;
    joiner.send(command::join_battle(1, None, Some("s3cret")));

    wait_for_room(
        &room,
        |s| s.pending == ["bob".to_string()],
        "the room to queue bob's join",
    )
    .await;
    tokio::time::sleep(LONG_ENOUGH_TO_HANG).await;
    assert_eq!(
        joiner.state().current_battle,
        None,
        "nothing may happen until the host answers"
    );
    assert!(
        !host
            .received()
            .iter()
            .any(|l| l.starts_with("JOINBATTLEREQUEST")),
        "asking on the wire would be auto-answered before the host saw it"
    );

    room.answer_join("bob", true, None);
    wait_until(
        || joiner.state().current_battle == Some(1),
        "the approved joiner to reach the battle",
    )
    .await;

    room.stop("done").await;
}

/// A refusal has to reach the joiner in words. Being dropped in silence is the
/// one thing a room may never do.
#[tokio::test]
async fn a_refused_join_is_told_why() {
    let room = room("alice", true).await;
    let registry = Registry::default();

    let host = Client::connect(&registry, loopback(room.port()), "alice").await;
    host.wait_for_ready().await;
    host.send(open_battle_line());
    let joiner = Client::connect(&registry, loopback(room.port()), "bob").await;
    joiner.wait_for_ready().await;
    joiner.send(command::join_battle(1, None, Some("s3cret")));
    wait_for_room(
        &room,
        |s| s.pending == ["bob".to_string()],
        "the room to queue bob's join",
    )
    .await;

    room.answer_join("bob", false, Some("this is a private game".to_string()));

    wait_until(
        || {
            joiner
                .received()
                .contains(&"JOINBATTLEFAILED this is a private game".to_string())
        },
        "the joiner to be told why",
    )
    .await;
    assert_eq!(joiner.state().current_battle, None);

    room.stop("done").await;
}

/// A client that leaves has to be forgotten by the room, or its name blocks the
/// person who owns it from ever coming back.
#[tokio::test]
async fn a_client_that_leaves_is_forgotten() {
    let room = room("alice", false).await;
    let registry = Registry::default();

    let host = Client::connect(&registry, loopback(room.port()), "alice").await;
    host.wait_for_ready().await;
    host.send(open_battle_line());
    let joiner = Client::connect(&registry, loopback(room.port()), "bob").await;
    joiner.wait_for_ready().await;
    joiner.send(command::join_battle(1, None, Some("s3cret")));
    wait_until(
        || host.state().battles[&1].members.len() == 2,
        "bob to be in the host's battle",
    )
    .await;

    joiner.disconnect();

    wait_until(
        || !host.state().users.contains_key("bob"),
        "the room to drop bob from the roster",
    )
    .await;
    assert!(!host.state().battles[&1].members.contains_key("bob"));
    wait_for_room(&room, |s| s.peers == 1, "the room to close bob's socket").await;

    // And the name is free again, which is the whole reason this matters.
    let again = Client::connect(&registry, loopback(room.port()), "bob").await;
    again.wait_for_ready().await;

    room.stop("done").await;
}

/// The reclaim, over a socket, against the real client.
///
/// This is the one that a unit test cannot settle. The client's connection task
/// answers `REQUESTBATTLESTATUS` by itself, out of whatever it has folded so far,
/// and a client that has just reconnected has folded nothing. So a room that both
/// hands the seat back and asks for one gets the spectator default back and
/// overwrites what it just gave, unless the two lines happen to be in the right
/// order. Which line lands last is not a thing a unit test can see.
#[tokio::test]
async fn a_dropped_joiner_reconnects_into_the_seat_they_had() {
    let room = room("alice", false).await;
    let registry = Registry::default();

    let host = Client::connect(&registry, loopback(room.port()), "alice").await;
    host.wait_for_ready().await;
    host.send(open_battle_line());
    let joiner = Client::connect(&registry, loopback(room.port()), "bob").await;
    joiner.wait_for_ready().await;
    joiner.send(command::join_battle(1, None, Some("s3cret")));
    wait_until(
        || joiner.state().current_battle == Some(1),
        "the joiner to be in the battle",
    )
    .await;

    let seat = BattleStatus {
        mode: true,
        ally: 2,
        team_id: 3,
        ..default_battle_status()
    };
    joiner.send(command::my_battle_status(seat, 16_711_680));
    wait_until(
        || {
            host.state().battles[&1]
                .members
                .get("bob")
                .is_some_and(|m| m.battle_status == seat)
        },
        "the host to see bob's seat",
    )
    .await;

    // The drop, and the room forgetting the socket it happened on.
    joiner.disconnect();
    wait_for_room(&room, |s| s.peers == 1, "the room to lose bob's socket").await;

    let again = Client::connect(&registry, loopback(room.port()), "bob").await;
    again.wait_for_ready().await;
    again.send(command::join_battle(1, None, Some("fresh-sp")));
    wait_until(
        || again.state().current_battle == Some(1),
        "the returning joiner to be back in the battle",
    )
    .await;

    // Their own room draws the seat they left with, and so does everybody
    // else's. Give the client's own answer to a prompt time to arrive and undo
    // it, if the room were to send one.
    tokio::time::sleep(LONG_ENOUGH_TO_HANG).await;
    for (who, client) in [("the returning joiner", &again), ("the host", &host)] {
        let me = client.state().battles[&1].members["bob"].clone();
        assert_eq!(me.battle_status, seat, "{who} lost bob's seat");
        assert_eq!(me.team_color, 16_711_680, "{who} lost bob's colour");
    }
    assert!(
        !again
            .received()
            .contains(&"REQUESTBATTLESTATUS".to_string()),
        "a prompt here is answered with the default and undoes the reclaim"
    );
    // The host gets the script password the new socket arrived with, because it
    // is that socket the start script has to let in.
    assert_eq!(
        host.state().battles[&1].members["bob"]
            .script_password
            .as_deref(),
        Some("fresh-sp")
    );

    room.stop("done").await;
}

/// A name in use is refused, and the refusal carries a name that is not, because
/// there is no account system here to fall back on and no host watching to ask.
#[tokio::test]
async fn a_name_already_here_is_refused_with_one_that_is_free() {
    let room = room("alice", false).await;
    let registry = Registry::default();

    let host = Client::connect(&registry, loopback(room.port()), "alice").await;
    host.wait_for_ready().await;

    let twin = Client::connect(&registry, loopback(room.port()), "alice").await;
    wait_until(
        || {
            twin.received()
                .iter()
                .any(|l| l.starts_with("DENIED that name is already in this room"))
        },
        "the second alice to be refused",
    )
    .await;
    assert!(
        twin.received()
            .contains(&"DENIED that name is already in this room, try alice2".to_string()),
        "the refusal has to name a free one: {:?}",
        twin.received()
    );
    // Refused and dropped, which is what puts the reason on the login form
    // rather than leaving a socket open that can do nothing.
    wait_until(|| twin.phase().is_none(), "the refused connection to end").await;
    // And the suggestion works, which is the whole point of making one.
    let renamed = Client::connect(&registry, loopback(room.port()), "alice2").await;
    renamed.wait_for_ready().await;

    room.stop("done").await;
}

/// The friend and ignore lists our client fires unprompted on login are commands
/// a room has no answer for. Answering `FAILED cmd=...` would pop a toast at
/// somebody who did nothing wrong, so the room says nothing at all.
#[tokio::test]
async fn commands_the_room_has_no_answer_for_get_no_answer() {
    let room = room("alice", false).await;
    let registry = Registry::default();

    let client = Client::connect(&registry, loopback(room.port()), "alice").await;
    client.wait_for_ready().await;
    let settled = client.received().len();

    for line in [
        "FRIENDLIST",
        "IGNORELIST",
        "CHANNELS",
        "FROBNICATE the gizmo",
    ] {
        client.send(line.to_string());
    }
    tokio::time::sleep(LONG_ENOUGH_TO_HANG).await;

    assert_eq!(
        client.received().len(),
        settled,
        "the room replied to something it should have ignored: {:?}",
        &client.received()[settled..]
    );
    assert_eq!(client.phase(), Some(LoginPhase::Ready));

    room.stop("done").await;
}

/// A room that stops says why before it goes. A joiner whose socket simply died
/// is left looking at a battle that no longer exists.
#[tokio::test]
async fn stopping_a_room_names_the_reason() {
    let room = room("alice", false).await;
    let registry = Registry::default();

    let client = Client::connect(&registry, loopback(room.port()), "alice").await;
    client.wait_for_ready().await;

    room.stop("the host stopped hosting this room").await;

    wait_until(
        || {
            client
                .received()
                .contains(&"SERVERMSG the host stopped hosting this room".to_string())
        },
        "the client to be told why the room closed",
    )
    .await;
    // And then dropped: the connection task evicts itself from the registry when
    // the socket ends.
    wait_until(|| client.phase().is_none(), "the connection to end").await;
}

/// The port a host cannot have is the one they are already using, and a room
/// that has stopped has to hand it back.
#[tokio::test]
async fn a_port_in_use_is_refused_and_freed_again() {
    let first = room("alice", false).await;
    let port = first.port();

    let clash = Room::start(RoomOptions {
        host: "alice".to_string(),
        ip: "127.0.0.1".to_string(),
        port,
        approve_joins: false,
    })
    .await;
    let message = clash.err().expect("the second room cannot have the port");
    assert!(
        message.contains(&port.to_string()),
        "the refusal has to name the port: {message}"
    );

    first.stop("done").await;

    // Free the moment `stop` returns, so a host who stops and starts again is
    // not told the port is taken by the room they just closed.
    let again = Room::start(RoomOptions {
        host: "alice".to_string(),
        ip: "127.0.0.1".to_string(),
        port,
        approve_joins: false,
    })
    .await
    .expect("the port is free again");
    again.stop("done").await;
}

/// A server that runs as much of the handshake as it is told to.
///
/// Not a mock of the room: the room is real elsewhere in this file. This exists
/// to answer "what happens if a line is missing", which is the question the
/// whole handshake turns on and which a correct server cannot be asked.
async fn handshake_server(comp_flags: bool, login_info_end: bool) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("a free port");
    let addr = listener.local_addr().expect("a bound address");
    tokio::spawn(async move {
        let Ok((stream, _)) = listener.accept().await else {
            return;
        };
        let mut framed = Framed::new(stream, LinesCodec::new());
        if framed
            .send(line::tas_server("0.38", "*", 8452, 0))
            .await
            .is_err()
        {
            return;
        }
        while let Some(Ok(read)) = framed.next().await {
            let reply = match parse_client_line(&read) {
                ClientCommand::ListCompFlags if comp_flags => line::comp_flags(&["u", "sp"]),
                ClientCommand::Login { username, .. } => {
                    if framed.send(line::accepted(&username)).await.is_err() {
                        return;
                    }
                    if !login_info_end {
                        continue;
                    }
                    line::login_info_end()
                }
                _ => continue,
            };
            if framed.send(reply).await.is_err() {
                return;
            }
        }
    });
    addr
}

/// The risk this whole design rests on, shown rather than asserted.
///
/// `run_loop` has no read timeout and no idle timeout. A server that leaves out
/// `COMPFLAGS` or `LOGININFOEND` does not produce an error the joiner can show:
/// the joiner sits in the phase before it, forever, with a live socket and a
/// spinner. Nothing in the client will ever break that, which is why the room's
/// two most boring lines are the two that matter most.
#[tokio::test]
async fn a_handshake_missing_a_line_hangs_the_client_with_no_error() {
    let registry = Registry::default();

    let whole = Client::connect(&registry, handshake_server(true, true).await, "alice").await;
    whole.wait_for_ready().await;

    let no_flags = Client::connect(&registry, handshake_server(false, true).await, "bob").await;
    let no_end = Client::connect(&registry, handshake_server(true, false).await, "carol").await;
    tokio::time::sleep(LONG_ENOUGH_TO_HANG).await;

    // Parked one step short, with no error, no denial and no disconnect. The
    // socket is open and the client is still waiting on it.
    assert_eq!(no_flags.phase(), Some(LoginPhase::AwaitCompFlags));
    assert_eq!(no_end.phase(), Some(LoginPhase::StreamingState));
    for stuck in [&no_flags, &no_end] {
        assert!(
            !stuck.events.lock().unwrap().iter().any(|e| {
                let event: serde_json::Value = serde_json::from_str(e).unwrap_or_default();
                event["kind"] == "disconnected"
            }),
            "a hung client is never told anything, which is the problem"
        );
    }
}
