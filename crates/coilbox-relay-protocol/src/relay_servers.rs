//! Which TURN servers a relay can be opened on, and in what order (issue #1698).
//!
//! The lobby names its relay in `TURNCREDENTIALS` as one URI, or as several
//! joined with commas when it offers TURN over UDP and TURN over TLS both. None
//! of those can hold a space, so the reply keeps its four fields.
//!
//! coilbox reads the lobby's field with [`relay_servers`] and hands the agent
//! [`to_arg`] of the answer, and the agent reads that back with the same
//! function. One parser for both ends means a list coilbox accepted is a list
//! the agent can open.
//!
//! Plain UDP always comes first, whatever order the lobby named them in. TLS
//! adds a TCP connection and a handshake under every datagram, so it is the
//! fallback for a network that drops UDP, not a choice.

/// The scheme RFC 7065 gives TURN over TLS.
const TLS_SCHEME: &str = "turns:";
/// The scheme for plain TURN, which is optional here. A bare `host:port` reads
/// the same.
const PLAIN_SCHEME: &str = "turn:";

/// One TURN server the agent can allocate on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RelayServer {
    /// `host:port`, as the TURN client resolves it.
    pub addr: String,
    /// Whether the agent reaches it over TLS rather than plain UDP.
    pub tls: bool,
}

/// The servers `list` names, plain UDP first.
///
/// `list` is one URI or several joined with commas, each `turn:host:port`,
/// `turns:host:port` or a bare `host:port`. A `?transport=` on the end is
/// dropped: `turn:` is carried over UDP and `turns:` over TLS, and there is
/// nothing else to select.
///
/// The error is a sentence about the entry that was wrong, for the host.
pub fn relay_servers(list: &str) -> Result<Vec<RelayServer>, String> {
    let mut servers = list
        .split(',')
        .map(relay_server)
        .collect::<Result<Vec<_>, _>>()?;
    // Stable, so two servers of the same kind keep the lobby's order.
    servers.sort_by_key(|server| server.tls);
    Ok(servers)
}

fn relay_server(uri: &str) -> Result<RelayServer, String> {
    if uri.is_empty() {
        return Err("an empty entry is not a relay".to_string());
    }
    let (tls, rest) = match uri.strip_prefix(TLS_SCHEME) {
        Some(rest) => (true, rest),
        None => (false, uri.strip_prefix(PLAIN_SCHEME).unwrap_or(uri)),
    };
    let authority = rest.split('?').next().unwrap_or(rest);
    // From the right, so an IPv6 address written `[2001:db8::1]:3478` keeps its
    // colons and gives up only the port.
    let Some((host, port)) = authority.rsplit_once(':') else {
        return Err(format!("{uri} names no port"));
    };
    if host.is_empty() || port.parse::<u16>().is_err() {
        return Err(format!("{uri} is not a host and a port"));
    }
    Ok(RelayServer {
        addr: authority.to_string(),
        tls,
    })
}

/// `servers` as `--turn-server` and [`crate::Request::RenewCredential`] carry
/// them, which [`relay_servers`] reads back unchanged.
pub fn to_arg(servers: &[RelayServer]) -> String {
    servers
        .iter()
        .map(|server| {
            if server.tls {
                format!("{TLS_SCHEME}{}", server.addr)
            } else {
                server.addr.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn udp(addr: &str) -> RelayServer {
        RelayServer {
            addr: addr.to_string(),
            tls: false,
        }
    }

    fn tls(addr: &str) -> RelayServer {
        RelayServer {
            addr: addr.to_string(),
            tls: true,
        }
    }

    /// A lobby that names one plain relay behaves exactly as it did before
    /// TLS existed.
    #[test]
    fn a_plain_relay_is_one_udp_server() {
        for uri in [
            "turn:relay.example.org:3478",
            "turn:relay.example.org:3478?transport=udp",
            "relay.example.org:3478",
        ] {
            assert_eq!(
                relay_servers(uri),
                Ok(vec![udp("relay.example.org:3478")]),
                "{uri}"
            );
        }
        assert_eq!(
            relay_servers("turn:[2001:db8::1]:3478"),
            Ok(vec![udp("[2001:db8::1]:3478")])
        );
    }

    #[test]
    fn a_turns_uri_is_a_tls_server() {
        assert_eq!(
            relay_servers("turns:relay.example.org:5349?transport=tcp"),
            Ok(vec![tls("relay.example.org:5349")])
        );
    }

    /// UDP first even when the lobby put TLS first, because TLS is the
    /// fallback for a network that drops UDP.
    #[test]
    fn udp_comes_before_tls_whatever_order_the_lobby_used() {
        assert_eq!(
            relay_servers("turns:relay.example.org:5349,turn:relay.example.org:3478"),
            Ok(vec![
                udp("relay.example.org:3478"),
                tls("relay.example.org:5349")
            ])
        );
    }

    #[test]
    fn servers_of_the_same_kind_keep_the_lobbys_order() {
        assert_eq!(
            relay_servers("turn:b.example:3478,turns:a.example:5349,turn:a.example:3478"),
            Ok(vec![
                udp("b.example:3478"),
                udp("a.example:3478"),
                tls("a.example:5349")
            ])
        );
    }

    #[test]
    fn a_broken_entry_refuses_the_whole_list_and_says_which() {
        assert_eq!(
            relay_servers("turn:relay.example.org:3478,turns:relay.example.org"),
            Err("turns:relay.example.org names no port".to_string())
        );
        assert_eq!(
            relay_servers("turn::3478"),
            Err("turn::3478 is not a host and a port".to_string())
        );
        assert_eq!(
            relay_servers("turn:relay.example.org:turn"),
            Err("turn:relay.example.org:turn is not a host and a port".to_string())
        );
        assert_eq!(
            relay_servers("turn:relay.example.org:3478,"),
            Err("an empty entry is not a relay".to_string())
        );
        assert_eq!(
            relay_servers(""),
            Err("an empty entry is not a relay".to_string())
        );
    }

    /// What coilbox hands the agent has to read back as the same list, or the
    /// agent opens something other than what coilbox checked.
    #[test]
    fn the_argument_reads_back_as_the_same_servers() {
        let servers = vec![udp("relay.example.org:3478"), tls("relay.example.org:5349")];
        assert_eq!(
            to_arg(&servers),
            "relay.example.org:3478,turns:relay.example.org:5349"
        );
        assert_eq!(relay_servers(&to_arg(&servers)), Ok(servers));
    }
}
