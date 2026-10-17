/**
 * Lifting a piece, and everything under it, off one of a game's units into the
 * inventory (issue #3262).
 *
 * A lifted piece is a module like any other, a compound document in
 * `lego/compounds/`, with two differences. Its pieces carry raw meshes rather
 * than parts, so it has a geometry sidecar of its own, `lego/geometry/<id>.bin.gz`,
 * written by the same import that opens a game's unit and named after the
 * module. And every piece records the game and unit it came from
 * (`LegoPiece.lifted`), which is what keeps it in units for that game and off
 * the hub.
 *
 * The sidecar holds the whole model's meshes, not only the lifted ones,
 * because it is written by the existing import. The module's pieces name only
 * their own.
 *
 * Pure, so it can be tested without Tauri.
 */

import type { GameItem } from "@/content/bindings";
import type { S3oImport } from "./bindings";
import { selectionAsCompound } from "./compounds";
import { pieceLines } from "./gameUnits";
import type {
  LegoImportedGame,
  LegoLifted,
  LegoProject,
  LegoUnitGame,
} from "./model";
import { projectFromImport } from "./rawImport";
import { liftRefusal } from "./unitGame";

/**
 * The module a lift makes: the piece at `path` in the imported tree and
 * everything under it, or null when the model has no piece there.
 *
 * `id` must be the id the import stored the geometry under.
 */
export function liftFromImport(
  result: S3oImport,
  path: string,
  options: {
    id: string;
    /** The game read, as `gameRecordFor` records it. */
    game: LegoUnitGame;
    /** The game, model and unit, as an opened unit records them. */
    from: LegoImportedGame;
    source: string;
    /** Whether the model was unpacked into a temp folder. */
    unpacked: boolean;
    packId: string;
    packVersion: string;
    now: string;
    newId: () => string;
  },
): LegoProject | null {
  const index = pieceLines(result.root).findIndex((line) => line.path === path);
  if (index < 0) return null;

  const unitName = options.from.unit ?? options.from.member;
  const whole = projectFromImport(result, {
    id: options.id,
    source: options.source,
    game: options.from,
    unpacked: options.unpacked,
    name: unitName,
    unitName,
    packId: options.packId,
    packVersion: options.packVersion,
    now: options.now,
    newId: options.newId,
  }).project;
  // The import adds pieces in the same order as `pieceLines` lists them.
  const piece = whole.pieces[index];
  const cut = piece
    ? selectionAsCompound(whole, [piece.id], {
        id: options.id,
        now: options.now,
        newId: options.newId,
      })
    : null;
  if (!piece || !cut) return null;

  const lifted: LegoLifted = {
    game: options.game,
    member: options.from.member,
    ...(options.from.unit ? { unit: options.from.unit } : {}),
  };
  return {
    ...cut,
    name: options.from.unit ? `${options.from.unit} ${piece.name}` : piece.name,
    ...(whole.imported ? { imported: whole.imported } : {}),
    game: options.game,
    pieces: cut.pieces.map((p) => ({ ...p, lifted })),
  };
}

/**
 * Whether a document holds any piece lifted from a game. Such a document must
 * never be uploaded to the hub (#3272).
 */
export function holdsLiftedPieces(project: LegoProject): boolean {
  return project.pieces.some((piece) => piece.lifted);
}

/**
 * Why a module cannot go into this unit, or null when it can.
 *
 * A module of parts always can. A lifted one is refused in a unit for another
 * game or for no game. In a unit for its own game it is held back too, until a
 * unit can draw lifted meshes beside parts (#3259).
 */
export function liftedModuleRefusal(
  project: LegoProject,
  module: LegoProject,
  installed: readonly GameItem[] = [],
): string | null {
  const from = module.pieces.find((piece) => piece.lifted)?.lifted;
  if (!from) return null;
  return (
    liftRefusal(project, from.game, installed) ??
    "Lifted pieces cannot go into a unit yet."
  );
}
