import { describe, expect, it } from "vitest";
import { type Town, townEdge } from "../towns";
import { BUILDINGS } from "./buildings";
import {
  BUILD_FIT,
  blockStart,
  footprint,
  gridFor,
  layoutTown,
  OPEN_GRID,
  type Placement,
  RIVER_BANK,
  riverEdgeReader,
  SEALED_GRID,
  streetGap,
  type TownGrid,
} from "./layout";

const models = BUILDINGS;
const flat = { buildable: () => 1 };

function town(radius: number, streets: number[] = [0, Math.PI]): Town {
  return {
    node: 0,
    x: 0,
    z: 0,
    radius,
    capital: false,
    seed: 0.3,
    axis: 0,
    aspect: 1,
    waves: [0, 0, 0],
    streets,
  };
}

/** The four corners of a placement's footprint on the ground. */
function corners(p: Placement, grid: TownGrid): [number, number][] {
  const [w, d] = footprint(models[p.model], grid);
  const ex = [Math.cos(p.turn), -Math.sin(p.turn)];
  const ez = [Math.sin(p.turn), Math.cos(p.turn)];
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => [
    p.x + (a * w * ex[0]) / 2 + (b * d * ez[0]) / 2,
    p.z + (a * w * ex[1]) / 2 + (b * d * ez[1]) / 2,
  ]);
}

/** Whether two convex rectangles overlap by more than a rounding error. */
function overlap(a: [number, number][], b: [number, number][]): boolean {
  for (const shape of [a, b]) {
    for (let i = 0; i < 2; i++) {
      const edge = [
        shape[i + 1][0] - shape[i][0],
        shape[i + 1][1] - shape[i][1],
      ];
      const axis = [-edge[1], edge[0]];
      const range = (pts: [number, number][]) => {
        const dots = pts.map((p) => p[0] * axis[0] + p[1] * axis[1]);
        return [Math.min(...dots), Math.max(...dots)];
      };
      const [aLo, aHi] = range(a);
      const [bLo, bHi] = range(b);
      const gap = Math.hypot(axis[0], axis[1]) * 1e-9;
      if (aHi <= bLo + gap || bHi <= aLo + gap) return false;
    }
  }
  return true;
}

const meanHeight = (placed: Placement[]) =>
  placed.reduce((sum, p) => sum + models[p.model].height, 0) / placed.length;

