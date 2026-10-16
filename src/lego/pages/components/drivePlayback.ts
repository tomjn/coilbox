/**
 * Moving the whole unit along its drive while a drive plays, and putting it
 * back afterwards.
 *
 * Everything that edits the unit assumes it stands at the origin: picking, the
 * gizmo, snapping and framing all measure from there. So the root moves only
 * while a drive plays, the gizmo is already off then, and stopping puts the
 * root and the camera back where they were, the way `restoreFromPlayback`
 * puts the pieces back.
 */

import * as THREE from "three";
import { type DriveFrame, headingRadians } from "../../drive";
import type { GroundShape } from "../../environment";
import { onGround } from "../../standIn";
import type { SceneState } from "./sceneState";

const UP = new THREE.Vector3(0, 1, 0);
const NORMAL = new THREE.Vector3();
const YAW = new THREE.Quaternion();
const TILT = new THREE.Quaternion();
const DELTA = new THREE.Vector3();
const PLANE = new THREE.Plane(UP, 0);
const HIT = new THREE.Vector3();

/** The path line, drawn just above the ground so it does not flicker into it. */
const PATH_LIFT = 0.5;
/** Elmos between the points the line is drawn through, so it follows bumps. */
const PATH_STEP = 4;
const PATH_COLOUR = 0xfbbf24;

/** The drive's pose on `frame`, the last one past its end, or null when
 *  nothing drives the unit. */
function poseOn(state: SceneState, frame: number): DriveFrame | null {
  const frames = state.drive;
  if (!frames || frames.length === 0) return null;
  return frames[Math.min(Math.max(frame, 0), frames.length - 1)];
}

/**
 * Put the overlay group where the unit is. The collision volume, the piece
 * boxes, their handles and the aim point live in it, so they are drawn on the
 * unit while it drives or tilts, and at the origin the rest of the time.
 */
export function syncOverlay(state: Pick<SceneState, "root" | "overlay">) {
  state.overlay.position.copy(state.root.position);
  state.overlay.quaternion.copy(state.root.quaternion);
}

/**
 * Say which drive is playing, or that none is. Ending one puts the unit and
 * the camera back, which a scenario switched mid-playback needs as much as a
 * stop does.
 */
export function setDrive(state: SceneState, frames: DriveFrame[] | null) {
  if (state.drive && !frames) restoreFromDrive(state);
  state.drive = frames;
}

/**
 * Put the unit where its drive has it on `frame`: turned by its heading about
 * straight up first, then tilted to the ground there, which is the engine's
 * order (`CSolidObject::UpdateDirVectors`, `SolidObject.cpp:435-451`). With no
 * drive it is left standing where it is, at the origin.
 */
export function poseRoot(state: SceneState, frame: number) {
  const pose = poseOn(state, frame);
  if (!pose) return;
  state.root.position.set(...pose.pos);
  YAW.setFromAxisAngle(UP, headingRadians(pose.heading));
  if (pose.up) TILT.setFromUnitVectors(UP, NORMAL.set(...pose.up));
  else TILT.identity();
  state.root.quaternion.multiplyQuaternions(TILT, YAW);
  syncOverlay(state);
}

/**
 * Keep the camera on a driving unit, by moving it and its target by however
 * far the unit moved since the last call. A camera that has stopped following
 * stays where it is.
 */
export function followCamera(state: SceneState) {
  if (!state.drive) return;
  if (!state.follow) {
    state.followAt = null;
    return;
  }
  // Picking up again starts from where following last left the camera, so
  // the unit comes back to where it sat in view.
  state.followAt ??= state.followOffset.clone();
  DELTA.subVectors(state.root.position, state.followAt);
  if (DELTA.lengthSq() === 0) return;
  state.camera.position.add(DELTA);
  state.controls.target.add(DELTA);
  state.followOffset.add(DELTA);
  state.followAt.copy(state.root.position);
  state.controls.update();
}

/** Undo whatever following did to the camera. */
function returnCamera(state: SceneState) {
  state.followAt = null;
  if (state.followOffset.lengthSq() === 0) return;
  state.camera.position.sub(state.followOffset);
  state.controls.target.sub(state.followOffset);
  state.followOffset.set(0, 0, 0);
  state.controls.update();
}

/** Put the unit and the camera back where they were before a drive. Nothing
 *  to do when no drive is playing. */
export function restoreFromDrive(state: SceneState) {
  if (!state.drive) return;
  state.drive = null;
  state.root.position.set(0, 0, 0);
  state.root.quaternion.copy(state.restTilt);
  syncOverlay(state);
  returnCamera(state);
}

/**
 * Draw the path a drive follows on the ground, from where the unit starts
 * through every waypoint, with a dot on each waypoint when `dots` says so.
 * A fixed circle has a waypoint every few elmos, which reads as noise rather
 * than as points somebody put there. An empty path draws nothing.
 */
export function drawDrivePath(
  state: Pick<SceneState, "drivePath">,
  path: [number, number][] | null,
  ground: GroundShape | null,
  dots = true,
) {
  const group = state.drivePath;
  for (const child of [...group.children]) {
    child.removeFromParent();
    if (child instanceof THREE.Line || child instanceof THREE.Points) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }
  group.visible = !!path && path.length > 0;
  if (!path || path.length === 0) return;

  const lifted = (x: number, z: number) => {
    const [px, py, pz] = onGround(ground, [x, PATH_LIFT, z]);
    return new THREE.Vector3(px, py, pz);
  };
  const line: THREE.Vector3[] = [];
  let from: [number, number] = [0, 0];
  for (const to of path) {
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / PATH_STEP),
    );
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      line.push(
        lifted(
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
        ),
      );
    }
    from = to;
  }
  line.push(lifted(from[0], from[1]));

  group.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(line),
      new THREE.LineBasicMaterial({ color: PATH_COLOUR }),
    ),
  );
  if (!dots) return;
  group.add(
    new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(
        path.map(([x, z]) => lifted(x, z)),
      ),
      new THREE.PointsMaterial({
        color: PATH_COLOUR,
        size: 8,
        sizeAttenuation: false,
      }),
    ),
  );
}

/** Where a ray meets the ground the view draws, x and z in elmos, or null for
 *  a ray that misses it. */
export function pickGround(
  state: Pick<SceneState, "groundShape" | "shaped">,
  raycaster: THREE.Raycaster,
): [number, number] | null {
  if (state.groundShape && state.shaped) {
    const hit = raycaster.intersectObject(state.shaped, false)[0];
    return hit ? [hit.point.x, hit.point.z] : null;
  }
  if (!raycaster.ray.intersectPlane(PLANE, HIT)) return null;
  return [HIT.x, HIT.z];
}
