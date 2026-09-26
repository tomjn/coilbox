/**
 * A field change kept as a rule against the game's value, so it follows the
 * game when the game changes (issue #3174, from the spike in #3119).
 *
 * Every change in `edits.overrides` is a fixed number. "15% tougher" typed
 * against a unit with 260 health is stored as 299, and when the game raises
 * that unit to 280 the project still writes 299. This store keeps the rule
 * beside the number: a factor, an offset, a rounding rule and `base`, the game
 * value the number was last worked out from. The number is
 * `round(base * factor + offset)`.
 *
 * The worked-out number stays in `overrides`, and that is what makes the store
 * additive. The compiler, `loads_as.rs`, the tweak slot packer, an older
 * coilbox build and the hub's port all read `overrides` and nothing else, and
 * the number there is right for the game the author last opened. So the
 * kind version does not move. The rule is never written into `overrides`
 * itself, because an older reader would compile a marker like `{ mul: 1.15 }`
 * as a Lua table in place of a number.
 *
 * The number is worked out again in coilbox when a project is opened against
 * its game ({@link followGame}), not in Lua at load time. The spike gives the
 * reasons: the page's game value is the value after the game's own Lua has
 * run, which is the base a modder means, and a fixed target is what lets
 * `loads_as.rs` settle and prove a written value.
 *
 * Editing rules:
 *  - Typing a plain number into a field with a rule makes it fixed again.
 *    `editSlot` enforces this for every write to `overrides` through
 *    {@link withoutStaleRelative}, so no caller has to remember it.
 *  - Reset clears both ({@link resetField}).
 *  - A rule whose result equals the game's value keeps its entry here even
 *    though `setOverride` drops the `overrides` key, so it still follows the
 *    next update.
 */
import {
  applyBatchRounding,
  type BatchOperation,
  type BatchRounding,
  toNumber,
} from "./batchEdit";
import {
  clearOverride,
  clearUnit,
  readPath,
  sameValue,
  setOverride,
  type UnitOverrides,
} from "./overrides";
import type { GameEdits } from "./project";

/** How a change is worked out from the game's value. */
export interface RelativeChange {
  /** 1.15 for +15%. */
  factor: number;
  /** 40 for +40. */
  offset: number;
  rounding: BatchRounding;
}

/** A change and the game value it was last worked out from. */
export interface RelativeRule extends RelativeChange {
  base: number;
}

/** Unit key, then dotted field path, the same keys `overrides` uses. */
export type RelativeEdits = Record<string, Record<string, RelativeRule>>;

/** `change` applied to `base`, rounded. 15 significant digits for the reason
 *  `applyBatchOperation` gives. */
export function relativeValue(change: RelativeChange, base: number): number {
  const exact = base * change.factor + change.offset;
  return applyBatchRounding(Number(exact.toPrecision(15)), change.rounding);
}

/** The number a rule gives at its own `base`. */
export function relativeResult(rule: RelativeRule): number {
  return relativeValue(rule, rule.base);
}

/** The rule on one field, or `undefined` when the field has none. */
export function relativeRuleOf(
  relative: RelativeEdits | undefined,
  unit: string,
  path: string,
): RelativeRule | undefined {
  return relative?.[unit]?.[path];
}

/**
 * `rule` with `operation` folded into it, so a second bulk edit on a field
 * that already follows the game stays one rule (issue #3175). A percentage
 * multiplies the factor and the offset, an add moves the offset, and a "set"
 * has no rule to fold into, so it answers `undefined`.
 */
export function composeRelative(
  rule: RelativeChange | undefined,
  operation: BatchOperation,
  rounding: BatchRounding,
): RelativeChange | undefined {
  const factor = rule?.factor ?? 1;
  const offset = rule?.offset ?? 0;
  const tidy = (n: number) => Number(n.toPrecision(15));
  if (operation.kind === "multiply")
    return {
      factor: tidy(factor * operation.factor),
      offset: tidy(offset * operation.factor),
      rounding,
    };
  if (operation.kind === "offset")
    return { factor, offset: tidy(offset + operation.amount), rounding };
  return undefined;
}

