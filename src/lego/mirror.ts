/**
 * Reflecting a piece and everything under it across the unit's centre line.
 *
 * The centre line is the plane x = 0 in the root piece's own space. Spring
 * models are built facing +z with left and right either side of x, so that is
 * the plane a leg crosses to become the other leg, and the root is what every
 * other piece is positioned against.
 *
 * Only the piece being mirrored changes. Its children are already positioned
 * against it, so reflecting its transform carries the whole subtree over: a
 * child's place in the unit is its parent's transform times its own, and
 * reflecting the parent reflects the product.
 *
 * A reflection is a negative scale, which is what the piece ends up carrying,
 * and `s3oBuild.ts` already reverses triangle winding whenever the transform it
 * bakes has a negative determinant. So there is no separate mirror flag: the
 * scale is the mirror, and one sign cannot disagree with the other.
 */

import * as THREE from "three";

import { insertCompound, subtreeAsCompound } from "./compounds";
import {
  descendantIds,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import { worldMatrix } from "./reparent";

/** Reflection across x = 0, the plane the unit's centre line runs down. */
const REFLECT_X = new THREE.Matrix4().makeScale(-1, 1, 1);

/**
 * Whether a piece can be mirrored.
 *
 * Everything but the root. The root is the frame the centre line is measured
 * in, so reflecting it about its own plane is a statement about the whole unit
 * rather than about a piece, and the same reasoning already keeps the root out
 * of duplicate and delete.
 */
export function canMirror(project: LegoProject, pieceId: string): boolean {
  if (pieceId === project.rootPieceId) return false;
  return pieceById(project, pieceId) !== undefined;
}

/**
 * The role a mirrored piece takes: the same job on the other side.
 *
 * Left and right are in the role vocabulary itself, `leg.l1.thigh` against
 * `leg.r1.thigh`, and the walk presets ask for one of each. A mirrored leg that
 * kept its role would be a second left leg, and the preset would still be a
 * right one short. Every other role is sideless and comes back unchanged.
 */
export function mirrorRole(role: string): string {
  return role.replace(
    /^leg\.([lr])(\d)\./,
    (_match, side: string, pair: string) =>
      `leg.${side === "l" ? "r" : "l"}${pair}.`,
  );
}

/**
 * Reflect a piece and its subtree across the unit's centre line.
 *
 * The piece keeps its parent and lands where a mirror would put it: a leg
 * hanging off the left of the hull swings to the right, still hanging off the
 * hull. A piece already sitting on the centre line stays put and turns inside
 * out in place, which is what a mirror does to it. Mirroring twice returns the
 * piece to where it started.
 *
 * Returns the project untouched when the piece cannot be mirrored.
 */
export function mirrorPiece(
  project: LegoProject,
  pieceId: string,
): LegoProject {
  if (!canMirror(project, pieceId)) return project;
  const piece = pieceById(project, pieceId) as LegoPiece;

  // The centre line belongs to the root, so its reflection has to be carried
  // into the frame the document's transforms are written in before it is any
  // use here. A unit whose root is offset or turned still mirrors about its own
  // middle rather than about the world's.
  const root = worldMatrix(project, project.rootPieceId);
  const reflect = root
    .clone()
    .multiply(REFLECT_X)
    .multiply(root.clone().invert());

  // Reflect where the piece sits in the unit, then write that back against its
  // parent, which has not moved. A document with a second parentless piece is
  // already broken, and treating it as its own frame is enough to not crash.
  const parent = piece.parentId
    ? worldMatrix(project, piece.parentId)
    : new THREE.Matrix4();
  const local = parent
    .clone()
    .invert()
    .multiply(reflect)
    .multiply(worldMatrix(project, pieceId));

  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  // `decompose` puts the reflection on x when the matrix turns space inside
  // out, which is exactly the negative scale the exporter reads.
  local.decompose(position, rotation, scale);
  const euler = new THREE.Euler().setFromQuaternion(rotation);

  const subtree = new Set(descendantIds(project, pieceId));
  return {
    ...project,
    pieces: project.pieces.map((current) => {
      if (!subtree.has(current.id)) return current;
      const sided = current.role
        ? { ...current, role: mirrorRole(current.role) }
        : current;
      return current.id === pieceId
        ? {
            ...sided,
            position: [position.x, position.y, position.z],
            rotation: [euler.x, euler.y, euler.z],
            scale: [scale.x, scale.y, scale.z],
          }
        : sided;
    }),
  };
}

/**
 * Add a mirrored copy of a piece and its subtree beside the original.
 *
 * This is the leg case: the first leg stays and the second one is its
 * reflection. The copy is lifted and put back through the same machinery the
 * clipboard and duplicate use, so its new ids and its names come from one place
 * rather than a third scheme of this file's own.
 *
 * Answers null when the piece cannot be mirrored, and otherwise the new
 * document with the copy's own piece id.
 */
export function mirrorCopy(
  project: LegoProject,
  pieceId: string,
  newId: () => string,
): { project: LegoProject; pieceId: string } | null {
  const source = pieceById(project, pieceId);
  if (!source || !canMirror(project, pieceId)) return null;

  // The compound in the middle is never stored, so its id and its timestamp are
  // only there to satisfy the shape a saved one has.
  const cutting = subtreeAsCompound(project, pieceId, {
    id: newId(),
    now: project.updatedAt,
    newId,
  });
  if (!cutting) return null;

  const inserted = insertCompound(
    project,
    cutting,
    source.parentId ?? project.rootPieceId,
    newId,
  );

  // Lifting drops the subtree root's transform, because a compound is defined
  // by how its pieces sit against each other rather than by where it came from.
  // A mirror has to start from where the original stands: reflecting a leg that
  // had been dropped back at the hull's origin would not be the other leg.
  const placed: LegoProject = {
    ...inserted.project,
    pieces: inserted.project.pieces.map((piece) =>
      piece.id === inserted.rootPieceId
        ? {
            ...piece,
            position: source.position,
            rotation: source.rotation,
            scale: source.scale,
          }
        : piece,
    ),
  };

  return {
    project: mirrorPiece(placed, inserted.rootPieceId),
    pieceId: inserted.rootPieceId,
  };
}
