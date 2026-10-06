import type { GalaxyDoc, GalaxyNode } from "../model";
import { linkCueKind } from "./mapCues";
import { provinceRings, type Ring } from "./provinces";
import type { RoadLine } from "./roadMask";
import { roadSurface } from "./roadNetwork";
import { markRoad, type RouteGrid, routeRoad } from "./roadRoute";
import { pairKey, type RoadLink } from "./roads";

/**
 * Roads between the towns of neighbouring provinces on a Territories map.
 * They are scenery: the links between provinces are borders and draw no
 * line, so without these the towns stand alone. Each is routed by the same
 * code as a Cities road and kept inside its two provinces, so it never cuts
 * across a third or over a blocked border. Pure.
 */

type ProvinceDoc = Pick<GalaxyDoc, "links" | "linkKinds"> & {
  nodes: Pick<GalaxyNode, "id" | "pos" | "outline" | "kind">[];
};

/** Twice the area of a ring, unsigned. */
function area2(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum);
}

/**
 * The province of every cell of `grid`, as a node index, or -1 for none.
 * Each province is filled row by row, largest first, so where two overlap
 * the smaller wins, as it does for picking.
 */
export function provinceRegions(
  nodes: Pick<GalaxyNode, "outline">[],
  grid: Pick<RouteGrid, "cols" | "rows" | "stepX" | "stepY">,
): Int32Array {
  const { cols, rows, stepX, stepY } = grid;
  const out = new Int32Array(cols * rows).fill(-1);
  const provinces = nodes
    .map((n, i) => ({ i, rings: provinceRings(n) }))
    .filter((p) => p.rings.length > 0)
    .map((p) => ({ ...p, size: p.rings.reduce((s, r) => s + area2(r), 0) }))
    .sort((a, b) => b.size - a.size || a.i - b.i);
  const xs: number[] = [];
  for (const { i, rings } of provinces) {
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const ring of rings) {
      for (const [, y] of ring) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    const j0 = Math.max(0, Math.ceil(top / stepY));
    const j1 = Math.min(rows - 1, Math.floor(bottom / stepY));
    for (let j = j0; j <= j1; j++) {
      const y = j * stepY;
      xs.length = 0;
      // Even and odd across every ring, as `pointInRing` counts.
      for (const ring of rings) {
        for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
          const [xk, yk] = ring[k];
          const [xl, yl] = ring[l];
          if (yk > y !== yl > y)
            xs.push(((xl - xk) * (y - yk)) / (yl - yk) + xk);
        }
      }
      xs.sort((a, b) => a - b);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        const i0 = Math.max(0, Math.ceil(xs[s] / stepX));
        const i1 = Math.min(cols - 1, Math.floor(xs[s + 1] / stepX));
        for (let c = i0; c <= i1; c++) out[j * cols + c] = i;
      }
    }
  }
  return out;
}

/** Pairs of node indices whose cells sit side by side, by `pairKey`. */
export function touchingRegions(
  region: Int32Array,
  cols: number,
  rows: number,
): Set<string> {
  const out = new Set<string>();
  const add = (a: number, b: number) => {
    if (a >= 0 && b >= 0 && a !== b) out.add(pairKey(String(a), String(b)));
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = j * cols + i;
      if (i + 1 < cols) add(region[c], region[c + 1]);
      if (j + 1 < rows) add(region[c], region[c + cols]);
    }
  }
  return out;
}

/**
 * The links of a map that get a road between provinces, in link order. A
 * candidate is a link that draws as a border, between two provinces that
 * touch: `touches` says whether two node indices do. A crossing, a road, and
 * a link with a point location at either end are drawn elsewhere, and a
 * blocked border is not a link, so it never gets one.
 *
 * Every province has several neighbours, so a road for each candidate covers
 * a large map in lines. The candidates are thinned with {@link thinRoads}.
 */
