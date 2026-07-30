import { afterEach, describe, expect, it } from "vitest";

import {
  disposeSharedMaterial,
  materialCacheKey,
  partMaterial,
} from "./geometry";
import type { LegoPackManifest } from "./pack";

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

function manifest(
  tex1: string,
  overrides: Partial<Pick<LegoPackManifest, "id" | "version">> = {},
): LegoPackManifest {
  return {
    schemaVersion: 1,
    id: "test-pack",
    version: "1.0.0",
    licence: "CC0",
    atlas: { width: 2048, height: 2048 },
    textures: { tex1 },
    geometry: {
      file: "parts.bin.gz",
      encoding: "gzip",
      bytes: 0,
      vertexStride: 8,
    },
    categories: [],
    parts: [],
    ...overrides,
  };
}

describe("materialCacheKey", () => {
  it("is the same for the same texture", () => {
    expect(materialCacheKey(manifest("atlas.png"))).toBe(
      materialCacheKey(manifest("atlas.png")),
    );
  });

  it("differs when the texture differs", () => {
    expect(materialCacheKey(manifest("atlas.png"))).not.toBe(
      materialCacheKey(manifest("reskin.png")),
    );
  });

  it("ignores the pack id and version, since neither identifies the texture", () => {
    const a = manifest("atlas.png", { id: "pack-a", version: "1.0.0" });
    const b = manifest("atlas.png", { id: "pack-b", version: "2.0.0" });
    expect(materialCacheKey(a)).toBe(materialCacheKey(b));
  });
});

describe("partMaterial", () => {
  afterEach(() => {
    disposeSharedMaterial();
  });

  it("returns the same material for the same manifest", () => {
    const m = manifest("atlas.png");
    expect(partMaterial(m)).toBe(partMaterial(m));
  });

  it("returns a different material when the texture differs", () => {
    const a = partMaterial(manifest("atlas.png"));
    const b = partMaterial(manifest("reskin.png"));
    expect(a).not.toBe(b);
    expect(a.map).not.toBe(b.map);
  });

  it("rebuilds the material after disposal", () => {
    const m = manifest("atlas.png");
    const before = partMaterial(m);
    disposeSharedMaterial();
    expect(partMaterial(m)).not.toBe(before);
  });
});
