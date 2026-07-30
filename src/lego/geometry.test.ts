import { afterEach, describe, expect, it } from "vitest";

import {
  disposeSharedMaterial,
  materialCacheKey,
  partMaterial,
} from "./geometry";
import type { LegoAtlas } from "./atlas";

// TextureLoader starts an image load through the DOM the moment a material is
// built. Vitest's node test environment has no document, and the load itself
// is irrelevant to the caching behaviour under test here, so stub just enough
// of one to let it start without throwing.
globalThis.document = {
  createElementNS: () =>
    ({
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as HTMLImageElement,
} as unknown as Document;

function atlas(tex1: string, overrides: Partial<LegoAtlas> = {}): LegoAtlas {
  return { tex1, packId: "test-pack", folder: null, ...overrides };
}

describe("materialCacheKey", () => {
  it("is the same for the same texture", () => {
    expect(materialCacheKey(atlas("atlas.png"))).toBe(
      materialCacheKey(atlas("atlas.png")),
    );
  });

  it("differs when the texture differs", () => {
    expect(materialCacheKey(atlas("atlas.png"))).not.toBe(
      materialCacheKey(atlas("reskin.png")),
    );
  });

  it("ignores which pack ships it, since that does not identify the texture", () => {
    const a = atlas("atlas.png", { packId: "pack-a" });
    const b = atlas("atlas.png", { packId: "pack-b" });
    expect(materialCacheKey(a)).toBe(materialCacheKey(b));
  });

  it("tells the base pack's atlas from one installed as a pack", () => {
    expect(materialCacheKey(atlas("atlas.png"))).not.toBe(
      materialCacheKey(atlas("atlas.png", { folder: "desert" })),
    );
  });
});

describe("partMaterial", () => {
  afterEach(() => {
    disposeSharedMaterial();
  });

  it("returns the same material for the same atlas", () => {
    const m = atlas("atlas.png");
    expect(partMaterial(m)).toBe(partMaterial(m));
  });

  it("returns a different material when the texture differs", () => {
    const a = partMaterial(atlas("atlas.png"));
    const b = partMaterial(atlas("reskin.png"));
    expect(a).not.toBe(b);
    expect(a.map).not.toBe(b.map);
  });

  it("rebuilds the material after disposal", () => {
    const m = atlas("atlas.png");
    const before = partMaterial(m);
    disposeSharedMaterial();
    expect(partMaterial(m)).not.toBe(before);
  });
});
