import { describe, expect, it } from "vitest";
import { type Town, townEdge } from "../towns";
import { BUILDINGS } from "./buildings";
import {
  BUILD_FIT,
  blockStart,
  footprint,
  layoutOutpost,
  layoutTown,
  OPEN_GRID,
  OUTPOST_GRID,
  type Placement,
  RIVER_BANK,
  riverEdgeReader,
  streetGap,
  type TownGrid,
} from "./layout";

const models = BUILDINGS;
const flat = { buildable: () => 1 };

/** A grid of larger lots and wider streets, so the layout is checked on more than one. */
const WIDE_GRID: TownGrid = {
  lot: 0.75,
  blockLots: [2, 2],
  street: 0.2,
  avenue: 0.3,
  avenueEvery: 2,
  boulevard: 0.35,
  setback: 0.05,
  edgeDensity: 0.7,
  choice: 0,
  stretch: 0,
  gaps: 0,
};

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
    for (const grid of [OPEN_GRID, WIDE_GRID]) {
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
    const placed = layoutTown(town(0.3, []), WIDE_GRID, models, flat);
    expect(placed).toHaveLength(1);
    expect([placed[0].x, placed[0].z]).toEqual([0, 0]);
  });

  it("builds nothing where the centre itself cannot be built on", () => {
    expect(
      layoutTown(town(0.3, []), WIDE_GRID, models, { buildable: () => 0 }),
    ).toEqual([]);
  });

  it("builds fewer buildings on a grid of larger lots", () => {
    expect(layoutTown(town(3), WIDE_GRID, models, flat).length).toBeLessThan(
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
    expect(layoutTown(town(0.3, []), WIDE_GRID, models, fit)).toHaveLength(1);
    expect(layoutTown(town(0.3, []), WIDE_GRID, models, unfit)).toEqual([]);
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

  it("leaves buildings as they were modelled on a grid with no stretch", () => {
    // A landmark is drawn a little lower than it was modelled on any grid.
    const plain = models.filter((m) => !m.landmark);
    for (const p of layoutTown(town(3.8), WIDE_GRID, plain, flat))
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
    ["wide", WIDE_GRID],
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

describe("layoutOutpost", () => {
  /** Plain structures at each footprint, and one centrepiece. */
  const outposts = [
    { lots: [1, 1] as [number, number], height: 0.2 },
    { lots: [1, 1] as [number, number], height: 0.6 },
    { lots: [1, 1] as [number, number], height: 1.4 },
    { lots: [2, 1] as [number, number], height: 0.4 },
    { lots: [2, 1] as [number, number], height: 1.0 },
    { lots: [2, 2] as [number, number], height: 0.8 },
    { lots: [2, 2] as [number, number], height: 2.4 },
    { lots: [2, 2] as [number, number], height: 3.6, landmark: true },
  ];
  const lot = OUTPOST_GRID.lot;

  /** The lots a placement covers, as "i,j", for an outpost at the origin on axis 0. */
  function lotsOf(p: Placement): string[] {
    const m = outposts[p.model];
    // A placement turned a quarter has its lots the other way round.
    const quarter = Math.round((p.turn * 2) / Math.PI) % 2 !== 0;
    const [la, lb] = quarter ? [m.lots[1], m.lots[0]] : m.lots;
    const i0 = Math.round(p.x / lot - la / 2);
    const j0 = Math.round(p.z / lot - lb / 2);
    const out: string[] = [];
    for (let i = 0; i < la; i++)
      for (let j = 0; j < lb; j++) out.push(`${i0 + i},${j0 + j}`);
    return out;
  }

  it("keeps every structure inside the outpost's edge, one to a lot", () => {
    const { placements } = layoutOutpost(town(3), OUTPOST_GRID, outposts, flat);
    expect(placements.length).toBeGreaterThan(4);
    const seen = new Set<string>();
    for (const p of placements) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(
        townEdge(town(3), Math.atan2(p.z, p.x)),
      );
      for (const key of lotsOf(p)) {
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });

  it("lays the same outpost out the same way every time", () => {
    expect(layoutOutpost(town(3), OUTPOST_GRID, outposts, flat)).toEqual(
      layoutOutpost(town(3), OUTPOST_GRID, outposts, flat),
    );
  });

  it("gives an outpost too small for a lot one structure at its centre", () => {
    const { placements, plates } = layoutOutpost(
      town(0.3, []),
      OUTPOST_GRID,
      outposts,
      flat,
    );
    expect(placements).toHaveLength(1);
    expect([placements[0].x, placements[0].z]).toEqual([0, 0]);
    expect(plates).toHaveLength(1);
  });

  it("builds nothing where no ground can be built on", () => {
    expect(
      layoutOutpost(town(3), OUTPOST_GRID, outposts, { buildable: () => 0 }),
    ).toEqual({ placements: [], plates: [] });
  });

  it("stands every lot of a wide structure on ground that can be built on", () => {
    // Nothing can be built where z is below 0.4.
    const half = { buildable: (_x: number, z: number) => (z < 0.4 ? 0 : 1) };
    const { placements } = layoutOutpost(town(3), OUTPOST_GRID, outposts, half);
    expect(placements.length).toBeGreaterThan(0);
    for (const p of placements)
      for (const key of lotsOf(p)) {
        const j = Number(key.split(",")[1]);
        // The lot's centre must be on buildable ground.
        expect((j + 0.5) * lot, key).toBeGreaterThanOrEqual(0.4);
      }
  });

  it("joins neighbours on one plate, each at its lot's centre", () => {
    const grid = { ...OUTPOST_GRID, join: 1, pads: 0 };
    const { placements, plates } = layoutOutpost(town(3), grid, outposts, flat);
    const bridges = plates.slice(placements.length);
    expect(bridges.length).toBeGreaterThan(0);
    for (const bridge of bridges) {
      const near = [...placements]
        .sort(
          (a, b) =>
            Math.hypot(a.x - bridge.x, a.z - bridge.z) -
            Math.hypot(b.x - bridge.x, b.z - bridge.z),
        )
        .slice(0, 2);
      for (const p of near) {
        // At a lot's centre, twice the position is a whole number of lots.
        expect((2 * p.x) / lot).toBeCloseTo(Math.round((2 * p.x) / lot), 9);
        expect((2 * p.z) / lot).toBeCloseTo(Math.round((2 * p.z) / lot), 9);
      }
    }
  });

  it("gives each structure a plate of its own when none are joined", () => {
    const grid = { ...OUTPOST_GRID, join: 0, pads: 0 };
    const { placements, plates } = layoutOutpost(town(3), grid, outposts, flat);
    expect(plates).toHaveLength(placements.length);
  });

  it("builds on every lot near the centre", () => {
    const { placements } = layoutOutpost(town(3), OUTPOST_GRID, outposts, flat);
    const covered = new Set(placements.flatMap(lotsOf));
    for (const key of ["-1,-1", "-1,0", "0,-1", "0,0"])
      expect(covered.has(key), key).toBe(true);
  });

  it("lays empty plates on bare lots beside a structure, joined to it", () => {
    const grid = { ...OUTPOST_GRID, pads: 1 };
    const { placements, plates } = layoutOutpost(town(3), grid, outposts, flat);
    const none = layoutOutpost(town(3), { ...grid, pads: 0 }, outposts, flat);
    // The same structures are built with no empty plates.
    expect(placements.map((p) => p.model)).toEqual(
      none.placements.map((p) => p.model),
    );
    const built = new Set(placements.flatMap(lotsOf));
    const pads = plates
      .slice(placements.length)
      .filter((p) => Math.abs(p.w - p.d) < 1e-9 && p.w > lot / 2);
    expect(pads.length).toBeGreaterThan(0);
    for (const pad of pads) {
      const i = Math.round(pad.x / lot - 0.5);
      const j = Math.round(pad.z / lot - 0.5);
      expect(built.has(`${i},${j}`)).toBe(false);
      expect(
        [
          [i - 1, j],
          [i + 1, j],
          [i, j - 1],
          [i, j + 1],
        ].some(([a, b]) => built.has(`${a},${b}`)),
      ).toBe(true);
      // A bridge reaches the pad's plate.
      expect(
        plates.some(
          (b) =>
            b !== pad &&
            Math.abs(b.x - pad.x) <= lot / 2 + 1e-9 &&
            Math.abs(b.z - pad.z) <= lot / 2 + 1e-9 &&
            (b.w < lot / 2 || b.d < lot / 2),
        ),
      ).toBe(true);
    }
  });

  it("builds across the lines a road arrives on", () => {
    const { placements } = layoutOutpost(town(3), OUTPOST_GRID, outposts, flat);
    // An open town keeps a boulevard clear along the street at bearing 0.
    expect(
      placements.some(
        (p) => p.x > 0 && Math.abs(p.z) < (OPEN_GRID.boulevard + lot) / 2,
      ),
    ).toBe(true);
  });

  it("gives a capital two centrepieces, a city one and a town none", () => {
    const count = (radius: number) =>
      layoutOutpost(
        town(radius),
        OUTPOST_GRID,
        outposts,
        flat,
      ).placements.filter((p) => outposts[p.model].landmark).length;
    expect(count(3.8)).toBe(2);
    expect(count(3.2)).toBe(1);
    expect(count(2)).toBe(0);
  });
});
