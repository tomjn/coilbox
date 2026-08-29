import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Opening the ports a host needs on their own router, and finding out from
 * outside whether it worked.
 *
 * The Rust half is `crates/tauri-plugin-coilbox-direct/src/portmap.rs` and
 * `stun.rs`. Everything here is either a binding to it or a pure reading of what
 * it answered, because the interesting part of this feature is the failure, and
 * the failure has to be readable.
 */

/** Whether a port carries the lobby (TCP) or the game (UDP). */
export type DirectTransport = "tcp" | "udp";

/** A port, as asked for or as opened. */
export interface DirectPort {
  /** The port on this machine. */
  port: number;
  /** The port on the router. The same number unless the router had it spoken
   *  for and handed back another. */
  externalPort: number;
  transport: DirectTransport;
}

/** What the host reads about whether anybody outside can reach them (mirrors
 *  the Rust `Reachability`). */
export interface DirectReachability {
  /** Which protocol opened the ports, or null when none did. */
  method: "natPmp" | "upnp" | null;
  /** The ports that are open. Empty when nothing opened. */
  ports: DirectPort[];
  /** The ports that were asked for, so the manual instructions can name every
   *  one of them when the router refused. */
  wanted: DirectPort[];
  /** This machine on its own network. What the manual instructions forward to,
   *  and the only address there is when nothing else worked. */
  lanAddress: string | null;
  /** What the internet sees, from STUN. Null when no STUN server answered, in
   *  which case the host is shown their local address and no guess. */
  publicAddress: string | null;
  /** The router's own address on its internet side, when it would say. */
  routerAddress: string | null;
  /** The router is itself behind another NAT, so an open port on it is not an
   *  open port on the internet. Carrier grade NAT, in one flag. */
  doubleNat: boolean;
  /** The port a joiner dials, confirmed by the reflexive address rather than by
   *  the router's own word for it. Null when it could not be confirmed. */
  confirmedPort: number | null;
  /** Why nothing opened, in as much of the router's own words as there were. */
  problem: string | null;
}

/**
 * Ask the router to open every port given, then look from outside to see whether
 * it made any difference.
 *
 * Replaces whatever was open before, so a host who changes their port does not
 * leave the old one behind. Takes a few seconds: an SSDP search that times out,
 * two NAT-PMP addresses, and a STUN round trip.
 */
export const directOpenPorts = defineCommand<
  {
    ports: { port: number; transport: DirectTransport; description: string }[];
  },
  { reachability: DirectReachability }
>("coilbox-direct", "direct_open_ports");

/** Hand the ports back to the router. */
export const directClosePorts = defineCommand<
  Record<string, never>,
  { closed: boolean }
>("coilbox-direct", "direct_close_ports");

/** What is open right now, or `{ reachability: null }`. So a host who walked
 *  away from the page that opened the ports still has their address to read
 *  out when they come back. */
export const directPortStatus = defineCommand<
  Record<string, never>,
  { reachability: DirectReachability | null }
>("coilbox-direct", "direct_port_status");

/**
 * The two ports a room needs. Pure.
 *
 * Both, always. Opening the lobby port and missing the engine's game port gets
 * everybody into the room and then fails at launch, which is worse than not
 * trying: the room looks like it worked right up to the moment it matters.
 */
export function roomPorts(
  lobbyPort: number,
  gamePort: number,
): { port: number; transport: DirectTransport; description: string }[] {
  return [
    { port: lobbyPort, transport: "tcp", description: "Coilbox room" },
    { port: gamePort, transport: "udp", description: "Coilbox game" },
  ];
}

/**
 * The one port a battle hosted on a real lobby server needs. Pure.
 *
 * One rather than two, because the lobby is somebody else's server and this
 * client listens on nothing. All the host provides is the engine, and the engine
 * binds one UDP port.
 */
export function battlePorts(
  gamePort: number,
): { port: number; transport: DirectTransport; description: string }[] {
  return [{ port: gamePort, transport: "udp", description: "Coilbox game" }];
}

/** Whether somebody outside this network can actually get in. Pure. */
export function isReachable(report: DirectReachability): boolean {
  return report.method !== null && !report.doubleNat;
}

/**
 * Whether the address the internet sees is this machine's own. Pure.
 *
 * A VPS, a datacentre machine, or a home line with no NAT in front of it. There
 * is no gateway for a port mapping request to reach, so nothing answers one and
 * the report reads like a refusal, which is the opposite of the truth: this host
 * needs nothing opened because nothing is shut (issue #2054).
 *
 * Two unknowns are not a match. A machine with no local address and no STUN
 * answer knows nothing about itself, and calling that public would tell somebody
 * unreachable that they are fine.
 *
 * Shared with {@link hostingRoute}'s first rung rather than written out twice,
 * because the panel saying one thing while the hosting ladder a few pixels below
 * says another is the bug this came from.
 */
export function isOnPublicAddress(report: DirectReachability): boolean {
  return (
    report.publicAddress !== null && report.publicAddress === report.lanAddress
  );
}

