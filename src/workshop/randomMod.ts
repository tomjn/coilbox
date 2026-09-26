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
 * mutator or tweak slots, so none of that needed to change.
 *
 * Reproducibility is the seed plus the rules: given the same unit defs, the
 * same seed and the same rules always produce the same overrides, checked by
 * a golden test below. The project's description still records the seed and
 * rules in words, but a project made this way also keeps a `RandomModRecipe`
 * of its own (issue #3090), which is what the "Regenerate" button on the
 * project's page reopens the drawer from, and what a share carries so the
 * person who receives it can regenerate too. {@link recipeOverrides},
 * {@link handEditedOverrides} and {@link regeneratedOverrides} are the three
 * functions that let a regenerate replace what the last run wrote without
 * touching a field somebody has since edited by hand.
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
import { sameValue, setOverride, type UnitOverrides } from "./overrides";
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
 *  retyping the same values here reproduces the same mod even without the
 *  stored recipe below. */
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

/**
 * A recipe's scope as stored on a project (issue #3090).
 *
 * A live {@link RandomScope}'s `collection` variant embeds the whole
 * `Collections` table, which is fine for a form that is about to plan against
 * it once and close. A recipe outlives that: it sits on the project between
 * visits and travels with a share, so it names the collection's own project
 * and id instead of copying the table, the same way `mutatorOnly` names
 * fields rather than duplicating the def they came from.
 */
export type RandomRecipeScope =
  | { kind: "all" }
  | { kind: "query"; query: string }
  | { kind: "collection"; sourceProjectId: string; collectionId: string };

/**
 * A project's recipe: everything {@link RandomModRules} holds, plus the scope,
 * so a project made by the generator can be regenerated without retyping what
 * was picked (issue #3090). Optional on the project, the same way
 * `mutatorOnly` is: a project nobody ever ran the generator on has none.
 */
export interface RandomModRecipe {
  seed: number;
  scope: RandomRecipeScope;
  fields: readonly string[];
  tierWeights: TierWeights;
}

/**
 * A stored scope resolved back to a live one, against whichever project
 * `projects` says defined the collection it names. A collection whose project
 * is missing - deleted on this machine, or never received on one a shared
 * recipe landed on - resolves to an empty collection table, which
 * {@link resolveRandomScope} already reads as "no such collection" for a bad
 * id, rather than throwing.
 */
export function resolveRandomRecipeScope(
  scope: RandomRecipeScope,
  projects: readonly { id: string; edits: { collections?: Collections } }[],
): RandomScope {
  if (scope.kind !== "collection") return scope;
  const source = projects.find((p) => p.id === scope.sourceProjectId);
  return {
    kind: "collection",
    collections: source?.edits.collections ?? {},
    collectionId: scope.collectionId,
  };
}

/**
 * The override set `recipe` alone would write against `units` today,
 * resolving its scope through `projects` the way
 * {@link resolveRandomRecipeScope} does. Read at regenerate time to tell a
 * generated field from a hand edit: a field equal to what this produces is
 * what the recipe wrote, anything else is something a person typed in
 * afterwards.
 */
export function recipeOverrides(
  recipe: RandomModRecipe,
  units: Record<string, Record<string, unknown> | undefined>,
  projects: readonly { id: string; edits: { collections?: Collections } }[],
): UnitOverrides {
  const scope = resolveRandomRecipeScope(recipe.scope, projects);
  const unitKeys = resolveRandomScope(scope, units);
  const rows = planRandomMod(unitKeys, units, recipe);
  return applyRandomModPlan(rows);
}

/**
 * Every field in `overrides` that is not what `generated` holds for it: the
 * recipe never wrote it, wrote something else there, or no longer scopes
 * that unit at all. This is what a regenerate must never touch (issue
 * #3090's "do not silently discard a hand edit").
 */
export function handEditedOverrides(
  overrides: UnitOverrides,
  generated: UnitOverrides,
): UnitOverrides {
  const out: UnitOverrides = {};
  for (const [unit, fields] of Object.entries(overrides)) {
    for (const [path, value] of Object.entries(fields)) {
      if (sameValue(generated[unit]?.[path], value)) continue;
      out[unit] = { ...out[unit], [path]: value };
    }
  }
  return out;
}

/**
 * Replace a project's generated changes with a fresh plan, keeping every
 * field a person edited by hand since the last generation (issue #3090).
 *
 * `oldGenerated` is what the project's previous recipe would still write
 * today, from {@link recipeOverrides}. Everything in `overrides` equal to it
 * is what that run wrote and nobody has touched since, so it is dropped in
 * favour of `newRows`. Everything else - a field the old recipe never wrote,
 * or a value someone typed over it - is kept exactly as it stands, even where
 * the new plan would also touch that field: a hand edit always wins over a
 * regenerate.
 */
export function regeneratedOverrides(
  overrides: UnitOverrides,
  oldGenerated: UnitOverrides,
  newRows: readonly RandomModRow[],
): UnitOverrides {
  const kept = handEditedOverrides(overrides, oldGenerated);
  let next: UnitOverrides = {};
  for (const [unit, fields] of Object.entries(kept)) next[unit] = { ...fields };
  for (const row of newRows) {
    for (const change of row.changes) {
      if (kept[row.unit] && Object.hasOwn(kept[row.unit], change.path))
        continue;
      next = setOverride(
        next,
        row.unit,
        change.path,
        change.after,
        change.before,
      );
    }
  }
  return next;
}
