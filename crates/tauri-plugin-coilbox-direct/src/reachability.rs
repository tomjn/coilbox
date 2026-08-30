//! Putting the two halves together: open the ports, then go and look from
//! outside to see whether it made any difference.
//!
//! [`crate::portmap`] asks the router. [`crate::stun`] asks the internet. Only
//! the pair of them can tell a host the one thing they need, which is the
//! address to send a friend, and only the pair of them can tell the truth about
//! carrier grade NAT: a router happily reports a mapping it made on its own
//! internet side, and if that side is itself behind the ISP's NAT then the
//! mapping is real and useless.
//!
//! # What is kept while a room runs
//!
//! One [`Ports`] at a time, holding the live mappings and a task that renews
//! them every [`portmap::RENEW_AFTER`]. Handing them back is the caller's to
//! ask for, and the room's stop path is what asks.

use std::net::Ipv4Addr;
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::discovery;
use crate::portmap::{self, is_public_v4, Mapped, Method, Open, PortRequest, Refused, Transport};
use crate::stun;

/// Everything a host needs to know about whether anybody outside can reach them.
///
/// The facts, not the verdict. Whether a host is reachable is worked out once,
/// in `src/direct/reachability.ts`, so the panel, the hosting ladder and the
/// sharing rows cannot disagree about the same host. This struct used to carry a
/// second answer, an `open()` that asked only whether a mapping was made and so
/// said no about a machine already on the internet under its own address. It had
/// no caller, and a second answer that nothing compares to the first is how the
/// two drifted (issue #2090).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reachability {
    /// Which protocol opened the ports, or null when none did.
    pub method: Option<Method>,
    /// The ports that are open. Empty when nothing opened.
    pub ports: Vec<Mapped>,
    /// The ports that were asked for, so the manual forwarding instructions can
    /// name every one of them when the router refused.
    pub wanted: Vec<Mapped>,
    /// This machine on its own network, which is what the instructions tell the
    /// host to forward to, and the only address there is when nothing else
    /// worked.
    pub lan_address: Option<String>,
    /// What the internet sees, learned from STUN. Null when no STUN server could
    /// be reached, in which case the host is shown their local address and no
    /// guess.
    pub public_address: Option<String>,
    /// The address STUN saw is one this machine holds, so there is nothing in
    /// front of it to forward anything.
    ///
    /// Answered here because this is where the whole address list is. The
    /// reading side used to work it out by comparing [`Self::public_address`]
    /// against [`Self::lan_address`], which is the one address a room announces
    /// itself at and prefers a private one, so a VPS with a Docker bridge on it
    /// compared 209.35.91.246 against 172.17.0.1 and told a host with no router
    /// that their router had refused (issue #2111).
    ///
    /// A fact rather than a verdict. Whether that makes a host reachable is
    /// still worked out once, in `src/direct/reachability.ts` (issue #2090).
    pub public_address_is_local: bool,
    /// The router's own address on its internet side, when it would say.
    pub router_address: Option<String>,
    /// The router is behind another NAT, so an open port on it is not an open
    /// port on the internet. Carrier grade NAT, in one flag.
    pub double_nat: bool,
    /// The port a joiner dials, echoed back from the reflexive address, when the
    /// router preserved it. Null when it did not, or when STUN did not answer.
    pub confirmed_port: Option<u16>,
    /// Why nothing opened, in as much of the router's own words as there were.
    pub problem: Option<String>,
}

/// A live set of mappings and the task keeping them alive.
pub struct Ports {
    pub report: Reachability,
    /// The mappings themselves, shared with the renewal task. `None` once they
    /// have been handed back.
    open: Arc<Mutex<Option<Open>>>,
    renewal: JoinHandle<()>,
}

impl Ports {
    /// Hand the ports back to the router and stop renewing them.
    pub async fn release(self) {
        self.renewal.abort();
        let open = self.open.lock().await.take();
        if let Some(open) = open {
            open.release().await;
        }
    }
}

/// Open the ports and then check, from outside, what that bought.
///
/// The STUN request goes out of the first UDP port asked for, so a reply naming
/// that port is the mapping confirming itself. With no UDP port in the list an
/// ephemeral one is used and only the address is learned.
///
/// Never fails: a router that refuses is an outcome a host has to read, not an
/// error, and the report says so in [`Reachability::problem`] with every port
/// number the manual instructions need.
pub async fn open(wanted: Vec<PortRequest>) -> (Reachability, Option<Ports>) {
    // One enumeration, two questions: which address a room announces itself at,
    // and whether the address STUN comes back with is one of them.
    let local = discovery::local_addrs();
    let asked: Vec<Mapped> = wanted
        .iter()
        .map(|w| Mapped {
            port: w.port,
            external_port: w.port,
            transport: w.transport,
        })
        .collect();
    let udp_port = wanted
        .iter()
        .find(|w| w.transport == Transport::Udp)
        .map(|w| w.port);

    let attempt = portmap::open(&wanted).await;
    // Asked whether the mapping worked or not. A host whose router refused still
    // needs their public address, because the manual forwarding instructions are
    // no use without it.
    let reflexive = stun::public_address(udp_port).await;

    match attempt {
        Err(refused) => (
            report(None, &asked, &local, reflexive, None, Some(refused)),
            None,
        ),
        Ok(open) => {
            let report = report(Some(&open), &asked, &local, reflexive, open.router_ip, None);
            let shared = Arc::new(Mutex::new(Some(open)));
            let renewal = tokio::spawn(renew_loop(Arc::clone(&shared)));
            (
                report.clone(),
                Some(Ports {
                    report,
                    open: shared,
                    renewal,
                }),
            )
        }
    }
}

