//! The same room, said again in the standard way: a DNS-SD service over mDNS.
//!
//! [`crate::beacon`] is coilbox's own announcement and stays exactly as it was.
//! This is a second one beside it, not a replacement, because the two fail on
//! different networks and a room announced both ways is found by whichever half
//! works. The beacon needs no daemon present and is proven on Linux CI as well
//! as on a Mac. DNS-SD gets through some access points that drop plain broadcast,
//! and it puts the room in front of any ordinary network browser, which is a real
//! help to somebody trying to work out whether their network is the problem.
//!
//! # The service type
//!
//! `_coilbox-room._tcp.local.` `_tcp` because what is being advertised is the
//! room's lobby listener, which is a TCP socket, and the SRV record's port is
//! that socket's port. The name is the application plus what the service is,
//! which is RFC 6763's convention. It is not an IANA registration, which section
//! 7 allows for a name nothing outside this application is expected to speak.
//!
//! # What identifies a room across both announcements
//!
//! [`Beacon::id`], carried in the TXT record under `id`. It is minted once when a
//! room starts and both announcements carry the same one, so
//! [`crate::beacon::Directory`] merges them by it and lists the room once.
//!
//! The DNS-SD instance name cannot do that job. It is the room's title, because
//! that is what a person reads in a service browser, and two people can call
//! their room the same thing: mdns-sd probes the name and renames the loser.
//! Nothing here reads the instance name back.
//!
//! # What the TXT record carries
//!
//! Everything the beacon payload carries except the port, which the SRV record
//! already gives, and the address, which the A records give. Nothing had to be
//! dropped for size. RFC 6763 section 6.1 caps one `key=value` string at 255
//! bytes because it is length-prefixed by a single byte, and `mdns-sd` rejects a
//! property that breaks it rather than truncating, so every value is cut to fit
//! here. Real titles, games and maps are tens of bytes, so the cut is a guard
//! against a pathological name and not something anybody will meet. The whole
//! record is then under 1100 bytes even with every field at its limit, inside the
//! single-packet size RFC 6763 section 6.2 asks for.
//!
//! `v` follows the same rule as the beacon's version: a record from a version
//! this build does not know is dropped in silence, and adding a key leaves it
//! alone.
//!
//! # What it costs where there is no responder
//!
//! Nothing on the beacon path. `mdns-sd` is a responder in its own right rather
//! than a wrapper round Bonjour or Avahi, so this works on a Windows machine that
//! has neither, and it is why the dependency was chosen: nothing new is needed in
//! CI or inside the AppImage. Its daemon is one thread and a loopback signal
//! socket, and the multicast sockets are opened later on that thread, so a machine
//! that will not carry multicast at all fails there and never in the caller.
//! Every failure here is swallowed and the beacon carries on alone.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};

use mdns_sd::{ServiceDaemon, ServiceInfo};

use crate::beacon::Beacon;
use crate::discovery::LocalNet;

/// What rooms are advertised as. See the module docs.
pub const SERVICE_TYPE: &str = "_coilbox-room._tcp.local.";

/// The TXT payload generation, moved by the same rule as the beacon's version:
/// adding a key leaves it alone, changing what a key means moves it.
pub const TXT_VERSION: u32 = 1;

/// The longest one `key=value` string may be, from RFC 6763 section 6.1: the
/// string is prefixed by a single length byte.
const MAX_TXT_ENTRY: usize = 255;

/// The TXT record for a room.
///
/// The port is absent on purpose: the SRV record carries it, and two places
/// saying the port is two places that can disagree.
pub fn to_txt(beacon: &Beacon) -> Vec<(String, String)> {
    vec![
        entry("v", &TXT_VERSION.to_string()),
        entry("id", &beacon.id),
        entry("title", &beacon.title),
        entry("host", &beacon.host),
        entry("game", &beacon.game),
        entry("map", &beacon.map),
        entry("players", &beacon.players.to_string()),
        entry("maxplayers", &beacon.max_players.to_string()),
        entry("passworded", if beacon.passworded { "1" } else { "0" }),
    ]
}

/// One TXT entry, with the value cut to what the 255 byte limit leaves for it.
///
/// On a character boundary, so a truncated title is still a string somebody can
/// read rather than broken UTF-8 that the whole record would be thrown out for.
fn entry(key: &str, value: &str) -> (String, String) {
    // The key, the `=`, and then whatever is left.
    let room = MAX_TXT_ENTRY.saturating_sub(key.len() + 1);
    let mut end = value.len().min(room);
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    (key.to_string(), value[..end].to_string())
}

