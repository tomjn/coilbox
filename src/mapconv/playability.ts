/**
 * Whether a map is playable, measured from its heights (issue #2169).
 *
 * Numbers rather than a verdict: how much of the map each movement class can
 * drive on, how the passable ground breaks into areas, the narrowest point on
 * the widest way between start positions, and how much of the map takes a
 * building. Each rule is the engine's own, read out of RecoilEngine rather than
 * guessed at, and each is noted where it is used.
 *
 * Movement is measured on the engine's slope map, one cell per 16 by 16 elmos,
 * because that is the resolution the engine's movement slope test runs at.
 * Buildings are measured on the heightmap's own squares, 8 elmos a side,
 * because that is what `TestUnitBuildSquare` walks.
 *
 * Pure arithmetic on typed arrays, so it runs in a worker and in tests alike.
 */

import { slopeTolerance } from "@/blueprint/buildable";
import {
  field,
  flag,
  type MoveKind,
  moveDefKind,
} from "@/workshop/moveClasses";
import { type MetalGrid, type MetalResult, measureMetal } from "./metalSpots";

/** A map's corner heights as the engine reads them. */
export interface Heights {
  /** `(mapx + 1) * (mapy + 1)` words, row major, row 0 at the map's north. */
  words: Uint16Array;
  width: number;
  height: number;
  minHeight: number;
  maxHeight: number;
}

/**
 * {@link Heights} over a fetched grid, keeping `words` out of key enumeration
 * the way `placement/terrain.ts` `heightGrid` does, because the result is a
 * prop and React's development build walks a prop's keys.
 */
export function heightsOf(
  grid: { words: Uint16Array; width: number; height: number },
  minHeight: number,
  maxHeight: number,
): Heights {
  const out = { width: grid.width, height: grid.height, minHeight, maxHeight };
  Object.defineProperty(out, "words", { value: grid.words, enumerable: false });
  return out as Heights;
}

/** One movement class, with what the engine's passability test reads off it. */
export interface MoveClassSpec {
  name: string;
  kind: MoveKind;
  /** `footprintx`, in heightmap squares. */
  footprint: number;
  /** `maxSlope` in degrees, the kind's default filled in. Null for a ship. */
  maxSlope: number | null;
  /** `maxWaterDepth` for a tank, kbot or hover, `minWaterDepth` for a ship. */
  depth: number;
}

/** A building shape and the limits its defs declare. */
export interface BuildingSpec {
  /** One def of this shape, to name it by. */
  name: string;
  /** How many of the game's defs share this shape and these limits. */
  defs: number;
  /** Footprint in build squares (16 elmos), as the def declares it. */
  footprintX: number;
  footprintZ: number;
  /** `maxSlope` in degrees. */
  maxSlope: number;
  minWaterDepth: number;
  maxWaterDepth: number;
}

/** A pair of places the widest way runs between. */
export type WayEnd =
  | { kind: "start"; index: number }
  | { kind: "edge"; edge: "west" | "east" | "north" | "south" };

export interface Way {
  from: WayEnd;
  to: WayEnd;
  /** The width of the narrowest point, in elmos. Null when the two are not
   *  connected at all. */
  width: number | null;
  /** Where the narrowest point is, in elmos. */
  x: number;
  z: number;
}

export interface ClassResult extends MoveClassSpec {
  /** Share of the map's cells the class can stand on, 0..1. */
  passable: number;
  /** Share of the map in the largest connected area, 0..1. */
  largest: number;
  /** Connected areas big enough for the class's footprint to stand in. */
  areas: number;
  ways: Way[];
}

export interface BuildResult extends BuildingSpec {
  /** Share of the build positions where the engine would place it, 0..1. */
  buildable: number;
  positions: number;
}

export interface Playability {
  /** Slope map cells across and down, 16 elmos each. */
  cellsX: number;
  cellsZ: number;
  classes: ClassResult[];
  buildings: BuildResult[];
  /** The map's metal, or null when the job carried no metal map. */
  metal: MetalResult | null;
}

/** Elmos between heightmap corners (`SQUARE_SIZE`). */
const SQUARE = 8;
/** Stands in for infinity in the distance transform. */
const FAR = 1e20;
/** Elmos across one slope map cell: two squares. */
const CELL = 2 * SQUARE;

