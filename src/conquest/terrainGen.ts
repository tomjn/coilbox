import {
  BIOME_SLOTS,
  type Planet,
  type PlanetId,
  planetOf,
  type Rgb,
  weightBytes,
} from "./planets";
import { hashString, mulberry32, pick, type Rng } from "./rng";

/**
 * Generated land for the Territories and Cities map styles (issues #3505,
 * #3506 and #3617): a land mask, a heightmap and a colour image, as plain
 * typed arrays. No canvas and no DOM, so it runs in vitest and in the webview
 * alike.
 *
 * The land comes first and the map is cut from it afterwards. Fractal noise is
 * laid over a broad mask that gives the shape (one continent, two, an
 * archipelago or land around an inland sea), and both are read through a
 * second noise that bends the coordinates, so a coast wanders instead of
 * tracing a circle. The sea level is set so a fixed share of the map is land.
 * Specks of land are sunk and small lakes are filled.
 *
 * The same seed has to give the same pixels on Windows, macOS and Linux, since
 * a saved map keeps its seed and not its pixels (issue #2167 is the galaxy
 * generator failing at this). So everything here is integer arithmetic or one
 * of the operations IEEE 754 defines exactly: add, subtract, multiply, divide
 * and `Math.sqrt`. There is no `Math.sin`, `Math.cos`, `Math.pow`, `Math.exp`,
 * `Math.log`, `Math.atan2` or `Math.hypot`. A direction is a unit vector found
 * by rejection sampling. `terrainGolden.test.ts` pins a hash of every array.
 */

/** How the land is arranged. */
export type LandLayout =
  | "continent"
  | "coast"
  | "continents"
  | "archipelago"
  | "inlandsea"
  | "landlocked";

/** The land layouts, in the order the setup forms offer them. */
export const LAND_LAYOUTS: readonly LandLayout[] = [
  "continent",
  "coast",
  "continents",
  "archipelago",
  "inlandsea",
  "landlocked",
];

export const isLandLayout = (value: unknown): value is LandLayout =>
  LAND_LAYOUTS.includes(value as LandLayout);

/** Kept as a name for the land layout, which is what a terrain's shape is. */
export type TerrainShape = LandLayout;

/** The shapes a planet offers where its sea cannot be crossed: one land mass. */
export const SINGLE_MASS_LAYOUTS: readonly LandLayout[] = [
  "continent",
  "coast",
  "inlandsea",
  "landlocked",
];

/** The shapes a planet offers: all six, or {@link SINGLE_MASS_LAYOUTS} where the sea cannot be crossed. */
export function landLayoutsFor(planet: PlanetId): readonly LandLayout[] {
  return planetOf(planet).sea.crossing === "none"
    ? SINGLE_MASS_LAYOUTS
    : LAND_LAYOUTS;
}

/**
 * The land layout a stored layout value builds. `random`, or nothing, is left
 * to the seed. A galaxy layout, which a land map made before the land layouts
 * existed may carry, reads as the land layout nearest it. A shape the planet
 * does not offer reads as a continent and draws nothing from `rng`.
 */
export function resolveLandLayout(
  layout: string | undefined,
  rng: Rng,
  planet: PlanetId = "temperate",
): LandLayout {
  const offered = landLayoutsFor(planet);
  let named: LandLayout;
  switch (layout) {
    case "continent":
    case "coast":
    case "continents":
    case "archipelago":
    case "inlandsea":
    case "landlocked":
      named = layout;
      break;
    case "scatter":
      named = "continent";
      break;
    case "spiral":
      named = "continents";
      break;
    case "clusters":
      named = "archipelago";
      break;
    case "ring":
      named = "inlandsea";
      break;
    default:
      return pick(rng, offered);
  }
  return offered.includes(named) ? named : "continent";
}

/** Pixels along each side of every generated array. */
export const TERRAIN_PIXELS = 512;
/** Map units along each side. Two per pixel, so a pixel centre is a whole number. */
export const TERRAIN_MAP_UNITS = 1024;
/** Map units of height a white heightmap pixel stands for. */
export const TERRAIN_HEIGHT_SCALE = 64;

export interface TerrainOptions {
  seed: number;
  shape: LandLayout;
  /**
   * Keep at most this many land masses, the largest. A map passes its number
   * of locations, so no land mass is left without one.
   */
  maxMasses?: number;
  /** Left out is Temperate. */
  planet?: PlanetId;
}

/**
 * How much of each ground type a pixel has, as bytes summing to 255 on land
 * and all 0 at sea. RGBA bytes per pixel: `a` holds slots 0 to 3, `b` 4 to 7.
 */
export interface TerrainBiomes {
  a: Uint8Array;
  b: Uint8Array;
}

export interface GeneratedTerrain {
  /** The planet whose palette and sea the terrain is drawn with. */
  planet: PlanetId;
  /** The weight bytes land colour is mixed from. */
  biomes: TerrainBiomes;
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
  /**
   * The height before it is rounded down to `heightmap`'s byte, in the same
   * units: sea is 0, land is 1 to 255, or 0 to 254 beside a sea that is
   * ground. For lighting only, which shows a byte's steps as creases on a
   * gentle slope. Nothing in play reads it.
   */
  relief: Float32Array;
  /** RGBA colour, four bytes per pixel. */
  image: Uint8ClampedArray;
  /**
   * Distance from each land pixel to the nearest sea pixel, and from each sea
   * pixel to the nearest land pixel, in thirds of a pixel (a 3 and 4 chamfer
   * distance). 0 never appears: a pixel next to the other side is 3.
   */
  coastDistance: Uint16Array;
}

const S = TERRAIN_PIXELS;

type Vec = [number, number];

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

/** A lattice point's value in [0, 1), from integer mixing alone. */
function lattice(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothed value noise at a point given in lattice cells, in [0, 1). */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy, seed);
  const b = lattice(ix + 1, iy, seed);
  const c = lattice(ix, iy + 1, seed);
  const d = lattice(ix + 1, iy + 1, seed);
  const top = a + (b - a) * sx;
  return top + (c + (d - c) * sx - top) * sy;
}

/**
 * Octaves of value noise at a point given in lattice cells of the coarsest
 * octave, each finer octave at twice the frequency and half the weight. The
 * result is in [0, 1) and bunches around the middle.
 *
 * Value noise lines its features up with its lattice, which shows as straight
 * coasts running across and down the map. So every octave turns its lattice a
 * further step, by the angle of a 3, 4, 5 triangle, whose cosine and sine are
 * the plain fractions 0.8 and 0.6.
 */
export function fractalNoise(
  x: number,
  y: number,
  seed: number,
  octaves: number,
): number {
  let sum = 0;
  let total = 0;
  let weight = 1;
  let px = x;
  let py = y;
  for (let o = 0; o < octaves; o++) {
    const rx = 0.8 * px - 0.6 * py;
    const ry = 0.6 * px + 0.8 * py;
    sum += weight * valueNoise(rx, ry, seed + o * 7919);
    total += weight;
    weight /= 2;
    px = rx * 2;
    py = ry * 2;
  }
  return sum / total;
}

/**
 * {@link fractalNoise} over a whole grid, measured every `step` pixels and
 * blended in between. A field whose finest octave spans several steps loses
 * nothing to this and costs a sixteenth as much at a step of 4. Points are
 * pixel centres divided by `cell`.
 */
