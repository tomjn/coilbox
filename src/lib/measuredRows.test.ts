import { describe, expect, it } from "vitest";
import {
  measuredRowWindow,
  rowOffsets,
  scrollCorrection,
} from "./measuredRows";

const keys = (n: number) => Array.from({ length: n }, (_, i) => `row${i}`);

describe("rowOffsets", () => {
  it("adds measured heights, estimates and the gap", () => {
    const offsets = rowOffsets(keys(3), new Map([["row1", 120]]), 100, 10);
    expect([...offsets]).toEqual([0, 110, 240, 350]);
  });
});

describe("measuredRowWindow", () => {
  // Rows of 100px with no gap, so row `i` starts at `i * 100`.
  const offsets = rowOffsets(keys(1000), new Map(), 100, 0);

  it("takes the rows in view plus the overscan either side", () => {
    expect(measuredRowWindow(offsets, 5000, 300, 200)).toEqual({
      start: 48,
      end: 56,
    });
  });

  it("starts at the first row while the list is below the top of the view", () => {
    expect(measuredRowWindow(offsets, -400, 800, 0).start).toBe(0);
  });

  it("stays at the end of the list when the scroll position is past it", () => {
    const short = rowOffsets(keys(10), new Map(), 100, 0);
    expect(measuredRowWindow(short, 90000, 300, 100)).toEqual({
      start: 6,
      end: 10,
    });
  });

  it("is empty for an empty list", () => {
    expect(
      measuredRowWindow(rowOffsets([], new Map(), 100, 0), 0, 300, 100),
    ).toEqual({ start: 0, end: 0 });
  });

  it("finds the right rows when their heights differ", () => {
    // 50, 150, 50, 150: tops at 0, 50, 200, 250, and the view shows 210 to 240.
    const mixed = rowOffsets(
      keys(4),
      new Map([
        ["row0", 50],
        ["row1", 150],
        ["row2", 50],
        ["row3", 150],
      ]),
      100,
      0,
    );
    expect(measuredRowWindow(mixed, 210, 30, 0)).toEqual({ start: 2, end: 3 });
  });
});

describe("scrollCorrection", () => {
  const offsets = rowOffsets(keys(10), new Map(), 100, 10);

  it("counts only the rows that ended above the view", () => {
    // Row 1 ends at 210 and is above a view starting at 250. Row 2 ends at 320,
    // so it is on screen and grows downwards without moving anything visible.
    expect(
      scrollCorrection(offsets, 10, 250, [
        { index: 1, growth: 30 },
        { index: 2, growth: 40 },
      ]),
    ).toBe(30);
  });

  it("adds shrinking rows as a negative move", () => {
    expect(
      scrollCorrection(offsets, 10, 900, [
        { index: 0, growth: -20 },
        { index: 1, growth: 5 },
      ]),
    ).toBe(-15);
  });
});
