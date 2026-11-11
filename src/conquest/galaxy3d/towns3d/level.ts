import type { HeightGrid } from "../terrain";
import { type Town, townEdge } from "../towns";

/** A grid value at or below this is sea. */
export const SEA_HEIGHT = 0.5 / 255;
/** Flat inside this share of the town's edge. */
export const LEVEL_CORE = 0.95;
/** Back to the land's own height at this share of the town's edge. */
export const LEVEL_SKIRT = 1.7;

/** The furthest a town's edge reaches, as a share of its radius. */
const EDGE_REACH = 1.27;

/** The size of the sheet in world units. */
export interface LevelFrame {
  worldWidth: number;
  worldDepth: number;
}

export interface GroundGrids {
  heights: HeightGrid;
  /** The wider grids, with `margin` pixels past the map each side. */
  extension?: { heights: HeightGrid; relief?: HeightGrid; margin: number };
}

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Call `visit` for every pixel of `grid` within `reach` world units of the
 * town, with the pixel's index and its share of the town's edge. A grid with
 * `margin` pixels past the map each side stands where `sampleHeightGrid` and
 * `createMarginSurface` put it.
 */
function visitTown(
  grid: HeightGrid,
  margin: number,
  town: Town,
  reach: number,
  frame: LevelFrame,
  visit: (index: number, share: number) => void,
): void {
  const stepsX = Math.max(1, grid.width - 2 * margin - 1);
  const stepsZ = Math.max(1, grid.height - 2 * margin - 1);
  const toI = (x: number) => (x / frame.worldWidth + 0.5) * stepsX + margin;
  const toJ = (z: number) => (z / frame.worldDepth + 0.5) * stepsZ + margin;
  const i0 = Math.max(0, Math.floor(toI(town.x - reach)));
  const i1 = Math.min(grid.width - 1, Math.ceil(toI(town.x + reach)));
  const j0 = Math.max(0, Math.floor(toJ(town.z - reach)));
  const j1 = Math.min(grid.height - 1, Math.ceil(toJ(town.z + reach)));
  for (let j = j0; j <= j1; j++) {
    const dz = ((j - margin) / stepsZ - 0.5) * frame.worldDepth - town.z;
    for (let i = i0; i <= i1; i++) {
      const dx = ((i - margin) / stepsX - 0.5) * frame.worldWidth - town.x;
      const distance = Math.hypot(dx, dz);
      if (distance > reach) continue;
      const share = distance / townEdge(town, Math.atan2(dz, dx));
      visit(j * grid.width + i, share);
    }
  }
}

/** Each town's level as a grid value, or null for a town with no dry land. */
export function townLevels(
  heights: HeightGrid,
  towns: Town[],
  frame: LevelFrame,
): (number | null)[] {
  return towns.map((town) => {
    let sum = 0;
    let count = 0;
    visitTown(
      heights,
      0,
      town,
      town.radius * EDGE_REACH * LEVEL_CORE,
      frame,
      (index, share) => {
        const raw = heights.data[index];
        if (share > LEVEL_CORE || raw <= SEA_HEIGHT) return;
        sum += raw;
        count++;
      },
    );
    return count === 0 ? null : sum / count;
  });
}

/** Level one grid, which stands `margin` pixels in from the map's own edge. */
function levelGrid(
  grid: HeightGrid,
  margin: number,
  towns: Town[],
  levels: (number | null)[],
  frame: LevelFrame,
): HeightGrid {
  const pull = new Float64Array(grid.data.length);
  const weighted = new Float64Array(grid.data.length);
  towns.forEach((town, k) => {
    const level = levels[k];
    if (level === null) return;
    visitTown(
      grid,
      margin,
      town,
      town.radius * EDGE_REACH * LEVEL_SKIRT,
      frame,
      (index, share) => {
        const w = 1 - smoothstep(LEVEL_CORE, LEVEL_SKIRT, share);
        pull[index] += w;
        weighted[index] += w * level;
      },
    );
  });
  const data = new Float32Array(grid.data.length);
  for (let index = 0; index < data.length; index++) {
    const raw = grid.data[index];
    data[index] =
      raw <= SEA_HEIGHT
        ? raw
        : raw +
          (weighted[index] - raw * pull[index]) / Math.max(1, pull[index]);
  }
  return { data, width: grid.width, height: grid.height };
}

/**
 * The grids with the ground under every town levelled, so buildings can stand
 * on it. The levels come from the map's own heights and are used for the wider
 * grids too, so all three agree. Returns new grids and never writes to the
 * ones it is given, and returns `grids` itself when there are no towns.
 */
export function levelGround<G extends GroundGrids>(
  grids: G,
  towns: Town[],
  frame: LevelFrame,
): G {
  if (towns.length === 0) return grids;
  const levels = townLevels(grids.heights, towns, frame);
  const out: G = {
    ...grids,
    heights: levelGrid(grids.heights, 0, towns, levels, frame),
  };
  const { extension } = grids;
  if (extension) {
    const { margin } = extension;
    out.extension = {
      ...extension,
      heights: levelGrid(extension.heights, margin, towns, levels, frame),
      ...(extension.relief
        ? { relief: levelGrid(extension.relief, margin, towns, levels, frame) }
        : {}),
    };
  }
  return out;
}
