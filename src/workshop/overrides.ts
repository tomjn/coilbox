/**
 * What a tweak is: a sparse set of overrides held against the game's own unit
 * table, never a copy of it (issue #1271).
 *
 * The temptation is to load a unit, let the user edit a form, and write the
 * whole form back out. That produces a valid tweak and a dead one. Every field
 * the user never looked at gets pinned to whatever the game said on the day
 * they opened the editor, so the next balance patch reaches every unit except
 * the ones they touched. The only shape that ages is the one that records the
 * edit and nothing else.
 *
 * `src/play/modOptions.ts` learned the same rule from the other end. There an
 * absent key is dangerous, because the engine substitutes its own default
 * rather than the game's. Here a present key is dangerous, because it freezes
 * the game's. Both end up sparse, and both drop a value that only repeats what
 * was inherited: {@link setOverride} is this module's `withOption` and
 * `isChanged` pair rolled into one call, for the same reason.
 *
 * A field has two stored states, {@link FieldState}, and one action. Inherited
 * means no key is present and the value on screen is the game's or the
 * engine's. Overridden means a key is present and the value on screen is the
 * user's. Reset is the third thing the interface has to offer and is
 * deliberately not a state: storing "this field was reset" would be a key
 * standing for the absence of a key, which is the non-sparse trap again with an
 * extra step. {@link clearOverride} removes the key instead.
 */

/**
 * Every override a project holds, keyed by lowercased unit def key and then by
 * the field's dotted path.
 *
 * Sparse at both levels. A unit nobody edited has no entry at all, not an empty
 * one, so `Object.keys` answers "which units does this project change" without
 * filtering.
 */
export type UnitOverrides = Record<string, Record<string, unknown>>;

/** Whether the value on screen came from the user or from underneath them. */
export type FieldState = "inherited" | "overridden";

/**
 * Deep equality, to the depth these values go. Def values are JSON: numbers,
 * strings, booleans, null, arrays and plain objects, because that is all the
 * unitsync worker can hand back.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every(
      (k) =>
        Object.hasOwn(b as object, k) &&
        sameValue(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    );
  }
  return false;
}

/**
 * Read a dotted path out of a def table. `undefined` for a path the table does
 * not reach, which is the same answer as a key it never declared: the worker
 * sends `null` for a key the game declared and it could not read, and the two
 * must not be conflated.
 *
 * Array steps are the real JS index, so `weapons.0.name` is the first mount.
 * The registry's own paths write that step as `*`, which
 * `normaliseFieldPath` converts to, so a path here is the access path and a
 * path there is the pattern.
 */
export function readPath(
  table: Record<string, unknown> | undefined,
  path: string,
): unknown {
  if (!table) return undefined;
  let current: unknown = table;
  for (const step of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}

/**
 * Write a dotted path into a table, creating whatever it has to pass through,
 * and taking a numeric step to mean an array the way {@link readPath} does.
 *
 * Mutates, so it is private to this module: the two callers below both build a
 * copy first, and an exported mutator over a def table is the one thing the
 * sparse model cannot survive.
 */
function writePath(
  table: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const steps = path.split(".");
  let current: Record<string, unknown> = table;
  for (const [index, step] of steps.slice(0, -1).entries()) {
    const next = current[step];
    if (next !== null && typeof next === "object") {
      current = next as Record<string, unknown>;
      continue;
    }
    const created = /^\d+$/.test(steps[index + 1]) ? [] : {};
    current[step] = created;
    current = created as Record<string, unknown>;
  }
  current[steps[steps.length - 1]] = value;
}

/**
 * One unit's definition as the project has it: the table underneath with the
 * user's edits written in.
 *
 * The page never renders this. A field row reads the base value and the edit
 * separately, because it has to show both. This is for the moments where the
 * unit has to exist as one whole table, which so far means cloning it
 * (issue #1272) and, later, emitting it.
 *
 * The copy is deep, so nothing here can reach back into the game's own def
 * table, which is shared and cached for the session.
 */
export function resolvedDef(
  def: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out = structuredClone(def ?? {});
  for (const [path, value] of Object.entries(patch ?? {}))
    writePath(out, path, structuredClone(value));
  return out;
}

/** Whether the user has said something about this field. */
export function fieldState(
  overrides: UnitOverrides,
  unitKey: string,
  path: string,
): FieldState {
  const unit = overrides[unitKey];
  return unit && Object.hasOwn(unit, path) ? "overridden" : "inherited";
}

/** The user's value for a field, or `undefined` when they have not set one. */
export function overrideValue(
  overrides: UnitOverrides,
  unitKey: string,
  path: string,
): unknown {
  return overrides[unitKey]?.[path];
}

/**
 * Record one edit.
 *
 * Writing a value equal to what was already inherited removes the key rather
 * than storing it, so typing the game's own number back into a box leaves the
 * unit exactly as it was found. That is the whole sparseness guarantee in one
 * line: nothing but this function ever adds a key, it only ever adds the one
 * path it was asked about, and it refuses to add a path that says nothing.
 */
export function setOverride(
  overrides: UnitOverrides,
  unitKey: string,
  path: string,
  value: unknown,
  inherited: unknown,
): UnitOverrides {
  if (sameValue(value, inherited))
    return clearOverride(overrides, unitKey, path);
  return {
    ...overrides,
    [unitKey]: { ...overrides[unitKey], [path]: value },
  };
}

/**
 * Put a field back to what it inherits, by forgetting the user ever touched it.
 * A unit left with no overrides drops out entirely rather than staying behind
 * as an empty table.
 */
export function clearOverride(
  overrides: UnitOverrides,
  unitKey: string,
  path: string,
): UnitOverrides {
  const unit = overrides[unitKey];
  if (!unit || !Object.hasOwn(unit, path)) return overrides;
  const { [path]: _dropped, ...rest } = unit;
  const { [unitKey]: _unit, ...others } = overrides;
  return Object.keys(rest).length === 0
    ? others
    : { ...others, [unitKey]: rest };
}

/** Forget every edit made to one unit. */
export function clearUnit(
  overrides: UnitOverrides,
  unitKey: string,
): UnitOverrides {
  if (!Object.hasOwn(overrides, unitKey)) return overrides;
  const { [unitKey]: _dropped, ...rest } = overrides;
  return rest;
}

/** The paths the user has overridden on one unit, in insertion order. */
export function overriddenPaths(
  overrides: UnitOverrides,
  unitKey: string,
): string[] {
  return Object.keys(overrides[unitKey] ?? {});
}

/** How many fields the project changes, across every unit. */
export function overrideCount(overrides: UnitOverrides): number {
  return Object.values(overrides).reduce(
    (n, unit) => n + Object.keys(unit).length,
    0,
  );
}
