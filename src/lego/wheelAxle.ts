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

import { select } from "@lingui/core/macro";
import * as THREE from "three";

import {
  childrenOf,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import { setPivot } from "./pivot";
import { type Problem, problem } from "./problems";
import { worldMatrix } from "./reparent";
import { isRoundShapeKind, type LegoShape } from "./shapes";
import type { Vec3 } from "./snapping";

/** The axis the unit script spins a wheel about, x. */
const SPIN_AXIS = 0;

/**
 * The axis a cylinder or tube runs along, or null for any other piece. Read the
 * way the generators read it: 0, 1 or 2, else y.
 */
export function cylinderAxle(piece: LegoPiece): 0 | 1 | 2 | null {
  if (!piece.shape || !isRoundShapeKind(piece.shape.kind)) return null;
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

/**
 * The project with a new shape piece added, and turned to spin about its axle
 * when it lands at or under a wheel. Every way of adding a cylinder or tube
 * goes through this.
 */
export function addShapePiece(
  project: LegoProject,
  piece: LegoPiece,
): LegoProject {
  return turnWheelAxleToSpin(
    { ...project, pieces: [...project.pieces, piece] },
    piece.id,
  );
}

/**
 * The project with a piece's shape replaced, and its axle turned back onto the
 * spin axis when it sits at or under a wheel, so changing the axis of a wheel
 * does not leave it turning end over end.
 */
export function setPieceShape(
  project: LegoProject,
  pieceId: string,
  shape: LegoShape,
): LegoProject {
  return turnWheelAxleToSpin(
    {
      ...project,
      pieces: project.pieces.map((piece) =>
        piece.id === pieceId ? { ...piece, shape } : piece,
      ),
    },
    pieceId,
  );
}

const AXIS_NAMES = ["x", "y", "z"];

/**
 * A warning for each cylinder or tube at or under a wheel whose axle is not
 * along x, which is what the wheel spins about. It happens when the piece is
 * turned by hand, or an ancestor is.
 */
export function wheelAxleProblems(project: LegoProject): Problem[] {
  const found: Problem[] = [];
  for (const piece of project.pieces) {
    const axle = cylinderAxle(piece);
    if (axle === null) continue;
    const spinner = spinnerOf(project, piece);
    if (!spinner) continue;
    const along = new THREE.Vector3()
      .setComponent(axle, 1)
      .transformDirection(worldMatrix(project, piece.id));
    if (Math.abs(Math.abs(along.getComponent(SPIN_AXIS)) - 1) < 1e-4) continue;
    const nearest = [0, 1, 2].reduce((best, i) =>
      Math.abs(along.getComponent(i)) > Math.abs(along.getComponent(best))
        ? i
        : best,
    );
    const lies =
      Math.abs(Math.abs(along.getComponent(nearest)) - 1) < 1e-4
        ? AXIS_NAMES[nearest]
        : "slanted";
    const pieceName = piece.name;
    const spinnerName = spinner.name;
    found.push(
      problem(
        "skeleton",
        "warning",
        spinner.id === piece.id
          ? select(lies, {
              x: `"${pieceName}" turns about x but its axle is along x.`,
              y: `"${pieceName}" turns about x but its axle is along y.`,
              z: `"${pieceName}" turns about x but its axle is along z.`,
              other: `"${pieceName}" turns about x but its axle is slanted.`,
            })
          : select(lies, {
              x: `"${spinnerName}" turns about x but "${pieceName}" has its axle along x.`,
              y: `"${spinnerName}" turns about x but "${pieceName}" has its axle along y.`,
              z: `"${spinnerName}" turns about x but "${pieceName}" has its axle along z.`,
              other: `"${spinnerName}" turns about x but "${pieceName}" has its axle slanted.`,
            }),
        [piece.id],
      ),
    );
  }
  return found;
}
