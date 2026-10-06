import { farmsDry, type PlanetId, planetOf } from "../planets";
import type { BiomePixels } from "./terrainMesh";

/**
 * Towns painted into a terrain map's ground: where each one stands, how big
 * it is and which way it runs, and the two small textures the terrain shader
 * draws them from. The streets and roofs themselves are worked out in the
 * shader (`groundShader.ts`), so nothing here is drawn at roof scale and the
 * textures stay small. Display only, and worked out from the document alone,
 * so the same map always draws the same towns. Pure, so it is tested without
 * a scene.
 */

/** One town, in world units on the sheet. */
export interface Town {
  /** The node's index in `galaxy.nodes`. */
  node: number;
  x: number;
  z: number;
  /** How far the built-up area reaches from the anchor along its axis. */
  radius: number;
  capital: boolean;
  /** 0 to 1, different for every town, so no two are drawn alike. */
  seed: number;
  /** The direction the town runs along, in radians from world +x to +z. */
  axis: number;
  /** How much longer the town is along its axis than across it, from 1. */
  aspect: number;
  /** The phases of the three waves that shape the town's edge. */
  waves: [number, number, number];
  /**
   * The town's main streets, as directions from its anchor in radians from
   * world +x to +z: where each road arrives, or a few of its own for a town
   * with none. At most {@link MAX_STREETS}. Set by {@link withStreets}.
   */
  streets: number[];
}

/** The most main streets a town has. */
export const MAX_STREETS = 8;

/**
 * How far the built-up area reaches in the world direction `angle`, in world
 * units from the anchor: an ellipse along the town's axis, wobbled by three
 * waves so no town is a regular shape. `townShader.ts` works out the same.
 * Between 0.73 and 1.27 times the ellipse.
 */
export function townEdge(town: Town, angle: number): number {
  const a = angle - town.axis;
  const ellipse = 1 / Math.hypot(Math.cos(a), town.aspect * Math.sin(a));
  const [p0, p1, p2] = town.waves;
  return (
    town.radius *
    ellipse *
    (1 +
      0.14 * Math.sin(2 * angle + p0) +
      0.08 * Math.sin(3 * angle + p1) +
      0.05 * Math.sin(5 * angle + p2))
  );
}

/**
 * Where a road stops as it reaches a town, as a share of the town's edge:
 * just inside it, among the first houses, where the town's own main street
 * takes over.
 */
export const ROAD_CLIP = 0.92;

/** The longest step along a road the clip checks, in world units. */
const CLIP_STEP = 0.25;

/** A point in map units. */
type MapPoint = [number, number];

/**
 * Cut every line where it enters a town, so a road stops at the town's edge
 * and runs on only as the town's own street. `lines` are in map units and
 * `toWorld` turns a map point into world x and z, which is where the towns
 * are. Returns each line's pieces outside every town, which may be none, and
 * for each town the directions roads arrive from, as world angles from its
 * anchor to where each road was cut.
 */
export function clipRoads(
  lines: MapPoint[][],
  towns: Town[],
  toWorld: (x: number, y: number) => [number, number],
): { pieces: MapPoint[][][]; arrivals: number[][] } {
  const arrivals: number[][] = towns.map(() => []);
  const reach = towns.map((t) => t.radius * 1.3);
  /** The town a map point lies inside, or -1. */
  const inside = (p: MapPoint): number => {
    const [x, z] = toWorld(p[0], p[1]);
    for (let k = 0; k < towns.length; k++) {
      const t = towns[k];
      const dx = x - t.x;
      const dz = z - t.z;
      if (Math.abs(dx) > reach[k] || Math.abs(dz) > reach[k]) continue;
      const d = Math.hypot(dx, dz);
      if (d < townEdge(t, Math.atan2(dz, dx)) * ROAD_CLIP) return k;
    }
    return -1;
  };
  const lerp = (a: MapPoint, b: MapPoint, s: number): MapPoint => [
    a[0] + (b[0] - a[0]) * s,
    a[1] + (b[1] - a[1]) * s,
  ];
  /** The last point outside on the way from `out` to `inn`. */
  const edge = (out: MapPoint, inn: MapPoint): MapPoint => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2;
      if (inside(lerp(out, inn, mid)) < 0) lo = mid;
      else hi = mid;
    }
    return lerp(out, inn, lo);
  };
  const arrive = (k: number, p: MapPoint) => {
    const [x, z] = toWorld(p[0], p[1]);
    arrivals[k].push(Math.atan2(z - towns[k].z, x - towns[k].x));
  };
  const pieces = lines.map((sparse) => {
    // A long straight stretch could step over a town, so it is cut into
    // steps no longer than CLIP_STEP first.
    const line: MapPoint[] = [];
    sparse.forEach((p, i) => {
      if (i > 0) {
        const q = sparse[i - 1];
        const [ax, az] = toWorld(q[0], q[1]);
        const [bx, bz] = toWorld(p[0], p[1]);
        const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / CLIP_STEP);
        for (let s = 1; s < steps; s++) line.push(lerp(q, p, s / steps));
      }
      line.push(p);
    });
    const out: MapPoint[][] = [];
    let run: MapPoint[] = [];
    let was = line.length > 0 ? inside(line[0]) : -1;
    if (line.length > 0 && was < 0) run.push(line[0]);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const now = inside(b);
      if (was < 0 && now < 0) {
        run.push(b);
      } else if (was < 0) {
        const c = edge(a, b);
        run.push(c);
        arrive(now, c);
        if (run.length > 1) out.push(run);
        run = [];
      } else if (now < 0) {
        const c = edge(b, a);
        arrive(was, c);
        run = [c, b];
      }
      was = now;
    }
    if (run.length > 1) out.push(run);
    return out;
  });
  return { pieces, arrivals };
}

