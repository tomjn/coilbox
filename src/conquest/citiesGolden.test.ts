import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CitiesOptions, generateCities } from "./cities";
import type { GalaxyDoc } from "./model";
import { hashString } from "./rng";
import { BASE_SIZES, LARGE_SIZES } from "./size";
import { LAND_LAYOUTS, type LandLayout } from "./terrainGen";
import { generatedTerrain } from "./territories";

/**
 * Golden Cities maps (issue #3506), on the same footing as
 * `terrainGolden.test.ts`: a shared seed has to mean the same map on every
 * engine, so what each seed builds is checked in.
 *
 * Every size the wizard offers is pinned for each layout, as one line per case
 * in `hashes.txt` holding the hash of the land mask, the heightmap, the colour
 * image and the rendered document. The smallest size of each layout also has
 * its document checked in whole, so a failure there reads as the city or road
 * that moved.
 *
 * Regenerate after an intended change with:
 *   UPDATE_CITIES_GOLDEN=1 bun run test citiesGolden
 * then read the diff before committing it.
 */

const GOLDEN_DIR = join(__dirname, "fixtures", "cities");
const HASHES = join(GOLDEN_DIR, "hashes.txt");
const UPDATE = Boolean(process.env.UPDATE_CITIES_GOLDEN);

const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));

const base: CitiesOptions = {
  seed: 1,
  game: { shortname: "TG" },
  maps,
  nodeCount: 12,
  factionCount: 2,
};

const LAYOUTS: LandLayout[] = [...LAND_LAYOUTS];
const SIZES = [
  ...BASE_SIZES.map((s) => Number(s.value)),
  ...LARGE_SIZES.map((s) => s.count),
];
const SMALLEST = Math.min(...SIZES);

/** FNV-1a over raw bytes, as `hashString` is over characters. */
function hashBytes(bytes: Uint8Array | Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** One line per faction, city and link, as the galaxy goldens do it. */
function render(doc: GalaxyDoc): string {
  const t = doc.terrain;
  const lines = [
    `id ${doc.id}`,
    `title ${doc.title}`,
    `description ${doc.description ?? ""}`,
    `terrain image=${t?.image} heightmap=${t?.heightmap} size=${t?.width}x${t?.height} heightScale=${t?.heightScale} projection=${t?.projection}`,
    `generated ${JSON.stringify(doc.generated)}`,
  ];
  for (const f of doc.factions) {
    lines.push(
      `faction ${f.id} name=${JSON.stringify(f.name)} color=${f.color} aggression=${String(f.aggression)} side=${f.side ?? ""}`,
    );
  }
  for (const n of doc.nodes) {
    lines.push(
      [
        `node ${n.id}`,
        `name=${JSON.stringify(n.name)}`,
        `pos=${n.pos.map(String).join(",")}`,
        `owner=${n.owner}`,
        `kind=${n.kind ?? "normal"}`,
        `difficulty=${String(n.difficulty)}`,
        `map=${JSON.stringify(n.battle.mapName)}`,
      ].join(" "),
    );
  }
  const kinds = doc.linkKinds ?? [];
  doc.links.forEach(([a, b], i) => {
    lines.push(`link ${a} ${b} ${kinds[i]?.join(" ")}`);
  });
  return `${lines.join("\n")}\n`;
}

const emitted: string[] = [];

describe("cities golden maps", () => {
  for (const layout of LAYOUTS) {
    for (const nodeCount of SIZES) {
      const name = `${layout}-${nodeCount}-seed1`;
      it(`${name} matches its checked-in map`, () => {
        // `now` is fixed so the only thing that can move is the generation.
        const doc = generateCities(
          { ...base, layout, nodeCount },
          "2026-01-01T00:00:00.000Z",
        );
        const terrain = generatedTerrain(doc);
        if (!terrain) throw new Error("a generated map has generated terrain");
        const text = render(doc);
        const line = [
          name,
          `land=${hashBytes(terrain.land)}`,
          `heightmap=${hashBytes(terrain.heightmap)}`,
          `image=${hashBytes(terrain.image)}`,
          `biomesA=${hashBytes(terrain.biomes.a)}`,
          `biomesB=${hashBytes(terrain.biomes.b)}`,
          `doc=${hashString(text).toString(16).padStart(8, "0")}`,
        ].join(" ");
        emitted.push(line);

        if (nodeCount === SMALLEST) {
          const path = join(GOLDEN_DIR, `${name}.txt`);
          if (UPDATE) {
            mkdirSync(GOLDEN_DIR, { recursive: true });
            writeFileSync(path, text);
          }
          expect(text).toBe(readFileSync(path, "utf8"));
        }
        if (!UPDATE) {
          expect(readFileSync(HASHES, "utf8").split("\n")).toContain(line);
        }
      });
    }
  }

  it("has a checked-in hash for every case and no others", () => {
    const text = `${emitted.join("\n")}\n`;
    if (UPDATE) {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      writeFileSync(HASHES, text);
    }

    expect(text).toBe(readFileSync(HASHES, "utf8"));
    expect(emitted).toHaveLength(LAYOUTS.length * SIZES.length);
  });
});