/// Read a room back out of a TXT record, or `None` if it is not one this build
/// can act on.
///
/// `port` comes from the SRV record. A record with no `id` is dropped: without it
/// there is no way to tell whether this is a room already heard on the beacon,
/// and listing it anyway is the duplicate this whole design exists to avoid.
pub fn from_txt(props: &HashMap<String, String>, port: u16) -> Option<Beacon> {
    if props.get("v")?.parse::<u32>().ok()? != TXT_VERSION {
        return None;
    }
    let id = props.get("id")?;
    if id.is_empty() {
        return None;
    }
    // Same forward compatibility rule as the beacon: a key this build never
    // heard of is ignored, and a missing key takes a default rather than
    // throwing the room away.
    let text = |key: &str| props.get(key).cloned().unwrap_or_default();
    let number = |key: &str| props.get(key).and_then(|v| v.parse().ok()).unwrap_or(0);
    Some(Beacon {
        id: id.clone(),
        title: text("title"),
        host: text("host"),
        game: text("game"),
        map: text("map"),
        players: number("players"),
        max_players: number("maxplayers"),
        port,
        passworded: props.get("passworded").is_some_and(|v| v == "1"),
    })
}

/// The name a room is listed under in a service browser.
///
/// The room's title, which is what makes browsing useful at all. Uniqueness is
/// not this function's problem: mdns-sd probes the name and renames the loser
/// when two rooms share a title, and the merge is keyed by the room id anyway.
/// A room with no title at all would be a nameless instance, which is not a legal
/// one, so it falls back to the host's name and then to the id.
pub fn instance_name(beacon: &Beacon) -> String {
    for candidate in [&beacon.title, &beacon.host, &beacon.id] {
        let trimmed = candidate.trim();
        if !trimmed.is_empty() {
            // RFC 6763 section 4.1.1: the instance name is one DNS label, and one
            // label is 63 bytes.
            return trimmed.chars().take(63).collect();
        }
    }
    "coilbox room".to_string()
}

/// The name this room's address records are published under.
///
/// Its own, never the machine's real `.local.` name. Claiming that would put us
/// in a conflict with the responder the OS already runs, which owns it.
pub fn host_name(id: &str) -> String {
    format!("coilbox-{id}.local.")
}

/// Which of the addresses a room published is the one to dial it at.
///
/// An mDNS record has no source address the way a beacon datagram does, so the
/// receiver has to choose out of everything the host advertised. An address on a
/// network this machine is also on is the one that can actually be reached: a
/// host that publishes a Docker bridge or a VPN tunnel alongside its LAN address
/// publishes two addresses only one of which is any use here.
///
/// Loopback last, and only when nothing else was offered, which is the two
/// coilboxes on one machine case.
pub fn address_to_dial(addresses: &[Ipv4Addr], nets: &[LocalNet]) -> Option<Ipv4Addr> {
    let shared = |addr: &Ipv4Addr| {
        nets.iter()
            .any(|net| !net.addr.is_loopback() && net.contains(*addr))
    };
    let routable = |addr: &&Ipv4Addr| !addr.is_loopback();
    addresses
        .iter()
        .find(|addr| routable(addr) && shared(addr))
        .or_else(|| addresses.iter().find(routable))
        .or_else(|| addresses.first())
        .copied()
}

/// A room published as a DNS-SD service, for as long as this is held.
///
/// Dropping it tells the daemon to shut down, which sends the goodbye packets
/// that take the room out of everybody's list at once rather than leaving it to
/// its TTL. That happens on the daemon's own thread, so nothing here waits for
/// it, and it is why a host who restarts their room does not leave the old one
/// behind. A host whose machine is killed sends no goodbye and sits out the TTL,
/// which no DNS-SD implementation can do anything about.
pub struct Advert {
    daemon: ServiceDaemon,
    /// The name the service was registered under, which is what unregisters it.
    fullname: String,
    /// What was last published, so an unchanged room is not re-announced.
    txt: Vec<(String, String)>,
}

