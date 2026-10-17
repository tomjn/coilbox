/**
 * Generate a Recoil/Spring unit definition for a built unit.
 *
 * Small on purpose: the fields the engine needs to accept the unit and put it
 * on the map, not a full customisation surface. Its job is to unblock the
 * engine load test, not to replace hand-tuning a unit afterwards.
 *
 * Written as a static structure unless the game maker has picked a movement
 * class. A movement class names an entry in the game's own move definitions,
 * and a unit with `canMove` set but no matching `movementClass` is rejected
 * outright at load, so the class is only ever one the game declared, picked in
 * the builder from the game's own list (`movement.ts`, issue #3255). Nothing
 * has to build the unit either, because the scratch game makes it the side's
 * start unit, so a static unit is still one you meet in a match.
 *
 * What this file writes with no class picked is the starting point that always
 * loads, and
 * {@link legoUnitDef} is the same table the workshop takes as a clone, so the
 * file in `units/` and the unit on the workshop's page are one definition
 * rather than two that have to be kept in step.
 *
 * `objectname` has to resolve. The engine's own `gamedata/unitdefs.lua` drops
 * any definition whose model is missing, before the unit ever reaches the
 * game, so an export that writes a definition without its `.s3o` produces a
 * unit that silently does not exist.
 *
 * The unit's name and description are the one part of this that depends on the
 * game rather than on the project. Most games read them here. Beyond All Reason
 * reads them out of a localisation file and never looks at the definition. So
 * both take a `TextHome`, the same answer `unitText.ts` gives the workshop, and
 * a game that reads them somewhere else gets a definition that does not carry
 * them (issue #2683).
 */

import type { TextHome } from "@/workshop/unitText";
import { effectiveCollisionVolume } from "./collisionVolume";
import { DEFAULT_BUILDER, type LegoProject } from "./model";
import { movesInGame } from "./movement";
import type { UnitBounds } from "./s3oBuild";
import type { WorthTotals } from "./worth";

/**
 * Whether this unit builds, which is decided by the model rather than a flag.
 *
 * A piece in any `buildarm.*` role means somebody modelled an arm, a nozzle or
 * a set of nano points, and none of those are decoration. The alternative was a
 * switch somewhere saying "this is a builder", which would be a second thing to
 * remember that says what the piece roles already say.
 */
export function isBuilder(project: LegoProject): boolean {
  return project.pieces.some((piece) => piece.role?.startsWith("buildarm."));
}

/** The builder keys, or nothing for a unit with no build arm on it. */
function builderFields(project: LegoProject): Record<string, unknown> {
  if (!isBuilder(project)) return {};
  const { workerTime, buildDistance, canAssist } = {
    ...DEFAULT_BUILDER,
    ...project.builder,
  };
  return {
    builder: true,
    workertime: workerTime,
    builddistance: buildDistance,
    canassist: canAssist,
  };
}

/**
 * World units (elmos) per footprint step. The blocking map's square is two of
 * the engine's SQUARE_SIZE (8 elmos), so a footprint of 1 covers 16 elmos.
 * See UnitDef.cpp (`xsize = footprintX * SPRING_FOOTPRINT_SCALE`) and
 * GlobalConstants.h (`SPRING_FOOTPRINT_SCALE = 2`, `SQUARE_SIZE = 8`).
 */
export const ELMOS_PER_FOOTPRINT = 16;

/**
 * A conservative stand-in health value for a unit with no parts to total, such
 * as one imported whole from a model. A unit built from parts takes its health
 * from the worth table (issue #3280).
 */
const DEFAULT_MAX_DAMAGE = 1000;

/**
 * The steepest ground, in degrees, the unit may be built on. The engine reads
 * `maxSlope` for a unit that cannot move and defaults it to 0
 * (`UnitDef.cpp:423`), which allows no height difference across the footprint,
 * so a builder is refused almost everywhere (issue #4142). 20 is a value the
 * buildings of Balanced Annihilation (mex, geo), Metal Factions and Complete
 * Annihilation use, inside the 10 to 60 that Splinter Faction's buildings span.
 */
