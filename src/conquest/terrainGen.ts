import type { GalaxyLayout } from "./generate";
import { hashString, mulberry32, type Rng } from "./rng";

/**
 * Generated land for the Territories and Cities map styles (issues #3505 and
 * #3506): a land mask, a heightmap and a colour image, as plain typed arrays.
 * No canvas and no DOM, so it runs in vitest and in the webview alike.
 *
 * The same seed has to give the same pixels on Windows, macOS and Linux, since
 * a saved map keeps its seed and not its pixels (issue #2167 is the galaxy
 * generator failing at this). So everything here is integer arithmetic or one
 * of the operations IEEE 754 defines exactly: add, subtract, multiply, divide
 * and `Math.sqrt`. There is no `Math.sin`, `Math.cos`, `Math.pow`, `Math.exp`,
 * `Math.log`, `Math.atan2` or `Math.hypot`. Where a shape needs an angle it
 * rotates a unit vector by a fixed step whose sine and cosine are written out
 * as literals. `terrainGolden.test.ts` pins a hash of every array.
 */

/** How the land is arranged, named as the galaxy layouts are. */
export type TerrainShape = GalaxyLayout;

/** Pixels along each side of every generated array. */
export const TERRAIN_PIXELS = 512;
/** Map units along each side. Two per pixel, so a pixel centre is a whole number. */
export const TERRAIN_MAP_UNITS = 1024;
/** Map units of height a white heightmap pixel stands for. */
export const TERRAIN_HEIGHT_SCALE = 64;

/** Default radius, in map units, of the land grown around a `mustBeLand` point. */
export const DEFAULT_LAND_RADIUS = 48;

export interface TerrainOptions {
  seed: number;
  /** Land of the generator's own. Omitted leaves only the land around
   * `mustBeLand`, which is what a map built around given points wants. */
  shape?: TerrainShape;
  /** Points, in map units, whose pixel is land whatever the noise does. */
  mustBeLand?: [number, number][];
  /** Radius, in map units, of the land grown around each `mustBeLand` point. */
  landRadius?: number;
}

export interface TerrainPixels {
  /** Pixels across and down. Every array is row by row from the top left. */
  width: number;
  height: number;
  /** The size of the same area in map units. */
  mapWidth: number;
  mapHeight: number;
  /** Map units of height a 255 in `heightmap` stands for. */
  heightScale: number;
  /** 1 for land and 0 for sea, one byte per pixel. */
  land: Uint8Array;
  /** Greyscale height, one byte per pixel. Sea is 0, land is 1 to 255. */
  heightmap: Uint8Array;
  /** RGBA colour, four bytes per pixel. */
  image: Uint8ClampedArray;
}

/** A round patch of land. Positions and radius are in pixels. */
interface Blob {
  x: number;
  y: number;
  r: number;
}

const S = TERRAIN_PIXELS;

/** The field far from any blob, and at the edge of the box a blob is drawn in. */
const FIELD_FLOOR = -1.25;
/** How far the noise can move the field, peak to peak. */
const NOISE_AMPLITUDE = 0.9;
const NOISE_CONTRAST = 2.2;
/** Land is where field plus noise clears this. A blob's centre has a field of
 * 1 and the noise takes off at most half its amplitude, so a centre is land. */
const SEA_LEVEL = 0.3;

// Sine and cosine of the fixed rotation steps, as literals.
const STEP_SPIRAL: [number, number] = [0.9800665778412416, 0.19866933079506122];
const STEP_RING: [number, number] = [0.9009688679024191, 0.4338837391175581];
const STEP_THIRD: [number, number] = [-0.5, 0.8660254037844386];
const RING_BLOBS = 14;
const SPIRAL_STEPS = 16;

type Vec = [number, number];

const rotate = (v: Vec, [c, s]: [number, number]): Vec => [
  v[0] * c - v[1] * s,
  v[0] * s + v[1] * c,
];

/** A random direction, by rejection so that it needs no trigonometry. */
function unitVector(rng: Rng): Vec {
  for (;;) {
    const x = rng() * 2 - 1;
    const y = rng() * 2 - 1;
    const d2 = x * x + y * y;
    if (d2 > 0.01 && d2 <= 1) {
      const d = Math.sqrt(d2);
      return [x / d, y / d];
    }
  }
}

