/**
 * Whether a building will stand on a given piece of ground (issue #1315).
 *
 * A layout is only correct on the terrain it was made for. A wind farm laid out
 * on the flat does not place on a slope, and a mission whose base half floats is
 * a mission that ships broken, so the editor has to be able to say which
 * buildings the engine would refuse before the author finds out in a game.
 *
 * ## The engine's rule, which this is a copy of
 *
 * Read out of `rts/Game/GameHelper.cpp` and `rts/Sim/Units/UnitDef.cpp` in
 * Recoil rather than guessed at, because a wrong "this will not build" is worse
 * than no check: an author would move a building that was fine.
 *
 * The tolerance is the unit's own. `UnitDef.cpp` reads `maxSlope` in degrees,
 * clamps it to 0..89 and turns it into `maxHeightDif = 40 * tan(maxSlope)`,
 * elmos of height difference. A def that declares nothing gets zero, which
 * means flat ground only.
 *
 * `TestUnitBuildSquare` then does two things. First it picks one height to
 * stand the building at, in `GetBuildHeight`: the average of the four heightmap
 * corners around the building's middle, pulled back inside `maxHeightDif` of
 * each of them and inside the map's own range. Then, for every heightmap square
 * the footprint covers, `CheckTerrainConstraints` demands that this one height
 * is within `maxHeightDif` of that square's ground. One square too far and the
 * whole placement is refused.
 *
 * Note what that is not. It is not "the ground is not flat" and it is not a
 * gradient: it is one levelled height against every square, so a building half
 * on a step fails on the half that is level as much as on the half that is not.
 *
 * ## What is left out, and why none of it marks a building wrongly
 *
 * - Water. `minWaterDepth` and `maxWaterDepth` are the other half of
 *   `CheckTerrainConstraints` and are not in the unit dataset, so a building in
 *   the sea is not marked. A floater is left unchecked entirely rather than
 *   checked against a seabed it never touches.
 * - `levelGround`. A def that turns it off takes its height from the ground
 *   under its middle rather than from the levelled average. The engine's
 *   default is on and the two differ by very little.
 * - Everything that is not terrain: features, other units, the building mask
 *   and geothermal vents. Overlapping buildings are `./footprint.ts`.
 *
 * Every one of those is a building this will not mark that the engine would
 * refuse. None of them is a building this marks that the engine would build.
 *
 * Arithmetic on plain values, so all of it is tested. The ground it reads is
 * supplied by the caller, so this works the same over a mission's map, a
 * library preview or anything else that can answer "how high is the ground
 * here".
 */

import {
  BUILD_SQUARE,
  type FootprintMark,
  facedFootprint,
  SQUARE_SIZE,
  type Standing,
} from "./footprint";

/**
 * The map's ground, as this check reads it.
 *
 * Corners rather than points, because the engine works on the heightmap's own
 * grid: corner `(x, z)` is the world point `(x * 8, z * 8)`, and the ground of
 * one heightmap square is the average of the four corners around it.
 */
export interface Ground {
  /** The map's height at a heightmap corner, in elmos. Out of range corners
   *  clamp to the edge, the way the engine clamps them. */
  cornerAt: (x: number, z: number) => number;
  /**
   * How far out one of those heights can be, in elmos.
   *
   * A height read back off a rendered heightmap is not the number the engine
   * holds, and this is the difference the reading can hide. It widens the
   * tolerance rather than narrowing it, so ground that might be flat enough is
   * treated as flat enough. Zero for ground that is known exactly.
   */
  slack: number;
  /** The map's own height range, which the engine clamps a build height to. */
  minHeight: number;
  maxHeight: number;
}

/**
 * The height difference a def tolerates across its footprint, in elmos.
 *
 * `UnitDef.cpp`: `maxHeightDif = 40 * tan(clamp(maxSlope, 0, 89))`. The
 * magic 40 is the engine's, and the clamp is what keeps the tangent finite.
 */
export function slopeTolerance(maxSlopeDegrees: number): number {
  const degrees = Math.min(89, Math.max(0, maxSlopeDegrees));
  return 40 * Math.tan((degrees * Math.PI) / 180);
}

/** What one def tolerates, or `null` for a def this cannot judge. */
export type SlopeOf = (def: string) => number | null;

