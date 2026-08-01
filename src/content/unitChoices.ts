/**
 * Turning a game's unit dataset into the list a picker offers.
 *
 * One place decides what a unit is called and what order units come in, because
 * every picker over a game's units is the same question asked by a different
 * screen: the lego builder's reference figure, the scenario editor's actors, and
 * whatever asks next. Arithmetic only, so it is tested without unitsync.
 */

import type { UnitDatasetEntry } from "./bindings";

/** One unit as a picker shows it. The value is the internal def name, which is
 *  what every document stores. */
export interface UnitChoice {
  value: string;
  label: string;
  description?: string;
}

/** What to call a unit: its readable name where the game gives it one, and its
 *  internal name where it does not. */
export function unitLabel(unit: UnitDatasetEntry): string {
  return unit.fullName?.trim() || unit.name;
}

/**
 * A game's units as picker options, in readable-name order.
 *
 * The internal name rides along as the description, because that is what a
 * document holds and what an author searching a forum post will have, but only
 * where it differs from the label: repeating "armpw" under "armpw" is noise.
 */
export function unitChoices(units: UnitDatasetEntry[]): UnitChoice[] {
  return units
    .map((unit) => {
      const label = unitLabel(unit);
      return {
        value: unit.name,
        label,
        description: label === unit.name ? undefined : unit.name,
      };
    })
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label) || a.value.localeCompare(b.value),
    );
}
