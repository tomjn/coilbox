import { describe, expect, it } from "vitest";
import {
  clampSurfaceHeight,
  DEFAULT_SURFACE_HEIGHT,
  MAX_SURFACE_HEIGHT,
  MIN_SURFACE_HEIGHT,
  SURFACE_HEIGHT_STEP,
  stepSurfaceHeight,
} from "./surfaceHeight";

describe("clampSurfaceHeight", () => {
  it("leaves a height inside the range untouched", () => {
    expect(clampSurfaceHeight(DEFAULT_SURFACE_HEIGHT)).toBe(
      DEFAULT_SURFACE_HEIGHT,
    );
  });

  it("floors a height below the minimum", () => {
    expect(clampSurfaceHeight(0)).toBe(MIN_SURFACE_HEIGHT);
    expect(clampSurfaceHeight(-500)).toBe(MIN_SURFACE_HEIGHT);
  });

  it("caps a height above the maximum", () => {
    expect(clampSurfaceHeight(10000)).toBe(MAX_SURFACE_HEIGHT);
  });

  it("rounds to a whole pixel", () => {
    expect(clampSurfaceHeight(480.4)).toBe(480);
    expect(clampSurfaceHeight(480.6)).toBe(481);
  });
});

describe("stepSurfaceHeight", () => {
  it("grows by one step going down", () => {
    expect(stepSurfaceHeight(DEFAULT_SURFACE_HEIGHT, 1)).toBe(
      DEFAULT_SURFACE_HEIGHT + SURFACE_HEIGHT_STEP,
    );
  });

  it("shrinks by one step going up", () => {
    expect(stepSurfaceHeight(DEFAULT_SURFACE_HEIGHT, -1)).toBe(
      DEFAULT_SURFACE_HEIGHT - SURFACE_HEIGHT_STEP,
    );
  });

  it("stops at the minimum rather than going below it", () => {
    expect(stepSurfaceHeight(MIN_SURFACE_HEIGHT, -1)).toBe(MIN_SURFACE_HEIGHT);
  });

  it("stops at the maximum rather than going above it", () => {
    expect(stepSurfaceHeight(MAX_SURFACE_HEIGHT, 1)).toBe(MAX_SURFACE_HEIGHT);
  });
});
