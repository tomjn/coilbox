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
  isLooseArchive,
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
 * The name the file actually had is kept too, on `LegoPiece.originalName`,
 * so normalising it is a display and scripting concern rather than a
 * destructive edit: "Save model" writes the original back rather than the
 * normalised name a script needs (#2613).
 *
 * `radius`, `height` and `mid` are pinned from the file rather than recomputed,
 * so a re-export writes the header the model came in with. A format with no
 * header sends null for all three and none is pinned, which leaves the builder
 * measuring the unit as it goes, the same as a unit built out of parts. A `.glb`
 * is the one that does: it has never held a collision sphere to preserve.
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
    /** Whether the model was unpacked out of a packed archive into a temp
     *  folder, which is where its textures were read from too. Their paths go
     *  with the folder when the operating system reclaims it, so none is
     *  recorded: see {@link LegoTexture} (#1903). */
    unpacked?: boolean;
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
      // Kept so a save with no edits can write the file's own name back
      // instead of the normalised one: see `LegoPiece.originalName` (#2613).
      // Absent when the two already agree, which is most pieces most of the
      // time.
      ...(piece.name !== name ? { originalName: piece.name } : {}),
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

  const keepSource = !options.unpacked;
  const imported: LegoImported = {
    source: options.source,
    ...(options.game ? { game: options.game } : {}),
    ...textureFields("texture", "missingTexture", result.texture, keepSource),
    ...textureFields(
      "texture2",
      "missingTexture2",
      result.texture2,
      keepSource,
    ),
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
      ...(result.radius !== null ? { radius: result.radius } : {}),
      ...(result.height !== null ? { height: result.height } : {}),
      ...(result.mid !== null ? { mid: result.mid } : {}),
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
  found: "texture" | "texture2",
  missing: "missingTexture" | "missingTexture2",
  texture: ImportedTexture,
  /** Whether the path it was read from is a real file somebody can go on
   *  editing, rather than a temp copy of one. */
  keepSource: boolean,
): Partial<LegoImported> {
  if (texture.key) {
    return {
      [found]: storedTexture(
        keepSource ? texture : { ...texture, source: null },
      ),
    } as Partial<LegoImported>;
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
 * The real, writable path an imported unit's `.s3o` can be saved back over, or
 * null when there is none.
 *
 * `source` is a real path for a file opened by hand and for one picked out of
 * a loose `.sdd`, since either names a file on disk. For one picked out of a
 * packed archive it is a description of where the model sits, built by
 * appending the member to the archive's own name, and there is no file at
 * that address to open let alone overwrite (#1903 makes the same call for a
 * texture's own `source`).
 */
export function writableSource(imported: LegoImported): string | null {
  // The builder writes an `.s3o`, so a model converted on the way in has
  // nowhere to go back to even when its game is a folder on disk. Saving over
  // a `.dae` would leave a game holding a file whose own extension lies about
  // what is in it. The same is true of a `.3do` opened by hand, which this
  // used to hand back as writable.
  if (!imported.source.toLowerCase().endsWith(".s3o")) return null;
  if (!imported.game) return imported.source;
  return isLooseArchive(imported.game.archive) ? imported.source : null;
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
    texture2: name(imported.texture2, imported.missingTexture2),
    place,
  };
}

/**
 * The same name under a `.png` extension, or with one added when it has none.
 *
 * What a Blender export calls a texture it decoded. The store holds the game's
 * own file, usually a `.dds`, and neither Blender file can carry one: the
 * picture that comes out is a PNG, so it is named as one rather than keeping an
 * extension that now lies about the bytes.
 */
export function pngName(name: string): string {
  const file = name.trim().replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = file.lastIndexOf(".");
  return dot > 0 ? `${file.slice(0, dot)}.png` : `${file}.png`;
}

/**
 * A texture a Blender export decodes out of the store.
 *
 * `role` is which of the `.s3o`'s two it is, which the Rust side needs because
 * the two mean different things by their alpha channel and only one of them can
 * go through a canvas unharmed.
 */
export interface BlenderTextureRef {
  key: string;
  writeAs: string;
  role: "colour" | "mask";
}

/**
 * What an imported unit's two Blender exports do with its two textures.
 *
 * `colour` is the picture the unit is painted with, which is what a material
 * samples: embedded in the `.glb`, and named by the `.mtl`'s `map_Kd`.
 *
 * `mask` is the model's second texture, which carries no colour at all: the
 * engine reads it as glow in red, shine in green and visibility in alpha.
 * Neither glTF nor an `.mtl` has anywhere to put that without claiming it is a
 * picture, so it goes into the `blender` folder as a PNG of its own, next to
 * whichever file was written, for whoever opens it to wire up as they see fit.
 *
 * Either can be missing. A model naming a texture coilbox could not find has no
 * key to read, and a model with one texture and no mask is a perfectly ordinary
 * model.
 */
export function blenderTextures(imported: LegoImported): {
  colour: BlenderTextureRef | null;
  mask: BlenderTextureRef | null;
} {
  const placed = (
    texture: LegoTexture | undefined,
    role: "colour" | "mask",
  ): BlenderTextureRef | null =>
    texture?.key
      ? { key: texture.key, writeAs: pngName(texture.name), role }
      : null;
  return {
    colour: placed(imported.texture, "colour"),
    mask: placed(imported.texture2, "mask"),
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
      project.imported?.texture2,
    ]) {
      if (texture?.key) keys.add(texture.key);
    }
  }
  return [...keys];
}
