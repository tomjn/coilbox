import { describe, expect, it } from "vitest";
import {
  addCrossingStrip,
  type CrossingStrip,
  stripIndices,
} from "./crossingLine";

const empty = (): CrossingStrip => ({
  positions: [],
  tangents: [],
  sides: [],
  alongs: [],
  seas: [],
});

describe("addCrossingStrip", () => {
  it("lays two vertices per point, one either side", () => {
    const strip = empty();
    addCrossingStrip(
      strip,
      [
        [0, 0, 0],
        [3, 0, 4],
      ],
      0,
      true,
    );
    expect(strip.positions).toEqual([0, 0, 0, 0, 0, 0, 3, 0, 4, 3, 0, 4]);
    expect(strip.sides).toEqual([-1, 1, -1, 1]);
    expect(strip.seas).toEqual([1, 1, 1, 1]);
    expect(strip.tangents.slice(0, 3)).toEqual([0.6, 0, 0.8]);
  });

  it("carries the distance along on from one stretch to the next", () => {
    const strip = empty();
    const end = addCrossingStrip(
      strip,
      [
        [0, 0, 0],
        [3, 0, 4],
      ],
      10,
      false,
    );
    expect(end).toBe(15);
    addCrossingStrip(
      strip,
      [
        [3, 0, 4],
        [3, 0, 6],
      ],
      end,
      true,
    );
    expect(strip.alongs).toEqual([10, 10, 15, 15, 15, 15, 17, 17]);
    expect(strip.seas).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("measures along the ground, not up a slope", () => {
    const strip = empty();
    const end = addCrossingStrip(
      strip,
      [
        [0, 0, 0],
        [0, 5, 2],
      ],
      0,
      true,
    );
    expect(end).toBe(2);
  });

  it("adds nothing for a line of one point", () => {
    const strip = empty();
    expect(addCrossingStrip(strip, [[1, 2, 3]], 4, true)).toBe(4);
    expect(strip.positions).toEqual([]);
  });
});

describe("stripIndices", () => {
  it("makes two triangles between each pair of points", () => {
    expect(stripIndices(4, 3)).toEqual([4, 5, 6, 6, 5, 7, 6, 7, 8, 8, 7, 9]);
  });
});
