/**
 * The three.js rotations the generator uses, turned with `portableSin`,
 * `portableCos` and `portableAtan2` instead of the engine's (#5113).
 *
 * three.js calls `Math.sin`, `Math.cos`, `Math.asin` and `Math.atan2` inside
 * `Euler`, `Quaternion.setFromEuler` and `Vector3.applyAxisAngle`, and the
 * engines differ in the last bit of each, so a unit generated in the macOS app
 * could differ from one generated in the Windows app. Each function here follows
 * the three.js one it replaces, XYZ order throughout, and takes its angles from
 * `portableAngles.ts`. Everything else in three.js that the generator calls uses
 * only `+ - * /` and `Math.sqrt`, which every engine computes the same.
 */

import * as THREE from "three";
import { portableCos, portableEuler, portableSin } from "./portableAngles";

/** Euler angles in radians, XYZ order, as `LegoPiece.rotation` holds them. */
export type Turn = readonly [number, number, number];

/** What `new THREE.Quaternion().setFromEuler(new THREE.Euler(...turn))` gives. */
export function quaternionFromEuler([x, y, z]: Turn): THREE.Quaternion {
  const c1 = portableCos(x / 2);
  const c2 = portableCos(y / 2);
  const c3 = portableCos(z / 2);
  const s1 = portableSin(x / 2);
  const s2 = portableSin(y / 2);
  const s3 = portableSin(z / 2);
  return new THREE.Quaternion(
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  );
}

/** What `new THREE.Euler().setFromRotationMatrix(matrix)` gives. */
export function eulerFromMatrix(
  matrix: THREE.Matrix4,
): [number, number, number] {
  const e = matrix.elements as number[];
  return portableEuler(
    { x: e[0] as number, y: e[1] as number, z: e[2] as number },
    { x: e[4] as number, y: e[5] as number, z: e[6] as number },
    { x: e[8] as number, y: e[9] as number, z: e[10] as number },
  );
}

/** What `new THREE.Euler().setFromQuaternion(quaternion)` gives. */
export function eulerFromQuaternion(
  quaternion: THREE.Quaternion,
): [number, number, number] {
  return eulerFromMatrix(
    new THREE.Matrix4().makeRotationFromQuaternion(quaternion),
  );
}

/** What `vector.applyEuler(new THREE.Euler(...turn))` does. */
export function applyEuler(vector: THREE.Vector3, turn: Turn): THREE.Vector3 {
  return vector.applyQuaternion(quaternionFromEuler(turn));
}

/** What `vector.applyAxisAngle(axis, angle)` does, for a unit `axis`. */
export function applyAxisAngle(
  vector: THREE.Vector3,
  axis: THREE.Vector3,
  angle: number,
): THREE.Vector3 {
  const half = angle / 2;
  const s = portableSin(half);
  return vector.applyQuaternion(
    new THREE.Quaternion(axis.x * s, axis.y * s, axis.z * s, portableCos(half)),
  );
}
