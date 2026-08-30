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

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use coilbox_lobby_protocol::server::{line, parse_client_line, ClientCommand};
use coilbox_lobby_protocol::{
    command, default_battle_status, password_hash, BattleStatus, ChatKind, ClientStatus,
    LobbyState, LoginConfig, LoginMode, LoginPhase, StartRect,
};
use futures_util::{SinkExt, StreamExt};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri_plugin_coilbox_direct::room::{Room, RoomOptions, RoomStatus};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;
use tokio_util::codec::{Framed, LinesCodec};

use crate::conn::{spawn_connection, wait_until_ready, Outbound, Registry};
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
        registry.get(&self.key).map(|c| *c.phase.borrow())
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
        // No beacon: these tests are about the wire between a room and its
        // clients, and a room announcing itself would put real datagrams on the
        // developer's network every two seconds.
        advertise: false,
    })
    .await
    .expect("a free port")
}

/// The `OPENBATTLE` the host's client sends, as the battle room builds it.
fn open_battle_line() -> String {
    keyed_open_battle_line("*")
}

/// The same with a room password in the key slot, which is what the Host on LAN
/// form sends when its Password field has anything in it.
fn keyed_open_battle_line(key: &str) -> String {
    command::open_battle(
        0,
        0,
        key,
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

/// A host who typed a password gets a battle, and joiners are asked for it.
///
/// Issue #1587 read as though a keyed `OPENBATTLE` was being dropped somewhere
/// after the login, which nothing at the unit level could rule out. It is not:
/// the whole password path is here on a socket, from the host's line through to
/// a joiner refused for want of the password and let in with it.
#[tokio::test]
async fn a_passworded_room_opens_its_battle_and_asks_joiners_for_the_password() {
    let room = room("alice", false).await;
    let registry = Registry::default();

    let host = Client::connect(&registry, loopback(room.port()), "alice").await;
    host.wait_for_ready().await;
    host.send(keyed_open_battle_line("letmein"));
    wait_for_room(
        &room,
        |s| s.battle.is_some(),
        "the room to hold the passworded battle",
    )
    .await;
    wait_until(
        || host.state().current_battle == Some(1),
        "the host to be in their own passworded battle",
    )
    .await;
    assert!(host.state().battles[&1].passworded);

    // A joiner who brought no password is told there is one, and stays out.
    let joiner = Client::connect(&registry, loopback(room.port()), "bob").await;
    joiner.wait_for_ready().await;
    joiner.send(command::join_battle(1, None, Some("sp-bob")));
    wait_until(
        || {
            joiner
                .received()
                .contains(&"JOINBATTLEFAILED this room needs a password".to_string())
        },
        "the joiner to be told the room has a password",
    )
    .await;
    assert_eq!(joiner.state().current_battle, None);

    // And with it, in.
    joiner.send(command::join_battle(1, Some("letmein"), Some("sp-bob")));
    wait_until(
        || joiner.state().current_battle == Some(1),
        "the joiner to be in the battle with the password",
    )
    .await;

    room.stop("done").await;
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

/// A room with the battle open and one joiner already in it, which is where the
/// tests about what the host does next all start.
async fn hosted_battle_with_a_joiner(registry: &Registry) -> (Room, Client, Client) {
    let room = room("alice", false).await;
    let host = Client::connect(registry, loopback(room.port()), "alice").await;
    host.wait_for_ready().await;
    host.send(open_battle_line());
    wait_until(
        || host.state().current_battle == Some(1),
        "the host to be in its own battle",
    )
    .await;
    let joiner = Client::connect(registry, loopback(room.port()), "bob").await;
    joiner.wait_for_ready().await;
    joiner.send(command::join_battle(1, None, Some("s3cret")));
    wait_until(
        || joiner.state().current_battle == Some(1),
        "the joiner to be in the battle",
    )
    .await;
    (room, host, joiner)
}

/// The map and the game options the host picks reach everyone, whenever they
/// arrived.
///
/// The second half is the ordering the design turns on. `SETSCRIPTTAGS` names no
/// battle, so a client that has not yet been told it is in one files the tags
/// under nothing and drops them. The room therefore replays them after the join
/// acknowledgement rather than before, and only a real client folding a real
/// stream can show that it worked.
#[tokio::test]
async fn the_hosts_options_reach_joiners_whenever_they_arrived() {
    let registry = Registry::default();
    let (room, host, joiner) = hosted_battle_with_a_joiner(&registry).await;

    let mut tags = BTreeMap::new();
    tags.insert("game/startpostype".to_string(), "2".to_string());
    tags.insert("game/modoptions/startmetal".to_string(), "5000".to_string());
    for line in command::set_script_tags(&tags) {
        host.send(line);
    }
    host.send(command::update_battle_info(0, false, 1234, "Comet Catcher"));

    let has_the_options = |client: &Client| {
        let state = client.state();
        let battle = &state.battles[&1];
        battle.map == "Comet Catcher" && battle.script_tags == tags
    };
    wait_until(
        || has_the_options(&joiner),
        "the joiner to see the map and options the host set",
    )
    .await;

    // Somebody who turns up after all that gets the same room, not an empty one.
    let late = Client::connect(&registry, loopback(room.port()), "carol").await;
    late.wait_for_ready().await;
    late.send(command::join_battle(1, None, Some("sp-carol")));
    wait_until(
        || late.state().current_battle == Some(1),
        "the late joiner to be in the battle",
    )
    .await;
    wait_until(
        || has_the_options(&late),
        "the late joiner to be caught up on the map and options",
    )
    .await;

    room.stop("done").await;
}

/// The start boxes the host draws reach the joiner, and rubbing one out reaches
/// them too. Without this the joiner spawns where the host did not put them.
#[tokio::test]
async fn the_start_boxes_the_host_draws_reach_the_joiner() {
    let registry = Registry::default();
    let (room, host, joiner) = hosted_battle_with_a_joiner(&registry).await;

    host.send(command::add_start_rect(0, 0, 0, 60, 200));
    host.send(command::add_start_rect(1, 140, 0, 200, 200));
    wait_until(
        || joiner.state().battles[&1].start_rects.len() == 2,
        "the joiner to see both start boxes",
    )
    .await;
    assert_eq!(
        joiner.state().battles[&1].start_rects[&0],
        StartRect {
            left: 0,
            top: 0,
            right: 60,
            bottom: 200,
        }
    );

    host.send(command::remove_start_rect(1));
    wait_until(
        || {
            let state = joiner.state();
            let rects = &state.battles[&1].start_rects;
            rects.len() == 1 && rects.contains_key(&0)
        },
        "the joiner to lose the box the host rubbed out",
    )
    .await;

    room.stop("done").await;
}

/// A bot the host adds is a player in the start script, so the joiner has to hold
/// the same one: added, moved to another team, and taken away again.
#[tokio::test]
async fn a_bot_the_host_adds_reaches_the_joiner() {
    let registry = Registry::default();
    let (room, host, joiner) = hosted_battle_with_a_joiner(&registry).await;

    let seat = BattleStatus {
        mode: true,
        ally: 1,
        team_id: 2,
        ..default_battle_status()
    };
    host.send(command::add_bot("Scrapper", seat, 255, "NullAI"));
    wait_until(
        || joiner.state().battles[&1].bots.contains_key("Scrapper"),
        "the joiner to see the host's bot",
    )
    .await;
    let seen = joiner.state().battles[&1].bots["Scrapper"].clone();
    assert_eq!(seen.owner, "alice");
    assert_eq!(seen.ai_dll, "NullAI");
    assert_eq!(seen.battle_status, seat);
    assert_eq!(seen.team_color, 255);

    let moved = BattleStatus { ally: 0, ..seat };
    host.send(command::update_bot("Scrapper", moved, 65_280));
    wait_until(
        || {
            joiner.state().battles[&1]
                .bots
                .get("Scrapper")
                .is_some_and(|b| b.battle_status == moved && b.team_color == 65_280)
        },
        "the joiner to see the bot change teams",
    )
    .await;

    host.send(command::remove_bot("Scrapper"));
    wait_until(
        || joiner.state().battles[&1].bots.is_empty(),
        "the joiner to lose the bot the host removed",
    )
    .await;

    room.stop("done").await;
}

/// Battle chat carries both ways, and lands in the battle's own channel.
///
/// The room's `BATTLEOPENED` names that channel, and a client that never learned
/// it files chat under no channel at all, where the battle room cannot show it.
#[tokio::test]
async fn battle_chat_reaches_both_ends() {
    let registry = Registry::default();
    let (room, host, joiner) = hosted_battle_with_a_joiner(&registry).await;

    joiner.send(command::say_battle("is this the right map?"));
    wait_until(
        || {
            battle_chat(&host.state()).contains(&(
                "bob".to_string(),
                "is this the right map?".to_string(),
                ChatKind::SaidBattle,
            ))
        },
        "the host to hear the joiner",
    )
    .await;

    host.send(command::say_battle_ex("checks"));
    wait_until(
        || {
            battle_chat(&joiner.state()).contains(&(
                "alice".to_string(),
                "checks".to_string(),
                ChatKind::SaidEx,
            ))
        },
        "the joiner to hear the host",
    )
    .await;

    // Said in the battle's channel, which is the one the battle room reads.
    assert!(host.state().channels.contains_key("__battle__1"));

    room.stop("done").await;
}

/// Everything said in the battle channel, as sender, text and kind.
fn battle_chat(state: &LobbyState) -> Vec<(String, String, ChatKind)> {
    state
        .channels
        .get("__battle__1")
        .map(|c| {
            c.messages
                .iter()
                .map(|m| (m.from.clone(), m.text.clone(), m.kind))
                .collect()
        })
        .unwrap_or_default()
}

/// A joiner who does not have the map or the game says so, and the host sees it.
///
/// Nothing in a direct room serves content, and the beacon carries no hashes
/// (#1594), so the joiner's own sync bit is the only warning anyone gets. The
/// joiner sets it from what is on their disk and the room passes
/// `CLIENTBATTLESTATUS` through untouched, which is what puts "out of sync"
/// against their name on the host's roster while the joiner's own launch is
/// blocked with the reason (issue #1572).
#[tokio::test]
async fn a_joiner_without_the_content_reports_itself_out_of_sync() {
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

    // Bob has neither Red Comet nor the game the host named, so the room is
    // told 2, unsynced.
    let unsynced = BattleStatus {
        mode: true,
        sync: 2,
        ..default_battle_status()
    };
    joiner.send(command::my_battle_status(unsynced, 16_711_680));
    wait_until(
        || {
            host.state().battles[&1]
                .members
                .get("bob")
                .is_some_and(|m| m.battle_status.sync == 2)
        },
        "the host to see that bob is missing content",
    )
    .await;

    // The download lands and bob rescans, so the same bit clears without anyone
    // leaving the room.
    let synced = BattleStatus {
        sync: 1,
        ..unsynced
    };
    joiner.send(command::my_battle_status(synced, 16_711_680));
    wait_until(
        || {
            host.state().battles[&1]
                .members
                .get("bob")
                .is_some_and(|m| m.battle_status.sync == 1)
        },
        "the host to see bob catch up",
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

/// A refusal has to reach the joiner in words, and it has to hold. Being dropped
/// in silence is the one thing a room may never do, and a refusal somebody can
/// undo by asking again is not a refusal.
#[tokio::test]
async fn a_refused_join_is_told_why_and_cannot_be_asked_again() {
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

    // Asking again gets the same answer from the room, without the host being
    // asked a second time (issue #1599). Nothing on their prompt could have
    // ended it: kick lives in the roster and reaches only people already in the
    // battle.
    joiner.send(command::join_battle(1, None, Some("s3cret")));
    wait_until(
        || {
            joiner.received().contains(
                &"JOINBATTLEFAILED the host has already turned you away from this battle"
                    .to_string(),
            )
        },
        "the second ask to be refused by the room",
    )
    .await;
    assert_eq!(joiner.state().current_battle, None);
    tokio::time::sleep(LONG_ENOUGH_TO_HANG).await;
    assert_eq!(
        room.status().await.expect("still hosting").pending,
        Vec::<String>::new(),
        "a name the host has answered may not come back to their prompt"
    );

    // Weaker than a kick, on purpose. Being turned away from a game is not being
    // thrown off the machine, so the connection lives and the host still has a
    // kick for the case that calls for one.
    assert_eq!(joiner.phase(), Some(LoginPhase::Ready));
    wait_until(
        || host.state().users.contains_key("bob"),
        "the refused joiner to still be in the room",
    )
    .await;

    room.stop("done").await;
}

/// A kick, sent the way the battle room sends it, and held the way a kick has to
/// be held.
///
/// The whole of this path already existed and none of it had ever been on a
/// socket: the roster's kick button calls `mp_kick`, which puts
/// `KICKFROMBATTLE` on the host's loopback connection, and it is the room at the
/// other end that decides what a kick means. What is kicked is a *name*, so the
/// person holding it is thrown out, told why, and refused the moment they dial
/// back in, which is the only version of a kick worth having when reconnecting
/// takes a second.
#[tokio::test]
async fn a_kicked_joiner_is_told_why_and_cannot_come_back() {
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

    host.send(command::kick_from_battle("bob"));

    wait_until(
        || {
            joiner
                .received()
                .contains(&"SERVERMSG you were kicked from this room".to_string())
        },
        "the kicked joiner to be told why",
    )
    .await;
    // Out of the battle for everybody, and off the socket.
    wait_until(
        || !host.state().battles[&1].members.contains_key("bob"),
        "the host to see bob leave the battle",
    )
    .await;
    wait_until(|| joiner.phase().is_none(), "the kicked connection to end").await;

    // The reconnect a kick is only worth anything against. Refused at the login,
    // before the room has to decide anything about a battle.
    let again = Client::connect(&registry, loopback(room.port()), "bob").await;
    wait_until(
        || {
            again
                .received()
                .contains(&"DENIED you were kicked from this room".to_string())
        },
        "the returning bob to be refused by name",
    )
    .await;
    wait_until(|| again.phase().is_none(), "the refused connection to end").await;
    // The block is on the name, not on the socket it arrived on: a fresh
    // connection under another name still gets in.
    let renamed = Client::connect(&registry, loopback(room.port()), "bob2").await;
    renamed.wait_for_ready().await;

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
        advertise: false,
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
        advertise: false,
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

/// A server that finishes the login only when it is told to, and keeps every line
/// the client sent it.
///
/// The order in issue #1590 is decided by which of two things happens first, and
/// over loopback the login all but always wins, which is why the run where it
/// loses was so hard to see. Holding the last line of the handshake makes the
/// order the test's to choose rather than the scheduler's. The read loop keeps
/// running while it is held, so a line sent by a client that is not logged in yet
/// is recorded rather than missed.
async fn paused_login_server() -> (SocketAddr, Arc<Notify>, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("a free port");
    let addr = listener.local_addr().expect("a bound address");
    let release = Arc::new(Notify::new());
    let held = Arc::clone(&release);
    let sent: Arc<Mutex<Vec<String>>> = Arc::default();
    let heard = Arc::clone(&sent);
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
        let mut releasing = true;
        loop {
            let reply = tokio::select! {
                // `notify_one` leaves a permit behind, so a release that lands
                // between two polls of this branch is not lost.
                _ = held.notified(), if releasing => {
                    releasing = false;
                    line::login_info_end()
                }
                read = framed.next() => {
                    let Some(Ok(read)) = read else { return };
                    heard.lock().unwrap().push(read.clone());
                    match parse_client_line(&read) {
                        ClientCommand::ListCompFlags => line::comp_flags(&["u", "sp"]),
                        ClientCommand::Login { username, .. } => line::accepted(&username),
                        _ => continue,
                    }
                }
            };
            if framed.send(reply).await.is_err() {
                return;
            }
        }
    });
    (addr, release, sent)
}

/// The host's client opens its battle once it is logged in, not once it has a
/// socket (issue #1590).
///
/// `mp_connect` answers when the stream is up and the connection task is spawned,
/// so a host that starts a room and opens a battle in it in one breath used to be
/// racing its own handshake. It won nearly every time over loopback, and the run
/// where it lost left a room holding the host's socket, no battle in it, and
/// nothing said about either.
#[tokio::test]
async fn the_battle_line_waits_for_the_login_rather_than_racing_it() {
    let registry = Registry::default();
    let (addr, release, sent) = paused_login_server().await;
    let client = Client::connect(&registry, addr, "alice").await;

    // What the host's client does the moment its room is listening.
    let waiting = tokio::spawn({
        let registry = registry.clone();
        let key = client.key.clone();
        async move { wait_until_ready(&registry, &key, PATIENCE).await }
    });
    tokio::time::sleep(LONG_ENOUGH_TO_HANG).await;
    assert_eq!(
        client.phase(),
        Some(LoginPhase::StreamingState),
        "the login is deliberately unfinished at this point"
    );
    assert!(
        !waiting.is_finished(),
        "a connect that answers here answers before it is logged in, which is the bug"
    );

    release.notify_one();
    waiting
        .await
        .expect("the wait to finish")
        .expect("the login to land");
    assert_eq!(client.phase(), Some(LoginPhase::Ready));

    // And only now does the battle line go out, which is the whole point of
    // waiting: the server has to know who is asking.
    assert!(
        !sent
            .lock()
            .unwrap()
            .iter()
            .any(|l| l.starts_with("OPENBATTLE")),
        "nothing opened a battle before the wait answered"
    );
    client.send(open_battle_line());
    wait_until(
        || {
            sent.lock()
                .unwrap()
                .iter()
                .any(|l| l.starts_with("OPENBATTLE"))
        },
        "the battle line to reach the server",
    )
    .await;
}

/// A login that never finishes is a failure the host can read, rather than a wait
/// with no end.
///
/// There is no read timeout below this, so the wait is the only thing that can
/// end it. A room always sends `LOGININFOEND`. This is here because the host's
/// client dials a socket, and a socket is not always a room.
#[tokio::test]
async fn a_login_that_never_finishes_is_reported_rather_than_waited_on() {
    let registry = Registry::default();
    let stuck = Client::connect(&registry, handshake_server(true, false).await, "alice").await;

    let failure = wait_until_ready(&registry, &stuck.key, LONG_ENOUGH_TO_HANG)
        .await
        .expect_err("a login that never lands cannot be reported as ready");
    assert!(
        failure.contains("did not finish"),
        "the host has to be told what went wrong: {failure}"
    );
}

/// A room that refuses the login says so, and the wait carries the refusal rather
/// than sitting there until it times out.
#[tokio::test]
async fn a_refused_login_ends_the_wait_with_the_refusal() {
    let room = room("alice", false).await;
    let registry = Registry::default();

    let host = Client::connect(&registry, loopback(room.port()), "alice").await;
    host.wait_for_ready().await;
    // The room has one name and it is taken, which is the one refusal a room has.
    let twin = Client::connect(&registry, loopback(room.port()), "alice").await;
    let failure = wait_until_ready(&registry, &twin.key, PATIENCE)
        .await
        .expect_err("a refused login is not ready");
    assert!(
        failure.contains("refused"),
        "the refusal has to be what comes back: {failure}"
    );

    room.stop("done").await;
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

/// A lobby that refuses the address a relayed battle names and then opens the
/// battle anyway, writing both answers into one flush.
///
/// One flush is the point. The two lines then arrive in one read, the connection
/// task handles both before anything waiting on the battle is polled again, and
/// a refusal kept in a `watch` slot would be overwritten by the ack behind it.
/// A server that answered politely, one flush at a time, would never show that.
async fn a_lobby_that_refuses_the_relays_address(reason: &'static str) -> SocketAddr {
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
            // Matched on the command rather than parsed, because `RELAYEDHOST`
            // is a line this client sends and no server in this repo reads.
            if read.starts_with("RELAYEDHOST ") {
                if framed
                    .feed(format!("RELAYEDHOSTFAILED {reason}"))
                    .await
                    .is_err()
                {
                    return;
                }
                if framed.send("OPENBATTLE 9".to_string()).await.is_err() {
                    return;
                }
                continue;
            }
            let reply = match parse_client_line(&read) {
                ClientCommand::ListCompFlags => line::comp_flags(&["u", "sp", "r"]),
                ClientCommand::Login { username, .. } => {
                    if framed.send(line::accepted(&username)).await.is_err() {
                        return;
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

/// Issue #2064, through the real connection loop. A `RELAYEDHOSTFAILED` off the
/// wire has to reach two places, and the loop is the only thing that puts it in
/// either.
///
/// The note is what `advertise` reads to decide whether the battle it just
/// advertised is going through the relay. The delta is what the host is shown.
/// Neither is reachable from a unit test, because both are written in the middle
/// of the loop and the loop is private to this crate.
#[tokio::test]
async fn a_refused_relay_address_reaches_both_the_host_and_whoever_is_hosting() {
    const REASON: &str = "203.0.113.7 is this lobby server, not a relay";

    let registry = Registry::default();
    let client = Client::connect(
        &registry,
        a_lobby_that_refuses_the_relays_address(REASON).await,
        "alice",
    )
    .await;
    client.wait_for_ready().await;

    client.send("RELAYEDHOST 203.0.113.7 30001".to_string());

    let note = {
        let registry = registry.lock().unwrap();
        registry
            .get(&client.key)
            .expect("still connected")
            .relay_refused
            .clone()
    };
    wait_until(
        || crate::relay_host::refused_address(&note).is_some(),
        "the lobby's refusal to be written against the connection",
    )
    .await;
    assert_eq!(
        crate::relay_host::refused_address(&note).as_deref(),
        Some(REASON),
        "the ack that arrived in the same read must not have overwritten it"
    );

    // And the host is told, in the lobby's own words, whether or not anybody was
    // still waiting on the battle by the time it arrived.
    wait_until(
        || {
            client.events.lock().unwrap().iter().any(|e| {
                let event: serde_json::Value = serde_json::from_str(e).unwrap_or_default();
                event["delta"]["kind"] == "relayedHostRefused" && event["delta"]["reason"] == REASON
            })
        },
        "the refusal to reach the frontend as a delta",
    )
    .await;

    client.disconnect();
}

/// A lobby that refuses both of the lines a relay host sends about an address,
/// each with words of its own.
///
/// The two commands are told apart the way a real server tells them apart, by
/// reading the command and nothing else. `MOVERELAYEDHOST` is checked first
/// because it is the longer of the two, though neither is a prefix of the other
/// and that is the point of the pair of them (issue #2098).
async fn a_lobby_that_refuses_both_addresses(
    opening: &'static str,
    moving: &'static str,
) -> SocketAddr {
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
            let refusal = if read.starts_with("MOVERELAYEDHOST ") {
                format!("MOVERELAYEDHOSTFAILED {moving}")
            } else if read.starts_with("RELAYEDHOST ") {
                format!("RELAYEDHOSTFAILED {opening}")
            } else {
                match parse_client_line(&read) {
                    ClientCommand::ListCompFlags => line::comp_flags(&["u", "sp", "r"]),
                    ClientCommand::Login { username, .. } => {
                        if framed.send(line::accepted(&username)).await.is_err() {
                            return;
                        }
                        line::login_info_end()
                    }
                    _ => continue,
                }
            };
            if framed.send(refusal).await.is_err() {
                return;
            }
        }
    });
    addr
}

/// Issue #2098, through the real connection loop. A host whose relay came back
/// somewhere else asks the lobby to move the battle, and the lobby says no.
///
/// This is the refusal that matters most in relay hosting. The battle is
/// already open, quite possibly with a game running in it, and a refused move
/// leaves it advertised at an allocation that has gone. Nothing in coilbox is
/// waiting on the answer, because the rebuild that set the move off happened
/// while the host was busy elsewhere, so the delta below is the only way the
/// host ever finds out.
///
/// The refusal of the opening address is sent through the same connection to
/// show the two being told apart: one line each, one refusal each, neither read
/// as the other.
#[tokio::test]
async fn a_refused_move_and_a_refused_open_reach_the_host_as_different_things() {
    const OPENING: &str = "203.0.113.7 is this lobby server, not a relay";
    const MOVING: &str = "you are not hosting a battle to move";

    let registry = Registry::default();
    let client = Client::connect(
        &registry,
        a_lobby_that_refuses_both_addresses(OPENING, MOVING).await,
        "alice",
    )
    .await;
    client.wait_for_ready().await;

    client.send(command::relayed_host(
        "203.0.113.7".parse().expect("an address"),
        30001,
    ));
    client.send(command::move_relayed_host(
        "198.51.100.9".parse().expect("an address"),
        30002,
    ));

    let told = |kind: &'static str, reason: &'static str| {
        let events = Arc::clone(&client.events);
        move || {
            events.lock().unwrap().iter().any(|e| {
                let event: serde_json::Value = serde_json::from_str(e).unwrap_or_default();
                event["delta"]["kind"] == kind && event["delta"]["reason"] == reason
            })
        }
    };

    wait_until(
        told("relayedHostMoveRefused", MOVING),
        "the refusal to move the battle to reach the host",
    )
    .await;
    wait_until(
        told("relayedHostRefused", OPENING),
        "the refusal of the opening address to reach the host",
    )
    .await;
    // And neither refusal was raised as the other, which is what a server or a
    // client reading `MOVERELAYEDHOST` as a `RELAYEDHOST` would produce.
    assert!(
        !told("relayedHostRefused", MOVING)(),
        "a refused move is not a refused open"
    );
    assert!(
        !told("relayedHostMoveRefused", OPENING)(),
        "a refused open is not a refused move"
    );

    client.disconnect();
}

/// A lobby with somebody else's relayed battle in its list, which moves the
/// moment the client has finished logging in.
async fn a_lobby_whose_relayed_battle_moves(from: (&str, u16), to: (&str, u16)) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("a free port");
    let addr = listener.local_addr().expect("a bound address");
    let (from_ip, from_port) = (from.0.to_string(), from.1);
    let (to_ip, to_port) = (to.0.to_string(), to.1);
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
            match parse_client_line(&read) {
                ClientCommand::ListCompFlags => {
                    if framed
                        .send(line::comp_flags(&["u", "sp", "r"]))
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
                ClientCommand::Login { username, .. } => {
                    for out in [
                        line::accepted(&username),
                        line::login_info_end(),
                        line::battle_opened(&line::BattleOpened {
                            id: 9,
                            battle_type: 0,
                            nat_type: 0,
                            host: "bob".to_string(),
                            ip: from_ip.clone(),
                            port: from_port,
                            max_players: 8,
                            passworded: false,
                            rank: 0,
                            maphash: -1,
                            engine: "spring".to_string(),
                            version: "105".to_string(),
                            map: "Comet Catcher".to_string(),
                            title: "Theirs".to_string(),
                            modname: "BAR".to_string(),
                            channel: None,
                        }),
                        format!("BATTLEHOSTMOVED 9 {to_ip} {to_port}"),
                    ] {
                        if framed.send(out).await.is_err() {
                            return;
                        }
                    }
                }
                _ => continue,
            }
        }
    });
    addr
}

/// The half of issue #2098 that is about everybody who is not hosting. Bob's
/// relay comes back somewhere else, the lobby says so to everybody watching the
/// battle list, and this client's copy of the address moves with it.
///
/// Without it the row still looks joinable and the join goes to an allocation
/// that has gone, which is exactly what an old client does.
#[tokio::test]
async fn a_battle_somebody_else_moved_is_dialled_at_its_new_address() {
    let registry = Registry::default();
    let client = Client::connect(
        &registry,
        a_lobby_whose_relayed_battle_moves(("198.51.100.9", 30001), ("198.51.100.4", 30002)).await,
        "alice",
    )
    .await;
    client.wait_for_ready().await;

    wait_until(
        || {
            client
                .state()
                .battles
                .get(&9)
                .is_some_and(|b| b.ip == "198.51.100.4" && b.port == "30002")
        },
        "the moved battle to be dialled at the address the lobby moved it to",
    )
    .await;

    // And the battle is the same battle. Moving one is a change of address, not
    // a new room, so everybody in it stays in it.
    let battle = client
        .state()
        .battles
        .get(&9)
        .cloned()
        .expect("bob's battle");
    assert_eq!(battle.host, "bob");
    assert_eq!(battle.map, "Comet Catcher");

    client.disconnect();
}