impl Advert {
    /// Publish a room. `addresses` is every address this machine answers on, in
    /// the order [`crate::discovery::local_addrs`] gives them.
    ///
    /// Fails only where the daemon cannot be created or the record is not a legal
    /// one. The caller carries on with the beacon either way.
    pub fn start(beacon: &Beacon, addresses: &[Ipv4Addr]) -> Result<Advert, String> {
        let daemon = ServiceDaemon::new().map_err(|e| format!("mdns daemon: {e}"))?;
        let txt = to_txt(beacon);
        let info = service_info(beacon, addresses, &txt)?;
        let fullname = info.get_fullname().to_string();
        daemon
            .register(info)
            .map_err(|e| format!("mdns register: {e}"))?;
        Ok(Advert {
            daemon,
            fullname,
            txt,
        })
    }

    /// Republish the room, but only if anything a listener can see has changed.
    ///
    /// The room is asked what it holds every two seconds for the beacon, and
    /// re-announcing an unchanged record at that rate would be a multicast packet
    /// every two seconds to every machine on the network for no reason. DNS-SD
    /// expects a record to be sent when it changes and cached in between, so a
    /// player joining or the map changing is what puts one on the wire.
    pub fn update(&mut self, beacon: &Beacon, addresses: &[Ipv4Addr]) {
        let txt = to_txt(beacon);
        if txt == self.txt {
            return;
        }
        let Ok(mut info) = service_info(beacon, addresses, &txt) else {
            return;
        };
        // The name is already ours, probed for when it was first registered, so
        // probing again would only delay the update.
        info.set_requires_probe(false);
        if self.daemon.register(info).is_ok() {
            self.txt = txt;
        }
    }
}

impl Drop for Advert {
    fn drop(&mut self) {
        // Both, because unregister is the goodbye for this one service and
        // shutdown is what stops the thread. Neither is waited on: the daemon
        // does its own sending, and a room stopping must not block on the
        // network.
        let _ = self.daemon.unregister(&self.fullname);
        let _ = self.daemon.shutdown();
    }
}