/**
 * Give each town its main streets: one towards each direction a road
 * arrives from, leaving out any within a few degrees of one already kept,
 * and for a town no road reaches, two or three of its own along its axis.
 */
export function withStreets(towns: Town[], arrivals: number[][]): Town[] {
  return towns.map((t, k) => {
    const kept: number[] = [];
    for (const a of arrivals[k] ?? []) {
      const close = kept.some(
        (b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.25,
      );
      if (!close && kept.length < MAX_STREETS) kept.push(a);
    }
    if (kept.length === 0) {
      kept.push(t.axis, t.axis + Math.PI);
      if (t.seed > 0.4) kept.push(t.axis + Math.PI / 2 + (t.seed - 0.7));
    }
    return { ...t, streets: kept };
  });
}

/** What a town is planned from: one entry per node of the map. */
export interface TownSite {
  /** The anchor in world x and z. */
  x: number;
  z: number;
  capital: boolean;
  /**
   * The directions roads leave the anchor in, radians from world +x to +z.
   * Empty for a place with no roads.
   */
  roads: number[];
}

/**
 * Design values, in world units, and first guesses. A place with no roads
 * and no luck is an outpost of {@link OUTPOST_RADIUS}, and the busiest
 * junction a city of {@link CITY_RADIUS}. A capital reaches
 * {@link CAPITAL_RADIUS} and each road into it adds {@link RADIUS_PER_ROAD},
 * up to four roads. None reaches further than a share of the way to its
 * nearest neighbour, so two towns never run together.
 */
export const OUTPOST_RADIUS = 0.8;
export const CITY_RADIUS = 3;
export const CAPITAL_RADIUS = 3.6;
const RADIUS_PER_ROAD = 0.2;
/** A place with this many roads or more is as big as its roads can make it. */
const BUSY_ROADS = 5;
/** How much of a town's size comes from its roads. The rest is chance. */
const ROAD_SHARE = 0.65;
const NEIGHBOUR_SHARE = 0.3;
const CAPITAL_NEIGHBOUR_SHARE = 0.38;
/** The most a town is stretched along its roads. */
const MAX_STRETCH = 0.35;

/**
 * How far past its radius a town's texture reaches, as a multiple of the
 * radius: its fields, which thin out by then. Houses along the roads and the
 * ring round a selected town lie well inside.
 */
export const TOWN_REACH = 3;

/** Texels along the longer side of the town index. */
export const TOWN_INDEX_TEXELS = 512;

/** A 0 to 1 value from two integers, for seeding each town. */
function unit(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2d);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/**
 * The axis a set of road directions mostly runs along, and how strongly, 0
 * when they spread evenly and 1 when they all lie on one line. A road out
 * and a road back the opposite way count as one line, so a town on a
 * through road runs along it.
 */
export function roadAxis(roads: number[]): { axis: number; strength: number } {
  if (roads.length === 0) return { axis: 0, strength: 0 };
  let c = 0;
  let s = 0;
  for (const a of roads) {
    c += Math.cos(2 * a);
    s += Math.sin(2 * a);
  }
  return {
    axis: Math.atan2(s, c) / 2,
    strength: Math.hypot(c, s) / roads.length,
  };
}

/**
 * The direction a road leaves its first point in, in radians from world +x
 * to +z: towards the first point of `line` at least `reach` world units away,
 * or its far end if none is. `toWorld` turns a map point into world x and z.
 */
export function leavingAngle(
  line: [number, number][],
  toWorld: (x: number, y: number) => [number, number],
  reach: number,
): number {
  const [ox, oz] = toWorld(line[0][0], line[0][1]);
  let dx = 0;
  let dz = 0;
  for (let k = 1; k < line.length; k++) {
    const [x, z] = toWorld(line[k][0], line[k][1]);
    dx = x - ox;
    dz = z - oz;
    if (Math.hypot(dx, dz) >= reach) break;
  }
  return Math.atan2(dz, dx);
}

/**
 * For each anchor, the directions every line ending on it leaves in, as
 * {@link leavingAngle} reads them. A road or a crossing's track ends exactly
 * on its location's anchor, so an end matches an anchor only when the two
 * are the same point. Anchors and lines are in map units.
 */
export function roadEntries(
  anchors: [number, number][],
  lines: [number, number][][],
  toWorld: (x: number, y: number) => [number, number],
  reach: number,
): number[][] {
  const at = new Map<string, number[]>();
  anchors.forEach(([x, y], i) => {
    const key = `${x} ${y}`;
    at.set(key, [...(at.get(key) ?? []), i]);
  });
  const out: number[][] = anchors.map(() => []);
  for (const line of lines) {
    if (line.length < 2) continue;
    for (const run of [line, [...line].reverse()]) {
      for (const i of at.get(`${run[0][0]} ${run[0][1]}`) ?? []) {
        out[i].push(leavingAngle(run, toWorld, reach));
      }
    }
  }
  return out;
}

/** One town per site, in the same order. `seed` is the map's scene seed. */
export function planTowns(sites: TownSite[], seed: number): Town[] {
  return sites.map((site, node) => {
    let nearest = Number.POSITIVE_INFINITY;
    sites.forEach((other, k) => {
      if (k === node) return;
      nearest = Math.min(
        nearest,
        Math.hypot(other.x - site.x, other.z - site.z),
      );
    });
    const own = unit(seed, node);
    // Most places are small and a few are large, so the rank is squared.
    const rank =
      ROAD_SHARE * Math.min(1, site.roads.length / BUSY_ROADS) +
      (1 - ROAD_SHARE) * unit(seed ^ 0x5bd1e995, node);
    const want = site.capital
      ? CAPITAL_RADIUS + RADIUS_PER_ROAD * Math.min(4, site.roads.length)
      : OUTPOST_RADIUS + (CITY_RADIUS - OUTPOST_RADIUS) * rank * rank;
    const radius = Math.min(
      want,
      nearest * (site.capital ? CAPITAL_NEIGHBOUR_SHARE : NEIGHBOUR_SHARE),
    );
    const { axis, strength } =
      site.roads.length > 0
        ? roadAxis(site.roads)
        : { axis: own * Math.PI, strength: 0.3 };
    return {
      node,
      x: site.x,
      z: site.z,
      radius,
      capital: site.capital,
      seed: own,
      axis,
      aspect: 1 + MAX_STRETCH * strength,
      waves: [own * 61.7, own * 23.3, own * 47.9] as [number, number, number],
      streets: [],
    };
  });
}

/**
 * Which town each part of the sheet belongs to, at {@link TOWN_INDEX_TEXELS}
 * along its longer side, as four bytes a texel. Red and green: the town's
 * index plus one, high byte first, or 0 for open country. Blue: how fit the
 * ground is to build on, 255 for flat dry land, {@link STEEP_FIT} of that
 * for a steep slope, and 0 for sea. Alpha: how fit it is for fields, from
 * {@link farmableAt}. Blue and alpha are recorded only where some town
 * reaches. The texel in column `i` and row `j` stands for world `x = (i + 0.5) / width * worldWidth -
 * worldWidth / 2`, and the same down the sheet in z. A texel within
 * {@link TOWN_REACH} radii of more than one town goes to the one it is
 * nearest relative to its size.
 */
export interface TownIndex {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * How fit the ground at world `x, z` is to build on, 0 to 1, from the ground
 * height there in world units, `height`. Sea is anything below `seaLevel`.
 * Ground is flat enough up to a slope of {@link FLAT_SLOPE} and too steep
 * from {@link STEEP_SLOPE}, as rise over run, judged over `step` world units.
 */
export function buildableAt(
  height: (x: number, z: number) => number,
  seaLevel: number,
  step: number,
): (x: number, z: number) => number {
  return (x, z) => {
    const h = height(x, z);
    if (h < seaLevel) return 0;
    const gx = (height(x + step, z) - height(x - step, z)) / (2 * step);
    const gz = (height(x, z + step) - height(x, z - step)) / (2 * step);
    const slope = Math.hypot(gx, gz);
    const t = Math.min(
      1,
      Math.max(0, (slope - FLAT_SLOPE) / (STEEP_SLOPE - FLAT_SLOPE)),
    );
    return 1 - (1 - STEEP_FIT) * t * t * (3 - 2 * t);
  };
}

/**
 * How fit the ground at world `x, z` is for fields, 0 to 1: farm ground in
 * the generator's biome weights, which cover the sheet `worldWidth` by
 * `worldDepth`, and flat, by `buildable`. A texel is farm ground when its farm
 * slots hold half the weight or more. Fields want flatter ground than houses,
 * so only fully buildable ground counts.
 */
export function farmableAt(
  biomes: BiomePixels,
  worldWidth: number,
  worldDepth: number,
  buildable: (x: number, z: number) => number,
): (x: number, z: number) => number {
  const farmSlots = planetOf(biomes.planet)
    .biomes.map((biome, slot) => (biome.farm ? slot : -1))
    .filter((slot) => slot >= 0);
  return (x, z) => {
    const i = Math.min(
      biomes.width - 1,
      Math.max(
        0,
        Math.floor(((x + worldWidth / 2) / worldWidth) * biomes.width),
      ),
    );
    const j = Math.min(
      biomes.height - 1,
      Math.max(
        0,
        Math.floor(((z + worldDepth / 2) / worldDepth) * biomes.height),
      ),
    );
    const o = (j * biomes.width + i) * 4;
    let farm = 0;
    for (const slot of farmSlots) {
      farm += slot < 4 ? biomes.a[o + slot] : biomes.b[o + slot - 4];
    }
    if (farm < 128) return 0;
    return Math.min(1, Math.max(0, (buildable(x, z) - 0.85) / 0.15));
  };
}

/**
 * The share of each texel's weight that lies in dry farm slots
 * (`farmsDry` in `planets.ts`), a byte a texel, at the weights' own size.
 * The field shader draws dry country's farming where it is high.
 */
export function dryFarmShare(biomes: BiomePixels): Uint8Array {
  const slots = planetOf(biomes.planet)
    .biomes.map((biome, slot) => (farmsDry(biome) ? slot : -1))
    .filter((slot) => slot >= 0);
  const out = new Uint8Array(biomes.width * biomes.height);
  for (let i = 0; i < out.length; i++) {
    let dry = 0;
    for (const slot of slots) {
      dry += slot < 4 ? biomes.a[i * 4 + slot] : biomes.b[i * 4 + slot - 4];
    }
    out[i] = Math.min(255, dry);
  }
  return out;
}

/**
 * The colour of a planet's dry farm ground in sRGB, 0 to 255: its first dry
 * farm slot's. Undefined when it has none.
 */
export function dryFarmColour(
  planet: PlanetId,
): [number, number, number] | undefined {
  return planetOf(planet).biomes.find(farmsDry)?.colour;
}

/** Design values: towns build on slopes up to 1 in 5 and thin out by 1 in 2.5. */
export const FLAT_SLOPE = 0.2;
export const STEEP_SLOPE = 0.4;
/**
 * How fit steep ground is, against flat. Not 0, so a place on a hillside
 * keeps a village at its middle, which the town shader tells from the sea.
 */
export const STEEP_FIT = 0.25;

export function buildTownIndex(
  towns: Town[],
  worldWidth: number,
  worldDepth: number,
  texels: number = TOWN_INDEX_TEXELS,
  buildable: (x: number, z: number) => number = () => 1,
  farmable: (x: number, z: number) => number = () => 0,
): TownIndex {
  const long = Math.max(worldWidth, worldDepth);
  const width = Math.max(1, Math.round((texels * worldWidth) / long));
  const height = Math.max(1, Math.round((texels * worldDepth) / long));
  const tx = worldWidth / width;
  const tz = worldDepth / height;
  // A texel is read whole, so one whose centre lies just outside a town's
  // reach still covers ground inside it.
  const slack = Math.hypot(tx, tz) / 2;
  const best = new Float32Array(width * height).fill(Number.POSITIVE_INFINITY);
  const data = new Uint8Array(width * height * 4);
  towns.forEach((town, k) => {
    const reach = town.radius * TOWN_REACH;
    const r = reach + slack;
    const i0 = Math.max(0, Math.floor((town.x - r + worldWidth / 2) / tx));
    const i1 = Math.min(
      width - 1,
      Math.ceil((town.x + r + worldWidth / 2) / tx),
    );
    const j0 = Math.max(0, Math.floor((town.z - r + worldDepth / 2) / tz));
    const j1 = Math.min(
      height - 1,
      Math.ceil((town.z + r + worldDepth / 2) / tz),
    );
    const tag = k + 1;
    for (let j = j0; j <= j1; j++) {
      const dz = (j + 0.5) * tz - worldDepth / 2 - town.z;
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * tx - worldWidth / 2 - town.x;
        const d = Math.hypot(dx, dz);
        if (d > r) continue;
        const share = d / reach;
        const at = j * width + i;
        if (share < best[at]) {
          best[at] = share;
          data[at * 4] = tag >> 8;
          data[at * 4 + 1] = tag & 255;
        }
      }
    }
  });
  for (let j = 0; j < height; j++) {
    const z = (j + 0.5) * tz - worldDepth / 2;
    for (let i = 0; i < width; i++) {
      const at = j * width + i;
      if (best[at] === Number.POSITIVE_INFINITY) continue;
      const x = (i + 0.5) * tx - worldWidth / 2;
      data[at * 4 + 2] = Math.round(
        Math.min(1, Math.max(0, buildable(x, z))) * 255,
      );
      data[at * 4 + 3] = Math.round(
        Math.min(1, Math.max(0, farmable(x, z))) * 255,
      );
    }
  }
  return { data, width, height };
}

/**
 * The ground under every town as one draped mesh: the cells of the terrain
 * mesh that the town's reach touches, split into triangles the same way the
 * terrain is, so the patch lies exactly on it. `town` holds each vertex's
 * town index, which the shader checks against the town index so a patch
 * never draws over its neighbour's ground. Built from a {@link TerrainSurface}
 * shaped argument so it is tested without a scene.
 */
export function townPatches(
  towns: Town[],
  surface: {
    width: number;
    height: number;
    segmentsX: number;
    segmentsY: number;
    vertexHeights: Float32Array;
    worldWidth: number;
    worldDepth: number;
    mapToWorldXZ(mapX: number, mapY: number): [number, number];
  },
  lift: number,
  /**
   * Whether town `k` draws on the cell centred on world `x, z`, whose corners
   * lie `half` from its centre. Left out, every cell the town's reach touches
   * is kept: a disc, not the square round it.
   */
  keep?: (k: number, x: number, z: number, half: number) => boolean,
): { positions: Float32Array; town: Float32Array; index: Uint32Array } {
  const { segmentsX, segmentsY, vertexHeights } = surface;
  const cols = segmentsX + 1;
  const cellW = surface.worldWidth / segmentsX;
  const cellD = surface.worldDepth / segmentsY;
  const positions: number[] = [];
  const town: number[] = [];
  const index: number[] = [];
  towns.forEach((t, k) => {
    const reach = t.radius * TOWN_REACH;
    const i0 = Math.max(
      0,
      Math.floor((t.x - reach + surface.worldWidth / 2) / cellW),
    );
    const i1 = Math.min(
      segmentsX,
      Math.ceil((t.x + reach + surface.worldWidth / 2) / cellW),
    );
    const j0 = Math.max(
      0,
      Math.floor((t.z - reach + surface.worldDepth / 2) / cellD),
    );
    const j1 = Math.min(
      segmentsY,
      Math.ceil((t.z + reach + surface.worldDepth / 2) / cellD),
    );
    if (i1 <= i0 || j1 <= j0) return;
    const first = positions.length / 3;
    const across = i1 - i0 + 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const [x, z] = surface.mapToWorldXZ(
          (i / segmentsX) * surface.width,
          (j / segmentsY) * surface.height,
        );
        positions.push(x, vertexHeights[j * cols + i] + lift, z);
        town.push(k);
      }
    }
    const half = Math.hypot(cellW, cellD) / 2;
    const touch = reach + half;
    for (let j = 0; j < j1 - j0; j++) {
      for (let i = 0; i < i1 - i0; i++) {
        const topLeft = first + j * across + i;
        const cx = positions[topLeft * 3] + cellW / 2;
        const cz = positions[topLeft * 3 + 2] + cellD / 2;
        if (Math.hypot(cx - t.x, cz - t.z) > touch) continue;
        if (keep && !keep(k, cx, cz, half)) continue;
        const bottomLeft = topLeft + across;
        index.push(
          topLeft,
          bottomLeft,
          topLeft + 1,
          topLeft + 1,
          bottomLeft,
          bottomLeft + 1,
        );
      }
    }
  });
  return {
    positions: new Float32Array(positions),
    town: new Float32Array(town),
    index: new Uint32Array(index),
  };
}

