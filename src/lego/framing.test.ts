import { describe, expect, it } from "vitest";

import { frameBox } from "./framing";
import type { Vec3 } from "./snapping";

const VERTICAL_FOV = Math.PI / 4.5; // 40 degrees, the viewport's camera.

describe("frameBox", () => {
  it("targets the box centre, including a box off the origin", () => {
    const { target } = frameBox(
      { min: [0, 0, 0], max: [4, 2, 6] },
      [0, 0, 1],
      VERTICAL_FOV,
    );

    expect(target).toEqual([2, 1, 3]);
  });

  it("keeps the camera along the given direction from the target", () => {
    const direction: Vec3 = [1, 1, 1];
    const { target, position } = frameBox(
      { min: [-1, -1, -1], max: [1, 1, 1] },
      direction,
      VERTICAL_FOV,
    );

    const offset: Vec3 = [
      position[0] - target[0],
      position[1] - target[1],
      position[2] - target[2],
    ];
    const length = Math.hypot(...offset);
    const normalisedOffset = offset.map((n) => n / length);
    const normalisedDirection = direction.map(
      (n) => n / Math.hypot(...direction),
    );

    normalisedOffset.forEach((n, i) => {
      expect(n).toBeCloseTo(normalisedDirection[i]);
    });
  });

  it("normalises a direction that is not already unit length", () => {
    const short = frameBox(
      { min: [-1, -1, -1], max: [1, 1, 1] },
      [0, 0, 1],
      VERTICAL_FOV,
    );
    const long = frameBox(
      { min: [-1, -1, -1], max: [1, 1, 1] },
      [0, 0, 100],
      VERTICAL_FOV,
    );

    expect(long.position).toEqual(short.position);
  });

  it("pulls back further for a bigger box", () => {
    const small = frameBox(
      { min: [-1, -1, -1], max: [1, 1, 1] },
      [0, 0, 1],
      VERTICAL_FOV,
    );
    const big = frameBox(
      { min: [-5, -5, -5], max: [5, 5, 5] },
      [0, 0, 1],
      VERTICAL_FOV,
    );

    const smallDistance = small.position[2] - small.target[2];
    const bigDistance = big.position[2] - big.target[2];
    expect(bigDistance).toBeGreaterThan(smallDistance);
  });

  it("does not put the camera inside a tiny or empty piece", () => {
    const { target, position } = frameBox(
      { min: [0, 0, 0], max: [0, 0, 0] },
      [0, 0, 1],
      VERTICAL_FOV,
    );

    const distance = Math.hypot(
      position[0] - target[0],
      position[1] - target[1],
      position[2] - target[2],
    );
    expect(distance).toBeGreaterThanOrEqual(1.5);
  });

  it("does not fly out to the horizon for a huge piece", () => {
    const { target, position } = frameBox(
      { min: [-500, -500, -500], max: [500, 500, 500] },
      [0, 0, 1],
      VERTICAL_FOV,
    );

    const distance = Math.hypot(
      position[0] - target[0],
      position[1] - target[1],
      position[2] - target[2],
    );
    expect(distance).toBeLessThanOrEqual(60);
  });

  it("pads the fit rather than sitting the box flush on the frame edge", () => {
    // A sphere of radius 1 exactly fills the vertical FOV at this distance.
    const exactFit = 1 / Math.sin(VERTICAL_FOV / 2);
    const { target, position } = frameBox(
      { min: [-1, -1, -1], max: [1, 1, 1] },
      [0, 0, 1],
      VERTICAL_FOV,
    );

    const distance = position[2] - target[2];
    expect(distance).toBeGreaterThan(exactFit);
  });
});