export function coarseNoise(
  width: number,
  height: number,
  cell: number,
  seed: number,
  octaves: number,
  step = 4,
): Float64Array {
  const gw = Math.floor(width / step) + 2;
  const gh = Math.floor(height / step) + 2;
  const grid = new Float64Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      grid[gy * gw + gx] = fractalNoise(
        (gx * step + 0.5) / cell,
        (gy * step + 0.5) / cell,
        seed,
        octaves,
      );
    }
  }
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = Math.floor(y / step);
    const ty = (y - gy * step) / step;
    for (let x = 0; x < width; x++) {
      const gx = Math.floor(x / step);
      const tx = (x - gx * step) / step;
      const i = gy * gw + gx;
      const top = grid[i] + (grid[i + 1] - grid[i]) * tx;
      const bottom = grid[i + gw] + (grid[i + gw + 1] - grid[i + gw]) * tx;
      out[y * width + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

/** A random seed for one noise field. */
const noiseSeed = (rng: Rng) => Math.floor(rng() * 4294967296) | 0;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The broad shape of the land: positive where the shape wants land, falling
 * below zero where it wants sea. Takes a point in pixels, already bent by the
 * coordinate noise, and returns roughly -1 to 1 near the land.
 */
type ShapeMask = (x: number, y: number) => number;

interface ShapePlan {
  mask: ShapeMask;
  /** Share of the map that ends up land, before specks are sunk. */
  landShare: number;
  /** The smallest land mass kept, in pixels. */
  minMass: number;
  /** How far the coordinate noise bends the shape, in pixels. */
  warp: number;
  /** How much the fractal noise counts against the shape. */
  roughness: number;
  /** The sides, from {@link SIDES}, that land may run off. The others are
   * kept clear of land so the sea runs along them. */
  open: number[];
}

/** An ellipse falloff: 1 at the centre, 0 on the edge, negative outside. */
function ellipse(c: Vec, along: Vec, a: number, b: number): ShapeMask {
  return (x, y) => {
    const dx = x - c[0];
    const dy = y - c[1];
    const u = (dx * along[0] + dy * along[1]) / a;
    const v = (dy * along[0] - dx * along[1]) / b;
    return 1 - (u * u + v * v);
  };
}

/** The map's sides, in the order top, right, bottom, left, as the direction
 * that points out of the map across each. */
const SIDES: readonly Vec[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * `count` sides next to each other, from a first side drawn from the seed: one
 * side, a corner, or three sides. Opposite sides would pull a continent both
 * ways at once and leave it in the middle.
 */
function adjacentSides(rng: Rng, count: number): number[] {
  const first = Math.floor(rng() * 4);
  return Array.from({ length: count }, (_, i) => (first + i) % 4);
}

/** The side a direction points out of the map across. */
function sideFacing(v: Vec): number {
  let best = 0;
  for (let i = 1; i < 4; i++) {
    const d = v[0] * SIDES[i][0] + v[1] * SIDES[i][1];
    if (d > v[0] * SIDES[best][0] + v[1] * SIDES[best][1]) best = i;
  }
  return best;
}

/** Pixels from a point to one side of the map. */
function toSide(x: number, y: number, side: number): number {
  return side === 0 ? y : side === 1 ? S - x : side === 2 ? S - y : x;
}

/**
 * Raise the land towards each open side, so a shape that leans towards it
 * runs off the map there instead of stopping short.
 *
 * Past the side the lift stops growing, so land drawn beyond the map (see
 * {@link generateTerrainMargin}) carries on for a while and then meets a coast
 * instead of running on for ever. Inside the map a point is bent by less than
 * `warp` pixels, so it never reaches the cap and the map is unchanged by it.
 */
function towardSides(
  mask: ShapeMask,
  open: number[],
  lift: number,
  warp: number,
): ShapeMask {
  if (open.length === 0) return mask;
  const reach = 0.3 * S;
  const cap = 1 + warp / reach;
  return (x, y) => {
    let v = mask(x, y);
    for (const side of open) {
      const t = 1 - toSide(x, y, side) / reach;
      if (t > 0) v += lift * (t < cap ? t : cap);
    }
    return v;
  };
}

function planShape(shape: LandLayout, rng: Rng): ShapePlan {
  const c = S / 2;
  switch (shape) {
    case "continents": {
      // Two masses facing each other across a strait that runs between them.
      // Each may run off the map on the side it faces away from the strait.
      const u = unitVector(rng);
      const gap = (0.2 + rng() * 0.03) * S;
      const slide = (rng() - 0.5) * 0.12 * S;
      const perp: Vec = [-u[1], u[0]];
      // One continent is larger than the other.
      const big = 1 + rng() * 0.12;
      const small = 0.72 + rng() * 0.15;
      const outA = rng() < 0.7;
      const outB = rng() < 0.7;
      const push = 0.15 * S;
      const a = ellipse(
        [
          c + u[0] * (gap + (outA ? push : 0)) + perp[0] * slide,
          c + u[1] * (gap + (outA ? push : 0)) + perp[1] * slide,
        ],
        perp,
        (0.28 + rng() * 0.05) * S * big,
        (0.15 + rng() * 0.03) * S * big,
      );
      const b = ellipse(
        [
          c - u[0] * (gap + (outB ? push : 0)) - perp[0] * slide,
          c - u[1] * (gap + (outB ? push : 0)) - perp[1] * slide,
        ],
        perp,
        (0.28 + rng() * 0.05) * S * small,
        (0.15 + rng() * 0.03) * S * small,
      );
      const open: number[] = [];
      if (outA) open.push(sideFacing(u));
      if (outB) open.push(sideFacing([-u[0], -u[1]]));
      const strait = 0.05 * S;
      return {
        mask: towardSides(
          (x, y) => {
            const across = ((x - c) * u[0] + (y - c) * u[1]) / strait;
            const channel = across * across < 1 ? 1 - across * across : 0;
            return Math.max(a(x, y), b(x, y)) - 0.9 * channel;
          },
          open,
          1,
          60,
        ),
        open,
        landShare: 0.36 + 0.07 * open.length,
        minMass: 900,
        warp: 60,
        roughness: 0.8,
      };
    }
    case "archipelago": {
      // Many islands of mixed sizes, kept apart by a spacing that eases off
      // after each miss so the loop always ends. The sea runs all round.
      const count = 8 + Math.floor(rng() * 5);
      const islands: { c: Vec; along: Vec; a: number; b: number }[] = [];
      let relax = 0;
      while (islands.length < count) {
        const p: Vec = [(0.15 + rng() * 0.7) * S, (0.15 + rng() * 0.7) * S];
        const big = rng();
        const a = (0.05 + big * big * 0.13) * S;
        const need = 0.17 * S - relax;
        const clear = islands.every((q) => {
          const dx = p[0] - q.c[0];
          const dy = p[1] - q.c[1];
          return need <= 0 || dx * dx + dy * dy >= need * need;
        });
        if (clear) {
          islands.push({
            c: p,
            along: unitVector(rng),
            a,
            b: a * (0.55 + rng() * 0.35),
          });
          relax = 0;
        } else {
          relax += S / 200;
        }
      }
      const masks = islands.map((i) => ellipse(i.c, i.along, i.a, i.b));
      return {
        mask: (x, y) => {
          let best = -4;
          for (const m of masks) {
            const v = m(x, y);
            if (v > best) best = v;
          }
          return best;
        },
        open: [],
        landShare: 0.22,
        minMass: 250,
        warp: 45,
        roughness: 1,
      };
    }
    case "inlandsea": {
      // A sea in the middle with land filling the frame round it, open to
      // the ocean through a strait on half of the seeds.
      const u = unitVector(rng);
      const centre: Vec = [
        c + (rng() - 0.5) * 0.1 * S,
        c + (rng() - 0.5) * 0.1 * S,
      ];
      const sea = ellipse(
        centre,
        u,
        (0.26 + rng() * 0.05) * S,
        (0.16 + rng() * 0.04) * S,
      );
      const strait = rng() < 0.5 ? SIDES[Math.floor(rng() * 4)] : undefined;
      const width = 0.05 * S;
      return {
        mask: (x, y) => {
          let v = 0.15 - sea(x, y);
          if (strait) {
            const along =
              (x - centre[0]) * strait[0] + (y - centre[1]) * strait[1];
            const off =
              ((x - centre[0]) * strait[1] - (y - centre[1]) * strait[0]) /
              width;
            if (along > 0 && off * off < 1) v = Math.min(v, off * off - 1);
          }
          return v;
        },
        open: [0, 1, 2, 3],
        landShare: 0.8,
        minMass: 900,
        warp: 50,
        roughness: 0.6,
      };
    }
    case "coast": {
      // Land on one side of a long coastline that crosses the map.
      const land = Math.floor(rng() * 4);
      const tilt = (rng() - 0.5) * 0.9;
      const d = SIDES[land];
      const len = Math.sqrt(1 + tilt * tilt);
      const u: Vec = [(d[0] - d[1] * tilt) / len, (d[1] + d[0] * tilt) / len];
      const offset = (rng() - 0.3) * 0.12 * S;
      const open = [0, 1, 2, 3].filter((side) => side !== (land + 2) % 4);
      return {
        mask: (x, y) => ((x - c) * u[0] + (y - c) * u[1] + offset) / (0.2 * S),
        open,
        landShare: 0.5,
        minMass: 900,
        warp: 75,
        roughness: 0.9,
      };
    }
    case "landlocked": {
      // All land, with a few large lakes and no sea.
      const lakes = Array.from({ length: 2 + Math.floor(rng() * 3) }, () => {
        const a = (0.07 + rng() * 0.05) * S;
        return ellipse(
          [(0.2 + rng() * 0.6) * S, (0.2 + rng() * 0.6) * S],
          unitVector(rng),
          a,
          a * (0.45 + rng() * 0.4),
        );
      });
      return {
        mask: (x, y) => {
          let wet = 0;
          for (const lake of lakes) wet = Math.max(wet, lake(x, y));
          return 0.5 - 2 * wet;
        },
        open: [0, 1, 2, 3],
        landShare: 0.88,
        minMass: 900,
        warp: 50,
        roughness: 0.5,
      };
    }
    default: {
      // One large continent that runs off the map on one to three sides,
      // with a smaller lobe so the outline is not an oval.
      const open = adjacentSides(rng, 1 + Math.floor(rng() * 3));
      let cx = c + (rng() - 0.5) * 0.08 * S;
      let cy = c + (rng() - 0.5) * 0.08 * S;
      for (const side of open) {
        cx += SIDES[side][0] * 0.24 * S;
        cy += SIDES[side][1] * 0.24 * S;
      }
      const centre: Vec = [cx, cy];
      const u = unitVector(rng);
      const main = ellipse(
        centre,
        u,
        (0.3 + rng() * 0.06) * S,
        (0.22 + rng() * 0.05) * S,
      );
      const w = unitVector(rng);
      const reach = (0.2 + rng() * 0.06) * S;
      const lobe = ellipse(
        [centre[0] + w[0] * reach, centre[1] + w[1] * reach],
        unitVector(rng),
        (0.13 + rng() * 0.04) * S,
        (0.08 + rng() * 0.03) * S,
      );
      return {
        mask: towardSides(
          (x, y) => Math.max(main(x, y), lobe(x, y)),
          open,
          1.2,
          70,
        ),
        open,
        landShare: 0.34 + 0.09 * open.length,
        minMass: 900,
        warp: 70,
        roughness: 0.8,
      };
    }
  }
}

/** Pixels from the map edge over which the land is pushed under the sea,
 * harder the nearer the edge, so a coast bends away instead of being cut. */
const EDGE_MARGIN = 64;
/** A lake smaller than this many pixels is filled in as land. */
const MAX_LAKE = 2500;

/**
 * Chamfer distance, in thirds of a pixel, from every pixel to the nearest
 * pixel on the other side of the coast. Two passes over the grid with integer
 * steps of 3 straight and 4 diagonal.
 */
export function coastDistanceOf(
  land: Uint8Array,
  w: number,
  h: number,
): Uint16Array {
  const far = 65535;
  const d = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const me = land[i];
      const edge =
        (x > 0 && land[i - 1] !== me) ||
        (x < w - 1 && land[i + 1] !== me) ||
        (y > 0 && land[i - w] !== me) ||
        (y < h - 1 && land[i + w] !== me);
      d[i] = edge ? 3 : far;
    }
  }
  const relax = (i: number, j: number, step: number) => {
    if (land[i] === land[j] && d[j] + step < d[i]) d[i] = d[j] + step;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) relax(i, i - 1, 3);
      if (y > 0) {
        relax(i, i - w, 3);
        if (x > 0) relax(i, i - w - 1, 4);
        if (x < w - 1) relax(i, i - w + 1, 4);
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) relax(i, i + 1, 3);
      if (y < h - 1) {
        relax(i, i + w, 3);
        if (x < w - 1) relax(i, i + w + 1, 4);
        if (x > 0) relax(i, i + w - 1, 4);
      }
    }
  }
  return d;
}

