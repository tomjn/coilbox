import { useSyncExternalStore } from "react";
import { type DirectReachability, isReachable } from "./reachability";

/**
 * Which of the ways of being reachable a host is actually going to use.
 *
 * Coilbox has always worked out whether a port opened and then thrown the answer
 * away: the hosting form asked a checkbox what NAT mode to advertise, and the
 * reachability report next to it was read by nobody. This is the join between
 * the two (issue #2020).
 *
 * The ladder is ordered rather than scored. Each rung is tried only because the
 * one above it did not work, so a host who needs nothing opened is never relayed
 * on the grounds that a relay exists.
 *
 * # What is deliberately not here
 *
 * Hole punching. Coilbox does not implement it: `UDPSOURCEPORT` and
 * `CLIENTIPPORT` appear nowhere in this repo, so `natType 1` only ever
 * advertised a capability that could not happen, and a battle that looked
 * joinable and was not is worse than one that says it is direct. The relay
 * covers the same routers with a better success rate.
 */

/**
 * The NAT mode coilbox advertises, on every rung of the ladder.
 *
 * There is one value because every route coilbox can take ends in an address a
 * joiner dials straight. That includes the relay: a TURN allocation's address is
 * a genuinely public one, so any client, coilbox or SpringLobby or Chobby, joins
 * a relayed battle the ordinary way and never has to know (issue #2017).
 *
 * TASServer's other modes are `1` for hole punching, which we do not do, and `2`
 * for fixed source ports, which needs the same traversal work. Named rather than
 * written as a bare `0` at each call site so the reason travels with it.
 */
export const NAT_TYPE_DIRECT = 0;

/**
 * Settings key: host through the lobby server's relay when nothing else worked.
 *
 * Default on, because the hosts who end up on the bottom rung are the ones least
 * able to work out why hosting failed, and a battle with a slightly worse ping
 * is better than a battle nobody can join (issue #2023).
 *
 * Stored rather than asked again each time. Somebody who turns this off is
 * saying something about how they play, not about this one battle, and making
 * them say it again every time they host is how a preference becomes a chore.
 */
export const HOST_THROUGH_RELAY_KEY = "multiplayer.hostThroughRelay";

/**
 * How a hosted battle is reachable, or why it is not.
 *
 * The first three are the ladder from issue #2020. The last two are its two
 * ends, and they are separate on purpose: "we looked and found nothing" and "no
 * one asked us to look" call for opposite things, and collapsing them would
 * relay every host who left the port toggle alone.
 */
export type HostingRoute =
  /** This machine answers on the address the internet sees. Nothing to open. */
  | "direct"
  /** UPnP or NAT-PMP opened the port and nothing is in front of the router. */
  | "portMapped"
  /** Neither worked, and the lobby server has a relay to host through. */
  | "relay"
  /** Neither worked, and there is no relay to step down to. */
  | "unreachable"
  /** Nobody has asked the router anything, so nothing is known either way. */
  | "unchecked";

/**
 * Which route hosting takes. Pure.
 *
 * `report` is null when the host has not turned on "Reachable over the
 * internet", which is its default in both hosting forms. That is not a failed
 * check, it is the absence of one, and it is why "unchecked" exists: opening a
 * port on somebody's router changes what the rest of the internet can reach, so
 * coilbox only does it when asked, and a host who never asked must not be
 * quietly put through a relay on no evidence.
 *
 * `relayAvailable` comes from the lobby server's own compatibility flags, via
 * `relayHostingAvailable` in `src/multiplayer/protocol.ts`. It is false on every
 * server today, and it is false for a room hosted on a LAN, which has no lobby
 * server to ask.
 *
 * Rung two is `isReachable`, the verdict the host is already being shown a few
 * pixels above this in {@link ReachablePorts}. Using a stricter test here would
 * let the panel say "Open." while hosting quietly took the relay, and a host
 * reading two contradictory answers about their own router is worse off than one
 * reading a single answer that is sometimes optimistic.
 *
 * `wantsRelay` is the host's own answer, from `HOST_THROUGH_RELAY_KEY`. It sits
 * on the step from the second rung to the third and nowhere else, because a host
 * who can be reached directly was never going to be relayed, and refusing the
 * relay must not cost them the route they already had. There is no default here:
 * the default belongs to the checkbox that asks the question (issue #2023).
 */
export function hostingRoute(
  report: DirectReachability | null,
  relayAvailable: boolean,
  wantsRelay: boolean,
): HostingRoute {
  if (!report) return "unchecked";
  // Rung one, and it asks nothing about the router on purpose. A machine already
  // on the internet has no gateway to answer a port mapping request, so its
  // report is a refusal with a public address in it, and a rung that needed a
  // mapping would read that as a host who cannot be reached. First because a
  // machine that is on the internet and also happens to hold a mapping is
  // reachable at its own address, and did not need the mapping to be.
  if (report.publicAddress && report.publicAddress === report.lanAddress) {
    return "direct";
  }
  if (isReachable(report)) return "portMapped";
  return relayAvailable && wantsRelay ? "relay" : "unreachable";
}

