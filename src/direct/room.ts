import type { LobbyServer } from "../lobby-servers/config";
import type { DirectRoomStatus } from "./bindings";

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
 * The one line a host reads while their room is up: where it is, whose name holds
 * it, how many people are in, and whether a joiner needs a password. Pure.
 *
 * Peers are open sockets and the host's own client is one of them, so the count
 * said out loud is one less than the room's.
 *
 * The password is left unsaid until there is a battle, because the battle is what
 * carries the answer and a room that has only just bound its port has none yet.
 * Guessing "no password" in that gap would be wrong for every passworded room.
 */
export function roomSummary(room: DirectRoomStatus): string {
  const joined = Math.max(0, room.peers - 1);
  const who =
    joined === 0
      ? "nobody has joined yet"
      : joined === 1
        ? "1 player joined"
        : `${joined} players joined`;
  const parts = [`Hosting on port ${room.port} as ${room.host}`, who];
  if (room.battle) {
    parts.push(room.battle.passworded ? "password needed" : "no password");
  }
  return parts.join(", ");
}

/**
 * Why a typed room port cannot be used, or null when it can. Pure.
 *
 * Refusing rather than correcting: a port quietly clamped into range is a room
 * listening somewhere the host never chose, and the address they then read out to
 * a joiner is the one they typed. Port 0 is refused for the same reason, even
 * though the Rust side would take it and let the OS pick.
 */
export function roomPortProblem(typed: string): string | null {
  const value = typed.trim();
  if (!value) return "Enter a port.";
  if (!/^\d+$/.test(value)) return "Ports are whole numbers.";
  const port = Number(value);
  if (port < 1 || port > 65535) return "Ports run from 1 to 65535.";
  return null;
}

/**
 * Why a typed room password cannot be used, or null when it can. Pure.
 *
 * The password is sent in one space-separated slot of the line that opens the
 * battle, so a space in it moves the port, the player limit and both content
 * hashes along one. The room reads them where they land, and the battle it opens
 * has a limit of zero, which tells every joiner it is full. Nothing on either
 * side can tell afterwards, so it is refused here, before a port is bound.
 */
export function roomPasswordProblem(typed: string): string | null {
  if (!/\s/.test(typed.trim())) return null;
  return "No spaces in a room password. A room sends it in a single wire field, so a password with a space in it does not survive the trip.";
}

/** What to tell a host whose room started but opened no battle. Pure.
 *
 * The room is stopped by the time this is read: a listener with a host in it and
 * nothing to join is worse than no room, because it looks like hosting works
 * (issue #1587). */
export function noBattleFailure(): string {
  return "The room started but its battle never opened, so the room has been stopped. Try again, and if it keeps happening, host on another port.";
}

/** How long to wait for the battle before calling a start failed, and how often
 *  to look. Both halves happen in this process, so a second is already long, and
 *  five is only here so a machine under load is not called a failure. */
const BATTLE_TRIES = 50;
const BATTLE_POLL_MS = 100;

/**
 * Wait for the room to report the battle the host has just asked it to open,
 * answering `null` if it never does.
 *
 * Sending `OPENBATTLE` is not hosting. The command that sends it answers as soon
 * as the line is queued, so every way the line can come to nothing, whether a
 * refusal, a login that had not landed or a socket that went, used to leave a
 * host looking at a running room with no battle in it and nothing said (issue
 * #1587). Asking the room what it actually holds is the only answer that cannot
 * lie about that.
 *
 * `wait` is passed in so the rule can be tested without a clock.
 */
export async function battleOpened(
  status: () => Promise<DirectRoomStatus | null>,
  wait: (ms: number) => Promise<void>,
): Promise<DirectRoomStatus | null> {
  for (let tries = 0; tries < BATTLE_TRIES; tries++) {
    const room = await status();
    if (room?.battle) return room;
    await wait(BATTLE_POLL_MS);
  }
  return null;
}