describe("layoutTown", () => {
  it("keeps every building inside the town's edge", () => {
    const placed = layoutTown(town(3), OPEN_GRID, models, flat);
    expect(placed.length).toBeGreaterThan(0);
    for (const p of placed)
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(
        townEdge(town(3), Math.atan2(p.z, p.x)),
      );
  });

  it("stands no two buildings on the same ground", () => {
    for (const grid of [OPEN_GRID, SEALED_GRID]) {
      const rects = layoutTown(town(3), grid, models, flat).map((p) =>
        corners(p, grid),
      );
      expect(rects.length).toBeGreaterThan(1);
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++)
          expect(overlap(rects[i], rects[j])).toBe(false);
    }
  });

  it("keeps the boulevards clear", () => {
    for (const p of layoutTown(town(3), OPEN_GRID, models, flat))
      expect(Math.abs(p.z)).toBeGreaterThanOrEqual(0.25);
  });

  it("lays the same town out the same way twice", () => {
    expect(layoutTown(town(3), OPEN_GRID, models, flat)).toEqual(
      layoutTown(town(3), OPEN_GRID, models, flat),
    );
  });

  it("is tall in the middle and low at the edge", () => {
    const placed = layoutTown(town(3), OPEN_GRID, models, flat);
    const near = placed.filter((p) => Math.hypot(p.x, p.z) < 0.3 * 3);
    const far = placed.filter((p) => Math.hypot(p.x, p.z) > 0.7 * 3);
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    expect(meanHeight(near)).toBeGreaterThan(meanHeight(far));
  });

  it("builds nothing on steep ground, in the sea or by a river", () => {
    const ground = {
      buildable: (x: number) => (x > 0 ? 0 : 1),
      riverEdge: (_x: number, z: number) => Math.abs(z - 1) - 0.1,
    };
    const placed = layoutTown(town(3, []), OPEN_GRID, models, ground);
    expect(placed.length).toBeGreaterThan(0);
    for (const p of placed) {
      expect(p.x).toBeLessThanOrEqual(0);
      expect(Math.abs(p.z - 1)).toBeGreaterThan(0.1 + RIVER_BANK);
    }
  });

  it("gives a town too small for a block one building at its centre", () => {
    const placed = layoutTown(town(0.3, []), SEALED_GRID, models, flat);
    expect(placed).toHaveLength(1);
    expect([placed[0].x, placed[0].z]).toEqual([0, 0]);
  });

  it("builds nothing where the centre itself cannot be built on", () => {
    expect(
      layoutTown(town(0.3, []), SEALED_GRID, models, { buildable: () => 0 }),
    ).toEqual([]);
  });

  it("uses the larger lot for a sealed outpost", () => {
    expect(gridFor("sealed").lot).toBe(0.75);
    expect(gridFor("organic").lot).toBe(0.25);
    expect(layoutTown(town(3), SEALED_GRID, models, flat).length).toBeLessThan(
      layoutTown(town(3), OPEN_GRID, models, flat).length,
    );
  });

  it("turns a building with the town, and a long one across the block", () => {
    const along = { ...town(3), axis: 0.4 };
    const placed = layoutTown(along, OPEN_GRID, models, flat);
    const turns = new Set(placed.map((p) => p.turn));
    for (const turn of turns)
      expect([-0.4, -0.4 + Math.PI / 2]).toContainEqual(turn);
    for (const p of placed) {
      const [la, lb] = models[p.model].lots;
      if (la === lb) expect(p.turn).toBe(-0.4);
    }
  });

  it("judges ground against the fit threshold", () => {
    expect(BUILD_FIT).toBe(0.85);
    const fit = { buildable: () => BUILD_FIT };
    const unfit = { buildable: () => BUILD_FIT - 0.01 };
    expect(layoutTown(town(0.3, []), SEALED_GRID, models, fit)).toHaveLength(1);
    expect(layoutTown(town(0.3, []), SEALED_GRID, models, unfit)).toEqual([]);
  });

  it("gives a capital a landmark, a city at most one and a town none", () => {
    const open = models.filter((m) => m.settlements.includes("organic"));
    const landmarks = (radius: number) =>
      layoutTown(town(radius), OPEN_GRID, open, flat).filter(
        (p) => open[p.model].landmark,
      ).length;
    expect(landmarks(3.8)).toBeGreaterThanOrEqual(1);
    expect(landmarks(3.8)).toBeLessThanOrEqual(2);
    expect(landmarks(3.2)).toBeLessThanOrEqual(1);
    expect(landmarks(2)).toBe(0);
  });

  it("draws an open town's buildings taller or lower than their models", () => {
    const open = models.filter((m) => m.settlements.includes("organic"));
    const placed = layoutTown(town(3.8), OPEN_GRID, open, flat);
    const stretches = placed
      .filter((p) => !open[p.model].filler)
      .map((p) => p.stretch);
    expect(new Set(stretches).size).toBeGreaterThan(stretches.length / 2);
    // The stretch a lot asks for, less the drift of 0.12 that keeps two level.
    for (const s of stretches) {
      expect(s).toBeGreaterThan((1 - OPEN_GRID.stretch) * 0.88 - 1e-9);
      expect(s).toBeLessThanOrEqual(1 + OPEN_GRID.stretch);
    }
    for (const p of placed.filter((p) => open[p.model].filler))
      expect(p.stretch).toBe(1);
  });

  it("leaves a sealed outpost's buildings as they were modelled", () => {
    const sealed = models.filter((m) => m.settlements.includes("sealed"));
    for (const p of layoutTown(town(3.8), SEALED_GRID, sealed, flat))
      expect(p.stretch).toBe(1);
  });

  it("does not build a capital's middle from one model", () => {
    const open = models.filter((m) => m.settlements.includes("organic"));
    const placed = layoutTown(town(3.8), OPEN_GRID, open, flat);
    const tall = placed.filter((p) => open[p.model].height >= 2.3);
    const counts = new Map<number, number>();
    for (const p of tall) counts.set(p.model, (counts.get(p.model) ?? 0) + 1);
    expect(counts.size).toBeGreaterThan(3);
    expect(Math.max(...counts.values())).toBeLessThan(tall.length / 2);
  });
});

