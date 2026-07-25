import type { PlayerGameFact } from "./stats";

/**
 * Offline achievements (#461): milestones a player has earned purely from their
 * recorded games, computed live from the local replay stats database - no server,
 * no accounts, no separate persistence.
 *
 * The catalog below is plain data: each entry names an achievement, describes it,
 * sets a numeric target, and carries a pure `measure` over the player's
 * chronological genuine-match games (see `playerGameFacts` in `stats.ts`, which
 * already excludes remix/refight reruns). `evaluateAchievements` runs the whole
 * catalog and reports, per achievement, current progress, whether it is earned,
 * and the start time of the game that earned it.
 *
 * Earned dates are derived, not stored: `earnedAtMs` is the timestamp of the game
 * that pushed progress to the target, recomputed from the records each time. There
 * is no writable achievements store - the stats table is the single source.
 *
 * Note: opponents that are AI bots are not recorded in the stats table (only
 * human `[playerN]` sections are ingested), so "wins vs distinct AIs" is not
 * derivable yet and is deliberately absent from this catalog. See the follow-up.
 */

/** Grouping for the achievements UI. */
export type AchievementCategory =
  | "Milestones"
  | "Victories"
  | "Streaks"
  | "Variety"
  | "Activity";

/** What a `measure` reports for one achievement over a player's games. */
interface Measurement {
  /** Progress so far (may exceed the target once earned). */
  current: number;
  /** Start time of the game that reached the target, when earned. */
  earnedAtMs?: number;
}

/** One achievement in the catalog - plain data plus a pure progress function. */
export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  target: number;
  /** Compute progress over the player's chronological genuine-match games. */
  measure: (games: PlayerGameFact[]) => Measurement;
}

/** The evaluated state of one achievement for one player. */
export interface AchievementResult {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  target: number;
  current: number;
  earned: boolean;
  /** Derived date the achievement was earned, or undefined when unearned. */
  earnedAtMs?: number;
}

/** Seven days in milliseconds, for the rolling-activity achievement. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cumulative count of games matching `pred`. Earned when the count reaches the
 * target, dated by the game that got it there.
 */
function countMeasure(
  pred: (g: PlayerGameFact) => boolean,
  target: number,
): (games: PlayerGameFact[]) => Measurement {
  return (games) => {
    let current = 0;
    let earnedAtMs: number | undefined;
    for (const g of games) {
      if (!pred(g)) continue;
      current += 1;
      if (current === target) earnedAtMs = g.startTimeMs;
    }
    return { current, earnedAtMs };
  };
}

/**
 * Count of distinct non-empty keys across the player's games. Earned when the
 * distinct count reaches the target, dated by the game that introduced the
 * target-th distinct value.
 */
function distinctMeasure(
  keyOf: (g: PlayerGameFact) => string | undefined,
  target: number,
): (games: PlayerGameFact[]) => Measurement {
  return (games) => {
    const seen = new Set<string>();
    let earnedAtMs: number | undefined;
    for (const g of games) {
      const key = keyOf(g);
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size === target) earnedAtMs = g.startTimeMs;
    }
    return { current: seen.size, earnedAtMs };
  };
}

/**
 * Longest run of consecutive wins. Undecided games are skipped (they neither
 * extend nor break a run), matching `stats.ts`. Earned when a run first reaches
 * the target length, dated by the game that completed it.
 */
function winStreakMeasure(
  target: number,
): (games: PlayerGameFact[]) => Measurement {
  return (games) => {
    let run = 0;
    let best = 0;
    let earnedAtMs: number | undefined;
    for (const g of games) {
      if (g.won === undefined) continue;
      run = g.won ? run + 1 : 0;
      if (run > best) best = run;
      if (run === target && earnedAtMs === undefined)
        earnedAtMs = g.startTimeMs;
    }
    return { current: best, earnedAtMs };
  };
}

/**
 * Most games played within any rolling `windowMs` window. Earned when a window
 * first holds `target` games, dated by the game that completed that window.
 * Games arrive chronological, so a single forward sweep with a shrinking left
 * edge finds the busiest window.
 */
