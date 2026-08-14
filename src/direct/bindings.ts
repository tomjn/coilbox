import { defineCommand } from "@picoframe/plugin-sdk";
import type { Battle } from "../multiplayer/bindings";

/**
 * Typed bindings to the `coilbox-direct` plugin: the TASServer subset this client
 * runs in process so a battle can be hosted with no lobby server at all.
 *
 * Only the room's lifecycle is here. Everything above the socket is the ordinary
 * multiplayer path, because the host's own client dials the room over loopback and
 * talks to it exactly as it talks to a real server.
 */

/** A running room (mirrors the Rust `RoomStatus`). */
export interface DirectRoomStatus {
  /** The port the room is listening on, which is what the host's own client dials
   *  over loopback and what a joiner has to be given. */
  port: number;
  host: string;
  /** The address a joining engine dials for the game itself. */
  ip: string;
  approveJoins: boolean;
  /** Whether the room is announcing itself on the local network. */
  advertise: boolean;
  /** Open sockets, logged in or not. The host's own client is one of them. */
  peers: number;
  /** Names waiting on the host's answer, oldest first. Empty while `approveJoins`
   *  is off. */
  pending: string[];
  /** The battle as the room believes it, or null before the host has opened one. */
  battle: Battle | null;
}

/**
 * Bind the lobby port and start hosting. Answers with the port the host's own
 * client should then connect to over loopback.
 *
 * Rejects when the port is taken, which is the failure a host meets most.
 */
export const directStartRoom = defineCommand<
  {
    /** The player who holds host powers, by the name their client logs in under. */
    host: string;
    /** The address announced to joiners for the game. This machine's address on
     *  the network it is on when omitted, and loopback only if it is on none. */
    ip?: string | null;
    /** Defaults to 8200 on the Rust side. */
    port?: number | null;
    approveJoins?: boolean | null;
    /** Announce the room on the local network, so people on it find the room
     *  without being told an address. On when omitted. */
    advertise?: boolean | null;
  },
  { port: number }
>("coilbox-direct", "direct_start_room");

/**
 * Stop hosting, telling everybody why. The reason reaches every peer as a server
 * message before their socket closes, so a joiner sees words rather than a room
 * that silently stopped existing.
 */
export const directStopRoom = defineCommand<
  { reason?: string | null },
  { stopped: boolean }
>("coilbox-direct", "direct_stop_room");

/** What the room holds, or `{ room: null }` when this client is not hosting. */
export const directRoomStatus = defineCommand<
  Record<string, never>,
  { room: DirectRoomStatus | null }
>("coilbox-direct", "direct_room_status");

/**
 * Answer a join the room is holding: let them in, or turn them away with a
 * reason they read verbatim.
 *
 * Only reaches a room this client is hosting. The answer never touches the wire
 * as `JOINBATTLEREQUEST`, because our own client answers that automatically and
 * would wave every join through before the host saw it, so the room applies it
 * against the host's own connection instead.
 *
 * An answer to a name the room is not holding is ignored, so pressing a button
 * on somebody who has already given up is harmless.
 */
export const directAnswerJoin = defineCommand<
  {
    username: string;
    allow: boolean;
    /** Why they were turned away. The room supplies its own words when omitted. */
    reason?: string | null;
  },
  { answered: boolean }
>("coilbox-direct", "direct_answer_join");

/** A room heard announcing itself on the local network (mirrors the Rust
 *  `LanRoom`). */
export interface DirectLanRoom {
  /** Names one run of one room. New every time a room starts, so it says nothing
   *  about the machine or the person. */
  id: string;
  /** The room's name, as its host typed it. */
  title: string;
  host: string;
  game: string;
  map: string;
  players: number;
  maxPlayers: number;
  /** The lobby port to dial, alongside {@link DirectLanRoom.address}. Not the
   *  engine's game port. */
  port: number;
  passworded: boolean;
  /** Where the announcement came from, which is the address to dial. Read off
   *  the datagram rather than out of it, so it is right for the interface it
   *  arrived on. */
  address: string;
  /** This client's own room, heard back off the network. Worth showing as yours
   *  rather than hiding: a host who cannot see their own room has no way to tell
   *  whether anybody else can. */
  isSelf: boolean;
  /** How long ago this room was last heard from, on whichever announcement spoke
   *  most recently. */
  lastSeenMs: number;
  /** The announcements carrying this room: coilbox's own UDP beacon, a DNS-SD
   *  service record, or both. A room is announced both ways and listed once, so
   *  one entry here means the other half of the network is not getting through.
   */
  sources: ("beacon" | "mdns")[];
}

/**
 * The rooms being announced on this network right now.
 *
 * Starts listening the first time it is called, so a client that never looks for
 * a room never binds the beacon port. The first answer is usually empty and the
 * next one, two seconds later, is not: beacons arrive when their hosts send them
 * and there is nothing to ask for, so this is polled rather than awaited.
 */
export const directLanRooms = defineCommand<
  Record<string, never>,
  { rooms: DirectLanRoom[] }
>("coilbox-direct", "direct_lan_rooms");

/** Stop listening for rooms and free the beacon port. */
export const directStopDiscovery = defineCommand<
  Record<string, never>,
  { stopped: boolean }
>("coilbox-direct", "direct_stop_discovery");

/** One address this machine answers on (mirrors the Rust `LocalAddress`). */
export interface DirectLocalAddress {
  /** Dotted quad, as it would be typed into "Join by address". */
  address: string;
  /** What the OS calls the interface it is on, for example `en0` or `Wi-Fi`. */
  interface: string;
  /** This machine talking to itself, which is an address to give nobody else. */
  loopback: boolean;
}

/**
 * Every address this machine can be dialled at, best first and loopback last.
 *
 * What a host reads out to somebody joining by address (issue #1611). All of
 * them, because a machine with a VPN or Docker on it has several private
 * addresses and only the person hosting can tell which one their friend is on
 * the same side of.
 */
export const directLocalAddresses = defineCommand<
  Record<string, never>,
  { addresses: DirectLocalAddress[] }
>("coilbox-direct", "direct_local_addresses");
