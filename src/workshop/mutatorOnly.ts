/**
 * Field changes the user sent through the mutator route because the
 * edit-in-place route cannot write them (issue #2633).
 *
 * A project picks its route at delivery time, so most of it can go either
 * way. A field whose value the unit file works out in code, or a table two
 * units share, cannot be patched in place, but a mutator overrides the value
 * however the file arrives at it. The unit page finds those fields with a dry
 * run and offers to send that one change to the mutator. This records the
 * answer.
 *
 * A mark sits on the project beside `edits` rather than inside it, keyed the
 * way `edits.overrides` is: unit, then the dotted field path. It changes where
 * a change goes, not what the project changes, so the compiler never reads it
 * and a mutator carries the change as it always did. The in-place write
 * (`inplace.rs`) skips a marked change instead of refusing the whole batch
 * over it, and the Checks drawer says a mutator is still needed for it.
 *
 * A mark can outlive its change. Resetting the field leaves it in place, so
 * editing the field again goes the same way without asking twice. Only a mark
 * with a change under it counts anywhere.
 */
import type { UnitOverrides } from "./overrides";

/** Unit to the field paths sent through the mutator route. */
export type MutatorOnly = Record<string, string[]>;

export function isMutatorOnly(
  marks: MutatorOnly | undefined,
  unit: string,
  field: string,
): boolean {
  return marks?.[unit]?.includes(field) ?? false;
}

/**
 * Mark one field, or take the mark off. Returns `marks` itself when nothing
 * changed, and drops a unit left with no marks rather than keeping an empty
 * list.
 */
export function setMutatorOnly(
  marks: MutatorOnly | undefined,
  unit: string,
  field: string,
  on: boolean,
): MutatorOnly {
  const current = marks ?? {};
  const fields = current[unit] ?? [];
  if (fields.includes(field) === on) return current;
  const next = on
    ? [...fields, field].sort()
    : fields.filter((f) => f !== field);
  const { [unit]: _dropped, ...rest } = current;
  return next.length === 0 ? rest : { ...rest, [unit]: next };
}

/** The marked changes the project actually holds, in unit then field order. */
export function mutatorOnlyChanges(
  marks: MutatorOnly | undefined,
  overrides: UnitOverrides,
): { unit: string; field: string }[] {
  const out: { unit: string; field: string }[] = [];
  for (const unit of Object.keys(marks ?? {}).sort()) {
    const fields = overrides[unit];
    if (!fields) continue;
    for (const field of marks?.[unit] ?? [])
      if (Object.hasOwn(fields, field)) out.push({ unit, field });
  }
  return out;
}

/**
 * Read the marks out of untrusted JSON. Anything that is not a list of
 * strings under a unit is dropped, and so is a unit left with none.
 */
export function parseMutatorOnly(value: unknown): MutatorOnly {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const out: MutatorOnly = {};
  for (const [unit, raw] of Object.entries(value)) {
    if (!Array.isArray(raw)) continue;
    const fields = [
      ...new Set(raw.filter((f): f is string => typeof f === "string")),
    ].sort();
    if (fields.length > 0) out[unit] = fields;
  }
  return out;
}
