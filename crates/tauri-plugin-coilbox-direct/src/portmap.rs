//! Asking the router to open the ports a host needs, so somebody outside the
//! house can reach a room that is running inside it.
//!
//! Two protocols, because home routers speak one, the other, both or neither:
//!
//! - NAT-PMP, and its successor PCP, which are a two datagram exchange with the
//!   default gateway on UDP 5351. `crab_nat` tries PCP first and falls back.
//! - UPnP-IGD, which is an SSDP multicast search followed by a SOAP call over
//!   HTTP. `igd-next` does both halves.
//!
//! # Which one is used when both work
//!
//! NAT-PMP wins. Not for speed: the reason is the lease. Both protocols take a
//! lease time, and a lease is the only thing standing between a host whose
//! machine is killed and a hole left open on their router forever. NAT-PMP
//! routers honour the lease they are given, because the protocol has no way to
//! express a permanent one. A good many consumer UPnP stacks refuse a finite
//! lease outright and answer `OnlyPermanentLeasesSupported`, at which point the
//! only mapping on offer is one that outlives the process that asked for it.
//!
//! So the order is NAT-PMP, then UPnP, and the fallback to a permanent UPnP
//! lease is taken only when the router leaves nothing else.
//!
//! # Two ports, not one
//!
//! A caller hands in every port it needs and a method has to open all of them or
//! none. Opening the lobby port and missing the engine's game port is worse than
//! opening neither: everybody gets into the room, the host presses start, and
//! the launch fails with nothing on screen to connect the two. So a partial
//! success is rolled back and the next method is tried from scratch.
//!
//! # Finding the gateway
//!
//! NAT-PMP is spoken to the default gateway, which [`crate::discovery`] reads
//! out of the OS's own interface list along with everything the beacon needs.
//! See [`gateway_candidates`] for the order, and for what is left to guess at
//! when the OS names no gateway at all.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::num::NonZeroU16;
use std::time::Duration;

use crab_nat::{
    GatewayAddress, InternetProtocol, MappingFailure, PortMapping, PortMappingOptions,
    TimeoutConfig,
};
use igd_next::aio::tokio::{search_gateway, Tokio};
use igd_next::aio::Gateway;
use igd_next::{AddPortError, PortMappingProtocol, SearchOptions};
use serde::{Deserialize, Serialize};

use crate::discovery::LocalNet;

/// How long a mapping is asked to last.
///
/// An hour, renewed every half hour while the room runs. Short enough that a
/// host whose machine is killed leaves a hole open for under an hour rather
/// than until their next reboot, and long enough that renewal is a background
/// detail rather than a thing that fails visibly.
pub const LEASE_SECONDS: u32 = 3600;

/// How often a live mapping is renewed. Half the lease, so one missed renewal
/// is survivable and the second one still lands with time to spare.
pub const RENEW_AFTER: Duration = Duration::from_secs(LEASE_SECONDS as u64 / 2);

/// How long the SSDP search for a UPnP gateway is given.
///
/// The crate's own default is ten seconds, which is ten seconds of a host
/// looking at a spinner on every network that has UPnP switched off. A router
/// that is going to answer answers in well under a second.
const SSDP_TIMEOUT: Duration = Duration::from_secs(3);

/// How patient the NAT-PMP and PCP datagrams are.
///
/// The RFC's own retry schedule starts at 250ms and doubles, which reaches
/// minutes. A gateway that speaks either protocol answers immediately, and every
/// address tried here may be a guess, so a guess must cost well under a second.
/// Up to two addresses are tried with two protocols each, and the whole thing
/// sits behind a button a host is watching.
const NAT_PMP_TIMEOUT: TimeoutConfig = TimeoutConfig {
    initial_timeout: Duration::from_millis(200),
    max_retries: 1,
    max_retry_timeout: Some(Duration::from_millis(400)),
};

/// Which transport a port carries. The lobby is TCP and the engine's game
/// traffic is UDP, and a router maps the two separately.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    Tcp,
    Udp,
}

impl Transport {
    fn igd(self) -> PortMappingProtocol {
        match self {
            Transport::Tcp => PortMappingProtocol::TCP,
            Transport::Udp => PortMappingProtocol::UDP,
        }
    }

    fn crab(self) -> InternetProtocol {
        match self {
            Transport::Tcp => InternetProtocol::Tcp,
            Transport::Udp => InternetProtocol::Udp,
        }
    }

