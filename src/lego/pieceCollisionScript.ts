/**
 * Per-piece collision volumes, as a Lua file of coilbox's own.
 *
 * The engine measures a box round every piece's vertices as the model loads and
 * offers no way at all to declare a different one. `SolidObjectDef` reads a
 * single boolean about pieces, `usePieceCollisionVolumes`, and an `.s3o` piece
 * carries no volume, so the only route is a call on the live unit:
 * `Spring.SetUnitPieceCollisionVolumeData(unitID, piece, enable, sx, sy, sz,
 * ox, oy, oz, type, axis)`. That makes this a unit script feature.
 *
 * Which is a problem, because coilbox generates the unit script from animation
 * presets only until somebody edits it, and `lego_export` writes a script once
 * and then never overwrites it. So collision code emitted into the script would
 * be frozen at whatever the first export happened to write, whether or not the
 * script was ever taken over. That rules out a marked block: it is not only
 * that a takeover might drop it, it is that a re-export cannot update it.
 *
 * So this is a file of its own, `scripts/coilbox/<unit>_collision.lua`, that
 * coilbox owns and rewrites on every export. The unit script pulls it in with
 * one line:
 *
 *     include("coilbox/<unit>_collision.lua")
 *
 * That line is generated into the script and, since taking ownership seeds the
 * user's copy from the generated text, it comes across with everything else.
 * From then on the line never has to change: the file behind it does.
 *
 * `include` is the unit script framework's own, from
 * `LuaGadgets/Gadgets/unit_script.lua`. It resolves relative to `scripts/`,
 * compiles the file once and re-runs it in each unit's own environment, so the
 * included file has that unit's `unitID` and its `piece()` in scope. The unit
 * script chunk itself runs per unit inside `CallAsUnitNoReturn`, so calling out
 * at the top level of the script is enough and no `Create()` hook is needed.
 *
 * What the engine does with the numbers, read off `LuaSyncedCtrl.cpp` and
 * `CollisionVolume.cpp` rather than assumed:
 *
 * - `enable` is checked as a strict boolean and stored inverted, as
 *   `SetIgnoreHits(!enable)`. So false is the piece nothing hits.
 * - `scales` are full extents, and every axis is clamped up to one elmo.
 * - `offsets` are in the piece's own space, the same frame its vertices are in.
 *   Not the unit's aim point, which is what the whole-unit volume measures from.
 * - the last two arguments are numbers here, not the letters a unit definition
 *   uses: 0 ellipsoid, 1 cylinder, 2 box, 3 sphere, and 0, 1, 2 for the axis.
 * - hit testing is always continuous. The call hardcodes it and there is no
 *   argument to ask for anything else.
 * - a piece's index is what `piece("name")` returns. Both are one-based over
 *   `localModel.pieces`, so there is no conversion to make.
 */

import { pieceCollisionVolumes } from "./collisionVolume";
import { localName } from "./luaScript";
import type { CollisionVolumeType, LegoProject } from "./model";
import type { BakedPiece } from "./s3oBuild";
import { luaString } from "./unitDef";

/**
 * The folder coilbox's generated collision files live in, under `scripts/`.
 *
 * A folder of coilbox's own rather than a name beside the unit scripts, because
 * these are files coilbox overwrites and deletes. Nothing in a folder called
 * `coilbox` can be mistaken for the game's own. The unit script framework walks
 * `scripts/` recursively but only ever loads a file some unit definition names
 * as its script, so a file in here is never picked up as one.
 */
export const PIECE_COLLISION_DIR = "coilbox";

/** Where one unit's collision file goes, relative to `scripts/`. */
export function pieceCollisionScriptPath(unitName: string): string {
  return `${PIECE_COLLISION_DIR}/${unitName}_collision.lua`;
}

/** The one line the unit script needs. `include` resolves against `scripts/`. */
export function pieceCollisionInclude(unitName: string): string {
  return `include(${luaString(pieceCollisionScriptPath(unitName))})`;
}

