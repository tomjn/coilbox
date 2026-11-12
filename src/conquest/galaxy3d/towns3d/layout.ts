/**
 * Where each building stands in a town. A town is laid out as lots on a street
 * grid, like an American city: blocks along the town's axis with an avenue
 * through the centre each way, the town's main streets kept clear as
 * boulevards, tall in the middle and low at the edge. Pure, so it is tested
 * without a scene. Which model goes on which lot is decided here, how a model
 * is drawn is not.
 */
import {
  RIVER_FIELD_INSIDE,
  RIVER_FIELD_OUTSIDE,
  type RiverField,
} from "../../rivers";
import { seeded } from "../landmarks/kit";
import { CAPITAL_RADIUS, CITY_RADIUS, type Town, townEdge } from "../towns";
import type { BuildingModel } from "./buildings";

export interface TownGrid {
  /** The side of one lot. */
  lot: number;
  /** Lots in a block, along the town's axis and across it. */
  blockLots: [number, number];
  /** The gap between blocks. */
  street: number;
  /** The wider gap every `avenueEvery` blocks. */
  avenue: number;
  avenueEvery: number;
  /** The width kept clear along each of the town's main streets. */
  boulevard: number;
  /** How far a building stands back from its lot's edge. */
  setback: number;
  /** 0 to 1: how many lots are built on at the town's edge. The centre is full. */
  edgeDensity: number;
  /**
   * How far from the wanted height a model may be and still be picked, as a
   * share of that height. 0 picks the nearest model every time.
   */
  choice: number;
  /** How far a building may be drawn taller or lower than its model, as a share of its height. */
  stretch: number;
  /** The share of lots that want a tower and get a low building, so the towers do not all touch. */
  gaps: number;
}

export const OPEN_GRID: TownGrid = {
  lot: 0.25,
  blockLots: [4, 2],
  street: 0.1,
  avenue: 0.2,
  avenueEvery: 3,
  boulevard: 0.25,
  setback: 0.02,
  edgeDensity: 0.45,
  choice: 0.2,
  stretch: 0.18,
  gaps: 0.16,
};

export interface Placement {
  /** Index into the models the layout was given. */
  model: number;
  /** The building's centre in world x and z. */
  x: number;
  z: number;
  /** Its turn about the vertical: the town's, plus a quarter when it stands across the block. */
  turn: number;
  /** What its height is multiplied by, so two copies of a model differ. */
  stretch: number;
}

export interface TownGround {
  /** 0 to 1, as `buildableAt` gives it. */
  buildable(x: number, z: number): number;
  /** World distance to the nearest river's edge, negative in the water. Left out for no rivers. */
  riverEdge?(x: number, z: number): number;
}

/** Below this, ground is too steep or too wet to build on. */
export const BUILD_FIT = 0.85;

/** A building keeps this far from a river's edge, as the painted towns did. */
export const RIVER_BANK = 0.05;

/** The share of an open town's unbuilt lots that take a park, a court or the like. */
export const FILLED = 0.8;
/** The share of its built lots given up to one, so the centre has its squares. */
export const CLEARED = 0.05;
/** A lot that wants more than this share of the town's tallest is a tower's, and may be left as a gap. */
const TOWER_FROM = 0.45;
/** What a gap among the towers wants, as a share of what the lot wanted. */
const GAP_HEIGHT = 0.2;
/** How much lower than its stretch a building may be drawn, so no two stand level. */
const STRETCH_DRIFT = 0.12;
/** A lot inside the town that nothing is built on. */
const SPARE = -1;

/** How a sealed outpost is laid out: lots on bare ground, with no streets. */
export interface OutpostGrid {
  /** The side of one lot. */
  lot: number;
  /** How far a structure stands back from its lot's edge. */
  setback: number;
  /** 0 to 1: how many lots are built on at the outpost's centre, so even its middle has bare ground. */
  fill: number;
  /** 0 to 1: how many of those are still built on at the outpost's edge. */
  edgeDensity: number;
  /** The most a structure on a plate of its own is pulled off its lot's centre. */
  jitter: number;
  /** The share of neighbours on lots side by side that share one plate. */
  join: number;
  /** How far a plate reaches past the footprint it carries. */
  plateMargin: number;
  /**
   * How far from the wanted height a structure may be and still be picked, as
   * a share of that height. 0 picks the nearest every time.
   */
  choice: number;
}