/**
 * Label every 4-connected run of pixels that share a value of `mask` equal to
 * `want`. Returns the label of each pixel (-1 when it is not `want`), the size
 * of each label and whether it touches the map edge.
 */
function labelRegions(
  mask: Uint8Array,
  want: number,
  w: number,
  h: number,
): { labels: Int32Array; sizes: number[]; edge: boolean[] } {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const edge: boolean[] = [];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (mask[start] !== want || labels[start] !== -1) continue;
    const label = sizes.length;
    let size = 0;
    let touches = false;
    labels[start] = label;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      const visit = (j: number) => {
        if (mask[j] === want && labels[j] === -1) {
          labels[j] = label;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    sizes.push(size);
    edge.push(touches);
  }
  return { labels, sizes, edge };
}

/** Coast distance, in thirds of a pixel, at which the sea is fully deep. */
const SEA_DEPTH = 108;
const SEA_RAMPS = new Map<PlanetId, Rgb[]>();
/** A planet's sea colours by distance from the coast, worked out once per planet. */
export function seaRampOf(planet: Planet): Rgb[] {
  let ramp = SEA_RAMPS.get(planet.id);
  if (!ramp) {
    const { shallow, deep } = planet.sea;
    ramp = Array.from({ length: SEA_DEPTH + 1 }, (_, d): Rgb => {
      const depth = d / SEA_DEPTH;
      return [
        shallow[0] + (deep[0] - shallow[0]) * depth,
        shallow[1] + (deep[1] - shallow[1]) * depth,
        shallow[2] + (deep[2] - shallow[2]) * depth,
      ];
    });
    SEA_RAMPS.set(planet.id, ramp);
  }
  return ramp;
}

/** Seas that are ground, which the land beside them runs into with no shore. */
const GROUND_SEAS: readonly string[] = ["basin", "maria"];
/** Coast distance, in thirds of a pixel, by which a ground sea has its colour. */
const GROUND_SHORE = 36;
/** Pixels across the patches that make a ground sea's edge ragged. */
const GROUND_SHORE_CELL = 14;

/**
 * How far the relief sits under the heightmap. Land starts at byte 1 so that
 * it can be told from sea, which leaves a step at the coast for the light to
 * pick out. A sea that is ground has no shore, so its land's relief starts
 * from 0.
 */
function reliefShoreStep(planet: Planet): number {
  return GROUND_SEAS.includes(planet.sea.look) ? 1 : 0;
}

/**
 * The colour of sea `coastDist` thirds of a pixel from the coast, at pixel
 * `x`, `y`, which may be past the map's edge. A sea that is ground has no
 * shoreline: the land's shore colour runs out into it and gives way to the
 * sea's along a ragged line, nearer the coast in some places than others,
 * from a noise field seeded by `shoreSeed`.
 */
function seaColour(
  planet: Planet,
  ramp: Rgb[],
  coastDist: number,
  x: number,
  y: number,
  shoreSeed: number,
): Rgb {
  const sea = ramp[Math.min(SEA_DEPTH, coastDist)];
  if (!GROUND_SEAS.includes(planet.sea.look) || coastDist >= GROUND_SHORE)
    return sea;
  const noise = fractalNoise(
    (x + 0.5) / GROUND_SHORE_CELL,
    (y + 0.5) / GROUND_SHORE_CELL,
    shoreSeed,
    3,
  );
  // The line sits from 0.15 to 0.85 of the way out, and is 0.3 wide.
  const edge = clamp01((noise - 0.3) / 0.4) * 0.7;
  const t = clamp01((coastDist / GROUND_SHORE - edge) / 0.3);
  const mix = t * t * (3 - 2 * t);
  const shore = planet.biomes[planet.shore].colour;
  return [
    shore[0] + (sea[0] - shore[0]) * mix,
    shore[1] + (sea[1] - shore[1]) * mix,
    shore[2] + (sea[2] - shore[2]) * mix,
  ];
}

/**
 * The sRGB colour of a pixel's land from its weight bytes: the planet's
 * palette weighted by the bytes over 255. `o` is the pixel's byte offset in
 * `a` and `b`.
 */
export function landColour(
  planet: Planet,
  biomes: TerrainBiomes,
  o: number,
): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let slot = 0; slot < planet.biomes.length; slot++) {
    const w = slot < 4 ? biomes.a[o + slot] : biomes.b[o + slot - 4];
    const c = planet.biomes[slot].colour;
    r += w * c[0];
    g += w * c[1];
    b += w * c[2];
  }
  return [r / 255, g / 255, b / 255];
}

