import { describe, expect, it } from "vitest";

import { BUILD_SQUARE } from "@/blueprint/footprint";
import {
  GRID_EXTENT,
  GRID_ORIGIN,
  gridGround,
  layoutFraming,
  MIN_FRAME_SPAN,
} from "./ground";

describe("gridGround", () => {
  it("is flat, so nothing has to read a heightmap to draw on it", () => {
    const ground = gridGround();
    expect(ground.flat).toBe(true);
    expect(ground.minHeight).toBe(0);
    expect(ground.maxHeight).toBe(0);
    expect(ground.heightWords).toBeUndefined();
  });

  it("is square and a whole number of build squares across", () => {
    const ground = gridGround();
    expect(ground.worldWidth).toBe(GRID_EXTENT);
    expect(ground.worldHeight).toBe(GRID_EXTENT);
    expect(GRID_EXTENT % BUILD_SQUARE).toBe(0);
  });

  it("starts a layout in the middle, so it can grow either way", () => {
    expect(GRID_ORIGIN).toEqual({
      x: GRID_EXTENT / 2,
      z: GRID_EXTENT / 2,
    });
  });
});

describe("layoutFraming", () => {
  it("looks at the fallback when there is nothing placed yet", () => {
    expect(layoutFraming([], { x: 100, z: 200 })).toEqual({
      centre: { x: 100, z: 200 },
      span: MIN_FRAME_SPAN,
    });
  });

  it("centres on a layout's bounding box", () => {
    const framing = layoutFraming(
      [
        { x: 1000, z: 1000 },
        { x: 1400, z: 1200 },
      ],
      { x: 0, z: 0 },
    );
    expect(framing.centre).toEqual({ x: 1200, z: 1100 });
  });

  it("spans the widest side, so nothing in the layout is off screen", () => {
    const framing = layoutFraming(
      [
        { x: 0, z: 0 },
        { x: 900, z: 300 },
      ],
      { x: 0, z: 0 },
    );
    expect(framing.span).toBe(900);
  });

  it("never frames so close that one building fills the view", () => {
    const framing = layoutFraming([{ x: 500, z: 500 }], { x: 0, z: 0 });
    expect(framing.centre).toEqual({ x: 500, z: 500 });
    expect(framing.span).toBe(MIN_FRAME_SPAN);
  });
});
