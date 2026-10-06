import { GENERATED_CITIES_IMAGE } from "./cities";
import {
  assembleGalaxy,
  type GenerateOptions,
  generatedNodeCount,
  repairConnectivity,
} from "./generate";
import type { GalaxyDoc, LinkKind } from "./model";
import { resolvePlanet } from "./planets";
import { mulberry32, type Rng } from "./rng";
import {
  coarseNoise,
  type GeneratedTerrain,
  generateTerrain,
  generateTerrainWithMargin,
  labelLandMasses,
  resolveLandLayout,
  type TerrainMargin,
} from "./terrainGen";

/**
 * The Territories map style (issue #3505): land masses split into provinces,
 * with sea between them. It follows `generateGalaxy` step for step, and hands
 * its provinces to the same `assembleGalaxy` for capitals, starting territory,
 * difficulty and battle maps. What differs is where the nodes and links come
 * from: a node is a province grown over generated land, and a link is a border
 * two provinces share, or a sea crossing between two land masses.
 *
 * Deterministic from the seed on every platform, on the same terms as
 * `terrainGen.ts`: integers, the exactly defined float operations and
 * `Math.sqrt`. `terrainGolden.test.ts` pins the documents.
 */

/**
 * What a generated document puts in `terrain.image` and `terrain.heightmap`
 * in place of a URL. The pixels are not stored: {@link generatedTerrain}
 * rebuilds them from the seed the document already carries in `generated`.
 */
export const GENERATED_TERRITORIES_IMAGE = "generated:territories";

/** The galaxy options, less the ones that only mean something for stars. */
export type TerritoriesOptions = Omit<
  GenerateOptions,
  "layout" | "radiusLy" | "skin"
> & {
  /** How the land is arranged. `random` picks one from the seed. */
  layout?: GenerateOptions["layout"];
};

export interface Provinces {
  /** One point per province, in map units, inside that province's outline. */
  anchors: [number, number][];
  /** One closed ring per province, in map units, last point not repeated. */
  outlines: [number, number][][];
  /** Pairs of provinces that share a border, lower index first. */
  borders: [number, number][];
  /** Pairs joined over sea, the fewest that make every province reachable. */
  crossings: [number, number][];
}

/** How far the coordinate noise moves a border, in province spacings. */
const BORDER_WARP = 0.45;
/** The size of the coordinate noise's coarsest cell, in province spacings. */
const BORDER_WARP_CELL = 1.3;
/** The lightest and heaviest province weight. Weight scales the squared
 * distance, so a province's width goes as one over its square root. */
const MIN_WEIGHT = 0.6;
const MAX_WEIGHT = 1.7;
/** A border may stray this many pixels from the pixel edges it replaces. */
const OUTLINE_TOLERANCE = 1.5;
/** One coast pixel in this many is measured when looking for a crossing. */
const COAST_SAMPLE = 3;

/** A binary min-heap of plain numbers. */
class MinHeap {
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(value: number): void {
    const a = this.items;
    let i = a.length;
    a.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent] <= value) break;
      a[i] = a[parent];
      i = parent;
    }
    a[i] = value;
  }

  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop() as number;
    const n = a.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && a[child + 1] < a[child]) child++;
        if (a[child] >= last) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = last;
    }
    return top;
  }
}

/**
 * Pick a starting pixel for each province. Every land mass large enough gets
 * one first, largest mass first, so no island is left empty while there are
 * provinces to give out. The rest are thrown at random and kept when they
 * clear the ones already placed, with the spacing eased after each miss so the
 * loop always ends, as `packWithSampler` does for stars.
 */
function placeSeeds(
  width: number,
  masses: Int32Array[],
  count: number,
  rng: Rng,
): number[] {
  const total = masses.reduce((sum, m) => sum + m.length, 0);
  const all = new Int32Array(total);
  let offset = 0;
  for (const m of masses) {
    all.set(m, offset);
    offset += m.length;
  }
  const seeds: number[] = [];
  const taken = new Set<number>();
  const place = (pixel: number) => {
    seeds.push(pixel);
    taken.add(pixel);
  };
  for (const m of masses) {
    if (seeds.length >= count) break;
    place(m[Math.floor(rng() * m.length)]);
  }
  const spacing = 0.7 * Math.sqrt(total / count);
  let relax = 0;
  while (seeds.length < count) {
    const pixel = all[Math.floor(rng() * total)];
    const need = spacing - relax;
    let clear = !taken.has(pixel);
    if (clear && need > 0) {
      const x = pixel % width;
      const y = (pixel - x) / width;
      for (const s of seeds) {
        const sx = s % width;
        const dx = x - sx;
        const dy = y - (s - sx) / width;
        if (dx * dx + dy * dy < need * need) {
          clear = false;
          break;
        }
      }
    }
    if (clear) {
      place(pixel);
      relax = 0;
    } else {
      relax += spacing / 50;
    }
  }
  return seeds;
}

