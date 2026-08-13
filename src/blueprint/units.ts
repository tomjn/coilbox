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

/** "a", "a or b", "a, b or c", "a, b, c and 2 more". */
function names(defs: string[]): string {
  if (defs.length <= 2) return defs.join(" or ");
  if (defs.length <= NAMES_SHOWN) {
    return `${defs.slice(0, -1).join(", ")} or ${defs[defs.length - 1]}`;
  }
  const shown = defs.slice(0, NAMES_SHOWN).join(", ");
  return `${shown} and ${defs.length - NAMES_SHOWN} more`;
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
  if (unknown.length >= buildings) {
    return `This game has none of its units: ${names(defs)}. Nothing in it can be placed here, so it belongs to another game or another version of this one.`;
  }
  const rest = buildings - unknown.length;
  const fine =
    rest === 1 ? "The other one is fine." : `The other ${rest} are fine.`;
  return `${unknown.length} of its ${buildings} buildings cannot be placed here: this game has no ${names(defs)}. ${fine}`;
}