/**
 * `DegreesToMaxSlope` in `rts/Sim/MoveTypes/MoveDefHandler.cpp`: the degrees
 * clamped to 0..60, scaled by 1.5, as `1 - cos`.
 */
export function maxSlopeValue(degrees: number): number {
  const deg = Math.min(60, Math.max(0, degrees)) * 1.5;
  return 1 - Math.cos((deg * Math.PI) / 180);
}

/** The corner heights in elmos. `CSMFMapFile::ReadHeightmap`'s arithmetic. */
function cornerHeights(h: Heights): Float64Array {
  const step = (h.maxHeight - h.minHeight) / 65536;
  const out = new Float64Array(h.words.length);
  for (let i = 0; i < out.length; i++) out[i] = h.minHeight + h.words[i] * step;
  return out;
}

/**
 * The engine's slope map, and the highest corner in each cell.
 *
 * `CReadMap::UpdateFaceNormals` gives each square two face normals, one per
 * triangle, with `y = SQUARE_SIZE` before normalising. `UpdateSlopemap` then
 * takes the eight normals' `y` across a 2 by 2 block of squares, their mean
 * and their minimum, and stores `1 - mix(min, mean, min / mean)`. A cell is
 * too steep for a class when that is above the class's `maxSlope`
 * (`GroundSpeedMod`, `HoverSpeedMod`).
 *
 * The highest corner stands in for `GetMaxHeightMapSynced`, which the water
 * tests read per square. Taking the cell's highest corner calls a cell dry if
 * any of its four squares is, which is the generous side of that test.
 */
export function slopeMap(
  h: Heights,
  corners = cornerHeights(h),
): { slope: Float32Array; top: Float32Array; cellsX: number; cellsZ: number } {
  const W = h.width;
  const cellsX = (h.width - 1) >> 1;
  const cellsZ = (h.height - 1) >> 1;
  const slope = new Float32Array(cellsX * cellsZ);
  const top = new Float32Array(cellsX * cellsZ);
  const ys = new Float64Array(8);
  for (let cz = 0; cz < cellsZ; cz++) {
    for (let cx = 0; cx < cellsX; cx++) {
      let n = 0;
      for (let dz = 0; dz < 2; dz++) {
        for (let dx = 0; dx < 2; dx++) {
          const tl = (2 * cz + dz) * W + 2 * cx + dx;
          const hTL = corners[tl];
          const hTR = corners[tl + 1];
          const hBL = corners[tl + W];
          const hBR = corners[tl + W + 1];
          const ax = hTR - hTL;
          const az = hBL - hTL;
          ys[n++] = SQUARE / Math.sqrt(ax * ax + SQUARE * SQUARE + az * az);
          const bx = hBL - hBR;
          const bz = hTR - hBR;
          ys[n++] = SQUARE / Math.sqrt(bx * bx + SQUARE * SQUARE + bz * bz);
        }
      }
      let sum = 0;
      let min = ys[0];
      for (let i = 0; i < 8; i++) {
        sum += ys[i];
        if (ys[i] < min) min = ys[i];
      }
      const mean = sum / 8;
      const lerp = min / mean;
      slope[cz * cellsX + cx] = 1 - (min + (mean - min) * lerp);

      let high = -Infinity;
      for (let dz = 0; dz <= 2; dz++) {
        for (let dx = 0; dx <= 2; dx++) {
          const c = corners[(2 * cz + dz) * W + 2 * cx + dx];
          if (c > high) high = c;
        }
      }
      top[cz * cellsX + cx] = high;
    }
  }
  return { slope, top, cellsX, cellsZ };
}

/**
 * Which cells a class can stand on, by `CMoveMath::GetPosSpeedMod`: a tank or
 * kbot is stopped by a slope over its `maxSlope` or water deeper than its
 * `maxWaterDepth`, a hover only by slope and only on land, and a ship by
 * anything shallower than its `minWaterDepth`, including all dry land.
 */
