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
 * ## Water, which is the other half of the same function (issue #1459)
 *
 * `CheckTerrainConstraints` also demands that each square's ground lie in
 * `[-maxWaterDepth, -minWaterDepth]`, from the def's own two fields. That is
 * what keeps a naval yard in the sea and a land building out of it, and the
 * engine's defaults of -10e6 and +10e6 are a band no ground falls outside, so a
 * def that declares neither is refused nowhere.
 *
 * Which end of that band was crossed is part of the answer (issue #1552). Too
 * much water over a building and too little are opposite problems, fixed by
 * moving it opposite ways, so they are two verdicts rather than one.
 *
 * A floater is exempt from the slope test wherever the ground is at or below
 * the water, because it never touches the seabed. It is not exempt from the
 * depth test, and where it does overhang dry land it is measured against
 * `-waterline`, which is what `GetBuildHeight` levels it to.
 *
 * ## What is left out, and why none of it marks a building wrongly
 *
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
  /**
   * Whether height 0 on this ground is the water's surface (issue #1459).
   *
   * True of a map, where the engine's whole depth test is written against zero.
   * False of the mapless editor's build grid, which is a level floor with no sea
   * anywhere near it: it sits at 0, so a depth test would read it as the
   * waterline and mark every naval building in a layout that is only a shape.
   */
  hasWater: boolean;
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

/** Everything one def gives `CheckTerrainConstraints` to work with. */
export interface TerrainLimits {
  /** `maxHeightDif`: elmos of height difference tolerated across the footprint,
   *  from {@link slopeTolerance}. */
  tolerance: number;
  /** The building rests on the water rather than on the seabed. */
  floats: boolean;
  /** How far below the water a floater sits. `GetBuildHeight` levels it to
   *  `-waterline` rather than to the ground under it. */
  waterline: number;
  /** The band the ground under every square must fall in, as the def declares
   *  it: `[-maxWaterDepth, -minWaterDepth]`. */
  minWaterDepth: number;
  maxWaterDepth: number;
}

/**
 * What one def allows, or which reason there is nothing to judge it by.
 *
 * The reasons are the `Standing` values that are not verdicts, so a caller
 * hands one straight back rather than translating it. That is deliberate: the
 * moment there is a translation step, four reasons can be flattened into one
 * silence again, which is the bug (issue #1491).
 */
export type TerrainAnswer =
  | TerrainLimits
  | "no-units"
  | "no-def"
  | "no-slope"
  | "floats";
export type LimitsOf = (def: string) => TerrainAnswer;

/** The engine's own `minWaterDepth` and `maxWaterDepth` defaults, from
 *  `UnitDef.cpp`. A band this wide refuses no ground on any map, so a def that
 *  declares neither is silent on depth rather than judged by a guess. */
const DEFAULT_MIN_WATER_DEPTH = -10e6;
const DEFAULT_MAX_WATER_DEPTH = 10e6;

/**
 * What the terrain check reads off each unit of one game.
 *
 * Three different defs have nothing to judge by, and which of the three it is
 * matters to whoever has to say so on screen. One the game has not got is
 * somebody's layout from another game. One whose entry predates the slope field
 * is a gap in this game's own data. A floater with no `waterline` is a third:
 * the engine levels it to that number rather than to the ground, so without it
 * there is nothing to measure the building against, and checking it against the
 * seabed instead would mark buildings that build perfectly well.
 *
 * A def declaring zero slope is not one of those. Zero is the engine's default
 * and it is a real answer: that building wants flat ground. Neither is a def
 * that declares no water depths, which gets the engine's own band and so is
 * refused nowhere.
 */
export function unitLimits(
  units: {
    name: string;
    maxSlope?: number;
    floatOnWater?: boolean;
    minWaterDepth?: number;
    maxWaterDepth?: number;
    waterline?: number;
  }[],
  /**
   * Whether `units` is this game's dataset read rather than an empty list
   * standing in for one that has not been read yet.
   *
   * Without it an editor opening on a game still being read would accuse every
   * building in it of being a unit the game has not got, and clear itself two
   * seconds later. The same flag `ImportReport.checked` carries, for the same
   * reason.
   */
  checked = units.length > 0,
): LimitsOf {
  const byName = new Map<string, TerrainAnswer>();
  for (const unit of units) {
    const name = unit.name.toLowerCase();
    const floats = unit.floatOnWater === true;
    if (unit.maxSlope === undefined || !Number.isFinite(unit.maxSlope)) {
      byName.set(name, "no-slope");
    } else if (
      floats &&
      (unit.waterline === undefined || !Number.isFinite(unit.waterline))
    ) {
      byName.set(name, "floats");
    } else {
      byName.set(name, {
        tolerance: slopeTolerance(unit.maxSlope),
        floats,
        waterline: unit.waterline ?? 0,
        minWaterDepth: finite(unit.minWaterDepth, DEFAULT_MIN_WATER_DEPTH),
        maxWaterDepth: finite(unit.maxWaterDepth, DEFAULT_MAX_WATER_DEPTH),
      });
    }
  }
  return (def) =>
    checked ? (byName.get(def.toLowerCase()) ?? "no-def") : "no-units";
}

/** One number the dataset may not carry, with the engine's own default in its
 *  place. */
function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
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
 *
 * A floater whose average comes out below the water is not levelled to the
 * ground at all: it takes `-waterline`, because that is where it will sit.
 */
function buildHeight(
  ground: Ground,
  pos: { x: number; z: number },
  limits: TerrainLimits,
): number {
  const { tolerance } = limits;
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
  if (ground.hasWater && average < 0 && limits.floats) {
    return -limits.waterline;
  }
  return average;
}

/**
 * Whether the engine will stand this building on this ground.
 *
 * The mark's position is already where the engine will put the building, so the
 * squares it covers are read straight off it. `limits` is what the def allows,
 * from {@link unitLimits}, and anything other than a set of numbers there is
 * the reason this building cannot be judged rather than an approval of it.
 *
 * A `null` ground is the same kind of answer about the map instead of about the
 * def: no map, or a heightmap that would not read. The def's reason is given
 * first, because a unit the game has not got is that whether or not there is a
 * map, and it is the one an author can act on.
 *
 * The first square the engine would refuse decides the answer, which is what
 * the engine itself does: `TestUnitBuildSquare` walks the footprint in this
 * order and returns as soon as one square is blocked. Depth is asked first
 * within a square, because it is the one test that does not depend on where the
 * building would be levelled to.
 */
export function standsOn(
  mark: Pick<FootprintMark, "pos" | "facing" | "footprint">,
  ground: Ground | null,
  limits: TerrainAnswer,
): Standing {
  if (typeof limits === "string") return limits;
  if (!ground) return "no-ground";
  const { slack } = ground;
  const allowed = limits.tolerance + slack;
  const faced = facedFootprint(mark.footprint, mark.facing);
  // A footprint is in build squares and the heightmap is finer, so each side
  // covers `BUILD_SQUARE / SQUARE_SIZE` heightmap squares. This is the engine's
  // `BuildInfo::GetXSize`.
  const xsize = (faced.x * BUILD_SQUARE) / SQUARE_SIZE;
  const zsize = (faced.z * BUILD_SQUARE) / SQUARE_SIZE;
  const x1 = Math.floor(mark.pos.x / SQUARE_SIZE) - (xsize >> 1);
  const z1 = Math.floor(mark.pos.z / SQUARE_SIZE) - (zsize >> 1);

  const height = buildHeight(ground, mark.pos, limits);
  for (let x = x1; x < x1 + xsize; x++) {
    for (let z = z1; z < z1 + zsize; z++) {
      const square = squareGround(ground, x, z);
      if (ground.hasWater) {
        // `[-maxWaterDepth, -minWaterDepth]`, widened by what the reading can
        // hide so ground that might be inside the band is treated as inside it.
        // Which end was crossed is the answer, because the two want the
        // building moved opposite ways (issue #1552).
        if (square < -limits.maxWaterDepth - slack) return "too-deep";
        if (square > -limits.minWaterDepth + slack) return "too-shallow";
        // A floater rests on the water, so the seabed under it decides nothing.
        if (limits.floats && square - slack <= 0) continue;
      }
      if (Math.abs(height - square) > allowed) return "slope";
    }
  }
  return "fine";
}
