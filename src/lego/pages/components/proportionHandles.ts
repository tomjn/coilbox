/**
 * Drag handles for a skeleton's proportions (issue #3253).
 *
 * A handle is a dot on the joint that a length moves most directly: the top of
 * a leg for leg length, a foot for stance. It is picked by its distance on
 * screen rather than by a raycast, so it is as easy to grab at any zoom and in
 * either kind of camera. Dragging follows the pointer along the joint's axis,
 * and the value changes by the distance moved over the handle's gain.
 */

import * as THREE from "three";
import type { ProportionHandle } from "../../skeletonEdit";

/** How close to a handle, in pixels, a press has to land to grab it. */
export const GRAB_RADIUS = 12;

/** Amber, apart from the fuchsia skeleton lines it sits on. */
export const HANDLE_COLOUR = 0xfbbf24;

/** The handle nearest to the pointer within `GRAB_RADIUS`, or null. */
export function handleUnderPointer(
  handles: ProportionHandle[],
  camera: THREE.Camera,
  size: { width: number; height: number },
  pointer: { x: number; y: number },
): ProportionHandle | null {
  let best: ProportionHandle | null = null;
  let bestDistance = GRAB_RADIUS;
  for (const handle of handles) {
    const ndc = new THREE.Vector3(...handle.at).project(camera);
    if (ndc.z < -1 || ndc.z > 1) continue;
    const distance = Math.hypot(
      ((ndc.x + 1) / 2) * size.width - pointer.x,
      ((1 - ndc.y) / 2) * size.height - pointer.y,
    );
    if (distance <= bestDistance) {
      best = handle;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * How far along the handle's axis the pointer is, as the point on the axis
 * nearest to the pointer's ray. Null when the ray runs along the axis, which
 * gives no answer.
 */
export function alongAxis(
  ray: THREE.Ray,
  origin: THREE.Vector3,
  axis: 0 | 1 | 2,
): number | null {
  const direction = new THREE.Vector3().setComponent(axis, 1);
  const between = origin.clone().sub(ray.origin);
  const b = direction.dot(ray.direction);
  const denominator = 1 - b * b;
  if (denominator < 1e-6) return null;
  const d = direction.dot(between.clone().negate());
  const e = ray.direction.dot(between.clone().negate());
  // Closest points of two lines, a on the axis and the ray's own.
  return (d - b * e) / denominator;
}

/** The value a handle takes when the pointer has moved `moved` along its axis. */
export function valueAfterDrag(
  handle: ProportionHandle,
  moved: number,
): number {
  return handle.value + moved / handle.gain;
}
