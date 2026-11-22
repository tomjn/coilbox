// @vitest-environment happy-dom

/**
 * The four view layout against the real orbit controls and gizmo: which
 * quadrant takes them, and which camera a pointer's ray comes from.
 */

import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { describe, expect, it, vi } from "vitest";
import {
  ORBIT_MAX_POLAR,
  sizeCameras,
  syncOrthographicLimits,
} from "./cameraViews";
import type { SceneState } from "./sceneState";
import {
  aimFromPointer,
  maximiseQuadrant,
  pickViewAt,
  setFourViews,
  sizeViews,
  ViewportOrbitControls,
} from "./viewLayout";

const CANVAS = { left: 0, top: 0, width: 800, height: 600 };

function scene() {
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () =>
    ({ ...CANVAS, right: CANVAS.width, bottom: CANVAS.height }) as DOMRect;
  const perspectiveCamera = new THREE.PerspectiveCamera(40, 1, 0.05, 1000);
  perspectiveCamera.position.set(9, 7, 11);
  const orthographicCamera = new THREE.OrthographicCamera(
    -1,
    1,
    1,
    -1,
    0.05,
    1000,
  );
  const controls = new ViewportOrbitControls(perspectiveCamera, canvas);
  controls.maxPolarAngle = ORBIT_MAX_POLAR;
  controls.minDistance = 1;
  controls.maxDistance = 240;
  const gizmo = new TransformControls(perspectiveCamera, canvas);
  const onLayoutChange = vi.fn();
  const state = {
    renderer: { domElement: canvas },
    camera: perspectiveCamera,
    perspectiveCamera,
    orthographicCamera,
    standardView: null,
    onViewChange: vi.fn(),
    quad: null,
    onLayoutChange,
    size: { width: CANVAS.width, height: CANVAS.height },
    controls,
    gizmo,
    dragging: false,
  } as unknown as SceneState;
  sizeCameras(state, CANVAS.width, CANVAS.height);
  syncOrthographicLimits(state);
  return { state, onLayoutChange };
}

/** A 10 wide, 4 tall, 20 long box standing on the ground. */
const BOX = new THREE.Box3(
  new THREE.Vector3(-5, 0, -10),
  new THREE.Vector3(5, 4, 10),
);

function ray(state: SceneState, x: number, y: number) {
  const raycaster = new THREE.Raycaster();
  aimFromPointer(state, raycaster, x, y);
  return raycaster.ray;
}

describe("switching to four views", () => {
  it("opens with the perspective quadrant in charge, and the others looking at the box", () => {
    const { state, onLayoutChange } = scene();
    setFourViews(state, true, BOX);

    expect(state.quad?.active).toBe("perspective");
    expect(state.camera).toBe(state.perspectiveCamera);
    expect(onLayoutChange).toHaveBeenLastCalledWith("perspective");
    const top = state.quad?.views.top.camera as THREE.Camera;
    const down = top.getWorldDirection(new THREE.Vector3());
    expect(down.y).toBeCloseTo(-1, 3);
    expect(state.quad?.views.top.target.toArray()).toEqual([0, 2, 0]);
  });

  it("goes back to one view through the perspective camera, measured against the whole canvas", () => {
    const { state, onLayoutChange } = scene();
    setFourViews(state, true, BOX);
    pickViewAt(state, 100, 100);
    setFourViews(state, false, BOX);

    expect(state.quad).toBeNull();
    expect(state.camera).toBe(state.perspectiveCamera);
    expect(state.controls.object).toBe(state.perspectiveCamera);
    expect(state.gizmo.viewport).toBeNull();
    expect(state.controls.enableRotate).toBe(true);
    expect(state.perspectiveCamera.aspect).toBeCloseTo(800 / 600, 6);
    expect(onLayoutChange).toHaveBeenLastCalledWith(null);
  });
});

