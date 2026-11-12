/**
 * Where a town's street trees stand: a row down each side of every main
 * street, on the strip its cleared lots leave, and a row down the planted
 * middle of every avenue. Pure, and seeded from the town, so a map always
 * grows the same ones.
 */
import { seeded } from "../landmarks/kit";
import { type Town, townEdge } from "../towns";
import { blockStart, streetGap, type TownGrid } from "./layout";

export interface StreetTree {
  x: number;
  z: number;
}

/** The gap between one street tree and the next along its row. */
export const TREE_GAP = 0.15;
/** How far a main street's trees stand outside its carriageway. */
const KERB = 0.06;
/** How far inside the town's edge the rows stop, as a share of it. */
const ROW_END = 0.92;
/** The share of places in a row left empty, so no row is ruled. */
const MISSING = 0.15;

/**
 * The street trees of `town`. `free` answers whether a tree may stand at a
 * point: on ground fit to build on, and clear of every building.
 */
export function streetTrees(
  town: Town,
  grid: TownGrid,
  free: (x: number, z: number) => boolean,
): StreetTree[] {
  const out: StreetTree[] = [];
  const rand = seeded(Math.floor(town.seed * 1e9) + 29);
  const inside = (x: number, z: number) => {
    const dx = x - town.x;
    const dz = z - town.z;
    return Math.hypot(dx, dz) < townEdge(town, Math.atan2(dz, dx)) * ROW_END;
  };
  /** How far `x, z` lies across the nearest main street's carriageway, as a share of its half width. */
  const onMainStreet = (x: number, z: number) => {
    const dx = x - town.x;
    const dz = z - town.z;
    return town.streets.some((a) => {
      const along = dx * Math.cos(a) + dz * Math.sin(a);
      const across = Math.abs(dx * Math.sin(a) - dz * Math.cos(a));
      return along > 0 && across < grid.boulevard / 2 + KERB / 2;
    });
  };
  const put = (x: number, z: number) => {
    const skip = rand() < MISSING;
    const jx = (rand() - 0.5) * 0.03;
    const jz = (rand() - 0.5) * 0.03;
    if (skip || !inside(x, z) || !free(x, z)) return;
    out.push({ x: x + jx, z: z + jz });
  };

  // Down each side of every main street, from the centre's first block out.
  const reach = town.radius * 1.3;
  for (const a of town.streets) {
    const [cx, cz] = [Math.cos(a), Math.sin(a)];
    for (let along = grid.avenue; along < reach; along += TREE_GAP)
      for (const side of [-1, 1]) {
        const across = side * (grid.boulevard / 2 + KERB);
        const x = town.x + cx * along - cz * across;
        const z = town.z + cz * along + cx * across;
        // Not where another main street's carriageway crosses this row.
        if (!onMainStreet(x, z)) put(x, z);
      }
  }

  // Down the middle of every avenue, each way, but for its crossings.
  const cos = Math.cos(town.axis);
  const sin = Math.sin(town.axis);
  const [bu, bv] = [grid.blockLots[0] * grid.lot, grid.blockLots[1] * grid.lot];
  const centres = (block: number) => {
    const list = [0];
    for (let i = grid.avenueEvery - 1; ; i += grid.avenueEvery) {
      const c = blockStart(i, block, grid) + block + grid.avenue / 2;
      if (c > reach) break;
      list.push(c, -c);
    }
    return list;
  };
  const row = (centre: number, alongU: boolean) => {
    for (let t = -reach; t < reach; t += TREE_GAP) {
      // Along u the avenue lies at a fixed v, and the other way about.
      const [u, v] = alongU ? [t, centre] : [centre, t];
      if (streetGap(t, alongU ? bu : bv, grid).width > 0) continue;
      const x = town.x + u * cos - v * sin;
      const z = town.z + u * sin + v * cos;
      if (!onMainStreet(x, z)) put(x, z);
    }
  };
  for (const c of centres(bv)) row(c, true);
  for (const c of centres(bu)) row(c, false);
  return out;
}