    /// What the host reads in the manual forwarding instructions.
    pub fn label(self) -> &'static str {
        match self {
            Transport::Tcp => "TCP",
            Transport::Udp => "UDP",
        }
    }
}

/// One port a caller needs open.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortRequest {
    pub port: u16,
    pub transport: Transport,
    /// What the mapping is called in the router's own list, so a host who goes
    /// looking can tell what put it there.
    pub description: String,
}

/// A port the router agreed to open.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mapped {
    /// The port on this machine.
    pub port: u16,
    /// The port on the router. Asked to match, and usually does, but a router
    /// that already has that port spoken for may hand back another.
    pub external_port: u16,
    pub transport: Transport,
}

/// Which protocol carried a mapping.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Method {
    /// NAT-PMP, or PCP, which `crab_nat` prefers and falls back from.
    NatPmp,
    /// UPnP-IGD.
    Upnp,
}

impl Method {
    /// What the host reads. Router settings pages use these names.
    pub fn label(self) -> &'static str {
        match self {
            Method::NatPmp => "NAT-PMP",
            Method::Upnp => "UPnP",
        }
    }
}

/// The order methods are tried in. See the module note on why NAT-PMP is first.
pub const ORDER: [Method; 2] = [Method::NatPmp, Method::Upnp];

/// What one method's attempt means for the run as a whole. Pure, so the rule
/// can be tested with no router in the room.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// Every port asked for is open. Stop here.
    Keep,
    /// Some ports opened and some did not. Hand back the ones that did and try
    /// the next method, because a room reachable on half its ports is worse
    /// than one reachable on none.
    Rollback,
    /// Nothing left to try.
    Fail,
}

/// Decide what to do after a method opened `opened` of `asked` ports.
pub fn next_step(asked: usize, opened: usize, more_methods: bool) -> Step {
    if asked > 0 && opened == asked {
        Step::Keep
    } else if more_methods {
        Step::Rollback
    } else {
        Step::Fail
    }
}

/// The addresses to try NAT-PMP against, best first.
///
/// The gateway the OS routes this interface through is the answer, and it comes
/// first. A UPnP search answers from the router as well, so it is next: the two
/// are normally one box, and when they are not it is still something that speaks
/// to routers.
///
/// Last come the two addresses a home router is usually at, the first and the
/// last host of this machine's own subnet. They are only reached when the OS
/// named no gateway, which is a machine with no default route, and a guess is
/// better than not asking. Because the subnet comes from the interface rather
/// than being assumed to be a /24, the guess is right on a /22 as well.
///
/// A guess that is wrong costs one timeout. It cannot cause a wrong mapping,
/// because a machine that is not a router does not answer on UDP 5351.
pub fn gateway_candidates(local: LocalNet, discovered: Option<Ipv4Addr>) -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = Vec::new();
    for candidate in local
        .gateway
        .into_iter()
        .chain(discovered)
        .chain(local.ends())
    {
        if candidate != local.addr && !out.contains(&candidate) {
            out.push(candidate);
        }
    }
    out
}

/// Whether an IPv4 address is one the rest of the internet can route to.
///
/// The interesting answer is "no" for a router's own external address: a router
/// whose internet side is 10.x or 100.64.x is behind another NAT, so a port
/// opened on it is not a port opened on the internet. That is carrier grade NAT,
/// and it is the single most common reason this whole feature cannot work.
///
/// `Ipv4Addr::is_global` says this in the standard library and is still
/// unstable, so the ranges are spelled out.
pub fn is_public_v4(ip: Ipv4Addr) -> bool {
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_unspecified()
        || ip.is_documentation()
        // 100.64.0.0/10, the carrier grade NAT range (RFC 6598).
        || (ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]))
        // 0.0.0.0/8, "this network".
        || ip.octets()[0] == 0
        // 192.0.0.0/24, IETF protocol assignments.
        || ip.octets()[..3] == [192, 0, 0]
        // 198.18.0.0/15, benchmarking.
        || (ip.octets()[0] == 198 && (18..20).contains(&ip.octets()[1]))
        // 240.0.0.0/4, reserved, and 255.255.255.255 with it.
        || ip.octets()[0] >= 240)
}