/** A sealed outpost's grid. All but the lot are starting values, tuned on screen. */
export const OUTPOST_GRID: OutpostGrid = {
  lot: 0.75,
  setback: 0.12,
  fill: 0.8,
  edgeDensity: 0.4,
  jitter: 0.06,
  join: 0.5,
  plateMargin: 0.04,
  choice: 0.2,
};

/**
 * A foundation plate on the ground: its centre in world x and z, its turn, and
 * its size along its own x and z.
 */
export interface Plate {
  x: number;
  z: number;
  turn: number;
  w: number;
  d: number;
}

/** How a lot's wanted height falls from a town's centre, `t` 0, to its edge, `t` 1. */
const heightProfile = (t: number): number => 0.06 + 0.94 * (1 - t) ** 1.8;

/** How many landmarks a town of `radius` takes: two for a capital, one for a city. */
const landmarksFor = (radius: number): number =>
  radius >= CAPITAL_RADIUS ? 2 : radius >= CITY_RADIUS ? 1 : 0;

/** The footprint of a model on a grid, in world units: its lots less the setback each side. */
export function footprint(
  model: { lots: readonly [number, number] },
  grid: Pick<TownGrid, "lot" | "setback">,
): [number, number] {
  return [
    model.lots[0] * grid.lot - 2 * grid.setback,
    model.lots[1] * grid.lot - 2 * grid.setback,
  ];
}

/** Where block `i` starts along one axis of the grid, for `i` from 0 up. */
export function blockStart(i: number, block: number, grid: TownGrid): number {
  return (
    grid.avenue / 2 +
    i * (block + grid.street) +
    Math.floor(i / grid.avenueEvery) * (grid.avenue - grid.street)
  );
}

/**
 * What lies at `t` along one axis of the grid, for blocks `block` long: the
 * width of the street there and how far `t` is from its middle, or a width
 * of 0 inside a block. The street ground's shader works the same sum out for
 * every pixel, so the two must agree.
 */
export function streetGap(
  t: number,
  block: number,
  grid: TownGrid,
): { width: number; off: number } {
  const a = Math.abs(t) - grid.avenue / 2;
  if (a < 0) return { width: grid.avenue, off: Math.abs(t) };
  const pitch = block + grid.street;
  const period = grid.avenueEvery * pitch + grid.avenue - grid.street;
  const r = a % period;
  const j = Math.min(Math.floor(r / pitch), grid.avenueEvery - 1);
  const q = r - j * pitch;
  if (q < block) return { width: 0, off: 0 };
  const width = j === grid.avenueEvery - 1 ? grid.avenue : grid.street;
  return { width, off: Math.abs(q - block - width / 2) };
}

/** Every block's start along one axis, both sides of the centre, out to `reach`. */
function blockStarts(block: number, reach: number, grid: TownGrid): number[] {
  const out: number[] = [];
  for (let i = 0; blockStart(i, block, grid) < reach; i++) {
    const s = blockStart(i, block, grid);
    out.push(s, -s - block);
  }
  return out;
}

/** Whether ground at `x, z` can be built on: not too steep, wet or close to a river. */
function buildableAt(ground: TownGround, x: number, z: number): boolean {
  if (ground.buildable(x, z) < BUILD_FIT) return false;
  return !ground.riverEdge || ground.riverEdge(x, z) >= RIVER_BANK;
}

/**
 * Lay a town out as lots on a street grid. Each lot is judged once at its
 * centre, then takes a model near the height wanted there whose lots are all
 * free, drawn a little taller or lower than it was modelled. A town the size
 * of a city gets one of the models marked as landmarks in a block at its
 * centre, and a capital two. A lot left unbuilt inside the town may then take one of the
 * models marked as fillers, picked from a second run of numbers so that the
 * buildings stand where they would with no fillers. A town with no lot to
 * build on gets its lowest single lot model at its centre, if the ground
 * there allows it.
 */
