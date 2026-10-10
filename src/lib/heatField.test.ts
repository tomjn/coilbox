import { describe, expect, it } from "vitest";
import {
  addHeatFields,
  buildHeatField,
  buildHeatFieldFromCounts,
  DEFAULT_RADIUS_FRACTION,
  heatAt,
  heatGridSize,
  heatPoints,
} from "./heatField";

const SQUARE = { worldWidth: 8192, worldHeight: 8192 };

describe("the grid a map gets", () => {
  it("gives the longer side the resolution and scales the shorter to the map", () => {
    expect(heatGridSize(8192, 8192)).toEqual({ width: 256, height: 256 });
    expect(heatGridSize(16384, 8192)).toEqual({ width: 256, height: 128 });
    expect(heatGridSize(4096, 12288, 96)).toEqual({ width: 32, height: 96 });
  });
});

describe("a field with nothing in it", () => {
  it("has no peak and no values above zero", () => {
    const field = buildHeatField({ positions: [] }, SQUARE);
    expect(field.peak).toBe(0);
    expect(field.peakAt).toBeNull();
    expect(field.counted).toBe(0);
    expect(field.values.every((v) => v === 0)).toBe(true);
  });

  it("keeps its values out of an enumeration, so React never walks them", () => {
    const field = buildHeatField({ positions: [100, 100] }, SQUARE);
    expect(Object.keys(field)).not.toContain("values");
    expect(field.values).toBeInstanceOf(Float32Array);
  });
});

describe("where a point lands", () => {
  it("puts the north-west corner in row 0 and column 0", () => {
    const field = buildHeatField({ positions: [16, 16] }, SQUARE);
    // 8192 over 256 is 32 elmos a cell, so (16, 16) is the first cell's middle.
    expect(field.peakAt).toEqual({ x: 16, z: 16 });
    expect(field.values[0]).toBe(field.peak);
  });

  it("puts a point in the east on the right of its row and a point in the south in a low row", () => {
    const east = buildHeatField({ positions: [8010, 100] }, SQUARE);
    const south = buildHeatField({ positions: [100, 8010] }, SQUARE);
    // Column 250 of row 3, and row 250 of column 3.
    expect(east.peakAt).toEqual({ x: 8016, z: 112 });
    expect(east.values[3 * 256 + 250]).toBe(east.peak);
    expect(south.peakAt).toEqual({ x: 112, z: 8016 });
    expect(south.values[250 * 256 + 3]).toBe(south.peak);
  });

  it("keeps x and z apart on a map that is not square", () => {
    const wide = { worldWidth: 16384, worldHeight: 8192 };
    const field = buildHeatField({ positions: [12000, 2000] }, wide);
    expect(field.width).toBe(256);
    expect(field.height).toBe(128);
    // 64 elmos a cell both ways: column 187, row 31.
    expect(field.peakAt).toEqual({ x: 187.5 * 64, z: 31.5 * 64 });
    expect(heatAt(field, 12000, 2000)).toBe(field.peak);
    // The mirrored and the transposed positions are empty.
    expect(heatAt(field, 16384 - 12000, 2000)).toBe(0);
    expect(heatAt(field, 2000, 6000)).toBe(0);
  });
});

describe("how far a point reaches", () => {
  it("defaults the radius to a fraction of the shorter side", () => {
    const field = buildHeatField(
      { positions: [10, 10] },
      { worldWidth: 16384, worldHeight: 8192 },
    );
    expect(field.radius).toBe(8192 * DEFAULT_RADIUS_FRACTION);
  });

  it("adds nothing past the radius and falls off inside it", () => {
    const field = buildHeatField({ positions: [4112, 4112] }, SQUARE, {
      radius: 320,
    });
    const centre = heatAt(field, 4112, 4112);
    const half = heatAt(field, 4112 + 160, 4112);
    const edge = heatAt(field, 4112 + 304, 4112);
    const beyond = heatAt(field, 4112 + 400, 4112);
    expect(centre).toBeCloseTo(1, 5);
    expect(half).toBeLessThan(centre);
    expect(edge).toBeLessThan(half);
    expect(edge).toBeGreaterThan(0);
    expect(beyond).toBe(0);
  });

  it("is round: the same distance east and south reads the same", () => {
    const field = buildHeatField({ positions: [4112, 4112] }, SQUARE);
    expect(heatAt(field, 4112 + 96, 4112)).toBeCloseTo(
      heatAt(field, 4112, 4112 + 96),
      6,
    );
  });
});

