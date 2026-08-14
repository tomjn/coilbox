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

/// How long an mDNS record keeps a room in the list without being heard again.
///
/// The two announcements do not tick at the same rate and cannot share an
/// expiry. A beacon is resent every two seconds, so silence for seven means the
/// room is gone. A DNS-SD record is sent once and cached by everybody who heard
/// it, and its host only re-announces when something about the room changes, so
/// silence means nothing at all.
///
/// What ends an mDNS record early is the responder saying so: a room that stops
/// sends a goodbye and leaves every list at once. This is the backstop for when
/// no goodbye arrives, at the 120 second TTL mdns-sd puts on the SRV and address
/// records plus slack. A host whose machine is killed rather than quit can sit in
/// the list that long on the mDNS side, which is DNS-SD's own behaviour and not
/// something this can shorten: joining them then fails at connect.
pub const MDNS_EXPIRY: Duration = Duration::from_secs(150);

/// Which announcement a room was heard through.
///
/// Both describe the same room and are keyed by the same [`Beacon::id`], so this
/// is not an identity. It is here because when the two disagree one of them has
/// to win, and because a host working out why nobody can see their room wants to
/// know which half of the network is carrying it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// Coilbox's own UDP beacon, this module's payload.
    Beacon,
    /// A DNS-SD service record. See [`crate::mdns`].
    Mdns,
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
    /// Where the announcement came from, which is the address to dial. Taken
    /// from the datagram rather than from the payload, so it is the address that
    /// works on the interface it arrived on. An mDNS record has no source
    /// address to read, so [`crate::mdns`] picks one out of the addresses the
    /// room published.
    pub address: String,
    /// This client's own room, heard back off the network. Worth showing as
    /// "yours" rather than hiding: a host who cannot see their own room in the
    /// list has no way to tell whether anybody else can.
    pub is_self: bool,
    /// How long ago this room was last heard from, on whichever announcement
    /// spoke most recently.
    pub last_seen_ms: u64,
    /// The announcements carrying this room right now, beacon first.
    ///
    /// One entry is the ordinary case on a network where only one of the two
    /// gets through, which is the reason for announcing twice.
    pub sources: Vec<Source>,
}

/// The rooms heard so far, newest announcement per room per source.
#[derive(Default)]
pub struct Directory {
    seen: HashMap<String, Heard>,
}

/// One room, as each announcement last described it.
///
/// Two slots rather than one, because the two announcements expire on different
/// clocks and a room carried by only one of them is still a room. See
/// [`MDNS_EXPIRY`].
#[derive(Default)]
struct Heard {
    beacon: Option<Told>,
    mdns: Option<Told>,
}

/// What one announcement last said about a room, and when.
struct Told {
    beacon: Beacon,
    address: String,
    at: Instant,
}

impl Heard {
    /// Drop whichever announcements have gone quiet for longer than their own
    /// expiry allows.
    fn expire(&mut self, now: Instant) {
        if let Some(told) = &self.beacon {
            if now.saturating_duration_since(told.at) >= BEACON_EXPIRY {
                self.beacon = None;
            }
        }
        if let Some(told) = &self.mdns {
            if now.saturating_duration_since(told.at) >= MDNS_EXPIRY {
                self.mdns = None;
            }
        }
    }

    /// The announcement whose facts this room is described by.
    ///
    /// The beacon, whenever there is a live one. Not because it is ours, but
    /// because its age is bounded: it is resent every two seconds with whatever
    /// the room holds at that moment, so a live beacon is at most two seconds
    /// out of date. A DNS-SD record is sent once and served from everybody's
    /// cache afterwards, so the moment it reaches us says nothing about how old
    /// the player count in it is. A stale TXT record therefore never overwrites
    /// a fresh beacon, whichever arrived last.
    fn best(&self) -> Option<&Told> {
        self.beacon.as_ref().or(self.mdns.as_ref())
    }

    fn sources(&self) -> Vec<Source> {
        let mut sources = Vec::new();
        if self.beacon.is_some() {
            sources.push(Source::Beacon);
        }
        if self.mdns.is_some() {
            sources.push(Source::Mdns);
        }
        sources
    }
}

