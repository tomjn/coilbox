/**
 * One arithmetic change applied across every unit in a collection, with a
 * preview before it lands (issue #2655).
 *
 * "Make everything in this factory ten percent cheaper" is one sentence, and
 * without this it is a dozen edits: open every unit, find the field, type the
 * new number. A batch turns it back into one action: pick a collection
 * (`collections.ts`), a field (resolved the same way `searchQuery.ts`
 * resolves one for a search or a rule, so a spelling that works there works
 * here), and an operation, and see every unit's before-and-after before
 * anything is written.
 *
 * Deliberately arithmetic only, no formulas: BAR EditP ships a formula
 * variant "in development" with its evaluation locked while they repair it,
 * which is a reason to keep the first version to what always parses. Two
 * operations, multiply and offset, and three rounding rules: none, to the
 * nearest whole number, or to the nearest multiple of a step the person
 * types (so "nearest 5" rounds 47 to 45).
 *
 * A unit is skipped rather than guessed at when the field is missing
 * (neither an override nor the def declares any of its candidate keys) or
 * present but not a number (a string field the alias table matched by
 * accident). Skipped rows are still listed, with the reason, so the preview
 * accounts for every unit the collection named. A unit whose new value comes
 * out equal to what it already holds is listed too, marked unchanged, rather
 * than silently dropped: seeing "no change" for a unit already at the target
 * value is part of what a preview is for.
 *
 * Applying writes one override per changed unit, through {@link setOverride},
 * which already drops a value equal to what the unit inherits. A unit already
 * overridden is read at the value the page shows (its override, not the
 * game's own), so the batch composes with edits made before it rather than
 * overwriting them from underneath.
 */
import { readPath, setOverride, type UnitOverrides } from "./overrides";

export type BatchOperation =
  | { kind: "multiply"; factor: number }
  | { kind: "offset"; amount: number };

export type BatchRounding =
  | { kind: "none" }
  | { kind: "integer" }
  | { kind: "nearest"; step: number };

/** Why a unit has no before-and-after to show. */
export type BatchSkipReason = "missing" | "not-numeric";

/** One unit's row in the preview. */
export interface BatchRow {
  unit: string;
  /** Absent for a skipped row. */
  before?: number;
  after?: number;
  skipped?: BatchSkipReason;
  /** Whether applying this row would change what the unit holds. Always
   *  false for a skipped row. */
  changed: boolean;
  /** The concrete field path this unit holds the value under (the def's own
   *  casing, or the override's key), absent for a skipped row. */
  path?: string;
}

/** `value` under `operation`, before rounding. */
export function applyBatchOperation(
  value: number,
  operation: BatchOperation,
): number {
  return operation.kind === "multiply"
    ? value * operation.factor
    : value + operation.amount;
}

/** `value` under `rounding`. A non-positive step leaves `value` alone rather
 *  than dividing by zero or reversing the rounding's own direction. */
export function applyBatchRounding(
  value: number,
  rounding: BatchRounding,
): number {
  if (rounding.kind === "none") return value;
  if (rounding.kind === "integer") return Math.round(value);
  if (!(rounding.step > 0)) return value;
  return Math.round(value / rounding.step) * rounding.step;
}

/** The field a unit holds one of `keys` under, checking its override before
 *  its def, case-insensitively against the def the way `searchQuery.ts`'s own
 *  field lookup does. `undefined` when neither holds any of `keys`. */
function findField(
  def: Record<string, unknown> | undefined,
  unitOverrides: Record<string, unknown> | undefined,
  keys: readonly string[],
): { path: string; raw: unknown } | undefined {
  for (const key of keys) {
    if (unitOverrides && Object.hasOwn(unitOverrides, key)) {
      return { path: key, raw: unitOverrides[key] };
    }
  }
  for (const key of keys) {
    const lower = key.toLowerCase();
    const found =
      def && Object.keys(def).find((k) => k.toLowerCase() === lower);
    if (found !== undefined) return { path: found, raw: def?.[found] };
  }
  return undefined;
}

function toNumber(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * The preview: one row per unit in `unitKeys`, in the order given.
 *
 * `fieldKeys` are the candidate engine keys for the field a person typed,
 * from `resolveField` in `searchQuery.ts`, oldest last, the same list a
 * search or a rule would try.
 */
export function computeBatchRows(
  unitKeys: readonly string[],
  fieldKeys: readonly string[],
  units: Record<string, Record<string, unknown> | undefined>,
  overrides: UnitOverrides,
  operation: BatchOperation,
  rounding: BatchRounding,
): BatchRow[] {
  return unitKeys.map((unit): BatchRow => {
    const found = findField(units[unit], overrides[unit], fieldKeys);
    if (!found) return { unit, skipped: "missing", changed: false };
    const before = toNumber(found.raw);
    if (before === undefined) {
      return { unit, skipped: "not-numeric", changed: false };
    }
    const after = applyBatchRounding(
      applyBatchOperation(before, operation),
      rounding,
    );
    return { unit, before, after, path: found.path, changed: after !== before };
  });
}

/**
 * Write every changed row as an override, as one pass over `overrides` so a
 * caller folding this into a single edit (`applyEdits`/`commit`) gets one
 * undo step no matter how many units it touches.
 *
 * `units` is the game's own table (with the project's clones already in),
 * read for the value a unit inherits, since {@link setOverride} needs that to
 * decide whether the new value is worth keeping as an override at all.
 */
export function applyBatchRows(
  overrides: UnitOverrides,
  rows: readonly BatchRow[],
  units: Record<string, Record<string, unknown> | undefined>,
): UnitOverrides {
  let next = overrides;
  for (const row of rows) {
    if (row.skipped || row.path === undefined || row.after === undefined)
      continue;
    const inherited = readPath(units[row.unit], row.path);
    next = setOverride(next, row.unit, row.path, row.after, inherited);
  }
  return next;
}

/** How many rows in `rows` would actually change something, for a preview's
 *  "N of M units change" line and to gate the apply button. */
export function batchChangeCount(rows: readonly BatchRow[]): number {
  return rows.filter((r) => r.changed).length;
}
