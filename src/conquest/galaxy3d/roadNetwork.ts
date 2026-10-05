import type { GalaxyDoc, GalaxyNode } from "../model";
import { hashString } from "./layout";
import type { RoadLine, RoadSurface } from "./roadMask";
import {
  type MapXY,
  markRoad,
  type RouteGrid,
  routeGrid,
  routeRoad,
} from "./roadRoute";
import { roadLinks } from "./roads";
import type { HeightGrid } from "./terrain";

/**
 * The roads a terrain map draws on its ground: one routed line per link that
 * `roadLinks` draws as a road, in the same order, so road `k` here is road `k`
 * there and its state goes to the same place. Pure.
 */

type RoadDoc = Pick<GalaxyDoc, "id" | "links" | "linkKinds" | "generated"> & {
  nodes: Pick<GalaxyNode, "id" | "pos" | "outline" | "kind">[];
};

/**
 * The seed a map's scenery is drawn from: the generator's seed for a
 * generated map, and the document's id otherwise, so it never changes.
 */
export function sceneSeed(galaxy: Pick<GalaxyDoc, "id" | "generated">): number {
  const seed = galaxy.generated?.seed;
  return typeof seed === "number" && Number.isFinite(seed)
    ? seed | 0
    : hashString(galaxy.id);
}

/**
 * How a road looks, by how much it matters. A road into a capital is paved.
 * A road between two places with four or more roads each is gravel. Every
 * other road is a dirt track.
 */
export function roadSurface(
  capital: (id: string) => boolean,
  degree: (id: string) => number,
  a: string,
  b: string,
): RoadSurface {
  if (capital(a) || capital(b)) return "paved";
  if (degree(a) >= 4 && degree(b) >= 4) return "gravel";
  return "track";
}

/**
 * Route every road of a terrain map `mapWidth` by `mapHeight` map units over
 * `heights`, which may be left out for a flat map. `grid` may be passed in
 * when the caller already has one for these heights.
 */
export function planRoads(
  galaxy: RoadDoc,
  mapWidth: number,
  mapHeight: number,
  heightScale: number,
  heights?: HeightGrid,
  grid: RouteGrid = routeGrid(
    mapWidth,
    mapHeight,
    heightScale,
    sceneSeed(galaxy),
    heights,
  ),
): RoadLine[] {
  const links = roadLinks(galaxy);
  const nodes = new Map(galaxy.nodes.map((n) => [n.id, n]));
  const degrees = new Map<string, number>();
  for (const { a, b } of links) {
    degrees.set(a, (degrees.get(a) ?? 0) + 1);
    degrees.set(b, (degrees.get(b) ?? 0) + 1);
  }
  const at = (id: string): MapXY => {
    const pos = nodes.get(id)?.pos ?? [0, 0];
    return [pos[0], pos[1]];
  };
  // In link order, each road keeping off the ones before it.
  return links.map(({ a, b }, index) => {
    const line = routeRoad(grid, at(a), at(b));
    markRoad(grid, line);
    return {
      line,
      surface: roadSurface(
        (id) => nodes.get(id)?.kind === "capital",
        (id) => degrees.get(id) ?? 0,
        a,
        b,
      ),
      index,
    };
  });
}
