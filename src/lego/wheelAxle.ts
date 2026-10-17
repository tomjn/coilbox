/**
 * Turning a cylinder wheel about its own axle (#3338).
 *
 * The wheel preset spins a piece about x, the one axis the engine spins a baked
 * piece about whatever the piece's own rotation is: rotation is baked into the
 * vertices, so `Spin(wheel, x_axis)` is about the unit's x axis through the
 * piece's origin. A cylinder runs along the axis in its `axis` option, y by
 * default, so it only turns about its axle if the piece is turned to put the
 * axle on x and its origin is on the axle.
 *
 * This does that through the piece's pivot and rotation when a cylinder gets
 * the wheel role or is hung under a wheel bone. The preset stays as it is.
 */

import * as THREE from "three";

import {
  childrenOf,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import { setPivot } from "./pivot";
import { worldMatrix } from "./reparent";
import type { Vec3 } from "./snapping";

/** The axis the unit script spins a wheel about, x. */
const SPIN_AXIS = 0;

/**
 * The axis a cylinder runs along, or null for a piece that is not a cylinder.
 * Read the way the cylinder generator reads it: 0, 1 or 2, else y.
 */
function cylinderAxle(piece: LegoPiece): 0 | 1 | 2 | null {
  if (piece.shape?.kind !== "cylinder") return null;
  const axis = piece.shape.options?.axis;
  return axis === 0 || axis === 1 || axis === 2 ? axis : 1;
}

/** The nearest piece from `piece` upwards, itself included, with the wheel role. */
function spinnerOf(project: LegoProject, piece: LegoPiece): LegoPiece | null {
  const seen = new Set<string>();
  let at: LegoPiece | undefined = piece;
  while (at && !seen.has(at.id)) {
    if (at.role === "wheel") return at;
    seen.add(at.id);
    at = at.parentId ? pieceById(project, at.parentId) : undefined;
  }
  return null;
}

/**
 * The project with a cylinder turned so that it spins about its axle when the
 * wheel above it (or it, when it is the wheel) spins about x. Its origin is
 * also moved onto the axle without moving the shape, keeping any slide along
 * it. A turn the piece already has about the axle is kept.
 *
 * The same project when the piece is not a cylinder, has no wheel at or above
 * it, or is already right.
 */
export function turnWheelAxleToSpin(
  project: LegoProject,
  pieceId: string,
): LegoProject {
  const first = pieceById(project, pieceId);
  if (!first) return project;
  const axle = cylinderAxle(first);
  if (axle === null || !spinnerOf(project, first)) return project;

  // Origin onto the axle. The cylinder is centred on its box, so no pivot
  // already is.
  let next = project;
  const at = first.pivot ?? [0, 0, 0];
  const onAxle: Vec3 = [0, 0, 0];
  onAxle[axle] = at[axle];
  if (at.some((value, i) => value !== onAxle[i])) {
    next = setPivot(next, pieceId, onAxle);
  }

  const piece = pieceById(next, pieceId) as LegoPiece;
  const parent = piece.parentId
    ? worldMatrix(next, piece.parentId)
    : new THREE.Matrix4();
  const parentTurn = new THREE.Quaternion();
  parent.decompose(new THREE.Vector3(), parentTurn, new THREE.Vector3());

  // Both in the parent's frame: where the axle points now, and the spin axis.
  const turn = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...piece.rotation),
  );
  const axleNow = new THREE.Vector3()
    .setComponent(axle, 1)
    .applyQuaternion(turn);
  const spin = new THREE.Vector3()
    .setComponent(SPIN_AXIS, 1)
    .applyQuaternion(parentTurn.clone().invert());
  // Either end of the axle will do, so take the nearer and turn the least.
  if (axleNow.dot(spin) < 0) spin.negate();
  if (axleNow.distanceTo(spin) < 1e-9) return next;

  const aligned = new THREE.Quaternion()
    .setFromUnitVectors(axleNow, spin)
    .multiply(turn);
  const euler = new THREE.Euler().setFromQuaternion(aligned);
  return {
    ...next,
    pieces: next.pieces.map((p) =>
      p.id === pieceId
        ? { ...p, rotation: [euler.x, euler.y, euler.z] as Vec3 }
        : p,
    ),
  };
}

/**
 * The project with a piece's role set, or dropped when `role` is undefined.
 * Giving the wheel role to a piece also turns every cylinder at or under it to
 * spin about its axle.
 */
export function setPieceRole(
  project: LegoProject,
  pieceId: string,
  role: string | undefined,
): LegoProject {
  let next: LegoProject = {
    ...project,
    pieces: project.pieces.map((piece) => {
      if (piece.id !== pieceId) return piece;
      const { role: _dropped, ...rest } = piece;
      return role ? { ...rest, role } : rest;
    }),
  };
  if (role !== "wheel") return next;

  const visit = (id: string) => {
    next = turnWheelAxleToSpin(next, id);
    for (const child of childrenOf(next, id)) visit(child.id);
  };
  visit(pieceId);
  return next;
}
