/**
 * Moving, turning and scaling several pieces at once.
 *
 * A single piece is dragged by writing straight to its own transform. A set
 * cannot be: the pieces have different parents, and turning each about its own
 * origin would throw them apart. So the gesture is expressed once, in world
 * space and about the set's midpoint, and every piece's own transform is
 * worked out from it. Nothing is reparented and no shared carrier is invented,
 * which is what the issue asks for: the transform lands on each piece.
 *
 * Pure, and separate from the viewport for the same reason `reparent.ts` is:
 * this is the matrix maths, and it is testable without a renderer. The
 * viewport hands over a delta read off the gizmo and applies the answer to the
 * scene, both mid-drag and on commit, so what is drawn is what gets saved.
 */

import * as THREE from "three";

import { descendantIds, type LegoPiece, type LegoProject } from "./model";
import { worldMatrix } from "./reparent";
import type { Vec3 } from "./snapping";

/**
 * One gesture on a set, in world space.
 *
 * The turn and the scale are both about the pivot, and the move is applied
 * after them, which is the order a gizmo produces them in.
 */
export interface GroupDelta {
  /** World-space translation. */
  position: Vec3;
  /** A turn about the pivot, XYZ euler in radians. */
  rotation: Vec3;
  /**
   * Uniform, about the pivot. Only one number, because a non-uniform scale
   * about a shared point shears any piece that is turned relative to it, and a
   * shear is not something a piece's position, rotation and scale can hold.
   */
  scale: number;
}

/** A piece's own transform, as the document stores it. */
export interface PieceTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export const NO_GROUP_DELTA: GroupDelta = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
};

/**
 * The pieces of a selection a group gesture actually writes to.
 *
 * Two of them are dropped. A piece with a selected ancestor is already carried
 * by that ancestor, so transforming it as well would move it twice. The root
 * is the unit rather than a piece within it, and nothing anywhere else in the
 * builder moves, mirrors, duplicates or deletes it either.
 *
 * Order follows the selection, so the answer is stable to compare against.
 */
export function transformRoots(
  project: LegoProject,
  selectedIds: string[],
): string[] {
  const candidates = selectedIds.filter(
    (id) => id !== project.rootPieceId && pieceIn(project, id),
  );
  const carried = new Set<string>();
  for (const id of candidates) {
    for (const child of descendantIds(project, id)) {
      if (child !== id) carried.add(child);
    }
  }
  return candidates.filter((id) => !carried.has(id));
}

function pieceIn(project: LegoProject, pieceId: string): LegoPiece | undefined {
  return project.pieces.find((piece) => piece.id === pieceId);
}

/**
 * The point a set turns and scales about: the average of its pieces' origins,
 * in world space.
 *
 * Origins rather than the corners of a bounding box, because an origin is
 * already the point a piece turns about, and averaging them needs nothing from
 * the parts library. Two legs put it exactly between them, which is what a
 * midpoint has to mean. Answers the world origin for an empty set, which no
 * gesture ever reaches.
 */
export function groupPivot(project: LegoProject, pieceIds: string[]): Vec3 {
  const point = new THREE.Vector3();
  const total = new THREE.Vector3();
  let counted = 0;
  for (const id of pieceIds) {
    if (!pieceIn(project, id)) continue;
    point.setFromMatrixPosition(worldMatrix(project, id));
    total.add(point);
    counted += 1;
  }
  if (counted === 0) return [0, 0, 0];
  total.divideScalar(counted);
  return [total.x, total.y, total.z];
}

/**
 * Every piece's new transform after `delta` is applied to the set about
 * `pivot`.
 *
 * Each piece's place in the unit is taken, moved by the delta in world space,
 * and written back against its parent, which has not moved. That is the same
 * round trip `reparentPiece` makes, for the same reason: the document stores
 * transforms relative to a parent, and a gesture is not.
 *
 * `pieceIds` is expected to be `transformRoots`, so a piece carried by another
 * in the set is not moved twice.
 */
export function groupTransform(
  project: LegoProject,
  pieceIds: string[],
  pivot: Vec3,
  delta: GroupDelta,
): Map<string, PieceTransform> {
  const move = new THREE.Matrix4()
    .makeTranslation(
      pivot[0] + delta.position[0],
      pivot[1] + delta.position[1],
      pivot[2] + delta.position[2],
    )
    .multiply(
      new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(...delta.rotation),
      ),
    )
    .multiply(new THREE.Matrix4().makeScale(...scaleTriple(delta.scale)))
    .multiply(
      new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]),
    );

  const out = new Map<string, PieceTransform>();
  for (const id of pieceIds) {
    const piece = pieceIn(project, id);
    if (!piece) continue;

    const parent = piece.parentId
      ? worldMatrix(project, piece.parentId)
      : new THREE.Matrix4();
    const local = parent
      .invert()
      .multiply(move.clone().multiply(worldMatrix(project, id)));

    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    local.decompose(position, rotation, scale);
    const euler = new THREE.Euler().setFromQuaternion(rotation);

    out.set(id, {
      position: [position.x, position.y, position.z],
      rotation: [euler.x, euler.y, euler.z],
      scale: [scale.x, scale.y, scale.z],
    });
  }
  return out;
}

/** Zero would collapse a piece to nothing it could ever be scaled back out of. */
function scaleTriple(scale: number): [number, number, number] {
  const safe = Math.abs(scale) < 1e-4 ? 1e-4 : scale;
  return [safe, safe, safe];
}

/** The same transforms, written into the document as one edit. */
export function applyGroupTransform(
  project: LegoProject,
  changes: Map<string, PieceTransform>,
): LegoProject {
  if (changes.size === 0) return project;
  return {
    ...project,
    pieces: project.pieces.map((piece) => {
      const change = changes.get(piece.id);
      return change ? { ...piece, ...change } : piece;
    }),
  };
}
