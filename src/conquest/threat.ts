import { clamp } from "../lib/helpers";

/**
 * Threat level: how hard the opposing factions press the player. Conquest's
 * version of Warpath's ascension tier, and like it a choice the player makes, so
 * a harder level is never a boost for the player's own side.
 *
 * What a level changes is the opponents' `aggression`. In a run it is the only
 * thing `aggression` does (`enemyRound` in `./rules.ts`): it multiplies the
 * weight of attacking a system somebody owns, the player's or a rival's,
 * against attacking a neutral one, whose weight is 1. A faction at 0.35 (the
 * default) weights the player's systems 0.35 against 1 for a neutral one. At 1
 * it treats the player's systems like any other target.
 *
 * `parseGalaxyJson` clamps aggression to 0..1, so 1 is the ceiling a saved
 * galaxy can keep. Each level closes an equal share of the gap between the
 * faction's own aggression and that ceiling, and the top level reaches it. A
 * preset's aggression is a starting point like any other.
 */

/** The highest level. Three levels that plainly differ, where Warpath has five
 * tiers (`MAX_ASCENSION`) because its tiers change a run's rules rather than one
 * weight. */
export const MAX_THREAT_LEVEL = 3;

/** The highest aggression a saved galaxy keeps (see `parseGalaxyJson`). */
const MAX_AGGRESSION = 1;

/**
 * An opponent's aggression at a threat level. Level 0 returns `base` untouched,
 * so a galaxy generated at level 0 is the galaxy generated before levels
 * existed. Never lowers aggression: a preset already above a level's value keeps
 * its own.
 */
export function threatAggression(base: number, level: number): number {
  const l = readThreatLevel(level);
  if (l === 0 || base >= MAX_AGGRESSION) return base;
  if (l === MAX_THREAT_LEVEL) return MAX_AGGRESSION;
  return base + ((MAX_AGGRESSION - base) * l) / MAX_THREAT_LEVEL;
}

/** A level read from untrusted input: a whole number from 0 to the top level,
 * and 0 for anything that is not a number. */
export function readThreatLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return clamp(Math.round(value), 0, MAX_THREAT_LEVEL);
}