export function passableCells(
  map: { slope: Float32Array; top: Float32Array },
  spec: MoveClassSpec,
): Uint8Array {
  const n = map.slope.length;
  const out = new Uint8Array(n);
  const limit =
    spec.maxSlope === null ? Infinity : maxSlopeValue(spec.maxSlope);
  for (let i = 0; i < n; i++) {
    const height = map.top[i];
    const steep = map.slope[i] > limit;
    switch (spec.kind) {
      case "tank":
      case "kbot":
        out[i] = !steep && !(-height > spec.depth) ? 1 : 0;
        break;
      case "hover":
        out[i] = height < 0 || !steep ? 1 : 0;
        break;
      case "ship":
        out[i] = height < 0 && !(-height < spec.depth) ? 1 : 0;
        break;
    }
  }
  return out;
}

/** Connected areas of passable cells, eight ways, as the pathfinder moves. */
export function areas(
  pass: Uint8Array,
  cellsX: number,
  cellsZ: number,
): { sizes: number[] } {
  const label = new Int32Array(pass.length).fill(-1);
  const queue = new Int32Array(pass.length);
  const sizes: number[] = [];
  for (let start = 0; start < pass.length; start++) {
    if (!pass[start] || label[start] !== -1) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % cellsX;
      const z = (i - x) / cellsX;
      for (let dz = -1; dz <= 1; dz++) {
        const nz = z + dz;
        if (nz < 0 || nz >= cellsZ) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= cellsX) continue;
          const j = nz * cellsX + nx;
          if (pass[j] && label[j] === -1) {
            label[j] = id;
            queue[tail++] = j;
          }
        }
      }
    }
    sizes.push(tail);
  }
  return { sizes };
}

/** One dimension of Felzenszwalb and Huttenlocher's exact squared distance
 *  transform, in place over `f` from `offset` with `stride`. Every line has a
 *  finite value at both ends, because the grid is padded with impassable
 *  cells, so a large finite stand-in for infinity is safe. */
