import { describe, expect, it } from "vitest";

import type { TerrainStep } from "./model";
import {
  buildSequence,
  cornerAdded,
  cornerMoved,
  cornerRemoved,
  enoughPoints,
  movedInSequence,
  movedStep,
  newStep,
  rectanglePoints,
  snapPoint,
  stepAdded,
  stepEdges,
  stepsWithoutBuilding,
  withKind,
} from "./terrainEdit";

const square: TerrainStep = {
  kind: "level",
  shape: "area",
  points: [
    { x: 0, z: 0 },
    { x: 64, z: 0 },
    { x: 64, z: 64 },
    { x: 0, z: 64 },
  ],
  height: 0,
  before: 0,
};

const wall = (before: number, x = 0): TerrainStep => ({
  kind: "raise",
  shape: "wall",
  points: [
    { x, z: 0 },
    { x, z: 64 },
  ],
  height: 40,
  before,
});

describe("drawing a step", () => {
  it("snaps points to the 8 elmo heightmap grid", () => {
    expect(snapPoint({ x: 13, z: -3 })).toEqual({ x: 16, z: 0 });
    expect(snapPoint({ x: -13, z: 3.9 })).toEqual({ x: -16, z: 0 });
  });

  it("starts a wall as Raise and an area as Level", () => {
    const points = [
      { x: 0, z: 0 },
      { x: 32, z: 0 },
      { x: 32, z: 32 },
    ];
    expect(newStep("wall", points)).toMatchObject({
      kind: "raise",
      shape: "wall",
      before: 0,
    });
    expect(newStep("area", points)).toMatchObject({
      kind: "level",
      shape: "area",
      height: 0,
    });
    expect(newStep("smooth", points)).toMatchObject({
      kind: "smooth",
      shape: "area",
    });
    expect(newStep("smooth", points).height).toBeUndefined();
  });

  it("makes a ramp of its two ends, low end first", () => {
    const ramp = newStep("ramp", [
      { x: 0, z: 0 },
      { x: 0, z: 100 },
    ]);
    expect(ramp.shape).toBe("wall");
    expect(ramp.points).toEqual([
      { x: 0, z: 0 },
      { x: 0, z: 104 },
    ]);
    expect(ramp.heights?.[0]).toBeLessThan(ramp.heights?.[1] ?? 0);
    expect(ramp.width).toBeGreaterThan(0);
  });

  it("knows when a tool has enough points", () => {
    expect(enoughPoints("wall", 1)).toBe(false);
    expect(enoughPoints("wall", 2)).toBe(true);
    expect(enoughPoints("area", 2)).toBe(false);
    expect(enoughPoints("smooth", 3)).toBe(true);
    expect(enoughPoints("ramp", 2)).toBe(true);
  });

  it("drags a rectangle out as four corners going round", () => {
    expect(rectanglePoints({ x: 0, z: 0 }, { x: 30, z: 20 })).toEqual([
      { x: 0, z: 0 },
      { x: 32, z: 0 },
      { x: 32, z: 24 },
      { x: 0, z: 24 },
    ]);
    expect(rectanglePoints({ x: 0, z: 0 }, { x: 2, z: 50 })).toBeNull();
  });
});

