/**
 * Saving a piece subtree for reuse, and dropping it into another unit.
 *
 * A compound is a project document holding the pieces that were lifted, kept in
 * its own folder. Same schema, so there is no second format to parse and
 * anything that reads a unit can read a compound.
 *
 * A compound made from a set of pieces holds several parentless pieces, one per
 * piece that was selected. That is what "no invented parent" means in practice:
 * two arms are two roots in the document, not one fabricated piece holding two,
 * which would show up in the piece tree and in the exported model. `rootPieceId`
 * names the first of them, so a document written this way still parses
 * everywhere. A unit is not allowed this, and `projectProblems` still says so.
 *
 * This is what replaces shipping prefab units. You build an assembly out of
 * pieces and save it, rather than taking one out of somebody else's game.
 */

import * as THREE from "three";

import {
  descendantIds,
  LEGO_SCHEMA_VERSION,
  type LegoPiece,
  type LegoProject,
  orderedPieces,
  pieceById,
  uniquePieceName,
} from "./model";
import { worldMatrix } from "./reparent";

/**
 * The pieces of a selection a cutting is actually taken from.
 *
 * A piece selected alongside one of its own ancestors is already carried by that
 * ancestor, so lifting it as well would put it in the cutting twice. Unlike
 * `transformRoots`, the unit's own root piece stays: copying or saving a whole
 * unit is a real thing to want, where moving or deleting it is not.
 */
export function cuttingRoots(
  project: LegoProject,
  pieceIds: string[],
): string[] {
  const present = pieceIds.filter((id) => pieceById(project, id));
  const carried = new Set<string>();
  for (const id of present) {
    for (const child of descendantIds(project, id)) {
      if (child !== id) carried.add(child);
    }
  }
  return present.filter((id) => !carried.has(id));
}

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
  return selectionAsCompound(project, [pieceId], options);
}

/**
 * Copy a whole selection, and everything under it, into one compound.
 *
 * The first piece of the selection anchors the set: it loses its transform, the
 * way a single lifted piece does, and every other root is placed against it. So
 * two pieces a metre apart are still a metre apart once the compound is dropped
 * back in, wherever it lands, and copying one piece is unchanged.
 */
export function selectionAsCompound(
  project: LegoProject,
  pieceIds: string[],
  options: { id: string; now: string; newId: () => string },
): LegoProject | null {
  const roots = cuttingRoots(project, pieceIds);
  const anchorId = roots[0];
  const anchor = anchorId ? pieceById(project, anchorId) : undefined;
  if (!anchorId || !anchor) return null;

  const frame = worldMatrix(project, anchorId).invert();
  const remap = new Map<string, string>();
  const pieces: LegoPiece[] = [];

  for (const rootId of roots) {
    // The anchor is zeroed rather than worked out from its own frame, which is
    // the identity but only to within rounding.
    const at =
      rootId === anchorId ? AT_ORIGIN : inFrame(project, frame, rootId);
    const ids = descendantIds(project, rootId);
    for (const id of ids) remap.set(id, options.newId());
    for (const id of ids) {
      const piece = pieceById(project, id) as LegoPiece;
      pieces.push({
        ...piece,
        id: remap.get(id) as string,
        parentId:
          id === rootId ? null : (remap.get(piece.parentId as string) ?? null),
        ...(id === rootId ? at : {}),
      });
    }
  }

  return {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: options.id,
    name: anchor.name,
    unitName: anchor.name,
    packId: project.packId,
    packVersion: project.packVersion,
    createdAt: options.now,
    updatedAt: options.now,
    rootPieceId: remap.get(anchorId) as string,
    pieces,
  };
}

type Placement = Pick<LegoPiece, "position" | "rotation" | "scale">;

const AT_ORIGIN: Placement = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

/** Where a lifted root sits against the first one, which is the set's origin. */
function inFrame(
  project: LegoProject,
  frame: THREE.Matrix4,
  pieceId: string,
): Placement {
  const local = frame.clone().multiply(worldMatrix(project, pieceId));
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  local.decompose(position, rotation, scale);
  const euler = new THREE.Euler().setFromQuaternion(rotation);
  return {
    position: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z],
    scale: [scale.x, scale.y, scale.z],
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
 * name and two `barrel`s would be one piece too few. Every root of the compound
 * hangs off the same parent, keeping the spacing between them, and they come
 * back as `rootPieceIds` so the selection can land on all of them.
 */
export function insertCompound(
  project: LegoProject,
  compound: LegoProject,
  parentId: string,
  newId: () => string,
): { project: LegoProject; rootPieceIds: string[] } {
  const parent = pieceById(project, parentId) ? parentId : project.rootPieceId;
  const taken = project.pieces.map((piece) => piece.name);
  const remap = new Map<string, string>();
  const rootPieceIds: string[] = [];

  // Depth first from the compound's root, then anything the walk did not reach,
  // which is how a compound made from a set carries its other roots. Either way
  // a piece's parent is remapped before the piece itself.
  const added = orderedPieces(compound).map((piece): LegoPiece => {
    const id = newId();
    remap.set(piece.id, id);
    const name = uniquePieceName(piece.name, taken);
    taken.push(name);
    const under =
      piece.id === compound.rootPieceId
        ? parent
        : (remap.get(piece.parentId as string) ?? parent);
    if (under === parent) rootPieceIds.push(id);
    return { ...piece, id, name, parentId: under };
  });

  return {
    project: { ...project, pieces: [...project.pieces, ...added] },
    rootPieceIds,
  };
}

/**
 * Insert a compound, then put back the transform lifting it dropped.
 *
 * `subtreeAsCompound` resets the root's position, rotation and scale so a
 * compound can be placed anywhere, which is right for something pulled from the
 * library but wrong for an operation that means "this piece, again": duplicate
 * and mirror-as-copy both want the copy to land where the source already sits,
 * not at its parent's origin. Shared so the two do not grow their own answers to
 * the same question.
 */
export function insertCompoundAt(
  project: LegoProject,
  compound: LegoProject,
  parentId: string,
  transform: Placement,
  newId: () => string,
): { project: LegoProject; rootPieceId: string } {
  const inserted = insertCompound(project, compound, parentId, newId);
  // The first root, because the callers are duplicate and mirror and both hand
  // over one piece's transform to put back.
  const rootPieceId = inserted.rootPieceIds[0] as string;
  return {
    project: {
      ...inserted.project,
      pieces: inserted.project.pieces.map((piece) =>
        piece.id === rootPieceId ? { ...piece, ...transform } : piece,
      ),
    },
    rootPieceId,
  };
}