function windowMeasure(
  target: number,
  windowMs: number,
): (games: PlayerGameFact[]) => Measurement {
  return (games) => {
    let best = 0;
    let start = 0;
    let earnedAtMs: number | undefined;
    for (let end = 0; end < games.length; end++) {
      while (games[end].startTimeMs - games[start].startTimeMs >= windowMs) {
        start += 1;
      }
      const count = end - start + 1;
      if (count > best) best = count;
      if (count >= target && earnedAtMs === undefined) {
        earnedAtMs = games[end].startTimeMs;
      }
    }
    return { current: best, earnedAtMs };
  };
}

/**
 * The achievement catalog. Ordered by category then ascending target, which is
 * also the display order. Add an entry here to add an achievement - nothing else
 * needs to change.
 */
export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "games-first",
    name: "First game",
    description: "Play your first recorded game.",
    category: "Milestones",
    target: 1,
    measure: countMeasure(() => true, 1),
  },
  {
    id: "games-10",
    name: "Getting started",
    description: "Play 10 games.",
    category: "Milestones",
    target: 10,
    measure: countMeasure(() => true, 10),
  },
  {
    id: "games-50",
    name: "Seasoned",
    description: "Play 50 games.",
    category: "Milestones",
    target: 50,
    measure: countMeasure(() => true, 50),
  },
  {
    id: "games-100",
    name: "Centurion",
    description: "Play 100 games.",
    category: "Milestones",
    target: 100,
    measure: countMeasure(() => true, 100),
  },
  {
    id: "win-first",
    name: "First win",
    description: "Win your first game.",
    category: "Victories",
    target: 1,
    measure: countMeasure((g) => g.won === true, 1),
  },
  {
    id: "wins-10",
    name: "Victor",
    description: "Win 10 games.",
    category: "Victories",
    target: 10,
    measure: countMeasure((g) => g.won === true, 10),
  },
  {
    id: "wins-50",
    name: "Conqueror",
    description: "Win 50 games.",
    category: "Victories",
    target: 50,
    measure: countMeasure((g) => g.won === true, 50),
  },
  {
    id: "streak-3",
    name: "On a roll",
    description: "Win 3 games in a row.",
    category: "Streaks",
    target: 3,
    measure: winStreakMeasure(3),
  },
  {
    id: "streak-5",
    name: "Unstoppable",
    description: "Win 5 games in a row.",
    category: "Streaks",
    target: 5,
    measure: winStreakMeasure(5),
  },
  {
    id: "streak-10",
    name: "Dominant",
    description: "Win 10 games in a row.",
    category: "Streaks",
    target: 10,
    measure: winStreakMeasure(10),
  },
  {
    id: "maps-5",
    name: "Well travelled",
    description: "Play on 5 different maps.",
    category: "Variety",
    target: 5,
    measure: distinctMeasure((g) => g.mapName, 5),
  },
  {
    id: "maps-15",
    name: "Cartographer",
    description: "Play on 15 different maps.",
    category: "Variety",
    target: 15,
    measure: distinctMeasure((g) => g.mapName, 15),
  },
  {
    id: "factions-3",
    name: "Versatile",
    description: "Play 3 different factions.",
    category: "Variety",
    target: 3,
    measure: distinctMeasure((g) => g.side, 3),
  },
  {
    id: "week-10",
    name: "Busy week",
    description: "Play 10 games within 7 days.",
    category: "Activity",
    target: 10,
    measure: windowMeasure(10, WEEK_MS),
  },
];

/**
 * Evaluate the whole catalog for one player's genuine-match games. An empty
 * `games` list yields every achievement unearned with zero progress. Earned
 * dates are only reported for earned achievements.
 */
export function evaluateAchievements(
  games: PlayerGameFact[],
): AchievementResult[] {
  return ACHIEVEMENTS.map((a) => {
    const { current, earnedAtMs } = a.measure(games);
    const earned = current >= a.target;
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      category: a.category,
      target: a.target,
      current,
      earned,
      earnedAtMs: earned ? earnedAtMs : undefined,
    };
  });
}