/**
 * Where each pixel sits once the coordinate noise has moved it, in pixels, as
 * two arrays. The noise is scaled to the spacing between provinces, so a
 * border bends about as much on a map of 160 provinces as on one of 8.
 */
function warpedPositions(
  width: number,
  height: number,
  spacing: number,
  rng: Rng,
): { wx: Float64Array; wy: Float64Array } {
  const seedX = Math.floor(rng() * 4294967296) | 0;
  const seedY = Math.floor(rng() * 4294967296) | 0;
  const cell = spacing * BORDER_WARP_CELL;
  const reach = spacing * BORDER_WARP;
  const wx = coarseNoise(width, height, cell, seedX, 3);
  const wy = coarseNoise(width, height, cell, seedY, 3);
  for (let i = 0; i < wx.length; i++) {
    const x = i % width;
    wx[i] = x + reach * (wx[i] - 0.5) * 2;
    wy[i] = (i - x) / width + reach * (wy[i] - 0.5) * 2;
  }
  return { wx, wy };
}

/**
 * Grow every seed over the land at once. A pixel goes to whichever seed is
 * nearest among those that can reach it through their own pixels, so no
 * province crosses water, and each province is one piece holding its own
 * seed. Nearness is measured between the pixels' bent positions and scaled by
 * the province's weight, so borders curve and a heavier province stays small.
 */
function growProvinces(
  terrain: GeneratedTerrain,
  seeds: number[],
  weights: number[],
  warp: { wx: Float64Array; wy: Float64Array },
): Int16Array {
  const { width, height, land } = terrain;
  const { wx, wy } = warp;
  const pixels = width * height;
  const count = seeds.length;
  const owner = new Int16Array(pixels).fill(-1);
  const heap = new MinHeap();
  // One number per candidate, ordered by distance, then seed, then pixel. The
  // largest is under 2^53, so the order is exact.
  const key = (d2: number, seed: number, pixel: number) =>
    (d2 * count + seed) * pixels + pixel;
  seeds.forEach((pixel, seed) => {
    heap.push(key(0, seed, pixel));
  });
  while (heap.size > 0) {
    const k = heap.pop();
    const pixel = k % pixels;
    if (owner[pixel] !== -1) continue;
    const seed = ((k - pixel) / pixels) % count;
    owner[pixel] = seed;
    const x = pixel % width;
    const y = (pixel - x) / width;
    const s = seeds[seed];
    const w = weights[seed];
    const offer = (nx: number, ny: number) => {
      const n = ny * width + nx;
      if (!land[n] || owner[n] !== -1) return;
      const dx = wx[n] - wx[s];
      const dy = wy[n] - wy[s];
      heap.push(key(Math.floor((dx * dx + dy * dy) * w), seed, n));
    };
    if (x > 0) offer(x - 1, y);
    if (x < width - 1) offer(x + 1, y);
    if (y > 0) offer(x, y - 1);
    if (y < height - 1) offer(x, y + 1);
  }
  return owner;
}

/**
 * How many pixels each province pixel is from the edge of its province, 1 on
 * the edge itself. The deepest pixel is where the anchor goes.
 */
function provinceDepth(
  owner: Int16Array,
  width: number,
  height: number,
): Int32Array {
  const depth = new Int32Array(owner.length);
  let frontier: number[] = [];
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? -1 : owner[y * width + x];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = owner[y * width + x];
      if (o < 0) continue;
      if (
        at(x - 1, y) !== o ||
        at(x + 1, y) !== o ||
        at(x, y - 1) !== o ||
        at(x, y + 1) !== o
      ) {
        depth[y * width + x] = 1;
        frontier.push(y * width + x);
      }
    }
  }
  for (let d = 2; frontier.length > 0; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      // An inner pixel has all four neighbours, in its own province.
      for (const n of [i - 1, i + 1, i - width, i + width]) {
        if (n >= 0 && n < owner.length && owner[n] >= 0 && depth[n] === 0) {
          depth[n] = d;
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return depth;
}

/** Is the point inside the ring? Integer inputs keep every product exact. */
function insideRing(ring: [number, number][], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j];
    const [x2, y2] = ring[i];
    if (y1 > py === y2 > py) continue;
    const t = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1);
    if (y2 > y1 ? t < 0 : t > 0) inside = !inside;
  }
  return inside;
}

