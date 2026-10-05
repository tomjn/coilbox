import { describe, expect, it } from "vitest";
import { createTerrainSurface, type HeightGrid } from "./terrain";
import {
  buildableAt,
  buildTownIndex,
  CAPITAL_RADIUS,
  FLAT_SLOPE,
  leavingAngle,
  planTowns,
  roadAxis,
  roadEntries,
  STEEP_FIT,
  STEEP_SLOPE,
  TOWN_RADIUS,
  TOWN_REACH,
  type TownSite,
  townDataTexels,
  townPatches,
} from "./towns";

const sites: TownSite[] = [
  // A capital on a through road running along x.
  { x: -20, z: 0, capital: true, roads: [0, Math.PI] },
  // A town with roads going every way.
  {
    x: 20,
    z: 0,
    capital: false,
    roads: [0, Math.PI / 2, Math.PI, -Math.PI / 2],
  },
  // A town with no roads, as on a Territories map.
  { x: 0, z: 30, capital: false, roads: [] },
  // A town crowded by its neighbour.
  { x: 0, z: -20, capital: false, roads: [] },
  { x: 4, z: -20, capital: false, roads: [] },
];
const towns = planTowns(sites, 7);

describe("roadAxis", () => {
  it("runs along a through road and has no axis for roads spread evenly", () => {
    const through = roadAxis([0.3, 0.3 + Math.PI]);
    expect(through.strength).toBeCloseTo(1, 5);
    expect(Math.cos(2 * (through.axis - 0.3))).toBeCloseTo(1, 5);
    expect(
      roadAxis([0, Math.PI / 2, Math.PI, -Math.PI / 2]).strength,
    ).toBeCloseTo(0, 5);
    expect(roadAxis([]).strength).toBe(0);
  });
});

describe("leavingAngle", () => {
  it("looks past the first stretch of a road to where it heads", () => {
    const line: [number, number][] = [
      [0, 0],
      [0.1, 0],
      [3, 3],
    ];
    const angle = leavingAngle(line, (x, y) => [x, y], 1);
    expect(angle).toBeCloseTo(Math.PI / 4, 5);
  });
});

describe("roadEntries", () => {
  it("gives each anchor the roads and tracks that end on it, whichever way they run", () => {
    const anchors: [number, number][] = [
      [0, 0],
      [10, 0],
      [5, 5],
    ];
    const entries = roadEntries(
      anchors,
      [
        // A road from the first anchor to the second.
        [
          [0, 0],
          [10, 0],
        ],
        // A crossing's track from the third anchor down to a landing.
        [
          [5, 5],
          [5, 9],
        ],
        // A track that ends on no anchor.
        [
          [1, 1],
          [2, 2],
        ],
      ],
      (x, y) => [x, y],
      1,
    );
    expect(entries[0]).toEqual([0]);
    expect(entries[1].map(Math.abs)).toEqual([Math.PI]);
    expect(entries[2]).toEqual([Math.PI / 2]);
  });
});

describe("planTowns", () => {
  it("makes a capital bigger than a town, and keeps towns apart", () => {
    expect(towns[0].radius).toBeGreaterThan(CAPITAL_RADIUS);
    expect(towns[1].radius).toBeGreaterThan(TOWN_RADIUS);
    expect(towns[2].radius).toBe(TOWN_RADIUS);
    // Four units apart, so each keeps to 0.3 of that.
    expect(towns[3].radius).toBeCloseTo(1.2, 5);
    expect(towns[3].radius + towns[4].radius).toBeLessThan(4);
  });

  it("stretches a town along its through road and not a crossroads", () => {
    expect(towns[0].aspect).toBeCloseTo(1.35, 5);
    expect(Math.abs(Math.cos(towns[0].axis))).toBeCloseTo(1, 5);
    expect(towns[1].aspect).toBeCloseTo(1, 5);
  });

  it("is the same every time for one seed and differs between towns", () => {
    expect(planTowns(sites, 7)).toEqual(towns);
    const seeds = new Set(towns.map((t) => t.seed));
    expect(seeds.size).toBe(towns.length);
    expect(planTowns(sites, 8)[0].seed).not.toBe(towns[0].seed);
  });
});

