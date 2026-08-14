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
//! # Hand rolled on purpose
//!
//! This is a binding request and the one attribute that comes back in it: about
//! sixty lines of RFC 5389. Every STUN crate on the registry carries the ICE and
//! TURN machinery that makes STUN worth a library, and none of it is ever used
//! here.
//!
//! # Confirming the mapping rather than only reading the address
//!
//! The request goes out of the port that was just mapped, when that port can be
//! bound. The reflexive port that comes back is then the port the world reaches
//! this machine on, so a reply saying 8452 is the router confirming the mapping
//! in a way its own SOAP response cannot. A different port is not proof of
//! failure, because some routers hand an outbound flow its own mapping
//! regardless, so it is reported as a signal and not as a verdict.

use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::time::Duration;

use serde::Serialize;
use tokio::net::UdpSocket;

/// Binding request. RFC 5389 section 6, message type 0x0001.
const BINDING_REQUEST: u16 = 0x0001;

/// Binding success response, which is the only reply worth reading. An error
/// response is 0x0111 and is rejected along with everything else.
const BINDING_SUCCESS: u16 = 0x0101;

/// RFC 5389 section 6. Present in every message, and its absence marks a reply
/// from something that is not a STUN server.
const MAGIC_COOKIE: u32 = 0x2112_A442;

/// XOR-MAPPED-ADDRESS. RFC 5389 section 15.2.
const XOR_MAPPED_ADDRESS: u16 = 0x0020;

/// Address family IPv4, inside XOR-MAPPED-ADDRESS.
const FAMILY_IPV4: u8 = 0x01;

/// A request is a header and nothing else: 2 type, 2 length, 4 cookie, 12
/// transaction id.
const HEADER_LEN: usize = 20;

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

/// Build a binding request. Pure.
pub fn encode_request(transaction: &[u8; 12]) -> [u8; HEADER_LEN] {
    let mut out = [0u8; HEADER_LEN];
    out[0..2].copy_from_slice(&BINDING_REQUEST.to_be_bytes());
    // Length counts the attributes after the header, and a binding request
    // carries none.
    out[2..4].copy_from_slice(&0u16.to_be_bytes());
    out[4..8].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
    out[8..20].copy_from_slice(transaction);
    out
}

/// Read the reflexive address out of a reply, or `None` if this is not the reply
/// we asked for. Pure.
///
/// Rejects, in order: a datagram too short to be a STUN message, anything that
/// is not a binding success, a missing magic cookie, a transaction id that
/// belongs to a different request, a stated length that runs off the end, an
/// attribute that runs off the end, and an address family that is not IPv4.
///
/// The transaction id check is what makes this safe on a socket that is not
/// exclusively ours: a late reply from the server we gave up on, or a datagram
/// from anybody who knows the port, is somebody else's message and is dropped.
pub fn decode_response(bytes: &[u8], transaction: &[u8; 12]) -> Option<Reflexive> {
    if bytes.len() < HEADER_LEN {
        return None;
    }
    let kind = u16::from_be_bytes([bytes[0], bytes[1]]);
    if kind != BINDING_SUCCESS {
        return None;
    }
    let stated = u16::from_be_bytes([bytes[2], bytes[3]]) as usize;
    if u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) != MAGIC_COOKIE {
        return None;
    }
    if &bytes[8..20] != transaction {
        return None;
    }
    let body = bytes.get(HEADER_LEN..HEADER_LEN + stated)?;

    let mut at = 0usize;
    while at + 4 <= body.len() {
        let attribute = u16::from_be_bytes([body[at], body[at + 1]]);
        let len = u16::from_be_bytes([body[at + 2], body[at + 3]]) as usize;
        let value = body.get(at + 4..at + 4 + len)?;
        if attribute == XOR_MAPPED_ADDRESS {
            return decode_xor_mapped(value);
        }
        // Attributes are padded to a four byte boundary, and the padding is not
        // counted in the stated length.
        at += 4 + len + (4 - len % 4) % 4;
    }
    None
}

