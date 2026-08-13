import { describe, expect, it } from "vitest";
import { cornerGround, groundHeight, type HeightField } from "./terrain";

/** A field from a row-major list of 0..1 samples. */
function field(width: number, height: number, samples: number[]): HeightField {
  return { width, height, samples: Float32Array.from(samples) };
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

describe("cornerGround", () => {
  // A tiny map: 3 by 3 corners is 2 by 2 heightmap squares, 16 elmos a side.
  const small = field(3, 3, [0, 0.5, 1, 0, 0.5, 1, 0, 0.5, 1]);

  it("reads a corner as the engine's own height there", () => {
    const ground = cornerGround(small, 16, 16, 0, 100);
    if (!ground) throw new Error("no ground");
    expect(ground.cornerAt(0, 0)).toBeCloseTo(0);
    expect(ground.cornerAt(1, 0)).toBeCloseTo(50);
    expect(ground.cornerAt(2, 2)).toBeCloseTo(100);
  });

  it("clamps a corner off the map to the edge, as the engine does", () => {
    const ground = cornerGround(small, 16, 16, 0, 100);
    expect(ground?.cornerAt(-4, -4)).toBeCloseTo(0);
    expect(ground?.cornerAt(90, 90)).toBeCloseTo(100);
  });

  /** One step of the eight bit read back off the rendered heightmap, which is
   *  what the check has to allow for before it calls anything unbuildable. */
  it("allows for how coarsely the heightmap was read", () => {
    expect(cornerGround(small, 16, 16, 0, 255)?.slack).toBeCloseTo(1);
    expect(cornerGround(small, 16, 16, -50, 205)?.slack).toBeCloseTo(1);
  });

  /** A big map comes back downscaled, so its samples are no longer the map's
   *  corners and the arithmetic below them is no longer the engine's. Better to
   *  say nothing than to mark a building off smoothed ground. */
  it("has no ground when the heightmap came back downscaled", () => {
    expect(cornerGround(small, 4096, 4096, 0, 100)).toBeNull();
    expect(cornerGround(field(1, 1, [0]), 4096, 4096, 0, 100)).toBeNull();
  });

  it("has no ground for a map with no extent", () => {
    expect(cornerGround(small, 0, 0, 0, 100)).toBeNull();
  });
});