/** The index of the pixel holding a point given in map units. */
export function terrainPixelAt(
  terrain: Pick<
    GeneratedTerrain,
    "width" | "height" | "mapWidth" | "mapHeight"
  >,
  x: number,
  y: number,
): number {
  const px = Math.floor((x * terrain.width) / terrain.mapWidth);
  const py = Math.floor((y * terrain.height) / terrain.mapHeight);
  const cx = Math.min(terrain.width - 1, Math.max(0, px));
  const cy = Math.min(terrain.height - 1, Math.max(0, py));
  return cy * terrain.width + cx;
}

/** How far the elevation is moved to agree with the mask at a pixel centre. */
const NUDGE = 1e-6;
/** Samples across and down a coast pixel when measuring its land cover. */
const COVER_SAMPLES = 4;

/**
 * The share of a coast pixel above sea level, from 0 to 1, measured at a grid
 * of points blended between pixel centres. -1 for a pixel whose eight
 * neighbours are all on its own side of the coast.
 */
function coastCover(
  elevation: Float64Array,
  land: Uint8Array,
  seaLevel: number,
  x: number,
  y: number,
): number {
  const me = land[y * S + x];
  let mixed = false;
  for (let dy = -1; dy <= 1 && !mixed; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= S) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      if (xx >= 0 && xx < S && land[yy * S + xx] !== me) {
        mixed = true;
        break;
      }
    }
  }
  if (!mixed) return -1;
  const at = (px: number, py: number) => {
    // Pixel centres sit at whole numbers plus a half.
    const gx = Math.min(S - 1.000001, Math.max(0, px - 0.5));
    const gy = Math.min(S - 1.000001, Math.max(0, py - 0.5));
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const i = iy * S + ix;
    const top = elevation[i] + (elevation[i + 1] - elevation[i]) * fx;
    const bottom =
      elevation[i + S] + (elevation[i + S + 1] - elevation[i + S]) * fx;
    return top + (bottom - top) * fy;
  };
  let above = 0;
  for (let sy = 0; sy < COVER_SAMPLES; sy++) {
    for (let sx = 0; sx < COVER_SAMPLES; sx++) {
      const v = at(
        x + (sx + 0.5) / COVER_SAMPLES,
        y + (sy + 0.5) / COVER_SAMPLES,
      );
      if (v > seaLevel) above++;
    }
  }
  return above / (COVER_SAMPLES * COVER_SAMPLES);
}

/** Each pixel becomes what at least five of the nine around it are. */
function majority(land: Uint8Array): Uint8Array {
  const out: Uint8Array = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= S) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < S) n += land[yy * S + xx];
        }
      }
      out[y * S + x] = n >= 5 ? 1 : 0;
    }
  }
  return out;
}

/** The value below which `share` of `values` falls, to one bin in 4096. */
function quantile(values: Float64Array, share: number): number {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const bins = 4096;
  const counts = new Int32Array(bins);
  const span = hi - lo || 1;
  for (const v of values) {
    counts[Math.min(bins - 1, Math.floor(((v - lo) / span) * bins))]++;
  }
  const want = Math.floor(values.length * share);
  let seen = 0;
  for (let b = 0; b < bins; b++) {
    seen += counts[b];
    if (seen >= want) return lo + ((b + 1) / bins) * span;
  }
  return hi;
}

/**
 * The elevation at a pixel centre `px`, `py`: the shape, bent by the
 * coordinate noise `bx` and `by`, plus the fractal noise `baseValue`, pushed
 * under the sea near each closed side. Past a closed side it falls ever
 * deeper, so the sea beyond it stays sea.
 */
function elevationAt(
  plan: ShapePlan,
  closed: number[],
  px: number,
  py: number,
  bx: number,
  by: number,
  baseValue: number,
): number {
  const wx = px + plan.warp * (bx - 0.5) * 2;
  const wy = py + plan.warp * (by - 0.5) * 2;
  let e = plan.mask(wx, wy) + plan.roughness * (baseValue - 0.5) * 2.8;
  for (const side of closed) {
    const edge = toSide(px, py, side);
    if (edge < EDGE_MARGIN) {
      const t = 1 - edge / EDGE_MARGIN;
      e -= t * t * 4;
    }
  }
  return e;
}

/**
 * The height of land `coastDist` thirds of a pixel from the coast, from 1 to
 * 255, given the range, hill and ridge noise there. The heightmap byte is
 * this rounded down.
 */
function landHeight(
  coastDist: number,
  rangeValue: number,
  hillValue: number,
  ridgeValue: number,
): number {
  // Rises from the coast and levels off inland.
  const t = clamp01(coastDist / (3 * 40));
  const inland = t * (2 - t);
  // Ridges where the noise crosses its middle, gathered into ranges.
  const r = 1 - Math.abs(ridgeValue - 0.5) * 2;
  const ridge = r * r * r;
  const range = clamp01((rangeValue - 0.47) * 4);
  const h = clamp01(inland * (0.06 + 0.2 * hillValue + 0.75 * range * ridge));
  return 1 + h * 254;
}

const CRATER_COUNT = 40;
const CRATER_MIN_RADIUS = 4;
const CRATER_MAX_RADIUS = 18;
const CRATER_TRIES = 20;
/** How many height bytes the floor sinks at the centre, and the rim rises. */
const CRATER_DEPTH = 40;
const CRATER_RIM = 20;

