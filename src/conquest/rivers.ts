import type { BiomePattern, Planet } from "./planets";

/**
 * Display-only rivers for generated land. The generator's heightmap has no
 * drainage and is pinned by golden fixtures and challenge codes, so rivers
 * are worked out from it here, for the strategic view alone, as roads are.
 *
 * On a half resolution copy of the heights, a priority flood fills every
 * closed basin up to its lip, with a tiny rise on each step so flats still
 * drain. Each cell's flow goes to the neighbour the flood reached it from,
 * which is its lowest neighbour on the filled ground, so every cell drains to
 * the sea, a lake or the edge of the picture. Rain falls on every land cell,
 * less on desert, and a cell whose drained rain passes a share of the land is
 * river. Each river is traced from its source down to the sea or to the
 * river it joins, smoothed, and given a half width that grows with the land
 * upstream and flares into an estuary at the coast.
 *
 * Nothing here feeds play. The same heights always give the same rivers.
 */

/** Patterns of ground that get little rain, so few rivers rise there. */
const DESERT_PATTERNS: readonly BiomePattern[] = [
  "sand",
  "dunes",
  "salt",
  "dust",
  "cracked",
];

/**
 * How much of each pixel is desert, 0 to 1, from the generator's weights:
 * `a` holds slots 0 to 3 and `b` slots 4 to 7, as RGBA bytes.
 */
export function desertShare(
  a: Uint8Array,
  b: Uint8Array,
  planet: Planet,
): Float32Array {
  const desert = planet.biomes.map((biome) =>
    DESERT_PATTERNS.includes(biome.pattern),
  );
  const out = new Float32Array(a.length / 4);
  for (let i = 0; i < out.length; i++) {
    let all = 0;
    let dry = 0;
    for (let k = 0; k < 8; k++) {
      const w = k < 4 ? a[i * 4 + k] : b[i * 4 + k - 4];
      all += w;
      if (desert[k]) dry += w;
    }
    out[i] = all > 0 ? dry / all : 0;
  }
  return out;
}

/** A river's course, as x, y and half width triples in pixels of the picture it was found on. */
export interface RiverLine {
  points: Float32Array;
  /**
   * How the river ends: in the sea or a lake, off the edge of the picture,
   * or by joining the river at `joins`.
   */
  end: "sea" | "edge" | "join";
  /** The index of the river this one joins, for `end: "join"`. */
  joins: number;
}

/** Share of the land cells whose rain a cell must drain to be river. */
const RIVER_SHARE = 0.006;
/** Rain on a cell of pure desert, against 1 on any other land. */
const DESERT_RAIN = 0.15;
/** How much narrower a river is in pure desert. */
const DESERT_THIN = 0.45;
/** Half width in full resolution pixels where a river starts. */
const SOURCE_HALF_WIDTH = 0.25;
/** The widest a river's half width grows inland, in full resolution pixels. */
const MOST_HALF_WIDTH = 0.9;
/** Points before the sea over which a river flares into its estuary. */
const ESTUARY_POINTS = 10;
/** How much wider a river is at its mouth than above its estuary. */
const ESTUARY_FLARE = 1.2;
/** A river shorter than this many cells, with none running into it, is left out. */
const SHORTEST_BRANCH = 8;
/** The rise the flood gives each step over a filled basin or a flat. */
const FLOOD_RISE = 1e-7;