/**
 * {@link slopeTolerance} for the units of one game.
 *
 * `null` for three different defs, all of which mean "say nothing": one the
 * game has not got, one whose dataset entry predates the field, and one that
 * floats. A floater rests on the water and the ground under it decides nothing,
 * so checking it against the seabed would mark buildings that build perfectly
 * well.
 *
 * A def declaring zero is not one of those. Zero is the engine's default and it
 * is a real answer: that building wants flat ground.
 */
export function unitSlopes(
  units: { name: string; maxSlope?: number; floatOnWater?: boolean }[],
): SlopeOf {
  const byName = new Map<string, number>();
  for (const unit of units) {
    if (unit.floatOnWater === true) continue;
    if (unit.maxSlope === undefined || !Number.isFinite(unit.maxSlope))
      continue;
    byName.set(unit.name.toLowerCase(), slopeTolerance(unit.maxSlope));
  }
  return (def) => byName.get(def.toLowerCase()) ?? null;
}

/** The ground of one heightmap square, which is the average of the four corners
 *  around it. `ReadMap.cpp` builds the engine's centre heightmap this way. */
function squareGround(ground: Ground, x: number, z: number): number {
  return (
    (ground.cornerAt(x, z) +
      ground.cornerAt(x + 1, z) +
      ground.cornerAt(x, z + 1) +
      ground.cornerAt(x + 1, z + 1)) /
    4
  );
}

/**
 * The one height the engine will stand a building at, from `GetBuildHeight`.
 *
 * The average of the four heightmap corners around the building's middle,
 * pulled back inside `tolerance` of every one of them and inside the map's
 * range. The engine looks at the middle rather than at the whole footprint
 * here, which is why a long building can be levelled to a height its far end is
 * nowhere near.
 */
function buildHeight(
  ground: Ground,
  pos: { x: number; z: number },
  tolerance: number,
): number {
  const x1 = Math.floor((pos.x - SQUARE_SIZE / 2) / SQUARE_SIZE);
  const z1 = Math.floor((pos.z - SQUARE_SIZE / 2) / SQUARE_SIZE);

  let low = ground.minHeight;
  let high = ground.maxHeight;
  let sum = 0;
  let count = 0;
  for (let x = x1; x <= x1 + 1; x++) {
    for (let z = z1; z <= z1 + 1; z++) {
      const corner = ground.cornerAt(x, z);
      sum += corner;
      count += 1;
      low = Math.max(low, corner - tolerance);
      high = Math.min(high, corner + tolerance);
    }
  }

  let average = sum / count;
  if (average < low && low < high) average = low;
  if (average > high && high > low) average = high;
  return average;
}

/**
 * Whether the engine will stand this building on this ground.
 *
 * The mark's position is already where the engine will put the building, so the
 * squares it covers are read straight off it. `tolerance` is what the def
 * allows, from {@link unitSlopes}, and `null` there is a building this cannot
 * judge rather than one it approves of.
 */
export function standsOn(
  mark: Pick<FootprintMark, "pos" | "facing" | "footprint">,
  ground: Ground,
  tolerance: number | null,
): Standing {
  if (tolerance === null) return "unknown";
  const allowed = tolerance + ground.slack;
  const faced = facedFootprint(mark.footprint, mark.facing);
  // A footprint is in build squares and the heightmap is finer, so each side
  // covers `BUILD_SQUARE / SQUARE_SIZE` heightmap squares. This is the engine's
  // `BuildInfo::GetXSize`.
  const xsize = (faced.x * BUILD_SQUARE) / SQUARE_SIZE;
  const zsize = (faced.z * BUILD_SQUARE) / SQUARE_SIZE;
  const x1 = Math.floor(mark.pos.x / SQUARE_SIZE) - (xsize >> 1);
  const z1 = Math.floor(mark.pos.z / SQUARE_SIZE) - (zsize >> 1);

  const height = buildHeight(ground, mark.pos, tolerance);
  for (let x = x1; x < x1 + xsize; x++) {
    for (let z = z1; z < z1 + zsize; z++) {
      if (Math.abs(height - squareGround(ground, x, z)) > allowed) {
        return "slope";
      }
    }
  }
  return "fine";
}
