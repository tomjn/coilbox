import { describe, expect, it } from "vitest";
import {
  cornerGround,
  FLAT_FIELD,
  groundHeight,
  type HeightField,
  heightGrid,
  standingField,
} from "./terrain";

/** A field from a row-major list of 0..1 samples. */
function field(width: number, height: number, samples: number[]): HeightField {
  return { width, height, samples: Float32Array.from(samples) };
}

/** A grid from a row-major list of the engine's own 16 bit words, as the worker
 *  writes them: little endian. */
function grid(width: number, height: number, words: number[]) {
  const read = heightGrid(Uint16Array.from(words).buffer, width, height);
  if (!read) throw new Error("no grid");
  return read;
}

// A 2 by 2 field: 0 at the north-west corner rising to 1 at the south-east.
const CORNERS = field(2, 2, [0, 0.5, 0.5, 1]);
const W = 4096;
const H = 4096;

describe("groundHeight", () => {
  it("reads the corners of the map off the corners of the field", () => {
    expect(groundHeight(CORNERS, 0, 0, W, H, 0, 100)).toBeCloseTo(0);
    expect(groundHeight(CORNERS, W, 0, W, H, 0, 100)).toBeCloseTo(50);
    expect(groundHeight(CORNERS, 0, H, W, H, 0, 100)).toBeCloseTo(50);
    expect(groundHeight(CORNERS, W, H, W, H, 0, 100)).toBeCloseTo(100);
  });

  it("scales a sample into the map's own height range", () => {
    // The centre of this field is 0.5, which in a -50..150 map is 50.
    expect(groundHeight(CORNERS, W / 2, H / 2, W, H, -50, 150)).toBeCloseTo(50);
  });

  it("interpolates between samples rather than stepping", () => {
    const quarter = groundHeight(CORNERS, W / 4, 0, W, H, 0, 100);
    const half = groundHeight(CORNERS, W / 2, 0, W, H, 0, 100);
    expect(quarter).toBeCloseTo(12.5);
    expect(half).toBeCloseTo(25);
  });

  it("clamps a position off the map to its edge", () => {
    expect(groundHeight(CORNERS, -500, -500, W, H, 0, 100)).toBeCloseTo(0);
    expect(groundHeight(CORNERS, W * 2, H * 2, W, H, 0, 100)).toBeCloseTo(100);
  });

  it("reads a flat map as flat at its own height", () => {
    const flat = field(4, 4, new Array(16).fill(0.25));
    expect(groundHeight(flat, 1234, 2345, W, H, 20, 120)).toBeCloseTo(45);
  });

  it("survives a map with no extent rather than returning NaN", () => {
    expect(groundHeight(CORNERS, 0, 0, 0, 0, 0, 100)).toBeCloseTo(0);
  });

  it("puts the north-west of the map at the field's first sample", () => {
    // Row 0 of the image is the map's north edge, which is engine z = 0.
    const northOnly = field(2, 2, [1, 1, 0, 0]);
    expect(groundHeight(northOnly, W / 2, 0, W, H, 0, 100)).toBeCloseTo(100);
    expect(groundHeight(northOnly, W / 2, H, W, H, 0, 100)).toBeCloseTo(0);
  });
});

/**
 * Issue #1497. A map whose heights would not read drew no units at all, so the
 * editor looked like a scenario with nothing in it.
 */
describe("standingField", () => {
  it("stands the models on the map's own heights when it has them", () => {
    expect(standingField(CORNERS, true)).toBe(CORNERS);
  });

  it("stands nothing anywhere while the read is still in flight", () => {
    expect(standingField(null, false)).toBeNull();
  });

  it("stands them on the flat once the read has failed", () => {
    expect(standingField(null, true)).toBe(FLAT_FIELD);
  });

  /** The whole point of the fallback: a scene, rather than a map with nothing
   *  on it. Level, and level at the map's own floor. */
  it("puts them at the bottom of the map's range", () => {
    expect(groundHeight(FLAT_FIELD, 100, 900, W, H, -40, 260)).toBe(-40);
  });
});

/**
 * The raw grid the worker writes, which is what the check reads now (issue
 * #1490). A file of the wrong length is not this map's heights, and reading one
 * anyway would put a building's verdict on somebody else's ground.
 */
describe("heightGrid", () => {
  it("reads the worker's words in the order it wrote them", () => {
    const read = grid(2, 2, [0, 1, 2, 65535]);
    expect(read.width).toBe(2);
    expect(read.height).toBe(2);
    expect(Array.from(read.words)).toEqual([0, 1, 2, 65535]);
  });

  it("has no grid when the file is not the size the map says", () => {
    const bytes = Uint16Array.from([0, 1, 2, 3]).buffer;
    expect(heightGrid(bytes, 3, 3)).toBeNull();
    expect(heightGrid(bytes, 0, 0)).toBeNull();
  });
});

describe("cornerGround", () => {
  // A tiny map: 3 by 3 corners is 2 by 2 heightmap squares, 16 elmos a side.
  // Words rather than samples, because the corners are read at the depth the
  // engine holds them.
  const column = [0, 32768, 65535];
  const small = grid(3, 3, [...column, ...column, ...column]);

  /** `CSMFMapFile::ReadHeightmap`: `minHeight + word * range / 65536`. Not
   *  `/ 65535`, which is the reading the eight bit canvas forced. */
  it("reads a corner as the engine's own height there", () => {
    const ground = cornerGround(small, 16, 16, 0, 65536);
    if (!ground) throw new Error("no ground");
    expect(ground.cornerAt(0, 0)).toBe(0);
    expect(ground.cornerAt(1, 0)).toBe(32768);
    expect(ground.cornerAt(2, 2)).toBe(65535);
  });

  it("scales a word into the map's own height range", () => {
    const ground = cornerGround(small, 16, 16, -100, 100);
    expect(ground?.cornerAt(1, 0)).toBeCloseTo(0);
  });

  it("clamps a corner off the map to the edge, as the engine does", () => {
    const ground = cornerGround(small, 16, 16, 0, 65536);
    expect(ground?.cornerAt(-4, -4)).toBe(0);
    expect(ground?.cornerAt(90, 90)).toBe(65535);
  });

  /** The whole of issue #1490. The heights are the engine's own numbers now,
   *  so there is nothing for a tolerance to cover. */
  it("costs the check no tolerance at all", () => {
    expect(cornerGround(small, 16, 16, 0, 255)?.slack).toBe(0);
    expect(cornerGround(small, 16, 16, 100, 800)?.slack).toBe(0);
  });

  it("has water on it, because a map's zero is the sea", () => {
    expect(cornerGround(small, 16, 16, 0, 100)?.hasWater).toBe(true);
  });

  /** A grid that is not the map's own corner count describes some other map, or
   *  a read that went wrong. Better to say nothing than to mark a building
   *  against it. */
  it("has no ground when the grid is not the map's corners", () => {
    expect(cornerGround(small, 4096, 4096, 0, 100)).toBeNull();
  });

  it("has no ground for a map with no extent", () => {
    expect(cornerGround(small, 0, 0, 0, 100)).toBeNull();
  });

  /** Bismuth Valley v2.4.1, a map on this machine: 12288 by 8192 elmos, so a
   *  1537 by 1025 corner grid, which is what the worker writes. */
  it("takes a real map's whole corner grid", () => {
    const words = new Uint16Array(1537 * 1025);
    const read = heightGrid(words.buffer, 1537, 1025);
    if (!read) throw new Error("no grid");
    expect(cornerGround(read, 12288, 8192, 100, 800)).not.toBeNull();
  });
});
