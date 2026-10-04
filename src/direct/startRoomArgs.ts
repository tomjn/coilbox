import {
  DEFAULT_HOST_PORT,
  type OpenBattleArgs,
} from "../multiplayer/battles/HostBattleForm";
import { type HostingRoute, NAT_TYPE_DIRECT } from "./hostingRoute";

/**
 * The battle a room opens once the host's own client has connected to it. Pure.
 *
 * Shared by the room form and the one-button room, so the two cannot open a
 * battle that differs in anything but what the person chose.
 */
export function roomBattleArgs(opts: {
  /** The password, trimmed or not. Empty is an open room. */
  password: string;
  maxPlayers: number;
  /** The room name as typed. Empty falls back to "<host>'s room". */
  title: string;
  /** The name the host's own client logs in under, already trimmed. */
  host: string;
  route: HostingRoute;
  version: string;
  gameName: string;
  mapName: string;
  modhash: number;
  maphash: number;
}): OpenBattleArgs {
  return {
    battleType: 0,
    natType: NAT_TYPE_DIRECT,
    key: opts.password.trim() || "*",
    // The engine's game port, not the room's. The two are separate ports
    // and the engine binds its own, exactly as it does on a real server.
    //
    // The port the router opened deliberately does not go here, unlike a
    // battle on a lobby server. This one field is read by everybody in the
    // room, and a room's joiners are on both sides of the router: the
    // people on this network reach the engine at the port it binds, and
    // only somebody outside would want the router's. Naming the router's
    // would break the case the room exists for to fix the case it does
    // not.
    //
    // Worth knowing before anybody revisits that trade, because it looks
    // like a coin flip and is not. Making the two port numbers agree buys
    // nothing at all. A room announces one address as well as one port,
    // and for a room on a LAN that address is this machine on this
    // network, so a joiner from outside is sent somewhere they cannot
    // dial whichever port they are handed. A machine behind a router that
    // could hand back a different external port holds a private address
    // by definition, so the port is never the only thing in the way and
    // never the first. Serving both sides means choosing the address per
    // joiner as well, which the room cannot do today because its accept
    // loop drops the peer's socket address (issue #2055).
    port: DEFAULT_HOST_PORT,
    // Never true here, and written as the same expression the lobby form
    // uses rather than a bare false, because the reason it is never true
    // is that a room has no lobby server to have a relay. Hard-coding it
    // would hide that behind a constant.
    relay: opts.route === "relay",
    maxPlayers: opts.maxPlayers,
    modhash: opts.modhash,
    rank: 0,
    maphash: opts.maphash,
    engine: "spring",
    version: opts.version,
    map: opts.mapName,
    title: opts.title.trim() || `${opts.host}'s room`,
    modname: opts.gameName,
  };
}
