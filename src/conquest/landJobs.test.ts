import { describe, expect, it } from "vitest";
import type { GenerateOptions } from "./generate";
import {
  generateMapOffThread,
  landPreviewOffThread,
  terrainPixelsOffThread,
} from "./landJobs";
import { generateMap } from "./mapStyle";

const maps = Array.from({ length: 12 }, (_, i) => ({
  name: `Map ${i}`,
  width: 4 + i,
  height: 4 + i,
}));

const base: GenerateOptions = {
  seed: 7,
  game: { shortname: "TG" },
  maps,
  nodeCount: 18,
  factionCount: 2,
  skin: "territories",
  layout: "random",
  id: "preview",
  title: "TG Conquest",
};

/** The keys a `for...in` walk of the tree reaches that hold a typed array. */
function enumerableArrays(value: unknown, path = ""): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    ArrayBuffer.isView(child)
      ? [`${path}${key}`]
      : enumerableArrays(child, `${path}${key}.`),
  );
}

describe("map generation off the main thread", () => {
  it("builds the map the generator builds", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const doc = await generateMapOffThread(base);
    expect({ ...doc, createdAt: now, updatedAt: now }).toEqual(
      generateMap(base, now),
    );
  });

  it("gives a land preview a picture that follows the planet", async () => {
    const desert = await landPreviewOffThread({ ...base, planet: "desert" });
    const ice = await landPreviewOffThread({ ...base, planet: "ice" });
    expect(desert.picture?.image).toHaveLength(512 * 512 * 4);
    expect(desert.picture?.image).not.toEqual(ice.picture?.image);
  });

  it("gives a galaxy preview no picture", async () => {
    const galaxy = await landPreviewOffThread({ ...base, skin: "galaxy" });
    expect(galaxy.picture).toBeNull();
  });

  // React's development build walks a changed prop key by key, and a typed
  // array it can see is walked one element at a time.
  it("keeps every typed array out of key enumeration", async () => {
    const preview = await landPreviewOffThread(base);
    expect(enumerableArrays(preview)).toEqual([]);

    const pixels = await terrainPixelsOffThread(generateMap(base));
    expect(enumerableArrays(pixels)).toEqual([]);
    expect(pixels?.height?.data).toHaveLength(512 * 512);
    expect(pixels?.extension?.image.data.length).toBeGreaterThan(0);
  });

  it("answers the same land with the same pixels", async () => {
    const doc = generateMap(base);
    const first = await terrainPixelsOffThread(doc);
    // The same document read a second time is a new object.
    const again = await terrainPixelsOffThread(structuredClone(doc));
    expect(again).toBe(first);
    const other = await terrainPixelsOffThread(
      generateMap({ ...base, planet: "ice" }),
    );
    expect(other).not.toBe(first);
  });

  it("has no pixels for a map with no generated land", async () => {
    expect(
      await terrainPixelsOffThread(generateMap({ ...base, skin: "galaxy" })),
    ).toBeUndefined();
  });
});