describe("picking the quadrant under the pointer", () => {
  it("hands the controls and the gizmo to the top view in the top left", () => {
    const { state, onLayoutChange } = scene();
    setFourViews(state, true, BOX);

    expect(pickViewAt(state, 100, 100)).toBe(true);
    const top = state.quad?.views.top.camera;
    expect(state.camera).toBe(top);
    expect(state.controls.object).toBe(top);
    expect(state.gizmo.camera).toBe(top);
    expect(state.controls.enableRotate).toBe(false);
    // The gizmo measures from the bottom left, so the top row sits 300 up.
    expect(state.gizmo.viewport?.toArray()).toEqual([0, 300, 400, 300]);
    expect(onLayoutChange).toHaveBeenLastCalledWith("top");
    // Still the top view: nothing turned it on the way in.
    expect(pickViewAt(state, 120, 120)).toBe(false);
  });

  it("keeps the active quadrant's pan when the canvas is resized", () => {
    const { state } = scene();
    setFourViews(state, true, BOX);
    pickViewAt(state, 100, 100);
    state.controls.target.set(3, 2, 1);
    sizeViews(state, 1000, 600);
    expect(state.controls.target.toArray()).toEqual([3, 2, 1]);
    expect(state.quad?.rects.top.width).toBe(500);
  });

  it("keeps the view a drag started in", () => {
    const { state } = scene();
    setFourViews(state, true, BOX);
    pickViewAt(state, 100, 100);
    state.dragging = true;

    expect(pickViewAt(state, 700, 500)).toBe(false);
    expect(state.quad?.active).toBe("top");
  });

  it("gives each quadrant its own orbit point back", () => {
    const { state } = scene();
    setFourViews(state, true, BOX);
    pickViewAt(state, 100, 100);
    state.controls.target.set(3, 2, 1);
    pickViewAt(state, 700, 500);
    expect(state.controls.target.toArray()).not.toEqual([3, 2, 1]);
    pickViewAt(state, 100, 100);
    expect(state.controls.target.toArray()).toEqual([3, 2, 1]);
  });

  it("casts a ray through the middle of the box from the middle of each orthographic quadrant", () => {
    const { state } = scene();
    setFourViews(state, true, BOX);
    const middle = BOX.getCenter(new THREE.Vector3());

    pickViewAt(state, 200, 150);
    expect(ray(state, 200, 150).distanceToPoint(middle)).toBeCloseTo(0, 3);
    expect(ray(state, 200, 150).direction.y).toBeCloseTo(-1, 3);

    pickViewAt(state, 600, 150);
    expect(ray(state, 600, 150).distanceToPoint(middle)).toBeCloseTo(0, 3);
    expect(ray(state, 600, 150).direction.z).toBeCloseTo(-1, 3);

    pickViewAt(state, 200, 450);
    expect(ray(state, 200, 450).distanceToPoint(middle)).toBeCloseTo(0, 3);
    expect(ray(state, 200, 450).direction.x).toBeCloseTo(-1, 3);
  });

  it("does nothing in one view", () => {
    const { state } = scene();
    expect(pickViewAt(state, 100, 100)).toBe(false);
    expect(state.camera).toBe(state.perspectiveCamera);
  });
});

describe("maximising a quadrant", () => {
  it("shows the top quadrant as the top view, at the same zoom", () => {
    const { state } = scene();
    setFourViews(state, true, BOX);
    const top = state.quad?.views.top.camera as THREE.OrthographicCamera;
    top.zoom *= 1.5;

    maximiseQuadrant(state, "top");
    expect(state.quad).toBeNull();
    expect(state.camera).toBe(state.orthographicCamera);
    expect(state.standardView?.id).toBe("top");
    expect(state.orthographicCamera.zoom).toBeCloseTo(top.zoom, 6);
  });

  it("shows the perspective quadrant as the one perspective view", () => {
    const { state } = scene();
    setFourViews(state, true, BOX);
    maximiseQuadrant(state, "perspective");
    expect(state.quad).toBeNull();
    expect(state.camera).toBe(state.perspectiveCamera);
    expect(state.standardView).toBeNull();
  });
});
