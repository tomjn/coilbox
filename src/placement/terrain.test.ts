import { describe, expect, it } from "vitest";
import {
  CHECK_MAX_SIDE,
  cornerGround,
  FLAT_FIELD,
  groundHeight,
  type HeightField,
  standingField,
} from "./terrain";

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

/**
 * What the editor has to ask the heightmap render for (issue #1483).
 *
 * A field of nothing, because only its size is under test: whether the render
 * the editor asks for comes back as the map's own corners or as a picture of
 * them.
 */
function blank(width: number, height: number): HeightField {
  return { width, height, samples: new Float32Array(width * height) };
}

describe("the render the check reads", () => {
  // Bismuth Valley v2.4.1, a map on this machine: 12288 by 8192 elmos, so a
  // 1537 by 1025 corner grid. Read back off the render the worker caches at its
  // own default cap it is 1024 by 683, which the check refused, so no building
  // on it ever got a verdict.
  const WIDTH = 12288;
  const HEIGHT = 8192;

  it("is not the map's corners at the render's own default cap", () => {
    expect(cornerGround(blank(1024, 683), WIDTH, HEIGHT, 100, 800)).toBeNull();
  });

  it("is the map's corners at the cap the check asks for", () => {
    expect(CHECK_MAX_SIDE).toBeGreaterThanOrEqual(1537);
    expect(
      cornerGround(blank(1537, 1025), WIDTH, HEIGHT, 100, 800),
    ).not.toBeNull();
  });

  /** 32 by 32 is the largest map Beyond All Reason publishes, 16384 elmos and
   *  a 2049 corner grid. A cap under that would leave the check silent on the
   *  big maps all over again (issue #1460). */
  it("covers the largest map in circulation", () => {
    expect(CHECK_MAX_SIDE).toBeGreaterThanOrEqual(2049);
  });
});
