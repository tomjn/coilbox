import { describe, expect, it } from "vitest";

import {
  bandsFrom,
  chromeFits,
  fromBottomLeft,
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

describe("quadrantRects with the chrome's bands taken off (#5410)", () => {
  // The narrowest view the side panel leaves, with a toolbar on one row.
  const bands = { top: 60, bottom: 64, left: 56 };

  it("splits only the room the bands leave", () => {
    const rects = quadrantRects(640, 600, bands);
    expect(rects.top).toEqual({ x: 56, y: 60, width: 292, height: 238 });
    expect(rects.front).toEqual({ x: 348, y: 60, width: 292, height: 238 });
    expect(rects.side).toEqual({ x: 56, y: 298, width: 292, height: 238 });
    expect(rects.perspective).toEqual({
      x: 348,
      y: 298,
      width: 292,
      height: 238,
    });
    // Down to the bottom band and out to the right edge, with no gap.
    expect(rects.perspective.y + rects.perspective.height).toBe(600 - 64);
    expect(rects.front.x + rects.front.width).toBe(640);
  });

  it("shrinks the views when the toolbar wraps and the top band grows", () => {
    const one = quadrantRects(640, 600, bands);
    const two = quadrantRects(640, 600, { ...bands, top: 108 });
    expect(two.top.y).toBe(108);
    expect(two.top.height + two.side.height).toBe(600 - 108 - 64);
    expect(two.perspective.height).toBeLessThan(one.perspective.height);
    expect(two.perspective.width).toBe(one.perspective.width);
  });

  it("finds no view under the bands", () => {
    const rects = quadrantRects(640, 600, bands);
    expect(quadrantAt(rects, 300, 30)).toBeNull();
    expect(quadrantAt(rects, 20, 300)).toBeNull();
    expect(quadrantAt(rects, 600, 580)).toBeNull();
    expect(quadrantAt(rects, 56, 60)).toBe("top");
    expect(quadrantAt(rects, 639, 535)).toBe("perspective");
  });

  it("leaves the views no room, never a negative size, when the bands fill the canvas", () => {
    const rects = quadrantRects(640, 100, { top: 80, bottom: 80, left: 700 });
    for (const id of QUADRANTS) {
      expect(rects[id].width).toBe(0);
      expect(rects[id].height).toBe(0);
    }
  });
});

describe("bandsFrom", () => {
  it("measures each band from the canvas edge to where the chrome stops", () => {
    const canvas = { left: 100, top: 50, right: 740, bottom: 650 };
    const views = { left: 112, top: 110.4, right: 728, bottom: 586 };
    const rail = { left: 112, top: 200, right: 155.6, bottom: 500 };
    expect(bandsFrom(canvas, views, rail)).toEqual({
      top: 60,
      bottom: 64,
      left: 56,
    });
  });
});

describe("chromeFits (#5414)", () => {
  it("fits while the tool rail shows all of its tools", () => {
    expect(chromeFits({ scrollHeight: 340, clientHeight: 340 })).toBe(true);
    expect(chromeFits({ scrollHeight: 340, clientHeight: 520 })).toBe(true);
  });

  it("does not fit once the rail has to scroll", () => {
    expect(chromeFits({ scrollHeight: 340, clientHeight: 180 })).toBe(false);
  });

  it("lets a pixel of rounding through", () => {
    expect(chromeFits({ scrollHeight: 341, clientHeight: 340 })).toBe(true);
    expect(chromeFits({ scrollHeight: 342, clientHeight: 340 })).toBe(false);
  });
});