/**
 * Stamp craters into `heightmap`, and return nothing. Each has its own random
 * centre and radius from a stream of its own, so the land and the other
 * noise do not move. A centre is redrawn until it is on land and clear of
 * every side by its radius plus 2 pixels, and a crater that finds none in
 * {@link CRATER_TRIES} tries is skipped. Inside 0.8 of the radius the floor
 * sinks, deepest at the centre. From 0.8 to 1.2 of the radius it rises into a
 * rim. Only land pixels away from the outermost rows and columns are written,
 * and they stay from 1 to 255. The byte takes the change rounded down, and
 * `relief` takes it whole.
 */
function stampCraters(
  seed: number,
  land: Uint8Array,
  heightmap: Uint8Array,
  relief: Float32Array,
) {
  stampCraterField(
    `craters:${seed >>> 0}`,
    land,
    1,
    CRATER_COUNT,
    (rng) =>
      CRATER_MIN_RADIUS +
      Math.floor(rng() * (CRATER_MAX_RADIUS - CRATER_MIN_RADIUS + 1)),
    craterDelta,
    (i, delta) => {
      heightmap[i] = Math.max(
        1,
        Math.min(255, heightmap[i] + Math.floor(delta)),
      );
      relief[i] = Math.max(0, Math.min(255, relief[i] + delta));
    },
  );
}

const MARIA_CRATER_DEPTH = 5;
const MARIA_CRATER_RIM = 3;
const MARIA_CRATER_MAX = 80;
/** Sea pixels that earn one maria crater. */
const MARIA_PIXELS_PER_CRATER = 1500;

/**
 * Relief for the sea pixels of a cratered planet, and 0 on land. Craters are
 * smaller than the land's, mostly small, with a count that follows the sea's
 * area, and a newer crater replaces what lies under it. They come from a
 * stream of their own. The heightmap never sees the relief. It only shades the
 * picture, so the maria read as cratered ground while the sea stays at byte 0.
 */
function mariaRelief(seed: number, land: Uint8Array): Float64Array {
  const relief = new Float64Array(S * S);
  let sea = 0;
  for (let i = 0; i < land.length; i++) if (!land[i]) sea++;
  stampCraterField(
    `mariacraters:${seed >>> 0}`,
    land,
    0,
    Math.min(MARIA_CRATER_MAX, Math.floor(sea / MARIA_PIXELS_PER_CRATER)),
    (rng) => {
      const t = rng();
      return 2 + Math.floor(8 * t * t);
    },
    mariaCraterDelta,
    (i, delta) => {
      relief[i] = delta;
    },
  );
  return relief;
}

/**
 * Depth of a land crater profile, in height bytes before rounding, at `u`: the squared
 * distance from the centre over the squared radius. Zero past 1.2 of the
 * radius.
 */
function craterDelta(u: number): number {
  if (u < 0.64) return -CRATER_DEPTH * (1 - u / 0.64);
  if (u < 1.44) {
    const s = (u - 0.64) / 0.8;
    return CRATER_RIM * 4 * s * (1 - s);
  }
  return 0;
}

/**
 * A maria crater's profile at `u`, in relief units: a flat floor, a straight
 * wall up to the rim, then the rim's outer slope falling to nothing.
 */
export function mariaCraterDelta(u: number): number {
  if (u < 0.5) return -MARIA_CRATER_DEPTH;
  if (u < 0.81) {
    const s = (u - 0.5) / 0.31;
    return -MARIA_CRATER_DEPTH + (MARIA_CRATER_DEPTH + MARIA_CRATER_RIM) * s;
  }
  if (u < 1.44) return (MARIA_CRATER_RIM * (1.44 - u)) / 0.63;
  return 0;
}

/**
 * Draw `count` craters from the stream named `stream` and hand each change to
 * `apply` with the pixel index. `radiusOf` draws a crater's radius and
 * `profile` gives its depth at `u`. A centre must be a pixel where `land`
 * equals `onLand`, and only pixels of that kind inside the crater's reach
 * (`u` under 1.44) are passed on.
 */
function stampCraterField(
  stream: string,
  land: Uint8Array,
  onLand: 0 | 1,
  count: number,
  radiusOf: (rng: Rng) => number,
  profile: (u: number) => number,
  apply: (i: number, delta: number) => void,
) {
  const rng = mulberry32(hashString(stream));
  for (let n = 0; n < count; n++) {
    const radius = radiusOf(rng);
    const room = S - 2 * (radius + 2);
    let cx = -1;
    let cy = -1;
    for (let t = 0; t < CRATER_TRIES; t++) {
      const x = radius + 2 + Math.floor(rng() * room);
      const y = radius + 2 + Math.floor(rng() * room);
      if ((land[y * S + x] ? 1 : 0) === onLand) {
        cx = x;
        cy = y;
        break;
      }
    }
    if (cx < 0) continue;
    const r2 = radius * radius;
    const reach = Math.floor(radius * 1.2) + 1;
    const y0 = Math.max(1, cy - reach);
    const y1 = Math.min(S - 2, cy + reach);
    const x0 = Math.max(1, cx - reach);
    const x1 = Math.min(S - 2, cx + reach);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * S + x;
        if ((land[i] ? 1 : 0) !== onLand) continue;
        const u = ((x - cx) * (x - cx) + (y - cy) * (y - cy)) / r2;
        if (u < 1.44) apply(i, profile(u));
      }
    }
  }
}

/**
 * Write the weight bytes of land at pixel `x`, `y` with height `h` from 0 to
 * 1, and return nothing. Wetter near the coast, and warmer one way across the
 * map by an amount the seed picks, so some maps run from tundra to dry land
 * and others stay temperate. Height cools it further. The planet's bias is
 * added to both, and its rule turns them and the height into weight bytes,
 * written at byte offset `o` of `biomes.a` and `biomes.b`.
 */
function climateWeights(
  planet: Planet,
  x: number,
  y: number,
  h: number,
  coastDist: number,
  wetValue: number,
  warmValue: number,
  warmth: Vec,
  warmSpread: number,
  biomes: TerrainBiomes,
  o: number,
): void {
  const near = 1 - Math.min(1, coastDist / (3 * 30));
  const wet = clamp01(
    clamp01(0.5 + (wetValue - 0.5) * 2.4 + 0.15 * near) + planet.climate.wet,
  );
  const across = ((x - S / 2) * warmth[0] + (y - S / 2) * warmth[1]) / S;
  const warm =
    0.55 + across * warmSpread * 2 + (warmValue - 0.5) * 0.6 - h * 0.5;
  const cold = clamp01(clamp01((0.3 - warm) / 0.25) + planet.climate.cold);
  planet.weights(h, wet, cold, SHARES);
  weightBytes(SHARES, BYTES, 0);
  for (let c = 0; c < 4; c++) {
    biomes.a[o + c] = BYTES[c];
    biomes.b[o + c] = BYTES[4 + c];
  }
}

/** Scratch for {@link climateWeights}: the rule's shares, then their bytes. */
const SHARES = new Float64Array(BIOME_SLOTS);
const BYTES = new Uint8Array(BIOME_SLOTS);

/** What a build of the land needs again to draw land past the map's edge. */
interface TerrainContext {
  planet: Planet;
  plan: ShapePlan;
  closed: number[];
  seeds: {
    warpX: number;
    warpY: number;
    base: number;
    ridge: number;
    range: number;
    hill: number;
    wet: number;
    warm: number;
  };
  warmth: Vec;
  warmSpread: number;
  seaLevel: number;
  shoreSeed: number;
}

