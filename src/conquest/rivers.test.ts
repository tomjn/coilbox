import { describe, expect, it } from "vitest";
import { drainNetwork, erodeLand } from "./displayErosion";
import { generatedTerrainPixels, generateMap } from "./mapStyle";
import type { PlanetId } from "./planets";
import {
  carveRiverValleys,
  findRivers,
  RIVER_FIELD_INSIDE,
  RIVER_FIELD_OUTSIDE,
  type RiverLine,
  riverFieldPixels,
} from "./rivers";
import { mulberry32 } from "./rng";

const SIDE = 160;

/**
 * Land falling to a sea along the bottom edge, with a ridge down the middle
 * and a little noise, so water gathers into several valleys.
 */
function slope(): Float32Array {
  const rng = mulberry32(11);
  const out = new Float32Array(SIDE * SIDE);
  for (let y = 0; y < SIDE - 8; y++) {
    for (let x = 0; x < SIDE; x++) {
      const ridge = 0.1 * Math.exp(-(((x - SIDE / 2) / 30) ** 2));
      out[y * SIDE + x] = 0.02 + (SIDE - y) * 0.002 + ridge + rng() * 0.01;
    }
  }
  return out;
}

const network = () => {
  const h = slope();
  // Half resolution, as the erosion routes water.
  const hw = SIDE / 2;
  const half = new Float32Array(hw * hw);
  for (let y = 0; y < hw; y++)
    for (let x = 0; x < hw; x++) half[y * hw + x] = h[y * 2 * SIDE + x * 2];
  return drainNetwork(half, hw, hw);
};

/** The point `k` of a river, as x and y. */
const pointOf = (r: RiverLine, k: number) => [
  r.points[k * 3],
  r.points[k * 3 + 1],
];

describe("findRivers", () => {
  it("ends every branch on a point of the river it joins", () => {
    const rivers = findRivers(network(), 60);
    const branches = rivers.filter((r) => r.joins >= 0);
    expect(rivers.length).toBeGreaterThan(branches.length);
    expect(branches.length).toBeGreaterThan(0);
    for (const branch of branches) {
      // Parents come first.
      expect(branch.joins).toBeLessThan(rivers.indexOf(branch));
      const parent = rivers[branch.joins];
      const end = pointOf(branch, branch.points.length / 3 - 1);
      let found = false;
      for (let k = 0; k < parent.points.length / 3; k++) {
        const p = pointOf(parent, k);
        if (p[0] === end[0] && p[1] === end[1]) found = true;
      }
      expect(found).toBe(true);
    }
  });

  it("gives the same rivers twice", () => {
    const a = findRivers(network(), 60);
    const b = findRivers(network(), 60);
    expect(a.length).toBe(b.length);
    a.forEach((r, i) => {
      expect(Array.from(r.points)).toEqual(Array.from(b[i].points));
      expect(r.joins).toBe(b[i].joins);
    });
  });

  it("finds fewer rivers on dry ground and none past all the rain", () => {
    const net = network();
    const wet = findRivers(net, 60);
    const dry = findRivers(net, 60, new Float32Array(net.area.length).fill(1));
    expect(dry.length).toBeLessThan(wet.length);
    expect(findRivers(net, net.area.length + 1)).toEqual([]);
  });

  it("widens a river downstream", () => {
    const main = findRivers(network(), 60).find((r) => r.joins < 0);
    expect(main).toBeDefined();
    const p = (main as RiverLine).points;
    expect(p[p.length - 4]).toBeGreaterThan(p[2]);
  });
});

describe("carveRiverValleys", () => {
  it("lowers the ground along a river and nowhere raises it or the sea", () => {
    const h = slope();
    const line: RiverLine = {
      points: new Float32Array([20, 20, 0.05, 20, 150, 0.05]),
      joins: -1,
    };
    const out = carveRiverValleys(h, SIDE, SIDE, [line], 0.2);
    for (let i = 0; i < h.length; i++) {
      expect(out[i]).toBeLessThanOrEqual(h[i]);
      if (h[i] === 0) expect(out[i]).toBe(0);
      if (h[i] > 0) expect(out[i]).toBeGreaterThan(0);
    }
    expect(out[80 * SIDE + 20]).toBeLessThan(h[80 * SIDE + 20]);
    expect(out[80 * SIDE + 60]).toBe(h[80 * SIDE + 60]);
  });
});

describe("riverFieldPixels", () => {
  it("reads water on a river and nothing far from one", () => {
    const line: RiverLine = {
      points: new Float32Array([10, 50, 0.05, 90, 50, 0.05]),
      joins: -1,
    };
    const field = riverFieldPixels([line], 100, 100, 0.2);
    const at = (x: number, y: number) =>
      field.data[
        Math.floor((y / 100) * field.height) * field.width +
          Math.floor((x / 100) * field.width)
      ];
    const span = RIVER_FIELD_INSIDE + RIVER_FIELD_OUTSIDE;
    const edge = (v: number) => (v / 255) * span - RIVER_FIELD_INSIDE;
    expect(edge(at(50, 50))).toBeLessThan(0);
    expect(edge(at(50, 52))).toBeGreaterThan(0);
    expect(at(50, 80)).toBe(255);
  });
});

describe("rivers on generated land", () => {
  const land = (planet: PlanetId) =>
    generatedTerrainPixels(
      generateMap({
        seed: 35058,
        // biome-ignore lint/suspicious/noExplicitAny: only the name is read
        game: { name: "test" } as any,
        maps: ["a", "b", "c", "d", "e", "f"].map((name) => ({ name })),
        nodeCount: 18,
        factionCount: 2,
        layout: "continents",
        skin: "territories",
        planet,
        id: "test",
        title: "test",
      }),
    );

  it("runs rivers on a temperate world and none on a volcanic one", () => {
    expect(land("temperate")?.extension?.rivers?.lines.length).toBeGreaterThan(
      0,
    );
    expect(land("volcanic")?.extension?.rivers).toBeUndefined();
  }, 60000);

  it("keeps the eroded network that rivers follow", () => {
    const h = slope();
    expect(erodeLand(h, SIDE, SIDE, 3).network).toBeDefined();
  });
});
