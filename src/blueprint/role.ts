/**
 * What a building in a layout does, and the colour it is drawn in for it.
 *
 * The in-game blueprint widget colours its drawings by this rule
 * (`M.category` in `lua/blueprint-widget/luaui/coilbox_blueprints/model.lua`),
 * so a layout reads the same in the game as it does here. The rule and the
 * colours are the widget's, and `./role.test.ts` reads that file to keep the
 * two in step.
 *
 * It is not `classifyUnit` in `@/content/unitCategory`. That one sorts units for
 * analysis into eight kinds. This one is the widget's three, first match wins.
 */

import type { UnitDatasetEntry } from "@/content/bindings";

export type BuildingRole = "builder" | "weapon" | "energy" | "other";

/** The parts of a dataset unit the rule reads. */
export type RoleUnit = Pick<UnitDatasetEntry, "buildOptions" | "stats">;

/**
 * The widget's colours, as the red, green and blue fractions it writes them in.
 * A building that is none of the three keeps whatever colour the drawing
 * already gives a building, so `other` has no entry.
 */
export const ROLE_RGB: Record<Exclude<BuildingRole, "other">, number[]> = {
  builder: [0.4, 0.8, 0.4],
  weapon: [0.9, 0.33, 0.28],
  energy: [0.95, 0.8, 0.25],
};

function declared(stats: Record<string, unknown>, key: string): number {
  const value = stats[key];
  return typeof value === "number" ? value : 0;
}

/** The widget's `M.category`. */
export function buildingRole(unit: RoleUnit): BuildingRole {
  const stats = unit.stats ?? {};
  if (stats.builder === true || (unit.buildOptions?.length ?? 0) > 0) {
    return "builder";
  }
  if (Array.isArray(stats.weapons) && stats.weapons.length > 0) {
    return "weapon";
  }
  if (
    declared(stats, "energyMake") > 0 ||
    declared(stats, "windGenerator") > 0 ||
    declared(stats, "tidalGenerator") > 0 ||
    declared(stats, "energyUpkeep") < 0
  ) {
    return "energy";
  }
  return "other";
}

/** A role's colour as a 24 bit number, which is what three.js takes, or
 *  undefined for a building that keeps the drawing's own colour. */
export function roleColor(role: BuildingRole): number | undefined {
  if (role === "other") return undefined;
  const [r, g, b] = ROLE_RGB[role].map((part) => Math.round(part * 255));
  return (r << 16) | (g << 8) | b;
}

/** The same colour as CSS, for an SVG. */
export function roleCss(role: BuildingRole): string | undefined {
  const color = roleColor(role);
  return color === undefined
    ? undefined
    : `#${color.toString(16).padStart(6, "0")}`;
}

/**
 * A lookup from def name to role over one game's units, and nothing for a def
 * that game has not got. Case-insensitive, the way `./footprint.ts` looks a
 * footprint up, because a layout holds whatever its author typed.
 */
export function buildingRoles(
  units: (RoleUnit & { name: string })[],
): (def: string) => BuildingRole | undefined {
  const byName = new Map<string, BuildingRole>();
  for (const unit of units) {
    byName.set(unit.name.toLowerCase(), buildingRole(unit));
  }
  return (def) => byName.get(def.toLowerCase());
}

/** {@link buildingRoles} as colours, for three.js, with nothing for a def the
 *  game has not got or a building that keeps the drawing's own colour. */
export function buildingColors(
  units: (RoleUnit & { name: string })[],
): (def: string) => number | undefined {
  const roleOf = buildingRoles(units);
  return (def) => {
    const role = roleOf(def);
    return role ? roleColor(role) : undefined;
  };
}
