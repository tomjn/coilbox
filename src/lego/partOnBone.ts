/**
 * Adding a part to a bone of a skeleton (#3256).
 *
 * A bone is an empty piece whose origin is a joint, and it points at its first
 * child bone. A part added to it should lie along that line with one end on the
 * joint, so a thigh hangs from the hip toward the knee and turns about the hip.
 * The part keeps its own size: if it is shorter or longer than the bone, the
 * difference shows and is the game maker's to judge.
 */

import * as THREE from "three";

import { asTransform } from "./mirror";
import {
  childrenOf,
  type LegoPiece,
  type LegoProject,
  pieceById,
  uniquePieceName,
} from "./model";
import type { LegoPartInfo } from "./pack";
import { pivotChoices } from "./pivot";
import type { Vec3 } from "./snapping";

/**
 * Where a bone points, in the bone's own frame: toward its first child bone
 * that is not on top of it. Null when the bone has none, such as a foot.
 */
export function boneDirection(
  project: LegoProject,
  boneId: string,
): THREE.Vector3 | null {
  for (const child of childrenOf(project, boneId)) {
    if (child.bone === undefined) continue;
    const toward = new THREE.Vector3(...child.position);
    if (toward.lengthSq() > 1e-12) return toward.normalize();
  }
  return null;
}

/**
 * The axis a part is longest along, as 0, 1 or 2. On a tie the height wins,
 * then the depth, so a cube stands up the way it would on a hull.
 */
function longestAxis(part: Pick<LegoPartInfo, "bbox">): 0 | 1 | 2 {
  const size = part.bbox.max.map((max, i) => max - part.bbox.min[i]);
  let best: 0 | 1 | 2 = 1;
  for (const axis of [2, 0] as const) {
    if (size[axis] > size[best] + 1e-9) best = axis;
  }
  return best;
}

/**
 * The document with `part` added as a child of the bone, as `pieceId`, lying
 * along the bone with its near end on the joint. The bone's own origin stays
 * the joint: the piece sits at it, turned so the part's long axis runs to the
 * child bone, with its pivot on the face nearest the joint so it turns there.
 *
 * Null when `boneId` is not a bone, so the caller adds the part the old way. A
 * bone with no child bone to point at gets the part unturned and unpivoted.
 */
export function attachToBone(
  project: LegoProject,
  part: LegoPartInfo,
  boneId: string,
  pieceId: string,
): LegoProject | null {
  const bone = pieceById(project, boneId);
  if (!bone || bone.bone === undefined) return null;

  const piece: LegoPiece = {
    id: pieceId,
    name: uniquePieceName(
      part.shape,
      project.pieces.map((p) => p.name),
    ),
    parentId: boneId,
    partId: part.id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };

  const direction = boneDirection(project, boneId);
  if (direction) {
    const axis = longestAxis(part);
    const along = new THREE.Vector3();
    along.setComponent(axis, 1);
    const { rotation } = asTransform(
      new THREE.Matrix4().makeRotationFromQuaternion(
        new THREE.Quaternion().setFromUnitVectors(along, direction),
      ),
    );
    // The face on the low side of the long axis is the one that meets the joint,
    // because the part's +axis is the one turned toward the child bone.
    const near = pivotChoices(part).find(
      (choice) => choice.id === ["left", "bottom", "back"][axis],
    );
    piece.rotation = rotation;
    if (near) piece.pivot = [...near.position] as Vec3;
  }
  return { ...project, pieces: [...project.pieces, piece] };
}
