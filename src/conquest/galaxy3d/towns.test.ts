import { describe, expect, it } from "vitest";
import { createTerrainSurface, type HeightGrid } from "./terrain";
import type { BiomePixels } from "./terrainMesh";
import {
  anyTexelNear,
  buildableAt,
  buildTownIndex,
  CAPITAL_RADIUS,
  clipRoads,
  edgeBounds,
  FIELD_INNER,
  FLAT_SLOPE,
  farmableAt,
  fieldCell,
  leavingAngle,
  MAX_STREETS,
  planTowns,
  RIBBON_RADII,
  RIBBON_REACH,
  RING_AT,
  RING_REACH,
  ROAD_CLIP,
  roadAxis,
  roadEntries,
  STEEP_FIT,
  STEEP_SLOPE,
  TOWN_RADIUS,
  TOWN_REACH,
  type TownSite,
  townCell,
  townDataTexels,
  townEdge,
  townPatches,
  withStreets,
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
  it("lays each town out in five rows, one column per town", () => {
    const streets = [0.5, 1, 1.5, 2, 2.5];
    const data = townDataTexels(
      towns.map((t, k) => (k === 0 ? { ...t, streets } : t)),
    );
    const n = towns.length;
    const at = (row: number, k: number) =>
      Array.from(data.slice((row * n + k) * 4, (row * n + k) * 4 + 4));
    expect(data).toHaveLength(n * 4 * 5);
    expect(at(0, 0)).toEqual(
      [-20, 0, towns[0].radius, towns[0].seed].map(Math.fround),
    );
    expect(at(1, 0)[2]).toBe(1);
    expect(at(1, 1)[2]).toBe(0);
    expect(at(2, 0)).toEqual([...towns[0].waves, 5].map(Math.fround));
    expect([...at(3, 0), ...at(4, 0)]).toEqual(
      [0.5, 1, 1.5, 2, 2.5, 0, 0, 0].map(Math.fround),
    );
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

describe("edgeBounds", () => {
  it("holds the town's edge in every direction to a point of the disc", () => {
    for (const t of towns) {
      for (let s = 0; s < 200; s++) {
        // Points round the town, near and far, with discs large and small.
        const a = s * 2.399;
        const d = 0.2 + (s % 17) * 0.6;
        const x = t.x + Math.cos(a) * d;
        const z = t.z + Math.sin(a) * d;
        const half = 0.1 + (s % 5) * 0.3;
        const [lo, hi] = edgeBounds(t, x, z, half);
        for (let k = 0; k < 40; k++) {
          const b = k * 2.399;
          const r = half * Math.sqrt((k + 0.5) / 40);
          const px = x + Math.cos(b) * r;
          const pz = z + Math.sin(b) * r;
          const e = townEdge(t, Math.atan2(pz - t.z, px - t.x));
          expect(e).toBeGreaterThanOrEqual(lo);
          expect(e).toBeLessThanOrEqual(hi);
        }
      }
    }
  });
});

describe("anyTexelNear", () => {
  // A 10 by 10 grid over a sheet 10 units across, one marked texel at
  // column 6, row 3, which covers world x 1 to 2 and z -2 to -1.
  const data = new Uint8Array(100);
  data[3 * 10 + 6] = 1;
  const grid = { data, width: 10, height: 10, stride: 1 };
  const marked = (at: number) => data[at] === 1;

  it("finds a texel the square touches, or the texel beyond it", () => {
    expect(anyTexelNear(grid, 10, 10, 1.5, -1.5, 0.1, marked)).toBe(true);
    // The square reaches x 2.6, in the next texel, one from the marked one.
    expect(anyTexelNear(grid, 10, 10, 2.5, -1.5, 0.1, marked)).toBe(true);
  });

  it("misses a texel two or more away", () => {
    expect(anyTexelNear(grid, 10, 10, 3.5, -1.5, 0.1, marked)).toBe(false);
    expect(anyTexelNear(grid, 10, 10, -3, 3, 0.4, marked)).toBe(false);
  });
});

describe("townCell and fieldCell", () => {
  // A flat sheet 40 units across in 80 cells of 0.5, the size of a real
  // map's cells, and an index of 0.25 unit texels.
  const flat: HeightGrid = {
    data: new Float32Array(81 * 81),
    width: 81,
    height: 81,
  };
  const surface = createTerrainSurface(
    { width: 40, height: 40, heightScale: 1 },
    40,
    flat,
  );
  const cell = surface.worldWidth / surface.segmentsX;
  const local = withStreets(
    planTowns(
      [
        { x: -8, z: -6, capital: true, roads: [0, Math.PI / 3] },
        { x: 9, z: 7, capital: false, roads: [] },
      ],
      3,
    ),
    [],
  );
  const built = buildTownIndex(
    local,
    40,
    40,
    160,
    () => 1,
    () => 1,
  );
  const index = { ...built, stride: 4 };
  const tagAt = (x: number, z: number) => {
    const i = Math.min(159, Math.floor(((x + 20) / 40) * 160));
    const j = Math.min(159, Math.floor(((z + 20) / 40) * 160));
    const at = (j * 160 + i) * 4;
    return built.data[at] * 256 + built.data[at + 1] - 1;
  };
  /** The cells each town's patch keeps, as `i j` keys per town. */
  const kept = (
    keep?: (k: number, x: number, z: number, half: number) => boolean,
  ) => {
    const p = townPatches(local, surface, 0, keep);
    const out = local.map(() => new Set<string>());
    for (let t = 0; t < p.index.length; t += 3) {
      let x = 0;
      let z = 0;
      for (const v of p.index.slice(t, t + 3)) {
        x += p.positions[v * 3] / 3;
        z += p.positions[v * 3 + 2] / 3;
      }
      const key = `${Math.floor((x + 20) / cell)} ${Math.floor((z + 20) / cell)}`;
      out[p.town[p.index[t]]].add(key);
    }
    return out;
  };
  const cellOf = (x: number, z: number) =>
    `${Math.floor((x + 20) / cell)} ${Math.floor((z + 20) / cell)}`;
  /** Every point 0.05 apart where `draws` says town k could draw. */
  const covered = (
    cells: Set<string>[],
    draws: (k: number, d: number, edge: number) => boolean,
  ) => {
    let checked = 0;
    for (let z = -19.98; z < 20; z += 0.05) {
      for (let x = -19.98; x < 20; x += 0.05) {
        const k = tagAt(x, z);
        if (k < 0) continue;
        const t = local[k];
        const d = Math.hypot(x - t.x, z - t.z);
        const edge = townEdge(t, Math.atan2(z - t.z, x - t.x));
        if (!draws(k, d, edge)) continue;
        checked++;
        if (!cells[k].has(cellOf(x, z))) return { checked, missed: [x, z] };
      }
    }
    return { checked, missed: null };
  };
  const townKeep =
    (roadNear: () => boolean) =>
    (k: number, x: number, z: number, half: number) =>
      townCell(local[k], k, index, 40, 40, roadNear)(x, z, half);

  it("keeps every cell a house or the ring can draw on, and far fewer than the disc", () => {
    const cells = kept(townKeep(() => false));
    const result = covered(
      cells,
      (_k, d, edge) => d <= edge * RING_AT + RING_REACH,
    );
    expect(result.missed).toBeNull();
    expect(result.checked).toBeGreaterThan(1000);
    const disc = kept();
    for (const [k, set] of cells.entries()) {
      expect(set.size).toBeLessThan(disc[k].size * 0.5);
    }
  });

  it("keeps the cells of houses along a road when one passes", () => {
    const cells = kept(townKeep(() => true));
    const result = covered(
      cells,
      (k, d, edge) =>
        d <= Math.min(edge * RIBBON_REACH, local[k].radius * RIBBON_RADII),
    );
    expect(result.missed).toBeNull();
  });

  it("keeps every cell a field can lie on and none wholly inside the town", () => {
    const cells = kept((k, x, z, half) =>
      fieldCell(local[k], k, index, 40, 40)(x, z, half),
    );
    const result = covered(
      cells,
      (k, d, edge) =>
        d > edge * FIELD_INNER && d <= local[k].radius * TOWN_REACH,
    );
    expect(result.missed).toBeNull();
    for (const [k, t] of local.entries()) {
      expect(cells[k].has(cellOf(t.x, t.z))).toBe(false);
    }
  });

  it("keeps no field cells where no ground is fit for fields", () => {
    const barren = buildTownIndex(
      local,
      40,
      40,
      160,
      () => 1,
      () => 0,
    );
    const p = townPatches(local, surface, 0, (k, x, z, half) =>
      fieldCell(local[k], k, { ...barren, stride: 4 }, 40, 40)(x, z, half),
    );
    expect(p.index.length).toBe(0);
  });
});

describe("clipRoads", () => {
  // Map units are world units here. A capital, a town on one road, a town a
  // road passes through, and a town no road reaches.
  const clipTowns = planTowns(
    [
      { x: 0, z: 0, capital: true, roads: [0] },
      { x: 30, z: 0, capital: false, roads: [Math.PI] },
      { x: 15, z: 20, capital: false, roads: [] },
      { x: -20, z: 25, capital: false, roads: [] },
    ],
    3,
  );
  const lines: [number, number][][] = [
    // From the capital's anchor to the town on one road.
    [
      [0, 0],
      [30, 0],
    ],
    // From the capital, straight through the third town and on.
    [
      [0, 0],
      [15, 20],
      [30, 40],
    ],
    // A crossing's track from the one-road town down to its landing.
    [
      [30, 0],
      [30, 12],
    ],
  ];
  const same = (x: number, y: number): [number, number] => [x, y];
  const { pieces, arrivals } = clipRoads(lines, clipTowns, same);

  it("leaves no point of any road inside a town's edge", () => {
    let points = 0;
    for (const line of pieces.flat()) {
      for (const [x, z] of line) {
        points++;
        for (const t of clipTowns) {
          const d = Math.hypot(x - t.x, z - t.z);
          const edge = townEdge(t, Math.atan2(z - t.z, x - t.x));
          expect(d).toBeGreaterThan(edge * ROAD_CLIP - 1e-3);
        }
      }
    }
    expect(points).toBeGreaterThan(10);
  });

  it("ends each road at the town's edge, with no gap to it", () => {
    // The first road keeps one piece, cut at both towns.
    expect(pieces[0]).toHaveLength(1);
    const piece = pieces[0][0];
    const [sx, sz] = piece[0];
    const [ex, ez] = piece[piece.length - 1];
    const at = (t: (typeof clipTowns)[number], x: number, z: number) =>
      Math.hypot(x - t.x, z - t.z) / townEdge(t, Math.atan2(z - t.z, x - t.x));
    expect(at(clipTowns[0], sx, sz)).toBeCloseTo(ROAD_CLIP, 3);
    expect(at(clipTowns[1], ex, ez)).toBeCloseTo(ROAD_CLIP, 3);
  });

  it("splits a road that passes through a town, and records where roads arrive", () => {
    expect(pieces[1]).toHaveLength(2);
    // The capital takes both of its roads, the one-road town its road and
    // its crossing's track, and the town passed through two arrivals.
    expect(arrivals[0]).toHaveLength(2);
    expect(arrivals[1]).toHaveLength(2);
    expect(arrivals[2]).toHaveLength(2);
    expect(arrivals[3]).toHaveLength(0);
    // The road to the east arrives at the capital from the east.
    expect(Math.cos(arrivals[0][0])).toBeCloseTo(1, 3);
  });

  it("gives every town main streets, its own where no road arrives", () => {
    const streets = withStreets(clipTowns, arrivals);
    expect(streets[0].streets).toHaveLength(2);
    expect(streets[3].streets.length).toBeGreaterThanOrEqual(2);
    expect(streets.every((t) => t.streets.length <= MAX_STREETS)).toBe(true);
  });

  it("keeps a town's edge within a quarter of its ellipse either way", () => {
    for (const t of clipTowns) {
      for (let k = 0; k < 64; k++) {
        const a = (k / 64) * Math.PI * 2;
        const e = townEdge(t, a);
        expect(e).toBeGreaterThan((t.radius / t.aspect) * 0.72);
        expect(e).toBeLessThan(t.radius * 1.28);
      }
    }
  });
});

describe("farmableAt", () => {
  // Weights 2 pixels wide over a sheet 20 world units square. Texel 0 is all
  // slot 0 (grass on Temperate), texel 1 all slot 2 (forest).
  const weights = (
    left: [number, number],
    right: [number, number],
    planet: "temperate" | "moon" = "temperate",
  ): BiomePixels => ({
    a: new Uint8Array([left[0], 0, left[1], 0, right[0], 0, right[1], 0]),
    b: new Uint8Array(8),
    width: 2,
    height: 1,
    planet,
  });
  const picture = weights([255, 0], [0, 255]);

  it("puts fields on farm slots and nowhere else", () => {
    const flat = farmableAt(picture, 20, 20, () => 1);
    expect(flat(-5, 0)).toBe(1);
    expect(flat(5, 0)).toBe(0);
  });

  it("puts no fields on a planet with no farm slot", () => {
    const flat = farmableAt(
      weights([255, 0], [0, 255], "moon"),
      20,
      20,
      () => 1,
    );
    expect(flat(-5, 0)).toBe(0);
    expect(flat(5, 0)).toBe(0);
  });

  it("decides a blended texel by the larger share", () => {
    const farm = farmableAt(weights([128, 127], [127, 128]), 20, 20, () => 1);
    expect(farm(-5, 0)).toBe(1);
    expect(farm(5, 0)).toBe(0);
  });

  it("keeps fields to flat ground", () => {
    // Ground a house would be built on, but too sloping for a field.
    const sloping = farmableAt(picture, 20, 20, () => 0.8);
    expect(sloping(-5, 0)).toBe(0);
  });

  it("is recorded in the town index's fourth byte", () => {
    const one = planTowns([{ x: -5, z: 0, capital: false, roads: [] }], 1);
    const index = buildTownIndex(
      one,
      20,
      20,
      20,
      () => 1,
      farmableAt(picture, 20, 20, () => 1),
    );
    const at = (x: number) => index.data[(10 * 20 + (x + 10)) * 4 + 3];
    expect(at(-5)).toBe(255);
    expect(at(1)).toBe(0);
  });
});
