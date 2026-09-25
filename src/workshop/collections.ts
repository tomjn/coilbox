/**
 * A collection is a named set of units the project cares about together
 * (issue #2654): all tier two bots, every Cortex aircraft, the six units
 * somebody is balancing this week. Working on a group means being able to
 * name the group.
 *
 * Collections nest. A parent's own members are just the units listed on it.
 * What a parent *includes* is that list plus every unit any of its
 * descendants lists, resolved by {@link collectionUnits}. Nesting is a tree
 * rather than a DAG: a collection has at most one parent, so "include" can
 * never loop back on itself once {@link setCollectionParent}'s cycle guard has
 * run.
 *
 * Membership is two things, both resolved by {@link collectionUnits}. `units`
 * is an explicit list, the same sparse shape `disabled.ts` uses: lowercased,
 * de-duplicated and sorted, so two projects that added the same units in a
 * different order hold the same thing. `rule` is the second way in (issue
 * #2656): a `searchQuery.ts` predicate evaluated against the game's live
 * fields, so a collection can be "every unit cheaper than 200 metal" and stay
 * current as values change rather than needing to be rebuilt by hand. The two
 * are additive. A collection with both includes every unit either one names.
 * `rule` sits beside `units` rather than folding into it, the same way
 * `weapons` and `equipped` sit beside `overrides` instead of folding in.
 *
 * A project-wide store, one of the optional slots on `GameEdits` in
 * `project.ts`, absent for a project saved before this and read back as
 * empty.
 *
 * A rule's name terms (a bare word with no comparison) match a unit's key
 * only, not its display name, because this module is pure and has no `nameOf`
 * to call. The unit list's own search box matches both, so a rule and a typed
 * search can disagree about a plain word.
 */
import type { UnitClones } from "./clones";
import type { UnitDerivedStats } from "./derivedStats";
import { resolvedDef, type UnitOverrides } from "./overrides";
import {
  evaluateUnitQuery,
  parseUnitQuery,
  queryNeedsDerivedFields,
} from "./searchQuery";
import { unitEffectiveDerivedStats } from "./unitWeapons";
import type { EquippedWeapons, WeaponLibrary } from "./weaponLibrary";

/** A single named set of units, nestable under another collection. */
export interface Collection {
  /** Stable identity, because two collections may share a name. */
  id: string;
  name: string;
  /** The collection this one nests under, or absent for a top level one. */
  parentId?: string;
  /** This collection's own members, as lowercased def keys, sorted. What a
   *  parent *includes* is this list plus every descendant's, resolved by
   *  {@link collectionUnits}. */
  units: string[];
  /** A `searchQuery.ts` predicate, matched against every unit in the game
   *  (issue #2656). A unit belongs to this collection if it is in `units`,
   *  matches `rule`, or both. Absent for a collection with no rule, the same
   *  way a project saved before this reads back with none. A rule that fails
   *  to parse (an import from a build that allowed something this one does
   *  not, or a game whose fields moved) matches nothing rather than
   *  throwing. */
  rule?: string;
}

/** Every collection in the project, by id. */
export type Collections = Record<string, Collection>;

/** A project with no collections. Shared, the way `EMPTY_ARMOR_CLASSES` is. */
export const EMPTY_COLLECTIONS: Collections = {};

/** Lowercased and trimmed, or empty for anything that is not a usable key. */
function unitKey(unit: string): string {
  return unit.trim().toLowerCase();
}

/** Create a collection under `parentId`, and return its id alongside the
 *  updated set so the caller can select what it just made. `parentId` must
 *  already be a collection in `collections`, or the new one is created at the
 *  top level instead of pointing at nothing. */
