import { describe, expect, it } from "vitest";
import {
  buildRoadMask,
  ROAD_REACH,
  type RoadLine,
  roadMaskSize,
  SURFACE_BYTE,
} from "./roadMask";

// A map 100 by 50 map units at 0.1 world units per map unit, drawn 40 texels
// across, so a texel is 2.5 map units, or 0.25 world units.
const SCALE = 0.1;
const roads: RoadLine[] = [
  // Along the row of texel centres at map y 26.25.
  {
    line: [
      [0, 26.25],
      [100, 26.25],
    ],
    surface: "paved",
    index: 0,
  },
  // Scenery down the column of texel centres at map x 78.75.
  {
    line: [
      [78.75, 0],
      [78.75, 50],
    ],
    surface: "track",
  },
];
const mask = buildRoadMask(roads, 100, 50, SCALE, 40);
const texel = (i: number, j: number) => {
  const o = (j * mask.width + i) * 4;
  return Array.from(mask.data.slice(o, o + 4));
};

describe("roadMaskSize", () => {
  it("keeps the map's shape", () => {
    expect(roadMaskSize(100, 50, 40)).toEqual({ width: 40, height: 20 });
    expect(roadMaskSize(30, 90, 300)).toEqual({ width: 100, height: 300 });
  });
});

describe("buildRoadMask", () => {
  it("covers the map at the size asked for", () => {
    expect(mask.width).toBe(40);
    expect(mask.height).toBe(20);
    expect(mask.data).toHaveLength(40 * 20 * 4);
  });

  it("records a texel on a road as no distance, with its surface and index", () => {
    expect(texel(5, 10)).toEqual([0, SURFACE_BYTE.paved, 0, 1]);
  });

  it("records the distance to the road as a share of the reach", () => {
    // One texel off the road is 0.25 world units from it.
    expect(texel(5, 11)[0]).toBe(Math.round((0.25 / ROAD_REACH) * 255));
    expect(texel(5, 11)[3]).toBe(1);
  });

  it("records nothing past the reach", () => {
    expect(texel(5, 0)).toEqual([255, 0, 0, 0]);
  });

  it("marks scenery with no index, so it has no state", () => {
    expect(texel(31, 3)).toEqual([0, SURFACE_BYTE.track, 0, 0]);
  });

  it("gives a texel to the nearest road", () => {
    // Where the two cross, the road given first wins the tie.
    expect(texel(31, 10)[3]).toBe(1);
    // Nearer the scenery than the road.
    expect(texel(32, 8)[3]).toBe(0);
  });

  it("splits an index above 255 across two bytes", () => {
    const big = buildRoadMask(
      [{ line: roads[0].line, surface: "gravel", index: 300 }],
      100,
      50,
      SCALE,
      40,
    );
    const o = (10 * big.width + 5) * 4;
    expect((big.data[o + 2] << 8) | big.data[o + 3]).toBe(301);
  });
});
