//! Whether this machine's internet traffic goes through a VPN (issue #2800).
//!
//! A VPN that carries everything costs a Spring player twice. Nobody can dial
//! the host directly, because the lobby and the router check both see the VPN's
//! address and most commercial VPNs pass no incoming connections on. And every
//! packet takes the trip to the VPN's server before it goes anywhere, so pings
//! are worse for the host and for anybody joining. Both are worth saying before
//! somebody commits to a battle.
//!
//! # Only the VPN that carries everything
//!
//! Tailscale, ZeroTier and Radmin are VPNs people run on purpose to play
//! together, and they carry their own network's traffic and nothing else. A
//! warning about one of those is a warning about the thing that is working.
//!
//! What separates the two is the default route, which is where the machine
//! sends traffic it has no more specific route for. A VPN that carries
//! everything takes it. A private network VPN leaves it alone, so
//! [`netdev::get_default_interface`] still answers with the ordinary adapter
//! and nothing here fires.
//!
//! # What counts as a tunnel, and what is known about that
//!
//! Interface names are no use. This was written on a Mac with no VPN running
//! at all and it has eight `utun` interfaces up, `utun0` to `utun7`, every one
//! of them reported as [`InterfaceType::Tunnel`] and none of them holding an
//! IPv4 address. Its default interface is `en0`, friendly name `Wi-Fi`, type
//! `Wireless80211`, not point to point. So the rule below answers nothing on
//! that machine, which is the answer it should give.
//!
//! The other half of the rule could not be measured here, because measuring it
//! needs a VPN carrying everything and there was none to run. What a given VPN
//! reports on each platform is therefore still unverified: a macOS full tunnel
//! is expected to hold the default route on a `utun`, which is the type above,
//! and a Linux WireGuard interface is expected to arrive as an unrecognised
//! type that is point to point. Windows is the least certain of the three.
//!
//! [`is_tunnel`] is written so that being wrong about any of it costs a warning
//! nobody sees rather than a warning that is not true, because somebody told
//! their connection is bad when it is fine goes looking for a fault that is not
//! there. So it names the two shapes above and refuses everything else,
//! including the ones that would be tempting and are somebody's ordinary
//! connection: `Ppp` is a DSL line dialled by the PC itself, the `Wwan` family
//! is a mobile modem, and `ProprietaryVirtual` on Windows is the Hyper-V switch
//! a machine running WSL2 routes through.

use netdev::interface::types::InterfaceType;
use netdev::Interface;

/// The VPN this machine's internet traffic goes through.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VpnRoute {
    /// What the OS calls the interface carrying it, for example `utun4`, or a
    /// name the VPN's own software chose on Windows. Shown to the person, so
    /// they know which of the things they are running is meant.
    pub interface: String,
}

/// Whether an interface is a VPN tunnel, from how the OS classed it. Pure.
///
/// Deliberately narrow. See the module docs for why each near miss is left out.
pub fn is_tunnel(if_type: InterfaceType, point_to_point: bool) -> bool {
    match if_type {
        // What macOS reports for `utun`, and what Windows reports for an
        // adapter registered as IF_TYPE_TUNNEL.
        InterfaceType::Tunnel => true,
        // A device the OS has no classification for, carrying a link with one
        // peer. This is the shape a WireGuard interface arrives in on Linux.
        // Point to point is what keeps an ordinary unclassified adapter out.
        InterfaceType::Unknown | InterfaceType::UnknownWithValue(_) => point_to_point,
        _ => false,
    }
}

/// [`is_tunnel`] applied to one interface, naming it when it is one.
fn vpn_on(iface: &Interface) -> Option<VpnRoute> {
    if !is_tunnel(iface.if_type, iface.is_point_to_point()) {
        return None;
    }
    Some(VpnRoute {
        // Windows names an interface twice and the friendly one is the name the
        // VPN's own software put there, which is the one worth showing. Unix
        // has only `utun4` to offer.
        interface: iface
            .friendly_name
            .clone()
            .unwrap_or_else(|| iface.name.clone()),
    })
}

