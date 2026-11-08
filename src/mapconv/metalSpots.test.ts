import { describe, expect, it } from "vitest";
import {
  ENGINE_EXTRACTOR_RADIUS,
  findSpots,
  type MetalGrid,
  measureMetal,
} from "./metalSpots";

/** A metal map of `width` by `height` cells with the given cells set. */
function grid(
  width: number,
  height: number,
  cells: [x: number, z: number, value: number][],
): MetalGrid {
  const bytes = new Uint8Array(width * height);
  for (const [x, z, v] of cells) bytes[z * width + x] = v;
  return { bytes, width, height };
}

describe("finding spots", () => {
  it("makes one spot of each group of touching cells", () => {
    const spots = findSpots(
      grid(16, 16, [
        [2, 2, 100],
        [3, 2, 100],
        [12, 12, 50],
      ]),
    );
    expect(spots).toHaveLength(2);
    // Two cells of equal value centre between them: x = 3 * 16, z = 2.5 * 16.
    expect(spots[0]).toMatchObject({ x: 48, z: 40, metal: 200, cells: 2 });
    expect(spots[1]).toMatchObject({ x: 12.5 * 16, z: 12.5 * 16, cells: 1 });
  });

  it("joins cells that touch only at a corner, as the games' own finders do", () => {
    expect(
      findSpots(
        grid(8, 8, [
          [1, 1, 10],
          [2, 2, 10],
        ]),
      ),
    ).toHaveLength(1);
    expect(
      findSpots(
        grid(8, 8, [
          [1, 1, 10],
          [3, 1, 10],
        ]),
      ),
    ).toHaveLength(2);
  });

  it("puts the centre at the metal weighted middle", () => {
    const [spot] = findSpots(
      grid(8, 8, [
        [2, 2, 50],
        [3, 2, 150],
      ]),
    );
    // (2.5 * 50 + 3.5 * 150) / 200 cells, times 16.
    expect(spot.x).toBeCloseTo(((2.5 * 50 + 3.5 * 150) / 200) * 16);
    expect(spot.z).toBeCloseTo(2.5 * 16);
  });

  it("measures how far the metal reaches from the centre", () => {
    const [spot] = findSpots(
      grid(8, 8, [
        [1, 1, 10],
        [2, 1, 10],
        [3, 1, 10],
      ]),
    );
    // Three cells in a row: the ends are one cell, 16 elmos, from the middle.
    expect(spot.reach).toBeCloseTo(16);
  });

  it("finds nothing on a map with no metal", () => {
    expect(findSpots(grid(8, 8, []))).toEqual([]);
  });
});

describe("measuring a map's metal", () => {
  const cells = (list: [number, number][]) =>
    list.map(([x, z]): [number, number, number] => [x, z, 100]);

  it("lists each start's nearest spots, nearest first, at most three", () => {
    const m = measureMetal(
      grid(
        32,
        32,
        cells([
          [2, 2],
          [6, 2],
          [10, 2],
          [20, 2],
          [28, 2],
        ]),
      ),
      90,
      [{ x: 40, z: 40 }],
    );
    expect(m.nearest).toEqual([{ start: 0, distances: [0, 64, 128] }]);
  });

  it("lists spots closer together than the extractor radius", () => {
    const g = grid(
      32,
      32,
      cells([
        [2, 2],
        [6, 2],
        [20, 20],
      ]),
    );
    const near = measureMetal(g, 90, []);
    expect(near.close).toEqual([
      { ax: 40, az: 40, bx: 104, bz: 40, distance: 64 },
    ]);
    expect(measureMetal(g, 64, []).close).toEqual([]);
  });

  it("counts spots whose metal reaches further than one extractor covers", () => {
    const row = Array.from({ length: 20 }, (_, i): [number, number] => [i, 4]);
    const m = measureMetal(grid(32, 32, cells(row)), 90, []);
    expect(m.spotCount).toBe(1);
    expect(m.wide).toBe(1);
    // Twenty cells, nineteen steps between the end cells, so 152 from the middle.
    expect(m.widest).toBeCloseTo(152);
    expect(measureMetal(grid(32, 32, cells(row)), 200, []).wide).toBe(0);
  });

  it("measures the layout against its mirror through the centre", () => {
    // 32 by 32 cells is 512 elmos across, so the centre is 256, 256.
    const mirrored = measureMetal(
      grid(
        32,
        32,
        cells([
          [2, 3],
          [29, 28],
          [10, 10],
          [21, 21],
        ]),
      ),
      90,
      [
        { x: 40, z: 56 },
        { x: 472, z: 456 },
      ],
    );
    const centre = mirrored.mirrors.find((m) => m.mirror === "centre");
    expect(centre).toMatchObject({ starts: 0, spots: 0 });

    // One spot moved two cells east.
    const off = measureMetal(
      grid(
        32,
        32,
        cells([
          [2, 3],
          [27, 28],
          [10, 10],
          [21, 21],
        ]),
      ),
      90,
      [
        { x: 40, z: 56 },
        { x: 472, z: 456 },
      ],
    );
    const gap = off.mirrors.find((m) => m.mirror === "centre");
    expect(gap?.spots).toBe(32);
    // Both ends of the pair are 32 out, and the first found is reported.
    expect(gap?.worst).toEqual({ x: 40, z: 56 });
    expect(gap?.starts).toBe(0);
  });

  it("measures the east to west and north to south mirrors too", () => {
    const m = measureMetal(
      grid(
        32,
        32,
        cells([
          [2, 3],
          [29, 3],
        ]),
      ),
      90,
      [],
    );
    expect(m.mirrors.find((x) => x.mirror === "eastWest")?.spots).toBe(0);
    expect(m.mirrors.find((x) => x.mirror === "centre")?.spots).toBeGreaterThan(
      0,
    );
  });

  it("has no start figures with fewer than two starts", () => {
    const m = measureMetal(grid(32, 32, cells([[2, 3]])), 90, [
      { x: 40, z: 56 },
    ]);
    for (const mirror of m.mirrors) expect(mirror.starts).toBeNull();
  });

  it("has no spot figures on a map without spots", () => {
    const m = measureMetal(grid(8, 8, []), 90, [
      { x: 10, z: 10 },
      { x: 100, z: 100 },
    ]);
    expect(m.spotCount).toBe(0);
    for (const mirror of m.mirrors) expect(mirror.spots).toBeNull();
  });

  it("uses the engine's default radius", () => {
    expect(ENGINE_EXTRACTOR_RADIUS).toBe(500);
  });
});
