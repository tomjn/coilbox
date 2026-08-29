//! One STUN round trip, to learn what the internet sees when this machine
//! speaks to it.
//!
//! A host who has just opened a port on their router still has nothing to send a
//! friend. The router knows its own address and will sometimes say so, but a
//! host behind a second layer of NAT gets an answer that is no use, and a host
//! whose router says nothing gets none at all. So the address is learned from
//! outside instead, by asking a public server what address the packet arrived
//! from.
//!
//! # What is ours and what is the `stun` crate's
//!
//! The wire is the crate's. Building the binding request, parsing the reply and
//! un-XOR-ing XOR-MAPPED-ADDRESS all go through `stun::message::Message`, which
//! arrived in the tree with the `turn` crate the relay agent takes.
//!
//! What is left here is the part no STUN library has an opinion about: which
//! servers to ask, in what order, how long to wait, and which socket the
//! question goes out of. The crate also has a `Client`, and it is not used: it
//! wants a `webrtc_util::Conn` and gives back one server, one transaction and no
//! rotation, which is less than the four lines below do.
//!
//! # Confirming the mapping rather than only reading the address
//!
//! The request goes out of the port that was just mapped, when that port can be
//! bound. The reflexive port that comes back is then the port the world reaches
//! this machine on, so a reply saying 8452 is the router confirming the mapping
//! in a way its own SOAP response cannot. A different port is not proof of
//! failure, because some routers hand an outbound flow its own mapping
//! regardless, so it is reported as a signal and not as a verdict.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::time::Duration;

use serde::Serialize;
use stun::agent::TransactionId;
use stun::message::{Getter, Message, BINDING_REQUEST, BINDING_SUCCESS};
use stun::xoraddr::XorMappedAddress;
use tokio::net::UdpSocket;

/// The largest reply this will read. A binding response is under a hundred bytes
/// and anything near this is somebody else's protocol.
const MAX_REPLY: usize = 1024;

/// How long one server is given before the next is tried.
///
/// A STUN server on the public internet answers in tens of milliseconds. Half a
/// second is a slow link, and a second and a half is a server that is not there.
const PER_SERVER_TIMEOUT: Duration = Duration::from_millis(1500);

/// The servers asked, in no particular order of preference.
///
/// Four operators rather than one, because a single hardcoded server is a single
/// point of failure and a single operator seeing every coilbox host's address.
/// All four were confirmed answering an RFC 5389 binding request with
/// XOR-MAPPED-ADDRESS on 2026-08-14.
pub const SERVERS: &[&str] = &[
    "stun.cloudflare.com:3478",
    "stun.l.google.com:19302",
    "stun.nextcloud.com:3478",
    "stun.sipgate.net:3478",
];

/// The order to ask them in on this run.
///
/// The same list rotated to start somewhere else each time, so a server being
/// down costs one timeout rather than being the reason nobody ever gets an
/// answer, and no one operator carries every coilbox host. Pure, so the rotation
/// can be tested without a socket.
pub fn server_order<'a>(servers: &[&'a str], start: usize) -> Vec<&'a str> {
    if servers.is_empty() {
        return Vec::new();
    }
    let start = start % servers.len();
    servers[start..]
        .iter()
        .chain(&servers[..start])
        .copied()
        .collect()
}

/// What the internet sees.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reflexive {
    /// The address this machine reaches the internet from.
    pub ip: Ipv4Addr,
    /// The port the request appeared to come from. Equal to the port it was
    /// sent from when the router preserved it, which is the mapping confirming
    /// itself.
    pub port: u16,
}

/// Build a binding request carrying `transaction`, as bytes ready to send.
///
/// A request is a header and no attributes, so the only thing being set here is
/// the transaction id, and the only reason to set it rather than let the crate
/// pick one is that [`decode_response`] has to be able to recognise the answer.
fn encode_request(transaction: TransactionId) -> Vec<u8> {
    let mut message = Message::new();
    // Neither setter can fail on an empty message, and a request that somehow
    // did not build would go out as an empty datagram, which is a server that
    // does not answer, which the rotation already handles.
    let _ = message.build(&[Box::new(transaction), Box::new(BINDING_REQUEST)]);
    message.raw
}

/// Read the reflexive address out of a reply, or `None` if this is not the reply
/// we asked for.
///
/// The crate's decoder throws out anything that is not a well formed STUN
/// message: too short for a header, no magic cookie, a stated length that runs
/// off the end, or an attribute that does. Left here are the three judgements
/// that are ours to make, and all three answer `None`. Anything that is not a
/// binding success, an error response included. A transaction id belonging to a
/// different request. An address that is not IPv4, which there is nothing here
/// that could dial.
///
/// The transaction id check is what makes this safe on a socket that is not
/// exclusively ours: a late reply from the server we gave up on, or a datagram
/// from anybody who knows the port, is somebody else's message and is dropped.
fn decode_response(bytes: &[u8], transaction: TransactionId) -> Option<Reflexive> {
    let mut message = Message::new();
    message.unmarshal_binary(bytes).ok()?;
    if message.typ != BINDING_SUCCESS || message.transaction_id != transaction {
        return None;
    }
    let mut address = XorMappedAddress::default();
    address.get_from(&message).ok()?;
    match address.ip {
        IpAddr::V4(ip) => Some(Reflexive {
            ip,
            port: address.port,
        }),
        IpAddr::V6(_) => None,
    }
}

