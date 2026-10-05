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

/**
 * The land layout a stored layout value builds. `random`, or nothing, is left
 * to the seed. A galaxy layout, which a land map made before the land layouts
 * existed may carry, reads as the land layout nearest it.
 */
export function resolveLandLayout(
  layout: string | undefined,
  rng: Rng,
): LandLayout {
  switch (layout) {
    case "continent":
    case "coast":
    case "continents":
    case "archipelago":
    case "inlandsea":
    case "landlocked":
      return layout;
    case "scatter":
      return "continent";
    case "spiral":
      return "continents";
    case "clusters":
      return "archipelago";
    case "ring":
      return "inlandsea";
    default:
      return pick(rng, LAND_LAYOUTS);
  }
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
}

export interface GeneratedTerrain {
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
 */
function towardSides(mask: ShapeMask, open: number[], lift: number): ShapeMask {
  if (open.length === 0) return mask;
  const reach = 0.3 * S;
  return (x, y) => {
    let v = mask(x, y);
    for (const side of open) {
      const t = 1 - toSide(x, y, side) / reach;
      if (t > 0) v += lift * t;
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

type Rgb = [number, number, number];

// Land colours. Colour only: nothing in play reads which of these a place is.
const BEACH: Rgb = [214, 200, 150];
const DRY: Rgb = [182, 168, 116];
const GRASS: Rgb = [122, 154, 84];
const FOREST: Rgb = [58, 98, 56];
const TUNDRA: Rgb = [146, 146, 122];
const ROCK: Rgb = [122, 106, 90];
const SCREE: Rgb = [152, 146, 140];
const SNOW: Rgb = [240, 240, 240];
const SEA_SHALLOW: Rgb = [70, 140, 170];
const SEA_DEEP: Rgb = [24, 58, 96];
/** Coast distance, in thirds of a pixel, at which the sea is fully deep. */
const SEA_DEPTH = 108;

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * The colour of land at height `h` (0 to 1), with `wet` the moisture and
 * `cold` how far below temperate it is, both 0 to 1. Low ground runs from dry
 * land through grassland to forest as it gets wetter, and to tundra as it gets
 * colder. Higher up it turns to rock, then scree, then snow, and the snow line
 * comes down where it is cold. The lowest land is sand.
 */
function biomeColour(h: number, wet: number, cold: number): Rgb {
  let c =
    wet < 0.42
      ? mix(DRY, GRASS, clamp01((wet - 0.2) / 0.18))
      : mix(GRASS, FOREST, clamp01((wet - 0.48) / 0.2));
  c = mix(c, TUNDRA, cold);
  c = mix(c, ROCK, clamp01((h - 0.42) / 0.15));
  c = mix(c, SCREE, clamp01((h - 0.66) / 0.14));
  c = mix(c, SNOW, clamp01((h - (0.84 - 0.25 * cold)) / 0.08));
  return mix(BEACH, c, clamp01(h / 0.015));
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

/** Build the land for a seed and a layout. */
export function generateTerrain(opts: TerrainOptions): GeneratedTerrain {
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
      const px = x + 0.5;
      const wx = px + plan.warp * (bendX[y * S + x] - 0.5) * 2;
      const wy = py + plan.warp * (bendY[y * S + x] - 0.5) * 2;
      let e =
        plan.mask(wx, wy) + plan.roughness * (base[y * S + x] - 0.5) * 2.8;
      for (const side of closed) {
        const edge = toSide(px, py, side);
        if (edge < EDGE_MARGIN) {
          const t = 1 - edge / EDGE_MARGIN;
          e -= t * t * 4;
        }
      }
      elevation[y * S + x] = e;
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
    .slice(0, Math.max(1, opts.maxMasses ?? Number.POSITIVE_INFINITY));
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
  for (let i = 0; i < S * S; i++) {
    if (!land[i]) continue;
    // Rises from the coast and levels off inland.
    const t = clamp01(coastDistance[i] / (3 * 40));
    const inland = t * (2 - t);
    // Ridges where the noise crosses its middle, gathered into ranges.
    const r = 1 - Math.abs(ridges[i] - 0.5) * 2;
    const ridge = r * r * r;
    const range = clamp01((ranges[i] - 0.47) * 4);
    const hills = hillField[i];
    const h = clamp01(inland * (0.06 + 0.2 * hills + 0.75 * range * ridge));
    heightmap[i] = 1 + Math.floor(h * 254);
  }

  // Climate, for colour alone. Wetter near the coast, and warmer one way
  // across the map by an amount the seed picks, so some maps run from tundra
  // to dry land and others stay temperate. Height cools it further.
  const wetField = coarseNoise(S, S, 130, wetSeed, 3);
  const warmField = coarseNoise(S, S, 160, warmSeed, 2);
  const landAt = (i: number): Rgb => {
    const x = i % S;
    const y = (i - x) / S;
    const h = (heightmap[i] - 1) / 254;
    const near = 1 - Math.min(1, coastDistance[i] / (3 * 30));
    const wet = clamp01(0.5 + (wetField[i] - 0.5) * 2.4 + 0.15 * near);
    const across = ((x - S / 2) * warmth[0] + (y - S / 2) * warmth[1]) / S;
    const warm =
      0.55 + across * warmSpread * 2 + (warmField[i] - 0.5) * 0.6 - h * 0.5;
    return biomeColour(h, wet, clamp01((0.3 - warm) / 0.25));
  };
  // Sea colours by distance from the coast, worked out once per value.
  const seaRamp = Array.from({ length: SEA_DEPTH + 1 }, (_, d): Rgb => {
    const depth = d / SEA_DEPTH;
    return [
      SEA_SHALLOW[0] + (SEA_DEEP[0] - SEA_SHALLOW[0]) * depth,
      SEA_SHALLOW[1] + (SEA_DEEP[1] - SEA_SHALLOW[1]) * depth,
      SEA_SHALLOW[2] + (SEA_DEEP[2] - SEA_SHALLOW[2]) * depth,
    ];
  });
  const beach = BEACH;
  const shallows = seaRamp[3];
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
        const lnd = land[i] ? landAt(i) : beach;
        rgb = [
          shallows[0] + (lnd[0] - shallows[0]) * cover,
          shallows[1] + (lnd[1] - shallows[1]) * cover,
          shallows[2] + (lnd[2] - shallows[2]) * cover,
        ];
      } else if (land[i]) {
        rgb = landAt(i);
        // Lit from the north west: a slope rising to the south east is bright.
        const nw = heightmap[(y > 0 ? y - 1 : 0) * S + (x > 0 ? x - 1 : 0)];
        const se =
          heightmap[(y < S - 1 ? y + 1 : y) * S + (x < S - 1 ? x + 1 : x)];
        shade = 1 + (se - nw) * 0.03;
        shade = shade < 0.75 ? 0.75 : shade > 1.25 ? 1.25 : shade;
      } else {
        rgb = seaRamp[Math.min(SEA_DEPTH, coastDistance[i])];
      }
      // The clamped array rounds half to even on the way in.
      image[i * 4] = rgb[0] * shade;
      image[i * 4 + 1] = rgb[1] * shade;
      image[i * 4 + 2] = rgb[2] * shade;
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
    coastDistance,
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
