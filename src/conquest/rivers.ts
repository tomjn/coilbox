import type { DrainNetwork } from "./displayErosion";
import type { BiomePattern, Planet } from "./planets";

/**
 * Display-only rivers for generated land. The generator's heightmap is pinned
 * by golden fixtures and challenge codes, so rivers are worked out for the
 * strategic view alone, as roads are.
 *
 * Rivers follow the channels the display erosion cut (`displayErosion.ts`):
 * its half resolution tree of where each cell drains. A cell is river once
 * enough rain drains through it, and since rain only gathers downstream, every
 * river cell drains into another river cell or leaves the land. The rivers
 * are that tree drawn as lines, each tributary ending on a point of the river
 * it joins, so branches meet their parent by construction.
 *
 * Each river also cuts a valley of its own into the heights the light comes
 * from, so it lies in relief the view can show even where the land is flat.
 *
 * Nothing here feeds play. The same land always gives the same rivers.
 */

/**
 * A river's course as x, y and half width triples. x and y are in pixels of
 * the picture it was found on, with pixel `i` spanning `i` to `i + 1`, so a
 * point's texture coordinate is its x over the picture's width. The half
 * width is in world units.
 */
export interface RiverLine {
  points: Float32Array;
  /** The index of the river this one runs into, or -1 for one that reaches the sea or the picture's edge. */
  joins: number;
}

/** Patterns of ground where little rain falls, and how dry each is. */
const DRY_PATTERNS: Partial<Record<BiomePattern, number>> = {
  dunes: 1,
  sand: 1,
  salt: 1,
  dust: 1,
  cracked: 1,
  scrub: 0.5,
};

/**
 * How dry each half resolution cell is, 0 to 1, from the generator's weights
 * at full resolution: `a` holds slots 0 to 3 and `b` slots 4 to 7, as RGBA
 * bytes, `width` by `height` pixels.
 */
export function halfDryness(
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
  planet: Planet,
): Float32Array {
  const dry = planet.biomes.map((biome) => DRY_PATTERNS[biome.pattern] ?? 0);
  const hw = Math.ceil(width / 2);
  const hh = Math.ceil(height / 2);
  const out = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      let all = 0;
      let sum = 0;
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          const i =
            Math.min(height - 1, y * 2 + oy) * width +
            Math.min(width - 1, x * 2 + ox);
          for (let k = 0; k < dry.length; k++) {
            const w = k < 4 ? a[i * 4 + k] : b[i * 4 + k - 4];
            all += w;
            sum += w * dry[k];
          }
        }
      }
      out[y * hw + x] = all > 0 ? sum / all : 0;
    }
  }
  return out;
}

/** Rain on a cell of the driest ground, against 1 on any other. */
const DRY_RAIN = 0.12;
/**
 * Half width where a river starts and the most it reaches inland, in world
 * units. A road's track is 0.11 to 0.17 across, so a stream is narrower than
 * a dirt track and the biggest river is about as wide as a main road. A
 * town is 1.6 or more across.
 */
const SOURCE_HALF_WIDTH = 0.03;
const MOST_HALF_WIDTH = 0.062;
/** The rain drained, as a multiple of the river's start, at which it is widest. */
const WIDEST_AT = 16;
/** How much narrower a river is where the ground is driest. */
const DRY_THIN = 0.4;
/** Points before the sea over which a river widens into its mouth, and by how much. */
const MOUTH_POINTS = 6;
const MOUTH_FLARE = 0.8;
/** A tributary of fewer cells than this is left out, with any branches of its own. */
const SHORTEST_BRANCH = 6;
/** Smoothing: passes of a moving mean over this many points either side. */
const SMOOTH_REACH = 2;
const SMOOTH_PASSES = 3;

/**
 * The rivers on `network`, the half resolution drainage of a picture `width`
 * by `height` pixels. A cell is river once `drained` cells' worth of rain
 * drains through it, rain being 1 a cell and less on dry ground (`dryness`,
 * per half resolution cell). Rivers come parents first.
 */
