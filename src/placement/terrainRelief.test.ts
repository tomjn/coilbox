import { describe, expect, it } from "vitest";

import { slopeTolerance, standsOn } from "@/blueprint/buildable";
import { footprintMarks } from "@/blueprint/footprint";
import type { TerrainStep } from "@/blueprint/model";
import {
  type GroundHeights,
  type LayoutPlacement,
  terraform,
} from "@/blueprint/terraform";
import { decimateHeights } from "@/mapconv/heightGrid";
import { heightGrid } from "./terrain";
import {
  decimationFor,
  flatSource,
  gridSource,
  Relief,
  writeDisplacement,
} from "./terrainRelief";

/** A 2048 elmo square map, 257 corners a side, with hills that are not
 *  symmetrical, so a window that read the wrong corners would show. */
const SIDE = 257;
function hills(): GroundHeights {
  const heights = new Float32Array(SIDE * SIDE);
  for (let r = 0; r < SIDE; r++) {
    for (let c = 0; c < SIDE; c++) {
      heights[r * SIDE + c] =
        40 * Math.sin(c / 9) +
        30 * Math.cos(r / 7) +
        12 * Math.sin((c + r) / 3);
    }
  }
  return { width: SIDE, height: SIDE, heights };
}
const HILLS = hills();
const source = () => ({
  width: SIDE,
  height: SIDE,
  at: (i: number) => HILLS.heights[i],
  min: -100,
  max: 100,
  hasWater: true,
});

const wall = (height: number, before = 0): TerrainStep => ({
  kind: "raise",
  shape: "wall",
  points: [
    { x: -128, z: 0 },
    { x: 128, z: 0 },
  ],
  height,
  before,
});
const pad: TerrainStep = {
  kind: "level",
  shape: "area",
  points: [
    { x: -64, z: -64 },
    { x: 64, z: -64 },
    { x: 64, z: 64 },
    { x: -64, z: 64 },
  ],
  height: 24,
  before: 0,
};
const smooth: TerrainStep = { ...pad, kind: "smooth", height: undefined };
const ramp: TerrainStep = {
  kind: "ramp",
  shape: "wall",
  points: [
    { x: -96, z: 40 },
    { x: 96, z: 40 },
  ],
  heights: [0, 40],
  width: 48,
  before: 0,
};

const at = (x: number, z: number): LayoutPlacement => ({
  at: { x, z },
  quarters: 0,
});

function same(a: Float32Array, b: Float32Array) {
  expect(a.length).toBe(b.length);
  let wrong = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) wrong++;
  expect(wrong).toBe(0);
}

describe("Relief", () => {
  const cases: [string, TerrainStep[], LayoutPlacement][] = [
    ["a wall in the middle", [wall(60)], at(1024, 1024)],
    ["a pad, a smooth and a ramp", [pad, smooth, ramp], at(1000, 1032)],
    ["a trench", [wall(-50)], at(1024, 1024)],
    ["a layout against the north west corner", [wall(60), pad], at(64, 64)],
    ["a layout against the south east corner", [wall(60), pad], at(1990, 1990)],
    [
      "a layout turned and flipped",
      [wall(60), ramp],
      {
        at: { x: 900, z: 1100 },
        quarters: 1,
        flip: { x: true },
      },
    ],
    // 28 elmos of height a square: 1800 is a slope over 500 elmos long, which is
    // far past the first window.
    ["a wall taller than the first window", [wall(1800)], at(1024, 1024)],
  ];

  for (const [name, steps, placement] of cases) {
    it(`gives the map's own answer for ${name}`, () => {
      const relief = new Relief(source());
      relief.update(steps, placement, []);
      const full = terraform(HILLS, steps, placement, []);
      same(relief.heights, full.ground.heights);
      expect(relief.metal).toBeCloseTo(full.metal, 6);
      expect(relief.results).toEqual(full.steps);
    });
  }

  it("stops a step at the buildings before it, as the map does", () => {
    const steps = [wall(60, 1), wall(30, 0)];
    const blocker = { minX: 976, maxX: 1072, minZ: 1000, maxZ: 1048 };
    const relief = new Relief(source());
    relief.update(steps, at(1024, 1024), [blocker]);
    const full = terraform(HILLS, steps, at(1024, 1024), [blocker]);
    same(relief.heights, full.ground.heights);
  });

  it("puts the map's ground back when a step moves away", () => {
    const relief = new Relief(source());
    relief.update([wall(60)], at(1024, 1024), []);
    relief.update([wall(60)], at(1400, 600), []);
    const full = terraform(HILLS, [wall(60)], at(1400, 600), []);
    same(relief.heights, full.ground.heights);
    relief.update([], at(1400, 600), []);
    same(relief.heights, HILLS.heights);
  });

  it("reports the corners a move changed, old place and new", () => {
    const relief = new Relief(source());
    const first = relief.update([wall(60)], at(1024, 1024), []);
    const second = relief.update([wall(60)], at(1400, 600), []);
    const before = Float32Array.from(HILLS.heights);
    const first_full = terraform(HILLS, [wall(60)], at(1024, 1024), []);
    // Everything outside the reported block is as it was.
    const rect = second.rect;
    expect(rect).not.toBeNull();
    if (!rect || !first.rect) return;
    expect(rect.c0).toBeLessThanOrEqual(first.rect.c0);
    expect(rect.c1).toBeGreaterThanOrEqual(first.rect.c1);
    const touched = new Set<number>();
    for (let r = rect.r0; r <= rect.r1; r++) {
      for (let c = rect.c0; c <= rect.c1; c++) touched.add(r * SIDE + c);
    }
    for (let i = 0; i < before.length; i++) {
      if (touched.has(i)) continue;
      expect(relief.heights[i]).toBe(before[i]);
    }
    expect(first_full.ground.heights).not.toEqual(before);
    // What it hands back is the ground before the move, over that block.
    const w = rect.c1 - rect.c0 + 1;
    const some = (rect.r0 + 1) * SIDE + rect.c0 + 1;
    expect(second.before?.[w + 1]).toBe(first_full.ground.heights[some]);
  });

  it("touches a small part of a large map for a small step", () => {
    const relief = new Relief(source());
    const change = relief.update([pad], at(1024, 1024), []);
    const rect = change.rect;
    expect(rect).not.toBeNull();
    if (!rect) return;
    const corners = (rect.c1 - rect.c0 + 1) * (rect.r1 - rect.r0 + 1);
    expect(corners).toBeLessThan((SIDE * SIDE) / 4);
  });

  it("counts every update, so a reader knows the arrays moved", () => {
    const relief = new Relief(source());
    const was = relief.version;
    relief.update([wall(60)], at(1024, 1024), []);
    expect(relief.version).toBe(was + 1);
  });

  it("reports a range that holds a wall above the map's highest ground", () => {
    const relief = new Relief(source());
    expect(relief.ground().maxHeight).toBe(100);
    relief.update([wall(500)], at(1024, 1024), []);
    expect(relief.ground().maxHeight).toBeGreaterThan(400);
    relief.update([], at(1024, 1024), []);
    expect(relief.ground().maxHeight).toBe(100);
  });
});

