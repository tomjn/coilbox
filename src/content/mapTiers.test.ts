import { describe, expect, it } from "vitest";
import type { MapItem } from "./bindings";
import type { MapThumbData } from "./config";
import { mergeMapTiers } from "./mapTiers";

const scanned = (name: string): MapItem => ({
  name,
  archives: [],
  info: {},
});

const thumbsFor = (
  entries: [string, MapThumbData][],
): Map<string, MapThumbData> => new Map(entries);

describe("mergeMapTiers", () => {
  it("leaves the list alone when no later tier has arrived", () => {
    const maps = [scanned("Acidic Quarry 5.17")];
    expect(mergeMapTiers(maps, new Map(), new Map())).toBe(maps);
  });

  it("takes proportions from the thumbnail tier", () => {
    const merged = mergeMapTiers(
      [scanned("Acidic Quarry 5.17")],
      thumbsFor([
        ["Acidic Quarry 5.17", { url: "u", width: 384, height: 256 }],
      ]),
      new Map(),
    );
    expect(merged[0].width).toBe(384);
    expect(merged[0].height).toBe(256);
  });

  it("takes mapinfo from the metadata tier", () => {
    const merged = mergeMapTiers(
      [scanned("Acidic Quarry 5.17")],
      new Map(),
      new Map([["Acidic Quarry 5.17", { description: "A quarry" }]]),
    );
    expect(merged[0].info.description).toBe("A quarry");
  });

  it("leaves a map untouched when only other maps have arrived", () => {
    const waiting = scanned("Waiting");
    const merged = mergeMapTiers(
      [waiting, scanned("Done")],
      thumbsFor([["Done", { url: "u", width: 512, height: 512 }]]),
      new Map(),
    );
    expect(merged[0]).toBe(waiting);
    expect(merged[0].width).toBeUndefined();
    expect(merged[0].info).toEqual({});
  });

  it("keeps whichever tier has already landed when the other has not", () => {
    const merged = mergeMapTiers(
      [{ ...scanned("Both"), width: 128, height: 64 }],
      new Map(),
      new Map([["Both", { author: "someone" }]]),
    );
    expect(merged[0].width).toBe(128);
    expect(merged[0].info.author).toBe("someone");
  });
});
