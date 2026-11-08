/**
 * Where a map's metal is and how it is shared out (issue #5098).
 *
 * Numbers rather than a verdict, like the rest of the playability panel: how
 * far each start is from its nearest spots, which spots one extractor covers
 * both of, and how closely the spot layout mirrors itself.
 *
 * A spot here is a group of touching cells on the map's metal map, which is
 * one byte per 16 by 16 elmo cell (`metalmapPtr` in the `.smf`). Touching
 * includes corners. That is how the Balanced Annihilation and Complete
 * Annihilation spot finder (`mex_spot_finder.lua`) groups the same map when
 * the map ships no `map_metal_layout.lua`, so the numbers here are the ones
 * those games would work from. A map that ships a layout file has its spots
 * from that file in those games, and this does not read it.
 *
 * Pure arithmetic on typed arrays, so it runs in a worker and in tests alike.
 */

/** Elmos across one metal map cell. */
export const METAL_CELL = 16;

/** `extractorRadius` when a map's `mapinfo.lua` sets none:
 *  `CMapInfo::ReadGlobal`, `rts/Map/MapInfo.cpp`. */
export const ENGINE_EXTRACTOR_RADIUS = 500;

/** A map's metal map, `width * height` bytes, row major, north row first. */
export interface MetalGrid {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface MetalSpot {
  /** The metal weighted centre, in elmos. */
  x: number;
  z: number;
  /** The sum of the group's cell values. */
  metal: number;
  cells: number;
  /** The farthest cell centre from `x`, `z`, in elmos. */
  reach: number;
}

/**
 * Groups of touching cells with metal, in the order a scan along each row
 * from the north finds their first cell.
 */
export function findSpots(grid: MetalGrid): MetalSpot[] {
  const { bytes, width, height } = grid;
  const seen = new Uint8Array(bytes.length);
  const queue = new Int32Array(bytes.length);
  const spots: MetalSpot[] = [];
  for (let first = 0; first < bytes.length; first++) {
    if (bytes[first] === 0 || seen[first]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = first;
    seen[first] = 1;
    let metal = 0;
    let sumX = 0;
    let sumZ = 0;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const z = (i - x) / width;
      const value = bytes[i];
      metal += value;
      sumX += value * (x + 0.5);
      sumZ += value * (z + 0.5);
      for (let dz = -1; dz <= 1; dz++) {
        const nz = z + dz;
        if (nz < 0 || nz >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = nz * width + nx;
          if (bytes[j] !== 0 && !seen[j]) {
            seen[j] = 1;
            queue[tail++] = j;
          }
        }
      }
    }
    const cx = sumX / metal;
    const cz = sumZ / metal;
    let reach = 0;
    for (let k = 0; k < tail; k++) {
      const x = queue[k] % width;
      const z = (queue[k] - x) / width;
      reach = Math.max(reach, Math.hypot(x + 0.5 - cx, z + 0.5 - cz));
    }
    spots.push({
      x: cx * METAL_CELL,
      z: cz * METAL_CELL,
      metal,
      cells: tail,
      reach: reach * METAL_CELL,
    });
  }
  return spots;
}

type Point = { x: number; z: number };

/** A way to fold the map onto itself. */
export type MirrorName = "centre" | "eastWest" | "northSouth";

export interface MirrorGap {
  mirror: MirrorName;
  /** The largest distance from a start's mirror image to the nearest start.
   *  Null with fewer than two starts. */
  starts: number | null;
  /** The same for spots. Null with no spots. */
  spots: number | null;
  /** The spot with the largest gap, the first found on a tie. */
  worst: Point | null;
}

export interface MetalResult {
  extractorRadius: number;
  spotCount: number;
  /** For each start, the distances to its nearest spots, nearest first. */
  nearest: { start: number; distances: number[] }[];
  /** How many pairs of spots are closer together than the extractor radius. */
  closeCount: number;
  /** The closest of those pairs, closest first. */
  close: { ax: number; az: number; bx: number; bz: number; distance: number }[];
  /** How many spots have metal farther than the radius from their centre,
   *  which one extractor on the centre cannot cover. */
  wide: number;
  /** The farthest any spot's metal reaches from its centre. */
  widest: number;
  mirrors: MirrorGap[];
}

/** How many of a start's nearest spots are listed. */
const NEAREST = 3;

/** How many close pairs are kept. A map whose metal is spread thin can have
 *  millions, and the count says so. */
const CLOSEST_PAIRS = 8;

const MIRRORS: {
  mirror: MirrorName;
  at: (p: Point, w: number, h: number) => Point;
}[] = [
  { mirror: "centre", at: (p, w, h) => ({ x: w - p.x, z: h - p.z }) },
  { mirror: "eastWest", at: (p, w) => ({ x: w - p.x, z: p.z }) },
  { mirror: "northSouth", at: (p, _w, h) => ({ x: p.x, z: h - p.z }) },
];

/** The largest distance from a point's mirror image to the nearest point. */
function worstGap(
  points: Point[],
  image: (p: Point) => Point,
): { gap: number; at: Point } | null {
  let worst: { gap: number; at: Point } | null = null;
  for (const p of points) {
    const m = image(p);
    let nearest = Infinity;
    for (const q of points) {
      nearest = Math.min(nearest, Math.hypot(q.x - m.x, q.z - m.z));
    }
    if (!worst || nearest > worst.gap) worst = { gap: nearest, at: p };
  }
  return worst;
}

/** Every measurement for one map's metal. */
export function measureMetal(
  grid: MetalGrid,
  extractorRadius: number,
  starts: Point[],
): MetalResult {
  const spots = findSpots(grid);
  const worldX = grid.width * METAL_CELL;
  const worldZ = grid.height * METAL_CELL;

  const nearest = starts.map((s, start) => ({
    start,
    distances: spots
      .map((p) => Math.hypot(p.x - s.x, p.z - s.z))
      .sort((a, b) => a - b)
      .slice(0, NEAREST),
  }));

  const close: MetalResult["close"] = [];
  let closeCount = 0;
  for (let a = 0; a < spots.length; a++) {
    for (let b = a + 1; b < spots.length; b++) {
      const distance = Math.hypot(
        spots[a].x - spots[b].x,
        spots[a].z - spots[b].z,
      );
      if (distance >= extractorRadius) continue;
      closeCount++;
      if (
        close.length === CLOSEST_PAIRS &&
        distance >= close[CLOSEST_PAIRS - 1].distance
      ) {
        continue;
      }
      let at = close.length;
      while (at > 0 && close[at - 1].distance > distance) at--;
      close.splice(at, 0, {
        ax: spots[a].x,
        az: spots[a].z,
        bx: spots[b].x,
        bz: spots[b].z,
        distance,
      });
      if (close.length > CLOSEST_PAIRS) close.pop();
    }
  }

  let wide = 0;
  let widest = 0;
  for (const s of spots) {
    if (s.reach > extractorRadius) wide++;
    widest = Math.max(widest, s.reach);
  }

  const mirrors = MIRRORS.map(({ mirror, at }): MirrorGap => {
    const image = (p: Point) => at(p, worldX, worldZ);
    const startGap = starts.length >= 2 ? worstGap(starts, image) : null;
    const spotGap = worstGap(spots, image);
    return {
      mirror,
      starts: startGap ? startGap.gap : null,
      spots: spotGap ? spotGap.gap : null,
      worst: spotGap ? { x: spotGap.at.x, z: spotGap.at.z } : null,
    };
  });

  return {
    extractorRadius,
    spotCount: spots.length,
    nearest,
    closeCount,
    close,
    wide,
    widest,
    mirrors,
  };
}
