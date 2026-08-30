//! The sockets discovery runs on: one that announces a room every two seconds,
//! and one that listens for everybody else's.
//!
//! [`crate::beacon`] decides what is said. This decides where it goes.
//!
//! # Two transports, on purpose
//!
//! Every beacon is sent twice, once to the multicast group and once to the
//! broadcast address of the subnet it is leaving by. They fail in different
//! places, and neither is reliable enough on its own:
//!
//! - Multicast is dropped by some wireless access points, and by hosts that
//!   joined the group on a different interface than the sender used.
//! - Broadcast is dropped by some wireless drivers in power saving, and by
//!   client isolation on guest networks.
//!
//! A duplicate costs one map insert, so both is cheap and either alone is a
//! network somebody cannot host on.
//!
//! # Several interfaces
//!
//! This is the failure people actually hit, because a VPN, Docker or a virtual
//! machine adapter is normal. A beacon announced on one interface and listened
//! for on another is a room nobody can see.
//!
//! So neither side picks an interface. The sender transmits from every local
//! address it can find, one socket each, setting the multicast interface and
//! binding the broadcast to that address, so the beacon leaves by every route it
//! could leave by. The listener joins the group on every one of those addresses
//! as well as on the unspecified address, and its socket is bound to `0.0.0.0`,
//! so a broadcast arriving on any interface is delivered whatever the multicast
//! joins did.
//!
//! [`local_nets`] is what finds those addresses, by asking the OS for its
//! interfaces rather than by probing the routing table for the source address it
//! would pick. The netmask is the reason: a probe can learn an address but not
//! the subnet it is on, and without that the only broadcast address there is to
//! send to is the limited one, 255.255.255.255.
//!
//! # And a third, which is not ours
//!
//! [`crate::mdns`] says the same thing again as a DNS-SD service, and [`Browse`]
//! below is the listening half of it. Same reason as the two above: it reaches
//! networks these do not. The two halves never wait on each other, and a machine
//! that cannot do mDNS at all loses nothing here.

use std::collections::HashMap;
use std::io;
use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use mdns_sd::ServiceEvent;
use socket2::{Domain, Protocol, SockAddr, Socket, Type};
use tokio::net::UdpSocket;
use tokio::task::JoinHandle;

use crate::beacon::{decode, Directory, LanRoom, Source, BEACON_GROUP, BEACON_PORT};
use crate::mdns;

/// The largest datagram this will read. A beacon is a couple of hundred bytes
/// and anything near this is somebody else's protocol.
const MAX_DATAGRAM: usize = 2048;

/// One IPv4 address this machine holds, and the two things worth knowing about
/// the network it is on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LocalNet {
    /// The address itself. A beacon is sent from it, and a joiner is given it.
    pub addr: Ipv4Addr,
    /// How much of it names the network rather than this machine.
    pub prefix_len: u8,
    /// The gateway the OS routes this interface's traffic through, when it names
    /// one. This is what [`crate::portmap`] speaks NAT-PMP to.
    pub gateway: Option<Ipv4Addr>,
}

impl LocalNet {
    /// Where a broadcast beacon leaving by this address should be addressed.
    ///
    /// The subnet's own broadcast address. A prefix with no room for one, which
    /// is what a point to point tunnel is usually given, falls back to the
    /// limited broadcast 255.255.255.255, which is what every interface used
    /// before any of this could see a netmask.
    pub fn broadcast(&self) -> Ipv4Addr {
        if self.prefix_len >= 31 {
            return Ipv4Addr::BROADCAST;
        }
        Ipv4Addr::from(u32::from(self.addr) | !mask(self.prefix_len))
    }

    /// Whether an address is on this network.
    ///
    /// What [`crate::mdns`] uses to pick which of the addresses a room published
    /// is the one this machine can reach it at.
    pub fn contains(&self, addr: Ipv4Addr) -> bool {
        u32::from(addr) & mask(self.prefix_len) == u32::from(self.addr) & mask(self.prefix_len)
    }

