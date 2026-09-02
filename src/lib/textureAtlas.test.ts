import { describe, expect, it } from "vitest";

import type { AtlasRect, TileSize } from "./textureAtlas";
import { ATLAS_PADDING, atlasPlace, packTiles, placeUvs } from "./textureAtlas";

/** The sizes a Balanced Annihilation unit's `tatex` tiles actually come in. */
const REAL_TILES: TileSize[] = [
  { w: 32, h: 32 },
  { w: 64, h: 64 },
  { w: 64, h: 32 },
  { w: 16, h: 32 },
  { w: 32, h: 64 },
  { w: 64, h: 128 },
  { w: 48, h: 48 },
  { w: 105, h: 105 },
  { w: 8, h: 8 },
  { w: 128, h: 128 },
];

/** Whether two rectangles grown by `padding` on every side touch at all. */
function clash(a: AtlasRect, b: AtlasRect, padding: number): boolean {
  return (
    a.x - padding < b.x + b.w + padding &&
    b.x - padding < a.x + a.w + padding &&
    a.y - padding < b.y + b.h + padding &&
    b.y - padding < a.y + a.h + padding
  );
}

describe("packTiles", () => {
  it("has nothing to pack for an empty list", () => {
    expect(packTiles([])).toBeNull();
  });

  it("keeps every tile at the size it was given, in the order it was given", () => {
    const layout = packTiles(REAL_TILES);
    expect(layout).not.toBeNull();
    expect(layout?.rects).toHaveLength(REAL_TILES.length);
    layout?.rects.forEach((rect, index) => {
      expect({ w: rect.w, h: rect.h }).toEqual(REAL_TILES[index]);
    });
  });

  /**
   * The property the whole sheet rests on. A tile whose padding overlaps its
   * neighbour's is a tile that bleeds into it, and the bleed shows as one unit's
   * paint appearing on another part of the same unit rather than as an error.
   */
  it("leaves the full padding clear around every tile", () => {
    const layout = packTiles(REAL_TILES);
    expect(layout).not.toBeNull();
    if (!layout) return;
    for (const rect of layout.rects) {
      expect(rect.x).toBeGreaterThanOrEqual(ATLAS_PADDING);
      expect(rect.y).toBeGreaterThanOrEqual(ATLAS_PADDING);
      expect(rect.x + rect.w + ATLAS_PADDING).toBeLessThanOrEqual(layout.width);
      expect(rect.y + rect.h + ATLAS_PADDING).toBeLessThanOrEqual(
        layout.height,
      );
    }
    for (let a = 0; a < layout.rects.length; a++) {
      for (let b = a + 1; b < layout.rects.length; b++) {
        expect(clash(layout.rects[a], layout.rects[b], ATLAS_PADDING)).toBe(
          false,
        );
      }
    }
  });

  /**
   * The sizes and counts of every tile in Balanced Annihilation V15.9.8's
   * `unittextures/tatex`, read off this machine's model-texture cache. A unit
   * names about thirty of them, so the sheet a unit gets is a 512 square, or
   * 1 MiB on the GPU, and the whole folder at once would still be one 1024
   * square.
   */
  it("packs a game's whole tile folder into one 1024 sheet", () => {
    const folder: TileSize[] = [];
    const counts: [number, number, number][] = [
      [37, 32, 32],
      [32, 64, 64],
      [18, 64, 32],
      [11, 16, 32],
      [10, 32, 64],
      [4, 64, 128],
      [4, 48, 48],
      [3, 105, 105],
      [1, 96, 96],
      [1, 8, 8],
      [1, 52, 52],
      [1, 51, 51],
      [1, 24, 24],
      [1, 16, 16],
      [1, 128, 128],
    ];
    for (const [n, w, h] of counts) {
      for (let i = 0; i < n; i++) folder.push({ w, h });
    }
    expect(folder).toHaveLength(126);
    expect(packTiles(folder)).toMatchObject({ width: 1024, height: 1024 });
    expect(packTiles(folder.slice(0, 32))).toMatchObject({
      width: 256,
      height: 512,
    });
  });

  /** A tie on area is the common case, since both sides round to a power of
   *  two. Squarest wins, or a sheet of one size of tile comes out as a strip. */
  it("picks the squarest sheet of the ones with the same area", () => {
    const layout = packTiles(new Array(32).fill({ w: 32, h: 32 }));
    expect(layout).toMatchObject({ width: 256, height: 512 });
  });

  it("gives up rather than dropping a tile too big for the sheet", () => {
    expect(packTiles([{ w: 4096, h: 16 }], ATLAS_PADDING, 2048)).toBeNull();
  });

  it("gives up when the tiles together will not fit", () => {
    const many = new Array(400).fill({ w: 128, h: 128 });
    expect(packTiles(many, ATLAS_PADDING, 512)).toBeNull();
  });
});

describe("atlasPlace", () => {
  /**
   * A rectangle is measured down from the top of the canvas and a UV up from
   * the bottom of the texture, because the webview flips a texture on upload.
   */
  it("measures v up from the bottom while y counts down from the top", () => {
    expect(atlasPlace({ x: 0, y: 0, w: 128, h: 128 }, 512, 512)).toEqual({
      u: 0,
      v: 0.75,
      du: 0.25,
      dv: 0.25,
    });
    expect(atlasPlace({ x: 384, y: 384, w: 128, h: 128 }, 512, 512)).toEqual({
      u: 0.75,
      v: 0,
      du: 0.25,
      dv: 0.25,
    });
  });
});

describe("placeUvs", () => {
  /**
   * A `.3do` face is stretched over the whole of its texture, so its corners are
   * exactly the corners of the unit square. Those have to come out as exactly
   * the corners of the tile, since anything else samples a neighbour.
   */
  it("puts the corners of a texture on the corners of its tile", () => {
    const place = atlasPlace({ x: 128, y: 64, w: 64, h: 32 }, 256, 256);
    expect(placeUvs([0, 0, 1, 0, 1, 1, 0, 1], place)).toEqual([
      0.5, 0.625, 0.75, 0.625, 0.75, 0.75, 0.5, 0.75,
    ]);
  });

  it("leaves an empty list alone", () => {
    expect(placeUvs([], atlasPlace({ x: 0, y: 0, w: 1, h: 1 }, 2, 2))).toEqual(
      [],
    );
  });
});
