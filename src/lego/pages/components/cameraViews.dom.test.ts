// @vitest-environment happy-dom

/**
 * The front, side and top views, against the real orbit controls and gizmo:
 * which camera they put in use, what it sees, and what takes it out again.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { describe, expect, it, vi } from "vitest";

import { snapReach } from "./anchorsAndSnapping";
import {
  leaveStandardView,
  ORBIT_MAX_POLAR,
  showStandardView,
  sizeCameras,
  syncOrthographicLimits,
  turnedFromStandardView,
} from "./cameraViews";
import type { SceneState } from "./sceneState";

const VIEWPORT = { width: 800, height: 400 };

function scene() {
  const canvas = document.createElement("canvas");
  const perspectiveCamera = new THREE.PerspectiveCamera(40, 1, 0.05, 1000);
  perspectiveCamera.position.set(9, 7, 11);
  const orthographicCamera = new THREE.OrthographicCamera(
    -1,
    1,
    1,
    -1,
    0.05,
    1,
  );
  const controls = new OrbitControls(perspectiveCamera, canvas);
  controls.maxPolarAngle = ORBIT_MAX_POLAR;
  controls.minDistance = 1;
  controls.maxDistance = 240;
  controls.zoomToCursor = true;
  const gizmo = new TransformControls(perspectiveCamera, canvas);
  const onViewChange = vi.fn();
  const state = {
    renderer: {
      getSize: (v: THREE.Vector2) => v.set(VIEWPORT.width, VIEWPORT.height),
    },
    camera: perspectiveCamera,
    perspectiveCamera,
    orthographicCamera,
    standardView: null,
    onViewChange,
    controls,
    gizmo,
  } as unknown as SceneState;
  sizeCameras(state, VIEWPORT.width, VIEWPORT.height);
  syncOrthographicLimits(state);
  return { state, onViewChange };
}

/** A 10 wide, 4 tall, 20 long box standing on the ground. */
const BOX = new THREE.Box3(
  new THREE.Vector3(-5, 0, -10),
  new THREE.Vector3(5, 4, 10),
);

/** Where `point` lands on screen, in -1 to 1 either way. */
function ndc(state: SceneState, point: THREE.Vector3) {
  state.camera.updateMatrixWorld(true);
  return point.clone().project(state.camera);
}

