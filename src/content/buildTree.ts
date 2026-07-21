import type { UnitDatasetEntry } from "./bindings";

/**
 * Reachability over a game's unit graph. A faction's units are those reachable
 * from its commander (start unit) through `buildoptions` edges — this is both the
 * build-tree viewer's node set and the per-faction count shown on the Sides cards.
 *
 * The dataset lowercases unit keys and their build options in the worker; these
 * helpers lowercase lookups too so the graph is case-insensitive throughout.
 */

/** Lowercased adjacency map: unit internal name -> its build options (lowercased). */
export function buildEdgeMap(units: UnitDatasetEntry[]): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  for (const u of units) {
    edges.set(
      u.name.toLowerCase(),
      (u.buildOptions ?? []).map((o) => o.toLowerCase()),
    );
  }
  return edges;
}

/**
 * The set of unit names reachable from `start` via `buildoptions` (BFS,
 * cycle-guarded). Edges are intersected with known nodes so a build option
 * pointing at a stripped/placeholder unit doesn't inflate the set. Returns an
 * empty set when `start` is falsy or absent from the graph.
 */
export function reachableFrom(
  start: string | undefined,
  edges: Map<string, string[]>,
): Set<string> {
  const seen = new Set<string>();
  const root = start?.toLowerCase();
  if (!root || !edges.has(root)) return seen;
  const queue = [root];
  seen.add(root);
  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue is non-empty in the loop
    const node = queue.shift()!;
    for (const next of edges.get(node) ?? []) {
      if (!seen.has(next) && edges.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * The build-tree focus set for `focused`: the unit itself, its build options
 * (what it builds, forward) and its builders (units whose build options include
 * it, reverse). One hop only — deliberately not transitive. Dangling options with
 * no matching node are dropped, matching `reachableFrom`. Returns just `{focused}`
 * when it has no neighbours, and an empty set when `focused` is falsy or absent
 * from the graph. Pure lookup over the existing edge map — a single focused unit
 * with no history, so a re-focus replaces rather than nests by construction.
 */
export function focusNeighbours(
  focused: string | undefined,
  edges: Map<string, string[]>,
): Set<string> {
  const target = focused?.toLowerCase();
  const set = new Set<string>();
  if (!target || !edges.has(target)) return set;
  set.add(target);
  // Forward: what the focused unit builds.
  for (const opt of edges.get(target) ?? []) {
    if (edges.has(opt)) set.add(opt);
  }
  // Reverse: units whose build options include the focused unit.
  for (const [name, options] of edges) {
    if (options.includes(target)) set.add(name);
  }
  return set;
}

/** One parent->child edge of the build graph. */
export interface TreeEdge {
  parent: string;
  child: string;
}

/**
 * The build graph of the units reachable from `start`, split into two layers:
 *  - `treeEdges`: a one-parent spanning tree (BFS assigns each unit to its
 *    *shallowest* builder), giving a clean layout backbone.
 *  - `extraEdges`: every other real builder→unit relationship (a unit's other
 *    builders, plus back-edges to ancestors) — the DAG edges the tree omits, so
 *    the graph stays truthful (a con-kbot really does build solar).
 * `order` is the reachable node set in BFS discovery order (root first).
 * Cycle-guarded; self-loops are dropped.
 */
export function buildBuildGraph(
  start: string | undefined,
  edges: Map<string, string[]>,
): { order: string[]; treeEdges: TreeEdge[]; extraEdges: TreeEdge[] } {
  const root = start?.toLowerCase();
  if (!root || !edges.has(root))
    return { order: [], treeEdges: [], extraEdges: [] };
  const seen = new Set<string>([root]);
  const order = [root];
  const treeEdges: TreeEdge[] = [];
  const queue = [root];
  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue is non-empty in the loop
    const node = queue.shift()!;
    for (const next of edges.get(node) ?? []) {
      if (!seen.has(next) && edges.has(next)) {
        seen.add(next);
        order.push(next);
        treeEdges.push({ parent: node, child: next });
        queue.push(next);
      }
    }
  }
  // Every reachable builder→unit edge that isn't the tree edge (and isn't a
  // self-loop), deduped — these are drawn faint and revealed on hover.
  const treeKeys = new Set(treeEdges.map((e) => `${e.parent}->${e.child}`));
  const extraKeys = new Set<string>();
  const extraEdges: TreeEdge[] = [];
  for (const node of order) {
    for (const next of edges.get(node) ?? []) {
      if (node === next || !seen.has(next)) continue;
      const key = `${node}->${next}`;
      if (treeKeys.has(key) || extraKeys.has(key)) continue;
      extraKeys.add(key);
      extraEdges.push({ parent: node, child: next });
    }
  }
  return { order, treeEdges, extraEdges };
}

/**
 * Per-side reachable-unit count, keyed by side name, for the Sides cards. Sides
 * with no/unknown start unit (or a start unit absent from the graph) map to 0.
 */
export function reachableCounts(
  sides: { name: string; startUnit?: string }[],
  edges: Map<string, string[]>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of sides) {
    counts.set(s.name, reachableFrom(s.startUnit, edges).size);
  }
  return counts;
}