/**
 * The port a joiner dials for the game. Pure.
 *
 * Almost always the port the engine binds, and not always: a router with that
 * port already spoken for may open a different one and say so, and advertising
 * the engine's own port then sends everybody to a closed door. That is the one
 * thing in here that is a fix rather than a rearrangement.
 *
 * Only on the mapped route. A report can hold live mappings on the other routes
 * too, most obviously behind carrier grade NAT where the router genuinely opened
 * a port onto a corridor, and naming that port would be naming a door nobody can
 * walk to. Under a relay the address and port are the allocation's, which is
 * issue #2017's to supply.
 */
export function advertisedGamePort(
  route: HostingRoute,
  report: DirectReachability | null,
  enginePort: number,
): number {
  if (route !== "portMapped" || !report) return enginePort;
  // The game's port, never the room's. A room maps a TCP port of its own for
  // the lobby, and the engine is the UDP one.
  const game = report.ports.find(
    (p) => p.transport === "udp" && p.port === enginePort,
  );
  return game?.externalPort ?? enginePort;
}

/**
 * What the route means for the people trying to join, in one sentence. Pure.
 *
 * `lanRoom` because the two hosting forms are asking different questions. A
 * battle on a lobby server exists to be joined from the internet, so a host with
 * no way out of their network has a problem. A room on a LAN is doing exactly
 * what it is for with no way out at all, and telling that host they are
 * unreachable would be reporting the feature as a fault.
 *
 * `relayDeclined` splits the same route in two for the same reason. There are
 * two ways to reach the end of the ladder and only one of them is somebody
 * else's fault, so a host who turned the relay off themselves must not be told
 * the server has none: they would go looking for a fault that is a checkbox they
 * ticked. It says only what the host chose and not what the server has, which is
 * true either way, and turning the relay back on then says the rest.
 *
 * The relay's own sentence does not name its cost. That is said once, next to
 * the checkbox that asks about it, which is where somebody is deciding rather
 * than reading what was decided (issue #2023).
 */
export function hostingRouteSummary(
  route: HostingRoute,
  { lanRoom, relayDeclined }: { lanRoom: boolean; relayDeclined?: boolean },
): string {
  switch (route) {
    case "direct":
      return "This machine is on the internet under its own address, so players connect straight to it.";
    case "portMapped":
      return "Your router opened the port, so players connect straight to this machine.";
    case "relay":
      return "Nothing opened on your router, so this battle goes through the server's relay.";
    case "unreachable":
      if (lanRoom)
        return "Nobody outside this network can reach this room, so it is for the people on this network.";
      return relayDeclined
        ? "Nothing opened on your router, and you have asked not to be relayed, so only players who can already reach this machine can join."
        : "Nothing opened on your router and this server has no relay, so only players who can already reach this machine can join.";
    case "unchecked":
      return lanRoom
        ? "People on this network can join. Turn on “Reachable over the internet” above to find out whether anybody outside can."
        : "Players connect straight to this machine, which only works if the port is already open. Turn on “Reachable over the internet” above to find out.";
  }
}

/**
 * The route the battle this client last opened actually took.
 *
 * A module singleton, like `hostedRoom.ts`, because the route is decided in a
 * form and read in the battle room, which is a different page reached by a
 * navigation that unmounts the form. Held in memory rather than in settings: a
 * route is a fact about a battle that is open now, and a stale one read back
 * after a restart would be worse than none.
 *
 * Issue #2022 is the reader: it says which route a battle took so a worse ping
 * has an explanation.
 *
 * # The one thing a reader has to do
 *
 * This says nothing about whether that battle is still open. Both forms clear it
 * before they try to host and set it once the battle exists, so it never
 * describes a host that failed and never carries over into the next one. It does
 * survive leaving the battle, because nothing here is told about that. So a
 * reader must ask whether this client is in the battle it is describing, which
 * it needs the lobby state for anyway.
 */
let chosen: HostingRoute | null = null;
const listeners = new Set<() => void>();

/** Say which route the battle just hosted took, or null when there is none. */
export function recordHostingRoute(route: HostingRoute | null): void {
  if (chosen === route) return;
  chosen = route;
  for (const listener of listeners) listener();
}

/** The recorded route, without subscribing to it. */
export function chosenHostingRoute(): HostingRoute | null {
  return chosen;
}

/** The recorded route, for a component that should redraw when it changes. */
export function useChosenHostingRoute(): HostingRoute | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => chosen,
    () => chosen,
  );
}
