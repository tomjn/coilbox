/**
 * Editing a project's units from the Reference table (issue #3113): which of
 * the table's columns can be written, where each one lives on a unit, and what
 * the game had there before the project changed it.
 *
 * Only a raw def field is editable. A derived column (DPS, cost per HP) is
 * worked out from other fields and has nowhere to be written, and Range is
 * the longest of a unit's weapons, which belongs to the weapon rather than
 * the unit.
 *
 * A field is found the way a batch edit finds one (`batchEdit.ts`'s
 * `findField`): the override first, then the def, each case-insensitively, so
 * a game that spells it `maxdamage` is written under `maxdamage`. A unit that
 * declares none of a column's spellings has no cell to edit, rather than one
 * that guesses which spelling the game would read.
 */
import { findField, toNumber } from "./batchEdit";
import { readPath, setOverride, type UnitOverrides } from "./overrides";

/** Each editable column's field, every spelling a game may use, oldest last:
 *  the same pairs `unitReference.ts` reads the column with. */
const EDITABLE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  health: ["health", "maxDamage"],
  metalCost: ["metalCost", "buildCostMetal"],
  buildTime: ["buildTime"],
  sightDistance: ["sightDistance"],
  speed: ["speed", "maxVelocity"],
};

export function isEditableColumn(columnId: string): boolean {
  return Object.hasOwn(EDITABLE_FIELDS, columnId);
}

/** The editable columns' ids, in the table's own order. */
export function editableColumnIds(): string[] {
  return Object.keys(EDITABLE_FIELDS);
}

/** The spellings a column's field goes by, for `computeBatchRows`. */
export function editableFieldKeys(columnId: string): readonly string[] {
  return EDITABLE_FIELDS[columnId] ?? [];
}

/** One editable cell. `gameValue` is the unit's value before this project's
 *  edits, which is what an edited cell shows on hover and what issue #3114's
 *  "game value beside project value" reads. */
export interface ReferenceCell {
  path: string;
  value: number | undefined;
  gameValue: number | undefined;
  edited: boolean;
}

/**
 * `key`'s cell in `columnId`, or `undefined` when the column is not editable
 * or the unit declares none of its spellings. `units` is the game's units with
 * the project's own copies in among them, unedited.
 */
export function referenceCell(
  units: Record<string, Record<string, unknown> | undefined>,
  overrides: UnitOverrides,
  key: string,
  columnId: string,
): ReferenceCell | undefined {
  const keys = EDITABLE_FIELDS[columnId];
  if (!keys) return undefined;
  const found = findField(units[key], overrides[key], keys);
  if (!found) return undefined;
  return {
    path: found.path,
    value: toNumber(found.raw),
    gameValue: toNumber(readPath(units[key], found.path)),
    edited: Object.hasOwn(overrides[key] ?? {}, found.path),
  };
}

/** `overrides` with `key`'s `columnId` field set to `value`, dropped back to
 *  nothing when `value` is what the unit already inherits. Unchanged when the
 *  column cannot be written for this unit. */
export function setReferenceValue(
  overrides: UnitOverrides,
  units: Record<string, Record<string, unknown> | undefined>,
  key: string,
  columnId: string,
  value: number,
): UnitOverrides {
  const cell = referenceCell(units, overrides, key, columnId);
  if (!cell) return overrides;
  return setOverride(
    overrides,
    key,
    cell.path,
    value,
    readPath(units[key], cell.path),
  );
}