export function createCollection(
  collections: Collections,
  name: string,
  parentId?: string,
): { collections: Collections; id: string } {
  const id = crypto.randomUUID();
  const trimmed = name.trim();
  const parent =
    parentId && Object.hasOwn(collections, parentId) ? parentId : undefined;
  const collection: Collection = {
    id,
    name: trimmed || "Unnamed collection",
    ...(parent ? { parentId: parent } : {}),
    units: [],
  };
  return { collections: { ...collections, [id]: collection }, id };
}

/** Rename a collection. Returns `collections` unchanged for a blank name or
 *  an id it does not hold, the same way `updateProjectDetails` leaves a blank
 *  name alone rather than saving it. */
export function renameCollection(
  collections: Collections,
  id: string,
  name: string,
): Collections {
  const trimmed = name.trim();
  const target = collections[id];
  if (!target || !trimmed || target.name === trimmed) return collections;
  return { ...collections, [id]: { ...target, name: trimmed } };
}

/** Every descendant of `id`, including `id` itself, as a set of ids. Used by
 *  the cycle guard in {@link setCollectionParent} and by
 *  {@link removeCollection} to find who to re-parent. */
function selfAndDescendantIds(
  collections: Collections,
  id: string,
): Set<string> {
  const out = new Set<string>([id]);
  // A flat scan repeated until nothing new is found, rather than a recursive
  // walk down `parentId` links: a collection only ever names its own parent,
  // never its children, so finding children means asking every collection
  // whether it points at one already in the set.
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of Object.values(collections)) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Move a collection under a new parent, or to the top level when `parentId`
 *  is undefined. Refuses a move that would make a collection its own
 *  ancestor, returning `collections` unchanged, since that is the one shape
 *  that would turn {@link collectionUnits}'s walk down the tree into a loop. */
export function setCollectionParent(
  collections: Collections,
  id: string,
  parentId: string | undefined,
): Collections {
  const target = collections[id];
  if (!target) return collections;
  if (parentId === id) return collections;
  if (parentId && !Object.hasOwn(collections, parentId)) return collections;
  if (parentId && selfAndDescendantIds(collections, id).has(parentId))
    return collections;
  if (target.parentId === parentId) return collections;
  const { parentId: _dropped, ...rest } = target;
  return {
    ...collections,
    [id]: parentId ? { ...rest, parentId } : rest,
  };
}

/** Set or clear a collection's rule. An all-whitespace `rule` clears it
 *  rather than storing an empty predicate, the same way {@link
 *  renameCollection} treats a blank name. Returns `collections` unchanged
 *  when nothing would change. */
export function setCollectionRule(
  collections: Collections,
  id: string,
  rule: string,
): Collections {
  const target = collections[id];
  if (!target) return collections;
  const trimmed = rule.trim();
  if ((target.rule ?? "") === trimmed) return collections;
  if (!trimmed) {
    const { rule: _dropped, ...rest } = target;
    return { ...collections, [id]: rest };
  }
  return { ...collections, [id]: { ...target, rule: trimmed } };
}

/** Remove a collection. Its own children are re-parented to whatever it was
 *  nested under, rather than removed with it. Deleting a folder should not
 *  throw away what was inside it, and a child's own membership is untouched
 *  either way. */
export function removeCollection(
  collections: Collections,
  id: string,
): Collections {
  const target = collections[id];
  if (!target) return collections;
  const { [id]: _gone, ...rest } = collections;
  const out: Collections = {};
  for (const [key, c] of Object.entries(rest)) {
    if (c.parentId !== id) {
      out[key] = c;
      continue;
    }
    if (target.parentId) {
      out[key] = { ...c, parentId: target.parentId };
    } else {
      const { parentId: _p, ...withoutParent } = c;
      out[key] = withoutParent;
    }
  }
  return out;
}

/** Add or remove a unit from a collection's own membership. Returns
 *  `collections` unchanged when nothing would change, the way `setUnitDisabled`
 *  does, so an edit that says nothing costs no undo step. */