describe("buildTownIndex", () => {
  // 100 by 80 world units at 50 texels: a texel is 2 world units.
  const index = buildTownIndex(towns, 100, 80, 50);
  const tag = (x: number, z: number) => {
    const i = Math.floor((x + 50) / 2);
    const j = Math.floor((z + 40) / 2);
    const o = (j * index.width + i) * 4;
    return index.data[o] * 256 + index.data[o + 1];
  };

  it("keeps the sheet's shape", () => {
    expect([index.width, index.height]).toEqual([50, 40]);
  });

  it("marks each town's ground with its index plus one and leaves open country 0", () => {
    expect(tag(-20, 0)).toBe(1);
    expect(tag(20, 0)).toBe(2);
    expect(tag(0, 30)).toBe(3);
    expect(tag(0, 0)).toBe(0);
    expect(tag(-45, 35)).toBe(0);
  });

  it("covers a town out to its reach and no further than a texel past it", () => {
    const reach = towns[0].radius * TOWN_REACH;
    expect(tag(-20 + reach - 1, 0)).toBe(1);
    expect(tag(-20 + reach + 3, 0)).toBe(0);
    let marked = 0;
    for (let k = 0; k < index.data.length; k += 4) {
      if (index.data[k] * 256 + index.data[k + 1] === 1) marked++;
    }
    // About the disc's own area in texels, with at most a texel's slack.
    const disc = (Math.PI * reach * reach) / 4;
    const slack = (Math.PI * (reach + 2) ** 2) / 4;
    expect(marked).toBeGreaterThan(disc * 0.8);
    expect(marked).toBeLessThan(slack);
  });

  it("splits two crowded towns between them", () => {
    expect(tag(-1, -20)).toBe(4);
    expect(tag(5, -20)).toBe(5);
  });
});

describe("townDataTexels", () => {
  it("lays each town out in two rows, one column per town", () => {
    const data = townDataTexels(towns);
    expect(data).toHaveLength(towns.length * 8);
    expect(Array.from(data.slice(0, 4))).toEqual(
      [-20, 0, towns[0].radius, towns[0].seed].map(Math.fround),
    );
    const row1 = (towns.length + 0) * 4;
    expect(data[row1 + 2]).toBe(1);
    expect(data[(towns.length + 1) * 4 + 2]).toBe(0);
  });
});

describe("buildableAt", () => {
  // Sea below z = 0, then a gentle slope to x = 10, then a steep one.
  const height = (x: number, z: number) =>
    z < 0
      ? 0
      : x < 10
        ? 1 + x * FLAT_SLOPE * 0.5
        : 6 + (x - 10) * STEEP_SLOPE * 2;
  const fitness = buildableAt(height, 0.5, 0.25);

  it("builds on gentle slopes, little on steep ones and never in the sea", () => {
    expect(fitness(5, 5)).toBe(1);
    expect(fitness(20, 5)).toBe(STEEP_FIT);
    expect(fitness(5, -5)).toBe(0);
  });

  it("records it in the town index, only where a town reaches", () => {
    const sea = planTowns([{ x: 5, z: -5, capital: false, roads: [] }], 1);
    const land = planTowns([{ x: 5, z: 5, capital: false, roads: [] }], 1);
    const fitAt = (towns: typeof sea) => {
      const index = buildTownIndex(towns, 40, 40, 40, fitness);
      const at = (z: number, x: number) =>
        index.data[((z + 20) * 40 + (x + 20)) * 4 + 2];
      return [at(5, 5), at(-5, 5), at(15, -15)];
    };
    // Far from either town, nothing is recorded.
    expect(fitAt(land)).toEqual([255, 0, 0]);
    expect(fitAt(sea)[1]).toBe(0);
  });
});

describe("townPatches", () => {
  // A 4 by 4 grid of heights, 0 to 15, over a sheet 40 world units across.
  const heights: HeightGrid = {
    data: new Float32Array(16).map((_, k) => k / 15),
    width: 4,
    height: 4,
  };
  const surface = createTerrainSurface(
    { width: 40, height: 40, heightScale: 1 },
    40,
    heights,
  );
  const patchTowns = planTowns(
    [
      { x: -10, z: -10, capital: false, roads: [] },
      { x: 10, z: 10, capital: false, roads: [] },
    ],
    1,
  );
  const patches = townPatches(patchTowns, surface, 0.01);
  const cell = surface.worldWidth / surface.segmentsX;

  it("lies on the terrain's own vertices, a little above them", () => {
    const { positions } = patches;
    for (let v = 0; v < positions.length / 3; v++) {
      const [x, y, z] = positions.slice(v * 3, v * 3 + 3);
      const i = Math.round((x + 20) / cell);
      const j = Math.round((z + 20) / cell);
      expect(x).toBeCloseTo(i * cell - 20, 4);
      expect(y).toBeCloseTo(
        surface.vertexHeights[j * (surface.segmentsX + 1) + i] + 0.01,
        4,
      );
    }
  });

  it("covers each town's reach and tags every vertex with its town", () => {
    const { positions, town, index } = patches;
    expect(index.length % 3).toBe(0);
    expect(new Set(town)).toEqual(new Set([0, 1]));
    for (const [k, t] of patchTowns.entries()) {
      const xs: number[] = [];
      for (let v = 0; v < town.length; v++) {
        if (town[v] === k) xs.push(positions[v * 3]);
      }
      const reach = t.radius * TOWN_REACH;
      expect(Math.min(...xs)).toBeLessThanOrEqual(Math.max(-20, t.x - reach));
      expect(Math.max(...xs)).toBeGreaterThanOrEqual(Math.min(20, t.x + reach));
    }
    // Every triangle stays within one town's patch.
    for (let k = 0; k < index.length; k += 3) {
      expect(town[index[k]]).toBe(town[index[k + 1]]);
      expect(town[index[k]]).toBe(town[index[k + 2]]);
    }
  });
});