const DEFAULT_MAX_SLOPE = 20;

/**
 * A stand-in build time and cost for a unit with no parts to total (issue
 * #3280). The time is the engine's own
 * default (`UnitDef.cpp:345`). The metal is the same number because Splinter
 * Faction derives a build time of metal plus energy over ten, and with no
 * energy that lands on the engine default.
 */
const DEFAULT_BUILD_TIME = 100;
const DEFAULT_BUILD_COST_METAL = DEFAULT_BUILD_TIME;

/**
 * The keys that say whether and how the unit moves.
 *
 * A unit that moves leaves `maxslope` out. For a unit that can move, the engine
 * checks the slope under it against its move class's own `maxSlope`
 * (`MoveDefHandler.cpp:233`), not the unit's: `CGameHelper::CheckTerrainConstraints`
 * reads `unitDef->maxHeightDif` only when `IsImmobileUnit()`
 * (`GameHelper.cpp:1633`), and `GetBuildHeight` skips it for a mobile unit
 * (`GameHelper.cpp:1196`). So the building's 20 would be a number with no effect.
 *
 * `turnrate` is written only when there is one, since the engine's default of 0
 * is a unit that cannot turn and is better left visibly unset than written.
 * `rSpeed` is likewise written only when above 0, since 0 is the engine's
 * default and a unit with it never reverses.
 * `acceleration` and `brakeRate` are the spellings Splinter Faction and Balanced
 * Annihilation write, and likewise only when set, so the engine's own defaults
 * (0.5, and a brake rate equal to the acceleration) apply otherwise.
 */
function movementFields(project: LegoProject): Record<string, unknown> {
  const movement = project.movement;
  if (!movesInGame(movement)) {
    return { canmove: false, maxslope: DEFAULT_MAX_SLOPE };
  }
  return {
    canmove: true,
    movementclass: movement.moveClass,
    speed: movement.speed,
    ...(typeof movement.turnRate === "number"
      ? { turnrate: movement.turnRate }
      : {}),
    ...(typeof movement.reverseSpeed === "number" && movement.reverseSpeed > 0
      ? { rSpeed: movement.reverseSpeed }
      : {}),
    ...(typeof movement.acceleration === "number"
      ? { acceleration: movement.acceleration }
      : {}),
    ...(typeof movement.brakeRate === "number"
      ? { brakeRate: movement.brakeRate }
      : {}),
  };
}

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
 * `bounds` is the model's world-space bounding box, in elmos, as `unitBounds`
 * measures it. Both the footprint and the collision volume come off it. It has
 * to be the measured box rather than an `S3oBuild`, whose `mid` is the header's
 * and so is the aim point: the volume's offsets are the distance between the
 * two, and a build has already collapsed them into one number.
 *
 * `totals` is what `worthTotals` gives the unit, or null for a unit with no
 * parts to total, which keeps the stand-in health and cost.
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
 * `ParseSelectionVolume` reads no `selectionvolume` key of its own and falls
 * back to these, so this is still the shape you click unless the unit also
 * asks for piece selection; `QuadField::GetUnitsAndFeaturesExact` measures its
 * bounding radius, so this is still what an explosion catches, whichever piece
 * switch is on; and it is still the shape of any unit whose owner turns either
 * switch back off.
 *
 * `weapons` is the `weapons` table, one entry per slot in order, as
 * `weaponExportPlan` in `weaponModule.ts` works it out. It needs the workshop's
 * projects, which is why it is passed in rather than read off the project.
 */
