import { describe, expect, it } from "vitest";
import {
  buildableAt,
  CAPITAL_RADIUS,
  CITY_RADIUS,
  clipRoads,
  FLAT_SLOPE,
  leavingAngle,
  MAX_STREETS,
  OUTPOST_RADIUS,
  planTowns,
  ROAD_CLIP,
  roadAxis,
  roadEntries,
  STEEP_FIT,
  STEEP_SLOPE,
  type TownSite,
  townEdge,
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
  // Two busy towns crowded by each other.
  { x: 0, z: -20, capital: false, roads: [0, 1, 2, 3, 4] },
  { x: 4, z: -20, capital: false, roads: [0, 1, 2, 3, 4] },
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
  it("makes a capital the biggest, a junction bigger than a place with no roads, and keeps towns apart", () => {
    expect(towns[0].radius).toBeGreaterThan(CAPITAL_RADIUS);
    expect(towns[1].radius).toBeLessThanOrEqual(CITY_RADIUS);
    expect(towns[1].radius).toBeGreaterThan(towns[2].radius);
    expect(towns[2].radius).toBeGreaterThanOrEqual(OUTPOST_RADIUS);
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
