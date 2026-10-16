/**
 * Dragging the stand-in across the ground, for a scenario whose target the
 * game maker can move.
 *
 * The drag only moves the shape. Where it is let go goes to the panel, which
 * works out a new track from there and runs the script again with it, because
 * what the weapon is told about its target has to exist before the run.
 */

import * as THREE from "three";
import { NOSE_REACH, onGround, STAND_IN_MID_Y } from "../../standIn";
import type { SceneState } from "./sceneState";

const CENTRE = new THREE.Vector3();
const SPHERE = new THREE.Sphere();
const PLANE = new THREE.Plane();
const UP = new THREE.Vector3(0, 1, 0);
const HIT = new THREE.Vector3();

/**
 * Start a drag when the ray passes through the stand-in, and say whether it
 * did.
 *
 * Tested against a sphere round the shape rather than its faces, because the
 * mesh opts out of raycasts so a click on it never selects a piece. The
 * sphere reaches the tip of the nose, the furthest the shape goes from its
 * middle.
 */
export function grabStandIn(
  state: SceneState,
  raycaster: THREE.Raycaster,
): boolean {
  if (!state.standIn.visible || !state.onStandInDragRef.current) return false;
  const radius = state.standInRadius;
  CENTRE.copy(state.standIn.position);
  CENTRE.y += STAND_IN_MID_Y * radius;
  SPHERE.set(CENTRE, radius * NOSE_REACH);
  if (!raycaster.ray.intersectsSphere(SPHERE)) return false;
  state.standInDrag = { y: state.standIn.position.y };
  state.controls.enabled = false;
  return true;
}

/** Put the stand-in where the ray meets the level it was picked up at, then
 *  on the ground there. A ray that misses that level leaves it where it is. */
export function moveStandIn(state: SceneState, raycaster: THREE.Raycaster) {
  const drag = state.standInDrag;
  if (!drag) return;
  PLANE.set(UP, -drag.y);
  if (!raycaster.ray.intersectPlane(PLANE, HIT)) return;
  state.standIn.position.set(...onGround(state.groundShape, [HIT.x, 0, HIT.z]));
  state.render();
}

/** End the drag and say where it ended. */
export function letGoOfStandIn(state: SceneState) {
  if (!state.standInDrag) return;
  state.standInDrag = null;
  state.standInHeld = true;
  state.controls.enabled = true;
  const { x, z } = state.standIn.position;
  state.onStandInDragRef.current?.([x, z]);
}
