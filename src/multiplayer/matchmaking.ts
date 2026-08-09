import type { Matchmaking, MatchQueue } from "./bindings";

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