/// The ports a method opened, and what it takes to give them back.
enum Held {
    NatPmp(Vec<PortMapping>),
    Upnp {
        gateway: Box<Gateway<Tokio>>,
        ports: Vec<(PortMappingProtocol, u16)>,
    },
    /// Nothing to give back, because nothing was ever asked of a router. Only
    /// [`Open::for_test`] builds one.
    #[cfg(test)]
    Nothing,
}

/// A live set of mappings on somebody's router.
///
/// Held rather than fired and forgotten, because both halves of politeness need
/// it: renewing before the lease runs out while the room is up, and handing the
/// ports back when it comes down.
pub struct Open {
    pub method: Method,
    pub ports: Vec<Mapped>,
    /// The router's own address on the internet side, when it will say. `None`
    /// when it was not asked or would not answer.
    pub router_ip: Option<Ipv4Addr>,
    held: Held,
}

impl Open {
    /// An `Open` that holds nothing, so the report the frontend reads can be
    /// tested without a router in the room.
    #[cfg(test)]
    pub fn for_test(method: Method, ports: Vec<Mapped>, router_ip: Option<Ipv4Addr>) -> Open {
        Open {
            method,
            ports,
            router_ip,
            held: Held::Nothing,
        }
    }

    /// Push the lease out. Called every [`RENEW_AFTER`] while a room runs.
    ///
    /// Errors are the caller's to log and not to act on: one failed renewal
    /// still leaves most of the lease, and the next attempt is half an hour
    /// before it runs out.
    pub async fn renew(&mut self) -> Result<(), String> {
        match &mut self.held {
            Held::NatPmp(mappings) => {
                for mapping in mappings.iter_mut() {
                    mapping.renew().await.map_err(|e| e.to_string())?;
                }
                Ok(())
            }
            Held::Upnp { gateway, ports } => {
                let local = local_net().ok_or("this machine is on no network")?.addr;
                for (protocol, external) in ports.iter() {
                    let internal = self
                        .ports
                        .iter()
                        .find(|m| m.external_port == *external)
                        .map_or(*external, |m| m.port);
                    add_upnp_port(gateway, *protocol, *external, local, internal, "Coilbox")
                        .await
                        .map_err(|e| e.to_string())?;
                }
                Ok(())
            }
            #[cfg(test)]
            Held::Nothing => Ok(()),
        }
    }

    /// Hand the ports back.
    ///
    /// Best effort on purpose. A router that has rebooted, or that has forgotten
    /// the mapping already, is not a failure the host can do anything about, and
    /// there is nothing left to retry against.
    pub async fn release(self) {
        match self.held {
            Held::NatPmp(mappings) => {
                for mapping in mappings {
                    let _ = mapping.try_drop().await;
                }
            }
            Held::Upnp { gateway, ports } => {
                for (protocol, external) in ports {
                    let _ = gateway.remove_port(protocol, external).await;
                }
            }
            #[cfg(test)]
            Held::Nothing => {}
        }
    }
}

/// Why nothing could be opened, in as much of the router's own words as there
/// were.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refused {
    /// What NAT-PMP and PCP said, or that nothing answered.
    pub nat_pmp: String,
    /// What UPnP said, or that nothing answered.
    pub upnp: String,
}

impl Refused {
    /// One sentence, for a host who is not going to read two.
    pub fn summary(&self) -> String {
        format!(
            "Your router did not open the ports. NAT-PMP: {}. UPnP: {}.",
            self.nat_pmp, self.upnp
        )
    }
}

