/**
 * What is new on the map and what has gone, between two passes of drawing
 * (issue #1716).
 *
 * Every layer here redraws the whole of itself: a pass clears what it had and
 * builds the lot again, because an edit can change anything and comparing every
 * property is more work than rebuilding a few dozen squares. That is fine for
 * drawing and useless for animating, because a building that was already there
 * would fade in again on every unrelated edit.
 *
 * So a pass says what it is drawing by name, and this says which of those names
 * are new and which have stopped being drawn. A layer fades in the first and
 * fades out the second, and leaves everything else alone.
 *
 * The names are the layer's own business. What matters is that a name is about
 * the thing rather than about its place in a list: a base's buildings are keyed
 * by index, so deleting the second of five renames three of them, and a diff on
 * those keys would report the fifth as gone. Both layers name a thing by what it
 * is and where it stands instead.
 */

/**
 * Whether there are frames to ask for.
 *
 * A layer built in a test is built in node, where there are none. Everything
 * here settles at once rather than sitting half way through an animation
 * nothing will ever finish.
 */
export const animates = typeof requestAnimationFrame === "function";

/** What one pass changed. Both are in the order the caller listed them. */
export interface Arrivals {
  /** Names this pass draws that the last one did not. */
  arrived: string[];
  /** Names the last pass drew that this one does not. */
  left: string[];
}

export function arrivals(
  before: Iterable<string>,
  now: Iterable<string>,
): Arrivals {
  const had = new Set(before);
  const has = new Set(now);
  return {
    arrived: [...has].filter((name) => !had.has(name)),
    left: [...had].filter((name) => !has.has(name)),
  };
}

/** How far through a fade something is, from 0 to 1. A duration of nothing is
 *  finished the moment it starts, which is what switches the fades off. */
export function fadeAt(elapsed: number, duration: number): number {
  if (duration <= 0) return 1;
  return Math.min(1, Math.max(0, elapsed / duration));
}

/**
 * Ease for both fades: fast at first and slow at the end.
 *
 * A linear fade of something appearing reads as a light being switched on
 * halfway. This is `1 - (1 - t)^2`, which is the cheapest curve that does not.
 */
export function eased(fraction: number): number {
  const at = Math.min(1, Math.max(0, fraction));
  return 1 - (1 - at) * (1 - at);
}

/**
 * How bright a pulse is at a moment, from `low` to `high` and back.
 *
 * A sine rather than a triangle, because the turn at each end is what makes it
 * read as breathing rather than as flashing. `now` is any clock in
 * milliseconds: only the difference between two of them is used, so it does not
 * matter where it started.
 */
export function pulseAt(
  now: number,
  period: number,
  low: number,
  high: number,
): number {
  const turn = (Math.sin((now / period) * Math.PI * 2) + 1) / 2;
  return low + (high - low) * turn;
}
