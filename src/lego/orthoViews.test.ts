import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { FRAME_PADDING } from "./framing";
import {
  ORTHO_BASE_HEIGHT,
  orthoFitHeight,
  orthoVisibleHeight,
  orthoZoomLimits,
  STANDARD_VIEWS,
  type StandardView,
} from "./orthoViews";

const VIEWS: StandardView[] = ["front", "side", "top"];

describe("STANDARD_VIEWS", () => {
  it.each(
    VIEWS,
  )("%s names the screen axes a real camera has looking that way", (id) => {
    const axes = STANDARD_VIEWS[id];
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(...axes.toCamera).multiplyScalar(5);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const right = new THREE.Vector3().setFromMatrixColumn(
      camera.matrixWorld,
      0,
    );
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    expect(right.distanceTo(new THREE.Vector3(...axes.right))).toBeLessThan(
      1e-3,
    );
    expect(up.distanceTo(new THREE.Vector3(...axes.up))).toBeLessThan(1e-3);
  });

  it("puts the unit's front (+z) on the left of the side view and at the bottom of the top view", () => {
    // Projected on the screen's right and up, +z lands left in the side view
    // and down in the top view.
    const dot = (a: number[], b: number[]) =>
      a.reduce((sum, v, i) => sum + v * b[i], 0);
    expect(dot([0, 0, 1], STANDARD_VIEWS.side.right)).toBeLessThan(0);
    expect(dot([0, 0, 1], STANDARD_VIEWS.top.up)).toBeLessThan(0);
    expect(dot([1, 0, 0], STANDARD_VIEWS.front.right)).toBeGreaterThan(0);
  });
});

describe("orthoFitHeight", () => {
  const box = { min: [-2, 0, -5] as const, max: [2, 6, 5] as const };
  const asBox = { min: [...box.min], max: [...box.max] } as Parameters<
    typeof orthoFitHeight
  >[0];

  it("fits the height of a tall box in the front view", () => {
    // 6 high and 4 wide: the height is the limit on a square screen.
    expect(orthoFitHeight(asBox, STANDARD_VIEWS.front, 1)).toBeCloseTo(
      6 * FRAME_PADDING,
    );
  });

  it("fits the width of a long box in the side view, on a wide screen too", () => {
    // 10 long (z) and 6 high. On a 2:1 screen the length needs 5 of height.
    expect(orthoFitHeight(asBox, STANDARD_VIEWS.side, 2)).toBeCloseTo(
      6 * FRAME_PADDING,
    );
    // On a square screen the 10 long box needs 10 of height.
    expect(orthoFitHeight(asBox, STANDARD_VIEWS.side, 1)).toBeCloseTo(
      10 * FRAME_PADDING,
    );
  });

  it("fits the footprint in the top view", () => {
    // 4 across (x) and 10 deep (z).
    expect(orthoFitHeight(asBox, STANDARD_VIEWS.top, 1)).toBeCloseTo(
      10 * FRAME_PADDING,
    );
    expect(orthoFitHeight(asBox, STANDARD_VIEWS.top, 0.2)).toBeCloseTo(
      (4 / 0.2) * FRAME_PADDING,
    );
  });

  it("never shows less than a small floor, however small the box", () => {
    const point = { min: [0, 0, 0], max: [0, 0, 0] } as Parameters<
      typeof orthoFitHeight
    >[0];
    expect(orthoFitHeight(point, STANDARD_VIEWS.front, 1)).toBeGreaterThan(0);
  });
});

describe("zoom", () => {
  it("shows the base height at zoom 1 and half of it at zoom 2", () => {
    expect(orthoVisibleHeight(1)).toBe(ORTHO_BASE_HEIGHT);
    expect(orthoVisibleHeight(2)).toBe(ORTHO_BASE_HEIGHT / 2);
  });

  it("limits zoom to the heights a perspective camera sees at its distance limits", () => {
    // A 90 degree FOV shows 2 * distance of height.
    const { minZoom, maxZoom } = orthoZoomLimits(Math.PI / 2, 1, 240);
    expect(orthoVisibleHeight(minZoom)).toBeCloseTo(480);
    expect(orthoVisibleHeight(maxZoom)).toBeCloseTo(2);
    expect(maxZoom).toBeGreaterThan(minZoom);
  });
});