export function legoUnitDef(
  project: LegoProject,
  bounds: UnitBounds,
  home: TextHome,
  totals: WorthTotals | null,
  weapons: Record<string, unknown>[] = [],
): Record<string, unknown> {
  const volume = effectiveCollisionVolume(project, bounds);

  return {
    // Only for a game that reads them. Beyond All Reason builds every unit's
    // label from `Spring.I18N('units.names.' .. unitDefName)` and falls back to
    // the key rather than to the definition, so these two are not a weaker
    // answer there, they are keys nothing opens, and a unit carrying them would
    // also tell `textHome` that the game names its units in their definitions
    // once the game's own read comes back with the exported file. For that game
    // the words go to `language/en/coilbox.json` instead (issue #2683).
    ...(home === "def" ? unitWords(project) : {}),
    // Three fields Splinter Faction's `alldefs_post.lua` reads on every unit
    // and the engine quits without (issue #4137). `unitname` is the key the
    // definition is filed under. `sightdistance` is the engine's own default
    // (`UnitDef.cpp`: `udTable.GetFloat("sightDistance", 0.0f)`). `customparams`
    // is read as a table, so it has to exist.
    unitname: project.unitName,
    sightdistance: 0,
    // `unitdefbuildtime` is Splinter Faction's opt-out from its cost block,
    // which otherwise prices any unit with no `factionname` at 518181518
    // metal and energy so that a builder never finishes it (issue #4143). The
    // game reads only whether it is set. Other games ignore the table.
    //
    // `corpse` is empty so the wreck is only the engine's, from `corpse`
    // below (issue #4283). Splinter Faction's `unit_deathContainerSpawn.lua`
    // drops `customparams.corpse` itself when a ship dies or heat kills a
    // unit, and `alldefs_post.lua` defaults it to the name of our wreck, so a
    // heat kill would leave two. With an empty name its `CreateFeature` finds
    // no feature and it spawns nothing.
    customparams: {
      unitdefbuildtime: totals?.buildTime ?? DEFAULT_BUILD_TIME,
      corpse: "",
    },
    buildtime: totals?.buildTime ?? DEFAULT_BUILD_TIME,
    buildcostmetal: totals?.metal ?? DEFAULT_BUILD_COST_METAL,
    buildcostenergy: totals?.energy ?? 0,
    // Left out at zero, where the engine's own default is the metal cost.
    ...(totals && totals.mass > 0 ? { mass: totals.mass } : {}),
    objectname: project.unitName,
    script: `${project.unitName}.lua`,
    footprintx: footprintSteps(bounds.sizeX),
    footprintz: footprintSteps(bounds.sizeZ),
    collisionvolumetype: volume.type,
    collisionvolumescales: luaFloat3(volume.scales),
    collisionvolumeoffsets: luaFloat3(volume.offsets),
    // Only written when it is on. The engine's default is false, and a unit
    // that has never asked for piece collision should not carry a line saying
    // it does not want it.
    ...(project.pieceCollision ? { usepiececollisionvolumes: true } : {}),
    // The engine's second switch over the same boxes, read by
    // `ParseSelectionVolume`. Written on its own, because neither implies the
    // other in the engine and neither should here.
    ...(project.pieceSelection ? { usepieceselectionvolumes: true } : {}),
    maxdamage: totals?.health ?? DEFAULT_MAX_DAMAGE,
    ...movementFields(project),
    // Written together or not at all. `UnitDef::IsBuilderUnit` is `builder &&
    // buildSpeed > 0 && buildDistance > 0`, and `builder` is `&=`'d against
    // that a line later, so `builder = true` on its own clears itself against
    // the engine's `workerTime` default of zero and the unit quietly is not a
    // builder. The generated script's build stance line is the other half:
    // without it a builder with these keys still never starts. See
    // `luaScript.ts`.
    ...builderFields(project),
    ...(weapons.length > 0 ? { weapons } : {}),
    // The wreck the export writes beside the unit, `wreck.ts` (issue #3310).
    // The engine makes it when the unit dies, looking it up by this name
    // (`UnitDef.cpp`, `CUnit::PreInit`). Balanced Annihilation's
    // `featuredefs_post.lua` would prefix a short name with the unit's, and
    // leaves this one alone because no feature has the longer name.
    corpse: wreckName(project.unitName),
  };
}