describe("a building beside a raised wall", () => {
  // A 2 by 2 build square building, 32 elmos across, which tolerates 10 degrees.
  const flat = () => new Relief(flatSource(257, 257));
  const tolerance = slopeTolerance(10);
  const limits = {
    tolerance,
    floats: false,
    waterline: 0,
    minWaterDepth: -10e6,
    maxWaterDepth: 10e6,
  };
  const standing = (x: number) =>
    footprintMarks(
      [{ key: "b", def: "armsolar", pos: { x, z: 1024 }, facing: 0 as const }],
      () => ({ x: 2, z: 2 }),
    )[0];

  it("is fine on the flat the editor starts with", () => {
    expect(standsOn(standing(1024), flat().ground(), limits)).toBe("fine");
  });

  it("is marked as on a slope when it stands on the wall's slope", () => {
    const relief = flat();
    // A wall of 100 along x at z 1024, 8 elmos of ground take 28 of height.
    relief.update([wall(100)], at(1024, 1024), []);
    // On the wall's top, level, so nothing is wrong.
    expect(standsOn(standing(1024), relief.ground(), limits)).toBe("fine");
    // Its slope is where the ground falls away across the wall's width.
    const onSlope = footprintMarks(
      [
        {
          key: "b",
          def: "armsolar",
          pos: { x: 1024, z: 1024 + 40 },
          facing: 0 as const,
        },
      ],
      () => ({ x: 2, z: 2 }),
    )[0];
    expect(standsOn(onSlope, relief.ground(), limits)).toBe("slope");
  });

  it("is fine again once the wall is gone", () => {
    const relief = flat();
    relief.update([wall(100)], at(1024, 1024), []);
    relief.update([], at(1024, 1024), []);
    const onSlope = footprintMarks(
      [
        {
          key: "b",
          def: "armsolar",
          pos: { x: 1024, z: 1064 },
          facing: 0 as const,
        },
      ],
      () => ({ x: 2, z: 2 }),
    )[0];
    expect(standsOn(onSlope, relief.ground(), limits)).toBe("fine");
  });

  it("gives a trench room below the floor", () => {
    const relief = flat();
    relief.update([wall(-40)], at(1024, 1024), []);
    expect(Math.min(...relief.heights)).toBeLessThan(-30);
    expect(relief.ground().minHeight).toBeLessThan(-30);
  });
});

describe("writeDisplacement", () => {
  it("matches decimateHeights over the whole grid", () => {
    const words = new Uint16Array(SIDE * SIDE);
    for (let i = 0; i < words.length; i++) words[i] = (i * 7919) % 65536;
    const grid = heightGrid(words.buffer, SIDE, SIDE);
    expect(grid).not.toBeNull();
    if (!grid) return;
    // A 129 sample texture of a 257 corner grid takes two corners a sample.
    const expected = decimateHeights(
      { words: grid.words, width: SIDE, height: SIDE },
      129,
    );
    const src = gridSource(grid, -500, 1500);
    const relief = new Relief(src);
    const data = new Float32Array(expected.data.length);
    writeDisplacement(
      data,
      decimationFor(grid, expected),
      grid,
      { c0: 0, r0: 0, c1: SIDE - 1, r1: SIDE - 1 },
      (i) => relief.heights[i],
      -500,
      1500,
    );
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeCloseTo(expected.data[i], 4);
    }
  });

  it("rewrites only the samples a block reaches", () => {
    const grid = { width: SIDE, height: SIDE };
    const heights = new Float32Array(SIDE * SIDE).fill(10);
    const data = new Float32Array(129 * 129).fill(-7);
    writeDisplacement(
      data,
      decimationFor(grid, { width: 129, height: 129 }),
      grid,
      { c0: 100, r0: 100, c1: 103, r1: 103 },
      (i) => heights[i],
      0,
      100,
    );
    const written = data.filter((v) => v !== -7).length;
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThan(16);
    expect(data.find((v) => v !== -7)).toBeCloseTo(0.1, 6);
  });

  it("does not clamp a height above the range", () => {
    const grid = { width: 3, height: 3 };
    const data = new Float32Array(9);
    writeDisplacement(
      data,
      decimationFor(grid, { width: 3, height: 3 }),
      grid,
      { c0: 0, r0: 0, c1: 2, r1: 2 },
      () => 300,
      0,
      100,
    );
    expect(data[0]).toBe(3);
  });
});
