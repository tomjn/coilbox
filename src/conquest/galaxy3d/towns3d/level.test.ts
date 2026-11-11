import { describe, expect, it } from "vitest";
import type { HeightGrid } from "../terrain";
import type { Town } from "../towns";
import { levelGround, SEA_HEIGHT, townLevels } from "./level";

const frame = { worldWidth: 100, worldDepth: 100 };

/** A grid of `side + 2 * margin` square rising left to right across the map. */
function ramp(side: number, margin: number): HeightGrid {
  const size = side + 2 * margin;
  const data = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      data[j * size + i] = 0.2 + (0.6 * (i - margin)) / (side - 1);
    }
  }
  return { data, width: size, height: size };
}

function town(x: number, z: number, radius: number): Town {
  return {
    node: 0,
    x,
    z,
    radius,
    capital: false,
    seed: 0.3,
    axis: 0,
    aspect: 1,
    waves: [0, 0, 0],
    streets: [],
  };
}

/** The value at the pixel nearest world `x, z`. */
function at(grid: HeightGrid, margin: number, x: number, z: number): number {
  const mapPixels = grid.width - 2 * margin;
  const i = Math.round(margin + (x / frame.worldWidth + 0.5) * (mapPixels - 1));
  const j = Math.round(margin + (z / frame.worldDepth + 0.5) * (mapPixels - 1));
  return grid.data[j * grid.width + i];
}

describe("levelGround", () => {
  it("flattens the core at the mean of its dry land", () => {
    const out = levelGround({ heights: ramp(101, 0) }, [town(0, 0, 5)], frame);
    const level = at(out.heights, 0, 0, 0);
    expect(level).toBeCloseTo(0.5, 2);
    for (const x of [-3, -1, 2, 3]) {
      expect(at(out.heights, 0, x, 1)).toBeCloseTo(level, 6);
    }
  });

  it("leaves the land past the skirt alone", () => {
    const before = ramp(101, 0);
    const out = levelGround({ heights: before }, [town(0, 0, 5)], frame);
    expect(at(out.heights, 0, 20, 0)).toBe(at(before, 0, 20, 0));
  });

  it("never writes to the grids it is given", () => {
    const before = ramp(101, 0);
    const copy = before.data.slice();
    levelGround({ heights: before }, [town(0, 0, 5)], frame);
    expect(before.data).toEqual(copy);
  });

  it("keeps sea as sea and land as land", () => {
    const grid = ramp(101, 0);
    for (let j = 0; j < 101; j++) {
      for (let i = 0; i < 48; i++) grid.data[j * 101 + i] = 0;
    }
    const out = levelGround({ heights: grid }, [town(0, 0, 5)], frame);
    out.heights.data.forEach((v, k) => {
      expect(v > SEA_HEIGHT).toBe(grid.data[k] > SEA_HEIGHT);
    });
  });

  it("gives the same ground whichever town comes first", () => {
    const a = town(-4, 0, 3);
    const b = { ...town(4, 0, 3), node: 1 };
    const one = levelGround({ heights: ramp(101, 0) }, [a, b], frame);
    const two = levelGround({ heights: ramp(101, 0) }, [b, a], frame);
    expect(one.heights.data).toEqual(two.heights.data);
  });

  it("keeps a town's core flat where a neighbour's skirt reaches it", () => {
    // Two towns 6 apart. The left one's skirt (3 * 1.27 * 1.7 = 6.5) reaches
    // well into the right one's core.
    const a = town(-3, 0, 3);
    const b = { ...town(3, 0, 3), node: 1 };
    const out = levelGround({ heights: ramp(101, 0) }, [a, b], frame);
    const level = at(out.heights, 0, 3, 0);
    for (const x of [1, 2, 4, 5]) {
      expect(at(out.heights, 0, x, 0)).toBeCloseTo(level, 6);
    }
  });

  it("leaves no step at the edge of a core beside a neighbour", () => {
    const a = town(-3, 0, 3);
    const b = { ...town(3, 0, 3), node: 1 };
    const out = levelGround({ heights: ramp(101, 0) }, [a, b], frame);
    // Pixel to pixel along the line between the towns, the ground never jumps
    // by more than the land's own slope allows across the skirts.
    for (let x = -4; x < 4; x++) {
      expect(
        Math.abs(at(out.heights, 0, x + 1, 0) - at(out.heights, 0, x, 0)),
      ).toBeLessThan(0.02);
    }
  });

  it("moves the wider heights and the relief as it moves the map's", () => {
    const out = levelGround(
      {
        heights: ramp(101, 0),
        extension: {
          heights: ramp(101, 10),
          relief: ramp(101, 10),
          margin: 10,
        },
      },
      [town(0, 0, 5)],
      frame,
    );
    for (const [x, z] of [
      [0, 0],
      [3, 2],
      [7, -6],
      [20, 0],
    ]) {
      for (const wide of [out.extension.heights, out.extension.relief]) {
        expect(at(wide, 10, x, z)).toBeCloseTo(at(out.heights, 0, x, z), 6);
      }
    }
  });

  it("skips a town with no dry land and hands back the same grids for no towns", () => {
    const sea = { data: new Float32Array(101 * 101), width: 101, height: 101 };
    expect(townLevels(sea, [town(0, 0, 5)], frame)).toEqual([null]);
    const grids = { heights: ramp(101, 0) };
    expect(levelGround(grids, [], frame)).toBe(grids);
  });
});
