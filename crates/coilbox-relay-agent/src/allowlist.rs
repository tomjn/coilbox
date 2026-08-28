//! Letting a joiner through the relay before they have ever sent anything.
//!
//! A TURN server drops traffic from any address the allocation has no
//! permission for, silently, with nothing sent back (RFC 5766 section 8). In a
//! relayed battle the joiner sends first, so without a permission already in
//! place their opening packets vanish and the join looks broken for no visible
//! reason. This module is what stops that.
//!
//! ## Why it sends a byte rather than asking
//!
//! The `turn` crate installs a permission on the first send to an address.
//! `RelayConn::send_to` looks the address up in its permission map, and
//! `create_perm` issues the CreatePermission for one that is not there yet
//! (`client/relay_conn.rs:214-232`, `:368-378`). `create_permissions` itself is
//! private (`:392`), so a send is the only way in from outside the crate.
//!
//! That leaves sending something to a player whose engine is not expecting it
//! yet, which is fine as long as what we send is small enough to be thrown
//! away. It is. Both of the engine's receive paths, `UDPListener::Update` for a
//! host socket and `UDPConnection::Update` for a client one, drop a datagram
//! shorter than `Packet::headerSize` before looking at it at all
//! (`rts/System/Net/UDPListener.cpp:143-144` and
//! `rts/System/Net/UDPConnection.cpp:459-460`), and that header is 6 bytes
//! (`rts/System/Net/UDPConnection.h:46`).
//!
//! One byte and not zero, though. Both of those loops are driven by
//! `socket->available() > 0`, so a zero length datagram would never be taken
//! off the queue at all. One byte is the smallest thing that is definitely read
//! and definitely discarded.
//!
//! The other way out of this would be getting `create_permissions` made public
//! upstream, which is cleaner and puts the work behind somebody else's release.
//! Issue #2015 weighed that and chose the byte.
//!
//! ## Why the list outlives any one relay
//!
//! A permission belongs to an allocation. Rebuild the allocation and the new
//! one has an empty permission table, so everybody coilbox has already vouched
//! for has to be let through again. Keeping the list here, outside the relay,
//! is what makes that possible, and it is the same reasoning that keeps the
//! peer table in [`crate::demux`] outside the relay.
//!
//! Keeping a permission alive after that is the `turn` crate's job and it does
//! it: once an address is in its permission map it re-sends CreatePermission
//! for every address on a 120 second timer (`client/relay_conn.rs:27`,
//! `:519-530`), against the 5 minute permission lifetime in RFC 5766
//! section 8. Nothing removes an address from that map on success, so a player
//! stays allowed through for as long as the allocation lasts.

use std::collections::BTreeSet;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;

use crate::relay::RelayLink;

/// The datagram sent to install a permission.
///
/// One byte, because the engine discards anything under its 6 byte packet
/// header and never sees a zero length one at all. The value is not read by
/// anything, on any path, so it carries nothing.
const PROBE: [u8; 1] = [0];

/// The port the probe is addressed to.
///
/// Any port would do. A TURN permission is per-IP and the port is ignored
/// (RFC 5766 section 9.1), which the `turn` crate agrees with in both
/// directions: its server keys permissions on `addr.ip().to_string()`
/// (`allocation/mod.rs:94-96`) and its client refreshes them at port 0
/// (`client/permission.rs`, `addrs`). So this is only here because a datagram
/// has to be addressed somewhere, and it is the bottom of the dynamic port
/// range from RFC 6335 section 6, which is the range least likely to be a
/// service a firewall cares about somebody knocking on.
const PROBE_PORT: u16 = 49152;

/// Everybody coilbox has vouched for.
///
/// Deliberately not bounded, unlike the peer table in [`crate::demux`]. That
/// one is bounded because the relay is a stranger and could invent peers until
/// the agent runs out of file descriptors. This one only grows when the process
/// that started this one says so, an address costs nothing to hold, and a
/// player whose address changes mid-game legitimately adds a second entry
/// (issue #2029), so a ceiling here would refuse honest joins to defend against
/// nothing.
#[derive(Default)]
pub struct Allowlist {
    allowed: Mutex<BTreeSet<IpAddr>>,
}

impl Allowlist {
    pub fn new() -> Allowlist {
        Allowlist::default()
    }

    /// Note that `ip` may reach this relay, from now until the process ends.
    pub fn remember(&self, ip: IpAddr) {
        self.allowed.lock().unwrap().insert(ip);
    }

    /// Everybody on the list, for a relay that has just been opened and has no
    /// permissions on it yet.
    pub fn everybody(&self) -> Vec<IpAddr> {
        self.allowed.lock().unwrap().iter().copied().collect()
    }
}

/// Everything one "let this address through" request means: put `ip` on the
/// list, and let it through the relay that is open now.
///
/// Both halves, and in that order, because they answer different questions. The
/// list is what makes the player survive a rebuilt relay, and the send is what
/// makes them able to join the one that is up. A failed send does not take the
/// address off the list, because it is the relay that failed and not the
/// player: coilbox has vouched for them, and the next relay has to try again.
pub async fn allow<R: RelayLink>(relay: &R, allowlist: &Allowlist, ip: IpAddr) -> io::Result<()> {
    allowlist.remember(ip);
    let_through(relay, ip).await
}

/// Let `ip` through `relay`, by sending them something their engine will throw
/// away.
async fn let_through<R: RelayLink>(relay: &R, ip: IpAddr) -> io::Result<()> {
    relay
        .send_to(&PROBE, SocketAddr::new(ip, PROBE_PORT))
        .await
        .map(|_| ())
}