/// Assemble what the host reads. Pure, given the four answers above.
///
/// `local` is every address this machine holds, not the one chosen to announce a
/// room at, because two different questions are asked of it here. See
/// [`Reachability::public_address_is_local`].
fn report(
    open: Option<&Open>,
    asked: &[Mapped],
    local: &[Ipv4Addr],
    reflexive: Option<stun::Reflexive>,
    router_ip: Option<Ipv4Addr>,
    refused: Option<Refused>,
) -> Reachability {
    // Carrier grade NAT: the router made a mapping on an address that is itself
    // behind somebody else's NAT, so it opened a door onto a corridor.
    let double_nat = router_ip.is_some_and(|ip| !is_public_v4(ip));
    let confirmed_port = reflexive
        .filter(|r| asked.iter().any(|a| a.port == r.port))
        .map(|r| r.port);
    Reachability {
        method: open.map(|o| o.method),
        ports: open.map(|o| o.ports.clone()).unwrap_or_default(),
        wanted: asked.to_vec(),
        lan_address: discovery::lan_address_of(local),
        public_address: reflexive.map(|r| r.ip.to_string()),
        public_address_is_local: reflexive.is_some_and(|r| local.contains(&r.ip)),
        router_address: router_ip.map(|ip| ip.to_string()),
        double_nat,
        confirmed_port,
        problem: refused.map(|r| r.summary()),
    }
}

