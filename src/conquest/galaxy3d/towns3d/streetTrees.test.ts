import { describe, expect, it } from "vitest";
import { planTowns, withStreets } from "../towns";
import { OPEN_GRID, streetGap } from "./layout";
import { streetTrees, TREE_GAP } from "./streetTrees";

const town = withStreets(
  planTowns([{ x: 3, z: -2, capital: true, roads: [0.4, 2.9] }], 7),
  [[0.4, 2.9]],
)[0];
const everywhere = () => true;

describe("streetTrees", () => {
  it("plants the same trees for the same town", () => {
    const a = streetTrees(town, OPEN_GRID, everywhere);
    expect(a.length).toBeGreaterThan(50);
    expect(streetTrees(town, OPEN_GRID, everywhere)).toEqual(a);
  });

  it("keeps every tree inside the town and off a main street's carriageway", () => {
    for (const t of streetTrees(town, OPEN_GRID, everywhere)) {
      const dx = t.x - town.x;
      const dz = t.z - town.z;
      expect(Math.hypot(dx, dz)).toBeLessThan(town.radius * 1.27);
      for (const a of town.streets) {
        const along = dx * Math.cos(a) + dz * Math.sin(a);
        const across = Math.abs(dx * Math.sin(a) - dz * Math.cos(a));
        // Less the jitter each tree is moved by.
        if (along > 0.03)
          expect(across).toBeGreaterThan(OPEN_GRID.boulevard / 2);
      }
    }
  });

  it("stands every tree beside a main street or down the middle of an avenue", () => {
    const cos = Math.cos(town.axis);
    const sin = Math.sin(town.axis);
    const [bu, bv] = OPEN_GRID.blockLots.map((n) => n * OPEN_GRID.lot);
    for (const t of streetTrees(town, OPEN_GRID, everywhere)) {
      const dx = t.x - town.x;
      const dz = t.z - town.z;
      const beside = town.streets.some((a) => {
        const across = Math.abs(dx * Math.sin(a) - dz * Math.cos(a));
        return across < OPEN_GRID.boulevard / 2 + 0.1;
      });
      const u = dx * cos + dz * sin;
      const v = -dx * sin + dz * cos;
      const gu = streetGap(u, bu, OPEN_GRID);
      const gv = streetGap(v, bv, OPEN_GRID);
      const median = [gu, gv].some(
        (g) => g.width === OPEN_GRID.avenue && g.off < 0.03,
      );
      expect(beside || median).toBe(true);
    }
  });

  it("plants nothing where the ground is not free", () => {
    expect(streetTrees(town, OPEN_GRID, () => false)).toEqual([]);
    const half = streetTrees(town, OPEN_GRID, (x) => x > town.x);
    expect(half.length).toBeGreaterThan(0);
    // Less the jitter each tree is moved by.
    for (const t of half) expect(t.x).toBeGreaterThan(town.x - 0.02);
  });

  it("spaces a row no closer than its gap, less the jitter", () => {
    const trees = streetTrees(town, OPEN_GRID, everywhere);
    let close = 0;
    for (let a = 0; a < trees.length; a++)
      for (let b = a + 1; b < trees.length; b++)
        if (
          Math.hypot(trees[a].x - trees[b].x, trees[a].z - trees[b].z) <
          TREE_GAP / 3
        )
          close++;
    // Two rows cross now and then, where an avenue meets a main street's side.
    expect(close).toBeLessThan(trees.length / 10);
  });
});
