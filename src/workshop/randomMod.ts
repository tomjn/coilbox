/**
 * A randomised mod: a seed, a scope, and a rarity ladder, producing an ordinary
 * project's overrides (issue #1318).
 *
 * One of the more popular community tools randomises every unit into rarity
 * tiers for an evening of nonsense. The point of building it here is not the
 * party mode, it is proof the project model has a second author besides the
 * editor. This reads the same unit defs the editor does, resolves a field the
 * same way `batchEdit.ts` does (`findField`, `toNumber`, both exported from
 * there for exactly this), scopes to a query the same way `searchQuery.ts`
 * does, and writes through `setOverride`'s own sparseness guarantee. The
 * compiler and every delivery route already turn an override set into a
 * mutator or BAR tweak slots, so none of that needed to change.
 *
 * Reproducibility is the seed plus the rules: given the same unit defs, the
 * same seed and the same rules always produce the same overrides, checked by
 * a golden test below. What is deliberately not built is a stored recipe a
 * project remembers and a "regenerate" button that replays it. That is a
 * second feature: undo would have to make sense of a wholesale replacement,
 * and the container payload would need a new optional slot. For a first
 * version the project's description records the seed and rules in words,
 * which is enough for someone to retype them here and get the same mod back,
 * or to hand the seed and rules to somebody else the way a `conquest`
 * challenge code does.
 *
 * Every roll for a unit comes from a PRNG seeded off that unit's own key
 * (`hashString`, `mulberry32`, both from `src/conquest/rng.ts`, the seeded PRNG
 * this project already has and the golden-tested pattern for reusing it), not
 * off a shared stream all units draw from in turn. So adding or removing a
 * unit from the scope never changes what any other unit rolls, and the order
 * `unitKeys` arrives in cannot matter either.
 *
 * Safety is a floor, not a suggestion. Only a field that already reads as a
 * positive number is touched, and the result is rounded and clamped to at
 * least 1, so cost, health and build time can shrink to something silly but
 * never to zero, negative, or something the compiler would reject.
 */
import { hashString, mulberry32 } from "../conquest/rng";
import { findField, toNumber } from "./batchEdit";
import { type Collections, collectionUnits } from "./collections";
import { setOverride, type UnitOverrides } from "./overrides";
import { evaluateUnitQuery, parseUnitQuery, resolveField } from "./searchQuery";

/** One numeric field the generator can touch, in a fixed order so a unit's
 *  rolls do not depend on which fields happen to be enabled and in what order
 *  a caller listed them. Resolved through `searchQuery.ts`'s own alias table
 *  (`resolveField`), the same spellings a search box or a batch edit accepts. */
export interface RandomFieldDef {
  id: string;
  label: string;
}

export const RANDOM_FIELDS: readonly RandomFieldDef[] = [
  { id: "cost", label: "Metal cost" },
  { id: "health", label: "Health" },
  { id: "speed", label: "Speed" },
  { id: "buildtime", label: "Build time" },
];

/** A rarity tier's multiply range. The ladder itself is fixed (issue #1318's
 *  "keep the knobs few"): only a tier's weight is a knob, not its range,
 *  because a factor range wide enough to be fun and narrow enough to never
 *  read as broken is exactly the kind of number this app should not be asking
 *  a first-time user to invent. */
export interface RarityTier {
  id: string;
  label: string;
  factorMin: number;
  factorMax: number;
}

export const RARITY_TIERS: readonly RarityTier[] = [
  { id: "common", label: "Common", factorMin: 0.85, factorMax: 1.15 },
  { id: "uncommon", label: "Uncommon", factorMin: 0.6, factorMax: 1.6 },
  { id: "rare", label: "Rare", factorMin: 0.3, factorMax: 2.2 },
  { id: "legendary", label: "Legendary", factorMin: 0.15, factorMax: 3.5 },
];

