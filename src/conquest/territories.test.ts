import { describe, expect, it } from "vitest";
import { generateGalaxy } from "./generate";
import { type GalaxyDoc, parseGalaxyJson } from "./model";
import { mulberry32 } from "./rng";
import { BASE_SIZES, LARGE_SIZES } from "./size";
import {
  generateTerrain,
  LAND_LAYOUTS,
  labelLandMasses,
  TERRAIN_MAP_UNITS,
  type TerrainShape,
  terrainPixelAt,
} from "./terrainGen";
import {
  divideLand,
  GENERATED_TERRITORIES_IMAGE,
  generatedTerrain,
  generateTerritories,
  landTerrain,
  type TerritoriesOptions,
} from "./territories";

const NOW = "2026-01-01T00:00:00.000Z";

const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));

const base: TerritoriesOptions = {
  seed: 1,
  game: { shortname: "TG" },
  maps,
  nodeCount: 24,
  factionCount: 2,
};

const SHAPES: TerrainShape[] = [...LAND_LAYOUTS];

/** Every size the wizard offers, the unlockable ones included. */
const SIZES = [
  ...BASE_SIZES.map((s) => Number(s.value)),
  ...LARGE_SIZES.map((s) => s.count),
];

/** Each size once, with the shapes and seeds taken in turn. */
const cases = SIZES.map((nodeCount, i) => ({
  nodeCount,
  layout: SHAPES[i % SHAPES.length],
  seed: 100 + i,
}));

