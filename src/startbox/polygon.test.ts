import { describe, expect, it } from "vitest";
import { labelAnchor, polygonPoints, toPreview, usableExtent } from "./polygon";

/** Dockside v2 is 14 by 12 map size units: 7168 by 6144 in world units. */
const DOCKSIDE = { x: 7168, z: 6144 };

describe("toPreview", () => {
  it("places a world point by its share of the map's width and height", () => {
    expect(toPreview([0, 0], DOCKSIDE)).toEqual({ left: 0, top: 0 });
    expect(toPreview([7168, 6144], DOCKSIDE)).toEqual({ left: 100, top: 100 });
    expect(toPreview([1792, 3072], DOCKSIDE)).toEqual({ left: 25, top: 50 });
  });

  it("scales x and z apart, so a map that is not square is not squashed", () => {
    const at = toPreview([3584, 3584], DOCKSIDE);
    expect(at.left).toBe(50);
    expect(at.top).toBeCloseTo((3584 / 6144) * 100);
  });

  it("lets a point past the edge land past 100, as the file wrote it", () => {
    expect(toPreview([7168 * 1.5, -6144 / 2], DOCKSIDE)).toEqual({
      left: 150,
      top: -50,
    });
  });
});

describe("polygonPoints", () => {
  it("writes each corner on the 0 to 100 viewBox, in order", () => {
    const west = [
      [0, 0],
      [0, 6144],
      [800, 6144],
      [800, 0],
    ] as const;
    const points = polygonPoints(west, DOCKSIDE)
      .split(" ")
      .map((p) => p.split(",").map(Number));
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual([0, 0]);
    expect(points[1]).toEqual([0, 100]);
    expect(points[2][0]).toBeCloseTo((800 / 7168) * 100, 2);
    expect(points[2][1]).toBe(100);
    expect(points[3][1]).toBe(0);
  });

  it("keeps every corner of a polygon with more than four", () => {
    const six = [
      [0, 0],
      [100, 0],
      [200, 100],
      [200, 200],
      [100, 300],
      [0, 200],
    ] as const;
    expect(polygonPoints(six, DOCKSIDE).split(" ")).toHaveLength(6);
  });
});

describe("labelAnchor", () => {
  it("is the middle of the box around every polygon of the area", () => {
    const at = labelAnchor(
      {
        polygons: [
          [
            [0, 0],
            [1792, 0],
            [1792, 1536],
          ],
          [
            [3584, 3072],
            [3584, 3072],
          ],
        ],
        points: [],
      },
      DOCKSIDE,
    );
    expect(at).toEqual({ left: 25, top: 25 });
  });

  it("falls back to the start points, then to nothing", () => {
    expect(
      labelAnchor({ polygons: [], points: [[7168, 6144]] }, DOCKSIDE),
    ).toEqual({ left: 100, top: 100 });
    expect(labelAnchor({ polygons: [], points: [] }, DOCKSIDE)).toBeNull();
  });
});

describe("usableExtent", () => {
  it("needs a size on both axes", () => {
    expect(usableExtent(DOCKSIDE)).toBe(true);
    expect(usableExtent({ x: 0, z: 6144 })).toBe(false);
    expect(usableExtent(null)).toBe(false);
  });
});
