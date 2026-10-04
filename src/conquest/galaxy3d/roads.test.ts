import { describe, expect, it } from "vitest";
import {
  pairKey,
  ROAD_LIFT,
  roadLinks,
  roadRibbon,
  roadStep,
  sampleRoadPath,
} from "./roads";
import { createTerrainSurface, type HeightGrid } from "./terrain";

/** A 3 by 3 grid with a single peak in the middle. */
const peak: HeightGrid = {
  data: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0]),
  width: 3,
  height: 3,
};

/** A 2 by 2 grid rising from 0 on the left edge to 1 on the right. */
const ramp: HeightGrid = {
  data: new Float32Array([0, 1, 0, 1]),
  width: 2,
  height: 2,
};

const spec = { width: 100, height: 100, heightScale: 10 };

describe("roadLinks", () => {
  const nodes = [
    { id: "city-a" },
    { id: "city-b" },
    { id: "prov-a", outline: [[[0, 0] as [number, number]]] },
    { id: "prov-b", outline: [[[1, 1] as [number, number]]] },
  ];
  const draws = (
    link: [string, string],
    linkKinds?: [string, string, "border" | "crossing" | "road"][],
  ) => roadLinks({ nodes, links: [link], linkKinds }).length === 1;

  it("draws a link with no stated kind between two point locations", () => {
    expect(draws(["city-a", "city-b"])).toBe(true);
  });

  it("draws a link between a point location and a province", () => {
    expect(draws(["city-a", "prov-a"])).toBe(true);
    expect(draws(["prov-a", "city-a"], [["city-a", "prov-a", "border"]])).toBe(
      true,
    );
  });

  it("draws a road between two provinces", () => {
    expect(draws(["prov-a", "prov-b"], [["prov-b", "prov-a", "road"]])).toBe(
      true,
    );
  });

  it("draws no line for two provinces that only touch", () => {
    expect(draws(["prov-a", "prov-b"])).toBe(false);
    expect(draws(["prov-a", "prov-b"], [["prov-a", "prov-b", "border"]])).toBe(
      false,
    );
  });

  it("leaves a crossing out, whatever its ends are", () => {
    expect(
      draws(["city-a", "city-b"], [["city-b", "city-a", "crossing"]]),
    ).toBe(false);
    expect(
      draws(["prov-a", "prov-b"], [["prov-a", "prov-b", "crossing"]]),
    ).toBe(false);
  });

  it("leaves out a link to a node the document does not have", () => {
    expect(draws(["city-a", "nowhere"])).toBe(false);
  });

  it("keeps the ends in the order the link has them", () => {
    expect(roadLinks({ nodes, links: [["city-b", "city-a"]] })).toEqual([
      { a: "city-b", b: "city-a" },
    ]);
  });
});

describe("pairKey", () => {
  it("matches a pair either way round", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
    expect(pairKey("a", "b")).not.toBe(pairKey("a", "c"));
  });
});