/**
 * Trace every province's outer edge and thin it to a ring of few points.
 *
 * Corners are numbered on a grid one wider and taller than the pixels. A
 * province's edge is walked with the province on the right. Lakes and anything
 * else enclosed are dropped, since an outline has no holes.
 *
 * Thinning happens per stretch between two junctions, a junction being a
 * corner where three or more owners meet. Two provinces share the stretch
 * between the same two junctions, and it is thinned in one fixed direction, so
 * both get the same points and their outlines meet with no gap or overlap.
 */
function traceOutlines(
  owner: Int16Array,
  width: number,
  height: number,
  count: number,
): { thin: number[][]; raw: number[][]; corners: number } {
  const corners = width + 1;
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? -1 : owner[y * width + x];

  // Per province, each corner an edge leaves from and the directions it leaves
  // in: 0 east, 1 south, 2 west, 3 north.
  const edges: Map<number, number>[] = Array.from(
    { length: count },
    () => new Map(),
  );
  const add = (p: number, corner: number, dir: number) => {
    edges[p].set(corner, (edges[p].get(corner) ?? 0) | (1 << dir));
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = owner[y * width + x];
      if (p < 0) continue;
      if (at(x, y - 1) !== p) add(p, y * corners + x, 0);
      if (at(x + 1, y) !== p) add(p, y * corners + x + 1, 1);
      if (at(x, y + 1) !== p) add(p, (y + 1) * corners + x + 1, 2);
      if (at(x - 1, y) !== p) add(p, (y + 1) * corners + x, 3);
    }
  }
  const step = [1, corners, -1, -corners];

  const isJunction = (corner: number) => {
    const x = corner % corners;
    const y = (corner - x) / corners;
    const a = at(x - 1, y - 1);
    const b = at(x, y - 1);
    const c = at(x - 1, y);
    const d = at(x, y);
    // Two owners meeting corner to corner count as well, since the walk can
    // pass through that corner twice.
    if (a === d && b === c && a !== b) return true;
    return new Set([a, b, c, d]).size >= 3;
  };

  const xy = (corner: number): [number, number] => {
    const x = corner % corners;
    return [x, (corner - x) / corners];
  };

  /** Twice the signed area of a closed walk. */
  const area2 = (loop: number[]) => {
    let sum = 0;
    for (let i = 0; i < loop.length; i++) {
      const [x1, y1] = xy(loop[i]);
      const [x2, y2] = xy(loop[(i + 1) % loop.length]);
      sum += x1 * y2 - x2 * y1;
    }
    return sum;
  };

  /** Keep the points of `pts[from..to]` that stray past the tolerance. */
  const thinBetween = (
    pts: number[],
    keep: boolean[],
    lo: number,
    hi: number,
  ) => {
    const stack: [number, number][] = [[lo, hi]];
    while (stack.length > 0) {
      const [i, j] = stack.pop() as [number, number];
      if (j - i < 2) continue;
      const [ax, ay] = xy(pts[i]);
      const [bx, by] = xy(pts[j]);
      const len2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
      let far = -1;
      let farCross2 = -1;
      for (let k = i + 1; k < j; k++) {
        const [px, py] = xy(pts[k]);
        const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
        if (cross * cross > farCross2) {
          farCross2 = cross * cross;
          far = k;
        }
      }
      if (farCross2 > OUTLINE_TOLERANCE * OUTLINE_TOLERANCE * len2) {
        keep[far] = true;
        stack.push([i, far], [far, j]);
      }
    }
  };

  /** Thin one stretch, both ends kept. A stretch that starts and ends on the
   * same corner is a whole loop, and is split at its farthest point first. */
  const thinStretch = (stretch: number[]): number[] => {
    const last = stretch.length - 1;
    const closed = stretch[0] === stretch[last];
    const reverse = closed
      ? stretch[1] > stretch[last - 1]
      : stretch[0] > stretch[last];
    const pts = reverse ? [...stretch].reverse() : stretch;
    const keep = new Array<boolean>(pts.length).fill(false);
    keep[0] = true;
    keep[last] = true;
    if (closed) {
      const [ax, ay] = xy(pts[0]);
      let far = 0;
      let farD2 = -1;
      for (let k = 1; k < last; k++) {
        const [px, py] = xy(pts[k]);
        const d2 = (px - ax) * (px - ax) + (py - ay) * (py - ay);
        if (d2 > farD2) {
          farD2 = d2;
          far = k;
        }
      }
      keep[far] = true;
      thinBetween(pts, keep, 0, far);
      thinBetween(pts, keep, far, last);
    } else {
      thinBetween(pts, keep, 0, last);
    }
    const out = pts.filter((_, k) => keep[k]);
    return reverse ? out.reverse() : out;
  };

  const thin: number[][] = [];
  const raw: number[][] = [];
  for (let p = 0; p < count; p++) {
    const used = new Set<number>();
    let outer: number[] = [];
    let outerArea = -1;
    for (const [start, mask] of edges[p]) {
      for (let startDir = 0; startDir < 4; startDir++) {
        if (!(mask & (1 << startDir)) || used.has(start * 4 + startDir)) {
          continue;
        }
        const loop: number[] = [];
        let corner = start;
        let dir = startDir;
        for (;;) {
          loop.push(corner);
          used.add(corner * 4 + dir);
          corner += step[dir];
          const leaving = edges[p].get(corner) ?? 0;
          // Left before right. Where the province touches itself corner to
          // corner, turning left keeps the walk on the outside of both pixels.
          const left = (dir + 3) & 3;
          const right = (dir + 1) & 3;
          dir =
            leaving & (1 << left) ? left : leaving & (1 << dir) ? dir : right;
          if (corner === start && dir === startDir) break;
        }
        const area = Math.abs(area2(loop));
        if (area > outerArea) {
          outerArea = area;
          outer = loop;
        }
      }
    }

    // Drop the corners a straight run passes through, for the fallback ring.
    raw.push(
      outer.filter((corner, i) => {
        const prev = outer[(i + outer.length - 1) % outer.length];
        const next = outer[(i + 1) % outer.length];
        return corner - prev !== next - corner;
      }),
    );

    const junctions: number[] = [];
    outer.forEach((corner, i) => {
      if (isJunction(corner)) junctions.push(i);
    });
    const ring: number[] = [];
    if (junctions.length === 0) {
      // Nothing to agree with a neighbour on, so any fixed start will do.
      const first = outer.indexOf(Math.min(...outer));
      const loop = [...outer.slice(first), ...outer.slice(0, first)];
      ring.push(...thinStretch([...loop, loop[0]]).slice(0, -1));
    } else {
      junctions.forEach((from, j) => {
        const to = junctions[(j + 1) % junctions.length];
        const stretch =
          to > from
            ? outer.slice(from, to + 1)
            : [...outer.slice(from), ...outer.slice(0, to + 1)];
        ring.push(...thinStretch(stretch).slice(0, -1));
      });
    }
    thin.push(ring);
  }
  return { thin, raw, corners };
}

