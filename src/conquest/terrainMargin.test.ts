import { describe, expect, it } from "vitest";
import {
  extendTerrain,
  generateTerrain,
  generateTerrainWithMargin,
  LAND_LAYOUTS,
  type LandLayout,
  TERRAIN_PIXELS,
} from "./terrainGen";

const S = TERRAIN_PIXELS;
const MARGIN = 200;

/** How many places two arrays differ, counting a length mismatch as one. */
function differences(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let n = a.length === b.length ? 0 : 1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) n++;
  }
  return n;
}

const build = (shape: LandLayout, seed: number) => {
  const r = generateTerrainWithMargin({ seed, shape, maxMasses: 30 }, MARGIN);
  return { ...r, extended: extendTerrain(r.terrain, r.margin) };
};

describe("land past the map's edge", () => {
  it("leaves the map itself exactly as the generator builds it", () => {
    for (const shape of ["continent", "landlocked"] as const) {
      const { terrain } = build(shape, 4);
      const plain = generateTerrain({ seed: 4, shape, maxMasses: 30 });
      // Plain comparisons and one expect: an expect per element of these
      // arrays is slow enough to time out on a busy machine (issue #3566).
      expect(differences(terrain.image, plain.image)).toBe(0);
      expect(differences(terrain.heightmap, plain.heightmap)).toBe(0);
      expect(differences(terrain.land, plain.land)).toBe(0);
    }
  });

  it("puts the map's own pixels and heights in the middle of the extended picture", () => {
    const { terrain, extended } = build("coast", 2);
    const M = extended.margin;
    expect(M % 4).toBe(0);
    expect(M).toBeGreaterThanOrEqual(MARGIN);
    for (const [x, y] of [
      [0, 0],
      [S - 1, 0],
      [0, S - 1],
      [S - 1, S - 1],
      [200, 311],
    ]) {
      const o = (y + M) * extended.width + (x + M);
      const m = y * S + x;
      expect(Array.from(extended.image.slice(o * 4, o * 4 + 4))).toEqual(
        Array.from(terrain.image.slice(m * 4, m * 4 + 4)),
      );
      expect(extended.heights[o]).toBe(terrain.heightmap[m] / 255);
    }
  });

  it("agrees with the map about land and sea across its edge", () => {
    // Measured over seeds 1 to 10 of every layout, the worst map agreed on
    // 96.5% of the pixels either side of its edge (a landlocked map). The
    // rest are where the map's own clean-up moved a coast near the edge.
    for (const shape of LAND_LAYOUTS) {
      const { extended } = build(shape, 1);
      const M = extended.margin;
      const w = extended.width;
      const isLand = (x: number, y: number) =>
        extended.heights[y * w + x] > 0.5 / 255;
      let same = 0;
      let total = 0;
      for (let t = 0; t < S; t++) {
        for (const [ix, iy, ox, oy] of [
          [M + t, M, M + t, M - 1],
          [M + t, M + S - 1, M + t, M + S],
          [M, M + t, M - 1, M + t],
          [M + S - 1, M + t, M + S, M + t],
        ]) {
          if (isLand(ix, iy) === isLand(ox, oy)) same++;
          total++;
        }
      }
      expect(same / total).toBeGreaterThan(0.95);
    }
  });

  it("keeps the sea past a closed side as sea", () => {
    // An archipelago has no open side, so the margin's outer ring is all sea.
    const { extended } = build("archipelago", 3);
    const w = extended.width;
    for (let t = 0; t < w; t++) {
      expect(extended.heights[t]).toBe(0);
      expect(extended.heights[(w - 1) * w + t]).toBe(0);
    }
  });

  it("carries land on past an open side", () => {
    // A landlocked map is open on every side, so most of the margin is land.
    const { margin } = build("landlocked", 3);
    let land = 0;
    for (const h of margin.heightmap) if (h > 0) land++;
    expect(land / margin.heightmap.length).toBeGreaterThan(0.5);
  });
});
