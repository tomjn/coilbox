import { describe, expect, it } from "vitest";

import {
  fromBottomLeft,
  overlayInset,
  pointInView,
  QUADRANTS,
  quadrantAt,
  quadrantRects,
} from "./quadViews";

describe("quadrantRects", () => {
  it("puts top, front, side and perspective in reading order", () => {
    const rects = quadrantRects(800, 600);
    expect(rects.top).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(rects.front).toEqual({ x: 400, y: 0, width: 400, height: 300 });
    expect(rects.side).toEqual({ x: 0, y: 300, width: 400, height: 300 });
    expect(rects.perspective).toEqual({
      x: 400,
      y: 300,
      width: 400,
      height: 300,
    });
  });

  it("tiles an odd sized canvas with no gap, giving the spare pixel to the right and the bottom", () => {
    const rects = quadrantRects(801, 601);
    expect(rects.top.width + rects.front.width).toBe(801);
    expect(rects.top.height + rects.side.height).toBe(601);
    expect(rects.front.width).toBe(401);
    expect(rects.side.height).toBe(301);
    const area = QUADRANTS.reduce(
      (sum, id) => sum + rects[id].width * rects[id].height,
      0,
    );
    expect(area).toBe(801 * 601);
  });
});

describe("quadrantAt", () => {
  const rects = quadrantRects(800, 600);

  it("finds the quadrant under each corner of the canvas", () => {
    expect(quadrantAt(rects, 0, 0)).toBe("top");
    expect(quadrantAt(rects, 799, 0)).toBe("front");
    expect(quadrantAt(rects, 0, 599)).toBe("side");
    expect(quadrantAt(rects, 799, 599)).toBe("perspective");
  });

  it("gives a point on the middle lines to the quadrant right of and below it", () => {
    expect(quadrantAt(rects, 399.9, 100)).toBe("top");
    expect(quadrantAt(rects, 400, 100)).toBe("front");
    expect(quadrantAt(rects, 100, 300)).toBe("side");
    expect(quadrantAt(rects, 400, 300)).toBe("perspective");
  });

  it("finds nothing off the canvas", () => {
    expect(quadrantAt(rects, -1, 10)).toBeNull();
    expect(quadrantAt(rects, 800, 10)).toBeNull();
    expect(quadrantAt(rects, 10, 600)).toBeNull();
  });
});

describe("pointInView", () => {
  const rects = quadrantRects(800, 600);

  it("measures the pointer across its own quadrant, not the canvas", () => {
    expect(pointInView(rects.perspective, 600, 450)).toEqual({ x: 0, y: 0 });
    expect(pointInView(rects.perspective, 400, 300)).toEqual({ x: -1, y: 1 });
    expect(pointInView(rects.top, 400, 300)).toEqual({ x: 1, y: -1 });
  });
});

describe("fromBottomLeft", () => {
  it("measures the top row from the bottom of the canvas, as WebGL does", () => {
    const rects = quadrantRects(800, 600);
    expect(fromBottomLeft(rects.top, 600)).toEqual({
      x: 0,
      y: 300,
      width: 400,
      height: 300,
    });
    expect(fromBottomLeft(rects.perspective, 600).y).toBe(0);
  });
});

describe("overlayInset", () => {
  it("keeps the same margin on every side with one view", () => {
    expect(overlayInset(false)).toEqual({
      top: "0.75rem",
      right: "0.75rem",
      bottom: "0.75rem",
      left: "0.75rem",
    });
  });

  it("starts at the middle of the canvas, below the perspective name, with four views", () => {
    const inset = overlayInset(true);
    expect(inset.left).toBe("calc(50% + 0.75rem)");
    expect(inset.top).toBe("calc(50% + 1rem + 0.75rem)");
    expect(inset.right).toBe("0.75rem");
    expect(inset.bottom).toBe("0.75rem");
  });
});