/**
 * The town shader's limits (`townShader.ts`), as shares of the town's edge in
 * that direction unless named in world units. Kept equal to the shader's own
 * literals by hand, and the geometry below drops ground past them.
 *
 * Houses reach {@link HOUSE_REACH}. Along a road, within
 * {@link RIBBON_ROAD} world units of it, they reach {@link RIBBON_REACH},
 * and never past {@link RIBBON_RADII} radii. The ring round a selected or
 * hovered town is centred on {@link RING_AT}. No field is sown inside
 * {@link FIELD_INNER}.
 */
export const HOUSE_REACH = 1.08;
export const RIBBON_REACH = 1.55;
export const RIBBON_ROAD = 0.3;
export const RIBBON_RADII = 1.8;
export const RING_AT = 1.12;
export const FIELD_INNER = 0.85;
/**
 * How far the ring reaches past {@link RING_AT}, in world units. The shader
 * draws it to 1.93 screen pixels out (half of a thick ring's 2.86 pixels,
 * plus half a pixel of smoothing). A pixel covers at most 0.103 world units
 * looking straight down from the camera's farthest, 220 units with a 50
 * degree field of view over 2006 pixels, so 0.198 units. This allows twice
 * that. Only a town at the far horizon of a tilted view, where the ring is a
 * pixel or two across, could see its outer edge cut.
 */
