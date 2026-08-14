//! What a room says about itself on the local network, and what a listener makes
//! of what it hears.
//!
//! Pure: no sockets. [`crate::discovery`] carries these bytes.
//!
//! # The payload
//!
//! One datagram, one line of text:
//!
//! ```text
//! coilbox-room/1 {"id":"3f...","title":"Tom's room","host":"tom",...}
//! ```
//!
//! The magic and the version are outside the JSON on purpose. A listener decides
//! whether a beacon is even meant for it before it parses anything, and somebody
//! reading a packet capture can see what this is without decoding it.
//!
//! # Living with a version it does not know
//!
//! A beacon from a newer coilbox will reach an older one, on the same LAN, on the
//! same group, and there is no handshake to negotiate anything away. So:
//!
//! - Adding a field keeps the version at 1. Every field decodes with a default,
//!   so an old listener reads a new beacon and simply does not see the new field.
//! - The version only moves when an existing field stops meaning what it meant,
//!   which is the one case where an old listener reading a new beacon would be
//!   worse than an old listener ignoring it. An unknown version is dropped in
//!   silence, so the room is invisible rather than wrong.
//!
//! # What is not in it
//!
//! The address a joiner dials. That is the source address of the datagram, which
//! is right for the interface it arrived on and cannot be right in the payload:
//! a host with a LAN and a VPN has two addresses, and only the receiver knows
//! which one reached it.

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::room::RoomStatus;

/// The payload generation. See the module docs: additive changes leave this
/// alone, and a change of meaning moves it.
pub const BEACON_VERSION: u32 = 1;

/// What every beacon starts with, version and all.
pub const BEACON_MAGIC: &str = "coilbox-room/";

/// The group rooms announce themselves on.
///
/// 239.255.0.0/16 is the IPv4 Local Scope of RFC 2365, the block set aside for
/// exactly this: a router will not carry it off the network it was sent on. The
/// last two octets spell the port, so one line of a packet capture identifies
/// the whole thing.
pub const BEACON_GROUP: Ipv4Addr = Ipv4Addr::new(239, 255, 8, 250);

/// The UDP port beacons are sent to and listened for.
///
/// Clear of everything this app already talks to: the lobby port a room listens
/// on is TCP 8200, BAR's TASServer takes 8201 for its TLS port, and the engine
/// binds UDP 8452 for the game itself and counts upwards from there for further
/// hosts. 8250 sits outside all three and is not an IANA assignment.
pub const BEACON_PORT: u16 = 8250;

/// How often a hosting room announces itself.
pub const BEACON_INTERVAL: Duration = Duration::from_secs(2);

/// How long a room stays in the list after its last beacon.
///
/// Three missed beacons plus a second of slack. Long enough that one dropped
/// datagram, which is the normal case for multicast, does not make a room flicker
/// out of the list, short enough that a host who quits is gone before anybody
/// tries to join them.
pub const BEACON_EXPIRY: Duration = Duration::from_secs(7);

/// A room announcing itself, as it goes on the wire.
///
/// `serde(default)` on the whole struct is the forward compatibility rule of the
/// module docs made real: a field this build has never heard of is ignored, and a
/// field a newer build stopped sending decodes as a default rather than throwing
/// the beacon away.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Beacon {
    /// Names this room for as long as it runs, so a host can tell its own beacon
    /// from everybody else's and a listener can update a room rather than
    /// collect it twice. New every time a room starts: it identifies the run,
    /// not the machine, and nothing should be able to follow a person between
    /// two evenings of hosting.
    pub id: String,
    /// The battle's title, which is what the host typed as the room name.
    pub title: String,
    /// The host's name in their own room.
    pub host: String,
    /// The game, by the name unitsync gives its archive.
    pub game: String,
    pub map: String,
    /// Everybody in the battle, the host included.
    pub players: u32,
    pub max_players: u32,
    /// The lobby port a joiner connects to, which is not the engine's game port.
    pub port: u16,
    pub passworded: bool,
}

impl Beacon {
    /// What to announce for a room, or `None` while there is nothing to announce.
    ///
    /// Everything here is read from the room's own status, the same answer
    /// `direct_room_status` gives the host's screen, so a beacon cannot drift
    /// from what the room actually holds.
    ///
    /// A room with no battle in it yet is not announced. It has no name, no game
    /// and no map, and a joiner reaching it would find nothing to join.
    pub fn from_status(status: &RoomStatus, id: &str) -> Option<Beacon> {
        let battle = status.battle.as_ref()?;
        Some(Beacon {
            id: id.to_string(),
            title: battle.title.clone(),
            host: status.host.clone(),
            game: battle.modname.clone(),
            map: battle.map.clone(),
            players: battle.members.len() as u32,
            max_players: battle.max_players,
            port: status.port,
            passworded: battle.passworded,
        })
    }
}

