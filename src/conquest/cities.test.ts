import { describe, expect, it } from "vitest";
import {
  type CitiesOptions,
  GENERATED_CITIES_IMAGE,
  generateCities,
} from "./cities";
import { type GalaxyDoc, parseGalaxyJson } from "./model";
import { mulberry32 } from "./rng";
import { BASE_SIZES, LARGE_SIZES } from "./size";
import {
  LAND_LAYOUTS,
  type LandLayout,
  labelLandMasses,
  TERRAIN_HEIGHT_SCALE,
  TERRAIN_MAP_UNITS,
  terrainPixelAt,
} from "./terrainGen";
import { generatedTerrain, landTerrain } from "./territories";

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

const LAYOUTS: LandLayout[] = [...LAND_LAYOUTS];

/** Every size the wizard offers, the unlockable ones included. */
const SIZES = [
  ...BASE_SIZES.map((s) => Number(s.value)),
  ...LARGE_SIZES.map((s) => s.count),
];

const SEEDS = [2, 7, 42];

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

        it("builds the size asked for, as one connected map", () => {
          expect(doc.nodes).toHaveLength(nodeCount);
          expect(reachable(doc)).toBe(nodeCount);
        });

        it("survives a save and a load", () => {
          expect(parseGalaxyJson(JSON.stringify(doc))).toEqual(doc);
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

        it("keeps a road on one land mass and crosses between two", () => {
          const kinds = doc.linkKinds ?? [];
          expect(kinds).toHaveLength(doc.links.length);
          const wrong: string[] = [];
          for (const [i, [a, b, kind]] of kinds.entries()) {
            expect([a, b]).toEqual(doc.links[i]);
            // A crossing can also join two cities on one land mass, where the
            // way between them is over a bay.
            if (kind === "road" && massOf(a) !== massOf(b)) {
              wrong.push(`${a} to ${b}`);
            }
            if (kind !== "road" && kind !== "crossing") wrong.push(kind);
          }
          expect(wrong).toEqual([]);
        });
      });
    }
  }

  it("is the same document from the same seed", () => {
    const opts = { ...base, layout: "archipelago" as const };
    expect(generateCities(opts, NOW)).toEqual(generateCities(opts, NOW));
  });

  it("has both roads and crossings on an archipelago", () => {
    const doc = generateCities(
      { ...base, layout: "archipelago", nodeCount: 160 },
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
    const drawn = landTerrain(
      base.seed,
      "random",
      doc.nodes.length,
      mulberry32(base.seed),
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

  it("is null once the generation knobs are gone", () => {
    const doc = generateCities(base, NOW);
    expect(generatedTerrain({ ...doc, generated: undefined })).toBeNull();
  });
});