export function setCollectionMembership(
  collections: Collections,
  id: string,
  unit: string,
  member: boolean,
): Collections {
  const target = collections[id];
  const key = unitKey(unit);
  if (!target || !key) return collections;
  const has = target.units.includes(key);
  if (has === member) return collections;
  const units = member
    ? [...target.units, key].sort()
    : target.units.filter((u) => u !== key);
  return { ...collections, [id]: { ...target, units } };
}

/** The game's units, live, needed to resolve a rule-based collection into a
 *  concrete set. Optional on {@link collectionUnits}: a caller that has not
 *  got the game's own def table handy leaves it out, in which case a rule
 *  matches nothing rather than the caller crashing for want of it. */
export interface LiveUnits {
  /** The game's units with the project's own clones already in among them,
   *  the same table `UnitList`'s own `units` prop takes. */
  units: Record<string, Record<string, unknown>>;
  overrides: UnitOverrides;
  /** What a rule needs to answer a `derivedStats.ts` number (issue #3074):
   *  the same weapon resolution the unit editor and the reference table use
   *  (`unitWeapons.ts`). Absent, a rule naming a derived field matches
   *  nothing rather than the resolver crashing for want of it, the same as a
   *  rule that fails to parse. */
  weapons?: {
    weaponDefs: Record<string, Record<string, unknown>>;
    library: WeaponLibrary;
    equipped: EquippedWeapons;
    clones: UnitClones;
  };
}

/** Every unit `id` includes: its own members plus every descendant's, plus
 *  every unit any of them matches by rule when `live` is given. `undefined`
 *  for an id the project holds no collection for, so a stale reference (a
 *  collection deleted out from under a selector still holding its id)
 *  resolves to nothing rather than to the wrong thing. */
export function collectionUnits(
  collections: Collections,
  id: string,
  live?: LiveUnits,
): Set<string> | undefined {
  if (!Object.hasOwn(collections, id)) return undefined;
  const ids = selfAndDescendantIds(collections, id);
  const out = new Set<string>();
  for (const memberId of ids) {
    const collection = collections[memberId];
    for (const unit of collection?.units ?? []) out.add(unit);
    if (!collection?.rule || !live) continue;
    const parsed = parseUnitQuery(collection.rule);
    if (!parsed.ok) continue;
    const weapons = live.weapons;
    const derivedCache = new Map<string, UnitDerivedStats>();
    const derivedFor =
      weapons && queryNeedsDerivedFields(parsed.query)
        ? (key: string, def: Record<string, unknown>): UnitDerivedStats => {
            const cached = derivedCache.get(key);
            if (cached) return cached;
            const cloneSource = weapons.clones[key]?.source;
            const owners = cloneSource ? [key, cloneSource] : [key];
            const resolved = resolvedDef(def, live.overrides[key]);
            const stats = unitEffectiveDerivedStats(
              { def: resolved },
              weapons.weaponDefs,
              owners,
              weapons.library,
              weapons.equipped[key],
            );
            derivedCache.set(key, stats);
            return stats;
          }
        : undefined;
    for (const [key, def] of Object.entries(live.units)) {
      if (out.has(key)) continue;
      if (
        evaluateUnitQuery(parsed.query, {
          key,
          name: key,
          def,
          overrides: live.overrides[key],
          derived: derivedFor ? () => derivedFor(key, def) : undefined,
        })
      ) {
        out.add(key);
      }
    }
  }
  return out;
}

/** One collection as a tree listing draws it: itself, and how deep it sits
 *  under its ancestors. */
export interface CollectionNode {
  collection: Collection;
  depth: number;
}

/** Every collection, depth first and alphabetical among siblings, for a list
 *  or a picker that wants to show nesting with indentation. A collection
 *  whose `parentId` names one this set does not hold (an import that dropped
 *  the parent, or a parent removed some other way) is treated as top level
 *  rather than left out, so nothing in the project silently disappears from
 *  the list. */