/** Build the land for a seed and a layout. */
export function generateTerrain(opts: TerrainOptions): GeneratedTerrain {
  return buildTerrain(opts).terrain;
}

function buildTerrain(opts: TerrainOptions): {
  terrain: GeneratedTerrain;
  context: TerrainContext;
} {
  const planet = planetOf(opts.planet ?? "temperate");
  // Where the sea cannot be crossed there is one land mass, whatever was asked.
  const maxMasses = planet.sea.crossing === "none" ? 1 : opts.maxMasses;
  const rng = mulberry32(hashString(`terrain:${opts.seed >>> 0}`));
  const warpX = noiseSeed(rng);
  const warpY = noiseSeed(rng);
  const baseSeed = noiseSeed(rng);
  const ridgeSeed = noiseSeed(rng);
  const rangeSeed = noiseSeed(rng);
  const hillSeed = noiseSeed(rng);
  const plan = planShape(opts.shape, rng);
  const closed = [0, 1, 2, 3].filter((side) => !plan.open.includes(side));
  // Drawn after the shape, so the climate changes no land and no height.
  const wetSeed = noiseSeed(rng);
  const warmSeed = noiseSeed(rng);
  const warmth = unitVector(rng);
  const warmSpread = 0.15 + rng() * 0.35;

  // Elevation: the shape, bent by the coordinate noise, plus fractal noise.
  const bendX = coarseNoise(S, S, 128, warpX, 4);
  const bendY = coarseNoise(S, S, 128, warpY, 4);
  const base = coarseNoise(S, S, 80, baseSeed, 5, 2);
  const elevation = new Float64Array(S * S);
  for (let y = 0; y < S; y++) {
    const py = y + 0.5;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      elevation[i] = elevationAt(
        plan,
        closed,
        x + 0.5,
        py,
        bendX[i],
        bendY[i],
        base[i],
      );
    }
  }
  const seaLevel = quantile(elevation, 1 - plan.landShare);

  let land: Uint8Array = new Uint8Array(S * S);
  for (let i = 0; i < land.length; i++)
    land[i] = elevation[i] > seaLevel ? 1 : 0;
  // Two passes of a three by three majority vote take out cracks and spurs a
  // pixel wide, which read as noise rather than coast.
  for (let pass = 0; pass < 2; pass++) land = majority(land);

  // Sink specks and every land mass past the largest `maxMasses`.
  const masses = labelRegions(land, 1, S, S);
  const keep = masses.sizes
    .map((size, label) => ({ size, label }))
    .filter((m) => m.size >= plan.minMass)
    .sort((a, b) => b.size - a.size || a.label - b.label)
    .slice(0, Math.max(1, maxMasses ?? Number.POSITIVE_INFINITY));
  if (keep.length === 0) {
    // Nothing reached the size wanted, so keep the largest there is.
    const largest = masses.sizes.indexOf(Math.max(...masses.sizes));
    keep.push({ size: masses.sizes[largest], label: largest });
  }
  const kept = new Uint8Array(masses.sizes.length);
  for (const m of keep) kept[m.label] = 1;
  for (let i = 0; i < land.length; i++) {
    if (land[i] && !kept[masses.labels[i]]) land[i] = 0;
  }
  // Fill small lakes, which an outline cannot hold.
  const seas = labelRegions(land, 0, S, S);
  for (let i = 0; i < land.length; i++) {
    const l = seas.labels[i];
    if (l >= 0 && !seas.edge[l] && seas.sizes[l] < MAX_LAKE) land[i] = 1;
  }

  const coastDistance = coastDistanceOf(land, S, S);

  // The elevation is smooth between pixel centres where the mask is a step.
  // Nudge it to agree with the mask at every centre, which the vote, the
  // sunk specks and the filled lakes changed, so its contour at sea level is
  // a smooth line through the same pixels. The coast is drawn from that line.
  for (let i = 0; i < elevation.length; i++) {
    if (land[i] && elevation[i] <= seaLevel) elevation[i] = seaLevel + NUDGE;
    if (!land[i] && elevation[i] > seaLevel) elevation[i] = seaLevel - NUDGE;
  }

  const ranges = coarseNoise(S, S, 170, rangeSeed, 2);
  const hillField = coarseNoise(S, S, 40, hillSeed, 3);
  const ridges = coarseNoise(S, S, 80, ridgeSeed, 5, 2);
  const heightmap = new Uint8Array(S * S);
  const relief = new Float32Array(S * S);
  const shoreStep = reliefShoreStep(planet);
  for (let i = 0; i < S * S; i++) {
    if (!land[i]) continue;
    // The byte is rounded from the full value, not from the stored float.
    const v = landHeight(coastDistance[i], ranges[i], hillField[i], ridges[i]);
    relief[i] = v - shoreStep;
    heightmap[i] = Math.floor(v);
  }
  if (planet.craters) stampCraters(opts.seed, land, heightmap, relief);
  const maria = planet.craters ? mariaRelief(opts.seed, land) : null;

  // Climate, for colour alone.
  const wetField = coarseNoise(S, S, 130, wetSeed, 3);
  const warmField = coarseNoise(S, S, 160, warmSeed, 2);
  const biomes: TerrainBiomes = {
    a: new Uint8Array(S * S * 4),
    b: new Uint8Array(S * S * 4),
  };
  for (let i = 0; i < S * S; i++) {
    if (!land[i]) continue;
    const x = i % S;
    const y = (i - x) / S;
    climateWeights(
      planet,
      x,
      y,
      (heightmap[i] - 1) / 254,
      coastDistance[i],
      wetField[i],
      warmField[i],
      warmth,
      warmSpread,
      biomes,
      i * 4,
    );
  }
  const seaRamp = seaRampOf(planet);
  const beach = planet.biomes[planet.shore].colour;
  // A stream of its own, so the shore changes no land and no climate.
  const shoreSeed = noiseSeed(
    mulberry32(hashString(`shore:${opts.seed >>> 0}`)),
  );
  const image = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let rgb: Rgb;
      let shade = 1;
      const cover = coastCover(elevation, land, seaLevel, x, y);
      if (cover >= 0) {
        // A pixel the coast runs through: land and sea mixed by how much of
        // the pixel lies above sea level.
        const lnd = land[i] ? landColour(planet, biomes, i * 4) : beach;
        const shallows = seaColour(planet, seaRamp, 3, x, y, shoreSeed);
        rgb = [
          shallows[0] + (lnd[0] - shallows[0]) * cover,
          shallows[1] + (lnd[1] - shallows[1]) * cover,
          shallows[2] + (lnd[2] - shallows[2]) * cover,
        ];
      } else if (land[i]) {
        rgb = landColour(planet, biomes, i * 4);
        // Lit from the north west: a slope rising to the south east is bright.
        const nw = relief[(y > 0 ? y - 1 : 0) * S + (x > 0 ? x - 1 : 0)];
        const se =
          relief[(y < S - 1 ? y + 1 : y) * S + (x < S - 1 ? x + 1 : x)];
        shade = 1 + (se - nw) * 0.03;
        shade = shade < 0.75 ? 0.75 : shade > 1.25 ? 1.25 : shade;
      } else {
        rgb = seaColour(planet, seaRamp, coastDistance[i], x, y, shoreSeed);
        if (maria) {
          // The maria are lit the same way, from their crater relief.
          const nw = maria[(y > 0 ? y - 1 : 0) * S + (x > 0 ? x - 1 : 0)];
          const se =
            maria[(y < S - 1 ? y + 1 : y) * S + (x < S - 1 ? x + 1 : x)];
          shade = 1 + (se - nw) * 0.03;
          shade = shade < 0.75 ? 0.75 : shade > 1.25 ? 1.25 : shade;
        }
      }
      // The clamped array rounds half to even on the way in.
      image[i * 4] = rgb[0] * shade;
      image[i * 4 + 1] = rgb[1] * shade;
      image[i * 4 + 2] = rgb[2] * shade;
      image[i * 4 + 3] = 255;
    }
  }

  return {
    terrain: {
      planet: planet.id,
      biomes,
      width: S,
      height: S,
      mapWidth: TERRAIN_MAP_UNITS,
      mapHeight: TERRAIN_MAP_UNITS,
      heightScale: TERRAIN_HEIGHT_SCALE,
      land,
      heightmap,
      relief,
      image,
      coastDistance,
    },
    context: {
      planet,
      plan,
      closed,
      seeds: {
        warpX,
        warpY,
        base: baseSeed,
        ridge: ridgeSeed,
        range: rangeSeed,
        hill: hillSeed,
        wet: wetSeed,
        warm: warmSeed,
      },
      warmth,
      warmSpread,
      seaLevel,
      shoreSeed,
    },
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
  terrain: Pick<GeneratedTerrain, "width" | "height" | "land">,
): LandMasses {
  const { labels, sizes } = labelRegions(
    terrain.land,
    1,
    terrain.width,
    terrain.height,
  );
  return { labels, sizes };
}

