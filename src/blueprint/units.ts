/**
 * Whether a layout's units are units the game being imported into has (issue
 * #1436).
 *
 * A layout names units by internal name, so it belongs to a game the way a
 * scenario does. Nothing in a game's blueprint file says which game that is:
 * Beyond All Reason's path, `LuaUI/Config/blueprints.json`, has no game in it
 * and the engine resolves it against the write directory, which is per data
 * directory. So one file holds every layout every game sharing that directory
 * ever saved, in one flat list.
 *
 * The game's own widget hides what it cannot resolve and writes it back
 * untouched, which is the right answer for a widget and the wrong one here. A
 * person opening that file in coilbox is choosing what to take, and the choice
 * needs the difference between a layout with one unit this game has not got and
 * a layout that is entirely somebody else's.
 *
 * Substitution is a different question and is
 * https://github.com/tomjn/coilbox/issues/1314. Nothing here changes a name.
 */

import { plural, t } from "@lingui/core/macro";
import { getLocale } from "@/i18n";

/** Whether the game has a unit of this name. */
export type KnownUnits = (def: string) => boolean;

/** One building whose unit the game has not got, by its place in the layout. */
export interface UnknownBuilding {
  index: number;
  def: string;
}

/**
 * A lookup over one game's units, from the unit dataset.
 *
 * Case-insensitive, the way `./footprint.ts` looks a footprint up, because a
 * file holds whatever its author's game wrote and the dataset is lowercased.
 */
export function knownUnits(units: { name: string }[]): KnownUnits {
  const names = new Set(units.map((unit) => unit.name.toLowerCase()));
  return (def) => names.has(def.toLowerCase());
}

/** The unit Zero-K's terraform gadget needs to exist
 *  (`LuaRules/Gadgets/unit_terraform.lua`). */
const TERRAFORM_UNIT = "terraunit";

/**
 * Whether a game can change the ground under a blueprint's terrain steps
 * (issue #4792).
 *
 * True when the game's units include `terraunit`. Not `terraformSpeed`, which
 * every game's builders have because the engine uses it to flatten the ground
 * under a new building, and not the terraform command numbers, which Splinter
 * Faction carries without having the gadget behind them. This is the default
 * for the per-game switch in `./terrainSwitch.ts`, which can override it.
 */
export function terrainSupport(units: { name: string }[]): boolean {
  return knownUnits(units)(TERRAFORM_UNIT);
}

/**
 * What a card or a page says about terrain steps its game cannot make, or null
 * when there are none to be said about (issue #4792).
 *
 * A layout of terrain steps alone has nothing left to place, and says so.
 */
export function terrainRefusal(
  terrain: number,
  buildings: number,
): string | null {
  if (terrain === 0) return null;
  const changes = plural(terrain, {
    one: "# terrain change this game cannot make",
    other: "# terrain changes this game cannot make",
  });
  if (buildings === 0) return t`${changes}, so nothing in it can be placed`;
  return changes;
}

/**
 * Every building of a layout the game has no unit for.
 *
 * Empty without a `known`, because there is no dataset to judge by and a guess
 * is worse than silence. That is the same rule the build grid snap follows, and
 * the caller says which of the two happened rather than reading it out of an
 * empty list.
 */
export function unknownBuildings(
  buildings: { def: string }[],
  known?: KnownUnits,
): UnknownBuilding[] {
  if (!known) return [];
  const out: UnknownBuilding[] = [];
  buildings.forEach((building, index) => {
    if (!known(building.def)) out.push({ index, def: building.def });
  });
  return out;
}

/** How many names to print before counting the rest. */
const NAMES_SHOWN = 3;

/** "a, b, c" in the app language, with no joining word. */
const plainList = (parts: string[]) =>
  new Intl.ListFormat(getLocale(), { type: "unit", style: "long" }).format(
    parts,
  );

/** "a", "a or b", "a, b or c", "a, b, c and 2 more". */
function names(defs: string[]): string {
  if (defs.length === 1) return defs[0];
  if (defs.length <= NAMES_SHOWN) {
    const first = plainList(defs.slice(0, -1));
    const last = defs[defs.length - 1];
    return t`${first} or ${last}`;
  }
  const shown = plainList(defs.slice(0, NAMES_SHOWN));
  const more = defs.length - NAMES_SHOWN;
  return t`${shown} and ${more} more`;
}

/**
 * What a person needs to decide whether this layout is worth taking, or null
 * when there is nothing wrong with it.
 *
 * The two cases read differently on purpose. A layout the game has none of the
 * units of is another game's, and taking it gets you nothing. A layout with one
 * unit missing is still most of a base, and somebody can reasonably want it.
 */
export function unknownUnitsWarning(
  unknown: UnknownBuilding[],
  buildings: number,
): string | null {
  if (unknown.length === 0) return null;
  const defs = [...new Set(unknown.map((one) => one.def))];
  const list = names(defs);
  if (unknown.length >= buildings) {
    return t`This game has none of its units: ${list}. Nothing in it can be placed here, so it belongs to another game or another version of this one.`;
  }
  const missing = unknown.length;
  const rest = buildings - missing;
  return t`${missing} of its ${plural(buildings, { one: "# building", other: "# buildings" })} cannot be placed here: this game has no ${list}. ${plural(rest, { one: "The other one is fine.", other: "The other # are fine." })}`;
}