describe("adding points up", () => {
  it("makes two points in one place twice one", () => {
    const one = buildHeatField({ positions: [4112, 4112] }, SQUARE);
    const two = buildHeatField({ positions: [4112, 4112, 4112, 4112] }, SQUARE);
    expect(two.peak).toBeCloseTo(one.peak * 2, 5);
  });

  it("counts a weight as that many points", () => {
    const weighted = buildHeatField(
      { positions: [4112, 4112], weights: [5] },
      SQUARE,
    );
    expect(weighted.peak).toBeCloseTo(5, 4);
    expect(weighted.peakWithinRadius).toBe(5);
  });

  it("puts the peak on the thicker of two clusters and says how many are in it", () => {
    const thin = [1000, 1000, 1040, 1010];
    const thick = [6000, 6000, 6030, 6010, 5990, 6040, 6010, 5980, 6020, 6020];
    const field = buildHeatField({ positions: [...thin, ...thick] }, SQUARE);
    expect(field.peakAt?.x).toBeGreaterThan(5900);
    expect(field.peakAt?.z).toBeGreaterThan(5900);
    expect(field.peakWithinRadius).toBe(5);
    expect(field.counted).toBe(7);
    // Nowhere the points are not.
    expect(heatAt(field, 1000, 6000)).toBe(0);
    expect(heatAt(field, 6000, 1000)).toBe(0);
  });

  it("builds the same field from a list of objects", () => {
    const flat = buildHeatField(
      { positions: [100, 200, 3000, 4000], weights: [1, 2] },
      SQUARE,
    );
    const listed = buildHeatField(
      heatPoints([
        { x: 100, z: 200 },
        { x: 3000, z: 4000, weight: 2 },
      ]),
      SQUARE,
    );
    expect([...listed.values]).toEqual([...flat.values]);
  });
});

describe("points that are not on the map", () => {
  it("leaves them out and counts them, and does not pile them on the edge", () => {
    const field = buildHeatField(
      { positions: [-50, 100, 9000, 100, 100, Number.NaN, 4010, 4010] },
      SQUARE,
    );
    expect(field.counted).toBe(1);
    expect(field.dropped).toBe(3);
    expect(heatAt(field, 0, 100)).toBe(0);
    expect(heatAt(field, 8192, 100)).toBe(0);
    expect(field.peakAt).toEqual({ x: 4016, z: 4016 });
  });
});

describe("adding fields together", () => {
  it("adds cell by cell and finds the peak of the sum", () => {
    const a = buildHeatField({ positions: [1000, 1000] }, SQUARE);
    const b = buildHeatField({ positions: [1000, 1000, 6000, 6000] }, SQUARE);
    const sum = addHeatFields([a, b]);
    expect(sum?.peak).toBeCloseTo(a.peak + heatAt(b, 1000, 1000), 5);
    expect(sum?.counted).toBe(3);
    expect(sum?.peakWithinRadius).toBeUndefined();
  });

  it("scales each field first, so a long match does not drown a short one", () => {
    const short = buildHeatField({ positions: [1000, 1000] }, SQUARE);
    const long = buildHeatField(
      { positions: [6000, 6000], weights: [40] },
      SQUARE,
    );
    const sum = addHeatFields([short, long], [1 / short.peak, 1 / long.peak]);
    expect(heatAt(sum as NonNullable<typeof sum>, 1000, 1000)).toBeCloseTo(
      heatAt(sum as NonNullable<typeof sum>, 6000, 6000),
      5,
    );
  });

  it("refuses fields of different grids", () => {
    const a = buildHeatField({ positions: [10, 10] }, SQUARE);
    const b = buildHeatField({ positions: [10, 10] }, SQUARE, {
      resolution: 64,
    });
    expect(() => addHeatFields([a, b])).toThrow();
    expect(addHeatFields([])).toBeNull();
  });
});

