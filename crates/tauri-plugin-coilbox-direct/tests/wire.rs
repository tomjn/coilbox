//! What a room puts on the socket, checked byte for byte, and what it does with
//! a socket that stops talking.
//!
//! The room is driven by the real lobby client in the multiplayer plugin's
//! `direct_loopback` tests, which is where every behaviour above the handshake is
//! proved. Two things are left over that no client can show, and both are here:
//! the exact bytes of the two lines a client hangs without, and the sweep that
//! drops a peer whose machine went to sleep.

use std::time::Duration;

use coilbox_lobby_protocol::{command, default_battle_status, BattleStatus};
use tauri_plugin_coilbox_direct::room::{Room, RoomOptions};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;

/// A room on a port the OS picked, so the tests never fight each other or a room
/// the developer is running.
async fn room() -> Room {
    Room::start(RoomOptions {
        host: "alice".to_string(),
        ip: "192.168.0.5".to_string(),
        port: 0,
        approve_joins: false,
    })
    .await
    .expect("a free port")
}

/// A socket that reads and writes lines, and nothing more. Deliberately not the
/// lobby client: this test is about what is on the wire, not what a client makes
/// of it.
struct RawPeer {
    lines: tokio::io::Lines<BufReader<tokio::net::tcp::OwnedReadHalf>>,
    write: tokio::net::tcp::OwnedWriteHalf,
}

impl RawPeer {
    async fn connect(room: &Room) -> RawPeer {
        let stream = TcpStream::connect(("127.0.0.1", room.port()))
            .await
            .expect("the room is listening");
        let (read, write) = stream.into_split();
        RawPeer {
            lines: BufReader::new(read).lines(),
            write,
        }
    }

    async fn send(&mut self, line: &str) {
        self.write
            .write_all(format!("{line}\n").as_bytes())
            .await
            .expect("the room is still there");
    }

    /// The next line, or `None` if the room closed the connection first.
    async fn next(&mut self) -> Option<String> {
        self.lines.next_line().await.expect("a readable socket")
    }

    /// Read until a line starts with `prefix`, answering with every line read,
    /// that one last. Panics if the socket ends first, because a room that stops
    /// talking mid-exchange is the failure these tests exist to catch.
    async fn read_to(&mut self, prefix: &str) -> Vec<String> {
        let mut seen = Vec::new();
        while let Some(line) = self.next().await {
            let done = line.starts_with(prefix);
            seen.push(line);
            if done {
                return seen;
            }
        }
        panic!("the socket ended before {prefix}: {seen:?}");
    }

    /// Log in and read the burst that follows, so the peer is ready to be told
    /// about a battle.
    async fn log_in(&mut self, name: &str) -> Vec<String> {
        self.next().await.expect("a greeting");
        self.send(&format!(
            "LOGIN {name} aGFzaA== 0 127.0.0.1 Coilbox 0.1\t1\tu sp"
        ))
        .await;
        self.read_to("LOGININFOEND").await
    }
}

/// The two lines the whole design rests on, as bytes.
///
/// A greeting with any arity but four parses as an unknown line and the client's
/// login machine never starts. `COMPFLAGS` is what it is waiting for next, and
/// there is no timeout behind either of them.
#[tokio::test]
async fn the_handshake_lines_are_exactly_what_the_client_parses() {
    let room = room().await;
    let mut peer = RawPeer::connect(&room).await;

    let greeting = peer.next().await.expect("a greeting");
    assert_eq!(greeting, "TASSERVER 0.38 * 8452 0");
    assert_eq!(greeting.split(' ').count(), 5, "exactly four fields");

    peer.send("LISTCOMPFLAGS").await;
    assert_eq!(peer.next().await.as_deref(), Some("COMPFLAGS u sp"));

    peer.send("LOGIN alice aGFzaA== 0 127.0.0.1 Coilbox 0.1\t1\tu sp")
        .await;
    assert_eq!(peer.next().await.as_deref(), Some("ACCEPTED alice"));

    // The rest of the login burst, ending in the one line that makes a client
    // ready. Nothing else does, and there is nothing to fall back on.
    let mut burst = Vec::new();
    while let Some(line) = peer.next().await {
        let done = line == "LOGININFOEND";
        burst.push(line);
        if done {
            break;
        }
    }
    assert_eq!(burst.last().map(String::as_str), Some("LOGININFOEND"));
    assert!(burst.contains(&"ADDUSER alice ?? 1 Coilbox 0.1".to_string()));

    room.stop("done").await;
}

/// An `OPENBATTLE` that overtakes its own login is answered on the socket.
///
/// Over loopback the login lands first almost every time, which is what made this
/// so hard to see: the one run where it does not leaves the room holding a socket,
/// no battle, and a host reading an empty battle list with nothing said to them
/// (issue #1587). A raw peer can put the two lines in that order on purpose, which
/// a client cannot, so the room's answer is checked here rather than through one.
#[tokio::test]
async fn a_battle_command_that_overtakes_its_login_is_answered() {
    let room = room().await;
    let mut peer = RawPeer::connect(&room).await;
    peer.next().await.expect("a greeting");

    peer.send(&command::open_battle(
        0,
        0,
        "letmein",
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
    ))
    .await;
    // Bounded, because the failure being guarded against is silence, and an
    // unbounded read of a room that has nothing to say never returns.
    let answer = tokio::time::timeout(Duration::from_secs(5), peer.next())
        .await
        .expect("the room to answer rather than say nothing");
    assert_eq!(
        answer.as_deref(),
        Some("OPENBATTLEFAILED you are not logged in yet")
    );
    assert!(
        room.status().await.is_some_and(|s| s.battle.is_none()),
        "and no battle was opened by it"
    );

    room.stop("done").await;
}

