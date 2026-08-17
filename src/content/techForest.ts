import type { UnitDatasetEntry } from "./bindings";
import { buildEdgeMap } from "./buildTree";

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

/** Which faction can build each unit, over the game's build graph. */
export interface TechForest {
  /** Root ids (start units present in the dataset), in the order given. */
  roots: string[];
  /** Unit id to the root that reaches it, so the picker can group by faction.
   * A root maps to itself. Units no root reaches are absent. */
  factionOf: Map<string, string>;
  /** Known unit ids no root reaches, so nothing is hidden. Sorted. */
  ungrouped: string[];
  /** Every known unit id (lowercased). */
  known: Set<string>;
}

/**
 * Work out which faction reaches each unit. A single multi-source BFS seeds
 * every root first, then assigns each other unit to the first root that reaches
 * it. Dangling build options (edges to unknown units) are dropped.
 *
 * This is a grouping, not a hierarchy. The picker used to render the same walk
 * as a spanning tree, which forced a graph into one parent per unit: a unit two
 * builders make appeared under whichever the search hit first, so a builder's
 * row showed an arbitrary subset of what it builds, and the units it lost were
 * invisible (#1051). Two factions that share a unit still have to put it
 * somewhere, but a faction heading claims far less than an indent does.
 */
export function buildTechForest(
  units: UnitDatasetEntry[],
  roots: string[],
): TechForest {
  const edges = buildEdgeMap(units);
  const known = new Set(units.map((u) => u.name.toLowerCase()));

  const rootIds: string[] = [];
  const factionOf = new Map<string, string>();
  for (const r of roots) {
    const id = r?.toLowerCase();
    if (id && known.has(id) && !factionOf.has(id)) {
      factionOf.set(id, id);
      rootIds.push(id);
    }
  }

  const queue = rootIds.map((id) => [id, id] as const);
  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue is non-empty in the loop
    const [node, root] = queue.shift()!;
    for (const next of edges.get(node) ?? []) {
      if (factionOf.has(next) || !known.has(next)) continue;
      factionOf.set(next, root);
      queue.push([next, root]);
    }
  }

  const ungrouped = [...known].filter((id) => !factionOf.has(id)).sort();

  return { roots: rootIds, factionOf, ungrouped, known };
}

/** A faction's units, as one flat block of the picker's list. */
export interface UnitGroup {
  /** The root unit id, or `""` for the units no faction reaches. */
  id: string;
  /** Heading for the block. */
  label: string;
  /** Unit ids, sorted by the name the reader sees. */
  units: string[];
}

/**
 * The picker's whole list: one block per faction in root order, then whatever no
 * faction builds, each sorted by unit name. `label` names a unit, `heading` names
 * a faction, and `match` filters units (the search). Empty blocks are dropped.
 */
export function factionGroups(
  forest: TechForest,
  ids: Iterable<string>,
  label: (id: string) => string,
  heading: (rootId: string) => string,
  match: (id: string) => boolean = () => true,
): UnitGroup[] {
  // `ids` is what to lay out, which is not always the whole game: a blueprint
  // field offers only buildings, and a warpath only one faction's units. The
  // forest still comes from the full dataset, because which faction builds a
  // unit is the game's answer and a filtered list cannot give it.
  const byRoot = new Map<string, string[]>(forest.roots.map((r) => [r, []]));
  const rest: string[] = [];
  for (const raw of ids) {
    const id = raw.toLowerCase();
    if (!match(id)) continue;
    const root = forest.factionOf.get(id);
    if (root && byRoot.has(root)) byRoot.get(root)?.push(id);
    else rest.push(id);
  }
  const byName = (a: string, b: string) =>
    label(a).localeCompare(label(b)) || a.localeCompare(b);
  const groups: UnitGroup[] = forest.roots.map((root) => ({
    id: root,
    label: heading(root),
    units: (byRoot.get(root) ?? []).sort(byName),
  }));
  if (rest.length > 0) {
    groups.push({ id: "", label: "Other units", units: rest.sort(byName) });
  }
  return groups.filter((g) => g.units.length > 0);
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
