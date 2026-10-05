import { MAX_DIFFICULTY, MIN_DIFFICULTY } from "../conquest/model";
import { MAX_THREAT_LEVEL, readThreatLevel } from "../conquest/threat";
import { clamp } from "../lib/helpers";
import { MAX_TIER } from "../runlite/generate";
import { MAX_RUN_DIFFICULTY, MIN_RUN_DIFFICULTY } from "../runlite/model";
import {
  DIFFICULTIES,
  type Difficulty,
  type Scenario,
  usesDifficulty,
} from "../scenario/model";

/**
 * The difficulty a scenario location on a hand-made map plays at (issue #3593).
 *
 * Nobody picks it on the briefing. It comes from what the player chose for the
 * whole conquest or run at the start, and from where the location is. Each of
 * the two inputs is read as a share of its own range, from 0 at its easiest to
 * 1 at its hardest. The two shares carry equal weight, and their mean is split
 * into equal bands, one per scenario level, easiest first. With the three
 * levels there are now, the bands are below a third, below two thirds, and the
 * rest.
 *
 * The sums are done in whole numbers so a score that lands exactly on a band
 * edge goes to the harder band every time, with no rounding error.
 */

/** How each level is written on a briefing, as the campaign writes it. */
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
};

/** A whole number from `lo` to `hi`, and `lo` for anything that is not a
 * number, so a damaged save plays at the easiest level rather than at none. */
function whole(value: number, lo: number, hi: number): number {
  return Number.isFinite(value) ? clamp(Math.round(value), lo, hi) : lo;
}

/**
 * The level for two inputs, each a whole number from 0 to its own top. The
 * shares are put over a common denominator, `aTop * bTop` each, so the mean of
 * the two is `score / (2 * aTop * bTop)`. The band is that fraction times the
 * number of levels, rounded down, with the top end kept in the last band.
 */
function evenBands(a: number, aTop: number, b: number, bTop: number) {
  const score = a * bTop + b * aTop;
  const top = 2 * aTop * bTop;
  const n = DIFFICULTIES.length;
  return DIFFICULTIES[Math.min(n - 1, Math.floor((score * n) / top))];
}

/**
 * Conquest. The player's share is the threat level chosen at the start, 0 to
 * {@link MAX_THREAT_LEVEL}. The location's share is the difficulty its author
 * gave it, {@link MIN_DIFFICULTY} to {@link MAX_DIFFICULTY}, the number that
 * sets enemy count and handicap for a skirmish there.
 *
 * A skirmish location does not combine the two: the threat level changes only
 * how often the opponents attack, and the battle comes from the location's
 * number alone. A scenario has its own forces, so the location's number cannot
 * set them, and the threat level is the only thing the player chose. Both
 * count, equally.
 */
export function conquestScenarioDifficulty(
  threatLevel: number,
  locationDifficulty: number,
): Difficulty {
  const threat = readThreatLevel(threatLevel);
  const location =
    whole(locationDifficulty, MIN_DIFFICULTY, MAX_DIFFICULTY) - MIN_DIFFICULTY;
  return evenBands(
    threat,
    MAX_THREAT_LEVEL,
    location,
    MAX_DIFFICULTY - MIN_DIFFICULTY,
  );
}

/**
 * Warpath. The player's share is the run's difficulty plus its ascension tier,
 * the sum a skirmish encounter scales by, read over the difficulty slider's
 * range {@link MIN_RUN_DIFFICULTY} to {@link MAX_RUN_DIFFICULTY}. Ascension
 * raises it the way it raises a skirmish, and anything past the top of the
 * slider is the hardest share there is.
 *
 * The location's share is its tech tier, 1 to {@link MAX_TIER}, which is how a
 * skirmish encounter measures depth: the generator gives each column the tier
 * that sets its enemy handicap and count, and stores it on the node's
 * encounter. So a location further along the run plays harder, on the same
 * steps as the skirmishes around it.
 *
 * The two count equally. A skirmish weighs a tier step as two difficulty steps,
 * and on that weighting the hardest run without ascension starts at the same
 * level as the easiest one, which the decision on #3593 rules out.
 */
export function warpathScenarioDifficulty(
  runDifficulty: number,
  ascension: number,
  techTier: number,
): Difficulty {
  const chosenTop = MAX_RUN_DIFFICULTY - MIN_RUN_DIFFICULTY;
  const chosen = Math.min(
    chosenTop,
    whole(runDifficulty, MIN_RUN_DIFFICULTY, MAX_RUN_DIFFICULTY) +
      whole(ascension, 0, chosenTop) -
      MIN_RUN_DIFFICULTY,
  );
  const depth = whole(techTier, 1, MAX_TIER) - 1;
  return evenBands(chosen, chosenTop, depth, MAX_TIER - 1);
}

/**
 * The level to launch a scenario at, or undefined for a scenario that plays
 * the same at every level. Undefined leaves the launch as it was before #3593,
 * with no difficulty in the start script.
 */
export function scenarioLevel(
  scenario: Scenario | undefined,
  level: () => Difficulty,
): Difficulty | undefined {
  return scenario && usesDifficulty(scenario) ? level() : undefined;
}
