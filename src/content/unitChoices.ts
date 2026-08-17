/**
 * What a game's units are called.
 *
 * One place decides, because every picker over a game's units is the same
 * question asked by a different screen: a mission's restrictions, the lego
 * builder's reference figure, the scenario editor's actors. Ordering moved to
 * `techForest`, which sorts each faction's block by this name.
 */

import type { UnitDatasetEntry } from "./bindings";

/** What to call a unit: its readable name where the game gives it one, and its
 *  internal name where it does not. */
export function unitLabel(unit: UnitDatasetEntry): string {
  return unit.fullName?.trim() || unit.name;
}
