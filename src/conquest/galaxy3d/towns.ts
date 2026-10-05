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
 * Design values, in world units. A town reaches {@link TOWN_RADIUS}, a
 * capital {@link CAPITAL_RADIUS}, and each road into a place adds
 * {@link RADIUS_PER_ROAD} up to four roads. None reaches further than a share
 * of the way to its nearest neighbour, so two towns never run together.
 */
export const TOWN_RADIUS = 2.4;
export const CAPITAL_RADIUS = 3.6;
const RADIUS_PER_ROAD = 0.1;
const NEIGHBOUR_SHARE = 0.26;
const CAPITAL_NEIGHBOUR_SHARE = 0.34;
/** The most a town is stretched along its roads. */
const MAX_STRETCH = 0.35;

/**
 * How far past its radius a town's texture reaches, as a multiple of the
 * radius: houses strung out along the roads, then the ring drawn round a
 * selected town.
 */
export const TOWN_REACH = 1.7;

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
    const want =
      (site.capital ? CAPITAL_RADIUS : TOWN_RADIUS) +
      RADIUS_PER_ROAD * Math.min(4, site.roads.length);
    const radius = Math.min(
      want,
      nearest * (site.capital ? CAPITAL_NEIGHBOUR_SHARE : NEIGHBOUR_SHARE),
    );
    const own = unit(seed, node);
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
    };
  });
}

/**
 * Which town each part of the sheet belongs to, at {@link TOWN_INDEX_TEXELS}
 * along its longer side: two bytes a texel, the town's index plus one, high
 * byte first, or 0 for open country. The texel in column `i` and row `j`
 * stands for world `x = (i + 0.5) / width * worldWidth - worldWidth / 2`,
 * and the same down the sheet in z. A texel within {@link TOWN_REACH} radii
 * of more than one town goes to the one it is nearest relative to its size.
 */
export interface TownIndex {
  data: Uint8Array;
  width: number;
  height: number;
}

export function buildTownIndex(
  towns: Town[],
  worldWidth: number,
  worldDepth: number,
  texels: number = TOWN_INDEX_TEXELS,
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
  const data = new Uint8Array(width * height * 2);
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
          data[at * 2] = tag >> 8;
          data[at * 2 + 1] = tag & 255;
        }
      }
    }
  });
  return { data, width, height };
}

/**
 * The towns as two rows of four floats a town, for a texture one column per
 * town: row 0 holds `x, z, radius, seed`, row 1 the axis as its cosine and
 * sine, whether it is a capital, and its aspect.
 */
export function townDataTexels(towns: Town[]): Float32Array {
  const columns = Math.max(1, towns.length);
  const out = new Float32Array(columns * 2 * 4);
  towns.forEach((t, k) => {
    out.set([t.x, t.z, t.radius, t.seed], k * 4);
    out.set(
      [Math.cos(t.axis), Math.sin(t.axis), t.capital ? 1 : 0, t.aspect],
      (columns + k) * 4,
    );
  });
  return out;
}