export function collectionTree(collections: Collections): CollectionNode[] {
  const childrenOf = new Map<string | undefined, Collection[]>();
  for (const c of Object.values(collections)) {
    const parent =
      c.parentId && Object.hasOwn(collections, c.parentId)
        ? c.parentId
        : undefined;
    const list = childrenOf.get(parent) ?? [];
    list.push(c);
    childrenOf.set(parent, list);
  }
  for (const list of childrenOf.values())
    list.sort((a, b) => a.name.localeCompare(b.name));

  const out: CollectionNode[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const c of childrenOf.get(parent) ?? []) {
      out.push({ collection: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

/** How many collections the project has defined, for `editCounts`. */
export function collectionCount(collections: Collections | undefined): number {
  return Object.keys(collections ?? {}).length;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Lowercased, de-duplicated and sorted unit keys, dropping anything that is
 *  not a usable string. Mirrors `parseDisabled` in `project.ts`. */
function parseUnitKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const key = unitKey(entry);
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

/** Read `Collections` out of untrusted JSON, dropping anything it cannot use.
 *  A project saved before this reads back as {@link EMPTY_COLLECTIONS}. A
 *  `parentId` that does not resolve to another entry in the same payload is
 *  kept rather than dropped. {@link collectionTree} already treats an
 *  unresolved parent as top level, so nothing here needs to repeat that. */
export function parseCollections(value: unknown): Collections {
  if (!isRecord(value)) return EMPTY_COLLECTIONS;
  const out: Collections = {};
  for (const [id, raw] of Object.entries(value)) {
    const entry = isRecord(raw) ? raw : undefined;
    if (!entry || typeof entry.name !== "string" || !entry.name.trim())
      continue;
    out[id] = {
      id,
      name: entry.name.trim(),
      ...(typeof entry.parentId === "string" && entry.parentId
        ? { parentId: entry.parentId }
        : {}),
      units: parseUnitKeys(entry.units),
      ...(typeof entry.rule === "string" && entry.rule.trim()
        ? { rule: entry.rule.trim() }
        : {}),
    };
  }
  return out;
}

/**
 * Filter a project's edits down to what touches `keep`, for restricting an
 * export to one collection's units (issue #2654).
 *
 * Every store keyed by unit is filtered to `keep`. `weapons` (the project's
 * library) and `explosionGenerators` are project wide rather than per unit
 * and are left as they are. `armorClasses.base` is the snapshot the compiler
 * needs to write the whole armour file and is kept whole, only its own
 * `moves` being filtered. `collections` itself is dropped, since a restricted
 * export is a smaller edit set for the compiler, not a smaller project to
 * reopen.
 */
export function restrictEditsToUnits<
  T extends {
    overrides: Record<string, unknown>;
    clones: Record<string, unknown>;
    menus: Record<string, unknown>;
    text: Record<string, unknown>;
    disabled: string[];
    weapons?: Record<string, unknown>;
    equipped?: Record<string, unknown>;
    armorClasses?: {
      base: Record<string, string[]>;
      moves: Record<string, string>;
    };
    explosionGenerators?: Record<string, unknown>;
  },
>(edits: T, keep: ReadonlySet<string>): T {
  const filterRecord = <V>(
    rec: Record<string, V> | undefined,
  ): Record<string, V> => {
    const out: Record<string, V> = {};
    for (const [key, value] of Object.entries(rec ?? {})) {
      if (keep.has(unitKey(key))) out[key] = value;
    }
    return out;
  };
  return {
    ...edits,
    overrides: filterRecord(edits.overrides),
    clones: filterRecord(edits.clones),
    menus: filterRecord(edits.menus),
    text: filterRecord(edits.text),
    disabled: edits.disabled.filter((u) => keep.has(unitKey(u))),
    equipped: filterRecord(edits.equipped),
    armorClasses: edits.armorClasses
      ? {
          base: edits.armorClasses.base,
          moves: filterRecord(edits.armorClasses.moves),
        }
      : edits.armorClasses,
  };
}