    /// The first and last usable address of this subnet, in that order.
    ///
    /// Where a home router sits when nothing will say where it is. Empty when
    /// the prefix leaves no usable addresses to guess at.
    pub fn ends(&self) -> Vec<Ipv4Addr> {
        if self.prefix_len >= 31 {
            return Vec::new();
        }
        let network = u32::from(self.addr) & mask(self.prefix_len);
        let broadcast = network | !mask(self.prefix_len);
        vec![Ipv4Addr::from(network + 1), Ipv4Addr::from(broadcast - 1)]
    }
}

/// The netmask of a prefix, as the bits it keeps.
fn mask(prefix_len: u8) -> u32 {
    if prefix_len == 0 {
        0
    } else {
        u32::MAX << (32 - prefix_len.min(32))
    }
}

/// One of this machine's addresses as a host reads it out: the address itself,
/// and the interface it belongs to.
///
/// The interface is here because a machine with a VPN, or Docker, or a virtual
/// machine adapter has several private addresses and only one of them is the one
/// the person in the same room can reach. Nothing here can tell which, so the
/// host is told which interface each address is on and picks.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAddress {
    /// Dotted quad, as it would be typed into "Join by address".
    pub address: String,
    /// What the OS calls the interface, for example `en0` or `Wi-Fi`.
    pub interface: String,
    /// This machine talking to itself, which is an address to give nobody else.
    pub loopback: bool,
}

/// Every IPv4 network this machine is on, best first and loopback last.
///
/// Read from the OS's own interface list, so an address on an unusual private
/// range, or a second address on one interface, is announced on like any other.
///
/// The order is what decides which address a room announces itself at, so
/// ordinary private networks come first, then anything else routable, then point
/// to point tunnels: a full tunnel VPN's address is no use to somebody sitting
/// in the same room. Loopback is last, is always in the list whatever
/// enumeration found, and is what makes two coilboxes on one machine find each
/// other with no network at all, which is also how discovery is tested.
pub fn local_nets() -> Vec<LocalNet> {
    local_nets_named().into_iter().map(|(_, net)| net).collect()
}

/// [`local_nets`], each paired with the name of the interface it was found on.
///
/// One enumeration for both, so the address a host is told to read out is the
/// same address the beacon leaves by and the same one the router is asked to
/// forward.
pub fn local_nets_named() -> Vec<(String, LocalNet)> {
    let mut found: Vec<(u8, String, LocalNet)> = Vec::new();
    for iface in netdev::get_interfaces() {
        // A cable that is unplugged still has its last address on some
        // platforms, and a beacon sent from it goes nowhere.
        if !iface.is_up() {
            continue;
        }
        let gateway = iface
            .gateway
            .as_ref()
            .and_then(|device| device.ipv4.first().copied());
        // Windows names an interface twice: `name` is a GUID there and the
        // friendly name is the "Wi-Fi" a person would recognise. Elsewhere there
        // is only the one, and it is already `en0`.
        let named = iface
            .friendly_name
            .clone()
            .unwrap_or_else(|| iface.name.clone());
        for net in &iface.ipv4 {
            let addr = net.addr();
            if addr.is_unspecified() || found.iter().any(|(_, _, seen)| seen.addr == addr) {
                continue;
            }
            let rank = if addr.is_loopback() {
                3
            } else if iface.is_point_to_point() {
                2
            } else if addr.is_private() {
                0
            } else {
                1
            };
            found.push((
                rank,
                named.clone(),
                LocalNet {
                    addr,
                    prefix_len: net.prefix_len(),
                    gateway,
                },
            ));
        }
    }
    // Stable, so interfaces of equal rank stay in the order the OS listed them.
    found.sort_by_key(|(rank, _, _)| *rank);
    let mut nets: Vec<(String, LocalNet)> = found
        .into_iter()
        .map(|(_, named, net)| (named, net))
        .collect();
    if !nets.iter().any(|(_, net)| net.addr.is_loopback()) {
        nets.push((
            "loopback".to_string(),
            LocalNet {
                addr: Ipv4Addr::LOCALHOST,
                prefix_len: 8,
                gateway: None,
            },
        ));
    }
    nets
}

