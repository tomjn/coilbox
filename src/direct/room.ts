import type { LobbyServer } from "../lobby-servers/config";

/**
 * The pure decisions behind hosting a room: where the host's own client dials,
 * how a room key is told from a real server's, and what to say when a room will
 * not start.
 */

/** The port a room listens on unless the host picks another (mirrors the Rust
 *  `DEFAULT_LOBBY_PORT`). Distinct from the engine's game port, which the engine
 *  binds itself and this never touches. */
export const DEFAULT_ROOM_PORT = 8200;

/** The address the host's own client dials. A room binds `0.0.0.0` so the LAN can
 *  reach it, but the host is always on the same machine as the room. */
export const LOOPBACK_HOST = "127.0.0.1";

/** The id the loopback connection is filed under. Nothing looks a room up in the
 *  configured servers, so this only has to be stable and not collide. */
export const DIRECT_SERVER_ID = "direct-room";

/**
 * The lobby server the host's own client connects to once its room is listening.
 *
 * A room is a TASServer, so the whole existing client path applies unchanged: no
 * TLS, because the socket never leaves the machine, and no stored account, because
 * a room has no accounts to store. Pure.
 */
export function directServer(port: number): LobbyServer {
  return {
    id: DIRECT_SERVER_ID,
    name: "Room on this machine",
    host: LOOPBACK_HOST,
    port,
    tls: false,
    allowSelfSigned: false,
    protocol: "tasserver",
  };
}

/**
 * Whether a connection key names a room this client hosts rather than a real
 * server. Keys are `username@host:port` (see `serverKeyFor`). Pure.
 */
export function isDirectKey(serverKey: string | null): boolean {
  return serverKey != null && serverKey.includes(`@${LOOPBACK_HOST}:`);
}

/** The words a stopped room gives its joiners, so the drop is named rather than
 *  silent. Pure. */
export function roomStopReason(host: string): string {
  const who = host.trim();
  return who ? `${who} closed this room` : "the host closed this room";
}

/**
 * What to tell a host whose room would not start. Pure.
 *
 * A taken port is the failure a host meets most: a second coilbox, or a room they
 * forgot they left running. It arrives as an OS error whose wording differs per
 * platform, so both families are matched and turned into the same sentence.
 */
export function startRoomFailure(error: unknown, port: number): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();
  if (
    lower.includes("in use") ||
    lower.includes("usage of each socket address")
  ) {
    return `Port ${port} is already in use. Another coilbox, or a room you left running, has it. Pick another port or stop the other room.`;
  }
  return raw || `Could not start a room on port ${port}.`;
}

/**
 * What the start button says, so a host is never left looking at a button that
 * has already been pressed. Pure.
 */
export function startButtonLabel(
  busy: boolean,
  checksumsReady: boolean,
): string {
  if (busy) return "Starting…";
  return checksumsReady ? "Start room" : "Reading content…";
}

/**
 * A room's port, forced into the range a socket can be bound on. Pure.
 *
 * Port 0 would work on the Rust side, where the OS picks a free port, but a host
 * who cannot see which one it picked has nothing to give a joiner.
 */
export function normalizeRoomPort(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ROOM_PORT;
  return Math.max(1, Math.min(65535, Math.trunc(value)));
}
