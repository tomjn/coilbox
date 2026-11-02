/**
 * Tests for `groundHit`, the approximate ray/plane test that stands in for a
 * raycast against the terrain (issue #2326). It feeds the wheel gate in
 * `MapPreview3D` (issue #2331): a wheel over sky scrolls the page, and a wheel
 * over the map zooms. `releaseWheel` is `!hit`, so it has no test of its own.
 */

import { describe, expect, it } from "vitest";

import { boxHit, groundHit } from "./wheelGate";

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

  it("measures the bounds from a centre that is off the origin", () => {
    const origin = { x: 200, y: 10, z: 0 };
    const down = { x: 0, y: -1, z: 0 };
    // The map spans x 150..250 about a centre of 200, so straight below hits
    // and the same ray over the origin does not.
    expect(groundHit(origin, down, groundY, 50, 40, 200, 0)).toBe(true);
    expect(
      groundHit({ x: 0, y: 10, z: 0 }, down, groundY, 50, 40, 200, 0),
    ).toBe(false);
  });
});

describe("boxHit", () => {
  const min = { x: -1, y: 0, z: -1 };
  const max = { x: 1, y: 2, z: 1 };

  it("hits a ray through the middle of the box", () => {
    const origin = { x: 0, y: 1, z: 10 };
    expect(boxHit(origin, { x: 0, y: 0, z: -1 }, min, max)).toBe(true);
  });

  it("misses a ray that passes beside the box", () => {
    const origin = { x: 5, y: 1, z: 10 };
    expect(boxHit(origin, { x: 0, y: 0, z: -1 }, min, max)).toBe(false);
  });

  it("misses a box behind the ray's origin", () => {
    const origin = { x: 0, y: 1, z: 10 };
    expect(boxHit(origin, { x: 0, y: 0, z: 1 }, min, max)).toBe(false);
  });

  it("hits when the origin is already inside the box", () => {
    const origin = { x: 0, y: 1, z: 0 };
    expect(boxHit(origin, { x: 0.3, y: 0.2, z: 1 }, min, max)).toBe(true);
  });

  it("hits at a slant that enters through one face and leaves through another", () => {
    const origin = { x: -5, y: 1, z: 0 };
    expect(boxHit(origin, { x: 1, y: 0.1, z: 0 }, min, max)).toBe(true);
  });

  it("misses a ray parallel to a slab and outside it", () => {
    const origin = { x: 0, y: 5, z: 10 };
    expect(boxHit(origin, { x: 0, y: 0, z: -1 }, min, max)).toBe(false);
  });

  it("misses an empty box, whichever way the ray points", () => {
    const empty = {
      min: { x: Infinity, y: Infinity, z: Infinity },
      max: { x: -Infinity, y: -Infinity, z: -Infinity },
    };
    const origin = { x: 0, y: 1, z: 10 };
    expect(boxHit(origin, { x: 0, y: 0, z: -1 }, empty.min, empty.max)).toBe(
      false,
    );
    expect(
      boxHit(origin, { x: 0.1, y: 0.1, z: -1 }, empty.min, empty.max),
    ).toBe(false);
  });
});
