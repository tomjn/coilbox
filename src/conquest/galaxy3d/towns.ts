/**
 * The towns of a terrain map: where each one stands, how big it is and which
 * way it runs. Display only, and worked out from the document alone, so the
 * same map always draws the same towns. Pure, so it is tested without a
 * scene.
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
 * waves so no town is a regular shape.
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
export const NEIGHBOUR_SHARE = 0.3;
export const CAPITAL_NEIGHBOUR_SHARE = 0.38;
/** The most a town is stretched along its roads. */
const MAX_STRETCH = 0.35;

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

/** Design values: towns build on slopes up to 1 in 5 and thin out by 1 in 2.5. */
export const FLAT_SLOPE = 0.2;
export const STEEP_SLOPE = 0.4;
/**
 * How fit steep ground is, against flat. Not 0, so a place on a hillside
 * keeps a village at its middle.
 */
export const STEEP_FIT = 0.25;
