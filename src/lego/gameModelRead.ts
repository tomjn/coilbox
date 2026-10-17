/**
 * Reading a game's model for its piece tree and for a lift, whatever format it
 * is in (issue #4338).
 *
 * An `.s3o` has a read-only command that gives the tree and the texture names.
 * A `.3do` or an Assimp format has none, and its import can leave pieces out
 * (`droppedPieces`), so its tree comes from the import itself. The lift then
 * imports again and finds the chosen piece in that tree, which was built the
 * same way, so the two always agree on which pieces exist and in what order.
 */

import { isAssimpModel } from "./archiveOpen";
import {
  legoImport3do,
  legoImportDae,
  legoImportS3o,
  legoRead3do,
  legoReadDae,
  legoReadS3o,
  type S3oImport,
} from "./bindings";
import type { PieceNode } from "./gameUnits";

/** A model's pieces, and the textures it names. */
export interface ModelPieces {
  root: PieceNode;
  textures: string[];
}

/** Whether the lift can read a model of this name. */
export function canLift(member: string): boolean {
  return /\.(s3o|3do)$/i.test(member) || isAssimpModel(member);
}

/**
 * Read the piece tree of the model at `path`.
 *
 * `stage` is called with the textures the model names before a `.3do` or
 * Assimp model is imported, because the import looks for them beside the model.
 * An `.s3o` is only read, so `stage` is not called for it.
 */
export async function readPieces(
  path: string,
  stage: (textures: string[]) => Promise<void>,
): Promise<ModelPieces> {
  if (/\.s3o$/i.test(path)) {
    const model = await legoReadS3o({ path });
    return { root: model.root, textures: [model.texture1, model.texture2] };
  }
  const { textures } = await (/\.3do$/i.test(path)
    ? legoRead3do({ path })
    : legoReadDae({ path }));
  await stage(textures);
  // This import only lists the pieces. Its geometry file has an id nothing
  // names, so the startup sweep removes it.
  const result = await importModel(path, crypto.randomUUID());
  return { root: result.root, textures };
}

/** Import the model at `path` as raw geometry stored under `id`. */
export function importModel(path: string, id: string): Promise<S3oImport> {
  if (/\.s3o$/i.test(path)) return legoImportS3o({ path, id });
  if (/\.3do$/i.test(path)) return legoImport3do({ path, id });
  return legoImportDae({ path, id });
}