impl Directory {
    /// Take one announcement in.
    ///
    /// Keyed by the room's id rather than by its address, because a host with
    /// two interfaces announces on both, and announces over both mDNS and the
    /// beacon, and all of that is one room. The id is what makes it one: it
    /// names a run of a room, it is minted once when the room starts, and both
    /// announcements carry the same one. Nothing else would do. An address is
    /// per interface, a title is not unique, and the DNS-SD instance name gets
    /// renamed under a host who shares a title with somebody else.
    ///
    /// The last address heard on a given source wins, which is the interface
    /// that most recently proved it can reach us.
    pub fn record(&mut self, source: Source, beacon: Beacon, address: String, at: Instant) {
        let heard = self.seen.entry(beacon.id.clone()).or_default();
        let told = Some(Told {
            beacon,
            address,
            at,
        });
        match source {
            Source::Beacon => heard.beacon = told,
            Source::Mdns => heard.mdns = told,
        }
    }

    /// Drop one source's record of a room, because that source says it is gone.
    ///
    /// This is what a DNS-SD goodbye means, and it is the only thing that takes
    /// an mDNS record out of the list promptly. A room still carried by the
    /// beacon stays listed.
    pub fn forget(&mut self, source: Source, id: &str) {
        let Some(heard) = self.seen.get_mut(id) else {
            return;
        };
        match source {
            Source::Beacon => heard.beacon = None,
            Source::Mdns => heard.mdns = None,
        }
    }

