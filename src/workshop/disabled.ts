/**
 * A unit switched off across the whole game (issue #2649).
 *
 * Taking a unit out of one factory's `buildoptions` is a roster change. Taking
 * it out of the game is a different thing, and `buildMenus.ts` refuses to
 * conflate them from its side. This is the other side of that line: one boolean
 * per unit, meaning "when this project is compiled, drop this unit from every
 * `buildoptions` list in the game".
 *
 * It is a mark and never an edit. Disabling could have been implemented by
 * writing a `remove` operation into every build menu that names the unit, and
 * that would have been wrong in a way that only shows up later: re-enabling
 * would then have to guess which removals were the user's own and which were
 * the disable, and a menu the user reordered afterwards could not be put back
 * the way it was. Recording the intent instead means re-enabling restores every
 * placement exactly, because nothing was ever taken away.
 *
 * The same shape as the other three stores, for the same reasons: held per game
 * by the page, keyed on the lowercased def key, and sparse. A unit nobody
 * switched off has no entry, and a project that switches nothing off holds an
 * empty set rather than one entry per unit saying "still on".
 *
 * A list rather than a table, because the value is the membership and nothing
 * else. `Record<string, true>` would carry a value that can only ever be one
 * thing, and the first time somebody stored `false` in it the set would have
 * two ways to say enabled. Sorted, so two projects that switched the same units
 * off in a different order hold the same thing.
 *
 * A copy of a disabled unit is not itself disabled. The mark is against a key,
 * a clone gets a key of its own, and disabling the game's version to ship your
 * own in its place is a thing people do on purpose (issue #1272 into this one).
 */

/** Every unit the project switches off, as lowercased def keys, sorted. */
export type DisabledUnits = string[];

/** Whether the project switches this unit off. */
export function isUnitDisabled(disabled: DisabledUnits, unit: string): boolean {
  return disabled.includes(unit.trim().toLowerCase());
}

/**
 * Switch a unit off, or back on.
 *
 * Returns the set it was given when nothing would change, so switching a unit
 * on that was never off does not leave a new array behind for React to see as
 * an edit.
 */
export function setUnitDisabled(
  disabled: DisabledUnits,
  unit: string,
  off: boolean,
): DisabledUnits {
  const key = unit.trim().toLowerCase();
  if (!key) return disabled;
  if (disabled.includes(key) === off) return disabled;
  return off
    ? [...disabled, key].sort()
    : disabled.filter((other) => other !== key);
}
