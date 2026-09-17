import type { LobbyServer } from "../lobby-servers/config";
import type { Matchmaking, MatchQueue } from "./bindings";
import type { Connections } from "./connections";
import { liveTachyonKeys } from "./protocol";

/**
 * Pure helpers behind the matchmaking screen and the found-match panel.
 *
 * The shape of a queue and the deadline on a found match both come off the wire,
 * so these only put them into words. Nothing here invents a number: how many
 * people are searching would come from `matchmaking/queueUpdate`, which Teiserver
 * has not built, so the screen says so rather than showing a figure.
 */

/** How many whole seconds are left to accept a match, never below zero. */
export function secondsLeft(readyBy: number, now: number): number {
  return Math.max(0, Math.ceil((readyBy - now) / 1000));
}

/** A countdown as minutes and seconds, for a deadline the server set. */
export function countdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** What a queue plays, in one line: "2 teams of 1, ranked". */
export function describeQueue(queue: MatchQueue): string {
  const shape = `${queue.teams} teams of ${queue.teamSize}`;
  return queue.ranked ? `${shape}, ranked` : shape;
}

/**
 * What to call each queue we are searching in. A queue the list has not
 * described is shown under its id, which is what a party member's search into a
 * queue we have not been told about looks like.
 */
export function searchingIn(state: Matchmaking): string[] {
  return state.searching.map(
    (id) => state.queues.find((queue) => queue.id === id)?.name ?? id,
  );
}

/**
 * Every live Tachyon connection with a match waiting on it, focused one
 * first. Pure: what the found-match panel renders one panel per (issue
 * #2845, watching every connected Tachyon server rather than only the
 * focused one).
 */
export function matchFoundKeys(
  connections: Connections,
  servers: LobbyServer[],
  focusKey: string | null,
): string[] {
  return liveTachyonKeys(connections, servers, focusKey).filter(
    (key) => connections[key].mirror.state?.matchmaking.found != null,
  );
}

/**
 * Why a found match must not launch, or null to go ahead. Pure.
 *
 * Only one engine runs at a time, so a match found while a game is already
 * running, or while a lobby battle is joined on this connection or another
 * one, refuses rather than starting a second (issue #2845). Checked in that
 * order: a running game is the more urgent reason, since a joined battle can
 * itself be about to launch the same engine a running game already is.
 */
export function matchLaunchBlockReason(
  gameRunning: boolean,
  inBattleKey: string | null,
  serverKey: string,
  serverName: (key: string) => string,
): string | null {
  if (gameRunning) {
    return "A game is already running, so accepting this match would start a second one.";
  }
  if (inBattleKey == null) return null;
  return inBattleKey === serverKey
    ? "You are already in a battle here, so accepting this match would start a second game."
    : `${serverName(inBattleKey)} owns the current battle room, so accepting this match would start a second game.`;
}