/// The service record for a room.
fn service_info(
    beacon: &Beacon,
    addresses: &[Ipv4Addr],
    txt: &[(String, String)],
) -> Result<ServiceInfo, String> {
    let addresses: Vec<IpAddr> = addresses.iter().copied().map(IpAddr::V4).collect();
    ServiceInfo::new(
        SERVICE_TYPE,
        &instance_name(beacon),
        &host_name(&beacon.id),
        &addresses[..],
        beacon.port,
        txt,
    )
    .map_err(|e| format!("mdns record: {e}"))
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

    fn map_of(txt: &[(String, String)]) -> HashMap<String, String> {
        txt.iter().cloned().collect()
    }

    #[test]
    fn a_room_survives_the_round_trip_through_a_txt_record() {
        let txt = to_txt(&beacon());
        assert_eq!(from_txt(&map_of(&txt), 8200), Some(beacon()));
    }

    /// The port is the SRV record's, not the TXT's, so a record read against a
    /// different port describes a room on that port.
    #[test]
    fn the_port_comes_from_the_service_and_not_the_record() {
        let txt = to_txt(&beacon());
        assert!(!txt.iter().any(|(key, _)| key == "port"));
        assert_eq!(from_txt(&map_of(&txt), 9001).map(|b| b.port), Some(9001));
    }

    /// Same rule as the beacon: a key this build never heard of is ignored, and
    /// a missing one takes a default rather than throwing the room away.
    #[test]
    fn a_record_with_keys_this_build_never_heard_of_still_decodes() {
        let mut props = map_of(&to_txt(&beacon()));
        props.insert("region".to_string(), "eu".to_string());
        props.insert("relay".to_string(), "a:1".to_string());
        assert_eq!(from_txt(&props, 8200), Some(beacon()));

        let sparse = HashMap::from([
            ("v".to_string(), "1".to_string()),
            ("id".to_string(), "x".to_string()),
            ("title".to_string(), "A room".to_string()),
        ]);
        let heard = from_txt(&sparse, 9000).expect("a v1 record");
        assert_eq!(heard.title, "A room");
        assert_eq!(heard.max_players, 0);
        assert!(!heard.passworded);
    }

    /// Without an id there is no way to tell this from the same room already
    /// heard on the beacon, and listing it anyway is the duplicate the whole
    /// design is about.
    #[test]
    fn a_record_that_cannot_be_matched_to_a_room_is_dropped() {
        let no_id = HashMap::from([("v".to_string(), "1".to_string())]);
        assert_eq!(from_txt(&no_id, 8200), None);

        let empty_id = HashMap::from([
            ("v".to_string(), "1".to_string()),
            ("id".to_string(), String::new()),
        ]);
        assert_eq!(from_txt(&empty_id, 8200), None);

        assert_eq!(from_txt(&HashMap::new(), 8200), None);
    }

    /// A version this build does not know means a key it does know has changed
    /// meaning, so the room is skipped rather than read wrongly.
    #[test]
    fn a_record_from_a_version_this_build_does_not_know_is_ignored() {
        for version in ["2", "0", "not a number"] {
            let props = HashMap::from([
                ("v".to_string(), version.to_string()),
                ("id".to_string(), "x".to_string()),
            ]);
            assert_eq!(from_txt(&props, 8200), None);
        }
    }

    /// mdns-sd refuses a property over 255 bytes rather than cutting it, so a
    /// room whose host typed an essay for a title would have no mDNS record at
    /// all unless it is cut here.
    #[test]
    fn a_value_too_long_for_a_txt_record_is_cut_to_fit() {
        let mut long = beacon();
        long.title = "x".repeat(400);
        long.map = "é".repeat(400);
        for (key, value) in to_txt(&long) {
            assert!(
                key.len() + 1 + value.len() <= MAX_TXT_ENTRY,
                "{key} is over the limit at {} bytes",
                key.len() + 1 + value.len()
            );
        }
        // On a character boundary, or the record is broken UTF-8 and the whole
        // room is unreadable rather than merely abbreviated.
        let txt = map_of(&to_txt(&long));
        assert!(txt["map"].chars().all(|c| c == 'é'));
        // And the record is one a service browser will accept.
        service_info(&long, &[Ipv4Addr::LOCALHOST], &to_txt(&long)).expect("a legal record");
    }

    /// What a person reads in a service browser is the room's name.
    #[test]
    fn a_room_is_browsed_under_its_own_name() {
        assert_eq!(instance_name(&beacon()), "Tom's room");

        let mut nameless = beacon();
        nameless.title = "   ".to_string();
        assert_eq!(instance_name(&nameless), "tom");

        nameless.host = String::new();
        assert_eq!(instance_name(&nameless), "abc123");

        let mut essay = beacon();
        essay.title = "x".repeat(200);
        assert_eq!(instance_name(&essay).len(), 63);
    }

    /// Never the machine's own `.local.` name, which the OS's responder owns.
    #[test]
    fn a_room_publishes_its_addresses_under_a_name_of_its_own() {
        assert_eq!(host_name("abc123"), "coilbox-abc123.local.");
    }

    fn net(addr: [u8; 4], prefix_len: u8) -> LocalNet {
        LocalNet {
            addr: Ipv4Addr::from(addr),
            prefix_len,
            gateway: None,
        }
    }

    /// A host on a LAN and a VPN publishes both, and only one of them is a
    /// network this machine is also on.
    #[test]
    fn the_address_dialled_is_the_one_on_a_network_this_machine_shares() {
        let nets = vec![net([192, 168, 1, 20], 24), net([127, 0, 0, 1], 8)];
        let published = [
            Ipv4Addr::new(10, 8, 0, 2),
            Ipv4Addr::new(172, 17, 0, 1),
            Ipv4Addr::new(192, 168, 1, 45),
            Ipv4Addr::LOCALHOST,
        ];
        assert_eq!(
            address_to_dial(&published, &nets),
            Some(Ipv4Addr::new(192, 168, 1, 45))
        );
    }

    /// Nothing in common, so there is nothing to prefer and the first routable
    /// address is as good a guess as any. Better than refusing to list the room.
    #[test]
    fn an_address_on_no_shared_network_is_still_offered() {
        let nets = vec![net([192, 168, 1, 20], 24)];
        let published = [Ipv4Addr::LOCALHOST, Ipv4Addr::new(10, 8, 0, 2)];
        assert_eq!(
            address_to_dial(&published, &nets),
            Some(Ipv4Addr::new(10, 8, 0, 2))
        );
    }

    /// Two coilboxes on one machine, which is how any of this gets tested and is
    /// also two people sharing a desk.
    #[test]
    fn loopback_is_dialled_when_it_is_all_that_was_published() {
        let nets = vec![net([127, 0, 0, 1], 8)];
        assert_eq!(
            address_to_dial(&[Ipv4Addr::LOCALHOST], &nets),
            Some(Ipv4Addr::LOCALHOST)
        );
        assert_eq!(address_to_dial(&[], &nets), None);
    }
}