/** A binary heap of cell indices, lowest key first. */
class MinHeap {
  readonly cells: Int32Array;
  readonly keys: Float64Array;
  size = 0;
  constructor(capacity: number) {
    this.cells = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }
  push(cell: number, key: number): void {
    const { cells, keys } = this;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      cells[i] = cells[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    cells[i] = cell;
    keys[i] = key;
  }
  pop(): number {
    const { cells, keys } = this;
    const top = cells[0];
    const n = --this.size;
    const lastCell = cells[n];
    const lastKey = keys[n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && keys[r] < keys[l] ? r : l;
      if (keys[c] >= lastKey) break;
      cells[i] = cells[c];
      keys[i] = keys[c];
      i = c;
    }
    cells[i] = lastCell;
    keys[i] = lastKey;
    return top;
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Where each cell drains and how much rain passes through it. */
export interface Drainage {
  /**
   * The cell each land cell drains into, which is water at a river mouth, or
   * -2 off the edge. -1 on water.
   */
  down: Int32Array;
  /** Rain drained through each cell, its own included. 0 on water. */
  flow: Float32Array;
  /** 1 for sea or lake. */
  water: Uint8Array;
}

/**
 * Drainage over `h`, `width` by `height` heights where 0 is water. `rain` is
 * each cell's rain, 1 where left out.
 */
export function drainage(
  h: Float32Array,
  width: number,
  height: number,
  rain?: Float32Array,
): Drainage {
  const count = width * height;
  const water = new Uint8Array(count);
  for (let i = 0; i < count; i++) water[i] = h[i] <= 0 ? 1 : 0;
  const filled = new Float64Array(count);
  const down = new Int32Array(count).fill(-1);
  const seen = new Uint8Array(count);
  const heap = new MinHeap(count);
  const pit = new Int32Array(count);
  let pitHead = 0;
  let pitTail = 0;
  const order = new Int32Array(count);
  let ordered = 0;

  // The flood starts from the water and from land on the picture's edge,
  // whose rain runs off it.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (water[i]) {
        seen[i] = 1;
        let shore = false;
        for (let k = 0; k < 8 && !shore; k++) {
          const nx = x + DX[k];
          const ny = y + DY[k];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (!water[ny * width + nx]) shore = true;
        }
        if (shore) heap.push(i, 0);
      } else if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        seen[i] = 1;
        down[i] = -2;
        filled[i] = h[i];
        heap.push(i, h[i]);
      }
    }
  }

  while (pitHead < pitTail || heap.size > 0) {
    const c = pitHead < pitTail ? pit[pitHead++] : heap.pop();
    if (!water[c]) order[ordered++] = c;
    const cx = c % width;
    const cy = (c - cx) / width;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k];
      const ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (seen[n]) continue;
      seen[n] = 1;
      down[n] = c;
      if (h[n] <= filled[c]) {
        filled[n] = filled[c] + FLOOD_RISE;
        pit[pitTail++] = n;
      } else {
        filled[n] = h[n];
        heap.push(n, h[n]);
      }
    }
  }

  // Every cell drains to one the flood reached before it, so going through
  // them backwards passes each cell's rain on before its own is counted.
  const flow = new Float32Array(count);
  for (let k = ordered - 1; k >= 0; k--) {
    const c = order[k];
    flow[c] += rain ? rain[c] : 1;
    const d = down[c];
    if (d >= 0 && !water[d]) flow[d] += flow[c];
  }
  return { down, flow, water };
}

/** Smooth a run of points by a moving mean, `passes` times, ends kept. */
function smooth(points: number[][], reach: number, passes: number): void {
  for (let pass = 0; pass < passes; pass++) {
    const was = points.map((p) => p.slice());
    for (let k = 1; k < points.length - 1; k++) {
      // Near an end the window shrinks, so the end stays put.
      const r = Math.min(reach, k, points.length - 1 - k);
      let sx = 0;
      let sy = 0;
      for (let j = k - r; j <= k + r; j++) {
        sx += was[j][0];
        sy += was[j][1];
      }
      points[k][0] = sx / (2 * r + 1);
      points[k][1] = sy / (2 * r + 1);
    }
  }
}

