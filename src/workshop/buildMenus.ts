/**
 * What a builder builds, and how the project changes it (issue #1274).
 *
 * A unit nothing can build is not in the game. Adding a unit means putting it in
 * some builder's `buildoptions`, removing one means taking it out, and both are
 * the thing people mean when they say they are making a mod. Neither is a
 * number in a form, so neither belongs in the field list.
 *
 * This is not an override and it must not be stored as one. `buildoptions` is an
 * ordered list the game still owns, and writing the whole new list into the
 * sparse override set would pin it: a unit the game adds to that factory in its
 * next patch would silently never appear, which is exactly the failure
 * `overrides.ts` exists to avoid, one level up from a scalar. So an edit is
 * recorded as what the user did rather than as the list it produced.
 *
 * Three operations, replayed in order over whatever the game's list says today:
 *
 *  - `add` puts a unit on the end, if it is not already there.
 *  - `remove` takes one out. It is not the same as disabling the unit, which is
 *    a different mechanism with a different meaning (issue #2649): a unit taken
 *    out of one factory's menu is still in the game and another factory may
 *    still build it.
 *  - `move` puts a unit immediately before another one, or on the end. An
 *    anchor rather than an index, so entries nobody moved keep their relative
 *    order and a new entry from upstream is not shoved around by an index that
 *    was written before it existed.
 *
 * Ops are pruned after every edit, so the set never holds one that says nothing:
 * adding a unit and taking it out again leaves no trace, and moving a unit back
 * where it started is not a change. That mirrors `setOverride` dropping a value
 * equal to the inherited one, and it costs the same thing: an `add` for a
 * unit the game already builds is dropped, so if the game later stops building
 * it, the add is not there to bring it back. The alternative is a store that
 * fills up with no-ops nobody can see, which is worse.
 */
import { sameValue } from "./overrides";

/** One change to one build menu. Unit names are lowercased def keys. */
export type BuildMenuOp =
  | { op: "add"; unit: string }
  | { op: "remove"; unit: string }
  /** Put `unit` immediately before `before`, or on the end when it is null. */
  | { op: "move"; unit: string; before: string | null };

/**
 * Every build menu a project changes, keyed by the builder's lowercased def key.
 *
 * Sparse, like the override set: a builder nobody touched has no entry, so
 * `Object.keys` answers "which build menus does this project change".
 */
export type BuildMenus = Record<string, BuildMenuOp[]>;

/** Whether a unit builds anything, so it has a build menu worth showing. */
export function isBuilder(def: Record<string, unknown> | undefined): boolean {
  if (!def) return false;
  for (const [key, value] of Object.entries(def)) {
    const lower = key.toLowerCase();
    if (lower === "buildoptions") return true;
    if (lower === "builder" && value === true) return true;
  }
  return false;
}

/**
 * Whether the engine will let this unit build at all.
 *
 * A separate question from {@link isBuilder}, which asks whether there is a menu
 * to draw. A def can carry a full `buildoptions` list with `builder` off, and
 * then the list is drawn by us and ignored by the game.
 *
 * The engine's default is false, so an absent key is off. Read case
 * insensitively, because the key is `builder` in the def data and `builder` in
 * the registry but a game may have written it either way.
 */
export function builderFlagOf(
  def: Record<string, unknown> | undefined,
): boolean {
  if (!def) return false;
  const found = Object.entries(def).find(
    ([key]) => key.toLowerCase() === "builder",
  );
  return found?.[1] === true;
}

/** The engine fields that take their default from `builder`, so a unit with it
 *  off has lost more than its menu. Named in the panel's warning. */
export const BUILDER_DEFAULTED_FIELDS = [
  "canAssist",
  "canReclaim",
  "canRepair",
  "canRestore",
] as const;

/**
 * The build list a definition declares, lowercased and de-duplicated.
 *
 * Read case insensitively, because the key is `buildoptions` in the data and
 * `buildOptions` in the engine's own registry. The value is normally a JSON
 * array, but an empty Lua table has no `1..n` run and comes back from the worker
 * as `{}`, so an object is read in numeric key order rather than treated as no
 * list at all.
 *
 * A game that names the same unit twice gets it once. The engine builds one
 * button either way, and a list with a repeat in it has no sane answer for what
 * "move this one down" means.
 */
export function buildOptionsOf(
  def: Record<string, unknown> | undefined,
): string[] {
  if (!def) return [];
  const found = Object.entries(def).find(
    ([key]) => key.toLowerCase() === "buildoptions",
  );
  const raw = found?.[1];
  const entries = Array.isArray(raw)
    ? raw
    : raw !== null && typeof raw === "object"
      ? Object.entries(raw as Record<string, unknown>)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, value]) => value)
      : [];
  const out: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const unit = entry.trim().toLowerCase();
    if (unit && !out.includes(unit)) out.push(unit);
  }
  return out;
}

