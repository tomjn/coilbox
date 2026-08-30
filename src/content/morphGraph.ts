import type { UnitDatasetEntry } from "./bindings";

/**
 * Grouping a unit's stages over the morph graph (issue #2063).
 *
 * A commander that upgrades through tech levels is one unit to the player and
 * five unrelated units to everything that reads `buildoptions`. These helpers
 * are how both coilbox and the hub turn the second into the first, and they are
 * vendored into the hub byte identical so the two group the same way by
 * construction rather than by agreement.
 *
 * Morph edges are a graph, not a chain. A unit morphs into either of two
 * things, a game loops back to where it started, and every walk here is cycle
 * guarded.
 */

/** One unit's stages, and which of them a reader is shown first. */
export interface MorphGroup {
  /** The stage the group is named and pictured with. */
  base: string;
  /** Every stage including the base, sorted, so the list is stable. */
  stages: string[];
}

/**
 * Lowercased adjacency map: unit internal name to what it morphs into. Edges to
 * a unit the dataset does not hold are dropped, matching `buildEdgeMap`: a
 * target naming a stripped def would otherwise invent a stage nobody can open.
 */
export function morphEdgeMap(units: UnitDatasetEntry[]): Map<string, string[]> {
  const known = new Set(units.map((u) => u.name.toLowerCase()));
  const edges = new Map<string, string[]>();
  for (const u of units) {
    const targets = (u.morphTargets ?? [])
      .map((m) => m.into?.toLowerCase())
      .filter((into): into is string => !!into && known.has(into));
    edges.set(u.name.toLowerCase(), [...new Set(targets)]);
  }
  return edges;
}

/**
 * Every group of units joined by morph edges, one per connected component.
 *
 * The walk is undirected. A branch means two stages share a parent and nothing
 * morphs one into the other, and they still belong together.
 *
 * The base is the stage nothing else in the group morphs into, which is what a
 * ladder's bottom rung looks like. Two of those means a game where two units
 * morph into one, and the first by name wins. None of them means a cycle, where
 * every stage has a parent, and the first by name wins there too. A rule that
 * always answers beats an exception, because the alternative is a group with no
 * name in a game nobody has looked at yet.
 *
 * Units with no morph edge at all are not groups. A group of one is a unit, and
 * a caller that has to check `length > 1` everywhere will forget somewhere.
 */
export function morphGroups(units: UnitDatasetEntry[]): MorphGroup[] {
  const edges = morphEdgeMap(units);
  const incoming = new Map<string, number>();
  const undirected = new Map<string, Set<string>>();
  for (const [from, targets] of edges) {
    for (const to of targets) {
      incoming.set(to, (incoming.get(to) ?? 0) + 1);
      if (!undirected.has(from)) undirected.set(from, new Set());
      if (!undirected.has(to)) undirected.set(to, new Set());
      undirected.get(from)?.add(to);
      undirected.get(to)?.add(from);
    }
  }

  const seen = new Set<string>();
  const groups: MorphGroup[] = [];
  for (const start of [...undirected.keys()].sort()) {
    if (seen.has(start)) continue;
    const stages: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: queue is non-empty in the loop
      const node = queue.shift()!;
      stages.push(node);
      for (const next of undirected.get(node) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    stages.sort();
    const base = stages.find((s) => !incoming.has(s)) ?? stages[0];
    groups.push({ base, stages });
  }
  return groups;
}

/** Every stage to the base of the group holding it, for a caller with an id in
 * hand and no interest in the group's shape. */
export function groupOf(groups: MorphGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const stage of group.stages) map.set(stage, group.base);
  }
  return map;
}