    /// The rooms still alive at `now`, dropping the ones both announcements have
    /// gone quiet on.
    ///
    /// Sorted by title so a list on screen does not reshuffle itself every time
    /// an announcement lands.
    pub fn list(&mut self, now: Instant, own_id: Option<&str>) -> Vec<LanRoom> {
        self.seen.retain(|_, heard| {
            heard.expire(now);
            heard.best().is_some()
        });
        let mut rooms: Vec<LanRoom> = self
            .seen
            .values()
            .filter_map(|heard| {
                let told = heard.best()?;
                let freshest = [heard.beacon.as_ref(), heard.mdns.as_ref()]
                    .into_iter()
                    .flatten()
                    .map(|told| told.at)
                    .max()
                    .unwrap_or(told.at);
                Some(LanRoom {
                    id: told.beacon.id.clone(),
                    title: told.beacon.title.clone(),
                    host: told.beacon.host.clone(),
                    game: told.beacon.game.clone(),
                    map: told.beacon.map.clone(),
                    players: told.beacon.players,
                    max_players: told.beacon.max_players,
                    port: told.beacon.port,
                    passworded: told.beacon.passworded,
                    address: told.address.clone(),
                    is_self: own_id == Some(told.beacon.id.as_str()),
                    last_seen_ms: now.saturating_duration_since(freshest).as_millis() as u64,
                    sources: heard.sources(),
                })
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
        dir.record(Source::Beacon, beacon(), "192.168.0.5".to_string(), start);

        // Two beacons missed, and the room is still there: multicast drops
        // datagrams and a room that flickered would be unjoinable.
        let alive = dir.list(start + Duration::from_secs(5), None);
        assert_eq!(alive.len(), 1);
        assert_eq!(alive[0].address, "192.168.0.5");
        assert_eq!(alive[0].last_seen_ms, 5000);
        assert_eq!(alive[0].sources, vec![Source::Beacon]);

        assert!(dir.list(start + BEACON_EXPIRY, None).is_empty());
    }

    #[test]
    fn a_fresh_beacon_keeps_a_room_alive() {
        let mut dir = Directory::default();
        let start = Instant::now();
        dir.record(Source::Beacon, beacon(), "192.168.0.5".to_string(), start);
        dir.record(
            Source::Beacon,
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
        dir.record(Source::Beacon, beacon(), "192.168.0.5".to_string(), now);
        dir.record(Source::Beacon, beacon(), "10.8.0.2".to_string(), now);
        let rooms = dir.list(now, None);
        assert_eq!(rooms.len(), 1);
        assert_eq!(rooms[0].address, "10.8.0.2");
    }

    #[test]
    fn a_host_can_tell_its_own_room_from_everybody_elses() {
        let mut dir = Directory::default();
        let now = Instant::now();
        dir.record(Source::Beacon, beacon(), "192.168.0.5".to_string(), now);
        let mut theirs = beacon();
        theirs.id = "somebody-else".to_string();
        theirs.title = "Another room".to_string();
        dir.record(Source::Beacon, theirs, "192.168.0.9".to_string(), now);

        let rooms = dir.list(now, Some("abc123"));
        assert_eq!(rooms.len(), 2);
        // Sorted by title: "Another room" before "Tom's room".
        assert!(!rooms[0].is_self);
        assert!(rooms[1].is_self);
    }

    /// The whole point of announcing twice. One room, heard both ways, is one
    /// line on screen, because the room id is the same on both.
    #[test]
    fn a_room_heard_both_ways_is_listed_once() {
        let mut dir = Directory::default();
        let now = Instant::now();
        dir.record(Source::Beacon, beacon(), "192.168.0.5".to_string(), now);
        dir.record(Source::Mdns, beacon(), "192.168.0.5".to_string(), now);
        let rooms = dir.list(now, None);
        assert_eq!(rooms.len(), 1);
        assert_eq!(rooms[0].sources, vec![Source::Beacon, Source::Mdns]);
    }

    /// A cached TXT record can arrive later than a beacon and still be older
    /// than it, because a responder serves it from cache long after its host
    /// last said anything. So the beacon's facts win while it is live, whichever
    /// order the two arrived in.
    #[test]
    fn a_stale_mdns_record_does_not_overwrite_a_fresh_beacon() {
        let mut dir = Directory::default();
        let start = Instant::now();
        dir.record(Source::Beacon, beacon(), "192.168.0.5".to_string(), start);

        let mut cached = beacon();
        cached.players = 1;
        cached.map = "A map they left an hour ago".to_string();
        dir.record(
            Source::Mdns,
            cached,
            "192.168.0.5".to_string(),
            start + Duration::from_secs(1),
        );

        let rooms = dir.list(start + Duration::from_secs(1), None);
        assert_eq!(rooms.len(), 1);
        assert_eq!(rooms[0].players, 2);
        assert_eq!(rooms[0].map, "Red Comet Remake 1.8");
        // Freshness is the freshest of the two, so a room the beacon has gone
        // quiet on but mDNS has not does not read as stale.
        assert_eq!(rooms[0].last_seen_ms, 0);
    }

    /// A network that drops the beacon and carries mDNS is exactly why there are
    /// two announcements, so the room stays listed on the one that works, and it
    /// is described by that one.
    #[test]
    fn a_room_only_mdns_carries_is_still_listed() {
        let mut dir = Directory::default();
        let start = Instant::now();
        let mut only = beacon();
        only.players = 5;
        dir.record(Source::Mdns, only, "192.168.0.5".to_string(), start);

        let rooms = dir.list(start + Duration::from_secs(30), None);
        assert_eq!(rooms.len(), 1);
        assert_eq!(rooms[0].players, 5);
        assert_eq!(rooms[0].sources, vec![Source::Mdns]);

        // The two announcements do not share an expiry: seven seconds of
        // silence means nothing to a record that is only re-sent when it
        // changes.
        assert!(dir.list(start + MDNS_EXPIRY, None).is_empty());
    }

    /// A goodbye packet is what makes a room leave the list at once rather than
    /// sitting out the TTL. The beacon, if it is still arriving, keeps the room.
    #[test]
    fn a_goodbye_drops_only_the_announcement_that_sent_it() {
        let mut dir = Directory::default();
        let now = Instant::now();
        dir.record(Source::Beacon, beacon(), "192.168.0.5".to_string(), now);
        dir.record(Source::Mdns, beacon(), "192.168.0.5".to_string(), now);

        dir.forget(Source::Mdns, "abc123");
        let rooms = dir.list(now, None);
        assert_eq!(rooms.len(), 1);
        assert_eq!(rooms[0].sources, vec![Source::Beacon]);

        dir.forget(Source::Beacon, "abc123");
        assert!(dir.list(now, None).is_empty());
    }

    /// An mDNS record with no beacon behind it still has to be dialable, and the
    /// address it carries is the one it was resolved to.
    #[test]
    fn an_mdns_only_room_is_dialled_at_the_address_it_resolved_to() {
        let mut dir = Directory::default();
        let now = Instant::now();
        dir.record(Source::Mdns, beacon(), "10.0.0.7".to_string(), now);
        assert_eq!(dir.list(now, None)[0].address, "10.0.0.7");
    }
}
