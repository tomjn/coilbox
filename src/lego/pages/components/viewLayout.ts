/**
 * One view or four (#5371): the top, front and side views beside the
 * perspective one, drawn by the one renderer into four parts of the canvas.
 *
 * Each quadrant has its own camera. The orbit controls and the gizmo are shared,
 * so whichever quadrant the pointer is over takes them, the way a standard view
 * takes them from the perspective camera in the one view layout. Everything
 * that turns the pointer into a ray asks this file for it, so a click, a hover
 * or a drag always goes through the camera of the quadrant it started in.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  fromBottomLeft,
  pointInView,
  QUADRANT_VIEWS,
  QUADRANTS,
  type Quadrant,
  quadrantAt,
  quadrantRects,
  type ViewRect,
} from "../../quadViews";
import {
  enterStandardView,
  fitOrthographic,
  leaveStandardView,
  ORBIT_MAX_POLAR,
  sizeCameras,
  sizeOrthographic,
  syncOrthographicLimits,
  use,
} from "./cameraViews";
import type { SceneState } from "./sceneState";

export interface QuadView {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  /** Where this camera orbits and pans about. The controls hold the active
   *  quadrant's, so this is only current for the others. */
  target: THREE.Vector3;
}

export interface QuadLayout {
  views: Record<Quadrant, QuadView>;
  rects: Record<Quadrant, ViewRect>;
  /** The quadrant that has the controls and the gizmo. */
  active: Quadrant;
}

/**
 * OrbitControls that zoom towards the pointer within part of the canvas.
 * `viewport` is measured the way TransformControls measures its own: CSS
 * pixels from the canvas's bottom left, and null for the whole canvas.
 *
 * OrbitControls works out where the pointer is from the whole canvas when it
 * zooms to the cursor. This moves the pointer to where it would be on the
 * whole canvas if the quadrant filled it, and lets OrbitControls do the rest.
 */
export class ViewportOrbitControls extends OrbitControls {
  viewport: THREE.Vector4 | null = null;

  _updateZoomParameters(x: number, y: number) {
    const viewport = this.viewport;
    const element = this.domElement;
    if (viewport && element) {
      const rect = element.getBoundingClientRect();
      const top = rect.height - viewport.y - viewport.w;
      x = rect.left + ((x - rect.left - viewport.x) / viewport.z) * rect.width;
      y = rect.top + ((y - rect.top - top) / viewport.w) * rect.height;
    }
    zoomTowards.call(this, x, y);
  }
}

const zoomTowards = (
  OrbitControls.prototype as unknown as {
    _updateZoomParameters(this: OrbitControls, x: number, y: number): void;
  }
)._updateZoomParameters;

/** The rectangle the active view draws into, in CSS pixels from the top left
 *  of `canvas`. The whole canvas in the one view layout. */
function activeRect(
  state: SceneState,
  canvas: { width: number; height: number },
): ViewRect {
  if (state.quad) return state.quad.rects[state.quad.active];
  return { x: 0, y: 0, width: canvas.width, height: canvas.height };
}

/** The height in CSS pixels of the view the active camera draws into. */
export function activeViewHeight(state: SceneState): number {
  return state.quad
    ? state.quad.rects[state.quad.active].height
    : state.renderer.getSize(new THREE.Vector2()).y;
}

/** The active view's rectangle on the page, as `getBoundingClientRect`
 *  measures one. */
