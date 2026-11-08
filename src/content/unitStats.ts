/**
 * Which of a unit's stats get shown, and which weapon fields, read from the
 * untyped `UnitDatasetEntry.stats` map. Shared by the unit page's table and the
 * build tree HTML export, so the two agree on what a unit's stats are.
 *
 * The keys and their order come from `shared/unitdef-stats.json`. A value is
 * kept only when its type matches what that key means, so a def that says
 * nothing about a stat gets no row.
 */

export const STAT_KEYS = [
  "health",
  "metalCost",
  "energyCost",
  "buildTime",
  "sightDistance",
  "maxVelocity",
  "range",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export interface WeaponStat {
  damage?: number;
  reload?: number;
  range?: number;
  projectile?: string;
}

export function isStatValue(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

/** The stat keys this unit has a usable value for, in display order. */
export function presentStatKeys(
  stats: Record<string, unknown> | undefined,
): StatKey[] {
  if (!stats) return [];
  return STAT_KEYS.filter((key) => isStatValue(stats[key]));
}

/** The unit's weapons, or an empty list when it has none. */
export function weaponsOf(
  stats: Record<string, unknown> | undefined,
): WeaponStat[] {
  const weapons = stats?.weapons;
  // The map is schemaless, so an entry that is not an object is dropped
  // rather than read.
  if (!Array.isArray(weapons)) return [];
  return weapons.filter(
    (w): w is WeaponStat => typeof w === "object" && w !== null,
  );
}
