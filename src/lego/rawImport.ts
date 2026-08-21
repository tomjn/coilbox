/**
 * Turning an imported `.s3o` into a project.
 *
 * The other half of importing: `lego_import_s3o` parses the file, packs the
 * meshes into the geometry sidecar and finds the textures, and this makes the
 * document that points at all three. Pure, so it can be tested without Tauri or
 * a renderer.
 *
 * An imported unit has no parts and no atlas. Its UVs point onto its own
 * texture rather than onto the pack's sheet, so a lego part dropped into it
 * would sample the wrong image and there is nothing that could fix that. The
 * parts library and the atlas picker are hidden for such a unit and it carries
 * a texture of its own instead. `importS3o.ts` is the other road a `.s3o` can
 * go down: recovering a project from a model coilbox itself exported, which
 * gives back real parts and is tried first.
 */

import type {
  ImportedPiece,
  ImportedTexture,
  S3oImport,
  StoredTextureRef,
} from "./bindings";
import {
  LEGO_SCHEMA_VERSION,
  type LegoImported,
  type LegoImportedGame,
  type LegoPiece,
  type LegoProject,
  type LegoTexture,
  normalisePieceName,
  uniquePieceName,
} from "./model";

/** What an import turned into, for the drawer to report before saving it. */
export interface RawImport {
  project: LegoProject;
  /** Pieces carrying geometry, as against hierarchy nodes and aim points. */
  meshes: number;
  vertices: number;
  triangles: number;
  /** Pieces drawn as quads or a strip, which were converted to triangles. */
  converted: number;
  /** How large the geometry sidecar is on disk, in bytes. */
  bytes: number;
}

/**
 * Build the project for a model that has just been imported.
 *
 * Piece names come from the file and are normalised and made unique, because a
 * unit script addresses pieces by name and a shipped model is free to use
 * mixed case, spaces and the same name twice. The mesh keys are not derived
 * from the names for exactly that reason: they come from the file's own walk
 * order, so renaming a piece later cannot move the geometry under it.
 *
 * `radius`, `height` and `mid` are pinned from the file rather than recomputed,
 * so a re-export writes the header the model came in with.
 */
export function projectFromImport(
  result: S3oImport,
  options: {
    /** The project's id, which the geometry sidecar is already named after. */
    id: string;
    source: string;
    /** The game and unit this model was picked as, when it was picked out of a
     *  game rather than off disk. Recorded here because this is the only moment
     *  anything knows it (#1819). */
    game?: LegoImportedGame;
    name: string;
    unitName: string;
    packId: string;
    packVersion: string;
    now: string;
    newId: () => string;
  },
): RawImport {
  const pieces: LegoPiece[] = [];
  const taken = new Set<string>();

  const visit = (piece: ImportedPiece, parentId: string | null): string => {
    const id = options.newId();
    const name = uniquePieceName(piece.name, taken);
    taken.add(name);
    pieces.push({
      id,
      name,
      parentId,
      // Never a part. An imported mesh is not something the parts library has,
      // and letting the two share a field would let one resolve as the other.
      partId: null,
      ...(piece.meshId ? { meshId: piece.meshId } : {}),
      // The format stores a translation per piece and nothing else, which is
      // exactly what the document's own rotation and scale start at.
      position: piece.offset,
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    for (const child of piece.children) visit(child, id);
    return id;
  };
  const rootPieceId = visit(result.root, null);

  const imported: LegoImported = {
    source: options.source,
    ...(options.game ? { game: options.game } : {}),
    ...textureFields("texture", "missingTexture", result.texture),
    ...textureFields("teamMask", "missingTeamMask", result.teamMask),
  };

  return {
    project: {
      schemaVersion: LEGO_SCHEMA_VERSION,
      id: options.id,
      name: options.name,
      unitName: normalisePieceName(options.unitName),
      packId: options.packId,
      packVersion: options.packVersion,
      imported,
      createdAt: options.now,
      updatedAt: options.now,
      rootPieceId,
      pieces,
      radius: result.radius,
      height: result.height,
      mid: result.mid,
    },
    meshes: result.meshes,
    vertices: result.vertices,
    triangles: result.triangles,
    converted: result.converted,
    bytes: result.bytes,
  };
}

/**
 * One header texture as the document holds it, or the name it wanted.
 *
 * Not finding a texture is not fatal. Recording the name is what lets the
 * builder say which file it was after and offer to point at it, which is more
 * use than an untextured model with no explanation.
 */
function textureFields(
  found: "texture" | "teamMask",
  missing: "missingTexture" | "missingTeamMask",
  texture: ImportedTexture,
): Partial<LegoImported> {
  if (texture.key) {
    return { [found]: storedTexture(texture) } as Partial<LegoImported>;
  }
  if (texture.name.trim() === "") return {};
  return { [missing]: texture.name } as Partial<LegoImported>;
}

/** A texture the store now holds, as the document names it. */
export function storedTexture(texture: {
  key: string | null;
  name: string;
  source?: string | null;
}): LegoTexture {
  return {
    key: texture.key ?? "",
    name: texture.name,
    ...(texture.source ? { source: texture.source } : {}),
  };
}

/** Whether a unit was imported whole rather than built out of the parts pack. */
export function isImported(project: LegoProject): boolean {
  return project.imported !== undefined;
}

/**
 * What an imported unit's export names in the model header, and what it has to
 * place in `unittextures` for those names to resolve.
 *
 * Under their own names, not under a coilbox-prefixed one. A pack's atlas is
 * called something generic like `atlas.png` and is prefixed so it cannot land
 * on a file the game already has. An imported model's texture is already the
 * game's own file under the game's own name, so writing it as anything else
 * would leave the model naming a file that is not there.
 */
export function importedTextures(imported: LegoImported): {
  texture1: string;
  texture2: string;
  place: StoredTextureRef[];
} {
  const place: StoredTextureRef[] = [];
  const name = (
    texture: LegoTexture | undefined,
    missing: string | undefined,
  ) => {
    if (texture?.key) {
      place.push({ key: texture.key, writeAs: texture.name });
      return texture.name;
    }
    // The header keeps naming a texture that could not be found, so installing
    // it later puts the exported unit right without the unit having to change.
    return missing ?? "";
  };
  return {
    texture1: name(imported.texture, imported.missingTexture),
    texture2: name(imported.teamMask, imported.missingTeamMask),
    place,
  };
}

/**
 * Every stored texture key a set of units names, for pruning the store.
 *
 * The store is shared and content addressed, so nothing can decide whether a
 * key is dead by looking at one unit. This is the whole keep-set, and anything
 * in the store outside it is a version something was refreshed away from.
 */
export function texturesInUse(projects: LegoProject[]): string[] {
  const keys = new Set<string>();
  for (const project of projects) {
    for (const texture of [
      project.imported?.texture,
      project.imported?.teamMask,
    ]) {
      if (texture?.key) keys.add(texture.key);
    }
  }
  return [...keys];
}