/** A tier's share of the roll, by tier id. Not required to sum to 100: every
 *  weight is read relative to the total, the same as a fruit machine's odds. A
 *  tier missing from the map, or given a weight of 0 or less, is never picked. */
export type TierWeights = Record<string, number>;

export const DEFAULT_TIER_WEIGHTS: TierWeights = {
  common: 60,
  uncommon: 25,
  rare: 12,
  legendary: 3,
};

/** Which units the generator touches. `all` is every unit the game declares.
 *  `query` is `searchQuery.ts`'s own predicate language, evaluated against the
 *  game's own fields (a fresh project has no overrides yet to check first). A
 *  query that fails to parse scopes to nothing, the same as a collection's own
 *  rule does, rather than throwing. `collection` names one already defined on
 *  an existing project against the same game, since a project just starting
 *  has none of its own yet (issue #2654's own nesting and rule resolution
 *  apply unchanged). */
export type RandomScope =
  | { kind: "all" }
  | { kind: "query"; query: string }
  | { kind: "collection"; collections: Collections; collectionId: string };

/** A human label for a scope, for the project's description and the preview
 *  header. Does not say how many units matched: the caller already knows that
 *  from {@link resolveRandomScope}'s own length. */
export function describeRandomScope(scope: RandomScope): string {
  if (scope.kind === "all") return "all units";
  if (scope.kind === "query") return `units matching "${scope.query}"`;
  return scope.collections[scope.collectionId]?.name ?? "an unnamed collection";
}

/** Every unit key `scope` names, sorted, out of `units` (the game's def
 *  table). Never throws: an unparseable query or an id naming no collection
 *  answers with nothing, the same as evaluating either does elsewhere. */
export function resolveRandomScope(
  scope: RandomScope,
  units: Record<string, Record<string, unknown> | undefined>,
): string[] {
  const keys = Object.keys(units);
  if (scope.kind === "all") return keys.sort();
  if (scope.kind === "query") {
    const parsed = parseUnitQuery(scope.query);
    if (!parsed.ok) return [];
    return keys
      .filter((key) =>
        evaluateUnitQuery(parsed.query, { key, name: key, def: units[key] }),
      )
      .sort();
  }
  const matched = collectionUnits(scope.collections, scope.collectionId, {
    units: Object.fromEntries(
      Object.entries(units).filter(([, def]) => def !== undefined),
    ) as Record<string, Record<string, unknown>>,
    overrides: {},
  });
  return matched ? [...matched].sort() : [];
}

/** What the generator is asked to do. `seed` is the whole of what makes a run
 *  reproducible alongside these rules: the same seed, scope and field/weight
 *  choices against the same unit defs always produce the same plan. */
export interface RandomModRules {
  seed: number;
  fields: readonly string[];
  tierWeights: TierWeights;
}

/** A fresh seed for the "new seed" button. Not itself part of the
 *  reproducibility guarantee, since nothing here remembers which seeds have
 *  already been offered. It just has to be different enough to notice. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

/** The minimum a touched field is ever left at. `cost`, `health` and
 *  `buildtime` at 0 make a unit that cannot be built or cannot die. A small
 *  positive floor keeps every one of them a real, if silly, number instead. */
const MIN_RESULT = 1;

/** One field's before-and-after on one unit. */
export interface RandomModChange {
  field: string;
  path: string;
  before: number;
  after: number;
}

/** One unit's roll: which tier it landed in, and the fields that actually
 *  changed. A unit can land a tier and still have no changes at all, when
 *  every enabled field is missing or not numeric for it. It is still listed so
 *  the preview accounts for every unit the scope named. */
export interface RandomModRow {
  unit: string;
  tier: string;
  changes: RandomModChange[];
}

