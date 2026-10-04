import { describe, expect, it, vi } from "vitest";
import type { PlacedModel } from "../placedModels";
import {
  createFailureLog,
  groupPlacedModels,
  instanceTransform,
  modelRefKey,
} from "./modelPlacement";
import { createTerrainSurface, type HeightGrid } from "./terrain";

/** A 2 by 2 grid rising from 0 on the left edge to 1 on the right. */
const ramp: HeightGrid = {
  data: new Float32Array([0, 1, 0, 1]),
  width: 2,
  height: 2,
};

// 100 by 50 map units over 200 world units: 2 world units per map unit, and a
// white pixel is 10 map units, so 20 world units, high.
const surface = createTerrainSurface(
  { width: 100, height: 50, heightScale: 10 },
  200,
  ramp,
);

describe("instanceTransform", () => {
  it("stands a model on the ground at its map position", () => {
    const t = instanceTransform(surface, {
      model: { game: "tree" },
      pos: [75, 25],
    });
    expect(t.position).toEqual(surface.mapToWorld(75, 25));
    expect(t.position[0]).toBeCloseTo(50);
    expect(t.position[1]).toBeCloseTo(15);
    expect(t.position[2]).toBeCloseTo(0);
    expect(t.rotationY).toBe(0);
    expect(t.scale).toBe(surface.scale);
  });

  it("takes the entry's own height, in map units, over the ground", () => {
    const t = instanceTransform(surface, {
      model: { game: "tree" },
      pos: [75, 25],
      height: 3,
    });
    expect(t.position[1]).toBeCloseTo(6);
    const atZero = instanceTransform(surface, {
      model: { game: "tree" },
      pos: [75, 25],
      height: 0,
    });
    expect(atZero.position[1]).toBe(0);
  });

  it("turns degrees into radians about the vertical axis", () => {
    const t = instanceTransform(surface, {
      model: { game: "tree" },
      pos: [0, 0],
      rotation: 90,
    });
    expect(t.rotationY).toBeCloseTo(Math.PI / 2);
  });

  it("multiplies the entry's scale by the map to world scale", () => {
    const t = instanceTransform(surface, {
      model: { game: "tree" },
      pos: [0, 0],
      scale: 1.5,
    });
    expect(t.scale).toBeCloseTo(3);
  });
});

describe("groupPlacedModels", () => {
  const models: PlacedModel[] = [
    { model: { game: "tree" }, pos: [1, 1] },
    { model: { file: "gate.glb" }, pos: [2, 2] },
    { model: { game: "tree" }, pos: [3, 3], scale: 2 },
    { model: { game: "rock" }, pos: [4, 4] },
    { model: { game: "tree" }, pos: [5, 5] },
  ];

  it("makes one group per model, in first appearance order", () => {
    const groups = groupPlacedModels(surface, models);
    expect(groups.map((g) => [g.name, g.instances.length])).toEqual([
      ["tree", 3],
      ["gate.glb", 1],
      ["rock", 1],
    ]);
    expect(groups[0].instances[1]).toEqual(
      instanceTransform(surface, models[2]),
    );
  });

  it("keeps a game model and a file of the same name apart", () => {
    const groups = groupPlacedModels(surface, [
      { model: { game: "gate.glb" }, pos: [1, 1] },
      { model: { file: "gate.glb" }, pos: [2, 2] },
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      modelRefKey({ game: "gate.glb" }),
      modelRefKey({ file: "gate.glb" }),
    ]);
  });

  it("gives no groups for no models", () => {
    expect(groupPlacedModels(surface, [])).toEqual([]);
  });
});

describe("createFailureLog", () => {
  it("tells of each name once and lists it once", () => {
    const warn = vi.fn();
    const log = createFailureLog(warn);
    log.report("tree", "missing");
    log.report("tree", "missing again");
    log.report("rock", "unreadable");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('"tree"');
    expect(warn.mock.calls[0][0]).toContain("missing");
    expect(log.failed).toEqual(["tree", "rock"]);
  });
});
