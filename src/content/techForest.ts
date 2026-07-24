import type { UnitDatasetEntry } from "./bindings";
import { buildEdgeMap, reachableFrom } from "./buildTree";

/**
 * Shared build-graph model for the tech-tree picker. Turns a game's unit dataset
 * (units + `buildoptions` edges) into a spanning forest rooted at faction start
 * units, plus pure selection helpers that operate on a flat id set, the shape
 * every consumer stores (a campaign mission's `disabledUnits`, a battle preset's
 * `disabledUnits`, a warpath's `unlockedUnits`).
 *
 * The picker is polarity-neutral. "Selected" just means "in the set". A
 * restrictions editor treats selected as disabled units, the warpath viewer
 * treats it as unlocked units. Ids are lowercased throughout to match the
 * worker's dataset (unit def keys are lowercase), so lookups are case-insensitive.
 */

/** A spanning forest over the build graph, rooted at faction start units. */
export interface TechForest {
  /** Root ids (start units present in the dataset), in the order given. */
  roots: string[];
  /** Spanning-tree children per unit id (each unit has one parent, so appears
   * once in the forest). Sorted for stable rendering. */
  childrenOf: Map<string, string[]>;
  /** Known unit ids not reachable from any root, so nothing is hidden. Sorted. */
  ungrouped: string[];
  /** Ids that build at least one known unit (drives the subtree affordance). */
  builders: Set<string>;
  /** The full lowercased edge map, for transitive subtree operations. */
  edges: Map<string, string[]>;
  /** Every known unit id (lowercased). */
  known: Set<string>;
}

/**
 * Build the spanning forest. A single multi-source BFS seeds every root first
 * (so a root reachable from another stays top-level), then assigns each other
 * unit to the first root/parent that reaches it. A unit shared by two factions
 * appears once, under whichever root's BFS found it first, rather than
 * duplicating. Dangling build options (edges to unknown units) are dropped.
 */
export function buildTechForest(
  units: UnitDatasetEntry[],
  roots: string[],
): TechForest {
  const edges = buildEdgeMap(units);
  const known = new Set(units.map((u) => u.name.toLowerCase()));

  const rootIds: string[] = [];
  const seen = new Set<string>();
  for (const r of roots) {
    const id = r?.toLowerCase();
    if (id && known.has(id) && !seen.has(id)) {
      seen.add(id);
      rootIds.push(id);
    }
  }

  const childrenOf = new Map<string, string[]>();
  const queue = [...rootIds];
  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue is non-empty in the loop
    const node = queue.shift()!;
    for (const next of edges.get(node) ?? []) {
      if (next === node || seen.has(next) || !known.has(next)) continue;
      seen.add(next);
      const kids = childrenOf.get(node) ?? [];
      kids.push(next);
      childrenOf.set(node, kids);
      queue.push(next);
    }
  }
  for (const [k, v] of childrenOf) childrenOf.set(k, v.sort());

  const ungrouped = [...known].filter((id) => !seen.has(id)).sort();

  const builders = new Set<string>();
  for (const [id, opts] of edges) {
    if (opts.some((o) => known.has(o))) builders.add(id);
  }

  return { roots: rootIds, childrenOf, ungrouped, builders, edges, known };
}

/** The unit itself plus every unit reachable from it via `buildoptions`
 * (transitive, cycle-guarded), the "whole subtree" for a subtree toggle.
 * Follows every real build edge, not just the spanning tree. */
export function subtreeOf(
  unit: string,
  edges: Map<string, string[]>,
): Set<string> {
  return reachableFrom(unit, edges);
}

/** True when `id` is in `selected`, case-insensitively. */
export function isSelected(selected: string[], id: string): boolean {
  const lower = id.toLowerCase();
  return selected.some((s) => s.toLowerCase() === lower);
}

/**
 * Add or remove one unit from the selected set. Adds the lowercased id (matching
 * the stored dataset form). Removing drops any entry matching case-insensitively,
 * so a differently-cased legacy value is still cleared. Returns the same array
 * reference when nothing changes, so callers can skip a no-op `onChange`.
 */
export function toggleUnit(
  selected: string[],
  unit: string,
  on: boolean,
): string[] {
  const lower = unit.toLowerCase();
  const has = isSelected(selected, unit);
  if (on) {
    return has ? selected : [...selected, lower];
  }
  return has ? selected.filter((s) => s.toLowerCase() !== lower) : selected;
}

/**
 * Add or remove a unit and its whole subtree ({@link subtreeOf}) from the
 * selected set in one operation. When adding, appends any subtree ids not
 * already present (preserving existing entries and their order). When removing,
 * drops every subtree id, case-insensitively. Returns the same array reference
 * when nothing changes.
 */
export function toggleSubtree(
  selected: string[],
  unit: string,
  edges: Map<string, string[]>,
  on: boolean,
): string[] {
  const sub = subtreeOf(unit, edges);
  if (sub.size === 0) return toggleUnit(selected, unit, on);
  if (on) {
    const present = new Set(selected.map((s) => s.toLowerCase()));
    const additions = [...sub].filter((id) => !present.has(id));
    return additions.length > 0 ? [...selected, ...additions] : selected;
  }
  const next = selected.filter((s) => !sub.has(s.toLowerCase()));
  return next.length === selected.length ? selected : next;
}

/** How much of a unit's subtree is selected: "none", "all", or "some", for a
 * tri-state subtree toggle. A leaf (empty subtree) reports on its own state. */
export function subtreeState(
  selected: string[],
  unit: string,
  edges: Map<string, string[]>,
): "none" | "some" | "all" {
  const sub = subtreeOf(unit, edges);
  if (sub.size === 0) return isSelected(selected, unit) ? "all" : "none";
  const chosen = new Set(selected.map((s) => s.toLowerCase()));
  let count = 0;
  for (const id of sub) if (chosen.has(id)) count++;
  if (count === 0) return "none";
  return count === sub.size ? "all" : "some";
}

/**
 * Selected ids that aren't in the current game's dataset: a stored restriction
 * or unlock for a unit that no longer exists (renamed, removed, or from another
 * game). Surfaced separately so they're shown as "unknown" rather than dropped
 * silently. Returned in their original stored form and order.
 */
export function unknownSelected(
  selected: string[],
  known: Set<string>,
): string[] {
  return selected.filter((s) => !known.has(s.toLowerCase()));
}