/** `relative` with one field's rule set, or taken off when `rule` is
 *  undefined. A unit left with no rules drops out. */
function withRule(
  relative: RelativeEdits | undefined,
  unit: string,
  path: string,
  rule: RelativeRule | undefined,
): RelativeEdits {
  const current = relative ?? {};
  const fields = current[unit] ?? {};
  if (rule === undefined && !Object.hasOwn(fields, path)) return current;
  const { [path]: _dropped, ...rest } = fields;
  const nextFields = rule === undefined ? rest : { ...rest, [path]: rule };
  const { [unit]: _unit, ...others } = current;
  return Object.keys(nextFields).length === 0
    ? others
    : { ...others, [unit]: nextFields };
}

/** `edits` holding `relative`, or `edits` itself when it already does. */
function withRelative(edits: GameEdits, relative: RelativeEdits): GameEdits {
  return relative === edits.relative ? edits : { ...edits, relative };
}

/** Take one field's rule off, leaving its number in `overrides`. */
export function clearRelative(
  relative: RelativeEdits | undefined,
  unit: string,
  path: string,
): RelativeEdits | undefined {
  if (!relative?.[unit]?.[path]) return relative;
  return withRule(relative, unit, path, undefined);
}

/** Take every rule on one unit off, for resetting or deleting the unit. */
export function clearRelativeUnit(
  relative: RelativeEdits | undefined,
  unit: string,
): RelativeEdits | undefined {
  if (!relative || !Object.hasOwn(relative, unit)) return relative;
  const { [unit]: _dropped, ...rest } = relative;
  return rest;
}

/**
 * Write a change that follows the game: the worked-out number into
 * `overrides`, through `setOverride` so a result equal to the game's value
 * leaves no key there, and the rule here with `base` set to `gameValue`.
 *
 * The write path for issue #3175's bulk edit and field row. `gameValue` is the
 * game's own number for the field, before any project change, since that is
 * what a rule follows.
 */
export function setRelativeEdit(
  edits: GameEdits,
  unit: string,
  path: string,
  change: RelativeChange,
  gameValue: number,
): GameEdits {
  const rule: RelativeRule = { ...change, base: gameValue };
  const written = setOverride(
    edits.overrides,
    unit,
    path,
    relativeResult(rule),
    gameValue,
  );
  const overrides = sameOverride(edits.overrides, written, unit, path)
    ? edits.overrides
    : written;
  const existing = relativeRuleOf(edits.relative, unit, path);
  const relative =
    existing && sameValue(existing, rule)
      ? (edits.relative ?? {})
      : withRule(edits.relative, unit, path, rule);
  if (overrides === edits.overrides && relative === edits.relative)
    return edits;
  return withRelative({ ...edits, overrides }, relative);
}

/** Put a field back to the game's value: its override and its rule both go. */
export function resetField(
  edits: GameEdits,
  unit: string,
  path: string,
): GameEdits {
  const overrides = clearOverride(edits.overrides, unit, path);
  const relative = clearRelative(edits.relative, unit, path);
  if (overrides === edits.overrides && relative === edits.relative)
    return edits;
  return withRelative({ ...edits, overrides }, relative ?? {});
}

/** Put every field on one unit back to the game's value, rules included. */
export function resetUnit(edits: GameEdits, unit: string): GameEdits {
  const overrides = clearUnit(edits.overrides, unit);
  const relative = clearRelativeUnit(edits.relative, unit);
  if (overrides === edits.overrides && relative === edits.relative)
    return edits;
  return withRelative({ ...edits, overrides }, relative ?? {});
}

/** Whether `overrides` holds the same thing for one field on both sides,
 *  absent counting as its own value. */
