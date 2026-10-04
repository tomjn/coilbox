/**
 * Galaxy sizes (issue #3433).
 *
 * Every size up to {@link BASE_MAX_NODE_COUNT} is open from the first conquest.
 * Unlocks only add, so the larger sizes sit above it, each opened by a threat
 * level the player has already earned, and the threshold is the one that level
 * uses (`./unlocks`).
 */

/** The largest size open to everyone, and the largest the generator built before
 * larger sizes existed. */
export const BASE_MAX_NODE_COUNT = 80;

/** A size above the base, and the threat level that opens it. */
export interface LargeSize {
  count: number;
  label: string;
  /** The highest threat level the player must have unlocked. */
  level: number;
}

/**
 * The unlockable sizes, smallest first. Measured at 256 systems, generation took
 * at most 19 ms and three turns at most 2 ms, so time does not set the ceiling.
 * 160 is twice the old cap, and the 3D map already grows its extent with the
 * system count (`playExtentFor`). A code carries one node map per system and
 * `MAX_NODE_MAPS` (256) bounds what a code may name, so no size here loses maps.
 */
export const LARGE_SIZES: readonly LargeSize[] = [
  { count: 120, label: "Colossal", level: 2 },
  { count: 160, label: "Titanic", level: 3 },
];

/** The most systems a galaxy may have, in the generator, a saved galaxy and a
 * challenge code alike. */
export const MAX_NODE_COUNT = LARGE_SIZES[LARGE_SIZES.length - 1].count;

/** The sizes that were always on offer, as the setup lists them. */
export const BASE_SIZES = [
  { value: "12", label: "Small (12 systems)" },
  { value: "18", label: "Medium (18 systems)" },
  { value: "28", label: "Large (28 systems)" },
  { value: "40", label: "Sprawling (40 systems)" },
  { value: "56", label: "Vast (56 systems)" },
  { value: String(BASE_MAX_NODE_COUNT), label: "Immense (80 systems)" },
];

/** The largest galaxy a game whose highest unlocked threat level is `ceiling`
 * may choose at setup. */
export function maxUnlockedNodeCount(ceiling: number): number {
  return LARGE_SIZES.reduce(
    (max, size) => (ceiling >= size.level ? size.count : max),
    BASE_MAX_NODE_COUNT,
  );
}