/* ------------------------------------------------------------------------ */
/* Land past the map's edge, for display only                               */
/* ------------------------------------------------------------------------ */

/**
 * Map pixels per pixel of the margin. The margin fades out past the map's
 * edge, so half the map's resolution is enough, and costs a quarter as much.
 */
export const MARGIN_SCALE = 2;
/** The margin is a whole number of every noise lattice's step (4 and 2) and
 * of {@link MARGIN_SCALE}, so the lattices line up with the map's. */
const MARGIN_ALIGN = 4;

/**
 * The land beyond the map's edge, at {@link MARGIN_SCALE} map pixels to a
 * pixel. Display only: nothing in play reads it, and unlike the map it does
 * not have to be the same on every platform, though it uses the same noise.
 */
export interface TerrainMargin {
  /** Map pixels it reaches past every side. */
  margin: number;
  /** Map pixels per pixel of it. */
  scale: number;
  /** Its pixels across and down, covering the map and the margin. */
  width: number;
  height: number;
  /** RGBA colour, as the map's image. */
  image: Uint8ClampedArray;
  /** Height bytes, as the map's heightmap: sea 0, land 1 to 255. */
  heightmap: Uint8Array;
  /** Heights before rounding, as the map's relief. */
  relief: Float32Array;
  /** Biome weights, as the map's, at the margin's own width and height. */
  biomes: TerrainBiomes;
}

/**
 * {@link coarseNoise}'s field at any pixel, inside the map or past its edge.
 * It measures the noise on the same lattice, every `step` pixels, so inside
 * the map it gives the same values. `x` and `y` are pixel indices and may be
 * fractional. The lattice is filled for pixels from `from` to `to`.
 */
function noiseSampler(
  cell: number,
  seed: number,
  octaves: number,
  step: number,
  from: number,
  to: number,
): (x: number, y: number) => number {
  const g0 = Math.floor(from / step) - 1;
  const span = Math.floor(to / step) + 2 - g0 + 1;
  const grid = new Float64Array(span * span);
  for (let gy = 0; gy < span; gy++) {
    for (let gx = 0; gx < span; gx++) {
      grid[gy * span + gx] = fractalNoise(
        ((gx + g0) * step + 0.5) / cell,
        ((gy + g0) * step + 0.5) / cell,
        seed,
        octaves,
      );
    }
  }
  return (x, y) => {
    const gx = Math.floor(x / step);
    const gy = Math.floor(y / step);
    const tx = (x - gx * step) / step;
    const ty = (y - gy * step) / step;
    const i = (gy - g0) * span + (gx - g0);
    const top = grid[i] + (grid[i + 1] - grid[i]) * tx;
    const bottom = grid[i + span] + (grid[i + span + 1] - grid[i + span]) * tx;
    return top + (bottom - top) * ty;
  };
}

/**
 * Build the land for a seed and a layout, and the land around it for
 * `marginPixels` map pixels past every side. The map is exactly what
 * {@link generateTerrain} builds. The margin carries on the same noise and the
 * same shape: land that runs off an open side keeps going for a while and may
 * meet a coast, and the sea past a closed side stays sea. Land in the margin
 * that joins no land on the map is sunk, so a land mass the map sank does not
 * reappear just past its edge.
 */
