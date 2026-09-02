/**
 * The truth table `releaseWheel` is for (issue #2317): a wheel over sky always
 * scrolls the page, and a wheel over the map only zooms once the view has been
 * clicked into. `groundHit` is the approximate ray/plane test that stands in
 * for a raycast against the terrain (issue #2326).
 */

import { describe, expect, it } from "vitest";

import { groundHit, releaseWheel } from "./wheelGate";

describe("releaseWheel", () => {
  it("releases a wheel over sky, armed or not", () => {
    expect(releaseWheel(false, false)).toBe(true);
    expect(releaseWheel(false, true)).toBe(true);
  });

  it("releases a wheel over the map that has not been clicked into", () => {
    expect(releaseWheel(true, false)).toBe(true);
  });

  it("keeps a wheel over the map once the view is armed, so it zooms", () => {
    expect(releaseWheel(true, true)).toBe(false);
  });
});

describe("groundHit", () => {
  const groundY = 0;
  const halfWidth = 50;
  const halfDepth = 40;

  it("hits when looking straight down at the map centre", () => {
    const origin = { x: 0, y: 10, z: 0 };
    const direction = { x: 0, y: -1, z: 0 };
    expect(groundHit(origin, direction, groundY, halfWidth, halfDepth)).toBe(
      true,
    );
  });

  it("hits a point inside the bounds off to one side", () => {
    const origin = { x: 0, y: 10, z: 0 };
    const direction = { x: 3, y: -10, z: 2 };
    expect(groundHit(origin, direction, groundY, halfWidth, halfDepth)).toBe(
      true,
    );
  });

  it("misses when the crossing point falls outside the map's width", () => {
    const origin = { x: 0, y: 10, z: 0 };
    // Crosses groundY at x = 100, well past halfWidth of 50.
    const direction = { x: 10, y: -1, z: 0 };
    expect(groundHit(origin, direction, groundY, halfWidth, halfDepth)).toBe(
      false,
    );
  });

  it("misses when the crossing point falls outside the map's depth", () => {
    const origin = { x: 0, y: 10, z: 0 };
    // Crosses groundY at z = 100, well past halfDepth of 40.
    const direction = { x: 0, y: -1, z: 10 };
    expect(groundHit(origin, direction, groundY, halfWidth, halfDepth)).toBe(
      false,
    );
  });

  it("misses a ray parallel to the plane, looking dead level", () => {
    const origin = { x: 0, y: 10, z: 0 };
    const direction = { x: 1, y: 0, z: 0 };
    expect(groundHit(origin, direction, groundY, halfWidth, halfDepth)).toBe(
      false,
    );
  });

  it("misses a ray so close to parallel it falls inside the epsilon", () => {
    const origin = { x: 0, y: 10, z: 0 };
    const direction = { x: 1, y: 1e-9, z: 0 };
    expect(groundHit(origin, direction, groundY, halfWidth, halfDepth)).toBe(
      false,
    );
  });

  it("misses when the plane crossing is behind the camera", () => {
    // Looking up and away from the ground plane below: t would be negative.
    const origin = { x: 0, y: 10, z: 0 };
    const direction = { x: 0, y: 1, z: 0 };
    expect(groundHit(origin, direction, groundY, halfWidth, halfDepth)).toBe(
      false,
    );
  });

  it("is exact right at the map's edge", () => {
    const origin = { x: 0, y: 10, z: 0 };
    const direction = { x: 50, y: -10, z: 0 };
    expect(groundHit(origin, direction, groundY, halfWidth, halfDepth)).toBe(
      true,
    );
  });
});
