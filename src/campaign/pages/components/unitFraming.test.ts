import { describe, expect, it } from "vitest";
import { unitFitDistance } from "./unitFraming";

const FOV = (35 * Math.PI) / 180;

describe("unitFitDistance", () => {
  it("fits the model's radius in the vertical field of view on a square viewport", () => {
    // Padding aside, the model's bounding sphere subtends the full 35 degrees.
    const d = unitFitDistance(10, FOV, 1);
    expect(Math.asin(10 / d)).toBeLessThan(FOV / 2);
    expect(d).toBeCloseTo((1.15 * 10) / Math.sin(FOV / 2), 6);
  });

  it("does not pull closer on a wide viewport than on a square one", () => {
    // Vertical is the tighter of the two once the viewport is wider than tall,
    // so a panorama-shaped slot frames the model exactly as a square one does.
    expect(unitFitDistance(10, FOV, 4)).toBeCloseTo(
      unitFitDistance(10, FOV, 1),
      6,
    );
  });

  it("backs off on a tall viewport, where the horizontal fit is tighter", () => {
    const tall = unitFitDistance(10, FOV, 0.4);
    expect(tall).toBeGreaterThan(unitFitDistance(10, FOV, 1));
    // A viewport 0.4 as wide as it is tall needs roughly 1/0.4 the distance
    // (roughly, because the fit is a sine of an angle, not a ratio of widths).
    const ratio = tall / unitFitDistance(10, FOV, 1);
    expect(ratio).toBeGreaterThan(2.2);
    expect(ratio).toBeLessThan(2.5);
  });

  it("scales with the model", () => {
    expect(unitFitDistance(20, FOV, 1)).toBeCloseTo(
      2 * unitFitDistance(10, FOV, 1),
      6,
    );
  });

  it("falls back to the vertical fit for a viewport with no size yet", () => {
    expect(unitFitDistance(10, FOV, 0)).toBeCloseTo(
      unitFitDistance(10, FOV, 1),
      6,
    );
    expect(unitFitDistance(10, FOV, Number.NaN)).toBeCloseTo(
      unitFitDistance(10, FOV, 1),
      6,
    );
  });

  it("gives a finite distance for a model with no extent", () => {
    expect(Number.isFinite(unitFitDistance(0, FOV, 1))).toBe(true);
    expect(unitFitDistance(0, FOV, 1)).toBeGreaterThan(0);
  });
});