export const RING_REACH = 0.4;

/**
 * The least and most a town's edge reaches, as {@link townEdge} works it
 * out, over every direction from its anchor to a point of the disc of radius
 * `half` round world `x, z`. Sampled at most {@link EDGE_STEP} radians apart,
 * then widened by {@link EDGE_SLACK} for what lies between samples.
 */
export function edgeBounds(
  town: Town,
  x: number,
  z: number,
  half: number,
): [number, number] {
  const d = Math.hypot(x - town.x, z - town.z);
  const centre = Math.atan2(z - town.z, x - town.x);
  const spread = d > half ? Math.asin(half / d) : Math.PI;
  const steps = Math.max(2, Math.ceil((2 * spread) / EDGE_STEP));
  let lo = Number.POSITIVE_INFINITY;
  let hi = 0;
  for (let s = 0; s <= steps; s++) {
    const e = townEdge(town, centre - spread + (2 * spread * s) / steps);
    lo = Math.min(lo, e);
    hi = Math.max(hi, e);
  }
  return [lo * (1 - EDGE_SLACK), hi * (1 + EDGE_SLACK)];
}

/**
 * The edge changes by at most 1.36 of itself per radian: 1.05 from the
 * three waves (0.14 by 2, plus 0.08 by 3, plus 0.05 by 5, is 0.77, over
 * their least sum of 0.73) and 0.31 from the most stretched ellipse, (1.35
 * squared less 1) over (2 by 1.35). Between samples 0.02 radians apart the
 * edge strays at most 1.36 by 0.01, 1.4%, from the nearer one. 2% covers it.
 */