describe("showStandardView", () => {
  it("hands the controls and the gizmo to the orthographic camera", () => {
    const { state, onViewChange } = scene();
    showStandardView(state, "front", BOX);

    expect(state.camera).toBe(state.orthographicCamera);
    expect(state.controls.object).toBe(state.orthographicCamera);
    expect(state.gizmo.camera).toBe(state.orthographicCamera);
    expect(state.standardView?.id).toBe("front");
    expect(onViewChange).toHaveBeenLastCalledWith("front");
  });

  it("looks at the box from the front, side and top", () => {
    const { state } = scene();
    const look = (id: "front" | "side" | "top") => {
      showStandardView(state, id, BOX);
      return state.camera.getWorldDirection(new THREE.Vector3());
    };
    // The unit faces +z, so the front camera is on the +z side looking back.
    expect(look("front").z).toBeCloseTo(-1, 3);
    expect(look("side").x).toBeCloseTo(-1, 3);
    expect(look("top").y).toBeCloseTo(-1, 3);
  });

  it.each([
    "front",
    "side",
    "top",
  ] as const)("fits the whole box on screen in the %s view", (id) => {
    const { state } = scene();
    showStandardView(state, id, BOX);
    for (const x of [BOX.min.x, BOX.max.x]) {
      for (const y of [BOX.min.y, BOX.max.y]) {
        for (const z of [BOX.min.z, BOX.max.z]) {
          const at = ndc(state, new THREE.Vector3(x, y, z));
          expect(Math.abs(at.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(at.y)).toBeLessThanOrEqual(1);
          // In front of the near plane and inside the far one.
          expect(at.z).toBeGreaterThan(-1);
          expect(at.z).toBeLessThan(1);
        }
      }
    }
  });

  it("draws equal things equal however far away they are", () => {
    const { state } = scene();
    showStandardView(state, "front", BOX);
    const width = (z: number) =>
      ndc(state, new THREE.Vector3(1, 1, z)).x -
      ndc(state, new THREE.Vector3(0, 1, z)).x;
    expect(width(-10)).toBeCloseTo(width(10), 6);
  });

  it("puts the front at the bottom of the top view and on the left of the side view", () => {
    const { state } = scene();
    showStandardView(state, "top", BOX);
    expect(ndc(state, new THREE.Vector3(0, 0, 10)).y).toBeLessThan(
      ndc(state, new THREE.Vector3(0, 0, -10)).y,
    );
    showStandardView(state, "side", BOX);
    expect(ndc(state, new THREE.Vector3(0, 0, 10)).x).toBeLessThan(
      ndc(state, new THREE.Vector3(0, 0, -10)).x,
    );
  });

  it("sits level with the target in the front view, so the ground is edge on", () => {
    const { state } = scene();
    showStandardView(state, "front", BOX);
    expect(state.camera.position.y).toBeCloseTo(state.controls.target.y, 6);
  });

  it("frames the box about its middle", () => {
    const { state } = scene();
    showStandardView(state, "front", BOX);
    expect(state.controls.target.toArray()).toEqual([0, 2, 0]);
  });
});

describe("leaving a standard view", () => {
  it("stays in the view through a pan and a zoom", () => {
    const { state } = scene();
    showStandardView(state, "side", BOX);

    const pan = new THREE.Vector3(0, 3, 4);
    state.controls.target.add(pan);
    state.orthographicCamera.position.add(pan);
    state.orthographicCamera.zoom *= 2;
    state.orthographicCamera.updateProjectionMatrix();
    state.controls.update();

    expect(turnedFromStandardView(state)).toBe(false);
    expect(state.camera).toBe(state.orthographicCamera);
  });

  it("is left when the camera turns, and the perspective camera looks the same way", () => {
    const { state, onViewChange } = scene();
    showStandardView(state, "front", BOX);
    const before = state.camera.getWorldDirection(new THREE.Vector3()).clone();

    // What an orbit does: swing the camera round the target.
    const arm = state.orthographicCamera.position
      .clone()
      .sub(state.controls.target)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.3);
    state.orthographicCamera.position.copy(state.controls.target).add(arm);
    state.controls.update();
    expect(turnedFromStandardView(state)).toBe(true);

    leaveStandardView(state);
    expect(state.camera).toBe(state.perspectiveCamera);
    expect(state.controls.object).toBe(state.perspectiveCamera);
    expect(state.gizmo.camera).toBe(state.perspectiveCamera);
    expect(state.standardView).toBeNull();
    expect(state.controls.maxPolarAngle).toBe(ORBIT_MAX_POLAR);
    expect(onViewChange).toHaveBeenLastCalledWith(null);

    const after = state.camera.getWorldDirection(new THREE.Vector3());
    expect(after.angleTo(before)).toBeCloseTo(0.3, 2);
  });

  it("keeps the size of what is looked at when it goes back to perspective", () => {
    const { state } = scene();
    showStandardView(state, "front", BOX);
    const visible =
      (state.orthographicCamera.top - state.orthographicCamera.bottom) /
      state.orthographicCamera.zoom;
    leaveStandardView(state);

    const fov = THREE.MathUtils.degToRad(state.perspectiveCamera.fov);
    const distance = state.camera.position.distanceTo(state.controls.target);
    expect(2 * distance * Math.tan(fov / 2)).toBeCloseTo(visible, 3);
  });

  it("does nothing from the perspective camera", () => {
    const { state, onViewChange } = scene();
    const at = state.camera.position.clone();
    leaveStandardView(state);
    expect(state.camera.position.equals(at)).toBe(true);
    expect(onViewChange).not.toHaveBeenCalled();
  });
});

describe("zoom limits", () => {
  it("keep the orthographic camera inside the range the orbit allows", () => {
    const { state } = scene();
    const { controls, orthographicCamera: ortho } = state;
    expect(controls.minZoom).toBeLessThan(controls.maxZoom);

    showStandardView(
      state,
      "front",
      new THREE.Box3(
        new THREE.Vector3(-1e6, 0, 0),
        new THREE.Vector3(1e6, 1, 1),
      ),
    );
    expect(ortho.zoom).toBe(controls.minZoom);
  });
});

describe("snapReach", () => {
  it("is the same everywhere in an orthographic view, and halves as it zooms in", () => {
    const { state } = scene();
    showStandardView(state, "front", BOX);
    const near = snapReach(state, new THREE.Vector3(0, 0, 10));
    const far = snapReach(state, new THREE.Vector3(0, 0, -10));
    expect(near).toBe(far);

    state.orthographicCamera.zoom *= 2;
    expect(snapReach(state, new THREE.Vector3())).toBeCloseTo(near / 2, 6);
  });

  it("still grows with distance in perspective", () => {
    const { state } = scene();
    const close = snapReach(state, state.camera.position.clone().setX(10));
    const away = snapReach(state, new THREE.Vector3(-60, 0, -60));
    expect(away).toBeGreaterThan(close);
  });
});
