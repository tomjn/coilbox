import { describe, expect, it } from "vitest";
import { scrollTopForLine, visibleLineWindow } from "./missionLuaVirtualize";

describe("visibleLineWindow", () => {
  it("renders every line when the container has not been measured", () => {
    expect(visibleLineWindow(0, 0, 5000, 18, 15)).toEqual({
      start: 0,
      end: 5000,
    });
  });

  it("windows to the scrolled range plus overscan", () => {
    // Scrolled to line 50 (900px / 18px), 400px viewport shows ~23 lines, so
    // the window is lines 35-88 with 15 lines of overscan either side.
    expect(visibleLineWindow(900, 400, 5000, 18, 15)).toEqual({
      start: 35,
      end: 88,
    });
  });

  it("clamps the start at 0 near the top", () => {
    expect(visibleLineWindow(0, 400, 5000, 18, 15)).toEqual({
      start: 0,
      end: 38,
    });
  });

  it("clamps the end at the line count near the bottom", () => {
    const lineCount = 100;
    const scrollTop = lineCount * 18 - 400;
    expect(visibleLineWindow(scrollTop, 400, lineCount, 18, 15)).toEqual({
      start: 62,
      end: 100,
    });
  });

  it("never returns an end before start for a document shorter than the overscan", () => {
    expect(visibleLineWindow(0, 400, 3, 18, 15)).toEqual({ start: 0, end: 3 });
  });
});

describe("scrollTopForLine", () => {
  it("centres the target line in the viewport", () => {
    // Line 100 at 18px is 1800px from the top, centred in a 400px viewport.
    expect(scrollTopForLine(100, 5000, 400, 18)).toBe(1800 - 200 + 9);
  });

  it("clamps to the top when the target line is near the start", () => {
    expect(scrollTopForLine(0, 5000, 400, 18)).toBe(0);
  });

  it("clamps to the bottom when the target line is near the end", () => {
    const lineCount = 100;
    expect(scrollTopForLine(99, lineCount, 400, 18)).toBe(lineCount * 18 - 400);
  });
});