/// Every address this machine can be dialled at, best first and loopback last,
/// each named by the interface it is on.
pub fn local_addresses() -> Vec<LocalAddress> {
    local_nets_named()
        .into_iter()
        .map(|(interface, net)| LocalAddress {
            address: net.addr.to_string(),
            interface,
            loopback: net.addr.is_loopback(),
        })
        .collect()
}

/// Every local IPv4 address a beacon should be sent from, loopback last.
pub fn local_addrs() -> Vec<Ipv4Addr> {
    local_nets().into_iter().map(|net| net.addr).collect()
}

/// The address to tell a joining engine to connect to, out of the addresses a
/// machine holds, or `None` when it is on no network at all. Pure.
///
/// A private address first, because this is LAN hosting and a VPN's address is
/// no use to somebody in the same room. Announcing 127.0.0.1, which is what a
/// room did before it could announce anything, is a room only its own host can
/// reach.
///
/// The addresses are passed in rather than read here so the choice can be tested
/// on a machine that does not have the addresses in question, so
/// [`crate::reachability`] can read this and the whole list from one
/// enumeration, and so a running room can re-read it (issue #2116). A host on a
/// public address with a Docker bridge beside it gets the bridge from here,
/// which is right for announcing a room and wrong for anything comparing an
/// address against STUN (issue #2111).
pub(crate) fn lan_address_of(addrs: &[Ipv4Addr]) -> Option<String> {
    let routable = || addrs.iter().find(|a| !a.is_loopback());
    addrs
        .iter()
        .find(|a| a.is_private())
        .or_else(routable)
        .map(|a| a.to_string())
}

/// Send one beacon out of every interface this machine has.
///
/// Errors are per interface and are dropped: an address that cannot carry
/// multicast, which is normal for a VPN tunnel, must not stop the interface that
/// can.
pub fn announce_once(payload: &[u8]) {
    for net in local_nets() {
        let _ = send_from(net, payload);
    }
}

/// One beacon, from one of this machine's addresses, to both the group and that
/// address's own broadcast address.
fn send_from(net: LocalNet, payload: &[u8]) -> io::Result<()> {
    let local = net.addr;
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    socket.bind(&SockAddr::from(SocketAddrV4::new(local, 0)))?;
    socket.set_broadcast(true)?;
    // Which interface the multicast leaves by. Without this the routing table
    // picks one, which on a machine with a VPN is the tunnel and not the LAN.
    socket.set_multicast_if_v4(&local)?;
    // One hop. A room is on this network or it is nowhere.
    socket.set_multicast_ttl_v4(1)?;
    // So a second coilbox on this machine hears it. That is a real case rather
    // than only a test one: two people can share a machine, and a host wants to
    // see that their own room is being announced.
    socket.set_multicast_loop_v4(true)?;

    let group = SockAddr::from(SocketAddrV4::new(BEACON_GROUP, BEACON_PORT));
    let broadcast = SockAddr::from(SocketAddrV4::new(net.broadcast(), BEACON_PORT));
    let sent_group = socket.send_to(payload, &group);
    let sent_broadcast = socket.send_to(payload, &broadcast);
    // Only a failure if neither transport left the machine.
    sent_group.or(sent_broadcast).map(|_| ())
}

/// The rooms this client can hear, kept up to date by a task of its own.
///
/// Two tasks, in fact, one per announcement, both filling the one [`Directory`]:
/// the beacon socket below, and the DNS-SD browse in [`crate::mdns`]. They are
/// independent on purpose. A network that carries one and drops the other is the
/// whole reason for announcing twice, and a failure to browse must not cost the
/// beacon anything, so the mDNS half is started on a best effort and its absence
/// is not an error anybody is shown.
pub struct Discovery {
    rooms: Arc<Mutex<Directory>>,
    task: JoinHandle<()>,
    /// The DNS-SD browse, when one could be started. Holds the daemon, so
    /// dropping this shuts its thread down.
    browse: Option<Browse>,
}

