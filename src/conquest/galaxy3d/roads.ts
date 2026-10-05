import type { GalaxyDoc, GalaxyNode } from "../model";

/**
 * Which links of a terrain map draw as a road. Pure and free of three.js so
 * it unit-tests without WebGL. `roadNetwork.ts` routes them over the ground.
 */

/** A map position in map units. */
export type MapPoint = [number, number];

/** A key for an undirected pair of node ids, the same whichever way round. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/** A link that draws as a road, with its ends in the order the link has. */
export interface RoadLink {
  a: string;
  b: string;
}

/**
 * The links of a terrain map that draw as a road:
 *
 * - a link whose kind is `road`, whatever its ends are
 * - any other link with at least one point location end, which runs to the
 *   anchor of a province at the other end
 *
 * A `crossing` never draws here, and a link between two provinces draws no
 * line unless it is a `road`. A link naming a node the document does not have
 * is left out.
 */
export function roadLinks(
  galaxy: Pick<GalaxyDoc, "links" | "linkKinds"> & {
    nodes: Pick<GalaxyNode, "id" | "outline">[];
  },
): RoadLink[] {
  const isPoint = new Map(galaxy.nodes.map((n) => [n.id, !n.outline]));
  const kinds = new Map(
    (galaxy.linkKinds ?? []).map(([a, b, kind]) => [pairKey(a, b), kind]),
  );
  const out: RoadLink[] = [];
  for (const [a, b] of galaxy.links) {
    const pointA = isPoint.get(a);
    const pointB = isPoint.get(b);
    if (pointA === undefined || pointB === undefined) continue;
    const kind = kinds.get(pairKey(a, b));
    if (kind === "crossing") continue;
    if (kind === "road" || pointA || pointB) out.push({ a, b });
  }
  return out;
}