/** Provinces, with the pixels behind them for a generator that wants more. */
export interface DividedLand extends Provinces {
  /** The province each pixel belongs to, or -1 for sea. */
  owner: Int16Array;
  /** Pixels from each province pixel to its province's edge, 1 on the edge. */
  depth: Int32Array;
}

/**
 * Split a terrain's land into `count` provinces and work out how they join.
 * Draws from `rng` only to place and shape the provinces, so the caller can
 * carry on with the same generator afterwards.
 */
export function generateProvinces(
  terrain: GeneratedTerrain,
  count: number,
  rng: Rng,
): Provinces {
  const { anchors, outlines, borders, crossings } = divideLand(
    terrain,
    count,
    rng,
  );
  return { anchors, outlines, borders, crossings };
}

/** {@link generateProvinces}, keeping the pixel arrays. */
export function divideLand(
  terrain: GeneratedTerrain,
  count: number,
  rng: Rng,
): DividedLand {
  const { width, height, land } = terrain;
  const scale = terrain.mapWidth / width;
  const { labels, sizes } = labelLandMasses(terrain);
  if (sizes.length === 0) throw new Error("the terrain has no land");

  // Largest land mass first, the earlier label on a tie. The terrain has
  // already sunk the specks, so every land mass gets a province.
  const chosen = sizes
    .map((size, label) => ({ size, label }))
    .sort((a, b) => b.size - a.size || a.label - b.label);
  const slot = new Int32Array(sizes.length).fill(-1);
  const masses = chosen.map((m, i) => {
    slot[m.label] = i;
    return new Int32Array(m.size);
  });
  const filled = new Int32Array(masses.length);
  for (let i = 0; i < labels.length; i++) {
    const s = labels[i] < 0 ? -1 : slot[labels[i]];
    if (s >= 0) masses[s][filled[s]++] = i;
  }
  const room = masses.reduce((sum, m) => sum + m.length, 0);
  const provinces = Math.min(count, room);

  const seeds = placeSeeds(width, masses, provinces, rng);
  const weights = seeds.map(
    () => MIN_WEIGHT + rng() * (MAX_WEIGHT - MIN_WEIGHT),
  );
  const spacing = Math.sqrt(room / provinces);
  const owner = growProvinces(
    terrain,
    seeds,
    weights,
    warpedPositions(width, height, spacing, rng),
  );
  const depth = provinceDepth(owner, width, height);
  const { thin, raw, corners } = traceOutlines(owner, width, height, provinces);

  const toRing = (loop: number[]): [number, number][] =>
    loop.map((corner) => {
      const x = corner % corners;
      return [x * scale, ((corner - x) / corners) * scale];
    });
  const centre = (pixel: number): [number, number] => {
    const x = pixel % width;
    return [(x + 0.5) * scale, ((pixel - x) / width + 0.5) * scale];
  };

  // Each province's pixels, deepest first and then in scan order.
  const members: number[][] = Array.from({ length: provinces }, () => []);
  // A sample of each province's pixels that touch the sea.
  const coast: number[][] = Array.from({ length: provinces }, () => []);
  const coastSeen = new Int32Array(provinces);
  const borderKeys = new Set<number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = owner[i];
      if (p < 0) continue;
      members[p].push(i);
      const wet =
        (x > 0 && !land[i - 1]) ||
        (x < width - 1 && !land[i + 1]) ||
        (y > 0 && !land[i - width]) ||
        (y < height - 1 && !land[i + width]);
      if (wet && coastSeen[p]++ % COAST_SAMPLE === 0) coast[p].push(i);
      for (const n of [
        x < width - 1 ? i + 1 : -1,
        y < height - 1 ? i + width : -1,
      ]) {
        const q = n < 0 ? -1 : owner[n];
        if (q >= 0 && q !== p) {
          borderKeys.add(Math.min(p, q) * provinces + Math.max(p, q));
        }
      }
    }
  }

  const anchors: [number, number][] = [];
  const outlines: [number, number][][] = [];
  for (let p = 0; p < provinces; p++) {
    members[p].sort((a, b) => depth[b] - depth[a] || a - b);
    const ring = toRing(thin[p]);
    const inside =
      ring.length >= 3
        ? members[p].find((pixel) => insideRing(ring, ...centre(pixel)))
        : undefined;
    if (inside !== undefined) {
      anchors.push(centre(inside));
      outlines.push(ring);
    } else {
      // Thinning left the ring too small to hold any of its own pixels, so
      // keep the pixel edges, which hold all of them.
      anchors.push(centre(members[p][0]));
      outlines.push(toRing(raw[p]));
    }
  }

  const borders = [...borderKeys]
    .sort((a, b) => a - b)
    .map((k): [number, number] => {
      const b = k % provinces;
      return [(k - b) / provinces, b];
    });

  // Sea crossings: join the closest pair of coasts between two unjoined groups
  // until there is one group. A province with no coast is costed out of reach
  // of any that has one.
  const landlocked = 4 * width * width + 4 * height * height;
  const gap = new Map<number, number>();
  const coastGap = (a: number, b: number) => {
    const k = Math.min(a, b) * provinces + Math.max(a, b);
    const known = gap.get(k);
    if (known !== undefined) return known;
    let best = Number.POSITIVE_INFINITY;
    if (coast[a].length === 0 || coast[b].length === 0) {
      const dx = anchors[a][0] - anchors[b][0];
      const dy = anchors[a][1] - anchors[b][1];
      best = landlocked + dx * dx + dy * dy;
    } else {
      for (const i of coast[a]) {
        const ix = i % width;
        const iy = (i - ix) / width;
        for (const j of coast[b]) {
          const jx = j % width;
          const dx = ix - jx;
          const dy = iy - (j - jx) / width;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) best = d2;
        }
      }
    }
    gap.set(k, best);
    return best;
  };
  const crossings = repairConnectivity(provinces, borders, coastGap)
    .slice(borders.length)
    .map(([a, b]): [number, number] => (a < b ? [a, b] : [b, a]));

  return { anchors, outlines, borders, crossings, owner, depth };
}