describe("reshaping a step", () => {
  it("moves every point by a snapped delta", () => {
    expect(movedStep(square, { x: 10, z: -9 }).points[0]).toEqual({
      x: 8,
      z: -8,
    });
  });

  it("moves one corner and leaves the rest", () => {
    const moved = cornerMoved(square, 2, { x: 15, z: 0 });
    expect(moved.points[2]).toEqual({ x: 80, z: 64 });
    expect(moved.points[1]).toEqual(square.points[1]);
  });

  it("closes an area's sides and leaves a wall's open", () => {
    expect(stepEdges(square)).toEqual([0, 1, 2, 3]);
    expect(stepEdges(wall(0))).toEqual([0]);
    expect(stepEdges(newStep("ramp", square.points))).toEqual([]);
  });

  it("adds a corner on a side, after the corner the side starts at", () => {
    const added = cornerAdded(square, 3, { x: -22, z: 32 });
    expect(added.points).toHaveLength(5);
    expect(added.points[4]).toEqual({ x: -24, z: 32 });
  });

  it("removes a corner but never below the fewest a step needs", () => {
    expect(cornerRemoved(square, 0).points).toHaveLength(3);
    const triangle = cornerRemoved(square, 0);
    expect(cornerRemoved(triangle, 0)).toBe(triangle);
    expect(cornerRemoved(wall(0), 0).points).toHaveLength(2);
  });

  it("switches a wall or area between Raise and Level, keeping its height", () => {
    const raised = withKind({ ...square, height: 24 }, "raise");
    expect(raised).toMatchObject({ kind: "raise", height: 24 });
    const ramp = newStep("ramp", square.points);
    expect(withKind(ramp, "level")).toBe(ramp);
  });
});

describe("steps in the build order", () => {
  it("lists steps among the buildings by `before`", () => {
    expect(buildSequence(2, [wall(1), wall(0), wall(2)])).toEqual([
      { kind: "step", index: 1 },
      { kind: "building", index: 0 },
      { kind: "step", index: 0 },
      { kind: "building", index: 1 },
      { kind: "step", index: 2 },
    ]);
  });

  it("puts a new step before every building, after the steps already there", () => {
    const added = stepAdded([wall(0), wall(1)], { ...square, before: 3 });
    expect(added.index).toBe(1);
    expect(added.terrain[1]).toMatchObject({ kind: "level", before: 0 });
  });

  it("keeps the steps after a deleted building in their place", () => {
    expect(
      stepsWithoutBuilding([wall(0), wall(1), wall(2)], 0).map((s) => s.before),
    ).toEqual([0, 0, 1]);
  });

  it("moves a step past a building", () => {
    const down = movedInSequence(2, [wall(0)], { kind: "step", index: 0 }, 1);
    expect(down).toEqual({ steps: [wall(1)], index: 0 });
    const up = movedInSequence(2, [wall(1)], { kind: "step", index: 0 }, -1);
    expect(up).toEqual({ steps: [wall(0)], index: 0 });
  });

  it("moves a step past another step by swapping them", () => {
    const moved = movedInSequence(
      1,
      [wall(0, 0), wall(0, 8)],
      { kind: "step", index: 0 },
      1,
    );
    expect(moved).toEqual({ steps: [wall(0, 8), wall(0, 0)], index: 1 });
  });

  it("moves a building past a step by moving the step round it", () => {
    const up = movedInSequence(
      2,
      [wall(1)],
      { kind: "building", index: 1 },
      -1,
    );
    expect(up).toEqual({ steps: [wall(2)], index: 0 });
    const down = movedInSequence(
      2,
      [wall(1)],
      { kind: "building", index: 0 },
      1,
    );
    expect(down).toEqual({ steps: [wall(0)], index: 0 });
  });

  it("hands a building passing a building to the buildings' own move", () => {
    expect(movedInSequence(2, [], { kind: "building", index: 0 }, 1)).toEqual({
      buildings: { index: 0, delta: 1 },
    });
  });

  it("stops at either end", () => {
    expect(movedInSequence(1, [wall(0)], { kind: "step", index: 0 }, -1)).toBe(
      null,
    );
    expect(
      movedInSequence(1, [wall(0)], { kind: "building", index: 0 }, 1),
    ).toBeNull();
  });

  it("lands a step that moves into a group next to the building it passed", () => {
    // Two steps already after building 0. Moving the step before it down puts
    // it first among them, straight after building 0.
    const moved = movedInSequence(
      1,
      [wall(1, 8), wall(0, 0), wall(1, 16)],
      { kind: "step", index: 1 },
      1,
    );
    expect(moved).toEqual({
      steps: [wall(1, 0), wall(1, 8), wall(1, 16)],
      index: 0,
    });
  });
});