export function provinceRoadLinks(
  galaxy: Pick<GalaxyDoc, "links" | "linkKinds"> & {
    nodes: Pick<GalaxyNode, "id" | "pos" | "outline">[];
  },
  touches: (a: number, b: number) => boolean,
): RoadLink[] {
  const index = new Map(galaxy.nodes.map((n, i) => [n.id, i]));
  const kinds = new Map(
    (galaxy.linkKinds ?? []).map(([a, b, kind]) => [pairKey(a, b), kind]),
  );
  const candidates: RoadLink[] = [];
  for (const [a, b] of galaxy.links) {
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia === undefined || ib === undefined) continue;
    const pointA = provinceRings(galaxy.nodes[ia]).length === 0;
    const pointB = provinceRings(galaxy.nodes[ib]).length === 0;
    if (pointA || pointB) continue;
    if (linkCueKind(kinds.get(pairKey(a, b)), false, false) !== "border") {
      continue;
    }
    if (touches(ia, ib)) candidates.push({ a, b });
  }
  return thinRoads(candidates, (id) => {
    const pos = galaxy.nodes[index.get(id) ?? -1]?.pos ?? [0, 0];
    return [pos[0], pos[1]];
  });
}

/**
 * Drop each road that has a shorter way round: a road from A to B goes when
 * some C has a road to both and is nearer to each than A and B are to each
 * other. What is left still joins every town that was joined, since the
 * shortest roads are never dropped, and keeps the loops round each cluster
 * of towns. Depends on the positions and the list alone, in its order.
 */
export function thinRoads(
  roads: RoadLink[],
  at: (id: string) => [number, number],
): RoadLink[] {
  const near = new Map<string, Set<string>>();
  for (const { a, b } of roads) {
    if (!near.has(a)) near.set(a, new Set());
    if (!near.has(b)) near.set(b, new Set());
    near.get(a)?.add(b);
    near.get(b)?.add(a);
  }
  const length = (p: string, q: string) => {
    const [px, py] = at(p);
    const [qx, qy] = at(q);
    return Math.hypot(px - qx, py - qy);
  };
  return roads.filter(({ a, b }) => {
    const ab = length(a, b);
    for (const c of near.get(a) ?? []) {
      if (c === b || !near.get(b)?.has(c)) continue;
      if (length(a, c) < ab && length(c, b) < ab) return false;
    }
    return true;
  });
}

/**
 * Route a road for every link {@link provinceRoadLinks} picks, over `grid`,
 * after the roads already marked on it, and one for each of `landLinks`:
 * border links between provinces that do not touch, with dry land between.
 * Those are not thinned, since nothing else joins the two. Road `j` takes
 * state index `first + j`. Sets `grid.region`.
 */
export function planProvinceRoads(
  galaxy: ProvinceDoc,
  grid: RouteGrid,
  first: number,
  landLinks: readonly RoadLink[] = [],
): { links: RoadLink[]; roads: RoadLine[] } {
  const region = provinceRegions(galaxy.nodes, grid);
  grid.region = region;
  const touching = touchingRegions(region, grid.cols, grid.rows);
  const touched = provinceRoadLinks(galaxy, (a, b) =>
    touching.has(pairKey(String(a), String(b))),
  );
  const have = new Set(touched.map(({ a, b }) => pairKey(a, b)));
  const links = [
    ...touched,
    ...landLinks.filter(({ a, b }) => !have.has(pairKey(a, b))),
  ];
  const index = new Map(galaxy.nodes.map((n, i) => [n.id, i]));
  const degrees = new Map<string, number>();
  for (const { a, b } of links) {
    degrees.set(a, (degrees.get(a) ?? 0) + 1);
    degrees.set(b, (degrees.get(b) ?? 0) + 1);
  }
  const roads = links.map(({ a, b }, j) => {
    const na = galaxy.nodes[index.get(a) ?? 0];
    const nb = galaxy.nodes[index.get(b) ?? 0];
    const line = routeRoad(
      grid,
      [na.pos[0], na.pos[1]],
      [nb.pos[0], nb.pos[1]],
      [index.get(a) ?? -1, index.get(b) ?? -1],
    );
    markRoad(grid, line);
    return {
      line,
      surface: roadSurface(
        (id) => galaxy.nodes[index.get(id) ?? 0]?.kind === "capital",
        (id) => degrees.get(id) ?? 0,
        a,
        b,
      ),
      index: first + j,
    };
  });
  return { links, roads };
}
