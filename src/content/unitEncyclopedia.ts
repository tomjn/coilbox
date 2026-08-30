import type { UnitDatasetEntry } from "./bindings";
import { groupOf, morphGroups } from "./morphGraph";
import { buildTechForest, factionGroups } from "./techForest";

/**
 * The encyclopedia grid's model: which units a game has, grouped the way a
 * reader looks for them. Designed in
 * `docs/superpowers/specs/2026-08-31-game-unit-encyclopedia-design.md`.
 *
 * Kept apart from `techForest.ts`, which is the unit picker's model. The two
 * read the same graph helpers and answer different questions, and a shared file
 * would grow both concerns.
 */

/** One cell of the grid: a unit, plus the stages folded into it. */
export interface UnitCell {
  /** The def key the cell links to: a morph group's base, or the unit itself. */
  id: string;
  /** The name a reader sees, falling back to the def key. */
  label: string;
  /** How many stages are folded in, excluding the base, so it matches the
   * count the build tree and the unit picker already show. */
  upgrades: number;
  /** The folded stage ids, excluding the base. Empty for a unit that morphs
   * nowhere. Search reaches these, which is how a pasted def key finds a unit
   * that has no cell of its own. */
  stages: string[];
}

/** One block of the grid: a faction, or the units no faction reaches. */
export interface UnitSection {
  /** The root unit id, or `""` for the block nothing reaches. */
  id: string;
  label: string;
  cells: UnitCell[];
}

/** The name a reader sees for a unit, falling back to its def key. A game that
 * names nothing still has to be readable. */
export function unitLabel(
  unit: UnitDatasetEntry | undefined,
  id: string,
): string {
  const full = unit?.fullName?.trim();
  return full && full.length > 0 ? full : id;
}

/**
 * The grid, grouped by faction with a unit's morph stages folded into one cell.
 *
 * `roots` is the game's start units with the faction names to head their
 * blocks, exactly as the engine reports them: a `startUnit` can name any stage
 * of its morph group, not just the base, and this resolves each one to its
 * group's base before the build graph is walked, so a caller does not have to
 * do that itself. `buildTechForest` walks morph edges forward only, so a root
 * left as a later stage would never reach the base stage backwards, and the
 * faction's own commander would fall out of its own block. A root the dataset
 * does not hold is dropped by `buildTechForest`, so a game whose sides could
 * not be read degrades to one block of everything rather than to nothing.
 *
 * A cell matches the search when its own def key matches, when the name a
 * reader sees matches, or when one of its folded stages' def keys matches. The
 * third is the one people notice: a def key pasted out of a mission file, a
 * replay or a game's own config usually belongs to a stage, and a stage has no
 * cell to find.
 */
export function encyclopediaSections(
  units: UnitDatasetEntry[],
  roots: { id: string; label: string }[],
  query: string,
): UnitSection[] {
  const byId = new Map(units.map((u) => [u.name.toLowerCase(), u]));

  // Computed once and reused for both root resolution and folding stages
  // below: `buildTechForest` needs the roots already resolved to their base
  // before it runs, so its own identical `forest.morphBase` isn't available
  // yet at this point.
  const base = groupOf(morphGroups(units));
  const resolvedRoots = roots.map((r) => {
    const id = r.id.toLowerCase();
    return { id: base.get(id) ?? id, label: r.label };
  });

  const forest = buildTechForest(
    units,
    resolvedRoots.map((r) => r.id),
  );
  const headings = new Map(resolvedRoots.map((r) => [r.id, r.label]));

  const stagesOf = new Map<string, string[]>();
  for (const [stage, root] of base) {
    if (stage === root) continue;
    stagesOf.set(root, [...(stagesOf.get(root) ?? []), stage]);
  }

  // Only the id a cell stands for is laid out. A folded stage is reachable
  // through its base's cell rather than through one of its own.
  const cellIds = [...forest.known].filter((id) => (base.get(id) ?? id) === id);

  const q = query.trim().toLowerCase();
  const label = (id: string) => unitLabel(byId.get(id), id);
  const matches = (id: string) => {
    if (q.length === 0) return true;
    if (id.includes(q)) return true;
    if (label(id).toLowerCase().includes(q)) return true;
    return (stagesOf.get(id) ?? []).some((stage) => stage.includes(q));
  };

  return factionGroups(
    forest,
    cellIds,
    label,
    (rootId) => headings.get(rootId) ?? rootId,
    matches,
  ).map((group) => ({
    id: group.id,
    label: group.label,
    cells: group.units.map((id) => {
      const stages = (stagesOf.get(id) ?? []).slice().sort();
      return { id, label: label(id), upgrades: stages.length, stages };
    }),
  }));
}