/// The VPN carrying this machine's internet traffic, or `None` when nothing is.
///
/// Read fresh every time rather than once at startup, because a VPN coming up
/// or going down mid session is the ordinary case and a remembered answer would
/// be wrong in both directions. Issue #2116 is the same problem one layer down.
///
/// A machine whose default route cannot be worked out at all answers `None`, so
/// no network is the same as no warning.
pub fn default_route_vpn() -> Option<VpnRoute> {
    vpn_on(&netdev::get_default_interface().ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The two shapes that count, and the fact that a type alone is not enough
    /// for the second of them.
    #[test]
    fn a_tunnel_is_the_type_the_os_gave_it_or_a_point_to_point_it_could_not_name() {
        assert!(is_tunnel(InterfaceType::Tunnel, true));
        assert!(is_tunnel(InterfaceType::Tunnel, false));
        assert!(is_tunnel(InterfaceType::Unknown, true));
        assert!(is_tunnel(InterfaceType::UnknownWithValue(65534), true));
        assert!(!is_tunnel(InterfaceType::Unknown, false));
        assert!(!is_tunnel(InterfaceType::UnknownWithValue(65534), false));
    }

    /// Every ordinary connection, including the three that look tunnel shaped
    /// and are somebody's only way online. A warning here is the false one this
    /// whole module is arranged to avoid.
    #[test]
    fn an_ordinary_connection_is_never_read_as_a_vpn() {
        for if_type in [
            InterfaceType::Wireless80211,
            InterfaceType::Ethernet,
            InterfaceType::GigabitEthernet,
            InterfaceType::Loopback,
            // A DSL line the PC dials itself. Point to point and not a VPN.
            InterfaceType::Ppp,
            // A mobile modem, which on some platforms is also point to point.
            InterfaceType::Wwan,
            InterfaceType::Wwanpp,
            InterfaceType::Wwanpp2,
            // The Hyper-V switch a Windows machine running WSL2 routes through.
            InterfaceType::ProprietaryVirtual,
            InterfaceType::Bridge,
        ] {
            assert!(!is_tunnel(if_type, false), "{if_type:?} is not a VPN");
            assert!(!is_tunnel(if_type, true), "{if_type:?} is not a VPN");
        }
    }

    /// A tunnel that does not hold the default route is Tailscale, ZeroTier or
    /// Radmin, and warning about one of those is warning about the thing that
    /// is working.
    ///
    /// Run against this machine's real interfaces rather than a made up list,
    /// because which interface holds the default route is netdev's answer and
    /// standing that in would leave the part that matters untested. A Mac gives
    /// this eight tunnels to reject.
    #[test]
    fn a_tunnel_that_does_not_hold_the_default_route_is_not_warned_about() {
        let default = netdev::get_default_interface().ok();
        let answer = default_route_vpn();
        let mut rejected = 0;
        for iface in netdev::get_interfaces() {
            if Some(iface.index) == default.as_ref().map(|d| d.index) {
                continue;
            }
            let Some(route) = vpn_on(&iface) else {
                continue;
            };
            rejected += 1;
            assert_ne!(
                answer.as_ref(),
                Some(&route),
                "{} carries its own network, not the internet",
                iface.name
            );
        }
        // And the whole answer, whenever the machine running this is online
        // through something that is not a tunnel. On a machine with tunnels up
        // that is the case the issue asks for.
        if default.is_some_and(|d| !is_tunnel(d.if_type, d.is_point_to_point())) {
            assert_eq!(
                answer, None,
                "{rejected} tunnels were up and none of them carries the internet"
            );
        }
    }

    /// Whatever is answered names the interface the traffic actually leaves by,
    /// so the sentence a player reads points at the right thing.
    #[test]
    fn the_interface_named_is_the_one_holding_the_default_route() {
        let Some(route) = default_route_vpn() else {
            return;
        };
        let default = netdev::get_default_interface().expect("an answer came from one");
        assert!(!route.interface.is_empty());
        assert!(
            route.interface == default.name
                || Some(&route.interface) == default.friendly_name.as_ref()
        );
    }
}