impl Discovery {
    /// Bind the beacon port and start listening.
    ///
    /// Fails only if the port cannot be bound at all. It is bound with address
    /// reuse, so a second coilbox on the same machine is not a failure: that is
    /// the case discovery exists for.
    pub fn start() -> io::Result<Discovery> {
        let socket = bind_listener()?;
        let rooms = Arc::new(Mutex::new(Directory::default()));
        let task = tokio::spawn(listen(socket, Arc::clone(&rooms)));
        Ok(Discovery {
            rooms: Arc::clone(&rooms),
            task,
            browse: Browse::start(rooms).ok(),
        })
    }

    /// The rooms heard recently, oldest beacons dropped.
    ///
    /// `own_id` is this client's own room, if it is hosting one, so its own
    /// beacon can be marked rather than shown as a stranger's.
    pub fn rooms(&self, own_id: Option<&str>) -> Vec<LanRoom> {
        match self.rooms.lock() {
            Ok(mut dir) => dir.list(Instant::now(), own_id),
            // Only reachable if the listen task panicked while holding the lock,
            // in which case there is nothing to report and nothing to fix here.
            Err(_) => Vec::new(),
        }
    }

    /// Stop listening and free the port.
    pub fn stop(self) {
        self.task.abort();
        // The browse goes with it: dropping it shuts the mDNS daemon's thread
        // down, which is the half of this that is not a tokio task.
        drop(self.browse);
    }
}

/// The DNS-SD half of listening: one mDNS daemon, one browse, one task reading
/// what it finds into the same [`Directory`] the beacon fills.
struct Browse {
    daemon: mdns_sd::ServiceDaemon,
    task: JoinHandle<()>,
}

impl Browse {
    /// Start browsing for rooms.
    ///
    /// Fails where the daemon cannot be created at all, which the caller treats
    /// as "this machine does mDNS badly" rather than as an error: the beacon is
    /// still listening and is still the transport most rooms arrive on.
    fn start(rooms: Arc<Mutex<Directory>>) -> Result<Browse, mdns_sd::Error> {
        let daemon = mdns_sd::ServiceDaemon::new()?;
        let events = daemon.browse(mdns::SERVICE_TYPE)?;
        Ok(Browse {
            daemon,
            task: tokio::spawn(browse(events, rooms)),
        })
    }
}

impl Drop for Browse {
    fn drop(&mut self) {
        self.task.abort();
        // Not waited on. Shutting the daemon down sends the goodbyes and ends
        // its thread, and it does both itself.
        let _ = self.daemon.shutdown();
    }
}

/// Read resolved rooms out of a DNS-SD browse until the task is dropped.
///
/// A record is only taken as a room when it carries an id, which is what ties it
/// to the same room's beacon. See [`crate::mdns::from_txt`].
async fn browse(events: mdns_sd::Receiver<ServiceEvent>, rooms: Arc<Mutex<Directory>>) {
    // Which room each published service is, so a goodbye naming the service can
    // take the right room out. The instance name is not the room id, and a
    // removal carries nothing else.
    let mut named: HashMap<String, String> = HashMap::new();
    while let Ok(event) = events.recv_async().await {
        match event {
            ServiceEvent::ServiceResolved(service) => {
                let props = service.txt_properties.clone().into_property_map_str();
                let Some(beacon) = mdns::from_txt(&props, service.port) else {
                    continue;
                };
                let addresses: Vec<Ipv4Addr> = service.get_addresses_v4().into_iter().collect();
                let Some(address) = mdns::address_to_dial(&addresses, &local_nets()) else {
                    // A service with no IPv4 address is one nothing here can
                    // dial. IPv6 is not a transport this hosts on.
                    continue;
                };
                named.insert(service.fullname.clone(), beacon.id.clone());
                if let Ok(mut dir) = rooms.lock() {
                    dir.record(Source::Mdns, beacon, address.to_string(), Instant::now());
                }
            }
            // The goodbye a stopping room sends, or the record's TTL running
            // out. Either way that announcement is over, and the room stays
            // listed only if its beacon is still arriving.
            ServiceEvent::ServiceRemoved(_, fullname) => {
                if let Some(id) = named.remove(&fullname) {
                    if let Ok(mut dir) = rooms.lock() {
                        dir.forget(Source::Mdns, &id);
                    }
                }
            }
            _ => {}
        }
    }
}