/**
 * The address to send a friend, or null when there is nothing honest to send.
 * Pure.
 *
 * The lobby port when there is one, because that is what a joiner types into
 * "Join by address". A battle hosted on a real server has no lobby port of its
 * own, so the address alone is the answer and the server tells joiners the rest.
 *
 * Null when STUN could not be reached. The local address is not the answer to
 * "what do I send my friend", and neither is a guess.
 */
export function joinAddress(report: DirectReachability): string | null {
  if (!report.publicAddress || !isReachable(report)) return null;
  const lobby = report.ports.find((p) => p.transport === "tcp");
  return lobby
    ? `${report.publicAddress}:${lobby.externalPort}`
    : report.publicAddress;
}

/** The name a host would recognise from their router's settings page. Pure. */
export function methodLabel(method: DirectReachability["method"]): string {
  return method === "natPmp" ? "NAT-PMP" : "UPnP";
}

/** Every port that has to be forwarded by hand, as "TCP 8200" and "UDP 8452".
 *  Pure. */
export function portList(ports: DirectPort[]): string {
  return ports
    .map((p) => `${p.transport.toUpperCase()} ${p.port}`)
    .join(" and ");
}

/** How the outcome should read. */
export type ReachabilityState =
  | "direct"
  | "open"
  | "doubleNat"
  | "refused"
  | "noAddress";

/**
 * Which of the five things happened. Pure.
 *
 * Split out from the wording because the wording differs between the two host
 * paths and the outcome does not.
 *
 * `direct` is asked first and asks nothing about the router, in the same order
 * and for the same reason as {@link hostingRoute}'s first rung: a host whose own
 * address is the one the internet sees is reachable whatever the router said,
 * and a machine that is on the internet and also holds a mapping did not need
 * the mapping. Asking later would leave a host with no gateway reading their
 * unanswered request as a refusal (issue #2054).
 *
 * `noAddress` is the odd one: the ports opened and STUN could not be reached, so
 * the host has an open port and no way to know what address it is behind. That
 * is not a failure of the mapping and must not be reported as one, but it is
 * also not something a host can act on without the local address.
 */
export function reachabilityState(
  report: DirectReachability,
): ReachabilityState {
  if (isOnPublicAddress(report)) return "direct";
  if (report.doubleNat) return "doubleNat";
  if (report.method === null) return "refused";
  if (!report.publicAddress) return "noAddress";
  return "open";
}

/**
 * The headline the host reads. Pure.
 *
 * Leads with what happened rather than with what was tried, and never says
 * "reachable" about a mapping that is sitting behind the ISP's own NAT.
 *
 * The direct one names the address instead of the ports, because there are no
 * ports to name and the address is the fact that proves the rest of the
 * sentence. It says nothing about the router: this host has none to speak of,
 * and the old wording blamed one that was never there.
 */
export function reachabilityHeadline(report: DirectReachability): string {
  switch (reachabilityState(report)) {
    case "direct":
      return `Open. This machine is on the internet at ${report.publicAddress}, so there was nothing to forward.`;
    case "open":
      return `Open. ${methodLabel(report.method)} forwarded ${portList(report.ports)}.`;
    case "doubleNat":
      return "Your router opened the ports, but your internet provider is between you and the internet, so nobody outside can reach you.";
    case "noAddress":
      return `${methodLabel(report.method)} forwarded ${portList(report.ports)}, but nothing on the internet would say what your address is.`;
    case "refused":
      return "Your router would not open the ports.";
  }
}

/**
 * What to do about it, in one sentence, or null when there is nothing to do.
 * Pure.
 *
 * `forwardTo` is the address a router's port forwarding page asks for, which is
 * this machine on its own network rather than the address anybody outside sees.
 */
export function reachabilityAdvice(report: DirectReachability): string | null {
  const to = report.lanAddress ? ` to ${report.lanAddress}` : "";
  const ports = portList(report.wanted);
  switch (reachabilityState(report)) {
    // Both of the ways of being reachable. There is nothing to do about good
    // news, and a host who is already on the internet is the one who most needs
    // to be left alone: every word of the refusal advice below is a router
    // setting, and they have no router to set it on.
    case "direct":
    case "open":
      return null;
    case "doubleNat":
      return `This is carrier grade NAT and no setting on your router fixes it. Ask your provider for a public address, or play on a lobby server instead.${
        report.routerAddress
          ? ` Your router's own address is ${report.routerAddress}, which is not one the internet routes to.`
          : ""
      }`;
    case "noAddress":
      return `The ports are open. Find your public address another way and send it with the port, or on this network use ${
        report.lanAddress ?? "your local address"
      }.`;
    case "refused":
      return `Turn on UPnP or NAT-PMP in your router's settings and try again, or forward ${ports}${to} by hand.`;
  }
}

/**
 * Whether the outcome is one the host should read as a problem. Pure.
 *
 * Kept separate from the state so a caller styling a panel does not have to
 * enumerate the states to know which colour to use.
 *
 * Two of the five are good news, because there are two ways of being reachable
 * and only one of them involved a router.
 */
export function isReachabilityProblem(report: DirectReachability): boolean {
  const state = reachabilityState(report);
  return state !== "open" && state !== "direct";
}
