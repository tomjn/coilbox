import { afterEach, describe, expect, it, vi } from "vitest";
import { teamColourPending } from "../lib/springTexture";
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
      imported({ texture2: { key: "bb22.dds", name: "probe_2.dds" } }),
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

/** The first bytes of a PNG, with the colour type the header carries. */
function pngHeader(colourType: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes[25] = colourType;
  return bytes;
}

function answerWith(colourType: number) {
  vi.stubGlobal(
    "fetch",
    async () => new Response(pngHeader(colourType) as BlobPart),
  );
}

/** Whether the shader patch that mixes the team colour in is on the material. */
function paintsTeamColour(material: {
  customProgramCacheKey: () => string;
}): boolean {
  return material.customProgramCacheKey().includes("coilbox-spring:team");
}

/**
 * The engine mixes the player's colour in by the first texture's alpha, for any
 * unit (issue #3271). A unit of parts samples an atlas, so the atlas's own alpha
 * is the mask, the same as a lifted piece's texture.
 */
describe("partMaterial team colour", () => {
  afterEach(() => {
    disposeSharedMaterial();
    vi.unstubAllGlobals();
  });

  it("paints the team colour where an atlas with an alpha channel marks it", async () => {
    answerWith(6);
    const material = partMaterial(atlas("masked.png"));
    expect(teamColourPending(material)).toBe(true);
    await vi.waitFor(() => expect(paintsTeamColour(material)).toBe(true));
    expect(teamColourPending(material)).toBe(false);
  });

  it("draws an atlas with no alpha channel as it is, with no team colour", async () => {
    answerWith(2);
    const material = partMaterial(atlas("plain.png"));
    await vi.waitFor(() => expect(teamColourPending(material)).toBe(false));
    expect(paintsTeamColour(material)).toBe(false);
  });

  it("paints a lifted piece's texture and an atlas with the same colour", async () => {
    answerWith(6);
    const part = partMaterial(atlas("masked.png"));
    const lifted = importedMaterial({
      texture: { key: "aa11.png", name: "probe_1.png" },
    });
    await vi.waitFor(() => {
      expect(paintsTeamColour(part)).toBe(true);
      expect(paintsTeamColour(lifted.material)).toBe(true);
    });
    lifted.dispose();
  });
});