/// Let everybody on the list through a relay that has just opened.
///
/// Called for every relay, not only rebuilt ones, because a new allocation
/// starts with an empty permission table and the players on this list are
/// already mid-game. Miss it and a reconnect that was meant to save them cuts
/// every one of them off instead.
///
/// A failure is the relay's and not the player's, so it is reported and the
/// address stays on the list for the next relay to try.
pub async fn let_everybody_through<R: RelayLink>(relay: &R, allowlist: &Allowlist) {
    for ip in allowlist.everybody() {
        if let Err(e) = let_through(relay, ip).await {
            eprintln!("coilbox-relay-agent: could not let {ip} through the new relay: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    /// A relay that writes down what it was asked to send.
    ///
    /// The other tests in this crate drive real sockets, because there the
    /// property under test is what a socket does. Here it is the opposite: the
    /// property is what this agent sends, and to whom, before anything has
    /// arrived. A real socket cannot be asked that, and the far end is a TURN
    /// server's permission table, which is what issue #2025 stands up coturn
    /// for.
    #[derive(Default)]
    struct Recorded {
        sent: Mutex<Vec<(SocketAddr, Vec<u8>)>>,
        /// When set, every send fails with this, which is what a relay that has
        /// gone away underneath us does.
        broken: Option<String>,
    }

    impl Recorded {
        fn addressees(&self) -> Vec<IpAddr> {
            self.sent
                .lock()
                .unwrap()
                .iter()
                .map(|(a, _)| a.ip())
                .collect()
        }

        fn payloads(&self) -> Vec<Vec<u8>> {
            self.sent
                .lock()
                .unwrap()
                .iter()
                .map(|(_, p)| p.clone())
                .collect()
        }
    }

    impl RelayLink for Recorded {
        async fn recv_from(&self, _buf: &mut [u8]) -> io::Result<(usize, SocketAddr)> {
            // Nothing in this module reads, and a relay with nothing to say
            // waiting forever is a truer double than one that invents traffic.
            std::future::pending().await
        }

        async fn send_to(&self, buf: &[u8], peer: SocketAddr) -> io::Result<usize> {
            match &self.broken {
                Some(why) => Err(io::Error::other(why.clone())),
                None => {
                    self.sent.lock().unwrap().push((peer, buf.to_vec()));
                    Ok(buf.len())
                }
            }
        }
    }

    fn joiner(last: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(198, 51, 100, last))
    }

    /// The point of the module: something goes to the joiner before the joiner
    /// has sent anything, because that send is what installs the permission.
    /// And they go on the list, because the relay they were let through is not
    /// the last relay this battle will have.
    #[tokio::test]
    async fn a_joiner_is_sent_something_before_they_have_said_a_word() {
        let relay = Recorded::default();
        let allowlist = Allowlist::new();
        allow(&relay, &allowlist, joiner(4))
            .await
            .expect("a working relay takes the probe");
        assert_eq!(relay.addressees(), vec![joiner(4)]);
        assert_eq!(allowlist.everybody(), vec![joiner(4)]);
    }

    /// The probe has to be a datagram the joiner's engine throws away, or
    /// letting somebody in would corrupt the connection it is letting them make.
    ///
    /// Both engine receive paths drop anything under `Packet::headerSize`
    /// (`UDPListener.cpp:143-144`, `UDPConnection.cpp:459-460`) and neither
    /// takes a zero length datagram off the queue at all, since both loop while
    /// `available() > 0`.
    #[tokio::test]
    async fn the_probe_is_small_enough_for_an_engine_to_discard() {
        const ENGINE_PACKET_HEADER: usize = 6;
        let relay = Recorded::default();
        allow(&relay, &Allowlist::new(), joiner(4))
            .await
            .expect("a working relay");

        let sent = relay.payloads();
        let probe = sent.first().expect("one probe went out");
        assert!(
            !probe.is_empty(),
            "a zero length datagram is never taken off the engine's receive queue"
        );
        assert!(
            probe.len() < ENGINE_PACKET_HEADER,
            "a probe of {} bytes reaches the engine's packet parser instead of being dropped",
            probe.len()
        );
    }

    /// A rebuilt allocation starts with an empty permission table, so everybody
    /// already vouched for has to be let through again. Miss this and every
    /// player in the game is cut off by a reconnect that was supposed to save
    /// them.
    #[tokio::test]
    async fn a_new_relay_lets_everybody_through_again() {
        let allowlist = Allowlist::new();
        allowlist.remember(joiner(4));
        allowlist.remember(joiner(5));

        let rebuilt = Recorded::default();
        let_everybody_through(&rebuilt, &allowlist).await;

        assert_eq!(rebuilt.addressees(), vec![joiner(4), joiner(5)]);
    }

    /// A probe that could not go out does not lose the player. The relay is
    /// what failed, and the next one has to let them through.
    #[tokio::test]
    async fn a_relay_that_will_not_send_leaves_the_joiner_on_the_list() {
        let allowlist = Allowlist::new();
        let broken = Recorded {
            broken: Some("the allocation is gone".to_string()),
            ..Recorded::default()
        };
        let refused = allow(&broken, &allowlist, joiner(4))
            .await
            .expect_err("a relay that is gone cannot let anybody through");
        assert!(refused.to_string().contains("the allocation is gone"));

        assert_eq!(
            allowlist.everybody(),
            vec![joiner(4)],
            "a failed probe is the relay's fault, so the player has to be tried again on the next one"
        );
    }

    /// Two joins from the same address are one permission. Nothing breaks if
    /// they were not, but a battle where four people share a house should not
    /// mean four entries and four probes every rebuild.
    #[tokio::test]
    async fn the_same_address_twice_is_one_entry() {
        let allowlist = Allowlist::new();
        allowlist.remember(joiner(4));
        allowlist.remember(joiner(4));
        assert_eq!(allowlist.everybody(), vec![joiner(4)]);
    }
}
