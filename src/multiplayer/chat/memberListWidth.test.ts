import { describe, expect, it } from "vitest";
import {
  clampWidth,
  DEFAULT_WIDTH,
  KEY_STEP,
  MIN_WIDTH,
  maxWidth,
  resetWidth,
  stepWidth,
} from "./memberListWidth";

const WIDE = 1600;

describe("maxWidth", () => {
  it("is half of the space the page has", () => {
    expect(maxWidth(WIDE)).toBe(800);
  });

  it("never drops below the minimum in a narrow window", () => {
    expect(maxWidth(300)).toBe(MIN_WIDTH);
  });
});

describe("clampWidth", () => {
  it("raises a width below the minimum", () => {
    expect(clampWidth(MIN_WIDTH - 100, WIDE)).toBe(MIN_WIDTH);
  });

  it("lowers a width above the maximum", () => {
    expect(clampWidth(5000, WIDE)).toBe(800);
  });

  it("leaves a width inside the range alone", () => {
    expect(clampWidth(300, WIDE)).toBe(300);
  });

  it("brings a stored width inside a window that is now smaller", () => {
    expect(clampWidth(700, 800)).toBe(400);
  });

  it("applies only the minimum before the space is measured", () => {
    expect(clampWidth(700, 0)).toBe(700);
    expect(clampWidth(10, 0)).toBe(MIN_WIDTH);
  });

  it("falls back to the default for a stored value that is not a number", () => {
    expect(clampWidth(Number.NaN, WIDE)).toBe(DEFAULT_WIDTH);
    expect(clampWidth(Number.POSITIVE_INFINITY, WIDE)).toBe(DEFAULT_WIDTH);
  });
});

describe("stepWidth", () => {
  it("widens by one step on the left arrow, since the edge is on the left", () => {
    expect(stepWidth(300, "ArrowLeft", WIDE)).toBe(300 + KEY_STEP);
  });

  it("narrows by one step on the right arrow", () => {
    expect(stepWidth(300, "ArrowRight", WIDE)).toBe(300 - KEY_STEP);
  });

  it("stops at the maximum", () => {
    expect(stepWidth(799, "ArrowLeft", WIDE)).toBe(800);
    expect(stepWidth(800, "ArrowLeft", WIDE)).toBe(800);
  });

  it("stops at the minimum", () => {
    expect(stepWidth(MIN_WIDTH + 1, "ArrowRight", WIDE)).toBe(MIN_WIDTH);
    expect(stepWidth(MIN_WIDTH, "ArrowRight", WIDE)).toBe(MIN_WIDTH);
  });

  it("goes to the ends on Home and End", () => {
    expect(stepWidth(300, "Home", WIDE)).toBe(MIN_WIDTH);
    expect(stepWidth(300, "End", WIDE)).toBe(800);
  });

  it("ignores a key it does not handle", () => {
    expect(stepWidth(300, "a", WIDE)).toBeNull();
  });
});

describe("resetWidth", () => {
  it("returns the default width", () => {
    expect(resetWidth(WIDE)).toBe(DEFAULT_WIDTH);
  });

  it("still fits a window too small for the default", () => {
    expect(resetWidth(100)).toBe(MIN_WIDTH);
  });
});

describe("the constants", () => {
  it("keep the default inside the range", () => {
    expect(DEFAULT_WIDTH).toBeGreaterThanOrEqual(MIN_WIDTH);
    expect(KEY_STEP).toBeGreaterThan(0);
  });
});
