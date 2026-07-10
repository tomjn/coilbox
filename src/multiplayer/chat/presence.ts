import type { LobbyState } from "../bindings";

/**
 * A user's coarse presence, richest-first. The lobby protocol has no "in a
 * battle" status bit (`ClientStatus` only carries `ingame`/`away`), so that
 * state is derived by scanning `state.battles` for the username - see
 * {@link userPresence}. `offline` means the user is absent from the live roster.
 */
export type Presence = "offline" | "online" | "away" | "inBattle" | "ingame";

/** Per-presence display metadata: a Tailwind dot colour and a human label. */
export const PRESENCE_META: Record<
  Presence,
  { label: string; dotClass: string }
> = {
  ingame: { label: "In-game", dotClass: "bg-red-500" },
  inBattle: { label: "In battle", dotClass: "bg-blue-500" },
  away: { label: "Away", dotClass: "bg-amber-500" },
  online: { label: "Online", dotClass: "bg-green-500" },
  offline: { label: "Offline", dotClass: "bg-muted-foreground/50" },
};

/** True when `name` sits in any battle (as host or member) in the roster. */
function isInBattle(state: LobbyState, name: string): boolean {
  for (const battle of Object.values(state.battles)) {
    if (battle.host === name || name in battle.members) return true;
  }
  return false;
}

/**
 * Derive a user's presence from the live mirror. Precedence is richest-first:
 * in-game > in-battle > away > online > offline. A user absent from the roster
 * is offline; otherwise `ClientStatus` gives in-game/away and a battle scan
 * gives in-battle.
 */
export function userPresence(state: LobbyState, name: string): Presence {
  const user = state.users[name];
  if (!user) return "offline";
  if (user.status.ingame) return "ingame";
  if (isInBattle(state, name)) return "inBattle";
  if (user.status.away) return "away";
  return "online";
}