/// Put a beacon on the wire.
pub fn encode(beacon: &Beacon) -> String {
    // A beacon has no field that can fail to serialize, so the fallback is
    // unreachable rather than meaningful. It is here because a panic in the
    // announce loop would take the room's listener down with it.
    let json = serde_json::to_string(beacon).unwrap_or_else(|_| "{}".to_string());
    format!("{BEACON_MAGIC}{BEACON_VERSION} {json}")
}

/// Read a datagram, or `None` if it was not a beacon this build understands.
///
/// Everything that is not ours is dropped without a word: the group and the port
/// are shared with whatever else the network is doing, and one stray datagram is
/// not an error anybody can act on.
pub fn decode(datagram: &[u8]) -> Option<Beacon> {
    let text = std::str::from_utf8(datagram).ok()?;
    let (version, json) = text.strip_prefix(BEACON_MAGIC)?.split_once(' ')?;
    if version.parse::<u32>().ok()? != BEACON_VERSION {
        return None;
    }
    serde_json::from_str(json).ok()
}

/// A room heard on the local network, as the frontend reads it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanRoom {
    pub id: String,
    pub title: String,
    pub host: String,
    pub game: String,
    pub map: String,
    pub players: u32,
    pub max_players: u32,
    /// The lobby port to dial, alongside [`LanRoom::address`].
    pub port: u16,
    pub passworded: bool,
    /// Where the beacon came from, which is the address to dial. Taken from the
    /// datagram rather than from the payload, so it is the address that works on
    /// the interface it arrived on.
    pub address: String,
    /// This client's own room, heard back off the network. Worth showing as
    /// "yours" rather than hiding: a host who cannot see their own room in the
    /// list has no way to tell whether anybody else can.
    pub is_self: bool,
    /// How long ago the last beacon arrived. A room whose beacons have stopped
    /// climbs towards [`BEACON_EXPIRY`] and then leaves the list.
    pub last_seen_ms: u64,
}

/// The rooms heard so far, newest beacon per room.
#[derive(Default)]
pub struct Directory {
    seen: HashMap<String, Heard>,
}

/// One room's most recent beacon.
struct Heard {
    beacon: Beacon,
    address: String,
    at: Instant,
}

impl Directory {
    /// Take one beacon in.
    ///
    /// Keyed by the room's id rather than by its address, because a host with
    /// two interfaces announces on both and the two datagrams are one room. The
    /// last address heard wins, which is the interface that most recently proved
    /// it can reach us.
    pub fn record(&mut self, beacon: Beacon, address: String, at: Instant) {
        self.seen.insert(
            beacon.id.clone(),
            Heard {
                beacon,
                address,
                at,
            },
        );
    }

    /// The rooms still alive at `now`, dropping the ones whose beacons stopped.
    ///
    /// Sorted by title so a list on screen does not reshuffle itself every time
    /// a beacon lands.
    pub fn list(&mut self, now: Instant, own_id: Option<&str>) -> Vec<LanRoom> {
        self.seen
            .retain(|_, heard| now.saturating_duration_since(heard.at) < BEACON_EXPIRY);
        let mut rooms: Vec<LanRoom> = self
            .seen
            .values()
            .map(|heard| LanRoom {
                id: heard.beacon.id.clone(),
                title: heard.beacon.title.clone(),
                host: heard.beacon.host.clone(),
                game: heard.beacon.game.clone(),
                map: heard.beacon.map.clone(),
                players: heard.beacon.players,
                max_players: heard.beacon.max_players,
                port: heard.beacon.port,
                passworded: heard.beacon.passworded,
                address: heard.address.clone(),
                is_self: own_id == Some(heard.beacon.id.as_str()),
                last_seen_ms: now.saturating_duration_since(heard.at).as_millis() as u64,
            })
            .collect();
        rooms.sort_by(|a, b| a.title.cmp(&b.title).then_with(|| a.id.cmp(&b.id)));
        rooms
    }
}

