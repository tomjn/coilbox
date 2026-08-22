import { afterEach, describe, expect, it } from "vitest";
import type { LegoAtlas } from "./atlas";
import {
  disposeSharedMaterial,
  importedMaterial,
  materialCacheKey,
  partMaterial,
} from "./geometry";
import type { LegoImported } from "./model";

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

describe("importedMaterial", () => {
  function imported(over: Partial<LegoImported> = {}): LegoImported {
    return {
      source: "/games/x.sdd/objects3d/probe.s3o",
      texture: { key: "aa11.dds", name: "probe_1.dds" },
      ...over,
    };
  }

  /**
   * The engine throws away every pixel the second texture's alpha masks off, so
   * a viewer that does not read it draws a solid rectangle where the model has a
   * radar dish or a fence (issue #1911).
   */
  it("cuts out what the second texture masks off", () => {
    const { material, dispose } = importedMaterial(
      imported({ teamMask: { key: "bb22.dds", name: "probe_2.dds" } }),
    );
    expect(material.alphaMap).not.toBeNull();
    expect(material.alphaTest).toBe(0.5);
    dispose();
  });

  /** A unit with no second texture draws whole, the way the engine draws one
   *  whose second texture is missing. */
  it("draws the unit whole when there is no second texture", () => {
    const { material, dispose } = importedMaterial(imported());
    expect(material.alphaMap).toBeNull();
    expect(material.alphaTest).toBe(0);
    dispose();
  });
});
