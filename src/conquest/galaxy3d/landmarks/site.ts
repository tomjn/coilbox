/**
 * Where a landmark stands: the flattest dry ground near its location, at a
 * size that keeps it clear of its neighbours, turned to the road that reaches
 * it.
 */
import type { TerrainSurface } from "../terrain";

export interface LandmarkSite {
  /** World position of the landmark's origin. */
  x: number;
  y: number;
  z: number;
  /** How much the landmark is shrunk from its design size, 1 at most. */
  scale: number;
  /** The group's turn about the vertical, which sends the model's +x towards the arriving road. */
  facing: number;
  /**
   * The ground under the landmark in its own unturned, unscaled units, less
   * the height of its origin, so the model's parts can stand on it.
   */
  ground(x: number, z: number): number;
}

/** Bearings sampled round each candidate site. */
const BEARINGS = 24;
/** The rings sampled, as shares of the landmark's reach. */
const RINGS = [0, 0.5, 1];
/** How far from its location a landmark may move, as a share of its reach. */
const WANDER = 0.2;
/** Steps across the wander, each way. */
const STEPS = 2;
/** What a world unit of distance from the location costs against a unit of relief. */
const STAY = 0.01;

/**
 * Pick the site for a landmark of design reach `reach` at world position `at`.
 * `share` is how much of the way to the nearest of `neighbours` it may reach,
 * as towns are kept apart. `toward` is the world position the arriving road
 * comes from. Null when every candidate has sea under it.
 */
export function pickSite(
  surface: TerrainSurface,
  at: [number, number],
  neighbours: [number, number][],
  toward: [number, number] | undefined,
  reach: number,
  share: number,
): LandmarkSite | null {
  const nearest = Math.min(
    Number.POSITIVE_INFINITY,
    ...neighbours.map(([x, z]) => Math.hypot(x - at[0], z - at[1])),
  );
  const scale = Math.min(1, (share * nearest) / reach);
  const span = reach * scale;
  // A heightmap pixel of 1 in 255 is the lowest land, so half that is sea.
  const sea = (0.5 / 255) * surface.heightScale * surface.scale;
  const h = (x: number, z: number) => surface.groundHeightAtWorld(x, z);

  let best: { x: number; z: number; score: number } | null = null;
  const step = (span * WANDER) / STEPS;
  for (let i = -STEPS; i <= STEPS; i++)
    for (let j = -STEPS; j <= STEPS; j++) {
      const x = at[0] + i * step;
      const z = at[1] + j * step;
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (const ring of RINGS)
        for (let k = 0; k < BEARINGS; k++) {
          const a = (k / BEARINGS) * Math.PI * 2;
          const y = h(
            x + ring * span * Math.cos(a),
            z + ring * span * Math.sin(a),
          );
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      if (lo < sea) continue;
      const score = hi - lo + STAY * Math.hypot(x - at[0], z - at[1]);
      if (!best || score < best.score) best = { x, z, score };
    }
  if (!best) return null;

  const { x, z } = best;
  const y = h(x, z);
  const facing = toward ? Math.atan2(-(toward[1] - z), toward[0] - x) : 0;
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  return {
    x,
    y,
    z,
    scale,
    facing,
    // A turn of `facing` about y sends local (lx, lz) to
    // (lx cos + lz sin, -lx sin + lz cos).
    ground: (lx, lz) =>
      (h(
        x + (lx * cos + lz * sin) * scale,
        z + (-lx * sin + lz * cos) * scale,
      ) -
        y) /
      scale,
  };
}