/** Replay a menu's operations over the list the game gives today. */
export function applyBuildMenu(
  inherited: string[],
  ops: BuildMenuOp[],
): string[] {
  let list = [...inherited];
  for (const op of ops) {
    if (op.op === "add") {
      if (!list.includes(op.unit)) list.push(op.unit);
      continue;
    }
    if (op.op === "remove") {
      list = list.filter((unit) => unit !== op.unit);
      continue;
    }
    if (!list.includes(op.unit)) continue;
    const rest = list.filter((unit) => unit !== op.unit);
    const at = op.before === null ? -1 : rest.indexOf(op.before);
    if (at < 0) rest.push(op.unit);
    else rest.splice(at, 0, op.unit);
    list = rest;
  }
  return list;
}

/** What a builder's menu is now: the game's list with the project's ops on it. */
export function resolvedBuildMenu(
  menus: BuildMenus,
  builder: string,
  def: Record<string, unknown> | undefined,
): string[] {
  return applyBuildMenu(buildOptionsOf(def), menus[builder] ?? []);
}

/**
 * Drop every operation the menu would look the same without.
 *
 * Repeated until nothing more can go, because dropping one can strand another:
 * an add and a remove of the same unit only collapse to nothing once the add
 * has gone and left the remove with nothing to do.
 */
function prune(ops: BuildMenuOp[], inherited: string[]): BuildMenuOp[] {
  const target = applyBuildMenu(inherited, ops);
  let out = ops;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      const without = [...out.slice(0, i), ...out.slice(i + 1)];
      if (!sameValue(applyBuildMenu(inherited, without), target)) continue;
      out = without;
      changed = true;
    }
  }
  return out;
}

/** Store a builder's operations, dropping the builder when nothing is left. */
function withOps(
  menus: BuildMenus,
  builder: string,
  ops: BuildMenuOp[],
  inherited: string[],
): BuildMenus {
  const pruned = prune(ops, inherited);
  if (pruned.length === 0) return clearBuildMenu(menus, builder);
  return { ...menus, [builder]: pruned };
}

/** Put a unit in a builder's menu, on the end. */
export function addToBuildMenu(
  menus: BuildMenus,
  builder: string,
  unit: string,
  inherited: string[],
): BuildMenus {
  const key = unit.trim().toLowerCase();
  if (!key) return menus;
  const ops = menus[builder] ?? [];
  if (applyBuildMenu(inherited, ops).includes(key)) return menus;
  return withOps(menus, builder, [...ops, { op: "add", unit: key }], inherited);
}

/** Take a unit out of a builder's menu. The unit itself is untouched. */
export function removeFromBuildMenu(
  menus: BuildMenus,
  builder: string,
  unit: string,
  inherited: string[],
): BuildMenus {
  const key = unit.toLowerCase();
  const ops = menus[builder] ?? [];
  if (!applyBuildMenu(inherited, ops).includes(key)) return menus;
  return withOps(
    menus,
    builder,
    [...ops, { op: "remove", unit: key }],
    inherited,
  );
}

/**
 * Put a unit immediately before another one, or on the end when `before` is
 * null. The one way a reorder is recorded, whether it came from a drag, from
 * the arrow keys or from Home and End.
 *
 * The caller names the anchor rather than an index because the anchor is what
 * gets stored, and the caller is the one with the list on screen. A drop between
 * two rows is the row below the gap, which is this argument exactly.
 */
export function moveBeforeInBuildMenu(
  menus: BuildMenus,
  builder: string,
  unit: string,
  before: string | null,
  inherited: string[],
): BuildMenus {
  const key = unit.toLowerCase();
  if (before !== null && before.toLowerCase() === key) return menus;
  const ops = menus[builder] ?? [];
  if (!applyBuildMenu(inherited, ops).includes(key)) return menus;
  return withOps(
    menus,
    builder,
    [...ops, { op: "move", unit: key, before: before?.toLowerCase() ?? null }],
    inherited,
  );
}

/** Forget every change to one builder's menu. */
export function clearBuildMenu(menus: BuildMenus, builder: string): BuildMenus {
  if (!Object.hasOwn(menus, builder)) return menus;
  const { [builder]: _dropped, ...rest } = menus;
  return rest;
}

/** How many operations the project holds, across every build menu. */
export function buildMenuOpCount(menus: BuildMenus): number {
  return Object.values(menus).reduce((n, ops) => n + ops.length, 0);
}
