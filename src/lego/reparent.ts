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

import { freePiece } from "./connectors";
import { joinedWorld } from "./joinedWorld";
import {
  childrenOf,
  descendantIds,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import { MIN_SCREEN_THRESHOLD } from "./snapping";

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

/**
 * Whether a piece is drawn and baked as joined to its parent: it has a join
 * and a parent to be joined to. A joined piece keeps its own size, which
 * `joinedWorld` decides (#3292).
 */
export function isJoined(project: LegoProject, piece: LegoPiece): boolean {
  return (
    piece.connection !== undefined &&
    piece.parentId !== null &&
    pieceById(project, piece.parentId) !== undefined
  );
}

/**
 * Where a piece sits in the unit, with every ancestor's transform applied. A
 * joined piece takes its parent's turn and place but not its scale, the same
 * as the scene and the bake draw it.
 */
export function worldMatrix(
  project: LegoProject,
  pieceId: string,
): THREE.Matrix4 {
  // A malformed document can have a parent loop, and this walk is the first
  // thing that would hang on one.
  const seen = new Set<string>();
  const chain: LegoPiece[] = [];
  let piece = pieceById(project, pieceId);
  while (piece && !seen.has(piece.id)) {
    seen.add(piece.id);
    chain.push(piece);
    piece = piece.parentId ? pieceById(project, piece.parentId) : undefined;
  }

  let world = new THREE.Matrix4();
  for (const link of chain.reverse()) {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...link.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...link.rotation)),
      new THREE.Vector3(...link.scale),
    );
    world = isJoined(project, link)
      ? joinedWorld(world, local)
      : world.multiply(local);
  }
  return world;
}

/**
 * The local matrix that puts a piece at `world` under `parentId`, the inverse
 * of what `worldMatrix` does for that piece. `joined` says whether the piece
 * will be joined to the parent, which changes how the parent's scale is read.
 */
export function localFromWorld(
  project: LegoProject,
  parentId: string | null,
  world: THREE.Matrix4,
  joined: boolean,
): THREE.Matrix4 {
  const parentWorld = parentId
    ? worldMatrix(project, parentId)
    : new THREE.Matrix4();
  const inverse = parentWorld.clone().invert();
  if (!joined) return inverse.multiply(world);

  const turn = new THREE.Quaternion();
  parentWorld.decompose(new THREE.Vector3(), turn, new THREE.Vector3());
  const local = new THREE.Matrix4()
    .makeRotationFromQuaternion(turn.invert())
    .multiply(world);
  local.setPosition(
    new THREE.Vector3().setFromMatrixPosition(world).applyMatrix4(inverse),
  );
  return local;
}

/**
 * How close two points have to be to count as the same place.
 *
 * The snap's own floor: the tightest a seat ever gets, however far the camera
 * is pulled back. Two points this builder would already snap together are two
 * points these answers treat as one.
 */
export const SAME_PLACE = MIN_SCREEN_THRESHOLD;

/**
 * The four points a frame is compared by: its origin and the tip of each axis.
 *
 * Comparing where a frame puts these, rather than its sixteen numbers, asks the
 * question in world units throughout, so one threshold covers position,
 * rotation and scale at once and a left-handed frame never passes for a
 * right-handed one.
 */
const PROBES = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

/** Whether two frames stand in the same place, the same way round, the same
 *  size. */
export function framesAgree(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  return PROBES.every(
    (probe) =>
      probe.clone().applyMatrix4(a).distanceTo(probe.clone().applyMatrix4(b)) <=
      SAME_PLACE,
  );
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

/**
 * The piece hangs off `parentId`, in the same place it was before.
 *
 * It lands free. `willJoin` is for a caller that joins it straight away: the
 * new parent's scale is then left out of its transform, as a join leaves it
 * out of the drawing.
 */
export function reparentPiece(
  project: LegoProject,
  pieceId: string,
  parentId: string,
  willJoin = false,
): LegoProject {
  if (!canReparent(project, pieceId, parentId)) return project;

  const local = localFromWorld(
    project,
    parentId,
    worldMatrix(project, pieceId),
    willJoin,
  );

  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  local.decompose(position, rotation, scale);
  const euler = new THREE.Euler().setFromQuaternion(rotation);
  const leaving = leavesInstance(project, pieceId, parentId);

  return {
    ...project,
    pieces: project.pieces.map((piece) => {
      const moved: LegoPiece =
        piece.id === pieceId
          ? {
              // Its join was to the old parent's part, so it lands free. A body
              // plan places a bone against its own parent bone, so it leaves
              // the plan too (#3246).
              ...(piece.parentId === parentId
                ? freePiece(piece)
                : withoutBone(freePiece(piece))),
              parentId,
              position: [position.x, position.y, position.z],
              rotation: [euler.x, euler.y, euler.z],
              scale: [scale.x, scale.y, scale.z],
            }
          : piece;
      if (!leaving.has(moved.id)) return moved;
      const { module: _left, ...rest } = moved;
      return rest;
    }),
  };
}

function withoutBone(piece: LegoPiece): LegoPiece {
  const { bone: _left, ...rest } = piece;
  return rest;
}

/**
 * The pieces that stop being part of their module instance when `pieceId` moves
 * to `parentId` (#3302): the piece and those under it in the same instance,
 * when it was inside the instance and the new parent is not. Moving the
 * instance's own top piece takes the whole instance along, so nothing leaves.
 */
function leavesInstance(
  project: LegoProject,
  pieceId: string,
  parentId: string,
): Set<string> {
  const piece = pieceById(project, pieceId);
  const instance = piece?.module?.instance;
  if (!piece || !instance) return new Set();
  const inside = (id: string | null) =>
    !!id && pieceById(project, id)?.module?.instance === instance;
  if (!inside(piece.parentId) || inside(parentId)) return new Set();
  return new Set(
    descendantIds(project, pieceId).filter(
      (id) => pieceById(project, id)?.module?.instance === instance,
    ),
  );
}