export function findRivers(
  network: DrainNetwork,
  drained: number,
  dryness?: Float32Array,
): RiverLine[] {
  const { width: hw, height: hh, to, order, reached } = network;
  const count = hw * hh;
  const rain = new Float32Array(count);
  for (let k = reached - 1; k >= 0; k--) {
    const i = order[k];
    rain[i] += dryness ? 1 - (1 - DRY_RAIN) * dryness[i] : 1;
    if (to[i] >= 0) rain[to[i]] += rain[i];
  }
  const isRiver = new Uint8Array(count);
  for (let k = 0; k < reached; k++) {
    const i = order[k];
    if (rain[i] >= drained) isRiver[i] = 1;
  }
  // Each river cell's upstream river cells, as linked lists.
  const first = new Int32Array(count).fill(-1);
  const next = new Int32Array(count).fill(-1);
  // Lowest first, so each list is in a fixed order.
  for (let k = reached - 1; k >= 0; k--) {
    const i = order[k];
    if (!isRiver[i] || to[i] < 0) continue;
    next[i] = first[to[i]];
    first[to[i]] = i;
  }
  // The upstream cell that carries the most is the same river. Ties go to
  // the cell listed first.
  const main = (c: number) => {
    let best = -1;
    for (let u = first[c]; u >= 0; u = next[u]) {
      if (best < 0 || rain[u] > rain[best]) best = u;
    }
    return best;
  };

  const halfWidth = (c: number) => {
    const grow = Math.min(
      1,
      (Math.sqrt(rain[c] / drained) - 1) / (Math.sqrt(WIDEST_AT) - 1),
    );
    const w = SOURCE_HALF_WIDTH + (MOST_HALF_WIDTH - SOURCE_HALF_WIDTH) * grow;
    return w * (1 - DRY_THIN * (dryness ? dryness[c] : 0));
  };
  const at = (c: number): [number, number] => {
    const x = c % hw;
    return [x * 2 + 1, ((c - x) / hw) * 2 + 1];
  };

  interface Pending {
    /** The cell the course starts down from, at its far upstream end. */
    from: number;
    /** The river it joins and the point of that river's course it ends on. */
    parent: number;
    meet: number;
  }
  const out: RiverLine[] = [];
  const queue: Pending[] = [];
  for (let k = 0; k < reached; k++) {
    const i = order[k];
    if (isRiver[i] && to[i] < 0) queue.push({ from: i, parent: -1, meet: -1 });
  }
  for (let q = 0; q < queue.length; q++) {
    const { from, parent, meet } = queue[q];
    // Up the main stem to the source, then turned to run downstream.
    const cells: number[] = [];
    for (let c = from; c >= 0; c = main(c)) cells.push(c);
    cells.reverse();
    if (parent >= 0 && cells.length < SHORTEST_BRANCH) continue;
    const pts: number[][] = cells.map((c) => [...at(c), halfWidth(c)]);
    const last = cells[cells.length - 1];
    if (parent >= 0) {
      // On to the cell it runs into, which is the parent's.
      pts.push([...at(to[last]), halfWidth(last)]);
    } else {
      // Into the sea: carry on a cell in the same direction, so the water
      // runs out under the shore.
      const n = pts.length;
      if (n >= 2) {
        const [ax, ay] = pts[n - 2];
        const [bx, by, bw] = pts[n - 1];
        pts.push([bx * 2 - ax, by * 2 - ay, bw]);
      }
      const flare = Math.min(MOUTH_POINTS, pts.length);
      for (let j = 0; j < flare; j++) {
        const t = 1 - j / MOUTH_POINTS;
        pts[pts.length - 1 - j][2] *= 1 + MOUTH_FLARE * t * t;
      }
    }
    // A point between every two, so smoothing bends the course gently.
    const dense: number[][] = [];
    pts.forEach((p, k) => {
      if (k > 0) {
        const o = pts[k - 1];
        dense.push([(o[0] + p[0]) / 2, (o[1] + p[1]) / 2, (o[2] + p[2]) / 2]);
      }
      dense.push(p.slice());
    });
    if (parent >= 0) {
      // Ends on the parent's own point for that cell, wherever smoothing
      // moved it.
      const pp = out[parent].points;
      const end = dense[dense.length - 1];
      end[0] = pp[meet * 3];
      end[1] = pp[meet * 3 + 1];
      end[2] = Math.min(end[2], pp[meet * 3 + 2]);
    }
    smooth(dense);
    const index = out.length;
    const points = new Float32Array(dense.length * 3);
    dense.forEach((p, k) => {
      points.set(p, k * 3);
    });
    out.push({ points, joins: parent });
    // Every other river running into this one, joining at the point of this
    // course its cell became. Cell k of `cells` is point 2k of `dense`.
    cells.forEach((c, k) => {
      const stem = k > 0 ? cells[k - 1] : -1;
      for (let u = first[c]; u >= 0; u = next[u]) {
        if (u !== stem) queue.push({ from: u, parent: index, meet: k * 2 });
      }
    });
  }
  return out;
}

