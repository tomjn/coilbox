import { describe, expect, it } from "vitest";
import {
  type CitiesOptions,
  citiesTerrain,
  cityMapScale,
  GENERATED_CITIES_IMAGE,
  generateCities,
} from "./cities";
import { type GalaxyLayout, generateGalaxy } from "./generate";
import { type GalaxyDoc, parseGalaxyJson } from "./model";
import { BASE_SIZES, LARGE_SIZES } from "./size";
import {
  labelLandMasses,
  TERRAIN_HEIGHT_SCALE,
  TERRAIN_MAP_UNITS,
  terrainPixelAt,
} from "./terrainGen";
import { generatedTerrain } from "./territories";

const NOW = "2026-01-01T00:00:00.000Z";

const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));

const base: CitiesOptions = {
  seed: 1,
  game: { shortname: "TG" },
  maps,
  nodeCount: 24,
  factionCount: 2,
};

const LAYOUTS: GalaxyLayout[] = ["scatter", "spiral", "clusters", "ring"];

/** Every size the wizard offers, the unlockable ones included. */
const SIZES = [
  ...BASE_SIZES.map((s) => Number(s.value)),
  ...LARGE_SIZES.map((s) => s.count),
];

const SEEDS = [2, 7, 42];

/** A document with everything the Cities style adds or moves taken out. */
function strategic(doc: GalaxyDoc) {
  const { description: _d, terrain: _t, linkKinds: _k, ...rest } = doc;
  return { ...rest, nodes: doc.nodes.map(({ pos: _p, ...node }) => node) };
}

/** Does any land touch the edge of the terrain? */
function landOnEdge(land: Uint8Array, width: number, height: number): boolean {
  for (let x = 0; x < width; x++) {
    if (land[x] || land[(height - 1) * width + x]) return true;
  }
  for (let y = 0; y < height; y++) {
    if (land[y * width] || land[y * width + width - 1]) return true;
  }
  return false;
}

describe("generateCities", () => {
  for (const [i, nodeCount] of SIZES.entries()) {
    for (const [j, layout] of LAYOUTS.entries()) {
      // Every size with every layout, and each size with every seed.
      const seed = SEEDS[(i + j) % SEEDS.length];
      describe(`${layout}, ${nodeCount} cities, seed ${seed}`, () => {
        const opts = { ...base, nodeCount, layout, seed };
        const doc = generateCities(opts, NOW);
        const galaxy = generateGalaxy(opts, NOW);
        // The land as a saved document rebuilds it, which is what is drawn.
        const terrain = generatedTerrain(
          JSON.parse(JSON.stringify(doc)) as GalaxyDoc,
        );
        if (!terrain) {
          throw new Error("a generated map has generated terrain");
        }
        const { labels } = labelLandMasses(terrain);
        const byId = new Map(doc.nodes.map((n) => [n.id, n]));
        const massOf = (id: string) => {
          const node = byId.get(id);
          if (!node) throw new Error(`no node ${id}`);
          return labels[terrainPixelAt(terrain, node.pos[0], node.pos[1])];
        };

        it("has the galaxy's nodes, links, owners, capitals, difficulty and battles", () => {
          expect(doc.nodes).toHaveLength(nodeCount);
          expect(strategic(doc)).toEqual(strategic(galaxy));
          expect(doc.nodes.map((n) => n.id)).toEqual(
            galaxy.nodes.map((n) => n.id),
          );
          expect(doc.links).toEqual(galaxy.links);
          for (const [i, node] of doc.nodes.entries()) {
            const from = galaxy.nodes[i];
            expect(node.owner).toBe(from.owner);
            expect(node.kind).toBe(from.kind);
            expect(node.difficulty).toBe(from.difficulty);
            expect(node.battle).toEqual(from.battle);
          }
        });

        it("puts each city where the galaxy has it, scaled about the middle of the map", () => {
          const scale = cityMapScale(
            galaxy.nodes.map((n) => [n.pos[0], n.pos[1]]),
          );
          expect(scale).toBeGreaterThan(0);
          const half = TERRAIN_MAP_UNITS / 2;
          for (const [i, node] of doc.nodes.entries()) {
            const [gx, gy] = galaxy.nodes[i].pos;
            expect(node.pos).toHaveLength(2);
            // Rounded to one decimal place, so within half of that.
            expect(Math.abs(node.pos[0] - (half + scale * gx))).toBeLessThan(
              0.0501,
            );
            expect(Math.abs(node.pos[1] - (half + scale * gy))).toBeLessThan(
              0.0501,
            );
            expect(node.pos[0]).toBeGreaterThan(0);
            expect(node.pos[0]).toBeLessThan(TERRAIN_MAP_UNITS);
            expect(node.pos[1]).toBeGreaterThan(0);
            expect(node.pos[1]).toBeLessThan(TERRAIN_MAP_UNITS);
          }
        });

        it("puts every city on land and gives none an outline", () => {
          for (const node of doc.nodes) {
            const pixel = terrainPixelAt(terrain, node.pos[0], node.pos[1]);
            expect(terrain.land[pixel], node.id).toBe(1);
            expect(node.outline).toBeUndefined();
          }
        });

        it("keeps the land off the edge of the map", () => {
          expect(landOnEdge(terrain.land, terrain.width, terrain.height)).toBe(
            false,
          );
        });

        it("marks a link a road on one land mass and a crossing between two", () => {
          const kinds = doc.linkKinds ?? [];
          expect(kinds).toHaveLength(doc.links.length);
          for (const [i, [a, b, kind]] of kinds.entries()) {
            expect([a, b]).toEqual(doc.links[i]);
            expect(kind, `${a} to ${b}`).toBe(
              massOf(a) === massOf(b) ? "road" : "crossing",
            );
          }
        });
      });
    }
  }

  it("matches the galaxy with every strategic option set", () => {
    const opts: CitiesOptions = {
      ...base,
      seed: 9,
      nodeCount: 40,
      factionCount: 3,
      layout: "random",
      startingSystems: 2,
      fogOfWar: true,
      threatLevel: 2,
      startPosition: "centre",
      id: "my-cities",
      title: "My cities",
    };
    expect(strategic(generateCities(opts, NOW))).toEqual(
      strategic(generateGalaxy(opts, NOW)),
    );
  });

  it("is the same document from the same seed", () => {
    const opts = { ...base, layout: "clusters" as const };
    expect(generateCities(opts, NOW)).toEqual(generateCities(opts, NOW));
  });

  it("has both roads and crossings on a map of separate clusters", () => {
    const doc = generateCities(
      { ...base, layout: "clusters", nodeCount: 160 },
      NOW,
    );
    const kinds = (doc.linkKinds ?? []).map(([, , kind]) => kind);
    expect(kinds).toContain("road");
    expect(kinds).toContain("crossing");
    expect(new Set(kinds).size).toBe(2);
  });

  it("marks its terrain as generated instead of storing the pixels", () => {
    const doc = generateCities(base, NOW);
    expect(doc.terrain).toEqual({
      image: GENERATED_CITIES_IMAGE,
      heightmap: GENERATED_CITIES_IMAGE,
      width: TERRAIN_MAP_UNITS,
      height: TERRAIN_MAP_UNITS,
      heightScale: TERRAIN_HEIGHT_SCALE,
      projection: "flat",
    });
    expect(doc.description).toBe("A generated map of 24 cities.");
  });

  it("is a document the parser accepts", () => {
    const doc = generateCities(base, NOW);
    const parsed = parseGalaxyJson(JSON.stringify(doc));
    expect(parsed?.nodes.map((n) => n.pos)).toEqual(
      doc.nodes.map((n) => n.pos),
    );
    expect(parsed?.links).toEqual(doc.links);
  });
});