/** One continent: a large middle with a few lobes around it. */
function scatterBlobs(rng: Rng): Blob[] {
  const c = S / 2;
  const blobs: Blob[] = [
    {
      x: c + (rng() - 0.5) * 0.06 * S,
      y: c + (rng() - 0.5) * 0.06 * S,
      r: 0.27 * S,
    },
  ];
  const lobes = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < lobes; i++) {
    const u = unitVector(rng);
    const d = (0.14 + rng() * 0.14) * S;
    blobs.push({
      x: c + u[0] * d,
      y: c + u[1] * d,
      r: (0.1 + rng() * 0.07) * S,
    });
  }
  return blobs;
}

/** Land around an inner sea. */
function ringBlobs(rng: Rng): Blob[] {
  const c = S / 2;
  const blobs: Blob[] = [];
  let u = unitVector(rng);
  for (let i = 0; i < RING_BLOBS; i++) {
    const d = (0.31 + (rng() - 0.5) * 0.05) * S;
    blobs.push({
      x: c + u[0] * d,
      y: c + u[1] * d,
      r: (0.095 + rng() * 0.03) * S,
    });
    u = rotate(u, STEP_RING);
  }
  return blobs;
}

/** Three to five separate islands. */
function clusterBlobs(rng: Rng): Blob[] {
  const k = 3 + Math.floor(rng() * 3);
  const spacing = 0.34 * S;
  const centres: Vec[] = [];
  let relax = 0;
  while (centres.length < k) {
    const p: Vec = [(0.2 + rng() * 0.6) * S, (0.2 + rng() * 0.6) * S];
    const need = spacing - relax;
    const clear = centres.every((q) => {
      const dx = p[0] - q[0];
      const dy = p[1] - q[1];
      return need <= 0 || dx * dx + dy * dy >= need * need;
    });
    if (clear) {
      centres.push(p);
      relax = 0;
    } else {
      relax += spacing / 50;
    }
  }
  const blobs: Blob[] = [];
  for (const [x, y] of centres) {
    blobs.push({ x, y, r: (0.11 + rng() * 0.04) * S });
    for (let i = 0; i < 2; i++) {
      const u = unitVector(rng);
      const d = (0.05 + rng() * 0.04) * S;
      blobs.push({
        x: x + u[0] * d,
        y: y + u[1] * d,
        r: (0.06 + rng() * 0.03) * S,
      });
    }
  }
  return blobs;
}

/** Two or three arms of land winding out from a core. */
function spiralBlobs(rng: Rng): Blob[] {
  const c = S / 2;
  const arms = 2 + Math.floor(rng() * 2);
  const blobs: Blob[] = [{ x: c, y: c, r: 0.09 * S }];
  let start = unitVector(rng);
  for (let arm = 0; arm < arms; arm++) {
    let u = start;
    for (let i = 0; i < SPIRAL_STEPS; i++) {
      const d = (0.07 + i * 0.022) * S;
      blobs.push({
        x: c + u[0] * d + (rng() - 0.5) * 0.02 * S,
        y: c + u[1] * d + (rng() - 0.5) * 0.02 * S,
        r: (0.085 - i * 0.0015) * S,
      });
      u = rotate(u, STEP_SPIRAL);
    }
    start = arms === 2 ? [-start[0], -start[1]] : rotate(start, STEP_THIRD);
  }
  return blobs;
}

function shapeBlobs(shape: TerrainShape, rng: Rng): Blob[] {
  switch (shape) {
    case "spiral":
      return spiralBlobs(rng);
    case "clusters":
      return clusterBlobs(rng);
    case "ring":
      return ringBlobs(rng);
    default:
      return scatterBlobs(rng);
  }
}

