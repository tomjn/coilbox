import { describe, expect, it } from "vitest";
import {
  boxFromPoints,
  clampGrid,
  finaliseBox,
  GRID,
  MIN_BOX,
  moveBox,
  normaliseBox,
  pxToGrid,
  resizeBox,
} from "./startBoxGeometry";

describe("startBoxGeometry", () => {
  it("clamps and rounds onto the 0..GRID grid", () => {
    expect(clampGrid(-5)).toBe(0);
    expect(clampGrid(250)).toBe(GRID);
    expect(clampGrid(99.6)).toBe(100);
  });

  it("maps pointer px within the box to the grid (inverse of pct)", () => {
    // 320px-wide box: half-way across is grid 100, full width is 200.
    expect(pxToGrid(160, 320)).toBe(100);
    expect(pxToGrid(0, 320)).toBe(0);
    expect(pxToGrid(320, 320)).toBe(GRID);
    // Outside the box clamps rather than overflowing.
    expect(pxToGrid(400, 320)).toBe(GRID);
    expect(pxToGrid(-40, 320)).toBe(0);
    // A zero-size box can't be divided by.
    expect(pxToGrid(10, 0)).toBe(0);
  });

  it("normalises edges so left<=right and top<=bottom", () => {
    expect(normaliseBox({ left: 120, top: 90, right: 40, bottom: 10 })).toEqual(
      {
        left: 40,
        top: 10,
        right: 120,
        bottom: 90,
      },
    );
  });

  it("moves a box while preserving size and clamping to the grid", () => {
    const b = { left: 10, top: 10, right: 50, bottom: 30 };
    expect(moveBox(b, 20, 5)).toEqual({
      left: 30,
      top: 15,
      right: 70,
      bottom: 35,
    });
    // Clamp at the far edge without shrinking (width 40, height 20 kept).
    expect(moveBox(b, 1000, 1000)).toEqual({
      left: 160,
      top: 180,
      right: 200,
      bottom: 200,
    });
  });

  it("resizes only the dragged edges", () => {
    const b = { left: 20, top: 20, right: 80, bottom: 80 };
    expect(resizeBox(b, ["right", "bottom"], { x: 120, y: 140 })).toEqual({
      left: 20,
      top: 20,
      right: 120,
      bottom: 140,
    });
    expect(resizeBox(b, ["left"], { x: 5, y: 999 })).toEqual({
      left: 5,
      top: 20,
      right: 80,
      bottom: 80,
    });
  });

  it("clamps a dragged edge against its opposite so the box can't invert", () => {
    const b = { left: 20, top: 20, right: 80, bottom: 80 };
    // Right edge dragged left past the left edge stops MIN_BOX short of it.
    expect(resizeBox(b, ["right"], { x: 0, y: 50 })).toEqual({
      left: 20,
      top: 20,
      right: 20 + MIN_BOX,
      bottom: 80,
    });
    // Top edge dragged below the bottom edge stops MIN_BOX short of it.
    expect(resizeBox(b, ["top"], { x: 50, y: 200 })).toEqual({
      left: 20,
      top: 80 - MIN_BOX,
      right: 80,
      bottom: 80,
    });
  });

  it("builds an unordered box from two drag points", () => {
    expect(boxFromPoints({ x: 100, y: 100 }, { x: 40, y: 60 })).toEqual({
      left: 100,
      top: 100,
      right: 40,
      bottom: 60,
    });
  });

  it("finalises a valid box and rejects degenerate ones", () => {
    expect(finaliseBox({ left: 100, top: 100, right: 40, bottom: 60 })).toEqual(
      {
        left: 40,
        top: 60,
        right: 100,
        bottom: 100,
      },
    );
    // A near-zero drag (a stray click) is rejected.
    expect(
      finaliseBox({ left: 50, top: 50, right: 51, bottom: 120 }),
    ).toBeNull();
    expect(
      finaliseBox({ left: 50, top: 50, right: 50, bottom: 50 }),
    ).toBeNull();
  });
});
