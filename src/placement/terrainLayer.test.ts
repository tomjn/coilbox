import { describe, expect, it } from "vitest";

import type { TerrainStep } from "@/blueprint/model";
import { terraform } from "@/blueprint/terraform";
import { boundaryRuns, drawnRuns, terrainMarks } from "./terrainLayer";

const square = (x: number, z: number, n: number) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) out.push({ x: x + i * 8, z: z + j * 8 });
  }
  return out;
};

const length = (run: { x: number; z: number }[]) =>
  Math.hypot(run[1].x - run[0].x, run[1].z - run[0].z);

describe("boundaryRuns", () => {
  it("goes round the squares the corners own", () => {
    const runs = boundaryRuns(square(100 * 8, 100 * 8, 3));
    // Four sides, each one run of 24 elmos and not three runs of 8.
    expect(runs).toHaveLength(4);
    for (const run of runs) expect(length(run)).toBe(24);
    const xs = runs.flatMap((run) => run.map((p) => p.x));
    expect(Math.min(...xs)).toBe(796);
    expect(Math.max(...xs)).toBe(820);
  });

  it("leaves a corner out of the line where its neighbours are", () => {
    // An L of three corners has six edges, not eight.
    const runs = boundaryRuns([
      { x: 800, z: 800 },
      { x: 808, z: 800 },
      { x: 800, z: 808 },
    ]);
    expect(runs).toHaveLength(6);
  });

  it("is nothing for nothing", () => {
    expect(boundaryRuns([])).toEqual([]);
  });
});

describe("drawnRuns", () => {
  it("closes an area", () => {
    const step: TerrainStep = {
      kind: "level",
      shape: "area",
      points: [
        { x: 0, z: 0 },
        { x: 64, z: 0 },
        { x: 64, z: 64 },
      ],
      height: 10,
      before: 0,
    };
    const [run] = drawnRuns(step);
    expect(run).toHaveLength(4);
    expect(run[3]).toEqual(run[0]);
  });

  it("leaves a wall open", () => {
    const [run] = drawnRuns({
      kind: "raise",
      shape: "wall",
      points: [
        { x: 0, z: 0 },
        { x: 64, z: 0 },
      ],
      height: 10,
      before: 0,
    });
    expect(run).toHaveLength(2);
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

  it("outlines the ground a step took and dashes the edge of its slope", () => {
    const { steps } = terraform(flat, [wall], placement, []);
    const [mark] = terrainMarks([wall], placement, steps);
    expect(mark.asDrawn).toBe(false);
    expect(mark.tone).toBe("up");
    expect(mark.solid.length).toBeGreaterThan(0);
    expect(mark.dashed.length).toBeGreaterThan(0);
    // The dashed edge is outside the solid one: a slope is ground the step took
    // beyond its own.
    const reach = (runs: { x: number; z: number }[][]) =>
      Math.max(...runs.flatMap((run) => run.map((p) => p.z))) -
      Math.min(...runs.flatMap((run) => run.map((p) => p.z)));
    expect(reach(mark.dashed)).toBeGreaterThan(reach(mark.solid));
  });

  it("is grey for ground dug", () => {
    const { steps } = terraform(flat, [trench], placement, []);
    expect(terrainMarks([trench], placement, steps)[0].tone).toBe("down");
  });

  it("draws the step as drawn when the steps are not applied", () => {
    const [mark] = terrainMarks([wall], placement, null);
    expect(mark.asDrawn).toBe(true);
    expect(mark.dashed).toEqual([]);
    expect(mark.solid[0]).toEqual([
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
    expect(terrainMarks([huge], placement, steps)[0].asDrawn).toBe(true);
  });
});
