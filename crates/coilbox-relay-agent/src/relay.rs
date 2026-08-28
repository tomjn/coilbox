//! The one thing the demux needs from whatever is carrying relayed traffic:
//! read a datagram and be told who sent it, and send a datagram to a named
//! peer.
//!
//! That is deliberately the shape of `webrtc_util::Conn`, because a TURN
//! allocation is what will really be underneath this (issue #2014).
//! `Conn::recv_from` already hands back `(usize, SocketAddr)`, so the peer's
//! address comes free with the data and the demux needs no bookkeeping of its
//! own to work out who sent what.
//!
//! The trait exists so the tests can drive the demux with a plain UDP socket on
//! loopback rather than standing up a TURN server, and so #2014 can drop the
//! real allocation in without touching [`crate::demux`]. It is two methods and
//! it is meant to stay two methods.

use std::future::Future;
use std::io;
use std::net::SocketAddr;

use tokio::net::UdpSocket;

/// Something that carries opaque datagrams to and from remote peers, tagging
/// each one with the peer it belongs to.
///
/// Written with `impl Future` rather than `async fn` so the returned futures
/// can be required to be `Send`: the demux runs both directions inside one
/// `try_join!` on a multi-threaded runtime.
pub trait RelayLink {
    /// Wait for the next datagram from any peer, and say which peer sent it.
    fn recv_from(
        &self,
        buf: &mut [u8],
    ) -> impl Future<Output = io::Result<(usize, SocketAddr)>> + Send;

    /// Send one datagram to `peer`.
    fn send_to(
        &self,
        buf: &[u8],
        peer: SocketAddr,
    ) -> impl Future<Output = io::Result<usize>> + Send;
}

/// An unconnected UDP socket is already exactly this interface, which is what
/// makes it both the test double and a working transport for a relay that can
/// reach the host directly.
impl RelayLink for UdpSocket {
    fn recv_from(
        &self,
        buf: &mut [u8],
    ) -> impl Future<Output = io::Result<(usize, SocketAddr)>> + Send {
        UdpSocket::recv_from(self, buf)
    }

    fn send_to(
        &self,
        buf: &[u8],
        peer: SocketAddr,
    ) -> impl Future<Output = io::Result<usize>> + Send {
        UdpSocket::send_to(self, buf, peer)
    }
}
