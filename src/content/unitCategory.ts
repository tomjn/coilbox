/**
 * What a unit is for, worked out from the numbers its unitdef declares (#3848).
 *
 * One pure function so the replay opening, the map layers (#1152) and the
 * library analytics (#1167) agree on what an economy unit is. It reads only the
 * unit dataset's fields and names no unit and no game.
 *
 * Where the dataset cannot say, the answer is `unclassified`. Many games leave
 * the engine's economy keys at zero and make their income in a Lua gadget or
 * under `customParams`, and a generic reader cannot see that. Such a unit is
 * reported as unclassified, not guessed at.
 */

import type { UnitDatasetEntry } from "./bindings";

export const UNIT_CATEGORIES = [
  "economy",
  "defence",
  "offence",
  "factory",
  "builder",
  "intelligence",
  "transport",
  "unclassified",
] as const;

export type UnitCategory = (typeof UNIT_CATEGORIES)[number];

/** The parts of a dataset unit the classifier reads. */
export type ClassifiableUnit = Pick<
  UnitDatasetEntry,
  "mobile" | "buildOptions" | "stats"
>;

/** A declared number above zero. Absent, zero and negative all read as no. */
function positive(stats: Record<string, unknown>, key: string): boolean {
  const value = stats[key];
  return typeof value === "number" && value > 0;
}

/** A declared number below zero. */
function negative(stats: Record<string, unknown>, key: string): boolean {
  const value = stats[key];
  return typeof value === "number" && value < 0;
}

/**
 * Put a unit in one category. A unit can be several things, so the rules run
 * top to bottom and the first that matches wins.
 */
export function classifyUnit(unit: ClassifiableUnit): UnitCategory {
  const stats = unit.stats ?? {};
  const hasBuildOptions = (unit.buildOptions?.length ?? 0) > 0;
  const armed = Array.isArray(stats.weapons) && stats.weapons.length > 0;

  // Builder or factory. First, so a commander that also fights, makes metal and
  // stores it counts as the thing it is ordered for. The engine only lets a
  // unit build when its def says `builder`, so a build menu alone is not enough.
  // An armed unit with no build menu (a spy that can also reclaim) falls
  // through and is judged by its weapon. A static unit with a build menu is a
  // factory and everything else that builds is a builder, nano turrets included.
  if (stats.builder === true && (hasBuildOptions || !armed)) {
    return hasBuildOptions && !unit.mobile ? "factory" : "builder";
  }

  // Transport. Before weapons, because a gunship that carries is a transport
  // first. A unit that can hold nothing is not one.
  if (positive(stats, "transportCapacity")) return "transport";

  // Armed. A moving unit with a weapon is offence and a fixed one is defence.
  // Before economy, so a geothermal powered gun tower is a gun tower.
  if (armed) return unit.mobile ? "offence" : "defence";

  // Economy: anything the engine pays out for or stores. A negative upkeep is
  // income in the engine, which is how many games make conditional income.
  if (
    positive(stats, "metalMake") ||
    positive(stats, "energyMake") ||
    positive(stats, "makesMetal") ||
    positive(stats, "extractsMetal") ||
    positive(stats, "windGenerator") ||
    positive(stats, "tidalGenerator") ||
    negative(stats, "metalUpkeep") ||
    negative(stats, "energyUpkeep") ||
    positive(stats, "metalStorage") ||
    positive(stats, "energyStorage")
  ) {
    return "economy";
  }

  // Intelligence: a radar, sonar, jammer or seismic detector. After weapons and
  // economy because plenty of fighting units carry a small sensor of their own.
  if (
    positive(stats, "radarDistance") ||
    positive(stats, "sonarDistance") ||
    positive(stats, "radarDistanceJam") ||
    positive(stats, "sonarDistanceJam") ||
    positive(stats, "seismicDistance")
  ) {
    return "intelligence";
  }

  return "unclassified";
}