function sameOverride(
  a: UnitOverrides,
  b: UnitOverrides,
  unit: string,
  path: string,
): boolean {
  const inA = Object.hasOwn(a[unit] ?? {}, path);
  const inB = Object.hasOwn(b[unit] ?? {}, path);
  if (inA !== inB) return false;
  return !inA || sameValue(a[unit][path], b[unit][path]);
}

/**
 * `after` with every rule taken off whose field's number changed between
 * `before` and `after`. A number that changed without its rule being written
 * is a number somebody typed, and a typed number is a fixed one.
 *
 * `editSlot` runs this on every write to `overrides`, which is how the field
 * row, the Reference table, bulk edit, the randomiser and the compatibility
 * fixes all make a field fixed again without knowing this store exists.
 * Writers that mean to keep a rule (`setRelativeEdit`, `followGame`) write
 * both stores themselves rather than going through `editSlot`.
 */
export function withoutStaleRelative(
  before: GameEdits,
  after: GameEdits,
): GameEdits {
  const relative = after.relative;
  if (!relative || before.overrides === after.overrides) return after;
  let next: RelativeEdits = relative;
  for (const [unit, fields] of Object.entries(relative))
    for (const path of Object.keys(fields))
      if (!sameOverride(before.overrides, after.overrides, unit, path))
        next = withRule(next, unit, path, undefined);
  return withRelative(after, next);
}

/** What happened to one rule when the project was opened against its game. */
export type RelativeFollow =
  | {
      kind: "moved";
      unit: string;
      path: string;
      gameBefore: number;
      gameNow: number;
      projectBefore: number;
      projectNow: number;
    }
  | {
      /** The game no longer has the field, or it is no longer a number. */
      kind: "missing" | "not-numeric";
      unit: string;
      path: string;
      /** The number the project keeps, which is its last worked-out one. */
      kept: number;
    };

/**
 * Work every rule out again against the game as it is now.
 *
 * `units` is the game's own unit table. A rule on a unit the project copied
 * is read against the copy's own definition, the way `compatibility.ts` reads
 * one, which never moves under it.
 *
 * Where the game's value differs from `base`, the number is worked out again,
 * written into `overrides`, and `base` moves to the game's value. Where the
 * game no longer has the field, or it is no longer a number, the project keeps
 * its last number and the rule is left as it was, so it picks up again if the
 * field comes back. A rule whose number no longer matches what it works out to
 * was overwritten by something that did not know about rules (an older
 * coilbox build that edited the field), so the typed number wins and the rule
 * goes, the same as typing a number in this build.
 *
 * Returns `edits` itself when nothing moved, so opening a project whose game
 * has not changed costs no undo step.
 */
export function followGame(
  edits: GameEdits,
  units: Record<string, Record<string, unknown> | undefined>,
): { edits: GameEdits; follows: RelativeFollow[] } {
  const relative = edits.relative;
  if (!relative) return { edits, follows: [] };
  let overrides = edits.overrides;
  let rules: RelativeEdits = relative;
  const follows: RelativeFollow[] = [];
  for (const [unit, fields] of Object.entries(relative)) {
    const def = edits.clones[unit]?.def ?? units[unit];
    for (const [path, rule] of Object.entries(fields)) {
      const held = Object.hasOwn(overrides[unit] ?? {}, path);
      // No key means the last result equalled the game's value, `base`.
      const last = held ? toNumber(overrides[unit][path]) : rule.base;
      if (last === undefined || last !== relativeResult(rule)) {
        rules = withRule(rules, unit, path, undefined);
        continue;
      }
      // A unit the game no longer has is `compatibility.ts`'s to report,
      // with its own offer to remove the changes. Nothing to work out here.
      if (!def) continue;
      const raw = readPath(def, path);
      const now = toNumber(raw);
      if (now === undefined) {
        follows.push({
          kind: raw === undefined || raw === null ? "missing" : "not-numeric",
          unit,
          path,
          kept: last,
        });
        // Keep the number even where the key had been dropped for equalling
        // the game's old value: there is no game value to fall back on now.
        if (!held)
          overrides = setOverride(overrides, unit, path, last, undefined);
        continue;
      }
      if (now === rule.base) continue;
      const next: RelativeRule = { ...rule, base: now };
      const projectNow = relativeResult(next);
      overrides = setOverride(overrides, unit, path, projectNow, raw);
      rules = withRule(rules, unit, path, next);
      follows.push({
        kind: "moved",
        unit,
        path,
        gameBefore: rule.base,
        gameNow: now,
        projectBefore: last,
        projectNow,
      });
    }
  }
  if (overrides === edits.overrides && rules === relative)
    return { edits, follows };
  return { edits: withRelative({ ...edits, overrides }, rules), follows };
}