/** Cut each corner a quarter of the way along both sides, `rounds` times. */
function roundCorners(points: number[][], rounds: number): number[][] {
  let out = points;
  for (let r = 0; r < rounds && out.length > 2; r++) {
    const next: number[][] = [out[0]];
    for (let k = 0; k < out.length - 1; k++) {
      const a = out[k];
      const b = out[k + 1];
      const at = (f: number) => a.map((v, j) => v * (1 - f) + b[j] * f);
      if (k > 0) next.push(at(0.25));
      if (k < out.length - 2) next.push(at(0.75));
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/**
 * The rivers on `relief`, `width` by `height` heights from 0 to 1 where 0 is
 * sea or lake. `dryness` is how much of each pixel is desert, 0 to 1. Points
 * are in the same pixels.
 */
export function findRivers(
  relief: Float32Array,
  width: number,
  height: number,
  dryness?: Float32Array,
): RiverLine[] {
  const hw = Math.ceil(width / 2);
  const hh = Math.ceil(height / 2);
  if (hw < 4 || hh < 4) return [];

  // Half resolution: a cell is water when most of it is, and otherwise the
  // mean of its land.
  const half = new Float32Array(hw * hh);
  const dry = new Float32Array(hw * hh);
  const rain = new Float32Array(hw * hh);
  let land = 0;
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      let sum = 0;
      let lands = 0;
      let drySum = 0;
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          const s =
            Math.min(height - 1, y * 2 + oy) * width +
            Math.min(width - 1, x * 2 + ox);
          const v = relief[s];
          if (dryness) drySum += dryness[s];
          if (v > 0) {
            sum += v;
            lands++;
          }
        }
      }
      const c = y * hw + x;
      dry[c] = drySum / 4;
      if (lands >= 3) {
        half[c] = sum / lands;
        rain[c] = 1 - (1 - DESERT_RAIN) * dry[c];
        land++;
      }
    }
  }

  const { down, flow, water } = drainage(half, hw, hh, rain);
  const threshold = Math.max(4, land * RIVER_SHARE);
  const isRiver = (c: number) => !water[c] && flow[c] >= threshold;

  // A source is a river cell no river cell drains into.
  const fed = new Uint8Array(hw * hh);
  for (let c = 0; c < hw * hh; c++) {
    if (isRiver(c) && down[c] >= 0) fed[down[c]] = 1;
  }
  const lineOf = new Int32Array(hw * hh).fill(-1);
  const courses: { cells: number[]; end: RiverLine["end"]; joins: number }[] =
    [];
  for (let s = 0; s < hw * hh; s++) {
    if (!isRiver(s) || fed[s]) continue;
    const cells: number[] = [];
    let end: RiverLine["end"] = "edge";
    let joins = -1;
    let c = s;
    for (;;) {
      if (lineOf[c] >= 0) {
        cells.push(c);
        end = "join";
        joins = lineOf[c];
        break;
      }
      lineOf[c] = courses.length;
      cells.push(c);
      const d = down[c];
      if (d === -2) break;
      if (water[d]) {
        cells.push(d);
        end = "sea";
        break;
      }
      c = d;
    }
    courses.push({ cells, end, joins });
  }

  // Short rivers are noise along a bigger river or the coast. One that
  // another river runs into is kept, so no river is left ending short of the
  // rest.
  const joined = new Uint8Array(courses.length);
  for (const course of courses) if (course.joins >= 0) joined[course.joins] = 1;
  const kept: number[] = [];
  const newIndex = new Int32Array(courses.length).fill(-1);
  courses.forEach((course, k) => {
    const stub = course.cells.length < SHORTEST_BRANCH && !joined[k];
    if (stub) return;
    newIndex[k] = kept.length;
    kept.push(k);
  });

  const toPixel = (v: number, size: number) => Math.min(size - 1, v * 2 + 0.5);
  const halfWidth = (c: number) => {
    const grow = Math.sqrt(flow[c] / threshold) - 1;
    const w = Math.min(MOST_HALF_WIDTH, SOURCE_HALF_WIDTH * (1 + grow * 0.9));
    return w * (1 - DESERT_THIN * dry[c]);
  };
  return kept.map((k) => {
    const course = courses[k];
    const { cells } = course;
    const pts = cells.map((c) => {
      const x = c % hw;
      const y = (c - x) / hw;
      // A cell in the sea takes the width of the river reaching it.
      const from = water[c] && cells.length > 1 ? cells[cells.length - 2] : c;
      return [toPixel(x, width), toPixel(y, height), halfWidth(from)];
    });
    if (course.end === "sea") {
      for (let j = 0; j < Math.min(ESTUARY_POINTS, pts.length); j++) {
        const t = 1 - j / ESTUARY_POINTS;
        pts[pts.length - 1 - j][2] *= 1 + ESTUARY_FLARE * t * t * t;
      }
    }
    smooth(pts, 3, 2);
    const round = roundCorners(pts, 2);
    const points = new Float32Array(round.length * 3);
    round.forEach((p, j) => {
      points.set(p, j * 3);
    });
    const joins = course.end === "join" ? newIndex[course.joins] : -1;
    return { points, end: course.end, joins };
  });
}

