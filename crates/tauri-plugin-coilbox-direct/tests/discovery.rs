//! Discovery over real sockets: a beacon on the wire, two listeners on one
//! machine hearing it, a room announced over mDNS as well and still listed once,
//! and a room leaving the list when its beacons stop.
//!
//! The two listeners are the point. One process hearing its own datagram proves
//! almost nothing, because address reuse and multicast loopback are exactly what
//! a second coilbox on the same machine needs and exactly what is easy to get
//! wrong. Two sockets bound to one port, both hearing one beacon, is the same
//! shape as two people sharing a machine, and it is how LAN hosting can be
//! tested without a second machine.
//!
//! These bind the real beacon port and put real datagrams on the network, so
//! every test here names its own room, with a name new every run (see
//! [`named`]), and only ever asserts about that one. Otherwise they would see
//! each other's beacons, and a developer hosting a room, or a second run of this
//! suite anywhere on the network, would break them.

use std::time::Duration;

use coilbox_lobby_protocol::command;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;

use tauri_plugin_coilbox_direct::beacon::{
    encode, room_id, Beacon, LanRoom, Source, BEACON_EXPIRY, BEACON_INTERVAL,
};
use tauri_plugin_coilbox_direct::discovery::{announce_once, Discovery};
use tauri_plugin_coilbox_direct::room::{Room, RoomOptions};

