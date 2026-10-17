import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ProportionHandle } from "../../skeletonEdit";
import {
  alongAxis,
  handleUnderPointer,
  valueAfterDrag,
} from "./proportionHandles";

function handle(over: Partial<ProportionHandle> = {}): ProportionHandle {
  return {
    id: "stance",
    label: "Stance width",
    at: [0, 0, 0],
    axis: 0,
    gain: 0.5,
    value: 30,
    ...over,
  };
}

describe("alongAxis", () => {
  it("finds the point on the axis nearest to the ray", () => {
    // A ray down from above x = 4, passing the x axis at the origin's height.
    const ray = new THREE.Ray(
      new THREE.Vector3(4, 10, 0),
      new THREE.Vector3(0, -1, 0),
    );
    expect(alongAxis(ray, new THREE.Vector3(0, 0, 0), 0)).toBeCloseTo(4);
  });

  it("measures from the handle, not from the unit's origin", () => {
    const ray = new THREE.Ray(
      new THREE.Vector3(4, 10, 0),
      new THREE.Vector3(0, -1, 0),
    );
    expect(alongAxis(ray, new THREE.Vector3(1.5, 0, 0), 0)).toBeCloseTo(2.5);
  });

  it("gives no answer for a ray along the axis", () => {
    const ray = new THREE.Ray(
      new THREE.Vector3(0, 0, 10),
      new THREE.Vector3(1, 0, 0),
    );
    expect(alongAxis(ray, new THREE.Vector3(), 0)).toBeNull();
  });
});

describe("valueAfterDrag", () => {
  it("divides the distance by the gain", () => {
    expect(valueAfterDrag(handle(), 2)).toBe(34);
    expect(valueAfterDrag(handle({ gain: 1 }), -3)).toBe(27);
  });
});

describe("handleUnderPointer", () => {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 20);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const size = { width: 200, height: 200 };

  it("picks the handle a few pixels away and ignores one further off", () => {
    const stance = handle({ at: [0, 0, 0] });
    // The origin is the middle of the view.
    expect(handleUnderPointer([stance], camera, size, { x: 105, y: 100 })).toBe(
      stance,
    );
    expect(handleUnderPointer([stance], camera, size, { x: 140, y: 100 })).toBe(
      null,
    );
  });

  it("picks the nearer of two", () => {
    const a = handle({ id: "a", at: [0, 0, 0] });
    const b = handle({ id: "b", at: [0.5, 0, 0] });
    expect(handleUnderPointer([a, b], camera, size, { x: 108, y: 100 })).toBe(
      b,
    );
  });
});
