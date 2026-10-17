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
import type { RoleProposal } from "./inferRoles";
import { withLiftedRoles } from "./liftRoles";
import type {
  LegoImported,
  LegoImportedGame,
  LegoLifted,
  LegoProject,
  LegoTexture,
  LegoUnitGame,
} from "./model";
import type { RawGeometry } from "./rawGeometry";
import { projectFromImport } from "./rawImport";
import { liftRefusal, unitGame } from "./unitGame";

/** What importing a model needs to know, whether it is lifted from or not. */
interface ImportOptions {
  id: string;
  /** The game, model and unit, as an opened unit records them. */
  from: LegoImportedGame;
  source: string;
  /** Whether the model was unpacked into a temp folder. */
  unpacked: boolean;
  packId: string;
  packVersion: string;
  now: string;
  newId: () => string;
}

/**
 * The whole model as a unit, the way opening it from the game makes one. A lift
 * cuts its module out of this, and the game's script is asked about this
 * unit's pieces, since the script names every piece of the model.
 */
export function wholeFromImport(
  result: S3oImport,
  options: ImportOptions,
): LegoProject {
  const unitName = options.from.unit ?? options.from.member;
  return projectFromImport(result, {
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
}

/**
 * The module a lift makes: the piece at `path` in the imported tree and
 * everything under it, or null when the model has no piece there.
 *
 * `id` must be the id the import stored the geometry under.
 *
 * `roles` are what the game's script said about the model's pieces. Passing
 * them, even an empty list, gives the lifted pieces their roles and the module
 * the presets those roles run (#3270). Leaving them out lifts geometry only.
 */
export function liftFromImport(
  result: S3oImport,
  path: string,
  options: ImportOptions & {
    /** The game read, as `gameRecordFor` records it. */
    game: LegoUnitGame;
    /** The unit `wholeFromImport` made, when the caller already has one. */
    whole?: LegoProject;
    roles?: RoleProposal[];
  },
): LegoProject | null {
  const index = pieceLines(result.root).findIndex((line) => line.path === path);
  if (index < 0) return null;

  const whole = options.whole ?? wholeFromImport(result, options);
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
    ...liftedTextures(whole.imported),
  };
  const module: LegoProject = {
    ...cut,
    name: options.from.unit ? `${options.from.unit} ${piece.name}` : piece.name,
    ...(whole.imported ? { imported: whole.imported } : {}),
    game: options.game,
    pieces: cut.pieces.map((p) => ({ ...p, lifted })),
  };
  return options.roles ? withLiftedRoles(module, options.roles) : module;
}

/**
 * Whether a document holds any piece lifted from a game. Such a document must
 * never be uploaded to the hub (#3272).
 */
export function holdsLiftedPieces(project: LegoProject): boolean {
  return project.pieces.some((piece) => piece.lifted);
}

/**
 * The pieces with a mesh and no box, given the box of that mesh from `raw`
 * (#3269). A box a piece already has is kept, and a mesh `raw` does not hold
 * leaves its piece as it is. The same document comes back when nothing changed.
 *
 * Pieces are measured here rather than at the lift, because the vertices never
 * cross the IPC: only the sidecar written by the import has them.
 */
export function withMeshBoxes(
  project: LegoProject,
  raw: RawGeometry,
): LegoProject {
  let changed = false;
  const pieces = project.pieces.map((piece) => {
    const mesh = piece.meshId ? raw.byId.get(piece.meshId) : undefined;
    if (!mesh || piece.meshBox) return piece;
    changed = true;
    return { ...piece, meshBox: mesh.bbox };
  });
  return changed ? { ...project, pieces } : project;
}

/** The credit for one lifted piece: "From Beyond All Reason, unit armcom". */
export function liftCredit(lifted: LegoLifted): string {
  const what = lifted.unit ? `unit ${lifted.unit}` : `model ${lifted.member}`;
  return `From ${lifted.game.name}, ${what}`;
}

/** Every game and unit the pieces of this document were lifted from, once each. */
export function liftCredits(project: LegoProject): string[] {
  const seen = new Set<string>();
  for (const piece of project.pieces) {
    if (piece.lifted) seen.add(liftCredit(piece.lifted));
  }
  return [...seen];
}

/**
 * Why a module cannot go into this unit, or null when it can.
 *
 * A module of parts always can. A lifted one goes only into a unit for its own
 * game, and never into a unit imported whole, which draws every piece with its
 * one texture.
 */
export function liftedModuleRefusal(
  project: LegoProject,
  module: LegoProject,
  installed: readonly GameItem[] = [],
): string | null {
  const sources = module.pieces.flatMap((piece) =>
    piece.lifted ? [piece.lifted] : [],
  );
  if (sources.length === 0) return null;
  if (project.imported)
    return "Lifted pieces go into a unit built from parts, not one opened from a model.";
  // Every piece is checked, since a module can hold pieces from two games.
  for (const from of sources) {
    const refused = liftRefusal(project, from.game, installed);
    if (refused) return refused;
  }
  return null;
}

/**
 * Where the meshes of a unit opened from a game came from, or null for a unit
 * that was not. Those meshes are the game's own, but carry no `lifted` record
 * while they stay in their unit.
 */
export function openedFrom(project: LegoProject): LegoLifted | null {
  const opened = project.imported?.game;
  if (!opened) return null;
  return {
    game: unitGame(project) ?? { name: opened.name, archive: opened.archive },
    member: opened.member,
    ...(opened.unit ? { unit: opened.unit } : {}),
    ...liftedTextures(project.imported),
  };
}

/**
 * The pieces with a mesh and no record of where it came from, marked as lifted
 * from `source`. A copy of part of a unit opened from a game becomes game
 * geometry in the unit it is pasted into, and is held to the same game rule.
 */
export function markLifted(
  project: LegoProject,
  source: LegoLifted,
): LegoProject {
  return {
    ...project,
    pieces: project.pieces.map((piece) =>
      piece.meshId && !piece.lifted ? { ...piece, lifted: source } : piece,
    ),
  };
}

/** The two textures a lifted piece records, without a path to refresh from. */
function liftedTextures(
  imported: Pick<LegoImported, "texture" | "texture2"> | undefined,
): Pick<LegoLifted, "texture" | "texture2"> {
  const bare = (texture: LegoTexture | undefined) =>
    texture ? { key: texture.key, name: texture.name } : undefined;
  const texture = bare(imported?.texture);
  const texture2 = bare(imported?.texture2);
  return {
    ...(texture ? { texture } : {}),
    ...(texture2 ? { texture2 } : {}),
  };
}

/**
 * The key a lifted module's mesh is kept under in a unit's own sidecar.
 *
 * Every import keys its meshes `m0`, `m1` and on, so two modules lifted from
 * two models share keys. Prefixing the module's id keeps them apart, and the
 * same module going in twice lands on the same keys.
 */
export function liftedMeshKey(moduleId: string, meshId: string): string {
  return `${moduleId}/${meshId}`;
}

/**
 * A lifted module as it goes into a unit (#3259), and which of its sidecar's
 * meshes to copy into the unit's under which key.
 *
 * Each piece names its mesh by the unit's key and records the textures it draws
 * with. A module lifted before pieces recorded them takes them from the module.
 * A mesh key that already carries the prefix is left alone.
 */
export function moduleForUnit(module: LegoProject): {
  module: LegoProject;
  keys: Map<string, string>;
} {
  const keys = new Map<string, string>();
  const prefix = liftedMeshKey(module.id, "");
  const own = liftedTextures(module.imported);
  const pieces = module.pieces.map((piece) => {
    if (!piece.meshId || piece.meshId.startsWith(prefix)) return piece;
    const meshId = liftedMeshKey(module.id, piece.meshId);
    keys.set(piece.meshId, meshId);
    const lifted = piece.lifted && {
      ...(piece.lifted.texture || piece.lifted.texture2 ? {} : own),
      ...piece.lifted,
    };
    return { ...piece, meshId, ...(lifted ? { lifted } : {}) };
  });
  return { module: { ...module, pieces }, keys };
}

/**
 * Why a unit cannot be written out as a model yet, or null when it can.
 *
 * A model names one colour texture for all its pieces. A unit of parts samples
 * the pack's atlas, and a lifted piece's UVs point onto its game's texture, so
 * a unit holding both has no one texture to name until the two are combined
 * into one sheet (#3260).
 */
export function textureSheetRefusal(project: LegoProject): string | null {
  if (project.imported) return null;
  if (!project.pieces.some((piece) => piece.meshId)) return null;
  return "This unit holds pieces lifted from a game, which draw with the game's texture rather than the pack's atlas. A model has one texture, and combining the two into one sheet is not built yet, so this unit cannot be exported or tested in a game yet.";
}