/// Open every port in `wanted`, or none of them.
///
/// Tries each method in [`ORDER`] in turn, rolling back anything a method opened
/// before moving on, so the router is never left holding half a room's ports.
pub async fn open(wanted: &[PortRequest]) -> Result<Open, Refused> {
    let local = match local_net() {
        Some(local) => local,
        None => {
            let nowhere = "this machine is on no network".to_string();
            return Err(Refused {
                nat_pmp: nowhere.clone(),
                upnp: nowhere,
            });
        }
    };

    // The SSDP search happens first whichever method wins, because it is also
    // the only thing here that learns the router's address without guessing,
    // and NAT-PMP wants that address. A network with UPnP switched off pays
    // `SSDP_TIMEOUT` for the answer "nothing there", once, when a host ticks a
    // box.
    let gateway = search_gateway(SearchOptions {
        timeout: Some(SSDP_TIMEOUT),
        single_search_timeout: Some(SSDP_TIMEOUT),
        ..SearchOptions::default()
    })
    .await;
    let discovered = match &gateway {
        Ok(found) => match found.addr.ip() {
            IpAddr::V4(v4) => Some(v4),
            IpAddr::V6(_) => None,
        },
        Err(_) => None,
    };

    let mut nat_pmp_said = String::new();
    let mut upnp_said = String::new();

    for (index, method) in ORDER.iter().enumerate() {
        let more_methods = index + 1 < ORDER.len();
        let attempt = match method {
            Method::NatPmp => {
                try_nat_pmp(wanted, local.addr, &gateway_candidates(local, discovered)).await
            }
            Method::Upnp => match &gateway {
                Ok(found) => try_upnp(wanted, local.addr, found).await,
                Err(e) => Err(format!("no UPnP gateway answered ({e})")),
            },
        };
        match attempt {
            Ok(open) => match next_step(wanted.len(), open.ports.len(), more_methods) {
                Step::Keep => return Ok(open),
                Step::Rollback | Step::Fail => {
                    let short = format!(
                        "opened {} of the {} ports asked for",
                        open.ports.len(),
                        wanted.len()
                    );
                    open.release().await;
                    match method {
                        Method::NatPmp => nat_pmp_said = short,
                        Method::Upnp => upnp_said = short,
                    }
                }
            },
            Err(e) => match method {
                Method::NatPmp => nat_pmp_said = e,
                Method::Upnp => upnp_said = e,
            },
        }
    }

    Err(Refused {
        nat_pmp: nat_pmp_said,
        upnp: upnp_said,
    })
}

/// Every port over NAT-PMP or PCP, against the first gateway address that
/// answers at all.
///
/// A candidate that does not answer the first port is not tried for the rest:
/// nothing is there. A candidate that answers and then refuses is the router
/// saying no, which is an answer and not a reason to go asking the neighbours.
async fn try_nat_pmp(
    wanted: &[PortRequest],
    local: Ipv4Addr,
    candidates: &[Ipv4Addr],
) -> Result<Open, String> {
    // The first candidate's answer, not the last one's. Candidates are best
    // first, so a real refusal from the router beats "no route to host" from an
    // address that was only ever a guess.
    let mut first: Option<String> = None;
    for candidate in candidates {
        let gateway = GatewayAddress::IpV4(*candidate);
        let mut mappings: Vec<PortMapping> = Vec::new();
        let mut ports: Vec<Mapped> = Vec::new();
        let mut refused: Option<String> = None;

        for want in wanted {
            let Some(internal) = NonZeroU16::new(want.port) else {
                refused = Some("port 0 cannot be mapped".to_string());
                break;
            };
            let options = PortMappingOptions {
                external_port: Some(internal),
                lifetime_seconds: Some(LEASE_SECONDS),
                timeout_config: Some(NAT_PMP_TIMEOUT),
            };
            match map_one(gateway, local, want.transport, internal, options).await {
                Ok(mapping) => {
                    ports.push(Mapped {
                        port: want.port,
                        external_port: mapping.external_port().get(),
                        transport: want.transport,
                    });
                    mappings.push(mapping);
                }
                Err(e) => {
                    refused = Some(e.to_string());
                    break;
                }
            }
        }

        // Nothing at this address at all, so try the next one rather than
        // reporting the router's refusal it never made.
        if ports.is_empty() {
            first = first.or(refused);
            continue;
        }

        let router_ip = crab_nat::natpmp::external_address(gateway, Some(NAT_PMP_TIMEOUT))
            .await
            .ok();
        return Ok(Open {
            method: Method::NatPmp,
            ports,
            router_ip,
            held: Held::NatPmp(mappings),
        });
    }
    Err(first.unwrap_or_else(|| "nothing answered on UDP 5351".to_string()))
}