/** The whole plan: one row per unit named in `unitKeys`, in that order. */
export function planRandomMod(
  unitKeys: readonly string[],
  units: Record<string, Record<string, unknown> | undefined>,
  rules: RandomModRules,
): RandomModRow[] {
  return unitKeys.map((unit): RandomModRow => {
    // Seeded off the unit's own key rather than a shared stream, so the scope
    // can grow or shrink without moving anyone else's roll (issue #1318's
    // reproducibility guarantee).
    const rng = mulberry32(hashString(`${rules.seed}:${unit}`));
    const tier = pickTier(rng, rules.tierWeights);
    const changes: RandomModChange[] = [];
    for (const field of RANDOM_FIELDS) {
      if (!rules.fields.includes(field.id)) continue;
      // Drawn even when the field turns out to be missing or non-numeric, so
      // a later field in the fixed order still draws from the same point in
      // the stream regardless of what this unit happens to declare.
      const factor = tier.factorMin + rng() * (tier.factorMax - tier.factorMin);
      const resolved = resolveField(field.id);
      if (!resolved.ok) continue;
      const found = findField(units[unit], undefined, resolved.keys);
      if (!found) continue;
      const before = toNumber(found.raw);
      if (before === undefined || before <= 0) continue;
      const after = Math.max(MIN_RESULT, Math.round(before * factor));
      if (after === before) continue;
      changes.push({ field: field.id, path: found.path, before, after });
    }
    return { unit, tier: tier.id, changes };
  });
}

/** Pick a tier by weighted roll. Falls back to the first tier in the ladder
 *  when every weight is 0 or less, rather than dividing by zero: a generator
 *  configured to pick nothing still has to pick something. */
function pickTier(rng: () => number, weights: TierWeights): RarityTier {
  const weighted = RARITY_TIERS.map((tier) => ({
    tier,
    weight: Math.max(0, weights[tier.id] ?? 0),
  }));
  const total = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (total <= 0) return RARITY_TIERS[0];
  let roll = rng() * total;
  for (const { tier, weight } of weighted) {
    if (roll < weight) return tier;
    roll -= weight;
  }
  return weighted[weighted.length - 1].tier;
}

/** Write a plan's changes as overrides, as one pass so a caller folding this
 *  into `createProject` gets a project whose edits already hold every change,
 *  with no separate write step. There is nothing to compose over: a random mod
 *  always starts a fresh project, never edits one in place. */
export function applyRandomModPlan(
  rows: readonly RandomModRow[],
): UnitOverrides {
  let overrides: UnitOverrides = {};
  for (const row of rows) {
    for (const change of row.changes) {
      overrides = setOverride(
        overrides,
        row.unit,
        change.path,
        change.after,
        change.before,
      );
    }
  }
  return overrides;
}

/** How many units a plan actually changes something on, for the preview's
 *  "N of M units change" line. */
export function randomModChangeCount(rows: readonly RandomModRow[]): number {
  return rows.filter((row) => row.changes.length > 0).length;
}

/** A name nobody has to invent: the game, and the seed that reproduces it. */
export function randomModProjectName(gameName: string, seed: number): string {
  return `${gameName} random ${seed}`;
}

/** The seed and rules in words, for the project's description. Written so
 *  retyping the same values here reproduces the same mod (see this module's
 *  own doc comment for why that is a description rather than a stored
 *  recipe). */
export function describeRandomModRules(
  rules: RandomModRules,
  scope: RandomScope,
): string {
  const fieldLabels = RANDOM_FIELDS.filter((f) =>
    rules.fields.includes(f.id),
  ).map((f) => f.label);
  const tierText = RARITY_TIERS.map(
    (tier) => `${tier.label} ${rules.tierWeights[tier.id] ?? 0}`,
  ).join(", ");
  return [
    `Randomised units (seed ${rules.seed}).`,
    `Scope: ${describeRandomScope(scope)}.`,
    `Fields: ${fieldLabels.length > 0 ? fieldLabels.join(", ") : "none"}.`,
    `Tier weights: ${tierText}.`,
  ].join(" ");
}
