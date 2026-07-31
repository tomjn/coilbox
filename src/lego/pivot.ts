/**
 * Where a piece turns.
 *
 * A piece's origin is the point its offset measures to, the point its children
 * hang from, and the point animation turns it about. In the format that origin
 * is wherever the modeller left the vertices relative to it, so a thigh can
 * pivot at the hip.
 *
 * Parts arrive recentred on their own bounding box, so a piece's origin starts
 * at the middle of its part and every joint would turn like a propeller.
 * `pivot` moves the geometry within the piece to fix that, and is expressed in
 * the part's own space, before the piece's rotation and scale.
 */

import * as THREE from "three";

import { childrenOf, type LegoProject, pieceById } from "./model";
import type { LegoPartInfo } from "./pack";
import type { Vec3 } from "./snapping";

export interface PivotChoice {
  id: string;
  label: string;
  position: Vec3;
}

/**
 * The places worth putting an origin: the middle, and the middle of each face.
 *
 * Corners are offered by snapping, which is about seating two parts together.
 * A joint turns about a face or the middle, so those are what this lists.
 */
export function pivotChoices(part: LegoPartInfo): PivotChoice[] {
  const { min, max } = part.bbox;
  const mid: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];

  return [
    { id: "middle", label: "Middle", position: mid },
    { id: "top", label: "Top", position: [mid[0], max[1], mid[2]] },
    { id: "bottom", label: "Bottom", position: [mid[0], min[1], mid[2]] },
    { id: "left", label: "Left", position: [min[0], mid[1], mid[2]] },
    { id: "right", label: "Right", position: [max[0], mid[1], mid[2]] },
    { id: "back", label: "Back", position: [mid[0], mid[1], min[2]] },
    { id: "front", label: "Front", position: [mid[0], mid[1], max[2]] },
  ];
}

/** Which choice a piece's pivot currently sits on, if any. */
export function currentPivot(
  part: LegoPartInfo,
  pivot: Vec3 | undefined,
): string | null {
  const at = pivot ?? [0, 0, 0];
  const match = pivotChoices(part).find((choice) =>
    choice.position.every((value, axis) => Math.abs(value - at[axis]) < 1e-4),
  );
  return match?.id ?? null;
}

/**
 * Seat a piece's mesh inside its group.
 *
 * The mesh sits back from the piece's origin by the pivot, so the origin is the
 * point the piece turns about rather than the part's middle. Every surface that
 * draws a piece has to do this, and the compound previews once did not, so they
 * drew a pivoted part displaced by its own pivot. One function, so the viewport
 * and the previews cannot disagree about it again.
 */
export function seatPieceMesh(mesh: THREE.Object3D, pivot: Vec3 | undefined) {
  const at = pivot ?? [0, 0, 0];
  mesh.position.set(-at[0], -at[1], -at[2]);
}

/**
 * Move a piece's origin without moving anything on screen.
 *
 * Shifting the origin by `d` would drag the geometry the other way, so the
 * piece's own position takes `d` back, turned and scaled into the parent's
 * frame. Children hang off the origin, so they take a plain `-d`: their offsets
 * are already in this piece's space.
 */
export function setPivot(
  project: LegoProject,
  pieceId: string,
  pivot: Vec3,
): LegoProject {
  const piece = pieceById(project, pieceId);
  if (!piece) return project;

  const was = piece.pivot ?? [0, 0, 0];
  const delta: Vec3 = [pivot[0] - was[0], pivot[1] - was[1], pivot[2] - was[2]];
  if (delta.every((value) => value === 0)) return project;

  // The piece's own rotation and scale sit between its position and its part,
  // so the compensation has to go through them.
  const moved = new THREE.Vector3(...delta).applyMatrix3(
    new THREE.Matrix3().setFromMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...piece.rotation)),
        new THREE.Vector3(...piece.scale),
      ),
    ),
  );

  const children = new Set(
    childrenOf(project, pieceId).map((child) => child.id),
  );

  return {
    ...project,
    pieces: project.pieces.map((other) => {
      if (other.id === pieceId) {
        return {
          ...other,
          pivot,
          position: [
            other.position[0] + moved.x,
            other.position[1] + moved.y,
            other.position[2] + moved.z,
          ] as Vec3,
        };
      }
      if (!children.has(other.id)) return other;
      return {
        ...other,
        position: [
          other.position[0] - delta[0],
          other.position[1] - delta[1],
          other.position[2] - delta[2],
        ] as Vec3,
      };
    }),
  };
}
