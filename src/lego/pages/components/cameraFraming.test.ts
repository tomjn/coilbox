import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { resetFrame } from "./cameraFraming";
import { HOME_CAMERA } from "./ModelViewport";
import type { SceneState } from "./sceneState";

type FramingState = Pick<
  SceneState,
  | "camera"
  | "perspectiveCamera"
  | "orthographicCamera"
  | "controls"
  | "reference"
  | "standardView"
  | "render"
>;

/** A reference figure: a box 100 wide, parked 200 to the side of the unit. */
function referenceAt(x: number, visible: boolean) {
  const reference = new THREE.Group();
  reference.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(100, 50, 100),
      new THREE.MeshBasicMaterial(),
    ),
  );
  reference.position.set(x, 25, 0);
  reference.visible = visible;
  reference.updateMatrixWorld(true);
  return reference;
}

function stateWith(reference: THREE.Group) {
  const perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  perspectiveCamera.position.set(3, 3, 3);
  const state = {
    camera: perspectiveCamera,
    perspectiveCamera,
    orthographicCamera: new THREE.OrthographicCamera(-1, 1, 1, -1),
    controls: { target: new THREE.Vector3(1, 1, 1), update: vi.fn() },
    reference,
    standardView: null,
    render: vi.fn(),
  };
  return state as unknown as FramingState & {
    controls: { target: THREE.Vector3 };
    camera: THREE.PerspectiveCamera;
  };
}

/** The unit's own box: 10 elmos across, standing at the origin. */
function unitBox() {
  return new THREE.Box3(
    new THREE.Vector3(-5, 0, -5),
    new THREE.Vector3(5, 10, 5),
  );
}

function distance(state: ReturnType<typeof stateWith>) {
  return state.camera.position.distanceTo(state.controls.target);
}

describe("resetFrame", () => {
  it("frames the unit and a standing reference together", () => {
    const state = stateWith(referenceAt(200, true));
    resetFrame(state as unknown as SceneState, unitBox());

    // The union runs from -5 to 250 along x, so the target is its middle.
    expect(state.controls.target.x).toBeCloseTo(122.5);
    expect(state.render).toHaveBeenCalledTimes(1);
  });

  it("frames only the unit when the reference is hidden", () => {
    const state = stateWith(referenceAt(200, false));
    resetFrame(state as unknown as SceneState, unitBox());

    expect(state.controls.target.x).toBeCloseTo(0);
    expect(state.controls.target.y).toBeCloseTo(5);
  });

  it("pulls back further for a standing reference than for a hidden one", () => {
    const standing = stateWith(referenceAt(200, true));
    const hidden = stateWith(referenceAt(200, false));
    resetFrame(standing as unknown as SceneState, unitBox());
    resetFrame(hidden as unknown as SceneState, unitBox());

    expect(distance(standing)).toBeGreaterThan(distance(hidden));
  });

  it("frames a standing reference alone when the unit has no geometry", () => {
    const state = stateWith(referenceAt(200, true));
    resetFrame(state as unknown as SceneState, null);

    expect(state.controls.target.x).toBeCloseTo(200);
    expect(state.controls.target.y).toBeCloseTo(25);
  });

  it("goes home when there is no geometry and no standing reference", () => {
    const state = stateWith(referenceAt(200, false));
    resetFrame(state as unknown as SceneState, null);

    expect(state.camera.position.toArray()).toEqual(HOME_CAMERA);
    expect(state.controls.target.toArray()).toEqual([0, 0, 0]);
    expect(state.render).toHaveBeenCalledTimes(1);
  });
});
