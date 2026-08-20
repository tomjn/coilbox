/**
 * The map each node resolved to, carried inside a challenge payload (issue
 * #1393).
 *
 * A challenge is a recipe, not a result: the seed and the generation knobs are
 * shared and the galaxy or warpath is rebuilt wherever it is opened. That
 * reproduces the topology exactly, but not the maps, because the generator
 * draws them from whatever is installed on the machine doing the generating.
 * Two people opening the same challenge could end up on different battlefields
 * without either of them knowing.
 *
 * Naming the maps closes that. The payload says which map each node landed on,
 * so a reader can honour it instead of resolving it again, and anything drawing
 * a shared challenge can say which maps it uses without inventing them.
 *
 * Additive, so no `kindVersion` bump: an older build ignores a field it has
 * never heard of and resolves maps the way it always did, and a payload written
 * without this field still opens (see `../container/container.ts` for the same
 * reasoning applied to the shared `game` identity).
 */

/** Node id to map name, for every node the challenge could name a map for. */
export type NodeMaps = Record<string, string>;

/**
 * Most entries read from a payload. The biggest galaxy coilbox generates is 80
 * systems, and the real-star catalogue tops out at 113, so this is well clear
 * of any honest challenge while keeping a hostile payload bounded.
 */
export const MAX_NODE_MAPS = 256;

/** The node shape both modes share, as far as this module cares. */
interface MappedNode {
  id: string;
  battle?: { mapName?: string; mapSubstitutedFrom?: string };
}

/**
 * Collect the map names to publish with a challenge, or `undefined` when there
 * are none to name (a galaxy generated with no maps installed).
 *
 * A node that is standing in for a map this machine does not have publishes the
 * map it was meant to be, not the stand-in. A substitution is a local fallback,
 * so passing a challenge on should not bake one machine's gaps into it.
 */
export function nodeMapsFrom(
  nodes: readonly MappedNode[],
): NodeMaps | undefined {
  const out: NodeMaps = {};
  let count = 0;
  for (const node of nodes) {
    const name = node.battle?.mapSubstitutedFrom ?? node.battle?.mapName;
    if (!name) continue;
    out[node.id] = name;
    count++;
  }
  return count > 0 ? out : undefined;
}

/** Read a payload's node maps, dropping anything that isn't a name. */
export function parseNodeMaps(value: unknown): NodeMaps | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const out: NodeMaps = {};
  let count = 0;
  for (const [id, name] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_NODE_MAPS) break;
    if (id === "" || typeof name !== "string" || name === "") continue;
    out[id] = name;
    count++;
  }
  return count > 0 ? out : undefined;
}
