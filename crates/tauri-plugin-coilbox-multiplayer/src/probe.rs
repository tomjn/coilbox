//! A one-datagram reachability probe against a battle host's game port.
//!
//! The engine's netcode is UDP, so a TCP connect test would fail against every
//! working host. UDP gives no handshake to lean on either: a host that is up and
//! listening answers an unrecognised datagram with silence, exactly like a host
//! whose port is not forwarded. The probe can only speak to the opposite case. A
//! machine that is reachable but has nothing bound to the port answers with an
//! ICMP port-unreachable, which a connected socket surfaces on the next read as
//! `ConnectionRefused` (`ConnectionReset` on Windows).
//!
//! So [`Outcome::Refused`] and [`Outcome::Unresolved`] are hard negatives worth
//! telling the player about, and [`Outcome::Silent`] means nothing at all. The
//! caller must not report silence as a failure.

use std::io;
use std::net::{ToSocketAddrs, UdpSocket};
use std::time::Duration;

use picoframe_core::CliResult;
use serde_json::json;

/// How long to wait for a reply before giving up on the probe. An ICMP
/// port-unreachable comes back within one round trip, so this only has to cover
/// a slow link rather than any engine-side work. Every launch into a healthy
/// host pays it in full, hence the tight bound.
pub const PROBE_TIMEOUT: Duration = Duration::from_millis(700);

/// What a probe found out about the host's game port.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// The address does not resolve, so the engine cannot connect either.
    Unresolved,
    /// The machine is reachable and refused the datagram: nothing is listening.
    Refused,
    /// No answer. Expected from a healthy host, and equally what a dropped
    /// packet looks like. Proves nothing either way.
    Silent,
    /// Something answered, so the port is both reachable and live.
    Replied,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Unresolved => "unresolved",
            Outcome::Refused => "refused",
            Outcome::Silent => "silent",
            Outcome::Replied => "replied",
        }
    }
}

/// Map the result of reading from the connected socket onto an [`Outcome`].
/// Split out from the socket work so the mapping is testable without a network.
fn classify(read: io::Result<usize>) -> Outcome {
    match read {
        Ok(_) => Outcome::Replied,
        Err(e) => match e.kind() {
            // The remote host bounced us with ICMP port-unreachable. POSIX
            // reports refused, Windows reports reset, both mean the same here.
            io::ErrorKind::ConnectionRefused | io::ErrorKind::ConnectionReset => Outcome::Refused,
            // Anything else, timeouts included, tells us nothing.
            _ => Outcome::Silent,
        },
    }
}

/// Send one empty datagram to `host:port` and classify what comes back. Blocking,
/// bounded by `timeout`. An empty datagram is the least intrusive thing we can
/// send: the engine's listener drops any packet that is not a valid connection
/// attempt, so a live host is untouched by the probe.
pub fn probe(host: &str, port: u16, timeout: Duration) -> Outcome {
    let Ok(mut addrs) = (host, port).to_socket_addrs() else {
        return Outcome::Unresolved;
    };
    let Some(target) = addrs.next() else {
        return Outcome::Unresolved;
    };
    let bind = if target.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    };
    let Ok(sock) = UdpSocket::bind(bind) else {
        return Outcome::Silent;
    };
    if sock.connect(target).is_err() || sock.set_read_timeout(Some(timeout)).is_err() {
        return Outcome::Silent;
    }
    if let Err(e) = sock.send(&[]) {
        return classify(Err(e));
    }
    let mut buf = [0u8; 64];
    classify(sock.recv(&mut buf))
}

/// `mp_probe_host`: ask whether a battle host's game port refuses us outright.
///
/// Read the module docs above before acting on the result. Only `refused` and
/// `unresolved` mean anything. `silent` is the normal answer from a perfectly
/// healthy host, so it must never be surfaced as a problem.
#[tauri::command]
pub(crate) async fn mp_probe_host(host: String, port: u16) -> CliResult {
    let outcome =
        tauri::async_runtime::spawn_blocking(move || probe(&host, port, PROBE_TIMEOUT).as_str())
            .await;
    match outcome {
        Ok(o) => CliResult::ok(json!({ "outcome": o })),
        Err(e) => CliResult::err(format!("probe failed to run: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err(kind: io::ErrorKind) -> io::Result<usize> {
        Err(io::Error::new(kind, "test"))
    }

    #[test]
    fn a_reply_means_the_port_is_live() {
        assert_eq!(classify(Ok(12)), Outcome::Replied);
    }

    #[test]
    fn both_platforms_refusal_kinds_map_to_refused() {
        assert_eq!(
            classify(err(io::ErrorKind::ConnectionRefused)),
            Outcome::Refused
        );
        assert_eq!(
            classify(err(io::ErrorKind::ConnectionReset)),
            Outcome::Refused
        );
    }

    #[test]
    fn a_timeout_proves_nothing() {
        assert_eq!(classify(err(io::ErrorKind::WouldBlock)), Outcome::Silent);
        assert_eq!(classify(err(io::ErrorKind::TimedOut)), Outcome::Silent);
        assert_eq!(classify(err(io::ErrorKind::Other)), Outcome::Silent);
    }

    #[test]
    fn an_unresolvable_host_needs_no_socket() {
        let out = probe("host.invalid.", 8452, Duration::from_millis(50));
        assert_eq!(out, Outcome::Unresolved);
    }

    #[test]
    fn outcome_names_are_stable_across_the_ipc_boundary() {
        assert_eq!(Outcome::Refused.as_str(), "refused");
        assert_eq!(Outcome::Silent.as_str(), "silent");
        assert_eq!(Outcome::Replied.as_str(), "replied");
        assert_eq!(Outcome::Unresolved.as_str(), "unresolved");
    }
}
