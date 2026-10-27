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
  trappingRings,
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

describe("steps in the build order (issue #4817)", () => {
  it("lists every step before every building, whatever `before` says", () => {
    expect(buildSequence(2, [wall(1), wall(0), wall(2)])).toEqual([
      { kind: "step", index: 0 },
      { kind: "step", index: 1 },
      { kind: "step", index: 2 },
      { kind: "building", index: 0 },
      { kind: "building", index: 1 },
    ]);
  });

  it("puts a new step after the other steps, and writes every step first", () => {
    const added = stepAdded([wall(0), wall(1)], { ...square, before: 3 });
    expect(added.index).toBe(2);
    expect(added.terrain.map((s) => s.before)).toEqual([0, 0, 0]);
    expect(added.terrain[2].kind).toBe("level");
  });

  it("moves a step past another step by swapping them", () => {
    expect(
      movedInSequence(
        1,
        [wall(0, 0), wall(0, 8)],
        { kind: "step", index: 0 },
        1,
      ),
    ).toEqual({ steps: [wall(0, 8), wall(0, 0)], index: 1 });
  });

  it("never moves a step below a building", () => {
    expect(
      movedInSequence(2, [wall(0)], { kind: "step", index: 0 }, 1),
    ).toBeNull();
  });

  it("never moves a building above a step", () => {
    expect(
      movedInSequence(2, [wall(0)], { kind: "building", index: 0 }, -1),
    ).toBeNull();
  });

  it("hands a building passing a building to the buildings' own move", () => {
    expect(
      movedInSequence(2, [wall(0)], { kind: "building", index: 0 }, 1),
    ).toEqual({ buildings: { index: 0, delta: 1 } });
  });

  it("writes a step read in with a later place as first when it moves", () => {
    const moved = movedInSequence(
      0,
      [wall(2, 0), wall(1, 8)],
      { kind: "step", index: 1 },
      -1,
    );
    expect(moved).toEqual({ steps: [wall(0, 8), wall(0, 0)], index: 0 });
  });
});

describe("trappingRings", () => {
  const ring = (height: number): TerrainStep => ({
    kind: "raise",
    shape: "wall",
    points: [
      { x: 0, z: 0 },
      { x: 320, z: 0 },
      { x: 320, z: 320 },
      { x: 0, z: 320 },
      { x: 0, z: 0 },
    ],
    height,
    before: 0,
  });
  const ramp = (
    from: { x: number; z: number },
    to: { x: number; z: number },
  ): TerrainStep => ({
    kind: "ramp",
    shape: "wall",
    points: [from, to],
    heights: [0, 112],
    width: 64,
    before: 0,
  });

  it("marks a raised wall that closes on itself", () => {
    expect(trappingRings([ring(112)])).toEqual([0]);
  });

  it("marks a dug ring too, since its slopes trap as well", () => {
    expect(trappingRings([ring(-40)])).toEqual([0]);
  });

  it("does not mark a ring with a ramp across it", () => {
    expect(
      trappingRings([ring(112), ramp({ x: 160, z: 160 }, { x: 160, z: 448 })]),
    ).toEqual([]);
  });

  it("still marks a ring when the ramp stays outside it", () => {
    expect(
      trappingRings([ring(112), ramp({ x: 400, z: 0 }, { x: 400, z: 320 })]),
    ).toEqual([0]);
  });

  it("does not mark a wall with a gap, an area or a ring that changes nothing", () => {
    const open = { ...ring(112), points: ring(112).points.slice(0, 4) };
    const area: TerrainStep = { ...ring(112), shape: "area" };
    expect(trappingRings([open, area, ring(0)])).toEqual([]);
  });

  it("gives each trapping ring's index among the steps", () => {
    expect(
      trappingRings([ramp({ x: 900, z: 0 }, { x: 900, z: 64 }), ring(112)]),
    ).toEqual([1]);
  });
});