/// The listening socket: bound to every interface, joined to the group on each
/// one, and shareable with another coilbox on the same machine.
fn bind_listener() -> io::Result<UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    // Two coilboxes on one machine both listening on one port. Windows needs
    // only the first. The BSDs and Linux want the second as well, and both
    // deliver a multicast or broadcast datagram to every socket bound this way.
    socket.set_reuse_address(true)?;
    #[cfg(unix)]
    socket.set_reuse_port(true)?;
    // 0.0.0.0, so a broadcast or a unicast beacon arriving on any interface is
    // delivered whatever the group joins below managed.
    socket.bind(&SockAddr::from(SocketAddrV4::new(
        Ipv4Addr::UNSPECIFIED,
        BEACON_PORT,
    )))?;

    // Once per interface, because a join is per interface and the unspecified
    // address only joins on whichever one the routing table prefers. An
    // interface that refuses is skipped: the others still carry the group, and
    // broadcast still arrives regardless.
    let _ = socket.join_multicast_v4(&BEACON_GROUP, &Ipv4Addr::UNSPECIFIED);
    for local in local_addrs() {
        let _ = socket.join_multicast_v4(&BEACON_GROUP, &local);
    }

    socket.set_nonblocking(true)?;
    UdpSocket::from_std(socket.into())
}