const EDGE_STEP = 0.02;
const EDGE_SLACK = 0.02;

/**
 * A grid over the whole sheet, read texel by texel: the town index or the
 * road mask's distances. `stride` bytes a texel.
 */
export interface SheetGrid {
  data: ArrayLike<number>;
  width: number;
  height: number;
  stride: number;
}

/**
 * Whether `test` holds for any texel of `grid` that touches the square of
 * half side `r` round world `x, z`, or the texel beyond it on every side, so
 * a texture blended between texels is covered too. `test` is given the
 * texel's first byte's offset.
 */
export function anyTexelNear(
  grid: SheetGrid,
  worldWidth: number,
  worldDepth: number,
  x: number,
  z: number,
  r: number,
  test: (at: number) => boolean,
): boolean {
  const col = (v: number) => ((v + worldWidth / 2) / worldWidth) * grid.width;
  const row = (v: number) => ((v + worldDepth / 2) / worldDepth) * grid.height;
  const i0 = Math.max(0, Math.floor(col(x - r)) - 1);
  const i1 = Math.min(grid.width - 1, Math.floor(col(x + r)) + 1);
  const j0 = Math.max(0, Math.floor(row(z - r)) - 1);
  const j1 = Math.min(grid.height - 1, Math.floor(row(z + r)) + 1);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (test((j * grid.width + i) * grid.stride)) return true;
    }
  }
  return false;
}

