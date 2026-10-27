import { describe, expect, it } from "vitest";

import { type GroundHeights, stepCorners } from "./terraform";
import { newStep } from "./terrainEdit";
import { stepMesh } from "./terrainMesh";

const FLAT: GroundHeights = {
  width: 2,
  height: 2,
  heights: new Float32Array(4),
};
const flat = () => 0;
const ORIGIN = { x: 0, z: 0 };

function meshOf(step: ReturnType<typeof newStep>) {
  const corners = stepCorners(step, FLAT, ORIGIN);
  if (!corners) throw new Error("refused");
  return stepMesh(corners, flat);
}

const square = [
  { x: 0, z: 0 },
  { x: 64, z: 0 },
  { x: 64, z: 64 },
  { x: 0, z: 64 },
];

describe("a step's volume, as the widget draws it", () => {
  it("draws raised ground as faces and wire over the depth test", () => {
    const mesh = meshOf({
      ...newStep("area", square),
      kind: "raise",
      height: 40,
    });
    expect(mesh?.faces.length).toBeGreaterThan(0);
    expect(mesh?.wire.length).toBeGreaterThan(0);
    expect(mesh?.downFaces).toHaveLength(0);
    // The top is at the step's height and the sides reach the ground.
    const heights = new Set(mesh?.faces.map((p) => p[1]));
    expect(heights).toEqual(new Set([0, 40]));
  });

  it("draws dug ground apart, so it can be drawn through the ground", () => {
    const mesh = meshOf({
      ...newStep("area", square),
      kind: "raise",
      height: -24,
    });
    expect(mesh?.faces).toHaveLength(0);
    expect(mesh?.downFaces.length).toBeGreaterThan(0);
  });

  it("draws only the ground grid for a step that leaves the ground where it is", () => {
    const mesh = meshOf(newStep("area", square));
    expect(mesh?.faces).toHaveLength(0);
    expect(mesh?.wire).toHaveLength(0);
    expect(mesh?.grid.length).toBeGreaterThan(0);
  });

  it("puts the wire every 16 elmos, so a line on the grid is drawn once", () => {
    const mesh = meshOf({
      ...newStep("area", square),
      kind: "raise",
      height: 40,
    });
    const top = (mesh?.wire ?? []).filter((p) => p[1] === 40);
    for (const p of top) {
      expect(p[0] % 8).toBe(0);
      expect(p[2] % 8).toBe(0);
    }
    const lines = new Set<string>();
    const wire = mesh?.wire ?? [];
    for (let i = 0; i < wire.length; i += 2) {
      const key = JSON.stringify([wire[i], wire[i + 1]]);
      expect(lines.has(key)).toBe(false);
      lines.add(key);
    }
  });

  it("gives up on a step with more cells than the limit", () => {
    const corners = stepCorners(
      { ...newStep("area", square), kind: "raise", height: 40 },
      FLAT,
      ORIGIN,
    );
    expect(corners && stepMesh(corners, flat, 4)).toBeNull();
  });
});
