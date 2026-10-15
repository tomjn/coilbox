import type { ScopedRecord } from "./stats";

/** "1 game", "3 games". */
export function gamesLabel(n: number): string {
  return `${n} ${n === 1 ? "game" : "games"}`;
}

/**
 * A record as counts, never a percentage. Most matchups are two or three
 * games, and "67%" of three games reads as a trend that is not there. The
 * stats pages have no minimum sample rule to reuse, so this view shows counts
 * everywhere: "2 of 3 won". Games with no recorded result are named, not
 * hidden.
 */
export function recordCounts(
  r: Pick<ScopedRecord, "games" | "decided" | "wins">,
): string {
  if (r.games === 0) return "no games";
  if (r.decided === 0) return `no recorded result in ${gamesLabel(r.games)}`;
  const undecided = r.games - r.decided;
  const tail = undecided > 0 ? `, ${undecided} with no recorded result` : "";
  return `${r.wins} of ${r.decided} won${tail}`;
}
