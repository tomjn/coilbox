/**
 * Moving a piece onto a different parent without moving it on screen.
 *
 * Every transform in the document is relative to the piece's parent, so
 * swapping the parent alone would teleport the piece. Its world transform is
 * worked out from the old chain and written back against the new one, which
 * leaves the unit looking exactly as it did.
 *
 * Separate from model.ts because this is the only rule that needs matrix maths,
 * and the model stays free of three.
 */

import * as THREE from "three";

import {
  childrenOf,
  descendantIds,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";

/**
 * Every piece that could carry all of `pieceIds`, in tree order and with its
 * depth.
 *
 * What the "hangs off" pickers offer. The list reads as the hierarchy it is
 * choosing from, rather than a flat list in which two pieces called `barrel`
 * are indistinguishable. A set only offers a parent every piece in it can move
 * to, so the move never half happens.
 */
export function parentOptions(
  project: LegoProject,
  pieceIds: string[],
): { piece: LegoPiece; depth: number }[] {
  const options: { piece: LegoPiece; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const child of childrenOf(project, parentId)) {
      if (pieceIds.every((id) => canReparent(project, id, child.id))) {
        options.push({ piece: child, depth });
      }
      visit(child.id, depth + 1);
    }
  };
  visit(null, 0);
  return options;
}

/** Where a piece sits in the unit, with every ancestor's transform applied. */
export function worldMatrix(
  project: LegoProject,
  pieceId: string,
): THREE.Matrix4 {
  const world = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  // A malformed document can have a parent loop, and this walk is the first
  // thing that would hang on one.
  const seen = new Set<string>();
  let piece = pieceById(project, pieceId);
  while (piece && !seen.has(piece.id)) {
    seen.add(piece.id);
    local.compose(
      position.set(...piece.position),
      rotation.setFromEuler(new THREE.Euler(...piece.rotation)),
      scale.set(...piece.scale),
    );
    world.premultiply(local);
    piece = piece.parentId ? pieceById(project, piece.parentId) : undefined;
  }
  return world;
}

/**
 * Whether a piece can hang off that parent.
 *
 * A piece cannot take its own descendant as a parent, which would cut the
 * branch off the tree entirely, and the root has nothing above it to move to.
 */
export function canReparent(
  project: LegoProject,
  pieceId: string,
  parentId: string,
): boolean {
  if (pieceId === parentId) return false;
  if (pieceId === project.rootPieceId) return false;
  if (!pieceById(project, pieceId) || !pieceById(project, parentId)) {
    return false;
  }
  return !descendantIds(project, pieceId).includes(parentId);
}

/** The piece hangs off `parentId`, in the same place it was before. */
export function reparentPiece(
  project: LegoProject,
  pieceId: string,
  parentId: string,
): LegoProject {
  if (!canReparent(project, pieceId, parentId)) return project;

  const local = worldMatrix(project, parentId)
    .invert()
    .multiply(worldMatrix(project, pieceId));

  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  local.decompose(position, rotation, scale);
  const euler = new THREE.Euler().setFromQuaternion(rotation);

  return {
    ...project,
    pieces: project.pieces.map((piece) =>
      piece.id === pieceId
        ? {
            ...piece,
            parentId,
            position: [position.x, position.y, position.z],
            rotation: [euler.x, euler.y, euler.z],
            scale: [scale.x, scale.y, scale.z],
          }
        : piece,
    ),
  };
}