/**
 * Generate a complete, playable Territories map. The document is in the same
 * model as an authored one: every node has an outline and an anchor inside it,
 * every link is a border or a crossing, and `terrain` names the generated land
 * (see {@link GENERATED_TERRITORIES_IMAGE}).
 */
export function generateTerritories(
  opts: TerritoriesOptions,
  now: string = new Date().toISOString(),
): GalaxyDoc {
  const rng = mulberry32(opts.seed);
  const count = generatedNodeCount(opts);
  const terrain = landTerrain(opts.seed, opts.layout, count, rng, opts.planet);
  const provinces = generateProvinces(terrain, count, rng);
  const doc = assembleGalaxy(
    opts,
    rng,
    {
      source: provinces.anchors.map(([x, y]) => ({ pos: [x, y, 0] })),
      links: [...provinces.borders, ...provinces.crossings],
      exactDistance: true,
      land: true,
    },
    now,
  );
  const kinds = (pairs: [number, number][], kind: LinkKind) =>
    pairs.map(([a, b]): [string, string, LinkKind] => [
      doc.nodes[a].id,
      doc.nodes[b].id,
      kind,
    ]);
  return {
    ...doc,
    description: `A generated map of ${doc.nodes.length} provinces.`,
    theme: { skin: "territories" },
    generated: doc.generated && {
      ...doc.generated,
      skin: "territories",
      ...(opts.planet ? { planet: opts.planet } : {}),
    },
    nodes: doc.nodes.map((node, i) => ({
      ...node,
      outline: [provinces.outlines[i]],
    })),
    terrain: {
      image: GENERATED_TERRITORIES_IMAGE,
      heightmap: GENERATED_TERRITORIES_IMAGE,
      width: terrain.mapWidth,
      height: terrain.mapHeight,
      heightScale: terrain.heightScale,
      projection: "flat",
    },
    linkKinds: [
      ...kinds(provinces.borders, "border"),
      ...kinds(provinces.crossings, "crossing"),
    ],
  };
}

