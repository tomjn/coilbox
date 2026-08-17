/**
 * Issue #1716. The circle that used to mark a selection was sized to be seen
 * rather than to fit, so it was wider than the unit under it by a long way and
 * covered the ground and the squares around it.
 *
 * The drawing is three.js and is not tested. The shape and the sizing are, and
 * they are the whole complaint.
 */

import { describe, expect, it } from "vitest";

import {
  hexagon,
  hexagonInset,
  MIN_PLATE_ELMOS,
  plateBorder,
  plateHalf,
} from "./selectionPlate";

describe("plateHalf", () => {
  it("stands out past the model without swallowing the ground round it", () => {
    const half = plateHalf({ x: 40, z: 40 }, 0);
    expect(half.x).toBeGreaterThan(22);
    expect(half.x).toBeLessThan(30);
  });

  /** The complaint itself: what goes under a unit is about that unit's size. A
   *  scout used to get the same 56 elmo radius a factory did. */
  it("sizes a long unit and a small one differently", () => {
    expect(plateHalf({ x: 120, z: 40 }, 0).x).toBeGreaterThan(
      plateHalf({ x: 40, z: 40 }, 0).x,
    );
  });

  it("keeps the two axes apart, so a long unit gets a long plate", () => {
    const half = plateHalf({ x: 120, z: 40 }, 0);
    expect(half.x).toBeGreaterThan(half.z);
  });

  /** A scout is a few pixels across at framing zoom, so there is a floor. It is
   *  a quarter of what the ring's was. */
  it("draws something under a unit too small to see", () => {
    expect(plateHalf({ x: 2, z: 2 }, MIN_PLATE_ELMOS)).toEqual({
      x: MIN_PLATE_ELMOS,
      z: MIN_PLATE_ELMOS,
    });
    expect(MIN_PLATE_ELMOS).toBeLessThan(56);
  });
});

describe("plateBorder", () => {
  it("takes its width from the shorter side, so no plate is all border", () => {
    expect(plateBorder({ x: 200, z: 20 }, 0)).toBe(
      plateBorder({ x: 20, z: 20 }, 0),
    );
  });

  it("keeps an edge on a plate too small to have one", () => {
    expect(plateBorder({ x: 1, z: 1 }, 1.2)).toBe(1.2);
  });
});

describe("hexagon", () => {
  it("has six points", () => {
    expect(hexagon({ x: 30, z: 20 })).toHaveLength(6);
  });

  it("reaches the plate's edge on both axes", () => {
    const points = hexagon({ x: 30, z: 20 });
    expect(Math.max(...points.map((p) => Math.abs(p.x)))).toBe(30);
    expect(Math.max(...points.map((p) => Math.abs(p.z)))).toBe(20);
  });

  /** What makes it a hexagon: a point at each end of the long axis with flat
   *  sides between them, rather than a rectangle. */
  it("comes to a point at each end", () => {
    const points = hexagon({ x: 30, z: 20 });
    const ends = points.filter((p) => Math.abs(p.x) === 30);
    expect(ends).toHaveLength(2);
    expect(ends.every((p) => p.z === 0)).toBe(true);
  });

  it("is symmetrical about both axes", () => {
    const points = hexagon({ x: 30, z: 20 });
    // Written out as a pair of sums rather than as an opposite of each point,
    // because the opposite of the point at zero is negative zero.
    expect(points.reduce((sum, p) => sum + p.x, 0)).toBe(0);
    expect(points.reduce((sum, p) => sum + p.z, 0)).toBe(0);
  });
});

describe("hexagonInset", () => {
  it("is the same shape, pulled in by the border", () => {
    const inner = hexagonInset({ x: 30, z: 20 }, 2);
    expect(inner).toEqual(hexagon({ x: 28, z: 18 }));
  });

  /** A plate whose border would eat the whole plate has no inside to cut out,
   *  and a hole bigger than its shape is a hole three cannot triangulate. */
  it("says nothing when the border would take the whole plate", () => {
    expect(hexagonInset({ x: 4, z: 2 }, 2)).toBeNull();
  });
});