export function layoutTown(
  town: Town,
  grid: TownGrid,
  models: readonly Pick<
    BuildingModel,
    "lots" | "height" | "filler" | "landmark"
  >[],
  ground: TownGround,
): Placement[] {
  const out: Placement[] = [];
  const rand = seeded(Math.floor(town.seed * 1e9));
  const spareRand = seeded(Math.floor(town.seed * 1e9) + 7);
  const pickRand = seeded(Math.floor(town.seed * 1e9) + 13);
  const fillers = models.flatMap((m, k) => (m.filler ? [k] : []));
  const landmarks = models.flatMap((m, k) => (m.landmark ? [k] : []));
  let landmarksLeft = landmarks.length === 0 ? 0 : landmarksFor(town.radius);
  /** The central block the first landmark stands in. */
  let landmarkBlock: [number, number] | null = null;
  const cos = Math.cos(town.axis);
  const sin = Math.sin(town.axis);
  const reach = town.radius * 1.3;
  const [nu, nv] = grid.blockLots;
  // A village is lower than a capital.
  const stature = Math.min(1, town.radius / CAPITAL_RADIUS) ** 0.7;
  const tallest = Math.max(
    ...models.filter((m) => !m.filler && !m.landmark).map((m) => m.height),
  );

  /**
   * The height wanted on the lot at `u, v` in the town's frame, `SPARE` for a
   * lot the town leaves unbuilt, or null for one outside it or on a street,
   * a slope or water.
   */
  const wantAt = (u: number, v: number): number | null => {
    const dx = u * cos - v * sin;
    const dz = u * sin + v * cos;
    const dist = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    const t = dist / townEdge(town, angle);
    if (t > 1) return null;
    for (const street of town.streets) {
      const along = dist * Math.cos(angle - street);
      const across = Math.abs(dist * Math.sin(angle - street));
      if (along > 0 && across < (grid.boulevard + grid.lot) / 2) return null;
    }
    if (!buildableAt(ground, town.x + dx, town.z + dz)) return null;
    if (rand() > 1 - (1 - grid.edgeDensity) * t * t) return SPARE;
    const profile = heightProfile(t);
    const want = tallest * stature * profile * (0.45 + 0.9 * rand());
    if (fillers.length > 0 && spareRand() < CLEARED) return SPARE;
    return want > TOWER_FROM * tallest * stature && pickRand() < grid.gaps
      ? want * GAP_HEIGHT
      : want;
  };

  const place = (
    model: number,
    bu: number,
    bv: number,
    a: number,
    b: number,
    turned: boolean,
    stretch: number,
  ) => {
    const m = models[model];
    const [la, lb] = turned ? [m.lots[1], m.lots[0]] : m.lots;
    const u = bu + (a + la / 2) * grid.lot;
    const v = bv + (b + lb / 2) * grid.lot;
    out.push({
      model,
      x: town.x + u * cos - v * sin,
      z: town.z + u * sin + v * cos,
      turn: turned ? -town.axis + Math.PI / 2 : -town.axis,
      stretch,
    });
  };

  // The first two starts each way are the blocks that touch the centre, and
  // the next two the blocks behind them.
  const us = blockStarts(nu * grid.lot, reach, grid);
  const vs = blockStarts(nv * grid.lot, reach, grid);
  for (const [iu, bu] of us.entries())
    for (const [iv, bv] of vs.entries()) {
      const taken = new Uint8Array(nu * nv);
      // Each lot is judged once, so a wide model sees the same answer.
      const wants: (number | null)[] = [];
      for (let a = 0; a < nu; a++)
        for (let b = 0; b < nv; b++)
          wants.push(
            wantAt(bu + (a + 0.5) * grid.lot, bv + (b + 0.5) * grid.lot),
          );
      const open = (i: number, j: number) =>
        !taken[i * nv + j] &&
        wants[i * nv + j] !== null &&
        wants[i * nv + j] !== SPARE;
      // A landmark in one of the blocks nearest the centre, where a boulevard
      // leaves it room. The second stands across the centre from the first.
      if (
        landmarksLeft > 0 &&
        iu < 2 &&
        iv < 4 &&
        (!landmarkBlock || landmarkBlock[0] !== iu)
      ) {
        const k =
          landmarks[
            (Math.floor(pickRand() * landmarks.length) + landmarksLeft) %
              landmarks.length
          ];
        const [la, lb] = models[k].lots;
        // Block 0 starts at the centre and block 1 ends there.
        const starts = Array.from({ length: nu - la + 1 }, (_, i) =>
          iu === 0 ? i : nu - la - i,
        );
        const a = starts.find((from) => {
          for (let i = 0; i < la; i++)
            for (let j = 0; j < lb; j++)
              if (j >= nv || !open(from + i, j)) return false;
          return true;
        });
        if (a !== undefined) {
          for (let i = 0; i < la; i++)
            for (let j = 0; j < lb; j++) taken[(a + i) * nv + j] = 1;
          place(k, bu, bv, a, 0, false, 1 - STRETCH_DRIFT * pickRand());
          landmarksLeft--;
          landmarkBlock = [iu, iv];
        }
      }
      for (let a = 0; a < nu; a++)
        for (let b = 0; b < nv; b++) {
          if (taken[a * nv + b]) continue;
          const want = wants[a * nv + b];
          if (want === null || want === SPARE) continue;
          // Every model whose lots are all free and all inside the town.
          const fits: { k: number; turned: boolean; wide: boolean }[] = [];
          models.forEach((m, k) => {
            if (m.filler || m.landmark) return;
            for (const turned of [false, true]) {
              // A square model looks the same either way round.
              if (turned && m.lots[0] === m.lots[1]) continue;
              const [la, lb] = turned ? [m.lots[1], m.lots[0]] : m.lots;
              if (a + la > nu || b + lb > nv) continue;
              let free = true;
              for (let i = 0; i < la && free; i++)
                for (let j = 0; j < lb && free; j++)
                  if (!open(a + i, b + j)) free = false;
              if (free) fits.push({ k, turned, wide: la * lb > 1 });
            }
          });
          if (fits.length === 0) continue;
          // A lot that wants more than any model that fits it has is judged
          // against the tallest that fits, so the tallest towers are not all
          // one model.
          const target = Math.min(
            want,
            Math.max(...fits.map((f) => models[f.k].height)),
          );
          const off = (f: (typeof fits)[number]) =>
            Math.abs(models[f.k].height - target) - (f.wide ? 0.02 : 0);
          const nearest = Math.min(...fits.map(off));
          const near = fits.filter(
            (f) => off(f) <= Math.max(nearest, grid.choice * target),
          );
          const pick =
            grid.choice > 0
              ? near[Math.floor(pickRand() * near.length)]
              : near[0];
          const m = models[pick.k];
          const [la, lb] = pick.turned ? [m.lots[1], m.lots[0]] : m.lots;
          for (let i = 0; i < la; i++)
            for (let j = 0; j < lb; j++) taken[(a + i) * nv + b + j] = 1;
          const stretch =
            grid.stretch > 0
              ? Math.min(
                  1 + grid.stretch,
                  Math.max(1 - grid.stretch, want / m.height),
                ) *
                (1 - STRETCH_DRIFT * pickRand())
              : 1;
          place(pick.k, bu, bv, a, b, pick.turned, stretch);
        }
      // What the buildings left: a filler on most spare lots, a wide one where
      // two spare lots lie side by side. A block with no building gets none,
      // so no park stands alone outside the town.
      const built = taken.some((t) => t === 1);
      for (let a = 0; a < nu && built && fillers.length > 0; a++)
        for (let b = 0; b < nv; b++) {
          const spare = (i: number, j: number) =>
            i < nu &&
            j < nv &&
            !taken[i * nv + j] &&
            wants[i * nv + j] === SPARE;
          if (!spare(a, b) || spareRand() > FILLED) continue;
          const k = fillers[Math.floor(spareRand() * fillers.length)];
          const m = models[k];
          const wide = m.lots[0] !== m.lots[1];
          const turned = wide && !spare(a + 1, b);
          const [la, lb] = turned ? [m.lots[1], m.lots[0]] : m.lots;
          let free = true;
          for (let i = 0; i < la; i++)
            for (let j = 0; j < lb; j++) if (!spare(a + i, b + j)) free = false;
          // A wide filler with no second lot gives way to the first that fits.
          const fit = free
            ? k
            : fillers.find(
                (f) => models[f].lots[0] === 1 && models[f].lots[1] === 1,
              );
          if (fit === undefined) continue;
          const [fa, fb] = fit === k ? [la, lb] : [1, 1];
          for (let i = 0; i < fa; i++)
            for (let j = 0; j < fb; j++) taken[(a + i) * nv + b + j] = 1;
          place(fit, bu, bv, a, b, fit === k && turned, 1);
        }
    }

  if (out.length === 0 && buildableAt(ground, town.x, town.z)) {
    let lowest = -1;
    models.forEach((m, k) => {
      if (m.filler || m.landmark || m.lots[0] !== 1 || m.lots[1] !== 1) return;
      if (lowest < 0 || m.height < models[lowest].height) lowest = k;
    });
    if (lowest >= 0)
      out.push({
        model: lowest,
        x: town.x,
        z: town.z,
        turn: -town.axis,
        stretch: 1,
      });
  }
  return out;
}

