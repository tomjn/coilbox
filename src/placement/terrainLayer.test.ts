import { describe, expect, it } from "vitest";

import type { TerrainStep } from "@/blueprint/model";
import { terraform } from "@/blueprint/terraform";
import {
  CELL_LIMIT,
  drawnRuns,
  overlayMesh,
  terrainMarks,
} from "./terrainLayer";

const wall: TerrainStep = {
  kind: "raise",
  shape: "wall",
  points: [
    { x: -64, z: 0 },
    { x: 64, z: 0 },
  ],
  height: 60,
  before: 0,
};
const trench: TerrainStep = { ...wall, height: -30 };
const placement = { at: { x: 512, z: 512 }, quarters: 0 };
const flat = {
  width: 129,
  height: 129,
  heights: new Float32Array(129 * 129),
};

/** The overlay of one step on flat ground, read off the finished heights. */
function overlayOf(step: TerrainStep) {
  const done = terraform(flat, [step], placement, []);
  const [mark] = terrainMarks([step], placement, done.steps);
  const heightAt = (x: number, z: number) =>
    done.ground.heights[(z / 8) * 129 + x / 8];
  return {
    mark,
    mesh: overlayMesh(mark.corners ?? [], heightAt, () => 0),
  };
}

/** The heights of every vertex in a flat `x, y, z` run. */
const ys = (run: number[]) => run.filter((_, i) => i % 3 === 1);

describe("overlayMesh", () => {
  it("makes a raised wall green faces, wire on top and down the slope", () => {
    const { mesh } = overlayOf(wall);
    expect(mesh.upFaces.length).toBeGreaterThan(0);
    expect(mesh.downFaces).toEqual([]);
    expect(mesh.upWire.length).toBeGreaterThan(0);
    // The faces reach the wall's top and come down to the ground's own height.
    expect(Math.max(...ys(mesh.upFaces))).toBe(60);
    expect(Math.min(...ys(mesh.upFaces))).toBeLessThan(60);
  });

  it("makes a trench red", () => {
    const { mesh } = overlayOf(trench);
    expect(mesh.downFaces.length).toBeGreaterThan(0);
    expect(mesh.upFaces).toEqual([]);
    expect(Math.min(...ys(mesh.downFaces))).toBe(-30);
  });

  it("puts the ground grid on the ground, lifted a little, over the whole area", () => {
    const { mesh } = overlayOf(wall);
    for (const y of ys(mesh.grid)) expect(y).toBe(1);
    // Slopes included: the grid reaches past the wall's own 32 elmo top.
    const zs = mesh.grid.filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(32);
  });

  it("draws a shared cell edge once", () => {
    // Two corners side by side own six cells, not eight.
    const mesh = overlayMesh(
      [
        { x: 800, z: 800 },
        { x: 808, z: 800 },
      ],
      () => 10,
      () => 0,
    );
    expect(mesh.cells).toBe(6);
    // Two triangles of three vertices of three numbers a cell.
    expect(mesh.upFaces.length / 18).toBe(6);
  });

  it("draws no face where the ground moved under half an elmo", () => {
    const mesh = overlayMesh(
      [{ x: 800, z: 800 }],
      () => 0.2,
      () => 0,
    );
    expect(mesh.upFaces).toEqual([]);
    expect(mesh.downFaces).toEqual([]);
    expect(mesh.grid.length).toBeGreaterThan(0);
  });

  it("is not drawn for a step with more cells than the widget draws", () => {
    const corners = [];
    const side = Math.ceil(Math.sqrt(CELL_LIMIT)) + 2;
    for (let x = 0; x < side; x++) {
      for (let z = 0; z < side; z++) corners.push({ x: x * 8, z: z * 8 });
    }
    const mesh = overlayMesh(
      corners,
      () => 10,
      () => 0,
    );
    expect(mesh.capped).toBe(true);
    expect(mesh.upFaces).toEqual([]);
  });
});

describe("drawnRuns", () => {
  it("closes an area", () => {
    const [run] = drawnRuns({
      kind: "level",
      shape: "area",
      points: [
        { x: 0, z: 0 },
        { x: 64, z: 0 },
        { x: 64, z: 64 },
      ],
      height: 10,
      before: 0,
    });
    expect(run).toHaveLength(4);
    expect(run[3]).toEqual(run[0]);
  });

  it("leaves a wall open", () => {
    expect(drawnRuns(wall)[0]).toHaveLength(2);
  });

  it("draws a ramp as the band it covers", () => {
    const [run] = drawnRuns({
      kind: "ramp",
      shape: "wall",
      points: [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
      ],
      heights: [0, 20],
      width: 40,
      before: 0,
    });
    const zs = run.map((p) => p.z);
    expect(Math.min(...zs)).toBe(-20);
    expect(Math.max(...zs)).toBe(20);
  });
});

describe("terrainMarks", () => {
  it("gives a step the ground took its corners, slope included", () => {
    const { mark } = overlayOf(wall);
    expect(mark.corners?.length).toBeGreaterThan(0);
  });

  it("draws the step as drawn when the steps are not applied", () => {
    const [mark] = terrainMarks([wall], placement, null);
    expect(mark.corners).toBeNull();
    expect(mark.drawn[0]).toEqual([
      { x: 448, z: 512 },
      { x: 576, z: 512 },
    ]);
  });

  it("draws a refused step as drawn", () => {
    const huge: TerrainStep = {
      kind: "raise",
      shape: "area",
      points: [
        { x: -4000, z: -4000 },
        { x: 4000, z: -4000 },
        { x: 4000, z: 4000 },
      ],
      height: 10,
      before: 0,
    };
    const { steps } = terraform(flat, [huge], placement, []);
    expect(steps[0].outcome).not.toBe("built");
    expect(terrainMarks([huge], placement, steps)[0].corners).toBeNull();
  });
});
