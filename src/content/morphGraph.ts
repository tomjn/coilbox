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
 * Every group of units joined by folding morph edges, one per connected
 * component (issue #3463).
 *
 * A morph edge folds its target into its source only when the target is a
 * later form of the source and not a unit in its own right. That is when
 * nothing in the dataset has the target in its build options and exactly one
 * unit morphs into it. Every other morph edge is a relationship between two
 * separate units, and neither is hidden inside the other. A commander's upgrade
 * levels still fold, because nothing builds them and each has one parent.
 *
 * The walk is undirected over folding edges. A branch means two stages share a
 * parent and nothing morphs one into the other, and they still belong together.
 *
 * Each stage has at most one folding edge into it, so a group has one stage
 * nothing else in it morphs into, which is what a ladder's bottom rung looks
 * like, and that is the base. A cycle has no such stage, where every stage has
 * a parent, and the first by name wins. A rule that always answers beats an
 * exception, because the alternative is a group with no name in a game nobody
 * has looked at yet.
 *
 * Units with no folding edge at all are not groups. A group of one is a unit,
 * and a caller that has to check `length > 1` everywhere will forget somewhere.
 */
export function morphGroups(units: UnitDatasetEntry[]): MorphGroup[] {
  const edges = morphEdgeMap(units);

  // Built means some unit in the dataset lists it in `buildOptions`, which is
  // what `buildEdgeMap` (`buildTree.ts`) holds. Read from `units` directly so
  // this file stays free of imports the hub does not have.
  const built = new Set<string>();
  for (const u of units) {
    for (const option of u.buildOptions ?? []) built.add(option.toLowerCase());
  }
  const parents = new Map<string, number>();
  for (const [from, targets] of edges) {
    for (const to of targets) {
      if (to !== from) parents.set(to, (parents.get(to) ?? 0) + 1);
    }
  }

  const incoming = new Map<string, number>();
  const undirected = new Map<string, Set<string>>();
  for (const [from, targets] of edges) {
    for (const to of targets) {
      if (to === from || built.has(to) || parents.get(to) !== 1) continue;
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

/**
 * The build edge map with each morph group collapsed onto its base: what any
 * stage builds is what the unit builds, and no stage is a node of its own.
 *
 * This is the whole of "one node in the tree". A level that unlocks a new build
 * option folds it into the same node rather than starting a second subtree, and
 * an edge that pointed at a stage is redirected to the stage's base, so nothing
 * dangles.
 */
export function foldMorphs(
  units: UnitDatasetEntry[],
  edges: Map<string, string[]>,
): Map<string, string[]> {
  const base = groupOf(morphGroups(units));
  const at = (id: string) => base.get(id) ?? id;
  const folded = new Map<string, Set<string>>();
  for (const [from, targets] of edges) {
    const parent = at(from);
    if (!folded.has(parent)) folded.set(parent, new Set());
    for (const to of targets) {
      const child = at(to);
      // A stage building its own next stage is the group building itself.
      if (child !== parent) folded.get(parent)?.add(child);
    }
  }
  return new Map([...folded].map(([k, v]) => [k, [...v].sort()]));
}