/// One mapping over PCP, then over NAT-PMP if PCP got nowhere.
///
/// `crab_nat`'s own combined call falls back to NAT-PMP on exactly one PCP
/// answer, the one where the router says "I speak the older version". A router
/// that ignores a PCP datagram it does not understand, rather than answering it,
/// never gets asked in NAT-PMP at all, and the crate's documentation says to
/// call NAT-PMP directly if that matters. This issue is about NAT-PMP, so it
/// matters.
async fn map_one(
    gateway: GatewayAddress,
    local: Ipv4Addr,
    transport: Transport,
    internal: NonZeroU16,
    options: PortMappingOptions,
) -> Result<PortMapping, String> {
    let combined = PortMapping::new(
        gateway,
        IpAddr::V4(local),
        transport.crab(),
        internal,
        options,
    )
    .await;
    let pcp_said = match combined {
        Ok(mapping) => return Ok(mapping),
        Err(said) => said,
    };
    match crab_nat::natpmp::port_mapping(gateway, transport.crab(), internal, options).await {
        Ok(mapping) => Ok(mapping),
        // Neither version answered, so there is nothing at this address and one
        // sentence says it. Two protocols both reporting a timeout reads like
        // two separate failures and is one.
        Err(crab_nat::natpmp::Failure::Timeout) if timed_out(&pcp_said) => {
            Err("nothing answered on UDP 5351".to_string())
        }
        Err(nat_pmp_said) => Err(format!("{pcp_said}, then {nat_pmp_said}")),
    }
}

/// Whether a combined attempt got no answer at all, as opposed to a refusal.
fn timed_out(failure: &MappingFailure) -> bool {
    matches!(
        failure,
        MappingFailure::Pcp(crab_nat::pcp::Failure::Timeout)
            | MappingFailure::NatPmp(crab_nat::natpmp::Failure::Timeout)
    )
}

/// Every port over UPnP-IGD, against the gateway SSDP found.
async fn try_upnp(
    wanted: &[PortRequest],
    local: Ipv4Addr,
    gateway: &Gateway<Tokio>,
) -> Result<Open, String> {
    let mut ports: Vec<Mapped> = Vec::new();
    let mut held: Vec<(PortMappingProtocol, u16)> = Vec::new();
    let mut refused: Option<String> = None;

    for want in wanted {
        let protocol = want.transport.igd();
        match add_upnp_port(
            gateway,
            protocol,
            want.port,
            local,
            want.port,
            &want.description,
        )
        .await
        {
            Ok(()) => {
                ports.push(Mapped {
                    port: want.port,
                    external_port: want.port,
                    transport: want.transport,
                });
                held.push((protocol, want.port));
            }
            Err(e) => {
                refused = Some(e.to_string());
                break;
            }
        }
    }

    if ports.is_empty() {
        return Err(refused.unwrap_or_else(|| "the router opened nothing".to_string()));
    }

    let router_ip = match gateway.get_external_ip().await {
        Ok(IpAddr::V4(v4)) => Some(v4),
        _ => None,
    };
    Ok(Open {
        method: Method::Upnp,
        ports,
        router_ip,
        held: Held::Upnp {
            gateway: Box::new(gateway.clone()),
            ports: held,
        },
    })
}

/// One UPnP mapping, falling back to a permanent lease only if the router will
/// take no other kind.
///
/// A permanent lease is the thing this feature is least happy about: it outlives
/// the process that asked for it, so a host whose machine is killed leaves a
/// hole open until somebody removes it by hand. It is taken anyway because the
/// alternative on those routers is no mapping at all, and a mapping the room
/// hands back on stop covers every case except a kill.
async fn add_upnp_port(
    gateway: &Gateway<Tokio>,
    protocol: PortMappingProtocol,
    external: u16,
    local: Ipv4Addr,
    internal: u16,
    description: &str,
) -> Result<(), AddPortError> {
    let addr = SocketAddr::V4(SocketAddrV4::new(local, internal));
    match gateway
        .add_port(protocol, external, addr, LEASE_SECONDS, description)
        .await
    {
        Err(AddPortError::OnlyPermanentLeasesSupported) => {
            gateway
                .add_port(protocol, external, addr, 0, description)
                .await
        }
        other => other,
    }
}

