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
function use(state: SceneState, camera: SceneState["camera"]) {
  state.camera = camera;
  state.controls.object = camera;
  state.gizmo.camera = camera;
}

/** The ortho camera's frustum is a fixed height, and its zoom does the rest. */
export function sizeCameras(state: SceneState, width: number, height: number) {
  const aspect = width / height;
  state.perspectiveCamera.aspect = aspect;
  state.perspectiveCamera.updateProjectionMatrix();

  const ortho = state.orthographicCamera;
  ortho.left = (-ORTHO_BASE_HEIGHT * aspect) / 2;
  ortho.right = (ORTHO_BASE_HEIGHT * aspect) / 2;
  ortho.top = ORTHO_BASE_HEIGHT / 2;
  ortho.bottom = -ORTHO_BASE_HEIGHT / 2;
  ortho.updateProjectionMatrix();
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
  orthographicCamera.far = perspectiveCamera.far;
  orthographicCamera.zoom = THREE.MathUtils.clamp(
    orthographicCamera.zoom,
    minZoom,
    maxZoom,
  );
  orthographicCamera.updateProjectionMatrix();
}

/**
 * Look at `box` along one axis through the orthographic camera.
 *
 * The camera sits half the furthest orbit distance out, which is clear of
 * everything in the scene and inside its far plane. Distance does nothing to
 * the size of what is drawn, so zoom does the framing.
 */
export function showStandardView(
  state: SceneState,
  id: StandardView,
  box: THREE.Box3,
) {
  const { controls, orthographicCamera: ortho } = state;
  const axes = STANDARD_VIEWS[id];
  const aspect = (ortho.right - ortho.left) / (ortho.top - ortho.bottom);
  const height = orthoFitHeight(
    {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    },
    axes,
    aspect,
  );

  // Unset while the camera moves, so the update below is not mistaken for the
  // user turning away from the view.
  state.standardView = null;
  use(state, ortho);
  controls.maxPolarAngle = Math.PI / 2;

  const target = box.getCenter(new THREE.Vector3());
  const distance = Math.max(controls.maxDistance / 2, controls.minDistance);
  controls.target.copy(target);
  ortho.position
    .copy(target)
    .addScaledVector(new THREE.Vector3(...axes.toCamera).normalize(), distance);
  ortho.zoom = THREE.MathUtils.clamp(
    ORTHO_BASE_HEIGHT / height,
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
