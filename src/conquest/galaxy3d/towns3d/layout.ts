/**
 * Where each building stands in a town. A town is laid out as lots on a street
 * grid, like an American city: blocks along the town's axis with an avenue
 * through the centre each way, the town's main streets kept clear as
 * boulevards, tall in the middle and low at the edge. Pure, so it is tested
 * without a scene. Which model goes on which lot is decided here, how a model
 * is drawn is not.
 */
import type { SettlementStyle } from "../../planets";
import {
  RIVER_FIELD_INSIDE,
  RIVER_FIELD_OUTSIDE,
  type RiverField,
} from "../../rivers";
import { seeded } from "../landmarks/kit";
import { CAPITAL_RADIUS, type Town, townEdge } from "../towns";
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
};

/** A sealed outpost's planet: lots three times the side, for a few big structures. */
export const SEALED_GRID: TownGrid = {
  lot: 0.75,
  blockLots: [2, 2],
  street: 0.2,
  avenue: 0.3,
  avenueEvery: 2,
  boulevard: 0.35,
  setback: 0.05,
  edgeDensity: 0.7,
};

export const gridFor = (style: SettlementStyle): TownGrid =>
  style === "sealed" ? SEALED_GRID : OPEN_GRID;

export interface Placement {
  /** Index into the models the layout was given. */
  model: number;
  /** The building's centre in world x and z. */
  x: number;
  z: number;
  /** Its turn about the vertical: the town's, plus a quarter when it stands across the block. */
  turn: number;
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

/** The footprint of a model on a grid, in world units: its lots less the setback each side. */
export function footprint(
  model: Pick<BuildingModel, "lots">,
  grid: TownGrid,
): [number, number] {
  return [
    model.lots[0] * grid.lot - 2 * grid.setback,
    model.lots[1] * grid.lot - 2 * grid.setback,
  ];
}

/** Where block `i` starts along one axis of the grid, for `i` from 0 up. */
function blockStart(i: number, block: number, grid: TownGrid): number {
  return (
    grid.avenue / 2 +
    i * (block + grid.street) +
    Math.floor(i / grid.avenueEvery) * (grid.avenue - grid.street)
  );
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
 * centre, then takes the model nearest the height wanted there whose lots are
 * all free. A town with no lot to build on gets its lowest single lot model at
 * its centre, if the ground there allows it.
 */
export function layoutTown(
  town: Town,
  grid: TownGrid,
  models: readonly Pick<BuildingModel, "lots" | "height">[],
  ground: TownGround,
): Placement[] {
  const out: Placement[] = [];
  const rand = seeded(Math.floor(town.seed * 1e9));
  const cos = Math.cos(town.axis);
  const sin = Math.sin(town.axis);
  const reach = town.radius * 1.3;
  const [nu, nv] = grid.blockLots;
  // A village is lower than a capital.
  const stature = Math.min(1, town.radius / CAPITAL_RADIUS) ** 0.7;
  const tallest = Math.max(...models.map((m) => m.height));

  /** The height wanted on the lot at `u, v` in the town's frame, or null to leave it empty. */
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
    if (rand() > 1 - (1 - grid.edgeDensity) * t * t) return null;
    const profile = 0.06 + 0.94 * (1 - t) ** 1.8;
    return tallest * stature * profile * (0.45 + 0.9 * rand());
  };

  for (const bu of blockStarts(nu * grid.lot, reach, grid))
    for (const bv of blockStarts(nv * grid.lot, reach, grid)) {
      const taken = new Uint8Array(nu * nv);
      // Each lot is judged once, so a wide model sees the same answer.
      const wants: (number | null)[] = [];
      for (let a = 0; a < nu; a++)
        for (let b = 0; b < nv; b++)
          wants.push(
            wantAt(bu + (a + 0.5) * grid.lot, bv + (b + 0.5) * grid.lot),
          );
      for (let a = 0; a < nu; a++)
        for (let b = 0; b < nv; b++) {
          if (taken[a * nv + b]) continue;
          const want = wants[a * nv + b];
          if (want === null) continue;
          // The model nearest the wanted height whose lots are all free and
          // all inside the town.
          let best = -1;
          let bestTurned = false;
          let bestOff = Number.POSITIVE_INFINITY;
          models.forEach((m, k) => {
            for (const turned of [false, true]) {
              // A square model looks the same either way round.
              if (turned && m.lots[0] === m.lots[1]) continue;
              const [la, lb] = turned ? [m.lots[1], m.lots[0]] : m.lots;
              if (a + la > nu || b + lb > nv) continue;
              let free = true;
              for (let i = 0; i < la && free; i++)
                for (let j = 0; j < lb && free; j++)
                  if (
                    taken[(a + i) * nv + b + j] ||
                    wants[(a + i) * nv + b + j] === null
                  )
                    free = false;
              if (!free) continue;
              const off = Math.abs(m.height - want) - (la * lb > 1 ? 0.02 : 0);
              if (off < bestOff) {
                bestOff = off;
                best = k;
                bestTurned = turned;
              }
            }
          });
          if (best < 0) continue;
          const m = models[best];
          const [la, lb] = bestTurned ? [m.lots[1], m.lots[0]] : m.lots;
          for (let i = 0; i < la; i++)
            for (let j = 0; j < lb; j++) taken[(a + i) * nv + b + j] = 1;
          const u = bu + (a + la / 2) * grid.lot;
          const v = bv + (b + lb / 2) * grid.lot;
          out.push({
            model: best,
            x: town.x + u * cos - v * sin,
            z: town.z + u * sin + v * cos,
            turn: bestTurned ? -town.axis + Math.PI / 2 : -town.axis,
          });
        }
    }

  if (out.length === 0 && buildableAt(ground, town.x, town.z)) {
    let lowest = -1;
    models.forEach((m, k) => {
      if (m.lots[0] !== 1 || m.lots[1] !== 1) return;
      if (lowest < 0 || m.height < models[lowest].height) lowest = k;
    });
    if (lowest >= 0)
      out.push({ model: lowest, x: town.x, z: town.z, turn: -town.axis });
  }
  return out;
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