describe("sampleRoadPath", () => {
  it("is a straight level line on a flat sheet", () => {
    const flat = createTerrainSurface(spec, 200);
    const path = sampleRoadPath(flat, [10, 20], [90, 60]);
    expect(path.length).toBeGreaterThanOrEqual(2);
    const first = path[0];
    const last = path[path.length - 1];
    path.forEach((p, i) => {
      const t = i / (path.length - 1);
      expect(p[0]).toBeCloseTo(first[0] + (last[0] - first[0]) * t, 5);
      expect(p[1]).toBeCloseTo(ROAD_LIFT, 5);
      expect(p[2]).toBeCloseTo(first[2] + (last[2] - first[2]) * t, 5);
    });
  });

  it("puts its end points over the two anchors", () => {
    const hill = createTerrainSurface(spec, 200, peak);
    const path = sampleRoadPath(hill, [10, 50], [70, 30], 0.5);
    expect(path[0]).toEqual(hill.mapToWorld(10, 50, 0.5));
    expect(path[path.length - 1]).toEqual(hill.mapToWorld(70, 30, 0.5));
  });

  it("climbs a hill that stands between the ends", () => {
    const hill = createTerrainSurface(spec, 200, peak);
    const path = sampleRoadPath(hill, [0, 50], [100, 50]);
    const ends = Math.max(path[0][1], path[path.length - 1][1]);
    const middle = path[(path.length - 1) / 2];
    // The peak is heightScale map units tall, drawn at the surface's scale.
    expect(middle[1]).toBeCloseTo(10 * hill.scale + ROAD_LIFT, 5);
    expect(middle[1]).toBeGreaterThan(ends);
    for (const p of path.slice(1, -1)) expect(p[1]).toBeGreaterThan(ends);
  });

  it("keeps every point on the ground it passes over", () => {
    const hill = createTerrainSurface(spec, 200, peak);
    for (const p of sampleRoadPath(hill, [5, 12], [95, 80])) {
      expect(p[1]).toBeCloseTo(
        hill.groundHeightAtWorld(p[0], p[2]) + ROAD_LIFT,
        5,
      );
    }
  });

  it("samples at least twice per mesh cell", () => {
    const hill = createTerrainSurface(spec, 200, peak);
    // A 3 pixel heightmap gives 2 cells of 50 map units along each side.
    expect(roadStep(hill)).toBe(25);
    expect(sampleRoadPath(hill, [0, 50], [100, 50])).toHaveLength(5);
  });

  it("gives a road between two nodes on one spot two points", () => {
    const flat = createTerrainSurface(spec, 200);
    expect(sampleRoadPath(flat, [40, 40], [40, 40])).toHaveLength(2);
  });
});

describe("roadRibbon", () => {
  it("gives two vertices per path point and two triangles per step", () => {
    const flat = createTerrainSurface(spec, 200);
    const a = sampleRoadPath(flat, [0, 50], [100, 50]);
    const b = sampleRoadPath(flat, [50, 0], [50, 10]);
    const ribbon = roadRibbon(flat, [a, b]);
    expect(ribbon.positions).toHaveLength((a.length + b.length) * 6);
    expect(ribbon.indices).toHaveLength((a.length - 1 + b.length - 1) * 6);
    expect(ribbon.ranges).toEqual([
      [0, a.length * 2],
      [a.length * 2, b.length * 2],
    ]);
    expect(Math.max(...ribbon.indices)).toBe((a.length + b.length) * 2 - 1);
  });

  it("is as wide as asked, across the road's direction", () => {
    const flat = createTerrainSurface(spec, 200);
    // Runs along world X, so the two edges differ in world Z alone.
    const path = sampleRoadPath(flat, [0, 50], [100, 50]);
    const { positions } = roadRibbon(flat, [path], 2);
    expect(positions[0]).toBeCloseTo(positions[3], 5);
    expect(Math.abs(positions[2] - positions[5])).toBeCloseTo(2, 5);
  });

  it("lays each edge on its own ground on a slope across the road", () => {
    const slope = createTerrainSurface(spec, 200, ramp);
    // Runs down the map, so the ramp rises from one edge of the road to the
    // other.
    const path = sampleRoadPath(slope, [50, 0], [50, 100]);
    const { positions } = roadRibbon(slope, [path], 4, 0.25);
    for (let v = 0; v < positions.length / 3; v++) {
      const [x, y, z] = positions.slice(v * 3, v * 3 + 3);
      expect(y).toBeCloseTo(slope.groundHeightAtWorld(x, z) + 0.25, 5);
    }
    expect(positions[1]).not.toBeCloseTo(positions[4], 2);
  });

  it("gives an empty path an empty range", () => {
    const flat = createTerrainSurface(spec, 200);
    const ribbon = roadRibbon(flat, [[]]);
    expect(ribbon.positions).toHaveLength(0);
    expect(ribbon.ranges).toEqual([[0, 0]]);
  });
});