/** Moving means over a course of triples, its two ends kept where they are. */
function smooth(points: number[][]): void {
  const n = points.length;
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const was = points.map((p) => [p[0], p[1]]);
    for (let k = 1; k < n - 1; k++) {
      const r = Math.min(SMOOTH_REACH, k, n - 1 - k);
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

/**
 * Calls `visit(i, edge, t, k)` for every pixel centre of a `width` by `height`
 * grid lying within `reach` world units of a river's edge, where `edge` is
 * the pixel's distance from the edge in world units, below 0 on the water, and
 * the nearest point lies `t` of the way along segment `k`. `perPixel` is world
 * units per pixel. A pixel near two segments is visited for both.
 */
function eachNear(
  points: Float32Array,
  width: number,
  height: number,
  perPixel: number,
  reach: number,
  visit: (i: number, edge: number, t: number, k: number) => void,
): void {
  const n = points.length / 3;
  for (let k = 0; k + 1 < n; k++) {
    const ax = points[k * 3];
    const ay = points[k * 3 + 1];
    const aw = points[k * 3 + 2];
    const bx = points[k * 3 + 3];
    const by = points[k * 3 + 4];
    const bw = points[k * 3 + 5];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const inv = len2 === 0 ? 0 : 1 / len2;
    const span = (Math.max(aw, bw) + reach) / perPixel;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - span - 0.5));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + span - 0.5));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - span - 0.5));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by) + span - 0.5));
    for (let y = y0; y <= y1; y++) {
      const ry = y + 0.5 - ay;
      for (let x = x0; x <= x1; x++) {
        const rx = x + 0.5 - ax;
        let t = (rx * dx + ry * dy) * inv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = dx * t - rx;
        const ey = dy * t - ry;
        const edge =
          Math.sqrt(ex * ex + ey * ey) * perPixel - (aw + (bw - aw) * t);
        if (edge <= reach) visit(y * width + x, edge, t, k);
      }
    }
  }
}

/** Depth of a river's bed below the ground beside it, in heights out of 1, for the smallest river and the biggest. */
const BED_DEPTH = [0.006, 0.015];
/** The most of the ground's height above the sea a valley may take. */
const BED_SHARE = 0.6;
/** How far a valley's sides reach past the water, in world units, for the smallest river and the biggest. */
const VALLEY_REACH = [0.6, 1.4];

/**
 * `relief` with a valley cut along every river, for the light alone: a bed
 * under the water that never climbs downstream, and sides that rise in a
 * smooth curve to the ground. `relief` is `width` by `height` heights from 0
 * to 1, `perPixel` world units a pixel, and is left alone. The sea, at 0,
 * stays as it is.
 */
export function carveRiverValleys(
  relief: Float32Array,
  width: number,
  height: number,
  rivers: readonly RiverLine[],
  perPixel: number,
): Float32Array {
  const out = relief.slice();
  const sample = (x: number, y: number) =>
    relief[
      Math.min(height - 1, Math.max(0, Math.floor(y))) * width +
        Math.min(width - 1, Math.max(0, Math.floor(x)))
    ];
  for (const { points } of rivers) {
    const n = points.length / 3;
    const size = new Float32Array(n);
    const bed = new Float32Array(n);
    let low = Number.POSITIVE_INFINITY;
    for (let k = 0; k < n; k++) {
      size[k] = Math.min(
        1,
        Math.max(
          0,
          (points[k * 3 + 2] - SOURCE_HALF_WIDTH) /
            (MOST_HALF_WIDTH - SOURCE_HALF_WIDTH),
        ),
      );
      const ground = sample(points[k * 3], points[k * 3 + 1]);
      const depth = BED_DEPTH[0] + (BED_DEPTH[1] - BED_DEPTH[0]) * size[k];
      if (ground > 0) low = Math.min(low, ground);
      const floor =
        low === Number.POSITIVE_INFINITY
          ? 0
          : Math.max(low - depth, ground * (1 - BED_SHARE));
      bed[k] = Math.max(0, Math.min(floor, ground * (1 - BED_SHARE * 0.5)));
    }
    const reach = VALLEY_REACH[1];
    eachNear(points, width, height, perPixel, reach, (i, edge, t, k) => {
      if (relief[i] <= 0) return;
      const s = size[k] + (size[k + 1] - size[k]) * t;
      const side = VALLEY_REACH[0] + (VALLEY_REACH[1] - VALLEY_REACH[0]) * s;
      const f = Math.min(1, Math.max(0, edge / side));
      const rise = f * f * (3 - 2 * f);
      const floor = bed[k] + (bed[k + 1] - bed[k]) * t;
      const target = floor + (out[i] - floor) * rise;
      if (target < out[i]) out[i] = Math.max(1e-4, target);
    });
  }
  return out;
}