/**
 * Whether a cell of ground, centred on world `x, z` with its corners `half`
 * away, can show any of town `k`: in the town index as that town, and close
 * enough to hold a house or the ring, or a house along a road where
 * `roadNear` says one passes within {@link RIBBON_ROAD} of the cell.
 */
export function townCell(
  town: Town,
  k: number,
  index: SheetGrid,
  worldWidth: number,
  worldDepth: number,
  roadNear: (x: number, z: number, r: number) => boolean,
): (x: number, z: number, half: number) => boolean {
  const tag = k + 1;
  return (x, z, half) => {
    const near = Math.max(0, Math.hypot(x - town.x, z - town.z) - half);
    const [, hi] = edgeBounds(town, x, z, half);
    const ring = near <= hi * RING_AT + RING_REACH;
    const ribbon =
      near <= Math.min(hi * RIBBON_REACH, town.radius * RIBBON_RADII) &&
      roadNear(x, z, half);
    if (!ring && !ribbon) return false;
    return anyTexelNear(
      index,
      worldWidth,
      worldDepth,
      x,
      z,
      half,
      (at) => index.data[at] * 256 + index.data[at + 1] === tag,
    );
  };
}

/**
 * Whether a cell of ground, as for {@link townCell}, can show any of town
 * `k`'s fields: in the town index as that town, fit for fields, within
 * {@link TOWN_REACH} radii, and not wholly inside {@link FIELD_INNER} of the
 * town's edge, where nothing is sown.
 */