export function generateTerrainWithMargin(
  opts: TerrainOptions,
  marginPixels: number,
): { terrain: GeneratedTerrain; margin: TerrainMargin } {
  const { terrain, context } = buildTerrain(opts);
  const {
    planet,
    plan,
    closed,
    seeds,
    warmth,
    warmSpread,
    seaLevel,
    shoreSeed,
  } = context;
  const seaRamp = seaRampOf(planet);
  const k = MARGIN_SCALE;
  const M = Math.ceil(marginPixels / MARGIN_ALIGN) * MARGIN_ALIGN;
  const W = (S + 2 * M) / k;
  const from = -M - 1;
  const to = S + M + 1;
  const bendX = noiseSampler(128, seeds.warpX, 4, 4, from, to);
  const bendY = noiseSampler(128, seeds.warpY, 4, 4, from, to);
  const base = noiseSampler(80, seeds.base, 5, 2, from, to);
  const ranges = noiseSampler(170, seeds.range, 2, 4, from, to);
  const hills = noiseSampler(40, seeds.hill, 3, 4, from, to);
  const ridges = noiseSampler(80, seeds.ridge, 5, 2, from, to);
  const wetField = noiseSampler(130, seeds.wet, 3, 4, from, to);
  const warmField = noiseSampler(160, seeds.warm, 2, 4, from, to);

  // A margin pixel covers k by k map pixels. Its sample point, as a fractional
  // map pixel index, is the middle of them.
  const at = (i: number) => -M + i * k + (k - 1) / 2;
  const mapPixel = (i: number) => -M + i * k;
  const insideAxis = (i: number) => mapPixel(i) >= 0 && mapPixel(i) < S;
  const count = W * W;
  const inside = new Uint8Array(count);
  let land: Uint8Array = new Uint8Array(count);
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const o = j * W + i;
      if (insideAxis(i) && insideAxis(j)) {
        inside[o] = 1;
        land[o] = terrain.land[mapPixel(j) * S + mapPixel(i)];
        continue;
      }
      const x = at(i);
      const y = at(j);
      const e = elevationAt(
        plan,
        closed,
        x + 0.5,
        y + 0.5,
        bendX(x, y),
        bendY(x, y),
        base(x, y),
      );
      land[o] = e > seaLevel ? 1 : 0;
    }
  }

  // The map's own clean-up, on the margin only: the vote, then sink land that
  // joins nothing on the map, then fill small lakes.
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(land);
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const o = j * W + i;
        if (inside[o]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const jj = j + dy;
          if (jj < 0 || jj >= W) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const ii = i + dx;
            if (ii >= 0 && ii < W) n += land[jj * W + ii];
          }
        }
        next[o] = n >= 5 ? 1 : 0;
      }
    }
    land = next;
  }
  const masses = labelRegions(land, 1, W, W);
  const joined = new Uint8Array(masses.sizes.length);
  for (let o = 0; o < count; o++) {
    if (inside[o] && masses.labels[o] >= 0) joined[masses.labels[o]] = 1;
  }
  for (let o = 0; o < count; o++) {
    if (!inside[o] && land[o] && !joined[masses.labels[o]]) land[o] = 0;
  }
  const seas = labelRegions(land, 0, W, W);
  const seaOnMap = new Uint8Array(seas.sizes.length);
  for (let o = 0; o < count; o++) {
    if (inside[o] && seas.labels[o] >= 0) seaOnMap[seas.labels[o]] = 1;
  }
  for (let o = 0; o < count; o++) {
    const l = seas.labels[o];
    if (
      !inside[o] &&
      l >= 0 &&
      !seas.edge[l] &&
      !seaOnMap[l] &&
      seas.sizes[l] * k * k < MAX_LAKE
    ) {
      land[o] = 1;
    }
  }

  // In thirds of a margin pixel, so k times as many thirds of a map pixel.
  const coast = coastDistanceOf(land, W, W);
  const heightmap = new Uint8Array(count);
  const relief = new Float32Array(count);
  const shoreStep = reliefShoreStep(planet);
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const o = j * W + i;
      if (inside[o]) {
        heightmap[o] = terrain.heightmap[mapPixel(j) * S + mapPixel(i)];
        relief[o] = terrain.relief[mapPixel(j) * S + mapPixel(i)];
      } else if (land[o]) {
        const x = at(i);
        const y = at(j);
        const v = landHeight(
          coast[o] * k,
          ranges(x, y),
          hills(x, y),
          ridges(x, y),
        );
        relief[o] = v - shoreStep;
        heightmap[o] = Math.floor(v);
      }
    }
  }
  const image = new Uint8ClampedArray(count * 4);
  const biomes: TerrainBiomes = {
    a: new Uint8Array(count * 4),
    b: new Uint8Array(count * 4),
  };
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const o = j * W + i;
      if (inside[o]) {
        const m = (mapPixel(j) * S + mapPixel(i)) * 4;
        image.set(terrain.image.subarray(m, m + 4), o * 4);
        biomes.a.set(terrain.biomes.a.subarray(m, m + 4), o * 4);
        biomes.b.set(terrain.biomes.b.subarray(m, m + 4), o * 4);
        continue;
      }
      let rgb: Rgb;
      let shade = 1;
      if (land[o]) {
        const x = at(i);
        const y = at(j);
        climateWeights(
          planet,
          x,
          y,
          (heightmap[o] - 1) / 254,
          coast[o] * k,
          wetField(x, y),
          warmField(x, y),
          warmth,
          warmSpread,
          biomes,
          o * 4,
        );
        rgb = landColour(planet, biomes, o * 4);
        // Lit from the north west, as the map is. The neighbours are k map
        // pixels apart, so the difference is k times the map's.
        const nw = relief[Math.max(0, j - 1) * W + Math.max(0, i - 1)];
        const se = relief[Math.min(W - 1, j + 1) * W + Math.min(W - 1, i + 1)];
        shade = 1 + ((se - nw) * 0.03) / k;
        shade = shade < 0.75 ? 0.75 : shade > 1.25 ? 1.25 : shade;
      } else {
        rgb = seaColour(planet, seaRamp, coast[o] * k, at(i), at(j), shoreSeed);
      }
      image[o * 4] = rgb[0] * shade;
      image[o * 4 + 1] = rgb[1] * shade;
      image[o * 4 + 2] = rgb[2] * shade;
      image[o * 4 + 3] = 255;
    }
  }
  return {
    terrain,
    margin: {
      margin: M,
      scale: k,
      width: W,
      height: W,
      image,
      heightmap,
      relief,
      biomes,
    },
  };
}

/** The map and its margin as one picture and one set of heights. */
export interface ExtendedTerrain {
  /** Map pixels past every side, as in {@link TerrainMargin.margin}. */
  margin: number;
  /** Pixels across and down: the map's plus twice the margin. */
  width: number;
  height: number;
  /** RGBA colour. */
  image: Uint8ClampedArray;
  /** Heights from 0 to 1, as a heightmap byte over 255. */
  heights: Float32Array;
  /** The same before rounding to a byte, for lighting. See {@link GeneratedTerrain.relief}. */
  relief: Float32Array;
  /** Biome weights, as the map's. Blended bytes need not sum to 255. */
  biomes: TerrainBiomes;
}

/**
 * The map with its margin round it, at the map's resolution: the map's own
 * pixels, heights and weights exactly in the middle, and the margin blended up from its
 * coarser pixels round them.
 */
export function extendTerrain(
  terrain: Pick<
    GeneratedTerrain,
    "width" | "height" | "image" | "heightmap" | "relief" | "biomes"
  >,
  margin: TerrainMargin,
): ExtendedTerrain {
  const M = margin.margin;
  const k = margin.scale;
  const w = terrain.width + 2 * M;
  const h = terrain.height + 2 * M;
  const image = new Uint8ClampedArray(w * h * 4);
  const heights = new Float32Array(w * h);
  const relief = new Float32Array(w * h);
  const biomes: TerrainBiomes = {
    a: new Uint8Array(w * h * 4),
    b: new Uint8Array(w * h * 4),
  };
  const mw = margin.width;
  const mh = margin.height;
  for (let y = 0; y < h; y++) {
    const my = y - M;
    // Where this row falls among the margin's pixel centres.
    const cy = Math.min(mh - 1, Math.max(0, (y - (k - 1) / 2) / k));
    const y0 = Math.min(mh - 2, Math.floor(cy));
    const fy = cy - y0;
    for (let x = 0; x < w; x++) {
      const mx = x - M;
      const o = y * w + x;
      if (mx >= 0 && mx < terrain.width && my >= 0 && my < terrain.height) {
        const m = my * terrain.width + mx;
        image.set(terrain.image.subarray(m * 4, m * 4 + 4), o * 4);
        heights[o] = terrain.heightmap[m] / 255;
        relief[o] = terrain.relief[m] / 255;
        biomes.a.set(terrain.biomes.a.subarray(m * 4, m * 4 + 4), o * 4);
        biomes.b.set(terrain.biomes.b.subarray(m * 4, m * 4 + 4), o * 4);
        continue;
      }
      const cx = Math.min(mw - 1, Math.max(0, (x - (k - 1) / 2) / k));
      const x0 = Math.min(mw - 2, Math.floor(cx));
      const fx = cx - x0;
      const a = y0 * mw + x0;
      const b = a + 1;
      const c = a + mw;
      const d = c + 1;
      const blend = (va: number, vb: number, vc: number, vd: number) => {
        const top = va + (vb - va) * fx;
        return top + (vc + (vd - vc) * fx - top) * fy;
      };
      for (let ch = 0; ch < 4; ch++) {
        image[o * 4 + ch] = blend(
          margin.image[a * 4 + ch],
          margin.image[b * 4 + ch],
          margin.image[c * 4 + ch],
          margin.image[d * 4 + ch],
        );
        for (const slots of ["a", "b"] as const) {
          const from = margin.biomes[slots];
          biomes[slots][o * 4 + ch] = blend(
            from[a * 4 + ch],
            from[b * 4 + ch],
            from[c * 4 + ch],
            from[d * 4 + ch],
          );
        }
      }
      heights[o] =
        blend(
          margin.heightmap[a],
          margin.heightmap[b],
          margin.heightmap[c],
          margin.heightmap[d],
        ) / 255;
      relief[o] =
        blend(
          margin.relief[a],
          margin.relief[b],
          margin.relief[c],
          margin.relief[d],
        ) / 255;
    }
  }
  return { margin: M, width: w, height: h, image, heights, relief, biomes };
}