describe("riverEdgeReader", () => {
  const frame = { worldWidth: 10, worldDepth: 10 };

  it("is undefined for a map with no rivers", () => {
    expect(
      riverEdgeReader(undefined, { width: 4, height: 4 }, 0, frame),
    ).toBeUndefined();
  });

  it("turns a byte into a distance from the river's edge", () => {
    const data = new Uint8Array([0, 255, 0, 255]);
    const read = riverEdgeReader(
      { field: { data, width: 2, height: 2 } },
      { width: 2, height: 2 },
      0,
      frame,
    );
    // Byte 0 is 0.12 into the water, byte 255 is 0.9 beside it.
    expect(read?.(-2.5, -2.5)).toBeCloseTo(-0.12);
    expect(read?.(2.5, -2.5)).toBeCloseTo(0.9);
    expect(read?.(-2.5, 2.5)).toBeCloseTo(-0.12);
    expect(read?.(2.5, 2.5)).toBeCloseTo(0.9);
  });

  it("skips the margin round the map", () => {
    // A picture 6 wide with 1 margin each side puts the map on pixels 1 to 4.
    const data = new Uint8Array([0, 255, 255]);
    const read = riverEdgeReader(
      { field: { data, width: 3, height: 1 } },
      { width: 6, height: 1 },
      1,
      frame,
    );
    // The map's left edge is at 1/6 of the picture, in the field's first texel.
    expect(read?.(-4.9, 0)).toBeCloseTo(-0.12);
    expect(read?.(4.9, 0)).toBeCloseTo(0.9);
  });

  it("puts parks and courts on lots an open town leaves unbuilt", () => {
    const open = models.filter((m) => m.settlements.includes("organic"));
    const placed = layoutTown(town(3), OPEN_GRID, open, flat);
    const fillers = placed.filter((p) => open[p.model].filler);
    const buildings = placed.filter((p) => !open[p.model].filler);
    expect(fillers.length).toBeGreaterThan(0);
    expect(buildings.length).toBeGreaterThan(fillers.length);
    // A block is four lots long, so a filler in a block with a building is
    // within that of one.
    for (const f of fillers)
      expect(
        Math.min(...buildings.map((b) => Math.hypot(b.x - f.x, b.z - f.z))),
      ).toBeLessThan(4 * OPEN_GRID.lot);
  });
});

describe("streetGap", () => {
  for (const [name, grid] of [
    ["open", OPEN_GRID],
    ["sealed", SEALED_GRID],
  ] as const)
    it(`finds the blocks of an ${name} grid where blockStart puts them`, () => {
      const block = grid.blockLots[0] * grid.lot;
      // The middle of the grid is an avenue.
      expect(streetGap(0, block, grid)).toEqual({ width: grid.avenue, off: 0 });
      for (let i = 0; i < 9; i++) {
        const start = blockStart(i, block, grid);
        for (const t of [start + 1e-6, start + block / 2, start + block - 1e-6])
          for (const side of [1, -1])
            expect(streetGap(side * t, block, grid).width, `block ${i}`).toBe(
              0,
            );
        // What follows a block is a street, or an avenue after every few.
        const width = blockStart(i + 1, block, grid) - start - block;
        const gap = streetGap(start + block + width / 2, block, grid);
        expect(gap.width).toBeCloseTo(width, 9);
        expect(gap.off).toBeCloseTo(0, 9);
        expect(
          streetGap(start + block + width - 1e-6, block, grid).off,
        ).toBeCloseTo(width / 2, 5);
      }
    });
});