/** A number as a person would write it, without binary noise. */
function formatNumber(n: number): string {
  return String(Number(n.toPrecision(12)));
}

function signed(n: number): string {
  return n < 0 ? `-${formatNumber(-n)}` : `+${formatNumber(n)}`;
}

/**
 * The rule as a sentence fragment, with the number it gives: "+15% of 280 =
 * 322", "+40 on 280 = 320", "+15% +40 of 280 = 362". For the field row, the
 * Changes page and the Reference table's hover.
 */
export function describeRelative(rule: RelativeRule): string {
  const result = formatNumber(relativeResult(rule));
  const base = formatNumber(rule.base);
  const percent = signed((rule.factor - 1) * 100);
  if (rule.factor !== 1 || rule.offset === 0) {
    const add = rule.offset !== 0 ? ` ${signed(rule.offset)}` : "";
    return `${percent}%${add} of ${base} = ${result}`;
  }
  return `${signed(rule.offset)} on ${base} = ${result}`;
}

/** What the checks list says about one rule after opening the project. */
export function describeFollow(follow: RelativeFollow): string {
  const { unit, path } = follow;
  if (follow.kind === "moved")
    return `${unit} ${path} follows the game: game ${formatNumber(follow.gameBefore)} to ${formatNumber(follow.gameNow)}, project ${formatNumber(follow.projectBefore)} to ${formatNumber(follow.projectNow)}.`;
  if (follow.kind === "missing")
    return `The game no longer has ${path} on ${unit}, so the change that followed it keeps its last number, ${formatNumber(follow.kept)}.`;
  return `${unit} ${path} is no longer a number in the game, so the change that followed it keeps its last number, ${formatNumber(follow.kept)}.`;
}

/** Only the three rounding rules `batchEdit.ts` knows. */
function parseRounding(value: unknown): BatchRounding | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.kind === "none") return { kind: "none" };
  if (record.kind === "integer") return { kind: "integer" };
  if (
    record.kind === "nearest" &&
    typeof record.step === "number" &&
    Number.isFinite(record.step) &&
    record.step > 0
  )
    return { kind: "nearest", step: record.step };
  return undefined;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Read the rules out of untrusted JSON. A rule missing a number or naming a
 * rounding rule this build does not know is dropped, which leaves its field as
 * the fixed number `overrides` already holds.
 */
export function parseRelativeEdits(value: unknown): RelativeEdits {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const out: RelativeEdits = {};
  for (const [unit, fields] of Object.entries(value)) {
    if (typeof fields !== "object" || fields === null || Array.isArray(fields))
      continue;
    const parsed: Record<string, RelativeRule> = {};
    for (const [path, raw] of Object.entries(fields)) {
      if (typeof raw !== "object" || raw === null) continue;
      const rule = raw as Record<string, unknown>;
      const rounding = parseRounding(rule.rounding);
      if (
        !finite(rule.factor) ||
        !finite(rule.offset) ||
        !finite(rule.base) ||
        !rounding
      )
        continue;
      parsed[path] = {
        factor: rule.factor,
        offset: rule.offset,
        rounding,
        base: rule.base,
      };
    }
    if (Object.keys(parsed).length > 0) out[unit] = parsed;
  }
  return out;
}
