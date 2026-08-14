//! The sockets discovery runs on: one that announces a room every two seconds,
//! and one that listens for everybody else's.
//!
//! [`crate::beacon`] decides what is said. This decides where it goes.
//!
//! # Two transports, on purpose
//!
//! Every beacon is sent twice, once to the multicast group and once to the
//! broadcast address. They fail in different places, and neither is reliable
//! enough on its own:
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
//! Finding those addresses without an interface enumeration library is what
//! [`local_addrs`] is for.

use std::io;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use socket2::{Domain, Protocol, SockAddr, Socket, Type};
use tokio::net::UdpSocket;
use tokio::task::JoinHandle;

use crate::beacon::{decode, Directory, LanRoom, BEACON_GROUP, BEACON_PORT};

/// The largest datagram this will read. A beacon is a couple of hundred bytes
/// and anything near this is somebody else's protocol.
const MAX_DATAGRAM: usize = 2048;

/// Addresses used to ask the routing table which of this machine's addresses
/// would be used to reach a given network.
///
/// Connecting a UDP socket sends nothing: it only fixes a route and a source
/// address, which is then readable with `local_addr`. One probe per network a
/// LAN is normally on, plus a public address for whatever holds the default
/// route, plus link-local for two machines on one cable with no DHCP.
///
/// Private networks come first so the address a room announces itself at is the
/// one a neighbour on the LAN can reach, rather than the one a full tunnel VPN
/// handed out.
const PROBES: &[(Ipv4Addr, u16)] = &[
    (Ipv4Addr::new(192, 168, 0, 1), 53),
    (Ipv4Addr::new(192, 168, 1, 1), 53),
    (Ipv4Addr::new(10, 0, 0, 1), 53),
    (Ipv4Addr::new(172, 16, 0, 1), 53),
    (Ipv4Addr::new(169, 254, 1, 1), 53),
    (Ipv4Addr::new(1, 1, 1, 1), 53),
];

/// Every local IPv4 address a beacon should be sent from, loopback last.
///
/// Loopback is always in the list and is what makes two coilboxes on one machine
/// find each other with no network at all, which is also how discovery is
/// tested.
pub fn local_addrs() -> Vec<Ipv4Addr> {
    let mut found: Vec<Ipv4Addr> = Vec::new();
    for (ip, port) in PROBES {
        let Ok(socket) = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) else {
            continue;
        };
        // Fails with "network unreachable" when nothing routes there, which is
        // the answer rather than an error.
        if socket.connect((*ip, *port)).is_err() {
            continue;
        }
        let Ok(SocketAddr::V4(local)) = socket.local_addr() else {
            continue;
        };
        let local = *local.ip();
        if local.is_unspecified() || local.is_loopback() || found.contains(&local) {
            continue;
        }
        found.push(local);
    }
    found.push(Ipv4Addr::LOCALHOST);
    found
}

/// The address to tell a joining engine to connect to, or `None` when this
/// machine is on no network at all.
///
/// A private address first, because this is LAN hosting and a VPN's address is
/// no use to somebody in the same room. Announcing 127.0.0.1, which is what a
/// room did before it could announce anything, is a room only its own host can
/// reach.
pub fn lan_address() -> Option<String> {
    let addrs = local_addrs();
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
    for local in local_addrs() {
        let _ = send_from(local, payload);
    }
}

/// One beacon, from one of this machine's addresses, to both the group and the
/// broadcast address.
fn send_from(local: Ipv4Addr, payload: &[u8]) -> io::Result<()> {
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
    let broadcast = SockAddr::from(SocketAddrV4::new(Ipv4Addr::BROADCAST, BEACON_PORT));
    let sent_group = socket.send_to(payload, &group);
    let sent_broadcast = socket.send_to(payload, &broadcast);
    // Only a failure if neither transport left the machine.
    sent_group.or(sent_broadcast).map(|_| ())
}

/// The rooms this client can hear, kept up to date by a task of its own.
pub struct Discovery {
    rooms: Arc<Mutex<Directory>>,
    task: JoinHandle<()>,
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
        Ok(Discovery { rooms, task })
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
            dir.record(beacon, from.ip().to_string(), Instant::now());
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
        if let Some(address) = lan_address() {
            assert_ne!(address, "127.0.0.1");
        }
    }
}