/// A room a joiner cannot reach is worse than no room, so a refusal has to be a
/// line and not a closed socket.
#[tokio::test]
async fn a_refused_login_is_told_why_before_it_is_dropped() {
    let room = room().await;
    let mut first = RawPeer::connect(&room).await;
    first.next().await;
    first
        .send("LOGIN alice aGFzaA== 0 127.0.0.1 Coilbox 0.1\t1\tu sp")
        .await;

    let mut second = RawPeer::connect(&room).await;
    second.next().await;
    second
        .send("LOGIN alice aGFzaA== 0 127.0.0.1 Coilbox 0.1\t2\tu sp")
        .await;

    assert_eq!(
        second.next().await.as_deref(),
        Some("DENIED that name is already in this room, try alice2")
    );
    assert_eq!(second.next().await, None, "and then dropped");

    room.stop("done").await;
}

/// The sweep and the reclaim, against each other, on one clock.
///
/// The sweep exists to free a name whose socket died quietly, so its owner can
/// log back in under it. A seat is remembered by name and not by socket, so the
/// sweep taking the socket away cannot take the seat with it. This is that claim,
/// with the ninety seconds actually elapsing.
#[tokio::test]
async fn the_sweep_frees_a_name_and_leaves_the_seat_alone() {
    let room = room().await;
    let mut host = RawPeer::connect(&room).await;
    host.log_in("alice").await;
    host.send(&command::open_battle(
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
    ))
    .await;
    host.read_to("REQUESTBATTLESTATUS").await;

    let seat = BattleStatus {
        mode: true,
        ally: 2,
        team_id: 3,
        ..default_battle_status()
    };
    let taken = format!("CLIENTBATTLESTATUS bob {} 16711680", seat.to_int());
    let mut bob = RawPeer::connect(&room).await;
    bob.log_in("bob").await;
    bob.send("JOINBATTLE 1 * s3cret").await;
    bob.read_to("REQUESTBATTLESTATUS").await;
    bob.send(&command::my_battle_status(seat, 16_711_680)).await;
    assert_eq!(bob.read_to("CLIENTBATTLESTATUS").await.last(), Some(&taken));

    // Bob's machine goes to sleep. The host keeps talking on its own timer, as
    // the real client's thirty second keepalive does, or the sweep would take the
    // host too and close the battle out from under the test.
    //
    // The clock is paused from here, so the ninety seconds pass in no time. Time
    // auto-advances to the next timer whenever the runtime is idle, which is why
    // the host's keepalive has to be a timer and not a line this test sends: a
    // socket read is not a timer, and the clock would jump straight past it.
    tokio::time::pause();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            host.send("PING keepalive").await;
        }
    });
    assert_eq!(bob.next().await, None, "bob's socket is swept");
    assert_eq!(room.status().await.map(|s| s.peers), Some(1));

    // The name is free, which is what the sweep is for, and the seat is still
    // his, which is what it must not cost.
    let mut again = RawPeer::connect(&room).await;
    let burst = again.log_in("bob").await;
    assert!(burst.contains(&"ACCEPTED bob".to_string()), "{burst:?}");
    again.send("JOINBATTLE 1 * fresh-sp").await;
    let joined = again.read_to("CLIENTBATTLESTATUS bob").await;
    assert_eq!(joined.last(), Some(&taken));
    assert!(
        !joined.contains(&"REQUESTBATTLESTATUS".to_string()),
        "asking is answered with the default and undoes the reclaim: {joined:?}"
    );

    room.stop("done").await;
}

/// A closed laptop lid leaves a live TCP connection behind. Nothing in TCP will
/// mention it for hours, and the name on that connection is one its owner cannot
/// reconnect under. So a peer that has said nothing for three of the client's
/// own keepalives is treated as gone.
///
/// The runtime's clock is paused, so the ninety seconds pass in no time at all.
#[tokio::test(start_paused = true)]
async fn a_peer_that_stops_talking_is_dropped() {
    let room = room().await;
    let mut peer = RawPeer::connect(&room).await;
    peer.next().await.expect("a greeting");
    assert_eq!(room.status().await.map(|s| s.peers), Some(1));

    // Three times over, so nothing here turns on the exact moment the sweep
    // happens to fall. That a peer inside the timeout is left alone is the
    // `idle_peers` unit test's job.
    tokio::time::sleep(Duration::from_secs(270)).await;

    assert_eq!(room.status().await.map(|s| s.peers), Some(0));
    assert_eq!(peer.next().await, None, "and the socket is closed");

    room.stop("done").await;
}

/// Whatever a peer sends, the room may not stop answering the others.
#[tokio::test]
async fn a_line_the_room_cannot_read_is_ignored_rather_than_fatal() {
    let room = room().await;
    let mut peer = RawPeer::connect(&room).await;
    peer.next().await.expect("a greeting");

    for nonsense in [
        "FROBNICATE the gizmo",
        "MYSTATUS",
        "OPENBATTLE 0 0 * 8452",
        "",
    ] {
        peer.send(nonsense).await;
    }
    // Still listening, and still answering the one thing it does understand.
    peer.send("LISTCOMPFLAGS").await;
    assert_eq!(peer.next().await.as_deref(), Some("COMPFLAGS u sp"));

    room.stop("done").await;
}