export function activeViewBounds(state: SceneState): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const canvas = state.renderer.domElement.getBoundingClientRect();
  if (!state.quad) return canvas;
  const rect = activeRect(state, canvas);
  return {
    left: canvas.left + rect.x,
    top: canvas.top + rect.y,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Aim `raycaster` from the active camera through a point on the page. Every
 * ray the viewport casts from the pointer comes through here. Call
 * `pickViewAt` first for a press or a hover, so the active view is the one
 * under the pointer. A drag leaves it alone, so the ray keeps going through
 * the view the drag started in even once the pointer leaves it.
 */
export function aimFromPointer(
  state: SceneState,
  raycaster: THREE.Raycaster,
  clientX: number,
  clientY: number,
) {
  const canvas = state.renderer.domElement.getBoundingClientRect();
  const at = pointInView(
    activeRect(state, canvas),
    clientX - canvas.left,
    clientY - canvas.top,
  );
  raycaster.setFromCamera(new THREE.Vector2(at.x, at.y), state.camera);
}

/**
 * Hand the controls and the gizmo to the quadrant under a point on the page.
 * Does nothing in the one view layout, off the canvas, or while a drag holds
 * the view it started in. Returns whether the active quadrant changed.
 */
export function pickViewAt(
  state: SceneState,
  clientX: number,
  clientY: number,
): boolean {
  const quad = state.quad;
  if (!quad || state.dragging) return false;
  const canvas = state.renderer.domElement.getBoundingClientRect();
  const id = quadrantAt(
    quad.rects,
    clientX - canvas.left,
    clientY - canvas.top,
  );
  if (!id || id === quad.active) return false;
  quad.views[quad.active].target.copy(state.controls.target);
  quad.active = id;
  applyActiveView(state);
  state.onLayoutChange(id);
  return true;
}

/** Point the controls and the gizmo at the active quadrant's camera, measured
 *  against its own part of the canvas. */
function applyActiveView(state: SceneState) {
  const quad = state.quad;
  if (!quad) return;
  const { controls, gizmo, size } = state;
  const view = quad.views[quad.active];
  use(state, view.camera);
  controls.target.copy(view.target);
  const perspective = quad.active === "perspective";
  // Orbit is for the perspective view. Turning a top, front or side view
  // would make it something else, so a drag there pans instead.
  controls.enableRotate = perspective;
  controls.maxPolarAngle = perspective ? ORBIT_MAX_POLAR : Math.PI;
  const rect = quad.rects[quad.active];
  const bottomLeft = fromBottomLeft(rect, size.height);
  const viewport = new THREE.Vector4(
    bottomLeft.x,
    bottomLeft.y,
    bottomLeft.width,
    bottomLeft.height,
  );
  gizmo.viewport = viewport;
  if (controls instanceof ViewportOrbitControls) controls.viewport = viewport;
  // OrbitControls measures a pan against the whole canvas, so a pan in a
  // quadrant half its height moves half as far as the pointer without this.
  controls.panSpeed = size.height / Math.max(rect.height, 1);
}

/** Give each quadrant's camera the shape of its quadrant. */
function sizeQuadrants(state: SceneState) {
  const quad = state.quad;
  if (!quad) return;
  // Kept, since handing the controls back below reads it.
  quad.views[quad.active].target.copy(state.controls.target);
  quad.rects = quadrantRects(state.size.width, state.size.height);
  for (const id of QUADRANTS) {
    const rect = quad.rects[id];
    const aspect = rect.width / Math.max(rect.height, 1);
    const { camera } = quad.views[id];
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    } else {
      sizeOrthographic(camera, aspect);
    }
  }
  applyActiveView(state);
}

/** The canvas has a new size in CSS pixels: size every camera to its part of
 *  it. */
export function sizeViews(state: SceneState, width: number, height: number) {
  state.size = { width, height };
  if (state.quad) sizeQuadrants(state);
  else sizeCameras(state, width, height);
}

/**
 * Switch to the four view layout, with the top, front and side views each
 * framing `box`, or back to one view, which is the perspective camera as the
 * four view layout left it. Does nothing if the layout is already that.
 */
export function setFourViews(state: SceneState, on: boolean, box: THREE.Box3) {
  if (on === (state.quad !== null)) return;
  if (!on) {
    showOneView(state);
    return;
  }
  // The perspective quadrant is the perspective camera, so a standard view
  // showing now goes back to it first.
  leaveStandardView(state);
  const ortho = () =>
    new THREE.OrthographicCamera(
      -1,
      1,
      1,
      -1,
      0.05,
      state.orthographicCamera.far,
    );
  state.quad = {
    views: {
      top: { camera: ortho(), target: new THREE.Vector3() },
      front: { camera: ortho(), target: new THREE.Vector3() },
      side: { camera: ortho(), target: new THREE.Vector3() },
      perspective: {
        camera: state.perspectiveCamera,
        target: state.controls.target.clone(),
      },
    },
    rects: quadrantRects(state.size.width, state.size.height),
    active: "perspective",
  };
  sizeQuadrants(state);
  syncOrthographicLimits(state);
  fitQuadrants(state, box);
  state.onLayoutChange(state.quad.active);
}

/** Back to the one view layout, through the perspective camera. */
function showOneView(state: SceneState) {
  const quad = state.quad;
  if (!quad) return;
  quad.views[quad.active].target.copy(state.controls.target);
  const target = quad.views.perspective.target;
  state.quad = null;
  use(state, state.perspectiveCamera);
  const { controls, gizmo } = state;
  controls.target.copy(target);
  controls.enableRotate = true;
  controls.maxPolarAngle = ORBIT_MAX_POLAR;
  controls.panSpeed = 1;
  gizmo.viewport = null;
  if (controls instanceof ViewportOrbitControls) controls.viewport = null;
  sizeCameras(state, state.size.width, state.size.height);
  controls.update();
  state.onLayoutChange(null);
}

