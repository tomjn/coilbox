// @vitest-environment happy-dom

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { attachWheelRelease } from "./wheelRelease";

/** A host with a canvas in it, 100 by 100 at the page's origin, and a
 *  camera looking down the -z axis from z = 10. */
function setup(isOver: (ray: THREE.Ray) => boolean) {
  const host = document.createElement("div");
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld();
  const reached = vi.fn();
  canvas.addEventListener("wheel", reached);
  const detach = attachWheelRelease(host, canvas, () => camera, isOver);
  const wheel = () => {
    const event = new WheelEvent("wheel", {
      deltaY: 100,
      bubbles: true,
      cancelable: true,
    });
    // happy-dom's WheelEvent drops the pointer position from its init.
    Object.defineProperty(event, "clientX", { value: 50 });
    Object.defineProperty(event, "clientY", { value: 50 });
    canvas.dispatchEvent(event);
  };
  return { reached, detach, wheel };
}

describe("attachWheelRelease", () => {
  it("lets the canvas see a wheel over content", () => {
    const { reached, wheel } = setup(() => true);
    wheel();
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it("keeps a wheel over empty space from reaching the canvas", () => {
    const { reached, wheel } = setup(() => false);
    wheel();
    expect(reached).not.toHaveBeenCalled();
  });

  it("casts from the pointer, so the centre of the canvas looks down -z", () => {
    let seen: THREE.Ray | undefined;
    const { wheel } = setup((ray) => {
      seen = ray.clone();
      return true;
    });
    wheel();
    expect(seen?.origin.z).toBeCloseTo(10);
    expect(seen?.direction.z).toBeCloseTo(-1);
    expect(seen?.direction.x).toBeCloseTo(0);
  });

  it("stops listening once detached", () => {
    const { reached, detach, wheel } = setup(() => false);
    detach();
    wheel();
    expect(reached).toHaveBeenCalledTimes(1);
  });
});
