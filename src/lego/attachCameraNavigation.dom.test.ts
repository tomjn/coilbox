// @vitest-environment happy-dom
import * as THREE from "three";
import { MOUSE } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { afterEach, describe, expect, it } from "vitest";

import { attachCameraNavigation } from "./attachCameraNavigation";
import type { NavigationPreset } from "./cameraNavigation";

// OrbitControls' internal state: NONE -1, ROTATE 0, DOLLY 1, PAN 2.
const stateOf = (controls: OrbitControls) =>
  (controls as unknown as { state: number }).state;

function setup(preset: NavigationPreset, canOrbit = true) {
  const element = document.createElement("div");
  element.setPointerCapture = () => {};
  element.releasePointerCapture = () => {};
  document.body.append(element);
  let controls: OrbitControls | undefined;
  const detach = attachCameraNavigation(
    element,
    () => controls,
    () => preset,
    () => canOrbit,
  );
  const made = new OrbitControls(new THREE.PerspectiveCamera(), element);
  controls = made;
  return { element, controls: made, detach };
}

function fire(
  element: HTMLElement,
  type: string,
  button: number,
  init: object = {},
) {
  const event = new MouseEvent(type, { button, bubbles: true, ...init });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  element.dispatchEvent(event);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("attachCameraNavigation", () => {
  it("sets ROTATE for Alt with the middle button in 3ds Max, and restores on release", () => {
    const { element, controls } = setup("3dsmax");
    fire(element, "pointerdown", 1, { altKey: true });
    expect(controls.mouseButtons.MIDDLE).toBe(MOUSE.ROTATE);
    fire(element, "pointerup", 1);
    expect(controls.mouseButtons).toEqual({
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN,
    });
  });

  it("has OrbitControls orbit for Alt and pan for a plain middle press in 3ds Max", () => {
    const { element, controls } = setup("3dsmax");
    fire(element, "pointerdown", 1, { altKey: true });
    expect(stateOf(controls)).toBe(0);
    fire(element, "pointerup", 1);
    fire(element, "pointerdown", 1);
    expect(stateOf(controls)).toBe(2);
  });

  it("does not start a camera move on a left press in Blender", () => {
    const { element, controls } = setup("blender");
    fire(element, "pointerdown", 0);
    expect(stateOf(controls)).toBe(-1);
  });

  it("makes Shift with the middle button pan in Blender", () => {
    const { element, controls } = setup("blender");
    fire(element, "pointerdown", 1, { shiftKey: true });
    expect(stateOf(controls)).toBe(2);
  });

  it("stops changing the buttons once detached", () => {
    const { element, controls, detach } = setup("blender");
    detach();
    fire(element, "pointerdown", 0);
    expect(controls.mouseButtons.LEFT).toBe(MOUSE.ROTATE);
  });
});

describe("in a view that cannot orbit", () => {
  // As the top, front and side views of the four view layout set them up.
  function flat(preset: NavigationPreset) {
    const made = setup(preset, false);
    made.controls.enableRotate = false;
    return made;
  }

  it("pans on the drag that would orbit", () => {
    const { element, controls } = flat("coilbox");
    fire(element, "pointerdown", 0);
    expect(stateOf(controls)).toBe(2);
  });

  it("still pans on the preset's own pan, with or without a modifier", () => {
    const blender = flat("blender");
    fire(blender.element, "pointerdown", 1, { shiftKey: true });
    expect(stateOf(blender.controls)).toBe(2);
    fire(blender.element, "pointerup", 1);

    const max = flat("3dsmax");
    fire(max.element, "pointerdown", 1);
    expect(stateOf(max.controls)).toBe(2);
  });

  it("pans on Blender's orbit, the plain middle button", () => {
    const { element, controls } = flat("blender");
    fire(element, "pointerdown", 1);
    expect(stateOf(controls)).toBe(2);
  });

  it("still zooms on the preset's zoom", () => {
    const { element, controls } = flat("3dsmax");
    fire(element, "pointerdown", 1, { altKey: true, ctrlKey: true });
    expect(stateOf(controls)).toBe(1);
  });
});
