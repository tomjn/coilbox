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
    /** The address announced to joiners for the game. Loopback when omitted. */
    ip?: string | null;
    /** Defaults to 8200 on the Rust side. */
    port?: number | null;
    approveJoins?: boolean | null;
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
