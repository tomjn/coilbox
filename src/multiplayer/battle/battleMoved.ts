import { useSyncExternalStore } from "react";

/**
 * Which battle has moved onto a different address while this client sat in it.
 *
 * `BATTLEHOSTMOVED` is the one line in the lobby protocol that changes a battle's
 * address without disturbing the battle around it. It reaches everybody, not just
 * the host: coilbox's own room server sends it to every peer when the machine
 * running the room changes address (issue #2116), and a lobby server sends it to
 * every client that asked for relay support at login. The reducer folds the new
 * pair into the battle so the next launch dials the right place, and until now
 * that was the whole of it. Nobody in the room was told.
 *
 * The host is told already, twice over. A host running a LAN room reads the
 * room-moved strip, and a host whose relay moved has the relay agent that asked
 * for the move and warns when the lobby refuses it. This is the half that was
 * missing, which is everybody else.
 *
 * # Why this holds a battle id and not a flag
 *
 * `leaveBattle.ts` is the write-up of what a battleless singleton cost: a record
 * with no battle in it outlives the battle it describes and a later reader takes
 * it for their own. So this names the battle, and the panel that draws it checks
 * that name against the battle on screen rather than trusting that it is current.
 *
 * That leaves one way to be stale, which is leaving a battle and rejoining the
 * same id. Somebody who rejoins is handed the new address in the ordinary
 * `BATTLEOPENED` and was never holding a dead one, so there is nothing to tell
 * them. {@link forgetBattleMovedUnless} is what drops it, driven by the battle
 * this client is actually in.
 *
 * # What is deliberately not here
 *
 * Whether the battle is relayed. A move proves it on a lobby server, which
 * refuses to move a battle that was never relayed, and proves nothing in a
 * coilbox room, where the same line means the host's own machine changed
 * address. Issue #2073 wanted a joiner told their battle is relayed, and this is
 * not that: it is the thing that is true in both cases.
 */
let movedBattle: number | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** Say that this battle has moved onto a different address. */
export function recordBattleMoved(id: number): void {
  if (movedBattle === id) return;
  movedBattle = id;
  announce();
}

/**
 * Drop the record unless it is about the battle this client is in.
 *
 * `null` for a client that is in no battle at all, which drops it either way.
 */
export function forgetBattleMovedUnless(id: number | null): void {
  if (movedBattle === null || movedBattle === id) return;
  movedBattle = null;
  announce();
}

/** The battle that moved, for a component that should redraw when it does. */
export function useBattleMoved(): number | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => movedBattle,
    () => movedBattle,
  );
}

/**
 * What a move means to somebody sitting in the battle it happened to.
 *
 * Three facts and no advice, because there is nothing here for the reader to do.
 * The address moved, coilbox followed it, and anybody already playing was
 * connected to the address that has gone. That last one is the sentence somebody
 * came looking for: a game that stopped for no visible reason now has a reason.
 *
 * It does not say the game has ended, because this does not know that. It says
 * where the running game was connected, which is a fact about an address rather
 * than a claim about the engine, and it leaves the reader to draw the short
 * conclusion themselves.
 *
 * The new address is not named. The host's own strip names theirs because a host
 * hands that number to people. A joiner never types it, and coilbox has already
 * used it by the time this is read.
 */
export const BATTLE_MOVED_NOTICE =
  "This battle has moved onto a different address, because the connection the host runs it on moved. Coilbox has followed it, so starting the game from here uses the new one. Anybody already in the game was connected to the address it has left.";