/** A lattice point's value in [0, 1), from integer mixing alone. */
function lattice(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Five octaves of value noise over the whole grid, scaled into 0..1. `cell` is
 * the lattice spacing of the coarsest octave in pixels, and each octave after
 * it halves the spacing and the weight.
 */
function fractalNoise(seed: number, cell: number): Float64Array {
  const out = new Float64Array(S * S);
  let weight = 1;
  let total = 0;
  let size = cell;
  for (let octave = 0; octave < 5; octave++) {
    const octaveSeed = seed + octave;
    for (let y = 0; y < S; y++) {
      const gy = (y + 0.5) / size;
      const iy = Math.floor(gy);
      const fy = gy - iy;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < S; x++) {
        const gx = (x + 0.5) / size;
        const ix = Math.floor(gx);
        const fx = gx - ix;
        const sx = fx * fx * (3 - 2 * fx);
        const a = lattice(ix, iy, octaveSeed);
        const b = lattice(ix + 1, iy, octaveSeed);
        const c = lattice(ix, iy + 1, octaveSeed);
        const d = lattice(ix + 1, iy + 1, octaveSeed);
        const top = a + (b - a) * sx;
        const bottom = c + (d - c) * sx;
        out[y * S + x] += weight * (top + (bottom - top) * sy);
      }
    }
    total += weight;
    weight /= 2;
    size /= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

type Rgb = [number, number, number];

/** Land colour by height, lowest first: beach, grass, forest, rock, scree, snow. */
const LAND_RAMP: [number, Rgb][] = [
  [0, [214, 200, 150]],
  [0.06, [118, 152, 82]],
  [0.35, [72, 112, 62]],
  [0.6, [122, 106, 90]],
  [0.85, [152, 146, 140]],
  [1, [240, 240, 240]],
];
const SEA_SHALLOW: Rgb = [70, 140, 170];
const SEA_DEEP: Rgb = [24, 58, 96];

function landColour(h: number): Rgb {
  for (let i = 1; i < LAND_RAMP.length; i++) {
    const [t1, c1] = LAND_RAMP[i];
    if (h <= t1) {
      const [t0, c0] = LAND_RAMP[i - 1];
      const t = (h - t0) / (t1 - t0);
      return [
        c0[0] + (c1[0] - c0[0]) * t,
        c0[1] + (c1[1] - c0[1]) * t,
        c0[2] + (c1[2] - c0[2]) * t,
      ];
    }
  }
  return LAND_RAMP[LAND_RAMP.length - 1][1];
}

/** The index of the pixel holding a point given in map units. */
export function terrainPixelAt(
  terrain: Pick<TerrainPixels, "width" | "height" | "mapWidth" | "mapHeight">,
  x: number,
  y: number,
): number {
  const px = Math.floor((x * terrain.width) / terrain.mapWidth);
  const py = Math.floor((y * terrain.height) / terrain.mapHeight);
  const cx = Math.min(terrain.width - 1, Math.max(0, px));
  const cy = Math.min(terrain.height - 1, Math.max(0, py));
  return cy * terrain.width + cx;
}

/**
 * Build the land for a seed. Every `mustBeLand` point is guaranteed to sit on
 * land: each one is the centre of a blob, and the noise cannot pull a blob's
 * centre under the sea (see {@link SEA_LEVEL}).
 */
export function generateTerrain(opts: TerrainOptions): TerrainPixels {
  const rng = mulberry32(hashString(`terrain:${opts.seed >>> 0}`));
  const coastSeed = Math.floor(rng() * 4294967296) | 0;
  const peakSeed = Math.floor(rng() * 4294967296) | 0;

  const blobs = opts.shape ? shapeBlobs(opts.shape, rng) : [];
  const perUnit = S / TERRAIN_MAP_UNITS;
  // Under four pixels a blob's centre pixel could sit far enough off the point
  // to lose the guarantee.
  const pointRadius = Math.max(
    4,
    (opts.landRadius ?? DEFAULT_LAND_RADIUS) * perUnit,
  );
  for (const [x, y] of opts.mustBeLand ?? []) {
    blobs.push({ x: x * perUnit, y: y * perUnit, r: pointRadius });
  }

  // The field is the strongest blob at each pixel: 1 at a centre, 0 at the
  // radius, and drawn out to one and a half radii where it meets the floor.
  const field = new Float64Array(S * S).fill(FIELD_FLOOR);
  for (const b of blobs) {
    const reach = b.r * 1.5;
    const x0 = Math.max(0, Math.floor(b.x - reach));
    const x1 = Math.min(S - 1, Math.ceil(b.x + reach));
    const y0 = Math.max(0, Math.floor(b.y - reach));
    const y1 = Math.min(S - 1, Math.ceil(b.y + reach));
    const r2 = b.r * b.r;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - b.y;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - b.x;
        const v = 1 - (dx * dx + dy * dy) / r2;
        const i = y * S + x;
        if (v > field[i]) field[i] = v;
      }
    }
  }

  const coast = fractalNoise(coastSeed, 96);
  const peaks = fractalNoise(peakSeed, 64);

  const land = new Uint8Array(S * S);
  const heightmap = new Uint8Array(S * S);
  const level = new Float64Array(S * S);
  for (let i = 0; i < S * S; i++) {
    // Summed octaves bunch around the middle, so spread them back out.
    const noise = clamp01(0.5 + (coast[i] - 0.5) * NOISE_CONTRAST);
    const v = field[i] + (noise - 0.5) * NOISE_AMPLITUDE;
    level[i] = v;
    if (v > SEA_LEVEL) {
      // Low at the coast whatever the peaks say, so a shore is always a beach.
      const inland = clamp01((v - SEA_LEVEL) / 0.9);
      const h = clamp01(inland * (0.25 + 1.5 * peaks[i] * peaks[i]));
      land[i] = 1;
      heightmap[i] = 1 + Math.floor(h * 254);
    }
  }

  const image = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let rgb: Rgb;
      if (land[i]) {
        const base = landColour((heightmap[i] - 1) / 254);
        // Lit from the north west: a slope rising to the south east is bright.
        const nw = heightmap[Math.max(0, y - 1) * S + Math.max(0, x - 1)];
        const se =
          heightmap[Math.min(S - 1, y + 1) * S + Math.min(S - 1, x + 1)];
        const shade = Math.min(1.25, Math.max(0.75, 1 + (se - nw) * 0.03));
        rgb = [base[0] * shade, base[1] * shade, base[2] * shade];
      } else {
        const depth = clamp01((SEA_LEVEL - level[i]) / 0.5);
        rgb = [
          SEA_SHALLOW[0] + (SEA_DEEP[0] - SEA_SHALLOW[0]) * depth,
          SEA_SHALLOW[1] + (SEA_DEEP[1] - SEA_SHALLOW[1]) * depth,
          SEA_SHALLOW[2] + (SEA_DEEP[2] - SEA_SHALLOW[2]) * depth,
        ];
      }
      image[i * 4] = Math.min(255, Math.round(rgb[0]));
      image[i * 4 + 1] = Math.min(255, Math.round(rgb[1]));
      image[i * 4 + 2] = Math.min(255, Math.round(rgb[2]));
      image[i * 4 + 3] = 255;
    }
  }

  return {
    width: S,
    height: S,
    mapWidth: TERRAIN_MAP_UNITS,
    mapHeight: TERRAIN_MAP_UNITS,
    heightScale: TERRAIN_HEIGHT_SCALE,
    land,
    heightmap,
    image,
  };
}

export interface LandMasses {
  /** The land mass each pixel belongs to, or -1 for sea. */
  labels: Int32Array;
  /** Pixels in each land mass, indexed by label. */
  sizes: number[];
}

/**
 * Number each connected piece of land, counting pixels as joined when they
 * share an edge. Labels run in the order a row by row scan first meets them.
 */
export function labelLandMasses(
  terrain: Pick<TerrainPixels, "width" | "height" | "land">,
): LandMasses {
  const { width, height, land } = terrain;
  const labels = new Int32Array(width * height).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (!land[start] || labels[start] !== -1) continue;
    const label = sizes.length;
    let size = 0;
    labels[start] = label;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      size++;
      const x = i % width;
      const visit = (j: number) => {
        if (land[j] && labels[j] === -1) {
          labels[j] = label;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (i >= width) visit(i - width);
      if (i < labels.length - width) visit(i + width);
    }
    sizes.push(size);
  }
  return { labels, sizes };
}