/**
 * How far into a river the edge field reads, and how far beside it, in world
 * units. Beside it covers the wet bank and the valley floor's damp ground.
 */
export const RIVER_FIELD_INSIDE = 0.12;
export const RIVER_FIELD_OUTSIDE = 0.9;
/** The most texels along the field's longer side. */
const FIELD_MOST_TEXELS = 4096;
/** The coarsest texel wanted, in world units. */
const FIELD_TEXEL = 0.04;

/**
 * How far each point lies from the nearest river's edge, one byte a texel,
 * row by row from the top left, over the same picture the rivers were found
 * on. 0 is {@link RIVER_FIELD_INSIDE} into the water and 255 is
 * {@link RIVER_FIELD_OUTSIDE} beside it or further, in a straight line
 * between. Texel `i` covers the same share of the picture a texture's would.
 */
export interface RiverField {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * The texels along each side of the field for a picture `width` by `height`
 * pixels of `perPixel` world units.
 */
export function riverFieldSize(
  width: number,
  height: number,
  perPixel: number,
): { width: number; height: number; texel: number } {
  const long = Math.max(width, height);
  const along = Math.min(
    FIELD_MOST_TEXELS,
    Math.ceil((long * perPixel) / FIELD_TEXEL),
  );
  return {
    width: Math.max(1, Math.round((along * width) / long)),
    height: Math.max(1, Math.round((along * height) / long)),
    texel: (long * perPixel) / along,
  };
}

/**
 * The narrowest half width a river may be drawn at on a field of `texel`
 * world units. A blended field reads up to half a texel too far from a
 * river's middle, so anything narrower would break into dashes.
 */
export function narrowestHalfWidth(texel: number): number {
  return Math.max(SOURCE_HALF_WIDTH, texel * 0.65);
}

/** The {@link RiverField} for `rivers` on a picture `width` by `height` pixels. */
export function riverFieldPixels(
  rivers: readonly RiverLine[],
  width: number,
  height: number,
  perPixel: number,
): RiverField {
  const size = riverFieldSize(width, height, perPixel);
  const scale = size.width / width;
  const data = new Uint8Array(size.width * size.height).fill(255);
  const span = RIVER_FIELD_INSIDE + RIVER_FIELD_OUTSIDE;
  for (const { points } of rivers) {
    // In texels of the field, where pixel i spans texels i * scale onwards.
    const scaled = points.slice();
    for (let k = 0; k < scaled.length; k += 3) {
      scaled[k] *= scale;
      scaled[k + 1] *= scale;
    }
    eachNear(
      scaled,
      size.width,
      size.height,
      perPixel / scale,
      RIVER_FIELD_OUTSIDE,
      (i, edge) => {
        const v = Math.round(
          (Math.max(0, edge + RIVER_FIELD_INSIDE) / span) * 255,
        );
        if (v < data[i]) data[i] = v;
      },
    );
  }
  return { data, width: size.width, height: size.height };
}

/**
 * Every river's half width held to at least {@link narrowestHalfWidth} for
 * the field it will be drawn from, so none breaks into dashes.
 */
export function widenForField(
  rivers: readonly RiverLine[],
  texel: number,
): void {
  const least = narrowestHalfWidth(texel);
  for (const { points } of rivers) {
    for (let k = 2; k < points.length; k += 3) {
      if (points[k] < least) points[k] = least;
    }
  }
}
