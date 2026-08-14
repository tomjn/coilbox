import type { Battle } from "../multiplayer/bindings";
import { isDirectKey } from "./room";

/**
 * The pure decisions behind finding and joining somebody else's room: what a
 * typed address means, why a join is unavailable, and how long to wait for the
 * battle a room is supposed to be holding.
 *
 * Hosting's half of the same job is in `room.ts`.
 */

/** How often to ask the beacon listener what it has heard.
 *
 * The same interval rooms announce themselves at (`BEACON_INTERVAL`), because
 * asking faster only re-reads a map that has not changed. */
export const LAN_POLL_MS = 2000;

/**
 * The address and port in one typed string, so `192.168.1.5:8200` read out over
 * a sofa or pasted from a host's screen lands in both fields. Pure.
 *
 * IPv6 is deliberately not split: `::1` is all colons and nothing here could
 * tell its last group from a port. It is passed through whole, which leaves the
 * port field as the person typed it.
 */
export function splitHostPort(typed: string): {
  address: string;
  port: string | null;
} {
  const value = typed.trim();
  const colons = value.match(/:/g)?.length ?? 0;
  if (colons !== 1) return { address: value, port: null };
  const [address, port] = value.split(":");
  if (!/^\d+$/.test(port)) return { address: value, port: null };
  return { address, port };
}

/**
 * Why a typed address cannot be dialled, or null when it can. Pure.
 *
 * Only the shapes that could not possibly be an address are refused. Whether a
 * machine is actually there is the connection's answer, not this one's, and
 * guessing at it here would refuse hostnames that resolve perfectly well.
 */
export function addressProblem(typed: string): string | null {
  const value = typed.trim();
  if (!value) return "Enter the host's address.";
  if (/\s/.test(value)) return "An address has no spaces in it.";
  if (value.includes("//") || value.includes("/")) {
    return "Just the address, with no http:// and no path after it.";
  }
  return null;
}

/**
 * Why this client cannot join a room right now, or null when it can. Pure.
 *
 * Coilbox holds one lobby connection. Whatever has it, a join needs it, so the
 * reason is said out loud rather than shown as a button that does nothing.
 */
export function joinBlockedReason(
  activeKey: string | null,
  hosting: boolean,
): string | null {
  if (hosting) {
    return "Stop your own room first. Coilbox holds one lobby connection, and joining needs it.";
  }
  if (isDirectKey(activeKey)) {
    return "Leave the room you are in first. Coilbox holds one lobby connection, and joining needs it.";
  }
  if (activeKey) {
    return "Log out of the lobby server first. Coilbox holds one lobby connection, and joining needs it.";
  }
  return null;
}

/** What to tell somebody whose join never reached a room. Pure.
 *
 * A room is a port on a machine, so the failures are the ones any socket has:
 * nothing listening, nothing at that address, or a name that resolves to
 * neither. The OS wording differs per platform and says none of what to do, so
 * the address that was actually dialled is named back. */
export function joinRoomFailure(
  error: unknown,
  address: string,
  port: number,
): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();
  const where = `${address}:${port}`;
  if (lower.includes("refused")) {
    return `Nothing is hosting on ${where}. Check the port with the host, and that their room is still up.`;
  }
  if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("unreachable") ||
    lower.includes("no route")
  ) {
    return `Could not reach ${where}. You may be on a different network from the host, or a firewall is in the way.`;
  }
  if (
    lower.includes("dns") ||
    lower.includes("resolve") ||
    lower.includes("nodename") ||
    lower.includes("not known")
  ) {
    return `No machine called ${address}. Check the spelling, or use its address instead of its name.`;
  }
  return raw || `Could not join ${where}.`;
}

/** What to tell somebody who reached a room with nothing to join in it. Pure. */
export function noRoomBattleFailure(): string {
  return "That room is up but has no battle open in it, so there is nothing to join. Ask the host to start it again.";
}

/** How long to wait for the room's battle to arrive, and how often to look.
 *
 * A room sends `BATTLEOPENED` right behind the login it has just accepted, so
 * this is only covering the gap between the two, over a network rather than
 * over loopback. Five seconds is long past the point where a room that is going
 * to answer has. */
const BATTLE_TRIES = 50;
const BATTLE_POLL_MS = 100;

/**
 * The battle in the room this client has just connected to, or null if it never
 * turns up.
 *
 * Being connected is not being able to join. The battle arrives as a message
 * after the login, so a join sent the moment the socket is ready has no battle
 * id to name yet. A room holds exactly one battle, so the first one is it.
 *
 * `wait` is passed in so the rule can be tested without a clock.
 */
export async function roomBattle(
  battles: () => Promise<Battle[]>,
  wait: (ms: number) => Promise<void>,
): Promise<Battle | null> {
  for (let tries = 0; tries < BATTLE_TRIES; tries++) {
    const open = await battles();
    if (open.length > 0) return open[0];
    await wait(BATTLE_POLL_MS);
  }
  return null;
}
