import type { GalaxyDoc, GalaxyNode } from "../model";
import { linkCueKind } from "./mapCues";
import {
  BORDER_TOLERANCE_FRACTION,
  type MapPoint,
  type ProvinceIndex,
  provinceIndexFor,
} from "./provinces";
import type { RoadLine } from "./roadMask";
import { pairKey } from "./roads";
import { type SeaRoute, seaRoute } from "./seaRoute";
import type { TerrainSurface } from "./terrain";

/**
 * Where each sea crossing of a terrain map runs, worked out once when the map
 * is drawn. The ground layer paints the track from each location down to its
 * landing point as a road, and `cueLayer.ts` draws the stretch over the water.
 * Planned before either, so both draw the same route. Pure.
 */

/** How a crossing finds the coast its landing points are on. */
export interface Coast {
  isLand: (x: number, y: number) => boolean;
  /** Distance between samples, in map units. */
  step: number;
}

/**
 * Where the land is on this map, or `undefined` when nothing says.
 *
 * A generated map's heightmap puts the sea at 0 and the lowest land at 1 in
 * 255, so land is anything above half that, read at the terrain mesh's own
 * spacing. A hand-made map's picture may put its sea at any height, so its
 * land is its provinces, looked for in steps of the distance the province
 * layer treats as touching. A hand-made map of cities alone has neither, and
 * its crossings draw straight from one city to the other.
 */
export function coastOf(
  galaxy: Pick<GalaxyDoc, "terrain" | "handmade">,
  surface: TerrainSurface,
  index: ProvinceIndex | undefined,
): Coast | undefined {
  const generated =
    !galaxy.handmade && !!galaxy.terrain?.heightmap?.startsWith("generated:");
  if (generated && surface.maxHeight > 0) {
    const shore = (0.5 * surface.heightScale * surface.scale) / 255;
    return {
      isLand: (x, y) => surface.groundHeightAt(x, y) > shore,
      step: Math.min(
        surface.width / surface.segmentsX,
        surface.height / surface.segmentsY,
      ),
    };
  }
  if (index && index.nodes.length > 0) {
    return {
      isLand: (x, y) => index.at(x, y) >= 0,
      step: Math.max(surface.width, surface.height) * BORDER_TOLERANCE_FRACTION,
    };
  }
  return undefined;
}

/** One planned crossing. */
export interface PlannedCrossing {
  a: string;
  b: string;
  /** `undefined` when no coast was found: the crossing is the straight line. */
  route: SeaRoute | undefined;
}

export interface CrossingPlan {
  /** Every link drawn as a crossing, by `pairKey`. */
  crossings: Map<string, PlannedCrossing>;
  /**
   * The tracks over land from each location to its landing point, for the
   * ground layer to paint as roads. `a` and `b` name the crossing it belongs
   * to, so its state can follow the crossing's.
   */
  tracks: (Omit<RoadLine, "index"> & { a: string; b: string })[];
}

/** Plan every link of `galaxy` that is drawn as a crossing. */
export function planCrossings(
  galaxy: Pick<GalaxyDoc, "links" | "linkKinds" | "terrain" | "handmade"> & {
    nodes: Pick<GalaxyNode, "id" | "pos" | "outline">[];
  },
  surface: TerrainSurface,
): CrossingPlan {
  const nodes = new Map(galaxy.nodes.map((n) => [n.id, n]));
  const kinds = new Map(
    (galaxy.linkKinds ?? []).map(([a, b, kind]) => [pairKey(a, b), kind]),
  );
  const coast = coastOf(galaxy, surface, provinceIndexFor(galaxy));
  const crossings = new Map<string, PlannedCrossing>();
  const tracks: CrossingPlan["tracks"] = [];
  for (const [a, b] of galaxy.links) {
    const nodeA = nodes.get(a);
    const nodeB = nodes.get(b);
    if (!nodeA || !nodeB) continue;
    const kind = linkCueKind(
      kinds.get(pairKey(a, b)),
      !nodeA.outline,
      !nodeB.outline,
    );
    if (kind !== "crossing") continue;
    const from: MapPoint = [nodeA.pos[0], nodeA.pos[1]];
    const to: MapPoint = [nodeB.pos[0], nodeB.pos[1]];
    const route = coast && seaRoute(from, to, coast.isLand, coast.step);
    crossings.set(pairKey(a, b), { a, b, route });
    if (!route) continue;
    for (const [p, q] of [route.jettyA, route.jettyB]) {
      if (p[0] === q[0] && p[1] === q[1]) continue;
      tracks.push({ line: [p, q], surface: "track", a, b });
    }
  }
  return { crossings, tracks };
}
