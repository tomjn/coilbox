import { describe, expect, it } from "vitest";
import { decimateHeights, type HeightWords } from "./heightGrid";

/** A grid from a row-major list of words, row 0 at the map's north. */
function grid(width: number, height: number, words: number[]): HeightWords {
  return { width, height, words: Uint16Array.from(words) };
}

describe("decimateHeights", () => {
  it("keeps a grid the mesh can already draw", () => {
    const out = decimateHeights(grid(2, 2, [0, 16384, 32768, 65535]), 512);
    expect([out.width, out.height]).toEqual([2, 2]);
  });

  it("scales a word by the divisor the engine reads it with", () => {
    // 65536 rather than 65535, so half the raw range is exactly half the world
    // range, matching `CSMFMapFile::ReadHeightmap`.
    const out = decimateHeights(grid(1, 1, [32768]), 512);
    expect(out.data[0]).toBe(0.5);
  });

  it("puts the map's north in the last row, where a flipped image has it", () => {
    // A `DataTexture` is not flipped on upload the way a loaded image is, so
    // the rows come out reversed. Getting this wrong renders the terrain
    // mirrored north to south against everything else on the map.
    const out = decimateHeights(grid(2, 2, [0, 0, 65536 / 2, 65536 / 2]), 512);
    expect(Array.from(out.data)).toEqual([0.5, 0.5, 0, 0]);
  });

  it("averages the samples it drops rather than picking one", () => {
    // A 4 wide row down to 2: each output is the mean of its pair, so a peak
    // between two kept columns still lifts the ground instead of vanishing.
    const out = decimateHeights(grid(4, 1, [0, 65536 / 2, 0, 0]), 2);
    expect([out.width, out.height]).toEqual([2, 1]);
    expect(Array.from(out.data)).toEqual([0.25, 0]);
  });

  it("caps both axes and keeps a partial block at the far edge", () => {
    // 2049 is the largest grid in the corpus and 513 the mesh's vertex count,
    // so the step is 4: 512 whole blocks and a last one holding the odd sample.
    const words = Array.from({ length: 2049 }, () => 0);
    const out = decimateHeights(grid(2049, 1, words), 513);
    expect(out.width).toBe(513);
    expect(out.data).toHaveLength(513);
  });

  it("never divides by a block that fell off the edge", () => {
    const out = decimateHeights(grid(3, 3, Array(9).fill(65535)), 2);
    expect(Array.from(out.data).every((v) => v > 0.9)).toBe(true);
  });
});