/**
 * The land under a generated Cities or Territories map. Both styles start
 * their stream with `mulberry32(seed)` and draw the layout from it first, so
 * this takes that stream and leaves it where the generator carries on.
 */
export function landTerrain(
  seed: number,
  layout: GenerateOptions["layout"],
  locations: number,
  rng: Rng,
  planet?: GenerateOptions["planet"],
): GeneratedTerrain {
  const resolved = resolvePlanet(planet, seed);
  const shape = resolveLandLayout(layout, rng, resolved);
  return generateTerrain({
    seed,
    shape,
    maxMasses: locations,
    planet: resolved,
  });
}

/**
 * The pixels of a generated document's terrain, rebuilt from what it carries:
 * the seed, the layout and the number of locations. Null when the document's
 * terrain is not a generated one: an authored map, a galaxy, or a document
 * saved without its `generated` block.
 */
export function generatedTerrain(doc: GalaxyDoc): GeneratedTerrain | null {
  const g = generatedLand(doc);
  return g
    ? landTerrain(
        g.seed,
        g.layout,
        doc.nodes.length,
        mulberry32(g.seed),
        g.planet,
      )
    : null;
}

/**
 * {@link generatedTerrain} with the land drawn on for `marginPixels` past
 * every side, for the strategic view. The map itself is the same.
 */
export function generatedTerrainWithMargin(
  doc: GalaxyDoc,
  marginPixels: number,
): { terrain: GeneratedTerrain; margin: TerrainMargin } | null {
  const g = generatedLand(doc);
  if (!g) return null;
  const planet = resolvePlanet(g.planet, g.seed);
  const shape = resolveLandLayout(g.layout, mulberry32(g.seed), planet);
  return generateTerrainWithMargin(
    { seed: g.seed, shape, maxMasses: doc.nodes.length, planet },
    marginPixels,
  );
}

/** A document's generation settings, when its land is generated. */
function generatedLand(doc: GalaxyDoc): GalaxyDoc["generated"] | null {
  const g = doc.generated;
  if (!g) return null;
  const image = doc.terrain?.image;
  if (
    image !== GENERATED_CITIES_IMAGE &&
    image !== GENERATED_TERRITORIES_IMAGE
  ) {
    return null;
  }
  return g;
}
