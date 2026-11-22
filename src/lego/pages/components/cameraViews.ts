import * as THREE from "three";

import {
  ORTHO_BASE_HEIGHT,
  orthoFitHeight,
  orthoVisibleHeight,
  orthoZoomLimits,
  STANDARD_VIEWS,
  type StandardView,
} from "../../orthoViews";
import type { SceneState } from "./sceneState";

/** How far the orbit may go over the top, in the perspective view. Not quite
 *  the horizon, so the ground never turns edge on. */
export const ORBIT_MAX_POLAR = Math.PI * 0.495;

/** A standard view is left when the camera has turned this far from it. Well
 *  under the turn a single pixel of drag makes. */
const LEAVE_RADIANS = 0.001;

/** Point the shared controls and gizmo at `camera`. */
export function use(state: SceneState, camera: SceneState["camera"]) {
  state.camera = camera;
  state.controls.object = camera;
  state.gizmo.camera = camera;
}

/** Give an orthographic camera a frustum of a fixed height and the width
 *  `aspect` asks for. Its zoom does the rest. */
export function sizeOrthographic(
  camera: THREE.OrthographicCamera,
  aspect: number,
) {
  camera.left = (-ORTHO_BASE_HEIGHT * aspect) / 2;
  camera.right = (ORTHO_BASE_HEIGHT * aspect) / 2;
  camera.top = ORTHO_BASE_HEIGHT / 2;
  camera.bottom = -ORTHO_BASE_HEIGHT / 2;
  camera.updateProjectionMatrix();
}

/** Size the cameras of the one view layout to the whole canvas. */
export function sizeCameras(state: SceneState, width: number, height: number) {
  state.perspectiveCamera.aspect = width / height;
  state.perspectiveCamera.updateProjectionMatrix();
  sizeOrthographic(state.orthographicCamera, width / height);
}

/** Give the orthographic camera the zoom range the orbit's distance limits
 *  give the perspective one, and the same far plane. */
export function syncOrthographicLimits(state: SceneState) {
  const { controls, perspectiveCamera, orthographicCamera } = state;
  const { minZoom, maxZoom } = orthoZoomLimits(
    THREE.MathUtils.degToRad(perspectiveCamera.fov),
    controls.minDistance,
    controls.maxDistance,
  );
  controls.minZoom = minZoom;
  controls.maxZoom = maxZoom;
  const quadrants = state.quad
    ? Object.values(state.quad.views).map((view) => view.camera)
    : [];
  for (const camera of [orthographicCamera, ...quadrants]) {
    if (!(camera instanceof THREE.OrthographicCamera)) continue;
    camera.far = perspectiveCamera.far;
    camera.zoom = THREE.MathUtils.clamp(camera.zoom, minZoom, maxZoom);
    camera.updateProjectionMatrix();
  }
}

/**
 * Put `camera` where it looks at `box` along one axis, and its orbit point,
 * `target`, in the middle of the box.
 *
 * The camera sits half the furthest orbit distance out, which is clear of
 * everything in the scene and inside its far plane. Distance does nothing to
 * the size of what is drawn, so zoom does the framing.
 */
export function fitOrthographic(
  camera: THREE.OrthographicCamera,
  target: THREE.Vector3,
  id: StandardView,
  box: THREE.Box3,
  controls: Pick<
    SceneState["controls"],
    "minZoom" | "maxZoom" | "minDistance" | "maxDistance"
  >,
) {
  const axes = STANDARD_VIEWS[id];
  const aspect = (camera.right - camera.left) / (camera.top - camera.bottom);
  const height = orthoFitHeight(
    {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    },
    axes,
    aspect,
  );
  box.getCenter(target);
  const distance = Math.max(controls.maxDistance / 2, controls.minDistance);
  camera.position
    .copy(target)
    .addScaledVector(new THREE.Vector3(...axes.toCamera).normalize(), distance);
  camera.lookAt(target);
  camera.zoom = THREE.MathUtils.clamp(
    ORTHO_BASE_HEIGHT / height,
    controls.minZoom,
    controls.maxZoom,
  );
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

/** Look at `box` along one axis through the orthographic camera. */
export function showStandardView(
  state: SceneState,
  id: StandardView,
  box: THREE.Box3,
) {
  const target = new THREE.Vector3();
  const placed = state.orthographicCamera.clone();
  fitOrthographic(placed, target, id, box, state.controls);
  enterStandardView(state, id, placed, target);
}

/**
 * Show one standard view through the orthographic camera, from where `from`
 * is and at its zoom, orbiting `target`. How a quadrant of the four view
 * layout is maximised without losing its pan and zoom.
 */
export function enterStandardView(
  state: SceneState,
  id: StandardView,
  from: THREE.OrthographicCamera,
  target: THREE.Vector3,
) {
  const { controls, orthographicCamera: ortho } = state;
  // Unset while the camera moves, so the update below is not mistaken for the
  // user turning away from the view.
  state.standardView = null;
  use(state, ortho);
  // The bottom view is below the horizon, which the orbit would otherwise
  // pull the camera back up from.
  controls.maxPolarAngle = id === "bottom" ? Math.PI : Math.PI / 2;

  controls.target.copy(target);
  ortho.position.copy(from.position);
  ortho.zoom = THREE.MathUtils.clamp(
    from.zoom,
    controls.minZoom,
    controls.maxZoom,
  );
  ortho.updateProjectionMatrix();
  controls.update();
  ortho.updateMatrixWorld(true);
  state.standardView = { id, quaternion: ortho.quaternion.clone() };
  state.onViewChange(id);
}

/**
 * Go back to the perspective camera, looking the way the orthographic one was
 * and showing the target at about the size it was. A no-op in perspective.
 * Leaving the bottom view lands the perspective camera at the lowest angle its
 * orbit allows, as it has no view from underneath.
 */
export function leaveStandardView(state: SceneState) {
  if (state.camera !== state.orthographicCamera) return;
  const {
    controls,
    orthographicCamera: ortho,
    perspectiveCamera: persp,
  } = state;
  state.standardView = null;

  const away = ortho.position.clone().sub(controls.target).normalize();
  const distance = THREE.MathUtils.clamp(
    orthoVisibleHeight(ortho.zoom) /
      (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2)),
    controls.minDistance,
    controls.maxDistance,
  );
  persp.position.copy(controls.target).addScaledVector(away, distance);
  persp.lookAt(controls.target);
  persp.updateMatrixWorld(true);

  use(state, persp);
  controls.maxPolarAngle = ORBIT_MAX_POLAR;
  state.onViewChange(null);
}

/** Whether the user has turned the camera away from the standard view it was
 *  put in. A pan or a zoom leaves the orientation alone. */
export function turnedFromStandardView(state: SceneState): boolean {
  const view = state.standardView;
  if (!view) return false;
  const dot = Math.min(
    1,
    Math.abs(view.quaternion.dot(state.orthographicCamera.quaternion)),
  );
  return 2 * Math.acos(dot) > LEAVE_RADIANS;
}
