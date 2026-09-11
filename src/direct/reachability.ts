import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Opening the ports a host needs on their own router, and finding out from
 * outside whether it worked.
 *
 * The Rust half is `crates/tauri-plugin-coilbox-direct/src/portmap.rs` and
 * `stun.rs`. Everything here is either a binding to it or a pure reading of what
 * it answered, because the interesting part of this feature is the failure, and
 * the failure has to be readable.
 *
 * None of it is a connection from outside, so none of it settles whether
 * anybody can actually get in. That is issue #2119, and every route to a real
 * inbound connection was measured and ruled out in
 * `docs/superpowers/specs/2026-08-30-reachability-probe-design.md`. Read it
 * before reaching for a new signal to add here.
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
  /** The address STUN saw is one this machine holds, so there is nothing in
   *  front of it to forward anything. Answered in Rust, where the whole list of
   *  this machine's addresses is (issue #2111). */
  publicAddressIsLocal: boolean;
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

/**
 * Whether somebody outside this network can actually get in. Pure.
 *
 * Two ways in, and only one of them involved a router. This used to ask the
 * narrower question of whether a mapping was made, which answered no for a
 * machine that was already on the internet and so left that host reading "Open."
 * with no address to send anybody (issue #2085).
 *
 * {@link hostingRoute} asks this on the ladder's second rung, below the rung
 * that catches a public address, so widening it here changes no route: a host
 * who is on the internet is already off the ladder by then. The order is what
 * keeps "direct" and "port mapped" apart, and `hostingRoute.test.ts` holds it
 * there.
 */
export function isReachable(report: DirectReachability): boolean {
  return (
    isOnPublicAddress(report) || (report.method !== null && !report.doubleNat)
  );
}

/**
 * Whether the address the internet sees is this machine's own. Pure.
 *
 * A VPS, a datacentre machine, or a home line with no NAT in front of it. There
 * is no gateway for a port mapping request to reach, so nothing answers one and
 * the report reads like a refusal, which is the opposite of the truth: this host
 * needs nothing opened because nothing is shut (issue #2054).
 *
 * Shared with {@link hostingRoute}'s first rung rather than written out twice,
 * because the panel saying one thing while the hosting ladder a few pixels below
 * says another is the bug this came from.
 *
 * The fact itself comes from Rust, and this reads it. It used to compare
 * `publicAddress` against `lanAddress`, which is the single address a room
 * announces itself at and prefers a private one, so a VPS with a Docker bridge,
 * a VirtualBox adapter or a cloud provider's internal card compared the address
 * STUN saw against 172.17.0.1 and told a host with no router that their router
 * had refused (issue #2111). It is a question about the machine's whole address
 * list, and the side that enumerated the list is the only one holding it.
 *
 * Two unknowns are still not a match: `publicAddressIsLocal` and
 * `publicAddress` are both read off the one STUN answer, so a machine that knows
 * nothing about itself has the flag false rather than matching null against
 * null, which is what it did before.
 */
export function isOnPublicAddress(report: DirectReachability): boolean {
  return report.publicAddressIsLocal;
}

/**
 * The address the internet sees this machine at, when the machine holds it
 * itself, and null in every other case. Pure.
 *
 * This is what a room needs in order to announce an address somebody outside can
 * dial. It works its own address out from the list the machine holds and prefers
 * a private one, which is right on a LAN and picks Docker's bridge on a VPS, so
 * a host who is directly reachable handed every joiner 172.17.0.1 (issue #2130).
 *
 * Null when the host never ticked "Open ports on my router", when no STUN
 * server answered, and when there is a router in front. In all three there is
 * nothing measured to send and the room goes on working the address out for
 * itself.
 *
 * A measurement rather than an instruction, which is why the room takes it in a
 * field of its own rather than in the address the host may type. The room checks
 * it against the machine on every tick and drops it once the machine stops
 * holding it, so this being a few minutes old is safe.
 */
export function ownPublicAddress(
  report: DirectReachability | null,
): string | null {
  if (!report || !isOnPublicAddress(report)) return null;
  return report.publicAddress;
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
 *
 * The port comes from the mappings when there are any, because the router's own
 * port is the one the world reaches and it is not always the one asked for.
 * With no mappings the ports asked for are the answer instead: that is a machine
 * already on the internet, which opened nothing because nothing was shut, and
 * is listening on exactly what it wanted (issue #2085). The mappings are all or
 * nothing, so this never reads a port out of a half-open room.
 */
export function joinAddress(report: DirectReachability): string | null {
  if (!report.publicAddress || !isReachable(report)) return null;
  const listening = report.ports.length > 0 ? report.ports : report.wanted;
  const lobby = listening.find((p) => p.transport === "tcp");
  return lobby
    ? `${report.publicAddress}:${lobby.externalPort}`
    : report.publicAddress;
}

/** The name a host would recognise from their router's settings page. Pure. */
export function methodLabel(method: DirectReachability["method"]): string {
  return method === "natPmp" ? "NAT-PMP" : "UPnP";
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