/** How far past its radius a town.s lots are judged, as `layoutTown` reaches. */
const EDGE_REACH = 1.3;

/** One structure an outpost's layout has placed, in lots of the outpost's own frame. */
interface Sited {
  model: number;
  /** Its first lot along the axis and across it, and how many it covers each way. */
  i: number;
  j: number;
  la: number;
  lb: number;
  /** Set when its lots run across the model's own, a quarter turn from the axis. */
  across: boolean;
  /** Set when it shares a plate with a neighbour, which holds it at its lot's centre. */
  joined: boolean;
}

/**
 * Lay a sealed outpost out on bare ground. Lots tile the outpost with no
 * streets between them. Each lot, nearest the centre first, takes a structure
 * near the height wanted there whose lots are all free, and a city or a
 * capital first takes its centrepieces. Every structure stands on a plate of
 * its own, and some neighbours share one, with a bridge across the gap
 * between them. A structure on a plate of its own is pulled a little off its
 * lot's centre and turned, so the outpost does not read as a grid.
 *
 * The plates come back with each structure's own first, in the order of the
 * placements, then the bridges.
 */
export function layoutOutpost(
  town: Town,
  grid: OutpostGrid,
  models: readonly {
    lots: readonly [number, number];
    height: number;
    landmark?: boolean;
    round?: boolean;
  }[],
  ground: TownGround,
): { placements: Placement[]; plates: Plate[] } {
  const seed = Math.floor(town.seed * 1e9);
  const rand = seeded(seed);
  const pickRand = seeded(seed + 13);
  const joinRand = seeded(seed + 29);
  const cos = Math.cos(town.axis);
  const sin = Math.sin(town.axis);
  const { lot } = grid;
  const n = Math.ceil((town.radius * EDGE_REACH) / lot);
  const stature = Math.min(1, town.radius / CAPITAL_RADIUS) ** 0.7;
  const plain = models.flatMap((m, k) => (m.landmark ? [] : [k]));
  const tallest = Math.max(...plain.map((k) => models[k].height));

  /** A point in the outpost's frame, `u` along its axis, in world x and z. */
  const world = (u: number, v: number): [number, number] => [
    town.x + u * cos - v * sin,
    town.z + u * sin + v * cos,
  ];

  // Each lot is judged once, at its centre: null outside the outpost or where
  // nothing can be built, SPARE where the outpost leaves it bare.
  const side = 2 * n;
  const wants: (number | null)[] = [];
  for (let i = -n; i < n; i++)
    for (let j = -n; j < n; j++) {
      const u = (i + 0.5) * lot;
      const v = (j + 0.5) * lot;
      const [x, z] = world(u, v);
      const dist = Math.hypot(x - town.x, z - town.z);
      const t = dist / townEdge(town, Math.atan2(z - town.z, x - town.x));
      if (t > 1 || !buildableAt(ground, x, z)) {
        wants.push(null);
        continue;
      }
      if (rand() > grid.fill * (1 - (1 - grid.edgeDensity) * t * t)) {
        wants.push(SPARE);
        continue;
      }
      wants.push(tallest * stature * heightProfile(t) * (0.45 + 0.9 * rand()));
    }
  const at = (i: number, j: number) =>
    i < -n || j < -n || i >= n || j >= n ? null : wants[(i + n) * side + j + n];
  const taken = new Set<string>();
  const open = (i: number, j: number) => {
    const want = at(i, j);
    return want !== null && want !== SPARE && !taken.has(`${i},${j}`);
  };
  const fits = (i: number, j: number, la: number, lb: number) => {
    for (let a = 0; a < la; a++)
      for (let b = 0; b < lb; b++) if (!open(i + a, j + b)) return false;
    return true;
  };

  // Lots nearest the centre first, so the centrepieces and the tallest
  // structures take the middle.
  const order: [number, number][] = [];
  for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) order.push([i, j]);
  order.sort(
    ([ai, aj], [bi, bj]) =>
      Math.hypot(ai + 0.5, aj + 0.5) - Math.hypot(bi + 0.5, bj + 0.5),
  );

  const sited: Sited[] = [];
  const site = (k: number, i: number, j: number, across: boolean) => {
    const [la, lb] = across
      ? [models[k].lots[1], models[k].lots[0]]
      : models[k].lots;
    for (let a = 0; a < la; a++)
      for (let b = 0; b < lb; b++) taken.add(`${i + a},${j + b}`);
    sited.push({ model: k, i, j, la, lb, across, joined: false });
  };
  /** Both ways round for a model longer one way than the other. */
  const ways = (k: number) =>
    models[k].lots[0] === models[k].lots[1] ? [false] : [false, true];

  const landmarks = models.flatMap((m, k) => (m.landmark ? [k] : []));
  let landmarksLeft = landmarks.length === 0 ? 0 : landmarksFor(town.radius);
  for (const [i, j] of order) {
    if (landmarksLeft === 0) break;
    const k = landmarks[Math.floor(pickRand() * landmarks.length)];
    const way = ways(k).find((across) => {
      const [la, lb] = across
        ? [models[k].lots[1], models[k].lots[0]]
        : models[k].lots;
      return fits(i, j, la, lb);
    });
    if (way === undefined) continue;
    site(k, i, j, way);
    landmarksLeft--;
  }

  for (const [i, j] of order) {
    const want = at(i, j);
    if (want === null || want === SPARE || !open(i, j)) continue;
    const options: { k: number; across: boolean }[] = [];
    for (const k of plain)
      for (const across of ways(k)) {
        const [la, lb] = across
          ? [models[k].lots[1], models[k].lots[0]]
          : models[k].lots;
        if (fits(i, j, la, lb)) options.push({ k, across });
      }
    if (options.length === 0) continue;
    // A lot that wants more than any structure that fits is judged against
    // the tallest that does.
    const target = Math.min(
      want,
      Math.max(...options.map((o) => models[o.k].height)),
    );
    const off = (o: (typeof options)[number]) =>
      Math.abs(models[o.k].height - target);
    const nearest = Math.min(...options.map(off));
    const near = options.filter(
      (o) => off(o) <= Math.max(nearest, grid.choice * target),
    );
    const pick = near[Math.floor(pickRand() * near.length)];
    site(pick.k, i, j, pick.across);
  }

  if (sited.length === 0) {
    if (!buildableAt(ground, town.x, town.z))
      return { placements: [], plates: [] };
    let lowest = -1;
    for (const k of plain) {
      const m = models[k];
      if (m.lots[0] !== 1 || m.lots[1] !== 1) continue;
      if (lowest < 0 || m.height < models[lowest].height) lowest = k;
    }
    if (lowest < 0) return { placements: [], plates: [] };
    // Centred on the anchor, so its lot runs from half a lot either side.
    sited.push({
      model: lowest,
      i: -0.5,
      j: -0.5,
      la: 1,
      lb: 1,
      across: false,
      // Held on the anchor, as a joined structure is held on its lot.
      joined: true,
    });
  }

  // Neighbours whose lots share an edge may share a plate. The bridge spans
  // the gap between their own plates, as wide as the side they share.
  const inset = grid.setback - grid.plateMargin;
  const bridges: Plate[] = [];
  for (let a = 0; a < sited.length; a++)
    for (let b = a + 1; b < sited.length; b++) {
      const p = sited[a];
      const q = sited[b];
      const alongU = p.i + p.la === q.i || q.i + q.la === p.i;
      const alongV = p.j + p.lb === q.j || q.j + q.lb === p.j;
      const shareV = Math.min(p.j + p.lb, q.j + q.lb) - Math.max(p.j, q.j);
      const shareU = Math.min(p.i + p.la, q.i + q.la) - Math.max(p.i, q.i);
      let bridge: { u: number; v: number; w: number; d: number } | null = null;
      if (alongU && shareV > 0) {
        const edge = p.i + p.la === q.i ? q.i : p.i;
        const from = Math.max(p.j, q.j);
        bridge = {
          u: edge * lot,
          v: (from + shareV / 2) * lot,
          w: 2 * inset,
          d: shareV * lot - 2 * inset,
        };
      } else if (alongV && shareU > 0) {
        const edge = p.j + p.lb === q.j ? q.j : p.j;
        const from = Math.max(p.i, q.i);
        bridge = {
          u: (from + shareU / 2) * lot,
          v: edge * lot,
          w: shareU * lot - 2 * inset,
          d: 2 * inset,
        };
      }
      if (!bridge || joinRand() >= grid.join) continue;
      p.joined = true;
      q.joined = true;
      const [x, z] = world(bridge.u, bridge.v);
      bridges.push({ x, z, turn: -town.axis, w: bridge.w, d: bridge.d });
    }

  const placements: Placement[] = [];
  const plates: Plate[] = [];
  for (const s of sited) {
    const m = models[s.model];
    let u = (s.i + s.la / 2) * lot;
    let v = (s.j + s.lb / 2) * lot;
    if (!s.joined) {
      u += (2 * rand() - 1) * grid.jitter;
      v += (2 * rand() - 1) * grid.jitter;
    }
    const base = -town.axis + (s.across ? Math.PI / 2 : 0);
    // A square structure may face any side, a long one either end, and a
    // round one any way at all.
    const square = m.lots[0] === m.lots[1];
    const spin =
      square && m.round
        ? rand() * Math.PI * 2
        : square
          ? Math.floor(rand() * 4) * (Math.PI / 2)
          : Math.floor(rand() * 2) * Math.PI;
    const [x, z] = world(u, v);
    placements.push({ model: s.model, x, z, turn: base + spin, stretch: 1 });
    plates.push({
      x,
      z,
      turn: -town.axis,
      w: s.la * lot - 2 * inset,
      d: s.lb * lot - 2 * inset,
    });
  }
  return { placements, plates: [...plates, ...bridges] };
}

/**
 * A `riverEdge` for a map's river field, or undefined for a map with none.
 * `picture` is the image the field covers and `margin` the pixels it holds
 * past the map each side.
 */
export function riverEdgeReader(
  rivers: { field: RiverField } | undefined,
  picture: { width: number; height: number },
  margin: number,
  frame: { worldWidth: number; worldDepth: number },
): TownGround["riverEdge"] {
  if (!rivers) return undefined;
  const { data, width, height } = rivers.field;
  const span = RIVER_FIELD_INSIDE + RIVER_FIELD_OUTSIDE;
  return (x, z) => {
    const u = x / frame.worldWidth + 0.5;
    const v = z / frame.worldDepth + 0.5;
    const fu =
      (u * (picture.width - 2 * margin)) / picture.width +
      margin / picture.width;
    const fv =
      (v * (picture.height - 2 * margin)) / picture.height +
      margin / picture.height;
    const i = Math.min(width - 1, Math.max(0, Math.floor(fu * width)));
    const j = Math.min(height - 1, Math.max(0, Math.floor(fv * height)));
    return (data[j * width + i] / 255) * span - RIVER_FIELD_INSIDE;
  };
}