/// The XOR-MAPPED-ADDRESS value: 1 reserved, 1 family, 2 port, 4 address, each
/// of the last two exclusive-ored with the cookie. RFC 5389 section 15.2.
fn decode_xor_mapped(value: &[u8]) -> Option<Reflexive> {
    if value.len() < 8 || value[1] != FAMILY_IPV4 {
        return None;
    }
    let port = u16::from_be_bytes([value[2], value[3]]) ^ (MAGIC_COOKIE >> 16) as u16;
    let ip = u32::from_be_bytes([value[4], value[5], value[6], value[7]]) ^ MAGIC_COOKIE;
    Some(Reflexive {
        ip: Ipv4Addr::from(ip),
        port,
    })
}

/// A transaction id for one request.
///
/// It has to be different from the last one and hard to guess off the wire, and
/// it does not have to be cryptographic: all it separates is our reply from a
/// stale one on the same socket. `RandomState` is seeded per instance by the
/// operating system, which is enough for that and costs no dependency.
fn transaction_id() -> [u8; 12] {
    use std::hash::{BuildHasher, Hasher};
    let one = std::collections::hash_map::RandomState::new()
        .build_hasher()
        .finish()
        .to_be_bytes();
    let two = std::collections::hash_map::RandomState::new()
        .build_hasher()
        .finish()
        .to_be_bytes();
    let mut id = [0u8; 12];
    id[..8].copy_from_slice(&one);
    id[8..].copy_from_slice(&two[..4]);
    id
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
    let transaction = transaction_id();
    let request = encode_request(&transaction);
    tokio::time::timeout(PER_SERVER_TIMEOUT, async {
        socket.send_to(&request, server).await.ok()?;
        let mut buf = vec![0u8; MAX_REPLY];
        loop {
            let (len, _) = socket.recv_from(&mut buf).await.ok()?;
            if let Some(found) = decode_response(&buf[..len], &transaction) {
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

    fn tid() -> [u8; 12] {
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    }

    /// A success response carrying one XOR-MAPPED-ADDRESS, built the way a
    /// server builds it so the decoder is tested against the encoding and not
    /// against itself.
    fn reply(kind: u16, cookie: u32, transaction: &[u8; 12], ip: Ipv4Addr, port: u16) -> Vec<u8> {
        let mut value = vec![0u8, FAMILY_IPV4];
        value.extend_from_slice(&(port ^ (MAGIC_COOKIE >> 16) as u16).to_be_bytes());
        value.extend_from_slice(&(u32::from(ip) ^ MAGIC_COOKIE).to_be_bytes());
        let mut attribute = XOR_MAPPED_ADDRESS.to_be_bytes().to_vec();
        attribute.extend_from_slice(&(value.len() as u16).to_be_bytes());
        attribute.extend_from_slice(&value);

        let mut out = kind.to_be_bytes().to_vec();
        out.extend_from_slice(&(attribute.len() as u16).to_be_bytes());
        out.extend_from_slice(&cookie.to_be_bytes());
        out.extend_from_slice(transaction);
        out.extend_from_slice(&attribute);
        out
    }

    #[test]
    fn a_request_is_a_header_with_the_cookie_and_our_transaction_in_it() {
        let request = encode_request(&tid());
        assert_eq!(request.len(), 20);
        assert_eq!(
            u16::from_be_bytes([request[0], request[1]]),
            BINDING_REQUEST
        );
        // No attributes, so no length.
        assert_eq!(u16::from_be_bytes([request[2], request[3]]), 0);
        assert_eq!(
            u32::from_be_bytes([request[4], request[5], request[6], request[7]]),
            MAGIC_COOKIE
        );
        assert_eq!(&request[8..20], &tid());
    }

    #[test]
    fn a_success_response_gives_back_the_address_and_port() {
        let ip = Ipv4Addr::new(209, 35, 91, 246);
        let bytes = reply(BINDING_SUCCESS, MAGIC_COOKIE, &tid(), ip, 8452);
        assert_eq!(
            decode_response(&bytes, &tid()),
            Some(Reflexive { ip, port: 8452 })
        );
    }

    /// The reply that is not what we asked for. On a socket bound to a known
    /// port anybody can send us one, and a late reply from the server we gave up
    /// on is the innocent version of the same thing.
    #[test]
    fn a_reply_to_somebody_elses_request_is_ignored() {
        let bytes = reply(
            BINDING_SUCCESS,
            MAGIC_COOKIE,
            &[9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9],
            Ipv4Addr::new(1, 2, 3, 4),
            1234,
        );
        assert_eq!(decode_response(&bytes, &tid()), None);
    }

    #[test]
    fn an_error_response_is_not_read_as_an_address() {
        let bytes = reply(0x0111, MAGIC_COOKIE, &tid(), Ipv4Addr::new(1, 2, 3, 4), 1);
        assert_eq!(decode_response(&bytes, &tid()), None);
    }

    /// Without the cookie this is not a STUN message, whatever else it looks
    /// like.
    #[test]
    fn a_message_with_the_wrong_magic_cookie_is_ignored() {
        let bytes = reply(BINDING_SUCCESS, 0xDEAD_BEEF, &tid(), Ipv4Addr::LOCALHOST, 1);
        assert_eq!(decode_response(&bytes, &tid()), None);
    }

    #[test]
    fn a_datagram_too_short_to_be_stun_is_ignored() {
        for len in 0..HEADER_LEN {
            assert_eq!(decode_response(&vec![0u8; len], &tid()), None);
        }
    }

    /// A stated length longer than the datagram is a truncated or a hostile
    /// message, and reading it would be reading past the buffer.
    #[test]
    fn a_length_that_runs_off_the_end_is_ignored() {
        let mut bytes = reply(
            BINDING_SUCCESS,
            MAGIC_COOKIE,
            &tid(),
            Ipv4Addr::LOCALHOST,
            1,
        );
        bytes[2..4].copy_from_slice(&999u16.to_be_bytes());
        assert_eq!(decode_response(&bytes, &tid()), None);
    }

    /// An attribute whose own length runs past the stated body, which is the
    /// same read past the end one level down.
    #[test]
    fn an_attribute_that_runs_off_the_end_is_ignored() {
        let mut bytes = reply(
            BINDING_SUCCESS,
            MAGIC_COOKIE,
            &tid(),
            Ipv4Addr::LOCALHOST,
            1,
        );
        // The attribute's length field, at the start of the body.
        bytes[HEADER_LEN + 2..HEADER_LEN + 4].copy_from_slice(&200u16.to_be_bytes());
        assert_eq!(decode_response(&bytes, &tid()), None);
    }

    /// Attributes are padded to four bytes and the padding is not counted, so a
    /// short one before the address has to be stepped over correctly or the
    /// walk lands mid-attribute and finds nothing.
    #[test]
    fn a_padded_attribute_before_the_address_is_stepped_over() {
        let ip = Ipv4Addr::new(81, 2, 3, 4);
        let tail = reply(BINDING_SUCCESS, MAGIC_COOKIE, &tid(), ip, 8200);
        // SOFTWARE (0x8022), five bytes of value, three of padding.
        let mut first = vec![0x80u8, 0x22, 0x00, 0x05];
        first.extend_from_slice(b"hello");
        first.extend_from_slice(&[0, 0, 0]);

        let mut bytes = tail[..HEADER_LEN].to_vec();
        bytes.extend_from_slice(&first);
        bytes.extend_from_slice(&tail[HEADER_LEN..]);
        let body = (bytes.len() - HEADER_LEN) as u16;
        bytes[2..4].copy_from_slice(&body.to_be_bytes());

        assert_eq!(
            decode_response(&bytes, &tid()),
            Some(Reflexive { ip, port: 8200 })
        );
    }

    /// A success response with no address in it at all, which is what a server
    /// answering a request it did not understand looks like.
    #[test]
    fn a_response_with_no_address_attribute_gives_nothing() {
        let mut bytes = encode_request(&tid()).to_vec();
        bytes[0..2].copy_from_slice(&BINDING_SUCCESS.to_be_bytes());
        assert_eq!(decode_response(&bytes, &tid()), None);
    }

    /// IPv6 has no NAT to traverse and nothing here can use the answer, so it is
    /// not read as an IPv4 address by accident.
    #[test]
    fn an_ipv6_address_is_not_read_as_ipv4() {
        let mut value = vec![0u8, 0x02];
        value.extend_from_slice(&[0u8; 18]);
        let mut bytes = XOR_MAPPED_ADDRESS.to_be_bytes().to_vec();
        bytes.extend_from_slice(&(value.len() as u16).to_be_bytes());
        bytes.extend_from_slice(&value);

        let mut message = BINDING_SUCCESS.to_be_bytes().to_vec();
        message.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
        message.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
        message.extend_from_slice(&tid());
        message.extend_from_slice(&bytes);
        assert_eq!(decode_response(&message, &tid()), None);
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
        assert_ne!(transaction_id(), transaction_id());
    }
}