/// This machine's address on the network it is actually on, with the subnet and
/// the gateway that go with it.
///
/// The same enumeration the beacon uses, so a host announcing one address on the
/// LAN is not mapping a different one on the router.
fn local_net() -> Option<LocalNet> {
    crate::discovery::local_nets()
        .into_iter()
        .find(|net| !net.addr.is_loopback())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Half a room's ports is the failure this exists to avoid: everybody gets
    /// into the room and the launch then fails with nothing to connect the two.
    #[test]
    fn a_method_that_opened_some_of_the_ports_is_rolled_back() {
        assert_eq!(next_step(2, 1, true), Step::Rollback);
        assert_eq!(next_step(2, 0, true), Step::Rollback);
    }

    #[test]
    fn a_method_that_opened_every_port_is_kept() {
        assert_eq!(next_step(2, 2, false), Step::Keep);
        assert_eq!(next_step(1, 1, true), Step::Keep);
    }

    /// The last method's partial success is still no use, so it is given back
    /// and the host is told nothing opened.
    #[test]
    fn the_last_method_failing_ends_the_run() {
        assert_eq!(next_step(2, 1, false), Step::Fail);
        assert_eq!(next_step(2, 0, false), Step::Fail);
    }

    /// Asking for nothing is not success. A caller with an empty list has a bug,
    /// and reporting "reachable" for it would hide it.
    #[test]
    fn opening_no_ports_at_all_is_not_a_success() {
        assert_eq!(next_step(0, 0, false), Step::Fail);
    }

    #[test]
    fn nat_pmp_is_tried_before_upnp() {
        assert_eq!(ORDER, [Method::NatPmp, Method::Upnp]);
    }

    fn on(addr: [u8; 4], prefix_len: u8, gateway: Option<[u8; 4]>) -> LocalNet {
        LocalNet {
            addr: Ipv4Addr::from(addr),
            prefix_len,
            gateway: gateway.map(Ipv4Addr::from),
        }
    }

    /// The router the OS routes through is the answer, so nothing else is tried
    /// before it and neither guess repeats it.
    #[test]
    fn the_gateway_the_os_names_is_asked_first() {
        assert_eq!(
            gateway_candidates(on([192, 168, 1, 45], 24, Some([192, 168, 1, 3])), None),
            vec![
                Ipv4Addr::new(192, 168, 1, 3),
                Ipv4Addr::new(192, 168, 1, 1),
                Ipv4Addr::new(192, 168, 1, 254)
            ]
        );
    }

    /// A gateway SSDP found is worth asking, and is not repeated when it is the
    /// same box the routing table named.
    #[test]
    fn a_discovered_gateway_is_not_repeated() {
        let found = Ipv4Addr::new(192, 168, 1, 1);
        assert_eq!(
            gateway_candidates(
                on([192, 168, 1, 45], 24, Some([192, 168, 1, 1])),
                Some(found)
            ),
            vec![found, Ipv4Addr::new(192, 168, 1, 254)]
        );
    }

    /// No default route at all, so both ends of the subnet are guessed, and the
    /// subnet is the one the interface is really on rather than an assumed /24.
    #[test]
    fn with_no_gateway_both_ends_of_the_real_subnet_are_guessed() {
        assert_eq!(
            gateway_candidates(on([10, 12, 5, 9], 22, None), None),
            vec![Ipv4Addr::new(10, 12, 4, 1), Ipv4Addr::new(10, 12, 7, 254)]
        );
    }

    /// Asking ourselves is a guaranteed timeout and never the right answer.
    #[test]
    fn this_machine_is_never_one_of_the_candidates() {
        assert_eq!(
            gateway_candidates(on([192, 168, 1, 1], 24, None), None),
            vec![Ipv4Addr::new(192, 168, 1, 254)]
        );
    }

    /// The whole point: a router whose own internet side is one of these is
    /// behind another NAT, so opening a port on it opens nothing.
    #[test]
    fn carrier_grade_and_private_router_addresses_are_not_public() {
        for ip in [
            Ipv4Addr::new(100, 64, 0, 1),
            Ipv4Addr::new(100, 127, 255, 254),
            Ipv4Addr::new(10, 1, 2, 3),
            Ipv4Addr::new(192, 168, 0, 1),
            Ipv4Addr::new(172, 16, 5, 5),
            Ipv4Addr::new(127, 0, 0, 1),
            Ipv4Addr::new(169, 254, 1, 1),
            Ipv4Addr::new(0, 0, 0, 0),
            Ipv4Addr::new(255, 255, 255, 255),
        ] {
            assert!(!is_public_v4(ip), "{ip} should not be public");
        }
    }

    /// The edges of 100.64.0.0/10, which are ordinary public addresses.
    #[test]
    fn addresses_either_side_of_the_carrier_grade_range_are_public() {
        for ip in [
            Ipv4Addr::new(100, 63, 255, 255),
            Ipv4Addr::new(100, 128, 0, 0),
            Ipv4Addr::new(209, 35, 91, 246),
            Ipv4Addr::new(8, 8, 8, 8),
        ] {
            assert!(is_public_v4(ip), "{ip} should be public");
        }
    }
}