/** The usual ray cast, written apart from the generator's own. */
function inside(ring: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

function reachable(doc: GalaxyDoc): number {
  const adj = new Map<string, string[]>();
  for (const [a, b] of doc.links) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const seen = new Set([doc.nodes[0].id]);
  const queue = [doc.nodes[0].id];
  for (const id of queue) {
    for (const next of adj.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size;
}

describe("generateTerritories", () => {
  for (const { nodeCount, layout, seed } of cases) {
    describe(`${layout}, ${nodeCount} provinces, seed ${seed}`, () => {
      const doc = generateTerritories(
        { ...base, nodeCount, layout, seed },
        NOW,
      );
      const terrain = generatedTerrain(doc);
      if (!terrain) throw new Error("a generated map has generated terrain");
      const { labels } = labelLandMasses(terrain);
      const byId = new Map(doc.nodes.map((n) => [n.id, n]));
      const massOf = (id: string) => {
        const node = byId.get(id);
        if (!node) throw new Error(`no node ${id}`);
        return labels[terrainPixelAt(terrain, node.pos[0], node.pos[1])];
      };

      it("builds the size asked for", () => {
        expect(doc.nodes).toHaveLength(nodeCount);
      });

      it("gives every province one outline inside the map", () => {
        for (const node of doc.nodes) {
          expect(node.outline).toHaveLength(1);
          const ring = node.outline?.[0] ?? [];
          expect(ring.length).toBeGreaterThanOrEqual(3);
          for (const [x, y] of ring) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(TERRAIN_MAP_UNITS);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(TERRAIN_MAP_UNITS);
          }
        }
      });

      it("puts every anchor inside its own outline, on land", () => {
        for (const node of doc.nodes) {
          const ring = node.outline?.[0] ?? [];
          expect(inside(ring, node.pos[0], node.pos[1]), node.id).toBe(true);
          expect(massOf(node.id), node.id).toBeGreaterThanOrEqual(0);
        }
      });

      it("makes every link a shared border or a listed crossing", () => {
        expect(doc.linkKinds).toHaveLength(doc.links.length);
        const kinds = new Map(
          (doc.linkKinds ?? []).map(([a, b, kind]) => [`${a} ${b}`, kind]),
        );
        for (const [a, b] of doc.links) {
          const kind = kinds.get(`${a} ${b}`);
          if (kind === "crossing") {
            expect(massOf(a), `${a} ${b}`).not.toBe(massOf(b));
            continue;
          }
          expect(kind, `${a} ${b}`).toBe("border");
          expect(massOf(a), `${a} ${b}`).toBe(massOf(b));
          // Neighbours are thinned to the same points along the border they
          // share, so both rings hold its two ends.
          const points = new Set(
            (byId.get(a)?.outline?.[0] ?? []).map(([x, y]) => `${x},${y}`),
          );
          const shared = (byId.get(b)?.outline?.[0] ?? []).filter(([x, y]) =>
            points.has(`${x},${y}`),
          );
          expect(shared.length, `${a} ${b}`).toBeGreaterThanOrEqual(2);
        }
      });

      it("blocks no border", () => {
        expect(doc.blockedBorders).toBeUndefined();
      });

      it("is one connected map", () => {
        expect(reachable(doc)).toBe(doc.nodes.length);
      });

      it("survives a save and a load", () => {
        // The whole document, so the generator and the validator cannot drift
        // apart: terrain, outlines and link kinds all have to come back.
        expect(parseGalaxyJson(JSON.stringify(doc))).toEqual(doc);
      });

      it("is the same document from the same seed", () => {
        expect(
          generateTerritories({ ...base, nodeCount, layout, seed }, NOW),
        ).toEqual(doc);
      });
    });
  }

  it("joins separate islands with one crossing fewer than there are groups", () => {
    const doc = generateTerritories(
      { ...base, layout: "archipelago", nodeCount: 40 },
      NOW,
    );
    const crossings = (doc.linkKinds ?? []).filter((l) => l[2] === "crossing");
    const parent = new Map(doc.nodes.map((n) => [n.id, n.id]));
    const find = (id: string): string => {
      const up = parent.get(id) ?? id;
      return up === id ? id : find(up);
    };
    for (const [a, b, kind] of doc.linkKinds ?? []) {
      if (kind === "border") parent.set(find(a), find(b));
    }
    const groups = new Set(doc.nodes.map((n) => find(n.id))).size;

    expect(groups).toBeGreaterThan(1);
    expect(crossings).toHaveLength(groups - 1);
  });

  it("marks its terrain as generated instead of storing the pixels", () => {
    const doc = generateTerritories(base, NOW);

    expect(doc.terrain).toEqual({
      image: GENERATED_TERRITORIES_IMAGE,
      heightmap: GENERATED_TERRITORIES_IMAGE,
      width: TERRAIN_MAP_UNITS,
      height: TERRAIN_MAP_UNITS,
      heightScale: 64,
      projection: "flat",
    });
  });
});

describe("generatedTerrain", () => {
  it("rebuilds the land the provinces were drawn on, random layout included", () => {
    const doc = generateTerritories(
      { ...base, layout: "random", seed: 7 },
      NOW,
    );
    const terrain = generatedTerrain(doc);
    if (!terrain) throw new Error("no terrain");

    for (const node of doc.nodes) {
      const pixel = terrainPixelAt(terrain, node.pos[0], node.pos[1]);
      expect(terrain.land[pixel], node.id).toBe(1);
    }
  });

  it("is null for a galaxy", () => {
    expect(generatedTerrain(generateGalaxy(base, NOW))).toBeNull();
  });

  it("is null once the generation knobs are gone", () => {
    const doc = generateTerritories(base, NOW);

    expect(generatedTerrain({ ...doc, generated: undefined })).toBeNull();
  });
});

describe("generateTerrain", () => {
  // Built once for the whole block: seeds 1 to 6 of every shape, at sizes
  // taken in turn. Every assertion below counts over them.
  const built = SHAPES.flatMap((shape) =>
    [1, 2, 3, 4, 5, 6].map((seed) => {
      const nodeCount = SIZES[seed % SIZES.length];
      const rng = mulberry32(seed);
      const terrain = landTerrain(seed, shape, nodeCount, rng);
      const land = divideLand(terrain, nodeCount, rng);
      const masses = labelLandMasses(terrain).sizes.sort((a, b) => b - a);
      const total = masses.reduce((a, b) => a + b, 0);
      return { shape, seed, nodeCount, terrain, land, masses, total };
    }),
  );

  it("keeps the sea at height 0 and the land above it", () => {
    let wrong = 0;
    for (const { terrain } of built) {
      for (let i = 0; i < terrain.land.length; i++) {
        if (terrain.heightmap[i] > 0 !== (terrain.land[i] === 1)) wrong++;
      }
    }
    expect(wrong).toBe(0);
  });

  it("keeps the land off the edge of the map", () => {
    let edge = 0;
    for (const { terrain } of built) {
      const { width: w, height: h, land } = terrain;
      for (let i = 0; i < w; i++) edge += land[i] + land[(h - 1) * w + i];
      for (let i = 0; i < h; i++) edge += land[i * w] + land[i * w + w - 1];
    }
    expect(edge).toBe(0);
  });

  it("puts every land pixel in a province, and only land pixels", () => {
    let unowned = 0;
    let wet = 0;
    for (const { terrain, land } of built) {
      for (let i = 0; i < terrain.land.length; i++) {
        if (terrain.land[i] && land.owner[i] < 0) unowned++;
        if (!terrain.land[i] && land.owner[i] >= 0) wet++;
      }
    }
    expect(unowned).toBe(0);
    expect(wet).toBe(0);
  });

  it("leaves no land mass without a province", () => {
    const empty = built.filter(
      ({ masses, nodeCount }) => masses.length > nodeCount,
    );
    expect(empty).toHaveLength(0);
  });

  it("makes one land mass for a continent or an inland sea", () => {
    const split = built.filter(
      ({ shape, masses, total }) =>
        (shape === "continent" || shape === "inlandsea") &&
        masses[0] < 0.9 * total,
    );
    expect(split.map((b) => `${b.shape} ${b.seed}`)).toEqual([]);
  });

  it("makes two large land masses for two continents, neither with three quarters of the land", () => {
    const wrong = built.filter(
      ({ shape, masses, total }) =>
        shape === "continents" &&
        (masses[0] + (masses[1] ?? 0) < 0.9 * total ||
          masses[0] > 0.75 * total),
    );
    expect(wrong.map((b) => b.seed)).toEqual([]);
  });

  it("makes at least four islands for an archipelago", () => {
    const few = built.filter(
      ({ shape, masses }) => shape === "archipelago" && masses.length < 4,
    );
    expect(few.map((b) => b.seed)).toEqual([]);
  });

  it("varies the size of provinces", () => {
    // Over seeds 1 to 40 of every shape the largest province was 2.3 to 21
    // times the smallest.
    const even = built.filter(({ land, nodeCount }) => {
      const count = new Int32Array(nodeCount);
      for (const p of land.owner) if (p >= 0) count[p]++;
      return Math.max(...count) < 2 * Math.min(...count);
    });
    expect(even.map((b) => `${b.shape} ${b.seed}`)).toEqual([]);
  });

  it("is the same land from the same seed", () => {
    const again = generateTerrain({ seed: 1, shape: "continent" });
    const once = generateTerrain({ seed: 1, shape: "continent" });
    // Compared as bytes: a deep equal walks a megabyte one element at a time.
    expect(Buffer.from(again.image).equals(Buffer.from(once.image))).toBe(true);
  });
});
