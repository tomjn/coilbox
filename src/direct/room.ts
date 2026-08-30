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
 * The lobby server a room is dialled as: the host's own room over loopback, or
 * somebody else's at the address their beacon arrived from.
 *
 * A room is a TASServer, so the whole existing client path applies unchanged: no
 * TLS, because a room serves none, and no stored account, because a room has no
 * accounts to store. Pure.
 */
export function directServer(
  port: number,
  host: string = LOOPBACK_HOST,
): LobbyServer {
  const own = host === LOOPBACK_HOST;
  return {
    id: DIRECT_SERVER_ID,
    name: own ? "Room on this machine" : `Room at ${host}`,
    host,
    port,
    tls: false,
    allowSelfSigned: false,
    protocol: "tasserver",
  };
}

/**
 * Why this client cannot host a room right now, or null when it can. Pure.
 *
 * Coilbox holds one lobby connection and a room needs it, so a connection of any
 * kind is in the way. Which kind decides what to do about it, and that is told
 * rather than read off the key: both are `username@host:port`, so a joiner in
 * somebody else's room used to be sent to log out of a lobby server they were
 * never on (issue #1618).
 *
 * A host's own room is not a case here. The control shows the running room in
 * place of the form while there is one, so this is only ever read by somebody
 * who has no room of their own.
 */
export function hostBlockedReason(
  activeKey: string | null,
  /** Whether the live connection is a room somebody is hosting. */
  direct: boolean,
): string | null {
  if (!activeKey) return null;
  if (direct) {
    return "You are connected to a room already. Disconnect from it first: coilbox holds one lobby connection, and hosting a room needs it.";
  }
  return "Log out of the lobby server first. Coilbox holds one lobby connection, and hosting a room needs it.";
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
 * What a host reads about their room being announced. Pure.
 *
 * This is the answer the "Yours" row in the network list used to carry, and it
 * is here because the room was listed twice while it was hosted: once there and
 * once in the battle list, which is the copy that takes the host back into the
 * battle (issue #1608). A host still has to be able to tell whether their room
 * is being announced, which is what they want to know when nobody is joining, so
 * the fact moved onto the host's own line, where it is said in words rather than
 * left to be read out of a badge being present.
 *
 * "Heard" is this client hearing its own beacon back off the network, which is
 * the only evidence a host has that the announcement left the machine at all.
 */
export function announcementNote(advertise: boolean, heard: boolean): string {
  if (!advertise) {
    return "Not announced on this network, so give joiners your address.";
  }
  if (!heard) {
    return "Not heard announcing itself yet. If it stays that way, people on this network will need your address rather than finding the room themselves.";
  }
  return "Announced on this network.";
}

/**
 * What a host reads about the address their running room hands out. Pure.
 *
 * `RoomStatus.ip` is the address the room writes into its battle, which a
 * joiner's engine dials when the game starts. It is a different fact from the
 * addresses beside it, which are what somebody types in to reach the room in the
 * first place, so it is said in its own words and makes no claim about whether
 * anybody can reach it.
 *
 * Nothing drew it at all until now, which did not matter while it could not
 * change. A room with no address of the host's own choosing re-reads this
 * machine's address on a timer and moves the battle when it changes (issue
 * #2116), so a room that started on the network next door can be on a VPN
 * twenty seconds later. `previous` is the address it was handing out before,
 * or null while it has not moved, and it is named because "10.8.0.2" on its own
 * does not read as "this changed under you".
 *
 * Loopback is the one value the room can arrive at that cannot work, and it is
 * the fallback for a machine with no other address. Saying it flatly would read
 * as fine.
 */
export function gameAddressNote(ip: string, previous: string | null): string {
  const now =
    ip === LOOPBACK_HOST
      ? `The room hands joiners ${ip} for the game itself, which points back at their own machine rather than yours.`
      : `The room hands joiners ${ip} for the game itself.`;
  if (!previous) return now;
  return `${now} It was handing out ${previous} earlier.`;
}

/** How often the host's own room is asked what it holds. The command reads a
 *  struct out of a task in this same process, so two seconds costs nothing and is
 *  quick enough that somebody waiting at the door is not left there. */
export const ROOM_POLL_MS = 2000;

/**
 * What to say above the list of people waiting to be let in. Pure.
 *
 * The count is in the words rather than only in the list, because the list is
 * read as a set of buttons and the sentence is what a host skims.
 */
export function pendingJoinsHeadline(count: number): string {
  if (count === 1) return "Somebody is waiting to join";
  return `${count} people are waiting to join`;
}

/**
 * The names that have started waiting since the last look. Pure.
 *
 * The prompt lives in the battle room, so a host who has wandered off to
 * Content or Settings hears nothing and the person waiting sits on a spinner
 * until they come back (issue #1600). This is what a notification fires on, and
 * it has to be the arrivals rather than the list: the list is republished every
 * two seconds, and notifying off that would be a toast every two seconds for as
 * long as anybody waits.
 */
export function newPendingNames(before: string[], after: string[]): string[] {
  return after.filter((name) => !before.includes(name));
}

/**
 * The notification a host gets when somebody starts waiting on them. Pure.
 *
 * One notification however many arrived at once, because they arrive in the
 * same two-second tick and three toasts say nothing the first one did not. The
 * names are in it: a host who is elsewhere in the app is being asked to decide
 * something, and "somebody" is not enough to decide on.
 */
export function waitingJoinNotice(names: string[]): {
  title: string;
  body: string;
} {
  const who =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return {
    title: pendingJoinsHeadline(names.length),
    body: `${who} ${names.length === 1 ? "is" : "are"} waiting for you to let them into your room. Open the battle room to answer.`,
  };
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
 * Why a typed player name cannot be used in a room, or null when it can. Pure.
 *
 * A room announces its members by name in single space-separated wire fields, so
 * a name with a space in it arrives as two and the login is refused. Saying so
 * here is the difference between a corrected field and a handshake that fails
 * for reasons nobody can see.
 */
export function playerNameProblem(typed: string): string | null {
  const name = typed.trim();
  if (!name) return "Enter the name others will see.";
  if (/\s/.test(name)) {
    return "No spaces in your name. A room announces names in single wire fields, so a name with a space in it does not survive the trip.";
  }
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
