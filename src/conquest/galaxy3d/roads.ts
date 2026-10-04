import type { GalaxyDoc, GalaxyNode } from "../model";
import type { WorldPos } from "./layout";
import type { TerrainSurface } from "./terrain";

/**
 * The geometry of roads on a terrain map: which links draw as a road, the
 * path a road takes over the ground, and the flat strip that path is drawn
 * as. Everything here is pure and free of three.js so it unit-tests without
 * WebGL. `cityLayer.ts` turns the result into meshes.
 */

/** How far above the ground a road is drawn, in world units. */
export const ROAD_LIFT = 0.12;

/** A road's width in world units. */
export const ROAD_WIDTH = 0.8;

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

/**
 * The distance between samples along a road, in map units: half the smaller
 * side of a terrain mesh cell, so no cell a road crosses goes unsampled.
 */
export function roadStep(surface: TerrainSurface): number {
  return (
    Math.min(
      surface.width / surface.segmentsX,
      surface.height / surface.segmentsY,
    ) / 2
  );
}

/**
 * The path of a road between two map positions, as world points `lift` above
 * the ground. The path is straight on the map and sampled every
 * {@link roadStep}, so it climbs a hill in its way instead of passing through
 * it. The first and last points sit over the two ends exactly.
 */
export function sampleRoadPath(
  surface: TerrainSurface,
  from: MapPoint,
  to: MapPoint,
  lift: number = ROAD_LIFT,
): WorldPos[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const count = Math.max(1, Math.ceil(length / roadStep(surface)));
  const out: WorldPos[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    out.push(
      surface.mapToWorld(
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        lift,
      ),
    );
  }
  return out;
}

/** Road paths as one strip mesh. */
export interface RoadRibbon {
  /** World `x, y, z` per vertex, two vertices per path point. */
  positions: Float32Array;
  /** Triangle indices. */
  indices: Uint32Array;
  /** Each path's first vertex and vertex count, in the order given. */
  ranges: [start: number, count: number][];
}

/**
 * Turn road paths into a strip `width` world units wide. Each path point
 * becomes a vertex either side of it, and each of those takes its own ground
 * height plus `lift`, so the strip lies on a slope that runs across the road
 * instead of cutting into it.
 */
export function roadRibbon(
  surface: TerrainSurface,
  paths: WorldPos[][],
  width: number = ROAD_WIDTH,
  lift: number = ROAD_LIFT,
): RoadRibbon {
  const pointCount = paths.reduce((sum, p) => sum + p.length, 0);
  const quadCount = paths.reduce(
    (sum, p) => sum + Math.max(0, p.length - 1),
    0,
  );
  const positions = new Float32Array(pointCount * 2 * 3);
  const indices = new Uint32Array(quadCount * 6);
  const ranges: [number, number][] = [];
  let vertex = 0;
  let index = 0;
  for (const path of paths) {
    const start = vertex;
    if (path.length > 0) {
      // A road is straight on the map, so one direction serves every point.
      const first = path[0];
      const last = path[path.length - 1];
      const dx = last[0] - first[0];
      const dz = last[2] - first[2];
      const length = Math.hypot(dx, dz) || 1;
      const px = (-dz / length) * (width / 2);
      const pz = (dx / length) * (width / 2);
      path.forEach(([x, , z], i) => {
        for (const side of [1, -1]) {
          const ex = x + px * side;
          const ez = z + pz * side;
          positions.set(
            [ex, surface.groundHeightAtWorld(ex, ez) + lift, ez],
            vertex * 3,
          );
          vertex++;
        }
        if (i === 0) return;
        const v = start + i * 2;
        indices.set([v - 2, v - 1, v, v, v - 1, v + 1], index);
        index += 6;
      });
    }
    ranges.push([start, vertex - start]);
  }
  return { positions, indices, ranges };
}
