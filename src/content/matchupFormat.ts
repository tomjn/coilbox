import { plural, t } from "@lingui/core/macro";
import type { ScopedRecord } from "./stats";

/** "1 game", "3 games". */
export function gamesLabel(n: number): string {
  return plural(n, { one: "# game", other: "# games" });
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
  if (r.games === 0) return t`no games`;
  const gameCount = gamesLabel(r.games);
  if (r.decided === 0) return t`no recorded result in ${gameCount}`;
  const undecided = r.games - r.decided;
  const wins = r.wins;
  const decided = r.decided;
  if (undecided > 0)
    return t`${wins} of ${decided} won, ${undecided} with no recorded result`;
  return t`${wins} of ${decided} won`;
}