function edt1d(
  f: Float64Array,
  offset: number,
  stride: number,
  n: number,
  d: Float64Array,
  v: Int32Array,
  zs: Float64Array,
) {
  const at = (q: number) => f[offset + q * stride];
  let k = 0;
  v[0] = 0;
  zs[0] = -Infinity;
  zs[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const fq = at(q) + q * q;
    let s = (fq - (at(v[k]) + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= zs[k]) {
      k--;
      s = (fq - (at(v[k]) + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    zs[k] = s;
    zs[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (zs[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + at(p);
  }
  for (let q = 0; q < n; q++) f[offset + q * stride] = d[q];
}

/**
 * The squared distance from each cell to the nearest impassable cell, in
 * cells, exact. Beyond the map's edge counts as impassable, because nothing
 * drives off it.
 */
export function clearance(
  pass: Uint8Array,
  cellsX: number,
  cellsZ: number,
): Float64Array {
  const W = cellsX + 2;
  const H = cellsZ + 2;
  const f = new Float64Array(W * H);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const inside = x > 0 && z > 0 && x <= cellsX && z <= cellsZ;
      f[z * W + x] = inside && pass[(z - 1) * cellsX + (x - 1)] ? FAR : 0;
    }
  }
  const n = Math.max(W, H);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const zs = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) edt1d(f, x, W, H, d, v, zs);
  for (let z = 0; z < H; z++) edt1d(f, z * W, 1, W, d, v, zs);
  const out = new Float64Array(cellsX * cellsZ);
  for (let z = 0; z < cellsZ; z++) {
    for (let x = 0; x < cellsX; x++) {
      out[z * cellsX + x] = f[(z + 1) * W + (x + 1)];
    }
  }
  return out;
}

/**
 * The narrowest point on the widest way between each pair of ends.
 *
 * Cells are added widest first, joining their neighbours as they go. The
 * moment two ends share an area, the cell just added is the narrowest point
 * on the widest way between them, because every way through wider cells has
 * already been tried. A gap of `w` cells holds a cell `(w + 1) / 2` from
 * either side, so the width is `2 * sqrt(d2) - 1` cells, exact for an odd gap
 * and one cell short for an even one.
 *
 * With two or more start positions the ends are those. Without, they are the
 * map's west and east edges and its north and south edges. A start position
 * on a cell the class cannot stand on is never reached.
 */
export function widestWays(
  pass: Uint8Array,
  dist2: Float64Array,
  cellsX: number,
  cellsZ: number,
  starts: { x: number; z: number }[],
): Way[] {
  const order = widestFirst(pass, dist2);
  if (starts.length >= 2) {
    const ends: WayEnd[] = starts.map((_, index) => ({ kind: "start", index }));
    // A way reaches a start at the first cell whose clear circle holds it,
    // so a start beside a cliff or the map's edge is not itself the narrow
    // point. A start on ground the class cannot stand on is never reached.
    const spots = starts.map((s) => {
      const x = Math.floor(s.x / CELL);
      const z = Math.floor(s.z / CELL);
      const inside = x >= 0 && z >= 0 && x < cellsX && z < cellsZ;
      return inside && pass[z * cellsX + x] ? { x, z } : null;
    });
    const reached = new Uint8Array(starts.length);
    const pairs: [number, number][] = [];
    for (let a = 0; a < ends.length; a++)
      for (let b = a + 1; b < ends.length; b++) pairs.push([a, b]);
    return sweep(order, dist2, cellsX, cellsZ, ends, pairs, (i, x, z) => {
      let out: number[] | undefined;
      for (let e = 0; e < spots.length; e++) {
        const spot = spots[e];
        if (!spot || reached[e]) continue;
        if ((spot.x - x) ** 2 + (spot.z - z) ** 2 < dist2[i]) {
          reached[e] = 1;
          out = out ? [...out, e] : [e];
        }
      }
      return out;
    });
  }
  // A way reaches an edge at a cell whose nearest wall is that edge, so the
  // edge's own wall does not count as a narrow point. Each pair of edges is
  // swept on its own, because a corner cell reaches two edges and would join
  // west to east through the south edge.
  const across = sweep(
    order,
    dist2,
    cellsX,
    cellsZ,
    [
      { kind: "edge", edge: "west" },
      { kind: "edge", edge: "east" },
    ],
    [[0, 1]],
    (i, x) =>
      dist2[i] === (x + 1) ** 2
        ? [0]
        : dist2[i] === (cellsX - x) ** 2
          ? [1]
          : undefined,
  );
  const down = sweep(
    order,
    dist2,
    cellsX,
    cellsZ,
    [
      { kind: "edge", edge: "north" },
      { kind: "edge", edge: "south" },
    ],
    [[0, 1]],
    (i, _, z) =>
      dist2[i] === (z + 1) ** 2
        ? [0]
        : dist2[i] === (cellsZ - z) ** 2
          ? [1]
          : undefined,
  );
  return [...across, ...down];
}

/** The passable cells, widest first, by counting sort over the integer
 *  squared distances. */
function widestFirst(pass: Uint8Array, dist2: Float64Array): Int32Array {
  const n = pass.length;
  let top = 0;
  for (let i = 0; i < n; i++) if (pass[i] && dist2[i] > top) top = dist2[i];
  const count = new Uint32Array(top + 2);
  for (let i = 0; i < n; i++) if (pass[i]) count[dist2[i]]++;
  for (let k = top; k > 0; k--) count[k - 1] += count[k];
  // `count[k]` is now how many cells are at least `k` from a wall, so bucket
  // `k` fills `[count[k + 1], count[k])` and the widest come first.
  const order = new Int32Array(count[0]);
  for (let i = 0; i < n; i++) if (pass[i]) order[--count[dist2[i]]] = i;
  return order;
}

/** One sweep of {@link widestWays}: add cells widest first, joining each to
 *  its neighbours and to any end it is part of, until every pair has met. */
function sweep(
  order: Int32Array,
  dist2: Float64Array,
  cellsX: number,
  cellsZ: number,
  ends: WayEnd[],
  pairs: [number, number][],
  endsOf: (cell: number, x: number, z: number) => number[] | undefined,
): Way[] {
  const n = dist2.length;
  // Each end is a node after the cells, so an edge can join every cell on it.
  const parent = new Int32Array(n + ends.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  // Whether an area holds an end, so the pairs are only checked when two
  // areas that both do are joined, which happens fewer times than there are
  // ends.
  const holdsEnd = new Uint8Array(n + ends.length);
  for (let e = 0; e < ends.length; e++) holdsEnd[n + e] = 1;
  let met = false;
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (holdsEnd[ra] && holdsEnd[rb]) met = true;
    parent[ra] = rb;
    holdsEnd[rb] |= holdsEnd[ra];
  };
  const active = new Uint8Array(n);
  const ways: (Way | undefined)[] = pairs.map(() => undefined);
  let open = pairs.length;
  for (let k = 0; k < order.length && open > 0; k++) {
    const i = order[k];
    active[i] = 1;
    const x = i % cellsX;
    const z = (i - x) / cellsX;
    for (let dz = -1; dz <= 1; dz++) {
      const nz = z + dz;
      if (nz < 0 || nz >= cellsZ) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= cellsX) continue;
        const j = nz * cellsX + nx;
        if (active[j]) join(i, j);
      }
    }
    for (const e of endsOf(i, x, z) ?? []) join(i, n + e);
    if (!met) continue;
    met = false;
    for (let p = 0; p < pairs.length; p++) {
      if (ways[p]) continue;
      const [a, b] = pairs[p];
      if (find(n + a) !== find(n + b)) continue;
      ways[p] = {
        from: ends[a],
        to: ends[b],
        width: Math.max(0, 2 * Math.sqrt(dist2[i]) - 1) * CELL,
        x: (x + 0.5) * CELL,
        z: (z + 0.5) * CELL,
      };
      open--;
    }
  }
  return pairs.map(
    ([a, b], p) =>
      ways[p] ?? { from: ends[a], to: ends[b], width: null, x: 0, z: 0 },
  );
}

/** Sliding minimum or maximum over `w` items along one axis. */
function slide(
  src: Float32Array,
  dst: Float32Array,
  lines: number,
  length: number,
  lineStride: number,
  step: number,
  w: number,
  max: boolean,
) {
  const outLen = length - w + 1;
  const dq = new Int32Array(length);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStride;
    let head = 0;
    let tail = 0;
    for (let i = 0; i < length; i++) {
      const value = src[base + i * step];
      while (tail > head) {
        const last = src[base + dq[tail - 1] * step];
        if (max ? last <= value : last >= value) tail--;
        else break;
      }
      dq[tail++] = i;
      if (dq[head] <= i - w) head++;
      const o = i - w + 1;
      if (o >= 0 && o < outLen)
        dst[base + o * step] = src[base + dq[head] * step];
    }
  }
}

/**
 * Where a building shape stands, by `TestUnitBuildSquare` in
 * `rts/Game/GameHelper.cpp`, the same rule `blueprint/buildable.ts` checks a
 * single placement by.
 *
 * `GetBuildHeight` levels the building to the mean of the four corners round
 * its middle, pulled inside `maxHeightDif` of each and inside the map's range.
 * `CheckTerrainConstraints` then refuses it if any square under it is more than
 * `maxHeightDif` from that height, or outside the def's water depth band. The
 * squares' ground is the mean of each square's four corners. That is one
 * height against the spread of the footprint, so this keeps the lowest and
 * highest square under every footprint rather than a slope per square.
 *
 * Positions are every build square, 16 elmos apart, with the footprint wholly
 * on the map.
 */
export function buildableShare(
  h: Heights,
  spec: BuildingSpec,
  corners = cornerHeights(h),
): { buildable: number; positions: number } {
  const W = h.width;
  const mapx = h.width - 1;
  const mapy = h.height - 1;
  const bx = mapx >> 1;
  const bz = mapy >> 1;
  // Each build square is 2 by 2 squares, so its lowest and highest square
  // ground first, then the footprint's over those.
  const lo = new Float32Array(bx * bz);
  const hi = new Float32Array(bx * bz);
  const square = (x: number, z: number) =>
    (corners[z * W + x] +
      corners[z * W + x + 1] +
      corners[(z + 1) * W + x] +
      corners[(z + 1) * W + x + 1]) /
    4;
  for (let z = 0; z < bz; z++) {
    for (let x = 0; x < bx; x++) {
      const a = square(2 * x, 2 * z);
      const b = square(2 * x + 1, 2 * z);
      const c = square(2 * x, 2 * z + 1);
      const d = square(2 * x + 1, 2 * z + 1);
      lo[z * bx + x] = Math.min(a, b, c, d);
      hi[z * bx + x] = Math.max(a, b, c, d);
    }
  }
  const fx = Math.max(1, Math.round(spec.footprintX));
  const fz = Math.max(1, Math.round(spec.footprintZ));
  if (fx > bx || fz > bz) return { buildable: 0, positions: 0 };
  const loX = new Float32Array(bx * bz);
  const hiX = new Float32Array(bx * bz);
  slide(lo, loX, bz, bx, bx, 1, fx, false);
  slide(hi, hiX, bz, bx, bx, 1, fx, true);
  const loXZ = new Float32Array(bx * bz);
  const hiXZ = new Float32Array(bx * bz);
  slide(loX, loXZ, bx, bz, 1, bx, fz, false);
  slide(hiX, hiXZ, bx, bz, 1, bx, fz, true);

  const tolerance = slopeTolerance(spec.maxSlope);
  const shallowest = -spec.minWaterDepth;
  const deepest = -spec.maxWaterDepth;
  let fine = 0;
  let positions = 0;
  for (let z = 0; z + fz <= bz; z++) {
    for (let x = 0; x + fx <= bx; x++) {
      positions++;
      const i = z * bx + x;
      if (loXZ[i] < deepest || hiXZ[i] > shallowest) continue;
      // The corners round the middle: `GetBuildHeight` reads the 2 by 2
      // corners from `(pos - SQUARE_SIZE / 2) / SQUARE_SIZE`, and the middle
      // of a footprint starting at square `2x` is corner `2x + fx`.
      const mx = 2 * x + fx - 1;
      const mz = 2 * z + fz - 1;
      let low = h.minHeight;
      let high = h.maxHeight;
      let sum = 0;
      for (let dz = 0; dz < 2; dz++) {
        for (let dx = 0; dx < 2; dx++) {
          const c = corners[(mz + dz) * W + mx + dx];
          sum += c;
          low = Math.max(low, c - tolerance);
          high = Math.min(high, c + tolerance);
        }
      }
      let level = sum / 4;
      if (level < low && low < high) level = low;
      if (level > high && high > low) level = high;
      if (hiXZ[i] - level > tolerance || level - loXZ[i] > tolerance) continue;
      fine++;
    }
  }
  return { buildable: positions ? fine / positions : 0, positions };
}

/** `MoveDef`'s defaults when a class sets no `maxSlope`
 *  (`MoveDefHandler.cpp`: 60 for a tank or kbot, 15 for a hover). */
const DEFAULT_SLOPE: Record<MoveKind, number | null> = {
  tank: 60,
  kbot: 60,
  hover: 15,
  ship: null,
};

/** `MoveDef::GetDefaultMaxWaterDepth` and `GetDefaultMinWaterDepth`. */
const DEFAULT_MAX_WATER_DEPTH = 1e6;
const DEFAULT_MIN_WATER_DEPTH = -1e6;

function num(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/** The game's movement classes, as `MoveDef`'s constructor reads them. */
export function moveClassSpecs(moveDefs: unknown[]): MoveClassSpec[] {
  const out: MoveClassSpec[] = [];
  for (const entry of moveDefs) {
    if (typeof entry !== "object" || entry === null) continue;
    const def = entry as Record<string, unknown>;
    const name = field(def, "name");
    if (typeof name !== "string" || name.trim() === "") continue;
    const kind = moveDefKind(def);
    const fallbackSlope = DEFAULT_SLOPE[kind];
    out.push({
      name: name.trim(),
      kind,
      footprint: Math.max(1, num(field(def, "footprintx"), 1)),
      maxSlope:
        fallbackSlope === null
          ? null
          : num(field(def, "maxslope"), fallbackSlope),
      depth:
        kind === "ship"
          ? num(field(def, "minwaterdepth"), DEFAULT_MIN_WATER_DEPTH)
          : num(field(def, "maxwaterdepth"), DEFAULT_MAX_WATER_DEPTH),
    });
  }
  return out;
}

/**
 * Two building shapes from the game: the shape most of its buildings share,
 * and its largest. A building is a def with a footprint and no movement class
 * that neither flies nor floats. "This shape" means the footprint and the
 * terrain limits together, since two defs of one footprint with different
 * limits stand on different ground. A floater stands on the water rather than on
 * the ground, so the ground decides nothing for it.
 */
export function buildingSpecs(
  units: Record<string, Record<string, unknown>>,
): BuildingSpec[] {
  const groups = new Map<string, BuildingSpec>();
  for (const key of Object.keys(units).sort()) {
    const def = units[key];
    if (field(def, "movementclass") !== undefined) continue;
    // `UnitDef.cpp` reads `floater` with a default of whether `waterline`
    // is declared at all.
    const floater = field(def, "floater");
    const floats =
      floater !== undefined
        ? flag(floater)
        : field(def, "waterline") !== undefined;
    if (flag(field(def, "canfly")) || floats) continue;
    const fx = num(field(def, "footprintx"), 0);
    const fz = num(field(def, "footprintz"), 0);
    if (fx <= 0 || fz <= 0) continue;
    const spec = {
      footprintX: fx,
      footprintZ: fz,
      maxSlope: Math.min(89, Math.max(0, num(field(def, "maxslope"), 0))),
      minWaterDepth: num(field(def, "minwaterdepth"), -10e6),
      maxWaterDepth: num(field(def, "maxwaterdepth"), 10e6),
    };
    const id = JSON.stringify(spec);
    const known = groups.get(id);
    if (known) known.defs++;
    else groups.set(id, { name: key, defs: 1, ...spec });
  }
  const all = [...groups.values()];
  if (all.length === 0) return [];
  const common = all.reduce((a, b) => (b.defs > a.defs ? b : a));
  const largest = all.reduce((a, b) =>
    b.footprintX * b.footprintZ > a.footprintX * a.footprintZ ? b : a,
  );
  return common === largest ? [common] : [common, largest];
}

export interface PlayabilityJob {
  heights: Heights;
  classes: MoveClassSpec[];
  buildings: BuildingSpec[];
  /** Start positions in elmos. */
  starts: { x: number; z: number }[];
  /** The map's metal map and extractor radius, when it could be read. */
  metal?: { grid: MetalGrid; extractorRadius: number };
}

/** Every measurement for one map and one game's classes and buildings. */
export function measurePlayability(job: PlayabilityJob): Playability {
  const { heights } = job;
  const corners = cornerHeights(heights);
  const map = slopeMap(heights, corners);
  const { cellsX, cellsZ } = map;
  const total = cellsX * cellsZ;
  // Classes that differ only by name or footprint pass the same cells, so
  // each distinct test is run once.
  const byTest = new Map<
    string,
    { pass: Uint8Array; sizes: number[]; ways: Way[] }
  >();
  const classes = job.classes.map((spec): ClassResult => {
    const test =
      spec.kind === "ship"
        ? `ship:${spec.depth}`
        : `${spec.kind === "hover" ? "hover" : "ground"}:${spec.maxSlope}:${spec.kind === "hover" ? "" : spec.depth}`;
    let measured = byTest.get(test);
    if (!measured) {
      const pass = passableCells(map, spec);
      const { sizes } = areas(pass, cellsX, cellsZ);
      const ways = widestWays(
        pass,
        clearance(pass, cellsX, cellsZ),
        cellsX,
        cellsZ,
        job.starts,
      );
      measured = { pass, sizes, ways };
      byTest.set(test, measured);
    }
    let passable = 0;
    for (const p of measured.pass) passable += p;
    let largest = 0;
    for (const s of measured.sizes) if (s > largest) largest = s;
    // A footprint of `n` squares covers `ceil(n / 2)` cells a side.
    const side = Math.ceil(spec.footprint / 2);
    return {
      ...spec,
      passable: total ? passable / total : 0,
      largest: total ? largest / total : 0,
      areas: measured.sizes.filter((s) => s >= side * side).length,
      ways: measured.ways,
    };
  });
  const buildings = job.buildings.map((spec) => ({
    ...spec,
    ...buildableShare(heights, spec, corners),
  }));
  const metal = job.metal
    ? measureMetal(job.metal.grid, job.metal.extractorRadius, job.starts)
    : null;
  return { cellsX, cellsZ, classes, buildings, metal };
}
