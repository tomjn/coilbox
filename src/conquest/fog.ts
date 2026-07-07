import type { GalaxyDoc } from "./model";

/**
 * Fog of war: which systems the player can see. Self-contained (only *types*
 * from the model) so both {@link ../model} and {@link ../rules} can use it
 * without an import cycle. Reveal is monotonic — once a system comes within
 * range it stays known for the rest of the run ("explored" fog, not line of
 * sight), so the reveal set only ever grows.
 */

/** Systems more than this many jumps from your territory stay hidden. */
export const FOG_RANGE = 2;

/** Undirected adjacency from a galaxy's links. */
function adjacencyOf(galaxy: Pick<GalaxyDoc, "nodes" | "links">) {
  const adj = new Map<string, string[]>(galaxy.nodes.map((n) => [n.id, []]));
  for (const [a, b] of galaxy.links) {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
  }
  return adj;
}

/**
 * Node ids within `jumps` hops of any seed node (seeds included). A plain BFS
 * capped at the hop limit.
 */
export function withinJumps(
  galaxy: Pick<GalaxyDoc, "nodes" | "links">,
  seeds: Iterable<string>,
  jumps: number,
): Set<string> {
  const adj = adjacencyOf(galaxy);
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const s of seeds) {
    if (!depth.has(s)) {
      depth.set(s, 0);
      queue.push(s);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    const d = depth.get(cur) ?? 0;
    if (d >= jumps) continue;
    for (const n of adj.get(cur) ?? []) {
      if (!depth.has(n)) {
        depth.set(n, d + 1);
        queue.push(n);
      }
    }
  }
  return new Set(depth.keys());
}

/**
 * Expand a run's revealed set: the union of the previously revealed ids with
 * everything within {@link FOG_RANGE} jumps of the player's current territory.
 * Monotonic (never re-fogs) and returned sorted for stable persistence.
 */
export function expandRevealed(
  galaxy: Pick<GalaxyDoc, "nodes" | "links">,
  owners: Record<string, string>,
  playerFactionId: string,
  prev?: readonly string[],
): string[] {
  const owned = galaxy.nodes
    .map((n) => n.id)
    .filter((id) => owners[id] === playerFactionId);
  const seen = new Set(prev ?? []);
  for (const id of withinJumps(galaxy, owned, FOG_RANGE)) seen.add(id);
  return [...seen].sort();
}
