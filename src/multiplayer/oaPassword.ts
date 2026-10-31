import type { Battle } from "./bindings";
import { isOaBattle, OA_ENGINE_NAME } from "./oaHost";

/**
 * The password of the Open Annihilation (OA) battle this client is in, kept from
 * the host form or the join until OA is started (issue #4955). In memory only:
 * it is never written to settings, and it goes when the battle does.
 *
 * There is one slot, as a player is in one battle at a time (issue #2844). The
 * lobby never sends a battle's password to anybody, so a joiner's own typed key
 * is all a joiner can have, and one let in without typing has none.
 */

interface Held {
  serverKey: string;
  /** Null until the lobby shows the battle this client asked to open. */
  battleId: number | null;
  /** The battle the host was in when they asked, which is not the new one. */
  previousBattle: number | null;
  password: string;
  /** The lobby has shown the player in the battle. */
  landed: boolean;
}

let held: Held | null = null;

/** Keep the password of the OA battle being opened, if it is one and has one. */
export function holdOaHostPassword(
  serverKey: string,
  currentBattle: number | null,
  battle: { engine: string; key: string },
) {
  // "*" is what OPENBATTLE carries for no password.
  held =
    battle.engine === OA_ENGINE_NAME && battle.key !== "*"
      ? {
          serverKey,
          battleId: null,
          previousBattle: currentBattle,
          password: battle.key,
          landed: false,
        }
      : null;
}

/** Keep the key a player is joining an OA battle with, if they typed one. */
export function holdOaJoinPassword(
  serverKey: string,
  battle: Pick<Battle, "id" | "engine">,
  key: string | undefined,
) {
  held =
    key && isOaBattle(battle)
      ? {
          serverKey,
          battleId: battle.id,
          previousBattle: null,
          password: key,
          landed: false,
        }
      : null;
}

export function forgetOaPassword() {
  held = null;
}

/** The password held for this battle, or null. */
export function oaPasswordFor(
  serverKey: string,
  battleId: number,
): string | null {
  if (held?.serverKey !== serverKey) return null;
  const ours =
    held.battleId === null
      ? battleId !== held.previousBattle
      : held.battleId === battleId;
  return ours ? held.password : null;
}

/** What the lobby connection of the held password shows right now. */
export interface OaPasswordView {
  connected: boolean;
  /** Login has finished, so a battle missing from the mirror is really gone. */
  ready: boolean;
  /** The battle the player is in on it, or null. */
  battleId: number | null;
  /** Why the lobby refused the last join or open, or null. */
  joinError: string | null;
}

/**
 * Forget the password once the battle is over for this client: they left, were
 * kicked or it closed, the lobby refused the attempt, or the connection went. A
 * drop keeps it through a reconnect until login has finished, because the mirror
 * is empty until then. This runs from the provider, so it works with no room on
 * screen.
 */
export function observeOaPassword(
  look: (serverKey: string) => OaPasswordView | null,
) {
  if (!held) return;
  const view = look(held.serverKey);
  if (!view) {
    held = null;
    return;
  }
  if (!view.connected) {
    if (!held.landed) held = null;
    return;
  }
  const { battleId } = view;
  if (
    held.battleId === null &&
    battleId !== null &&
    battleId !== held.previousBattle
  ) {
    held.battleId = battleId;
  }
  if (battleId !== null && battleId === held.battleId) {
    held.landed = true;
  } else if (held.landed ? view.ready : view.joinError !== null) {
    held = null;
  }
}