/** The edge field's range below zero, inside a river, in pixels. */
export const RIVER_EDGE_INSIDE = 4;
/** The edge field's range above zero, beside a river, in pixels. */
export const RIVER_EDGE_OUTSIDE = 4;
/**
 * Texels of the edge field per pixel of the picture, along each side. A
 * blended texel reads up to half a texel too far from a river's middle, so at
 * 3 a river at its narrowest, {@link SOURCE_HALF_WIDTH}, still reads as
 * water all along and not as dashes, which it did at 2.
 */
export const RIVER_EDGE_TEXELS = 3;

/** The edge field: see {@link riverEdgePixels}. */
export interface RiverEdge {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * How far each point lies from the nearest river's edge, for a picture
 * `width` by `height` pixels, at {@link RIVER_EDGE_TEXELS} texels a pixel.
 * One byte a texel, row by row from the top left: 0 is
 * {@link RIVER_EDGE_INSIDE} pixels inside a river, 255 is
 * {@link RIVER_EDGE_OUTSIDE} pixels outside one or further, in a straight
 * line between. Texel `i` stands for pixel `(i + 0.5) / RIVER_EDGE_TEXELS - 0.5`,
 * so the field lies over the picture as a texture does.
 */
export function riverEdgePixels(
  lines: readonly RiverLine[],
  width: number,
  height: number,
): RiverEdge {
  const tw = width * RIVER_EDGE_TEXELS;
  const th = height * RIVER_EDGE_TEXELS;
  const span = RIVER_EDGE_INSIDE + RIVER_EDGE_OUTSIDE;
  const best = new Float32Array(tw * th).fill(RIVER_EDGE_OUTSIDE);
  const pixelOf = (t: number) => (t + 0.5) / RIVER_EDGE_TEXELS - 0.5;
  const texelOf = (p: number) => (p + 0.5) * RIVER_EDGE_TEXELS - 0.5;
  for (const { points } of lines) {
    for (let k = 0; k + 5 < points.length; k += 3) {
      const ax = points[k];
      const ay = points[k + 1];
      const aw = points[k + 2];
      const bx = points[k + 3];
      const by = points[k + 4];
      const bw = points[k + 5];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const inv = len2 === 0 ? 0 : 1 / len2;
      const reach = Math.max(aw, bw) + RIVER_EDGE_OUTSIDE;
      const i0 = Math.max(0, Math.floor(texelOf(Math.min(ax, bx) - reach)));
      const i1 = Math.min(tw - 1, Math.ceil(texelOf(Math.max(ax, bx) + reach)));
      const j0 = Math.max(0, Math.floor(texelOf(Math.min(ay, by) - reach)));
      const j1 = Math.min(th - 1, Math.ceil(texelOf(Math.max(ay, by) + reach)));
      for (let j = j0; j <= j1; j++) {
        const ry = pixelOf(j) - ay;
        for (let i = i0; i <= i1; i++) {
          const rx = pixelOf(i) - ax;
          let t = (rx * dx + ry * dy) * inv;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = dx * t - rx;
          const ey = dy * t - ry;
          const edge = Math.sqrt(ex * ex + ey * ey) - (aw + (bw - aw) * t);
          const at = j * tw + i;
          if (edge < best[at]) best[at] = edge;
        }
      }
    }
  }
  const data = new Uint8Array(tw * th);
  for (let at = 0; at < data.length; at++) {
    const v = (best[at] + RIVER_EDGE_INSIDE) / span;
    data[at] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
  }
  return { data, width: tw, height: th };
}
