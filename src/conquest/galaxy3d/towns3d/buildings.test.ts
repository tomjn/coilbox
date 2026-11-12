import { describe, expect, it } from "vitest";
import { townPalette } from "../landmarks/palettes";
import { BUILDINGS, buildModel, modelsFor } from "./buildings";

describe("building inventory", () => {
  it("gives every model a unique id", () => {
    const ids = BUILDINGS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(BUILDINGS)("stands $id on the ground inside its footprint", (m) => {
    const g = buildModel(m, 0.5, 0.3, townPalette());
    g.computeBoundingBox();
    const b = g.boundingBox as NonNullable<typeof g.boundingBox>;
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(m.height, 6);
    expect(b.min.x).toBeGreaterThanOrEqual(-0.25 - 1e-6);
    expect(b.max.x).toBeLessThanOrEqual(0.25 + 1e-6);
    expect(b.min.z).toBeGreaterThanOrEqual(-0.15 - 1e-6);
    expect(b.max.z).toBeLessThanOrEqual(0.15 + 1e-6);
  });

  it("has a single-lot model for an open town", () => {
    expect(
      modelsFor("organic").some((m) => m.lots[0] === 1 && m.lots[1] === 1),
    ).toBe(true);
  });

  it("leaves a sealed outpost's structures to their own inventory", () => {
    expect(modelsFor("sealed")).toEqual([]);
  });
});
