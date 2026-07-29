/**
 * Saving a piece subtree for reuse, and dropping it into another unit.
 *
 * A compound is a project document holding one subtree, kept in its own folder.
 * Same schema, so there is no second format to parse and anything that reads a
 * unit can read a compound.
 *
 * This is what replaces shipping prefab units. You build an assembly out of
 * pieces and save it, rather than taking one out of somebody else's game.
 */

import {
  descendantIds,
  LEGO_SCHEMA_VERSION,
  type LegoPiece,
  type LegoProject,
  pieceById,
  uniquePieceName,
  walkPieces,
} from "./model";

/**
 * Copy a piece and everything under it into a compound.
 *
 * The subtree root loses its transform. A compound is defined by how its pieces
 * sit against each other, not by where the assembly happened to be in the unit
 * it was lifted from.
 */
export function subtreeAsCompound(
  project: LegoProject,
  pieceId: string,
  options: { id: string; now: string; newId: () => string },
): LegoProject | null {
  const root = pieceById(project, pieceId);
  if (!root) return null;

  const ids = descendantIds(project, pieceId);
  const remap = new Map(ids.map((id) => [id, options.newId()]));

  const pieces = ids.map((id): LegoPiece => {
    const piece = pieceById(project, id) as LegoPiece;
    return {
      ...piece,
      id: remap.get(id) as string,
      parentId:
        id === pieceId ? null : (remap.get(piece.parentId as string) ?? null),
      position: id === pieceId ? [0, 0, 0] : piece.position,
      rotation: id === pieceId ? [0, 0, 0] : piece.rotation,
      scale: id === pieceId ? [1, 1, 1] : piece.scale,
    };
  });

  return {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: options.id,
    name: root.name,
    unitName: root.name,
    packId: project.packId,
    packVersion: project.packVersion,
    createdAt: options.now,
    updatedAt: options.now,
    rootPieceId: remap.get(pieceId) as string,
    pieces,
  };
}

/**
 * Whether `name` can replace the given compound's name, and why not if it
 * cannot.
 *
 * A compound's name is a free-text label, not a piece name, so it is not run
 * through `normalisePieceName`. It only has to be non-empty and not collide
 * with a sibling, because the grid tells compounds apart by name alone.
 */
export function validateCompoundName(
  compounds: LegoProject[],
  id: string,
  name: string,
): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Name cannot be empty";
  const clash = compounds.some(
    (compound) =>
      compound.id !== id &&
      compound.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) return "Another compound already has this name";
  return null;
}

/**
 * Add a compound's pieces to a unit, hanging off `parentId`.
 *
 * Names are made unique as they land, because a script addresses pieces by
 * name and two `barrel`s would be one piece too few.
 */
export function insertCompound(
  project: LegoProject,
  compound: LegoProject,
  parentId: string,
  newId: () => string,
): { project: LegoProject; rootPieceId: string } {
  const parent = pieceById(project, parentId) ? parentId : project.rootPieceId;
  const taken = project.pieces.map((piece) => piece.name);
  const remap = new Map<string, string>();

  // Depth first from the compound's root, so a piece's parent is always
  // remapped before the piece itself.
  const added = walkPieces(compound).map((piece): LegoPiece => {
    const id = newId();
    remap.set(piece.id, id);
    const name = uniquePieceName(piece.name, taken);
    taken.push(name);
    return {
      ...piece,
      id,
      name,
      parentId:
        piece.id === compound.rootPieceId
          ? parent
          : (remap.get(piece.parentId as string) ?? parent),
    };
  });

  return {
    project: { ...project, pieces: [...project.pieces, ...added] },
    rootPieceId: remap.get(compound.rootPieceId) as string,
  };
}