/// Read beacons until the task is dropped.
async fn listen(socket: UdpSocket, rooms: Arc<Mutex<Directory>>) {
    let mut buf = vec![0u8; MAX_DATAGRAM];
    loop {
        let Ok((len, from)) = socket.recv_from(&mut buf).await else {
            // A datagram that could not be read says nothing about the next one,
            // and the socket is still bound.
            continue;
        };
        let Some(beacon) = decode(&buf[..len]) else {
            continue;
        };
        if let Ok(mut dir) = rooms.lock() {
            dir.record(
                Source::Beacon,
                beacon,
                from.ip().to_string(),
                Instant::now(),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Loopback is always announced on, whatever the machine is plugged into,
    /// because that is the only address two coilboxes on one machine are certain
    /// to share.
    #[test]
    fn loopback_is_always_one_of_the_addresses_a_beacon_goes_out_of() {
        let addrs = local_addrs();
        assert!(addrs.contains(&Ipv4Addr::LOCALHOST));
        // No duplicates: each address is one socket and one pair of datagrams.
        let mut unique = addrs.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), addrs.len());
    }

    /// A room announcing 127.0.0.1 is a room only its own host can reach, so the
    /// address offered to joiners is never the loopback one while any other
    /// exists.
    #[test]
    fn the_announced_address_is_never_loopback() {
        if let Some(address) = lan_address_of(&local_addrs()) {
            assert_ne!(address, "127.0.0.1");
        }
    }

    /// The preference itself, on addresses this machine does not have.
    ///
    /// A private address wins because the reader is somebody in the same room,
    /// and it wins even when a public address is sitting beside it, which is the
    /// VPS with a Docker bridge on it. Right here and wrong to compare against
    /// STUN, which is what `Reachability::public_address_is_local` is for
    /// (issue #2111).
    #[test]
    fn the_announced_address_is_the_private_one_even_beside_a_public_one() {
        let of = |addrs: &[[u8; 4]]| {
            lan_address_of(
                &addrs
                    .iter()
                    .copied()
                    .map(Ipv4Addr::from)
                    .collect::<Vec<_>>(),
            )
        };
        assert_eq!(
            of(&[[172, 17, 0, 1], [209, 35, 91, 246]]).as_deref(),
            Some("172.17.0.1")
        );
        assert_eq!(of(&[[209, 35, 91, 246]]).as_deref(), Some("209.35.91.246"));
        assert_eq!(
            of(&[[127, 0, 0, 1], [192, 168, 1, 45]]).as_deref(),
            Some("192.168.1.45")
        );
        // Nothing but loopback is no answer at all rather than an answer only
        // this machine can use. `Room::listen` holds the 127.0.0.1 fallback, so
        // the choice is not made twice, and a room already running keeps the
        // address it had rather than moving to loopback.
        assert_eq!(of(&[[127, 0, 0, 1]]), None);
        assert_eq!(of(&[]), None);
    }

    /// The netmask is the whole reason for enumerating: a beacon goes to the
    /// broadcast address of the network it is leaving by, and a /24 is not the
    /// only shape a network comes in.
    #[test]
    fn a_beacon_is_addressed_to_its_own_subnets_broadcast() {
        let net = |addr: [u8; 4], prefix_len| LocalNet {
            addr: Ipv4Addr::from(addr),
            prefix_len,
            gateway: None,
        };
        assert_eq!(
            net([192, 168, 1, 45], 24).broadcast(),
            Ipv4Addr::new(192, 168, 1, 255)
        );
        assert_eq!(
            net([10, 12, 5, 9], 22).broadcast(),
            Ipv4Addr::new(10, 12, 7, 255)
        );
        assert_eq!(
            net([172, 16, 4, 200], 16).broadcast(),
            Ipv4Addr::new(172, 16, 255, 255)
        );
    }

    /// A tunnel handed a single address has no subnet to broadcast to, so it
    /// sends where everything sent before there was a netmask to read.
    #[test]
    fn an_address_with_no_subnet_falls_back_to_the_limited_broadcast() {
        for prefix_len in [31, 32] {
            let net = LocalNet {
                addr: Ipv4Addr::new(100, 88, 3, 4),
                prefix_len,
                gateway: None,
            };
            assert_eq!(net.broadcast(), Ipv4Addr::BROADCAST);
            assert!(net.ends().is_empty());
        }
    }

    /// Both ends of the real subnet, which on anything other than a /24 is not
    /// what counting to 254 would have given.
    #[test]
    fn the_ends_of_a_subnet_are_its_own_and_not_a_slash_24s() {
        let net = LocalNet {
            addr: Ipv4Addr::new(10, 12, 5, 9),
            prefix_len: 22,
            gateway: None,
        };
        assert_eq!(
            net.ends(),
            vec![Ipv4Addr::new(10, 12, 4, 1), Ipv4Addr::new(10, 12, 7, 254)]
        );
    }

    /// Enumeration says what the OS says, and the OS always has loopback, so an
    /// empty answer means the enumeration itself is broken.
    #[test]
    fn every_address_enumerated_carries_the_network_it_is_on() {
        let nets = local_nets();
        assert!(!nets.is_empty());
        for net in &nets {
            assert!(net.prefix_len <= 32, "{net:?} has an impossible prefix");
            assert!(!net.addr.is_unspecified());
        }
    }

    /// A host choosing between a VPN's address and the one the person next to
    /// them can reach has only the interface name to choose on, so an address
    /// with no name against it is no better than the list this replaced.
    #[test]
    fn every_address_a_host_is_shown_names_its_interface() {
        let addresses = local_addresses();
        assert_eq!(addresses.len(), local_nets().len());
        for address in &addresses {
            assert!(
                !address.interface.is_empty(),
                "{address:?} has no interface"
            );
            assert!(!address.address.is_empty());
        }
        assert!(addresses.iter().any(|a| a.loopback));
        assert!(addresses.last().is_some_and(|a| a.loopback));
    }
}
