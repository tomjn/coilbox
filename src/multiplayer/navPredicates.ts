import { isProfileHidden } from "../profile/hidden";
import { useInBattleKey } from "./battle/useBattleRoomKey";
import { liveTachyonKeys } from "./protocol";
import { serverAdminKeys } from "./serverAdmin";
import { useConnection, useMultiplayer, useProtocolServers } from "./store";

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
 * Nav/route predicate: does any live connection have matchmaking? Gates the
 * Matchmaking sidebar item and route. Tachyon only, and watches every
 * connection rather than only the focused one, so a second Tachyon server
 * still reveals the item once the first is what's focused (issue #2845).
 */
export function useMpMatchmaking(): boolean {
  const { connections, activeKey } = useMultiplayer();
  const servers = useProtocolServers();
  return liveTachyonKeys(connections, servers, activeKey).length > 0;
}

/**
 * Nav/route predicate: is the user currently in a battle, on any connection?
 * Gates the Battle Room sidebar item + route so it appears on join and vanishes
 * on leave.
 */
export function useMpInBattle(): boolean {
  return useInBattleKey() != null;
}

/**
 * Nav/route predicate: does any live lobby login (not a room) qualify for the
 * Server admin page? Qualifying means uberserver, with the connection's own
 * account carrying the `access` status bit. Gates the Server admin sidebar
 * item and its route (via `useVisible` / `NavGate`), and folds in
 * `isProfileHidden` so both respect a distribution profile that hides
 * `multiplayer.admin` the same way (issue #2772).
 */
export function useMpServerAdmin(): boolean {
  const { connections, activeKey } = useMultiplayer();
  const servers = useProtocolServers();
  const qualifies = serverAdminKeys(connections, servers, activeKey).length > 0;
  return qualifies && !isProfileHidden("multiplayer.admin");
}

/**
 * The dynamic label for the Battle Room nav item: the joined battle's title,
 * on whichever connection it is (issue #2844), or
 * a generic fallback. Read reactively so picoframe re-renders it as the battle
 * changes (`NavItem.useLabel`).
 */
export function useBattleRoomLabel(): string {
  const state = useConnection(useInBattleKey())?.mirror.state;
  const battle =
    state?.currentBattle != null
      ? state.battles[String(state.currentBattle)]
      : undefined;
  return battle?.title?.trim() || "Battle Room";
}