export function fieldCell(
  town: Town,
  k: number,
  index: SheetGrid,
  worldWidth: number,
  worldDepth: number,
): (x: number, z: number, half: number) => boolean {
  const tag = k + 1;
  return (x, z, half) => {
    const d = Math.hypot(x - town.x, z - town.z);
    if (d - half > town.radius * TOWN_REACH) return false;
    const [lo] = edgeBounds(town, x, z, half);
    if (d + half < lo * FIELD_INNER) return false;
    return anyTexelNear(
      index,
      worldWidth,
      worldDepth,
      x,
      z,
      half,
      (at) =>
        index.data[at] * 256 + index.data[at + 1] === tag &&
        index.data[at + 3] > 0,
    );
  };
}

/** Rows of {@link townDataTexels}. */
export const TOWN_DATA_ROWS = 5;

/**
 * The towns as {@link TOWN_DATA_ROWS} rows of four floats a town, for a
 * texture one column per town: row 0 holds `x, z, radius, seed`, row 1 the
 * axis as its cosine and sine, whether it is a capital, and its aspect, row 2
 * the three wave phases and the number of main streets, and rows 3 and 4 the
 * main streets' directions.
 */
export function townDataTexels(towns: Town[]): Float32Array {
  const columns = Math.max(1, towns.length);
  const out = new Float32Array(columns * TOWN_DATA_ROWS * 4);
  const row = (r: number, k: number) => (r * columns + k) * 4;
  towns.forEach((t, k) => {
    out.set([t.x, t.z, t.radius, t.seed], row(0, k));
    out.set(
      [Math.cos(t.axis), Math.sin(t.axis), t.capital ? 1 : 0, t.aspect],
      row(1, k),
    );
    const streets = t.streets.slice(0, MAX_STREETS);
    out.set([...t.waves, streets.length], row(2, k));
    streets.forEach((a, s) => {
      out[row(3 + Math.floor(s / 4), k) + (s % 4)] = a;
    });
  });
  return out;
}