/// Wait for `check` to be true, up to `within`. Answers false if it never is.
///
/// Beacons arrive when they arrive: a multicast datagram can be dropped, and a
/// test that slept for a fixed time would be either flaky or slow. This is the
/// polling a screen would do anyway.
async fn until(within: Duration, mut check: impl FnMut() -> bool) -> bool {
    let deadline = tokio::time::Instant::now() + within;
    while tokio::time::Instant::now() < deadline {
        if check() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    check()
}

/// One room out of everything the listener can hear, so a beacon from another
/// test, or from a room the developer is really hosting, is not this test's
/// business.
fn find(rooms: &[LanRoom], id: &str) -> Option<LanRoom> {
    rooms.iter().find(|room| room.id == id).cloned()
}

/// A room name for this run of this test and nothing else.
///
/// Naming a room in the source is not enough, because the datagrams go on the
/// real network and every other coilbox on it hears them. A second test run, on
/// this machine or on the next desk, announces the same rooms this one is
/// asserting about, and its beacons keep an entry alive that is supposed to be
/// ageing out (issue #1606). `room_id` is what a real room names itself with, so
/// a test run is as distinct from another run as two rooms are.
fn named(label: &str) -> String {
    format!("{label}-{}", room_id())
}

/// Wait for a room to leave the list, counting from the last beacon heard rather
/// than from the first.
///
/// One announce is not one datagram. It goes out of every interface, to the
/// group and to the broadcast address, and the copies arrive when they arrive:
/// about a second apart on an idle machine here, and several seconds apart while
/// a second test run has the CPU. Every copy is a fresh sighting that restarts
/// the room's expiry, so a fixed deadline made the test a race against its own
/// announce (issue #1606).
///
/// The room's `last_seen_ms` says when the newest beacon behind it landed, so
/// that is what the deadline hangs off. What is asserted is unchanged: an entry
/// outlives its last beacon by [`BEACON_EXPIRY`] and no longer. `CAP` only stops
/// a directory that never drops anything from looping forever.
async fn gone_after_the_last_beacon(rooms: impl Fn() -> Vec<LanRoom>, id: &str) -> bool {
    const SLACK: Duration = Duration::from_secs(3);
    const CAP: Duration = Duration::from_secs(60);
    let start = tokio::time::Instant::now();
    let mut last_beacon = start;
    while start.elapsed() < CAP {
        let now = tokio::time::Instant::now();
        match find(&rooms(), id) {
            None => return true,
            Some(room) => {
                let landed = now - Duration::from_millis(room.last_seen_ms);
                last_beacon = last_beacon.max(landed);
                if now > last_beacon + BEACON_EXPIRY + SLACK {
                    return false;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

fn beacon(id: &str) -> Beacon {
    Beacon {
        id: id.to_string(),
        title: "A room on this machine".to_string(),
        host: "alice".to_string(),
        game: "Beyond All Reason test-1234".to_string(),
        map: "Red Comet Remake 1.8".to_string(),
        players: 1,
        max_players: 8,
        port: 8200,
        passworded: false,
    }
}

/// Two coilboxes on one machine, both listening on the beacon port, both hearing
/// the same room. Without address reuse the second bind fails outright.
#[tokio::test(flavor = "multi_thread")]
async fn two_listeners_on_one_machine_both_hear_a_beacon() {
    let first = Discovery::start().expect("the beacon port binds");
    let second = Discovery::start().expect("the beacon port binds a second time");

    let id = named("two-listeners");
    let payload = encode(&beacon(&id)).into_bytes();
    // Twice, because the first datagram can go out before a group join has
    // settled. Which is also why a room announces itself every two seconds
    // rather than once.
    announce_once(&payload);
    tokio::time::sleep(Duration::from_millis(200)).await;
    announce_once(&payload);

    let heard_first = until(Duration::from_secs(5), || {
        find(&first.rooms(None), &id).is_some()
    })
    .await;
    let heard_second = until(Duration::from_secs(5), || {
        find(&second.rooms(None), &id).is_some()
    })
    .await;
    assert!(heard_first, "the first listener heard nothing");
    assert!(heard_second, "the second listener heard nothing");

    let room = find(&first.rooms(None), &id).expect("the room it just heard");
    assert_eq!(room.title, "A room on this machine");
    assert_eq!(room.game, "Beyond All Reason test-1234");
    assert_eq!(room.map, "Red Comet Remake 1.8");
    assert_eq!(room.players, 1);
    assert_eq!(room.max_players, 8);
    assert_eq!(room.port, 8200);
    assert!(!room.passworded);
    assert!(!room.is_self);
    // The address to dial is where the datagram came from, not anything the
    // payload claimed.
    assert!(
        !room.address.is_empty(),
        "a room with no address is a room nobody can join"
    );

    first.stop();
    second.stop();
}

/// A host is not a special case: it hears its own beacon back off the network,
/// and the list says which one is theirs rather than hiding it.
#[tokio::test(flavor = "multi_thread")]
async fn a_host_hears_its_own_room_and_can_tell() {
    let listening = Discovery::start().expect("the beacon port binds");
    let id = named("my-own-room");
    let payload = encode(&beacon(&id)).into_bytes();
    announce_once(&payload);
    tokio::time::sleep(Duration::from_millis(200)).await;
    announce_once(&payload);

    let heard = until(Duration::from_secs(5), || {
        find(&listening.rooms(Some(&id)), &id).is_some()
    })
    .await;
    assert!(heard, "the listener heard nothing");

    let ours = find(&listening.rooms(Some(&id)), &id).expect("our beacon");
    assert!(ours.is_self, "our own beacon has to be marked as ours");
    let theirs = find(&listening.rooms(Some("another-room")), &id).expect("our beacon");
    assert!(!theirs.is_self, "somebody else's beacon is not ours");

    listening.stop();
}

/// A host who closes the lid takes their room with them and nothing says so, so
/// the only thing that removes a room from the list is its beacons stopping.
#[tokio::test(flavor = "multi_thread")]
async fn a_room_that_stops_beaconing_leaves_the_list() {
    let listening = Discovery::start().expect("the beacon port binds");
    let id = named("gone-in-a-moment");
    let payload = encode(&beacon(&id)).into_bytes();
    announce_once(&payload);
    tokio::time::sleep(Duration::from_millis(200)).await;
    announce_once(&payload);

    assert!(
        until(Duration::from_secs(5), || find(&listening.rooms(None), &id)
            .is_some())
        .await,
        "the listener heard nothing"
    );

    // Nothing more is sent, so the entry has to age out on its own.
    let gone = gone_after_the_last_beacon(|| listening.rooms(None), &id).await;
    assert!(gone, "a room whose beacons stopped is still listed");

    listening.stop();
}

/// The whole chain with nothing faked: a real room, a real battle opened in it
/// over a real socket, and a listener that hears what it holds.
///
/// This is the test that keeps the beacon honest. Everything it says is read
/// from the room's own status, which is the same answer `direct_room_status`
/// gives the host's screen, so a beacon that drifts from the room fails here.
#[tokio::test(flavor = "multi_thread")]
async fn a_room_with_a_battle_in_it_announces_what_it_holds() {
    let listening = Discovery::start().expect("the beacon port binds");
    let room = Room::start(RoomOptions {
        host: "alice".to_string(),
        ip: "127.0.0.1".to_string(),
        port: 0,
        approve_joins: false,
        advertise: true,
    })
    .await
    .expect("a free port");

    // The host's own client, as far as the room is concerned: log in, then open
    // the battle. Lines the room sends back are left in the socket buffer, since
    // what is being checked is what the room then announces.
    let stream = TcpStream::connect(("127.0.0.1", room.port()))
        .await
        .expect("the room is listening");
    let (_read, mut write) = stream.into_split();
    for line in [
        "LOGIN alice aGFzaA== 0 127.0.0.1 Coilbox 0.1\t1\tu sp".to_string(),
        command::open_battle(
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
            "Red Comet Remake 1.8",
            "Tom's LAN game",
            "Beyond All Reason test-1234",
        ),
    ] {
        write
            .write_all(format!("{line}\n").as_bytes())
            .await
            .expect("the room is still there");
    }

    let announced = until(BEACON_INTERVAL * 3, || {
        find(&listening.rooms(None), room.beacon_id()).is_some()
    })
    .await;
    assert!(announced, "a room with a battle in it was never announced");

    let heard = find(&listening.rooms(None), room.beacon_id()).expect("the beacon");
    assert_eq!(heard.title, "Tom's LAN game");
    assert_eq!(heard.host, "alice");
    assert_eq!(heard.game, "Beyond All Reason test-1234");
    assert_eq!(heard.map, "Red Comet Remake 1.8");
    assert_eq!(heard.max_players, 16);
    assert_eq!(heard.players, 1, "the host is in their own battle");
    // The lobby port a joiner dials, not the engine's 8452 in the battle.
    assert_eq!(heard.port, room.port());
    assert!(heard.passworded, "the battle was opened with a key");
    // And the host can pick their own room out of the list.
    let ours = find(&listening.rooms(Some(room.beacon_id())), room.beacon_id()).expect("ours");
    assert!(ours.is_self);

    room.stop("done").await;
    listening.stop();
}

/// The second announcement, end to end and merged: a real room advertised as a
/// DNS-SD service, resolved by a real mDNS browse, and listed once.
///
/// The room is announced both ways at once, so the thing being proved is that
/// the two arrive as one entry rather than two, and that the mDNS half is
/// genuinely carrying it. `sources` is what shows both, and it is the only way to
/// tell from outside which half of the network worked.
///
/// Slower than the beacon tests by design. A beacon is pushed every two seconds
/// and a DNS-SD service has to be asked for: a browse query goes out, the
/// responder answers with the PTR, and the SRV, TXT and address records follow.
#[tokio::test(flavor = "multi_thread")]
async fn a_room_announced_both_ways_is_heard_both_ways_and_listed_once() {
    let listening = Discovery::start().expect("the beacon port binds");
    let room = Room::start(RoomOptions {
        host: "alice".to_string(),
        ip: "127.0.0.1".to_string(),
        port: 0,
        approve_joins: false,
        advertise: true,
    })
    .await
    .expect("a free port");

    let title = named("both-ways");
    let stream = TcpStream::connect(("127.0.0.1", room.port()))
        .await
        .expect("the room is listening");
    let (_read, mut write) = stream.into_split();
    for line in [
        "LOGIN alice aGFzaA== 0 127.0.0.1 Coilbox 0.1\t1\tu sp".to_string(),
        command::open_battle(
            0,
            0,
            "",
            8452,
            16,
            -1,
            0,
            -1,
            "spring",
            "105.1.1",
            "Red Comet Remake 1.8",
            &title,
            "Beyond All Reason test-1234",
        ),
    ] {
        write
            .write_all(format!("{line}\n").as_bytes())
            .await
            .expect("the room is still there");
    }

    let both = until(Duration::from_secs(30), || {
        find(&listening.rooms(None), room.beacon_id())
            .is_some_and(|heard| heard.sources.contains(&Source::Mdns))
    })
    .await;
    assert!(both, "the room was never resolved over mDNS");

    let heard = find(&listening.rooms(None), room.beacon_id()).expect("the room");
    assert_eq!(
        heard.sources,
        vec![Source::Beacon, Source::Mdns],
        "a room announced both ways has to be carried by both"
    );
    // One entry, not two. The room id in the TXT record is what ties the DNS-SD
    // service to the beacon, and without it this would be the same room twice.
    let listed = listening.rooms(None);
    assert_eq!(
        listed.iter().filter(|r| r.id == room.beacon_id()).count(),
        1,
        "the same room was listed twice"
    );
    // And the facts are the room's, whichever announcement carried them.
    assert_eq!(heard.title, title);
    assert_eq!(heard.map, "Red Comet Remake 1.8");
    assert_eq!(heard.port, room.port());
    assert!(!heard.address.is_empty());

    room.stop("done").await;
    listening.stop();
}

/// A room with nothing in it yet is not announced. Its beacon would carry no
/// game, no map and no name, and somebody joining it would find nothing to join.
#[tokio::test(flavor = "multi_thread")]
async fn a_room_with_no_battle_in_it_is_not_announced() {
    let listening = Discovery::start().expect("the beacon port binds");
    let room = Room::start(RoomOptions {
        host: "alice".to_string(),
        ip: "127.0.0.1".to_string(),
        // The OS picks the lobby port, so this never fights a room the developer
        // is hosting. The beacon port is fixed and shared, which is the point.
        port: 0,
        approve_joins: false,
        advertise: true,
    })
    .await
    .expect("a free port");

    tokio::time::sleep(BEACON_INTERVAL * 2 + Duration::from_millis(500)).await;
    assert!(
        find(&listening.rooms(None), room.beacon_id()).is_none(),
        "a room with no battle in it must not be announced"
    );

    room.stop("done").await;
    listening.stop();
}