describe("a field from counts already on the grid", () => {
  const WIDE = { worldWidth: 8192, worldHeight: 4096 };
  // A cell of either map is 32 elmos each way.
  const CELL = 32;

  /** Count points into the cell each falls in, the way `map_grids.rs` does. */
  function counted(
    positions: number[],
    map: { worldWidth: number; worldHeight: number },
  ): Float32Array {
    const { width, height } = heatGridSize(map.worldWidth, map.worldHeight);
    const binned = new Float32Array(width * height);
    for (let i = 0; i < positions.length; i += 2) {
      const col = Math.min(
        width - 1,
        Math.floor((positions[i] / map.worldWidth) * width),
      );
      const row = Math.min(
        height - 1,
        Math.floor((positions[i + 1] / map.worldHeight) * height),
      );
      binned[row * width + col] += 1;
    }
    return binned;
  }

  it("equals the field of the same points when they sit on cell middles", () => {
    // Middles of cells: 3.5, 31.5 and 200.5 cells in.
    const positions = [112, 1008, 112, 1008, 6416, 3024];
    const fromPoints = buildHeatField({ positions }, WIDE);
    const fromCounts = buildHeatFieldFromCounts(counted(positions, WIDE), WIDE);
    expect(fromCounts.width).toBe(fromPoints.width);
    expect(fromCounts.height).toBe(fromPoints.height);
    expect(fromCounts.peak).toBeCloseTo(fromPoints.peak, 5);
    expect(fromCounts.peakAt).toEqual(fromPoints.peakAt);
    expect(fromCounts.peakWithinRadius).toBe(2);
    expect(fromCounts.counted).toBe(3);
    for (let i = 0; i < fromPoints.values.length; i++)
      expect(fromCounts.values[i]).toBeCloseTo(fromPoints.values[i], 5);
  });

  it("is within half a cell of the field of points that sit anywhere", () => {
    // Off the middles on purpose, and thick enough in one place to peak there.
    const positions = [
      1000, 1000, 1010, 1020, 990, 985, 1030, 1001, 6000, 3000, 6007, 3011,
    ];
    const fromPoints = buildHeatField({ positions }, WIDE);
    const fromCounts = buildHeatFieldFromCounts(counted(positions, WIDE), WIDE);
    const a = fromPoints.peakAt as { x: number; z: number };
    const b = fromCounts.peakAt as { x: number; z: number };
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(CELL);
    expect(Math.abs(a.z - b.z)).toBeLessThanOrEqual(CELL);
    expect(fromCounts.peakWithinRadius).toBe(fromPoints.peakWithinRadius);
    // The radius is 4 cells on this map and the blob's standard deviation 1.6,
    // so moving a point half a cell changes the peak by a few percent.
    expect(Math.abs(fromCounts.peak - fromPoints.peak)).toBeLessThan(
      fromPoints.peak * 0.05,
    );
  });

  it("reads row then column, so a transposed grid lands somewhere else", () => {
    const { width, height } = heatGridSize(WIDE.worldWidth, WIDE.worldHeight);
    const binned = new Float32Array(width * height);
    // Row 10, column 200: far east, near the north edge.
    binned[10 * width + 200] = 5;
    const field = buildHeatFieldFromCounts(binned, WIDE);
    expect(field.peakAt).toEqual({ x: 200.5 * CELL, z: 10.5 * CELL });
    expect(heatAt(field, 10.5 * CELL, 200.5 * CELL)).toBe(0);
  });

  it("leaves the counts as they were, and takes a count of events from the caller", () => {
    const binned = counted([1000, 1000], SQUARE);
    const before = Array.from(binned);
    const field = buildHeatFieldFromCounts(binned, SQUARE, { counted: 7 });
    expect(Array.from(binned)).toEqual(before);
    expect(field.counted).toBe(7);
  });

  it("gives an empty field for an empty grid and refuses another grid's counts", () => {
    const empty = buildHeatFieldFromCounts(new Float32Array(256 * 256), SQUARE);
    expect(empty.peak).toBe(0);
    expect(empty.peakAt).toBeNull();
    expect(() =>
      buildHeatFieldFromCounts(new Float32Array(256 * 128), SQUARE),
    ).toThrow();
  });
});