/// A name for one run of one room, new every time.
///
/// `RandomState` is seeded by the OS once per process and stepped per instance,
/// which is enough to keep two rooms started in the same second apart. It is not
/// a secret and nothing rests on it being unguessable.
pub fn room_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u64(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64,
    );
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn beacon() -> Beacon {
        Beacon {
            id: "abc123".to_string(),
            title: "Tom's room".to_string(),
            host: "tom".to_string(),
            game: "Beyond All Reason test-1234".to_string(),
            map: "Red Comet Remake 1.8".to_string(),
            players: 2,
            max_players: 8,
            port: 8200,
            passworded: true,
        }
    }

    #[test]
    fn a_beacon_survives_the_round_trip() {
        let out = encode(&beacon());
        assert!(out.starts_with("coilbox-room/1 {"));
        assert_eq!(decode(out.as_bytes()), Some(beacon()));
    }

    /// The whole point of a versioned payload. A newer coilbox that adds a field
    /// is still a room this build can join, so its beacon has to survive the trip
    /// through an older listener.
    #[test]
    fn a_beacon_with_fields_this_build_never_heard_of_still_decodes() {
        let json = r#"{"id":"abc123","title":"Tom's room","host":"tom","game":"Beyond All Reason test-1234","map":"Red Comet Remake 1.8","players":2,"maxPlayers":8,"port":8200,"passworded":true,"region":"eu","tags":["ranked"],"relay":{"host":"a","port":1}}"#;
        let heard = decode(format!("coilbox-room/1 {json}").as_bytes()).expect("a v1 beacon");
        assert_eq!(heard, beacon());
    }

    /// The other half of the rule: a field that is missing takes its default
    /// rather than throwing the room away.
    #[test]
    fn a_beacon_missing_fields_keeps_the_ones_it_has() {
        let heard = decode(br#"coilbox-room/1 {"id":"x","title":"A room","port":9000}"#)
            .expect("a v1 beacon");
        assert_eq!(heard.id, "x");
        assert_eq!(heard.title, "A room");
        assert_eq!(heard.port, 9000);
        assert_eq!(heard.max_players, 0);
        assert!(!heard.passworded);
    }

    /// A version this build does not know means a field it does know has changed
    /// meaning, so the room is skipped rather than read wrongly.
    #[test]
    fn a_beacon_from_a_version_this_build_does_not_know_is_ignored() {
        assert_eq!(decode(br#"coilbox-room/2 {"id":"x","port":8200}"#), None);
        assert_eq!(decode(br#"coilbox-room/0 {"id":"x"}"#), None);
    }

    /// The group and the port are shared with whatever else is on the network.
    #[test]
    fn anything_that_is_not_a_beacon_is_dropped() {
        assert_eq!(decode(b""), None);
        assert_eq!(decode(b"M-SEARCH * HTTP/1.1"), None);
        assert_eq!(decode(b"coilbox-room/1"), None);
        assert_eq!(decode(b"coilbox-room/1 not json"), None);
        assert_eq!(decode(&[0xff, 0xfe, 0x00]), None);
    }

    #[test]
    fn a_room_stops_being_listed_once_its_beacons_stop() {
        let mut dir = Directory::default();
        let start = Instant::now();
        dir.record(beacon(), "192.168.0.5".to_string(), start);

        // Two beacons missed, and the room is still there: multicast drops
        // datagrams and a room that flickered would be unjoinable.
        let alive = dir.list(start + Duration::from_secs(5), None);
        assert_eq!(alive.len(), 1);
        assert_eq!(alive[0].address, "192.168.0.5");
        assert_eq!(alive[0].last_seen_ms, 5000);

        assert!(dir.list(start + BEACON_EXPIRY, None).is_empty());
    }

    #[test]
    fn a_fresh_beacon_keeps_a_room_alive() {
        let mut dir = Directory::default();
        let start = Instant::now();
        dir.record(beacon(), "192.168.0.5".to_string(), start);
        dir.record(
            beacon(),
            "192.168.0.5".to_string(),
            start + Duration::from_secs(6),
        );
        assert_eq!(dir.list(start + Duration::from_secs(8), None).len(), 1);
    }

    /// A host on two interfaces announces on both, and both datagrams describe
    /// one room.
    #[test]
    fn one_room_on_two_interfaces_is_one_entry() {
        let mut dir = Directory::default();
        let now = Instant::now();
        dir.record(beacon(), "192.168.0.5".to_string(), now);
        dir.record(beacon(), "10.8.0.2".to_string(), now);
        let rooms = dir.list(now, None);
        assert_eq!(rooms.len(), 1);
        assert_eq!(rooms[0].address, "10.8.0.2");
    }

    #[test]
    fn a_host_can_tell_its_own_room_from_everybody_elses() {
        let mut dir = Directory::default();
        let now = Instant::now();
        dir.record(beacon(), "192.168.0.5".to_string(), now);
        let mut theirs = beacon();
        theirs.id = "somebody-else".to_string();
        theirs.title = "Another room".to_string();
        dir.record(theirs, "192.168.0.9".to_string(), now);

        let rooms = dir.list(now, Some("abc123"));
        assert_eq!(rooms.len(), 2);
        // Sorted by title: "Another room" before "Tom's room".
        assert!(!rooms[0].is_self);
        assert!(rooms[1].is_self);
    }
}