describe("generatedTerrain for a Cities map", () => {
  it("rebuilds the land the generator drew, byte for byte", () => {
    const doc = generateCities({ ...base, layout: "random" }, NOW);
    const drawn = citiesTerrain(
      base.seed,
      doc.nodes.map((n) => [n.pos[0], n.pos[1]]),
    );
    const rebuilt = generatedTerrain(
      JSON.parse(JSON.stringify(doc)) as GalaxyDoc,
    );
    if (!rebuilt) throw new Error("a generated map has generated terrain");
    const same = (a: Uint8Array | Uint8ClampedArray, b: typeof a) =>
      Buffer.from(a.buffer).equals(Buffer.from(b.buffer));
    expect(same(rebuilt.land, drawn.land)).toBe(true);
    expect(same(rebuilt.heightmap, drawn.heightmap)).toBe(true);
    expect(same(rebuilt.image, drawn.image)).toBe(true);
  });

  it("follows the document's own cities, not a second run of the scatter", () => {
    const doc = generateCities(base, NOW);
    const moved: GalaxyDoc = {
      ...doc,
      nodes: doc.nodes.map((n) => ({ ...n, pos: [n.pos[0] + 40, n.pos[1]] })),
    };
    const terrain = generatedTerrain(moved);
    if (!terrain) throw new Error("a generated map has generated terrain");
    for (const node of moved.nodes) {
      expect(
        terrain.land[terrainPixelAt(terrain, node.pos[0], node.pos[1])],
      ).toBe(1);
    }
    const before = generatedTerrain(doc);
    if (!before) throw new Error("a generated map has generated terrain");
    expect(
      Buffer.from(terrain.land.buffer).equals(Buffer.from(before.land.buffer)),
    ).toBe(false);
  });

  it("is null once the generation knobs are gone", () => {
    const doc = generateCities(base, NOW);
    expect(generatedTerrain({ ...doc, generated: undefined })).toBeNull();
  });
});
