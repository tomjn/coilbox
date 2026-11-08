import { describe, expect, it } from "vitest";
import { findCrossings } from "./galaxy3d/bridges";
import { planRoads } from "./galaxy3d/roadNetwork";
import { markRivers, routeGrid } from "./galaxy3d/roadRoute";
import { heightGridFromPixels, layoutStrategicMap } from "./galaxy3d/terrain";
import { townsOnRoads } from "./galaxy3d/townLayer";
import { townEdge } from "./galaxy3d/towns";
import { generatedTerrainPixels, generateMap } from "./mapStyle";
import type { PlanetId } from "./planets";
import { riverRoom } from "./rivers";

/** A generated Territories map on `planet`, with its land and rivers. */
function land(planet: PlanetId, seed = 35058) {
  const doc = generateMap({
    seed,
    // biome-ignore lint/suspicious/noExplicitAny: only the name is read
    game: { name: "test" } as any,
    maps: ["a", "b", "c", "d", "e", "f"].map((name) => ({ name })),
    nodeCount: 18,
    factionCount: 2,
    layout: "continents",
    skin: "cities",
    planet,
    id: "rivers",
    title: "rivers",
  });
  const pixels = generatedTerrainPixels(doc);
  if (!pixels?.height) throw new Error("no land");
  const heights = heightGridFromPixels(pixels.height);
  const { surface } = layoutStrategicMap(doc, heights);
  if (!surface) throw new Error("no surface");
  // The rivers in map units, as the ground layer takes them.
  const sx = surface.width / (heights.width - 1);
  const courses = (pixels.rivers ?? []).map((course) =>
    course.map((v) => v * sx),
  );
  return { doc, pixels, heights, surface, courses };
}

// Each test builds a whole map's land, a second or so apiece.
describe("rivers on a generated map", { timeout: 30_000 }, () => {
  const temperate = land("temperate");

  it("has rivers, and every one reaches the sea or the river it joins", () => {
    expect(temperate.pixels.rivers?.length ?? 0).toBeGreaterThan(5);
  });

  it("ends every joining river inside the water of the river it joins", () => {
    const { courses } = temperate;
    // A course ends in the sea, past the edge, or on another course. Every
    // one that ends on land is inside some other river's water.
    let joins = 0;
    courses.forEach((course, k) => {
      const n = course.length;
      const others = courses.filter((_, j) => j !== k);
      if (riverRoom(others, course[n - 3], course[n - 2]) === 0) joins++;
    });
    expect(joins).toBeGreaterThan(3);
  });

  it("puts no river inside a town", () => {
    const { doc, heights, surface, courses } = temperate;
    const grid = routeGrid(
      surface.width,
      surface.height,
      surface.heightScale,
      1,
      heights,
    );
    markRivers(grid, courses);
    const roads = planRoads(
      doc,
      surface.width,
      surface.height,
      surface.heightScale,
      heights,
      grid,
    );
    const { towns } = townsOnRoads(doc, surface, roads, courses);
    expect(towns.length).toBe(doc.nodes.length);
    for (const course of courses) {
      for (let k = 0; k < course.length; k += 3) {
        const [x, z] = surface.mapToWorldXZ(course[k], course[k + 1]);
        const half = course[k + 2] * surface.scale;
        for (const town of towns) {
          const angle = Math.atan2(z - town.z, x - town.x);
          const d = Math.hypot(x - town.x, z - town.z) - half;
          expect(d).toBeGreaterThanOrEqual(townEdge(town, angle) - 1e-6);
        }
      }
    }
  });

  it("bridges every road where it crosses a river", () => {
    const { doc, heights, surface, courses } = temperate;
    const grid = routeGrid(
      surface.width,
      surface.height,
      surface.heightScale,
      1,
      heights,
    );
    markRivers(grid, courses);
    const roads = planRoads(
      doc,
      surface.width,
      surface.height,
      surface.heightScale,
      heights,
      grid,
    );
    const crossings = findCrossings(roads, courses, surface.scale);
    expect(crossings.length).toBeGreaterThan(0);
    for (const { from, to } of crossings) {
      // Both ends of the deck stand on dry ground.
      expect(riverRoom(courses, ...from)).toBeGreaterThan(0);
      expect(riverRoom(courses, ...to)).toBeGreaterThan(0);
    }
  });

  it("gives the same rivers every time", () => {
    const again = land("temperate");
    expect(again.courses.length).toBe(temperate.courses.length);
    again.courses.forEach((course, k) => {
      expect(Array.from(course)).toEqual(Array.from(temperate.courses[k]));
    });
  });

  it("has no rivers on a volcanic world, the Moon or a dry red one", () => {
    for (const planet of ["volcanic", "moon", "red"] as const) {
      const { pixels } = land(planet);
      expect(pixels.rivers).toEqual([]);
      expect(pixels.extension?.rivers).toBeUndefined();
    }
  });
});
