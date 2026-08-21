/**
 * Generate a Recoil/Spring unit definition for a built unit.
 *
 * Small on purpose: the fields the engine needs to accept the unit and put it
 * on the map, not a full customisation surface. Its job is to unblock the
 * engine load test, not to replace hand-tuning a unit afterwards.
 *
 * Written as a static structure. The builder has no notion of movement
 * classes yet, and a unit with `canMove` set but no matching `movementClass`
 * is rejected outright at load: UnitDefHandler logs an error and drops it, so
 * the whole point of this file (something to spawn) is lost. Leaving
 * movement off is what keeps every export loadable. Nothing has to build the
 * unit either, because the scratch game makes it the side's start unit, so a
 * static unit is still one you meet in a match.
 *
 * `objectname` has to resolve. The engine's own `gamedata/unitdefs.lua` drops
 * any definition whose model is missing, before the unit ever reaches the
 * game, so an export that writes a definition without its `.s3o` produces a
 * unit that silently does not exist.
 */

import { effectiveCollisionVolume } from "./collisionVolume";
import type { LegoProject } from "./model";
import type { UnitBounds } from "./s3oBuild";

/**
 * World units (elmos) per footprint step. The blocking map's square is two of
 * the engine's SQUARE_SIZE (8 elmos), so a footprint of 1 covers 16 elmos.
 * See UnitDef.cpp (`xsize = footprintX * SPRING_FOOTPRINT_SCALE`) and
 * GlobalConstants.h (`SPRING_FOOTPRINT_SCALE = 2`, `SQUARE_SIZE = 8`).
 */
export const ELMOS_PER_FOOTPRINT = 16;

/** A conservative stand-in health value, easy to find and retune by hand. */
const DEFAULT_MAX_DAMAGE = 1000;

/** Escapes for characters that cannot appear raw in a quoted Lua string. */
const LUA_STRING_ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/**
 * Quote a value as a Lua string literal. Shared with the scratch game's
 * modinfo. Project names reach this from lego's clipboard import, which
 * accepts any string, so this has to hold for anything: a quote or backslash
 * would end the literal, and a raw newline is a syntax error in a short
 * string.
 *
 * Remaining control characters become three-digit `\ddd` escapes. The three
 * digits are not optional padding: `\0` followed by the digit `5` would
 * otherwise read back as byte 5.
 *
 * Anything above ASCII is left alone, since Lua strings are byte strings and
 * the file is written as UTF-8, so the bytes survive the round trip.
 *
 * Kept in step by hand with the scenario compiler's own `luaString` in
 * `src/scenario/compile.ts`, which lego does not import to avoid pulling the
 * scenario editor's dependency graph into the unit builder.
 */
export function luaString(value: string): string {
  const body = value.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: escaping them is the point
    /[\\"\n\r\t\x00-\x1f\x7f]/g,
    (ch) =>
      LUA_STRING_ESCAPES[ch] ??
      `\\${ch.charCodeAt(0).toString().padStart(3, "0")}`,
  );
  return `"${body}"`;
}

/**
 * `bounds` is the model's world-space bounding box, in elmos, as `buildS3o`'s
 * header measures it. Both the footprint and the collision volume come off it.
 *
 * Each footprint axis gets its own step rather than one step shared from a
 * collision radius, so a unit longer than it is wide claims a rectangle of
 * ground rather than the square that would fit its longest axis.
 *
 * This measures the whole bounding box, including anything that sticks out
 * such as a gun barrel or an aerial. A real game would usually trim those
 * from a building's footprint, but the builder has no notion yet of which
 * pieces are structural rather than attached, so there is nothing narrower to
 * measure from.
 *
 * Each axis rounds up to the next whole step rather than to the nearest one.
 * A footprint is the ground the engine uses for placement and pathing, and
 * rounding to nearest can round down, which would leave a unit's own
 * footprint too small to contain it. Rounding up always wastes a little
 * space instead, which is the safer failure. A unit smaller than one step
 * still gets at least 1, matching the engine's own minimum.
 *
 * The three `collisionvolume` keys are the flat form the engine reads in
 * `SolidObjectDef::ParseCollisionVolume`, not the `collisionVolume = { }`
 * subtable beside it: that one reads `type` as a number, so a shape named
 * there as a string quietly becomes a sphere. What goes in them is
 * `collisionVolume.ts`.
 *
 * They are written whether or not the unit is hit piece by piece, because the
 * volume still has three jobs when it is not hitting anything.
 * `ParseSelectionVolume` falls back to these keys, so this is still the shape
 * you click; `QuadField::GetUnitsAndFeaturesExact` measures its bounding
 * radius, so this is still what an explosion catches; and it is still the
 * shape of any unit whose owner turns piece collision back off.
 */
export function buildUnitDef(project: LegoProject, bounds: UnitBounds): string {
  const footprintx = footprintSteps(bounds.sizeX);
  const footprintz = footprintSteps(bounds.sizeZ);
  const volume = effectiveCollisionVolume(project, bounds);

  const fields: [string, string][] = [
    ["name", luaString(project.name)],
    [
      "description",
      luaString(`${project.name}, built with coilbox's unit builder.`),
    ],
    ["objectname", luaString(project.unitName)],
    ["script", luaString(`${project.unitName}.lua`)],
    ["footprintx", String(footprintx)],
    ["footprintz", String(footprintz)],
    ["collisionvolumetype", luaString(volume.type)],
    ["collisionvolumescales", luaString(luaFloat3(volume.scales))],
    ["collisionvolumeoffsets", luaString(luaFloat3(volume.offsets))],
    // Only written when it is on. The engine's default is false, and a unit
    // that has never asked for piece collision should not carry a line saying
    // it does not want it.
    ...(project.pieceCollision
      ? ([["usepiececollisionvolumes", "true"]] as [string, string][])
      : []),
    ["maxdamage", String(DEFAULT_MAX_DAMAGE)],
    ["canmove", "false"],
  ];

  const lines = [
    `-- ${project.unitName}, generated by coilbox's unit builder.`,
    "-- Safe to edit: nothing regenerates this file unless you export again.",
    "",
    "return {",
    `  ["${project.unitName}"] = {`,
    ...fields.map(([key, value]) => `    ${key} = ${value},`),
    "  },",
    "}",
  ];

  return `${lines.join("\n")}\n`;
}

/**
 * One axis's extent, in elmos, to a whole number of footprint steps. Rounds
 * up so the step always contains the axis it was measured from. A tiny or
 * empty extent still steps up to 1, the engine's own minimum footprint.
 * The `1e-9` slack absorbs float error from the box measurement so a size
 * that lands exactly on a step boundary is not pushed into the next one.
 */
function footprintSteps(size: number): number {
  return Math.max(1, Math.ceil(size / ELMOS_PER_FOOTPRINT - 1e-9));
}

/**
 * Three numbers the way the engine's `GetFloat3` reads them: "x y z". It takes
 * either this or a table of three, and this is the form shipped games write.
 *
 * Rounded to a thousandth of an elmo, which is far below anything a collision
 * volume can express, so the file stays readable.
 */
function luaFloat3(values: [number, number, number]): string {
  return values.map((value) => Number(value.toFixed(3))).join(" ");
}
