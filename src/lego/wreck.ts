/**
 * The wreck a built unit leaves when it dies (issue #3310).
 *
 * A wreck is a feature, not the unit. The engine makes one from the unit
 * definition's `corpse` when the unit dies (`CUnit::PreInit` looks it up,
 * `CFeatureHandler::CreateWreckage` makes it), and makes nothing when no
 * feature of that name exists or it names no model. So the export writes three
 * things: `corpse` on the definition (`unitDef.ts`), a model, and a feature
 * definition naming that model.
 *
 * The feature goes in its own file under `features/`. The engine's
 * `gamedata/featuredefs.lua` loads every Lua file there, folders included, and
 * neither Splinter Faction nor Balanced Annihilation replaces it. Balanced
 * Annihilation's wrecks are inline `featuredefs` tables in the unit's file
 * instead, which only its own `featuredefs_post.lua` collects: Splinter
 * Faction's does not, so an inline table would load in one game and not the
 * other.
 *
 * The model is always the wreck's own, `objects3d/coilbox/<unit>_dead.s3o`:
 * the unit posed by the "Wreck pose" preset when that is applied, and the unit
 * at rest when it is not. A feature has no script, so the only way a pose
 * reaches a wreck is in its model's vertices. Writing the model either way
 * keeps one set of files, so turning the preset off or on never leaves a model
 * behind or changes what the feature file says. The `coilbox` folder keeps it
 * clear of a unit whose own name ends in `_dead`.
 */

import { type TrackDelta, WRECK_POSE } from "./animPresets";
import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import type { RawGeometry } from "./rawGeometry";
import { buildS3o, type S3oBuild } from "./s3oBuild";
import type { SheetUv } from "./textureSheet";
import { luaValue, wreckName } from "./unitDef";

/**
 * The share of the unit's metal cost and health its wreck keeps. Splinter
 * Faction's `featuredefs_post.lua` gives the wrecks it makes half of each,
 * rounded down. Balanced Annihilation 15.9.8 writes its own: across the 293
 * of its units with both a cost and a wreck, the median wreck holds 0.609 of
 * the metal and 0.6 of the health. Splinter Faction is the default game, so
 * its number wins.
 */
export const WRECK_SHARE = 0.5;

/** Where the wreck's model is written, under the game folder. */
export function wreckModelPath(unitName: string): string {
  return `objects3d/${wreckObject(unitName)}`;
}

/** Where the wreck's feature definition is written, under the game folder. */
export function wreckFeaturePath(unitName: string): string {
  return `features/coilbox/${wreckName(unitName)}.lua`;
}

/**
 * The model as the feature names it, under `objects3d/`. With the extension:
 * Splinter Faction's `featuredefs_post.lua` removes a feature whose
 * `objects3d/<object>` is not a file, trying only `.3do` beside it.
 */
function wreckObject(unitName: string): string {
  return `coilbox/${wreckName(unitName)}.s3o`;
}

/**
 * The wreck pose as a script pose, by piece id: the preset's own `track`, on the
 * same body piece its `Killed` lines move. Empty without the preset.
 *
 * Read off `track` rather than written out again, so the wreck is the pose the
 * preview shows at the end of the "Hit and destroyed" run, which
 * `presetParity.test.ts` holds to the same `track`.
 */
export function wreckPose(project: LegoProject): Map<string, TrackDelta> {
  const pose = new Map<string, TrackDelta>();
  const applied = project.animations?.find(
    (entry) => entry.presetId === WRECK_POSE.id,
  );
  const body = project.pieces.find((piece) => piece.role === "base");
  if (!applied || !body) return pose;
  const delta = WRECK_POSE.track(0, applied.params, "base");
  if (delta) pose.set(body.id, delta);
  return pose;
}

/** A number off the unit's definition, or 0. */
function defNumber(def: Record<string, unknown>, key: string): number {
  const value = def[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The feature definition, from the unit's own definition so the two agree.
 *
 * Keys are spelled the way Splinter Faction's `featuredefs_post.lua` reads
 * them, `footprintX` rather than `footprintx`, because that file runs before
 * the engine folds the case and resets a footprint it cannot find to 1.
 * `damage` is the spelling both games write, which the engine reads as health.
 * `energy` is written as 0 because Splinter Faction sets a missing one to 1.
 * A wreck blocks the ground where a building stood and not where a unit drove,
 * which is what most of Balanced Annihilation's do.
 */
export function wreckFeatureDef(
  project: LegoProject,
  def: Record<string, unknown>,
): Record<string, unknown> {
  return {
    description: `${project.name} wreckage`,
    object: wreckObject(project.unitName),
    category: "corpses",
    blocking: def.canmove !== true,
    reclaimable: true,
    metal: Math.floor(defNumber(def, "buildcostmetal") * WRECK_SHARE),
    energy: 0,
    damage: Math.floor(defNumber(def, "maxdamage") * WRECK_SHARE),
    footprintX: defNumber(def, "footprintx"),
    footprintZ: defNumber(def, "footprintz"),
  };
}

/** The feature file's text, as `features/coilbox/<unit>_dead.lua`. */
export function buildWreckFeature(
  project: LegoProject,
  def: Record<string, unknown>,
): string {
  const lines = [
    `-- ${project.unitName}'s wreck, generated by coilbox's unit builder.`,
    "-- Safe to edit: an export never replaces this file once you have.",
    "",
    "return {",
    `  ["${wreckName(project.unitName)}"] = {`,
    ...Object.entries(wreckFeatureDef(project, def)).map(
      ([key, value]) => `    ${key} = ${luaValue(value)},`,
    ),
    "  },",
    "}",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The wreck's model and feature file, or null for a unit with no root piece.
 * `textures` are the unit's own, so the wreck is painted like the unit.
 */
export function buildWreck(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
  textures: { texture1: string; texture2?: string },
  def: Record<string, unknown>,
  /** The unit's combined sheet, for a unit that has one (#3260). */
  sheet?: SheetUv,
): { model: S3oBuild; feature: string } | null {
  const model = buildS3o(project, pack, raw, textures, {
    pose: wreckPose(project),
    sheet,
  });
  if (!model) return null;
  return { model, feature: buildWreckFeature(project, def) };
}
