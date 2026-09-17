import type { Connections } from "../connections";

/**
 * The battle room's address for the battle on `serverKey` (issue #2844). With
 * no key it is the bare route, which opens whichever connection the player is
 * in a battle on (see {@link battleRoomKey}).
 */
export function battleRoomHref(serverKey?: string | null): string {
  if (!serverKey) return "/battle";
  return `/battle?${new URLSearchParams({ server: serverKey }).toString()}`;
}

function inABattle(connections: Connections, key: string | null): boolean {
  if (key == null) return false;
  const entry = connections[key];
  return !!entry?.live && entry.mirror.state?.currentBattle != null;
}

/**
 * The live connection the player is in a battle on, or null. The focused one
 * when it is in a battle, so a single connection reads exactly as before, and
 * otherwise the first other one that is. Pure.
 */
export function inBattleKey(
  connections: Connections,
  focusKey: string | null,
): string | null {
  if (inABattle(connections, focusKey)) return focusKey;
  for (const key of Object.keys(connections)) {
    if (inABattle(connections, key)) return key;
  }
  return null;
}

/**
 * Which connection the battle room draws. Pure.
 *
 * A `?server=` the link named wins, even when that connection has gone, so the
 * room says "Not in a battle" rather than quietly showing another server's
 * battle. A link with no server, from before servers were told apart, opens the
 * battle the player is in, and the focused connection when they are in none.
 */
export function battleRoomKey(
  connections: Connections,
  focusKey: string | null,
  requested: string | null,
): string | null {
  if (requested) return requested;
  return inBattleKey(connections, focusKey) ?? focusKey;
}