/// Push the lease out for as long as the room lasts.
///
/// A failed renewal is not fatal and is not reported: it happens half an hour
/// before the lease runs out, so the next one still has time, and there is
/// nothing a host could usefully do about it in between.
async fn renew_loop(open: Arc<Mutex<Option<Open>>>) {
    loop {
        tokio::time::sleep(portmap::RENEW_AFTER).await;
        let mut held = open.lock().await;
        let Some(mapping) = held.as_mut() else { return };
        let _ = mapping.renew().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asked() -> Vec<Mapped> {
        vec![
            Mapped {
                port: 8200,
                external_port: 8200,
                transport: Transport::Tcp,
            },
            Mapped {
                port: 8452,
                external_port: 8452,
                transport: Transport::Udp,
            },
        ]
    }

    fn refused() -> Refused {
        Refused {
            nat_pmp: "nothing answered on UDP 5351".to_string(),
            upnp: "no UPnP gateway answered".to_string(),
        }
    }

    /// The failure most people meet. Both ports still have to reach the host,
    /// because the manual instructions are the way out and they need both
    /// numbers.
    #[test]
    fn a_refusal_still_names_every_port_the_host_has_to_forward() {
        let out = report(
            None,
            &asked(),
            &[Ipv4Addr::new(192, 168, 1, 45)],
            Some(stun::Reflexive {
                ip: Ipv4Addr::new(209, 35, 91, 246),
                port: 51234,
            }),
            None,
            Some(refused()),
        );
        assert_eq!(out.method, None);
        assert_eq!(out.wanted.len(), 2);
        assert_eq!(out.public_address.as_deref(), Some("209.35.91.246"));
        assert!(out.problem.unwrap().contains("NAT-PMP"));
    }

    /// STUN unreachable: the local address only, and no guess at a public one.
    #[test]
    fn with_no_stun_answer_there_is_no_public_address_at_all() {
        let out = report(
            None,
            &asked(),
            &[Ipv4Addr::new(192, 168, 1, 45)],
            None,
            None,
            Some(refused()),
        );
        assert_eq!(out.public_address, None);
        assert_eq!(out.confirmed_port, None);
        assert_eq!(out.lan_address.as_deref(), Some("192.168.1.45"));
    }

    /// A machine already on the internet: nothing answered the mapping request
    /// because there is no gateway to answer it, and the address STUN saw is one
    /// of this machine's own.
    ///
    /// The two fields hold the same string here because there is only one
    /// address to put in either of them. `isOnPublicAddress` in
    /// `src/direct/reachability.ts` used to be that comparison, which is why
    /// #2090 pinned the form. It reads `public_address_is_local` now, and the
    /// test below this one is the machine that has more than one address. What
    /// is left worth holding is that the sole address still reaches
    /// `lan_address`, since the share rows and the manual instructions read it.
    #[test]
    fn a_host_whose_only_address_is_public_reports_it_as_both() {
        let out = report(
            None,
            &asked(),
            &[Ipv4Addr::new(209, 35, 91, 246)],
            Some(stun::Reflexive {
                ip: Ipv4Addr::new(209, 35, 91, 246),
                port: 8452,
            }),
            None,
            Some(refused()),
        );
        assert_eq!(out.public_address.as_deref(), Some("209.35.91.246"));
        assert_eq!(out.lan_address, out.public_address);
        assert!(out.public_address_is_local);
        assert_eq!(out.method, None);
    }

    /// The same host with a Docker bridge on it, which is the ordinary VPS.
    ///
    /// `lan_address` is the bridge, because that is the address a room announces
    /// itself at and a private one is right for that. So the two strings differ
    /// and the reading side, which compared them, told this host their router
    /// had refused (issue #2111). The flag is what it reads now, and it is asked
    /// of the whole list.
    #[test]
    fn a_second_address_does_not_stop_a_host_being_on_their_public_one() {
        let out = report(
            None,
            &asked(),
            &[
                Ipv4Addr::new(172, 17, 0, 1),
                Ipv4Addr::new(209, 35, 91, 246),
            ],
            Some(stun::Reflexive {
                ip: Ipv4Addr::new(209, 35, 91, 246),
                port: 8452,
            }),
            None,
            Some(refused()),
        );
        assert!(out.public_address_is_local);
        assert_eq!(out.lan_address.as_deref(), Some("172.17.0.1"));
        assert_eq!(out.public_address.as_deref(), Some("209.35.91.246"));
    }

    /// The ordinary home connection, and the reason the flag cannot simply be
    /// "STUN answered". This host is behind a router and none of their addresses
    /// is the one the internet sees.
    #[test]
    fn a_host_behind_a_router_does_not_hold_the_address_the_internet_sees() {
        let out = report(
            None,
            &asked(),
            &[Ipv4Addr::new(192, 168, 1, 45)],
            Some(stun::Reflexive {
                ip: Ipv4Addr::new(209, 35, 91, 246),
                port: 51234,
            }),
            None,
            Some(refused()),
        );
        assert!(!out.public_address_is_local);
    }

    /// No STUN answer is not a match with anything, however many addresses this
    /// machine has.
    #[test]
    fn without_a_reflexive_address_nothing_is_claimed_about_it() {
        let out = report(
            None,
            &asked(),
            &[Ipv4Addr::new(209, 35, 91, 246)],
            None,
            None,
            Some(refused()),
        );
        assert!(!out.public_address_is_local);
    }

    /// The reflexive port matching a port we asked for is the mapping
    /// confirming itself, which no router's own answer can do.
    #[test]
    fn a_reflexive_port_we_asked_for_is_recorded_as_confirmation() {
        let out = report(
            None,
            &asked(),
            &[],
            Some(stun::Reflexive {
                ip: Ipv4Addr::new(209, 35, 91, 246),
                port: 8452,
            }),
            None,
            None,
        );
        assert_eq!(out.confirmed_port, Some(8452));
    }

    /// A port the router picked for itself is not confirmation, and is not
    /// reported as one.
    #[test]
    fn a_reflexive_port_we_did_not_ask_for_confirms_nothing() {
        let out = report(
            None,
            &asked(),
            &[],
            Some(stun::Reflexive {
                ip: Ipv4Addr::new(209, 35, 91, 246),
                port: 51234,
            }),
            None,
            None,
        );
        assert_eq!(out.confirmed_port, None);
    }

    /// Carrier grade NAT. The router says yes and means it, and nobody outside
    /// can reach the host anyway, so this must not read as success.
    #[test]
    fn a_mapping_behind_a_second_nat_is_not_reachable() {
        let open = Open::for_test(Method::Upnp, asked(), Some(Ipv4Addr::new(100, 88, 1, 2)));
        let out = report(
            Some(&open),
            &asked(),
            &[Ipv4Addr::new(192, 168, 1, 45)],
            Some(stun::Reflexive {
                ip: Ipv4Addr::new(209, 35, 91, 246),
                port: 8452,
            }),
            open.router_ip,
            None,
        );
        assert_eq!(out.method, Some(Method::Upnp));
        assert!(out.double_nat);
    }

    #[test]
    fn a_mapping_on_a_public_router_address_is_reachable() {
        let open = Open::for_test(
            Method::NatPmp,
            asked(),
            Some(Ipv4Addr::new(209, 35, 91, 246)),
        );
        let out = report(Some(&open), &asked(), &[], None, open.router_ip, None);
        assert!(!out.double_nat);
        assert_eq!(out.method, Some(Method::NatPmp));
    }

    /// A router that will not say what its own address is says nothing about
    /// whether it is behind another one, so this must not guess "double NAT".
    #[test]
    fn a_router_that_will_not_name_its_own_address_is_not_assumed_to_be_natted() {
        let open = Open::for_test(Method::NatPmp, asked(), None);
        let out = report(Some(&open), &asked(), &[], None, None, None);
        assert!(!out.double_nat);
        assert_eq!(out.method, Some(Method::NatPmp));
    }
}
