/**
 * A unit's row in the reference table and the comparison view (issue #1316):
 * the raw fields a table of every unit needs, alongside `derivedStats.ts`'s
 * combat and economy numbers, computed off exactly the fields the rest of the
 * workshop resolves rather than a second reading of the game.
 *
 * `unitReferenceRow` takes a single def and the game's shared weapon table,
 * with no opinion about where the def came from: `UnitReferencePage.tsx`
 * (outside a project, the game's own read) and the workshop's own reference
 * page (inside a project, `resolvedDef`'s answer for each unit) both call it
 * with whichever def is theirs to show, so the table and the comparison view
 * are the one thing the issue asked for rather than two.
 *
 * `library` and `unitEquipped` are optional: a project's weapon library
 * (issue #2640, #3081), absent outside a project, in which case a slot's own
 * definition is what fires, the same as before that feature existed.
 */
import { numberField, type UnitDerivedStats } from "./derivedStats";
import { unitEffectiveDerivedStats } from "./unitWeapons";
import type { EquippedWeapons, WeaponLibrary } from "./weaponLibrary";

/** One unit, its resolved fields and its derived numbers. */
export interface UnitReferenceRow {
  key: string;
  name: string;
  def: Record<string, unknown>;
  health?: number;
  metalCost?: number;
  buildTime?: number;
  sightDistance?: number;
  speed?: number;
  /** The longest range among the unit's own weapons (a shield does not
   *  count), read off `derived.weapons` rather than re-derived: the same
   *  numbers `rangePerCost` is built from. */
  maxRange?: number;
  derived: UnitDerivedStats;
}

/**
 * One unit's reference row: its resolved fields plus `derivedStats.ts`'s
 * numbers for its actually-firing weapons (`unitWeapons.ts`), the same
 * resolution `UnitPage.tsx`'s editor uses, so a slot the project has equipped
 * with a library weapon (issue #2640) shows that weapon's numbers here too
 * rather than the slot's own unequipped definition (issue #3081).
 */
export function unitReferenceRow(
  key: string,
  name: string,
  def: Record<string, unknown>,
  weaponDefs: Record<string, Record<string, unknown>>,
  library: WeaponLibrary = {},
  unitEquipped: Record<string, string> | undefined = undefined,
): UnitReferenceRow {
  const derived = unitEffectiveDerivedStats(
    { def },
    weaponDefs,
    [key],
    library,
    unitEquipped,
  );
  const ranged = derived.weapons.filter((w) => w.weaponType !== "Shield");
  const maxRange = ranged.length
    ? Math.max(...ranged.map((w) => w.range))
    : undefined;

  return {
    key,
    name,
    def,
    health: numberField(def, ["health", "maxDamage"]),
    metalCost: numberField(def, ["metalCost", "buildCostMetal"]),
    buildTime: numberField(def, ["buildTime"]),
    sightDistance: numberField(def, ["sightDistance"]),
    speed: numberField(def, ["speed", "maxVelocity"]),
    maxRange,
    derived,
  };
}

/** Every unit in `units`, as a reference row. `library` and `equipped` are a
 *  project's weapon library store (issue #2640), absent outside a project. */
export function unitReferenceRows(
  units: Record<string, Record<string, unknown>>,
  weaponDefs: Record<string, Record<string, unknown>>,
  nameOf: (key: string, def: Record<string, unknown>) => string,
  library: WeaponLibrary = {},
  equipped: EquippedWeapons = {},
): UnitReferenceRow[] {
  return Object.entries(units).map(([key, def]) =>
    unitReferenceRow(
      key,
      nameOf(key, def),
      def,
      weaponDefs,
      library,
      equipped[key],
    ),
  );
}

/** One column of the reference table and the comparison view: how to read its
 *  value off a row, and what to call it. */
export interface ReferenceColumn {
  id: string;
  label: string;
  value: (row: UnitReferenceRow) => number | undefined;
}

/**
 * The columns that matter (issue #1316): the raw fields a player already
 * compares by eye, then the derived numbers `derivedStats.ts` computes and
 * hides when it cannot state them honestly (a shield's range, a paralyzer's
 * DPS). Fixed rather than configurable: nothing has asked for a column
 * picker, and a fixed set is one thing to test rather than a preference to
 * store.
 */
export const REFERENCE_COLUMNS: ReferenceColumn[] = [
  { id: "health", label: "Health", value: (r) => r.health },
  { id: "metalCost", label: "Metal cost", value: (r) => r.metalCost },
  { id: "buildTime", label: "Build time", value: (r) => r.buildTime },
  { id: "sightDistance", label: "Sight", value: (r) => r.sightDistance },
  { id: "speed", label: "Speed", value: (r) => r.speed },
  { id: "maxRange", label: "Range", value: (r) => r.maxRange },
  { id: "dps", label: "DPS", value: (r) => r.derived.dps ?? undefined },
  {
    id: "alphaDamage",
    label: "Alpha damage",
    value: (r) => r.derived.alphaDamage ?? undefined,
  },
  {
    id: "costPerHitPoint",
    label: "Cost per HP",
    value: (r) => r.derived.costPerHitPoint ?? undefined,
  },
  {
    id: "dpsPer100Metal",
    label: "DPS per 100 metal",
    value: (r) => r.derived.dpsPer100Metal ?? undefined,
  },
  {
    id: "hitPointsPerBuildSecond",
    label: "HP per build second",
    value: (r) => r.derived.hitPointsPerBuildSecond ?? undefined,
  },
  {
    id: "rangePerCost",
    label: "Range per cost",
    value: (r) => r.derived.rangePerCost ?? undefined,
  },
];

export type SortDirection = "asc" | "desc";

export interface SortState {
  /** `"name"`, or one of `REFERENCE_COLUMNS`'s ids. */
  columnId: string;
  direction: SortDirection;
}

/**
 * `rows`, sorted by `sort`. A unit missing a column's value always sorts
 * after one that has it, whichever direction is asked for: a unit with no
 * weapons is not "the fastest" in a DPS sort just because `desc` reversed the
 * list a value-less row would otherwise trail.
 */
export function sortReferenceRows(
  rows: UnitReferenceRow[],
  sort: SortState,
): UnitReferenceRow[] {
  const direction = sort.direction === "desc" ? -1 : 1;
  if (sort.columnId === "name") {
    return [...rows].sort((a, b) => direction * a.name.localeCompare(b.name));
  }
  const column = REFERENCE_COLUMNS.find((c) => c.id === sort.columnId);
  if (!column) return rows;
  return [...rows].sort((a, b) => {
    const av = column.value(a);
    const bv = column.value(b);
    if (av === undefined && bv === undefined) return 0;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    return direction * (av - bv);
  });
}

/** Two column values are the same unit for comparison purposes: both absent,
 *  or numerically equal past floating point noise. */
function sameValue(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) < 1e-6;
}

/**
 * Which of `REFERENCE_COLUMNS` are not the same across every row in
 * `rows` (issue #1316's comparison view: "the fields where they differ").
 * Fewer than two rows differ in nothing, since there is nothing to compare
 * against.
 */
export function differingColumns(rows: UnitReferenceRow[]): ReferenceColumn[] {
  if (rows.length < 2) return [];
  return REFERENCE_COLUMNS.filter((column) => {
    const first = column.value(rows[0]);
    return rows.some((row) => !sameValue(column.value(row), first));
  });
}

/** A column's value, formatted for display: two decimal places, no more,
 *  and nothing at all for a unit the column has no honest answer for. */
export function formatReferenceValue(value: number | undefined): string {
  if (value === undefined) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