/**
 * Fill the one view with a quadrant, from where that quadrant was looking.
 * The top, front and side quadrants become the standard view of the same
 * name, at the same pan and zoom.
 */
export function maximiseQuadrant(state: SceneState, id: Quadrant) {
  const quad = state.quad;
  if (!quad) return;
  // `showOneView` writes the active quadrant's pan into its target before it
  // drops the layout, so this is current even for that quadrant.
  const { camera, target } = quad.views[id];
  showOneView(state);
  if (id === "perspective" || !(camera instanceof THREE.OrthographicCamera))
    return;
  enterStandardView(state, QUADRANT_VIEWS[id], camera, target.clone());
}

/** Frame `box` in the top, front and side quadrants. */
export function fitQuadrants(state: SceneState, box: THREE.Box3) {
  const quad = state.quad;
  if (!quad) return;
  quad.views[quad.active].target.copy(state.controls.target);
  for (const id of QUADRANTS) {
    if (id === "perspective") continue;
    const { camera, target } = quad.views[id];
    if (!(camera instanceof THREE.OrthographicCamera)) continue;
    fitOrthographic(camera, target, QUADRANT_VIEWS[id], box, state.controls);
  }
  state.controls.target.copy(quad.views[quad.active].target);
}

/**
 * Run `act`, which moves the camera through the controls, on the perspective
 * quadrant, and hand the controls back to the quadrant that had them. In the
 * one view layout it simply runs.
 */
export function inPerspective(state: SceneState, act: () => void) {
  const quad = state.quad;
  if (!quad) {
    act();
    return;
  }
  const was = quad.active;
  quad.views[was].target.copy(state.controls.target);
  quad.active = "perspective";
  applyActiveView(state);
  act();
  quad.views.perspective.target.copy(state.controls.target);
  quad.active = was;
  applyActiveView(state);
}

/** Move every camera and what it orbits by `delta`, as following a driving
 *  unit does. */
export function shiftViews(state: SceneState, delta: THREE.Vector3) {
  state.camera.position.add(delta);
  state.controls.target.add(delta);
  const quad = state.quad;
  if (!quad) return;
  for (const id of QUADRANTS) {
    if (id === quad.active) continue;
    quad.views[id].camera.position.add(delta);
    quad.views[id].target.add(delta);
  }
}

/**
 * Draw every quadrant into its part of the canvas, the active one last.
 *
 * The gizmo sizes and turns its handles for whichever camera it was last drawn
 * through, and picks a handle against that drawing, so the active quadrant
 * goes last to leave it right for the next press. `beforeEach` sets up what
 * depends on the camera or the size of the quadrant.
 */
export function renderQuadrants(
  state: SceneState,
  beforeEach: (id: Quadrant, rect: ViewRect) => void,
) {
  const quad = state.quad;
  if (!quad) return;
  const { renderer, gizmo, size } = state;
  const order = [...QUADRANTS.filter((id) => id !== quad.active), quad.active];
  renderer.setScissorTest(true);
  for (const id of order) {
    const rect = quad.rects[id];
    const at = fromBottomLeft(rect, size.height);
    renderer.setViewport(at.x, at.y, at.width, at.height);
    renderer.setScissor(at.x, at.y, at.width, at.height);
    gizmo.camera = quad.views[id].camera;
    beforeEach(id, rect);
    renderer.render(state.scene, quad.views[id].camera);
  }
  // The renderer is pooled, and the next view to take it expects the whole
  // canvas.
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, size.width, size.height);
  gizmo.camera = state.camera;
}

/**
 * Hand the controls and the gizmo to the quadrant the pointer is over, on a
 * press, a wheel tick and a move with no button held. Attach it before the
 * orbit controls and the gizmo, so its listeners run first and theirs see the
 * quadrant's camera. `getState` is read per event, since the scene is built
 * after this is attached. Returns a function that removes the listeners.
 */
export function attachViewPicking(
  element: HTMLElement,
  getState: () => SceneState | null,
): () => void {
  const pick = (event: PointerEvent | WheelEvent) => {
    const state = getState();
    if (!state) return;
    if (pickViewAt(state, event.clientX, event.clientY)) state.render();
  };
  const onMove = (event: PointerEvent) => {
    if (event.buttons === 0) pick(event);
  };
  element.addEventListener("pointerdown", pick);
  element.addEventListener("pointermove", onMove);
  element.addEventListener("wheel", pick, { passive: true });
  return () => {
    element.removeEventListener("pointerdown", pick);
    element.removeEventListener("pointermove", onMove);
    element.removeEventListener("wheel", pick);
  };
}