/// Ask the internet what address it sees, sending from `from_port` when that
/// port can be bound.
///
/// `from_port` is the port whose mapping is being confirmed. Binding it fails
/// when something else already has it, which is not an error worth reporting: an
/// ephemeral port still learns the public address, and only the confirmation is
/// lost. `None` binds an ephemeral port outright.
///
/// Answers `None` only when every server in [`SERVERS`] failed to answer, which
/// is a host with no route to the internet, or one behind a firewall that eats
/// outbound UDP.
pub async fn public_address(from_port: Option<u16>) -> Option<Reflexive> {
    let socket = bind(from_port).await?;
    let start = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos() as usize);
    for server in server_order(SERVERS, start) {
        if let Some(found) = ask(&socket, server).await {
            return Some(found);
        }
    }
    None
}

/// Bind the port whose mapping is being confirmed, falling back to an ephemeral
/// one.
async fn bind(from_port: Option<u16>) -> Option<UdpSocket> {
    let any = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0));
    if let Some(port) = from_port {
        let wanted = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port));
        if let Ok(socket) = UdpSocket::bind(wanted).await {
            return Some(socket);
        }
    }
    UdpSocket::bind(any).await.ok()
}

/// One request to one server, with one timeout.
///
/// Datagrams that are not the reply we asked for are read past rather than
/// treated as a failure, until the timeout covering the whole exchange runs out.
async fn ask(socket: &UdpSocket, server: &str) -> Option<Reflexive> {
    let transaction = TransactionId::new();
    let request = encode_request(transaction);
    tokio::time::timeout(PER_SERVER_TIMEOUT, async {
        socket.send_to(&request, server).await.ok()?;
        let mut buf = vec![0u8; MAX_REPLY];
        loop {
            let (len, _) = socket.recv_from(&mut buf).await.ok()?;
            if let Some(found) = decode_response(&buf[..len], transaction) {
                return Some(found);
            }
        }
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    use stun::attributes::ATTR_SOFTWARE;
    use stun::message::{MessageType, BINDING_ERROR, MESSAGE_HEADER_SIZE};
    use stun::textattrs::Software;

    fn tid() -> TransactionId {
        TransactionId([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    }

    /// A response carrying one XOR-MAPPED-ADDRESS, built the way a server builds
    /// it. The crate encodes and the crate decodes, so what these tests ask is
    /// whether our three judgements survive a round trip, and whether the crate
    /// throws out the datagrams the hand rolled decoder used to throw out for
    /// itself.
    fn reply(kind: MessageType, transaction: TransactionId, ip: IpAddr, port: u16) -> Vec<u8> {
        let mut message = Message::new();
        message
            .build(&[
                Box::new(transaction),
                Box::new(kind),
                Box::new(XorMappedAddress { ip, port }),
            ])
            .expect("a reply with one address in it is buildable");
        message.raw
    }

    fn v4(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    #[test]
    fn a_request_is_a_header_with_the_cookie_and_our_transaction_in_it() {
        let request = encode_request(tid());
        assert_eq!(request.len(), MESSAGE_HEADER_SIZE);

        let mut read_back = Message::new();
        read_back
            .unmarshal_binary(&request)
            .expect("our own request decodes, cookie and all");
        assert_eq!(read_back.typ, BINDING_REQUEST);
        assert_eq!(read_back.transaction_id, tid());
        // No attributes, so no length.
        assert_eq!(read_back.length, 0);
    }

    #[test]
    fn a_success_response_gives_back_the_address_and_port() {
        let bytes = reply(BINDING_SUCCESS, tid(), v4(209, 35, 91, 246), 8452);
        assert_eq!(
            decode_response(&bytes, tid()),
            Some(Reflexive {
                ip: Ipv4Addr::new(209, 35, 91, 246),
                port: 8452
            })
        );
    }

    /// The reply that is not what we asked for. On a socket bound to a known
    /// port anybody can send us one, and a late reply from the server we gave up
    /// on is the innocent version of the same thing.
    #[test]
    fn a_reply_to_somebody_elses_request_is_ignored() {
        let theirs = TransactionId([9; 12]);
        let bytes = reply(BINDING_SUCCESS, theirs, v4(1, 2, 3, 4), 1234);
        assert_eq!(decode_response(&bytes, tid()), None);
    }

    #[test]
    fn an_error_response_is_not_read_as_an_address() {
        let bytes = reply(BINDING_ERROR, tid(), v4(1, 2, 3, 4), 1);
        assert_eq!(decode_response(&bytes, tid()), None);
    }

    /// Without the cookie this is not a STUN message, whatever else it looks
    /// like.
    #[test]
    fn a_message_with_the_wrong_magic_cookie_is_ignored() {
        let mut bytes = reply(BINDING_SUCCESS, tid(), v4(127, 0, 0, 1), 1);
        bytes[4..8].copy_from_slice(&0xDEAD_BEEFu32.to_be_bytes());
        assert_eq!(decode_response(&bytes, tid()), None);
    }

    #[test]
    fn a_datagram_too_short_to_be_stun_is_ignored() {
        for len in 0..MESSAGE_HEADER_SIZE {
            assert_eq!(decode_response(&vec![0u8; len], tid()), None);
        }
    }

    /// A stated length longer than the datagram is a truncated or a hostile
    /// message, and reading it would be reading past the buffer.
    #[test]
    fn a_length_that_runs_off_the_end_is_ignored() {
        let mut bytes = reply(BINDING_SUCCESS, tid(), v4(127, 0, 0, 1), 1);
        bytes[2..4].copy_from_slice(&999u16.to_be_bytes());
        assert_eq!(decode_response(&bytes, tid()), None);
    }

    /// An attribute whose own length runs past the stated body, which is the
    /// same read past the end one level down.
    #[test]
    fn an_attribute_that_runs_off_the_end_is_ignored() {
        let mut bytes = reply(BINDING_SUCCESS, tid(), v4(127, 0, 0, 1), 1);
        // The attribute's length field, at the start of the body.
        bytes[MESSAGE_HEADER_SIZE + 2..MESSAGE_HEADER_SIZE + 4]
            .copy_from_slice(&200u16.to_be_bytes());
        assert_eq!(decode_response(&bytes, tid()), None);
    }

    /// Attributes are padded to four bytes and the padding is not counted in an
    /// attribute's own length, so a short one before the address has to be
    /// stepped over correctly or the walk lands mid-attribute and finds nothing.
    #[test]
    fn a_padded_attribute_before_the_address_is_stepped_over() {
        let mut message = Message::new();
        message
            .build(&[
                Box::new(tid()),
                Box::new(BINDING_SUCCESS),
                // Five bytes of value and three of padding.
                Box::new(Software::new(ATTR_SOFTWARE, "hello".to_string())),
                Box::new(XorMappedAddress {
                    ip: v4(81, 2, 3, 4),
                    port: 8200,
                }),
            ])
            .expect("a reply with two attributes in it is buildable");

        assert_eq!(
            decode_response(&message.raw, tid()),
            Some(Reflexive {
                ip: Ipv4Addr::new(81, 2, 3, 4),
                port: 8200
            })
        );
    }

    /// A success response with no address in it at all, which is what a server
    /// answering a request it did not understand looks like.
    #[test]
    fn a_response_with_no_address_attribute_gives_nothing() {
        let mut message = Message::new();
        message
            .build(&[Box::new(tid()), Box::new(BINDING_SUCCESS)])
            .expect("an empty success response is buildable");
        assert_eq!(decode_response(&message.raw, tid()), None);
    }

    /// IPv6 has no NAT to traverse and nothing here can use the answer, so it is
    /// not read as an IPv4 address by accident.
    #[test]
    fn an_ipv6_address_is_not_read_as_ipv4() {
        let bytes = reply(
            BINDING_SUCCESS,
            tid(),
            IpAddr::V6(std::net::Ipv6Addr::LOCALHOST),
            1,
        );
        assert_eq!(decode_response(&bytes, tid()), None);
    }

    /// Every server is asked exactly once, whatever the run starts on, so one
    /// being down costs a timeout and never the whole answer.
    #[test]
    fn the_rotation_asks_every_server_once() {
        for start in 0..12 {
            let order = server_order(SERVERS, start);
            assert_eq!(order.len(), SERVERS.len());
            let mut sorted = order.clone();
            sorted.sort_unstable();
            let mut expected = SERVERS.to_vec();
            expected.sort_unstable();
            assert_eq!(sorted, expected);
        }
    }

    #[test]
    fn the_rotation_starts_where_it_is_asked_to() {
        assert_eq!(server_order(&["a", "b", "c"], 0), vec!["a", "b", "c"]);
        assert_eq!(server_order(&["a", "b", "c"], 1), vec!["b", "c", "a"]);
        assert_eq!(server_order(&["a", "b", "c"], 5), vec!["c", "a", "b"]);
    }

    /// A start index against no servers must not divide by zero.
    #[test]
    fn an_empty_list_rotates_to_nothing() {
        assert!(server_order(&[], 3).is_empty());
    }

    #[test]
    fn two_transaction_ids_in_a_row_are_different() {
        assert_ne!(TransactionId::new(), TransactionId::new());
    }
}
