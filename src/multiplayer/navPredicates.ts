import { useMultiplayer } from "./store";

/**
 * Nav/route predicate: has the user connected at least once this session? Gates
 * the Chat/Battles sidebar items and routes (via `useVisible` / `NavGate`).
 */
export function useMpRevealed(): boolean {
  return useMultiplayer().revealed;
}

/**
 * Nav/route predicate: is multiplayer currently disconnected? Gates the Login
 * sidebar item + route so it shows only while logged out.
 */
export function useMpDisconnected(): boolean {
  return !useMultiplayer().connected;
}

/**
 * Nav/route predicate: does the live connection have matchmaking? Gates the
 * Matchmaking sidebar item and route. Tachyon only, and only while connected,
 * because the queues come from the server rather than from anything stored.
 */
export function useMpMatchmaking(): boolean {
  const { connected, protocol } = useMultiplayer();
  return connected && protocol === "tachyon";
}

/**
 * Nav/route predicate: is the user currently in a battle? Gates the Battle Room
 * sidebar item + route so it appears on join and vanishes on leave.
 */
export function useMpInBattle(): boolean {
  return useMultiplayer().mirror.state?.currentBattle != null;
}

/**
 * The dynamic label for the Battle Room nav item: the joined battle's title, or
 * a generic fallback. Read reactively so picoframe re-renders it as the battle
 * changes (`NavItem.useLabel`).
 */
export function useBattleRoomLabel(): string {
  const state = useMultiplayer().mirror.state;
  const battle =
    state?.currentBattle != null
      ? state.battles[String(state.currentBattle)]
      : undefined;
  return battle?.title?.trim() || "Battle Room";
}