/** Whether any piece has been given something other than its derived box. */
export function hasPieceCollision(project: LegoProject): boolean {
  return project.pieces.some((piece) => piece.collision !== undefined);
}

/**
 * `volumeType` and `primaryAxis` for one shape, as the numbers the Lua call
 * takes. `CollisionVolume.h`: 0 ellipsoid, 1 cylinder, 2 box, 3 sphere, and
 * 0, 1, 2 for x, y and z.
 *
 * The axis only means anything to a cylinder. Everything else takes the
 * engine's own default of z, which is what a piece's derived box carries.
 */
const VOLUME_ARGS: Record<CollisionVolumeType, [number, number]> = {
  ellipsoid: [0, 2],
  cylx: [1, 0],
  cyly: [1, 1],
  cylz: [1, 2],
  box: [2, 2],
  sphere: [3, 2],
};

/**
 * The collision file for this unit. Always a file, even when no piece overrides
 * anything, in which case it does nothing.
 *
 * A unit that stops overriding things has to end up with an empty file rather
 * than no file. The include line lives in a script an export will never rewrite,
 * so taking the file away would leave that line pointing at nothing, and the
 * framework logs an error for every unit created when an include cannot be
 * found. An empty file is the only ending that is quiet both ways.
 *
 * Takes the baked pieces rather than the project alone, because a piece
 * switched off still needs numbers to pass, and the honest numbers are the box
 * the engine would have built. A piece's rotation and scale are baked into its
 * vertices, so those have to be measured off the geometry the export writes.
 */
export function buildPieceCollisionScript(
  project: LegoProject,
  baked: Map<string, BakedPiece>,
): string {
  const byId = new Map(project.pieces.map((piece) => [piece.id, piece]));
  const rows = pieceCollisionVolumes(project, baked)
    .map((entry) => ({ ...entry, piece: byId.get(entry.pieceId) }))
    .filter((entry) => entry.piece?.collision !== undefined);
  if (rows.length === 0) {
    return [
      `-- No piece of ${project.unitName} changes its collision box, so this file`,
      "-- does nothing. Coilbox writes it anyway, because the unit script may",
      "-- already include it and an include that finds nothing is an error.",
      "",
    ].join("\n");
  }

  // Names the file that pulls this one in rather than calling it "the unit
  // script". Inside a generated file that phrase has no referent, and the
  // reader is usually looking for the animation script it means.
  const out: string[] = [
    `-- Collision volumes for ${project.unitName}'s pieces, generated by coilbox.`,
    "-- Rewritten on every export. Change these in coilbox's unit builder, not here.",
    `-- Pulled in by scripts/${project.unitName}.lua, this unit's own animation`,
    "-- script, with the line:",
    `--   ${pieceCollisionInclude(project.unitName)}`,
    "",
  ];

  for (const { piece } of rows) {
    if (!piece) continue;
    out.push(
      `local ${localName(piece.name)} = piece(${luaString(piece.name)})`,
    );
  }
  out.push("");

  for (const { piece, volume, hit } of rows) {
    if (!piece) continue;
    const [type, axis] = VOLUME_ARGS[volume.type];
    const args = [
      "unitID",
      localName(piece.name),
      hit ? "true" : "false",
      ...volume.scales.map(elmos),
      ...volume.offsets.map(elmos),
      String(type),
      String(axis),
    ];
    out.push(
      hit
        ? `-- ${piece.name}`
        : `-- ${piece.name}, which nothing hits: the false is the switch.`,
      `Spring.SetUnitPieceCollisionVolumeData(${args.join(", ")})`,
    );
  }

  return `${out.join("\n").trimEnd()}\n`;
}

/**
 * One measurement, written the way the rest of the exporter writes them: to a
 * thousandth of an elmo, which is far below anything collision can express, so
 * the file stays readable.
 */
function elmos(value: number): string {
  return String(Number(value.toFixed(3)));
}