/**
 * The name of a unit's wreck. Splinter Faction's own spelling: its
 * `alldefs_post.lua` defaults `customparams.corpse` to it, which is the wreck
 * its death gadget drops, and Balanced Annihilation's wrecks end up called the
 * same once its `featuredefs_post.lua` has prefixed them.
 */
export function wreckName(unitName: string): string {
  return `${unitName}_dead`;
}

/**
 * The fields of {@link legoUnitDef} the build decides, as dotted paths into the
 * unit's table (issue #3245, list settled in #3313).
 *
 * A re-export rewrites each of these in the game's `units/<unit>.lua` while the
 * file still holds the value the last export wrote, adds one the file lacks and
 * the last export did not write, and removes one the build no longer writes. A
 * field holding anything else was changed by hand and stays. Every field not
 * listed is written on the first export only.
 *
 * Kept as one list because the workshop's unit page reads it too, to mark the
 * fields the builder keeps up to date (#4242). A field `legoUnitDef` gains has
 * to be added here or named in the test that guards this list. `weapons` is
 * one entry, the whole list of slots, so a slot added, dropped or re-aimed
 * replaces the list while nobody has edited it.
 */
export const DERIVED_FIELDS: readonly string[] = [
  "name",
  "description",
  "unitname",
  "customparams.unitdefbuildtime",
  "customparams.corpse",
  "buildtime",
  "buildcostmetal",
  "buildcostenergy",
  "mass",
  "objectname",
  "script",
  "footprintx",
  "footprintz",
  "collisionvolumetype",
  "collisionvolumescales",
  "collisionvolumeoffsets",
  "usepiececollisionvolumes",
  "usepieceselectionvolumes",
  "maxdamage",
  "canmove",
  "maxslope",
  "movementclass",
  "speed",
  "turnrate",
  "rSpeed",
  "acceleration",
  "brakeRate",
  "builder",
  "workertime",
  "builddistance",
  "canassist",
  "weapons",
  "corpse",
];

/** The value at a dotted `path` in a definition, or undefined. */
export function defValue(def: Record<string, unknown>, path: string): unknown {
  let at: unknown = def;
  for (const key of path.split(".")) {
    if (typeof at !== "object" || at === null || !Object.hasOwn(at, key))
      return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

/**
 * The two things on a unit that are words rather than numbers, written once so
 * the definition and the language file say the same thing.
 *
 * The description is generated rather than asked for. A built unit has no
 * tooltip of its own yet, and a line saying where it came from beats the unit's
 * own key, which is what a game shows when nothing answers.
 */
export function unitWords(project: LegoProject): {
  name: string;
  description: string;
} {
  return {
    name: project.name,
    description: `${project.name}, built with coilbox's unit builder.`,
  };
}

/** A table key as Lua source: bare when it is an identifier, quoted when not. */
function luaKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${luaString(key)}]`;
}

/**
 * One field's value as Lua source. The three scalar types, and a table whose
 * entries are written the same way, so `{}` for a field the game reads as a
 * table but nothing fills in.
 */
export function luaValue(value: unknown): string {
  // A list is written by position, which is how the engine reads `weapons`.
  if (Array.isArray(value)) {
    return value.length === 0 ? "{}" : `{ ${value.map(luaValue).join(", ")} }`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).map(
      ([key, entry]) => `${luaKey(key)} = ${luaValue(entry)}`,
    );
    return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return luaString(String(value));
}

export function buildUnitDef(
  project: LegoProject,
  bounds: UnitBounds,
  home: TextHome,
  totals: WorthTotals | null,
  weapons: Record<string, unknown>[] = [],
): string {
  const lines = [
    `-- ${project.unitName}, generated by coilbox's unit builder.`,
    "-- Safe to edit: an export never changes a field you have edited.",
    "",
    "return {",
    `  ["${project.unitName}"] = {`,
    ...Object.entries(legoUnitDef(project, bounds, home, totals, weapons)).map(
      ([key, value]) => `    ${key} = ${luaValue(value)},`,
    ),
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
export function footprintSteps(size: number): number {
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
