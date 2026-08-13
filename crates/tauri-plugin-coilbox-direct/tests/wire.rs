//! What a room puts on the socket, checked byte for byte, and what it does with
//! a socket that stops talking.
//!
//! The room is driven by the real lobby client in the multiplayer plugin's
//! `direct_loopback` tests, which is where every behaviour above the handshake is
//! proved. Two things are left over that no client can show, and both are here:
//! the exact bytes of the two lines a client hangs without, and the sweep that
//! drops a peer whose machine went to sleep.

use std::time::Duration;

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
        Some("DENIED that name is already in this room")
    );
    assert_eq!(second.next().await, None, "and then dropped");

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
