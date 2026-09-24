import { describe, expect, it, vi } from "vitest";
import { BITMAP_LASER, BITMAP_MUZZLE_FLAME, BITMAP_SMOKE } from "./effects";

vi.mock("@/content/bindings", () => ({
  unitsyncLuaExec: vi.fn(),
}));
vi.mock("./bindings", () => ({
  legoBitmapPng: vi.fn(),
}));

import { unitsyncLuaExec } from "@/content/bindings";
import { legoBitmapPng } from "./bindings";
import {
  atlasBuilder,
  loadEffectBitmaps,
  missingNote,
  packShelves,
  parseBitmaps,
  slotOf,
} from "./effectBitmaps";

describe("parseBitmaps", () => {
  it("reads each bitmap's key, file and bytes from the quoted result", () => {
    const result =
      '"muzzleflame|explo.tga|00ff;laserfalloff||;smoke1|smoke\\\\smoke00.tga|"';
    expect(parseBitmaps(result)).toEqual([
      { key: "muzzleflame", file: "explo.tga", hex: "00ff" },
      { key: "laserfalloff", file: null, hex: null },
      { key: "smoke1", file: "smoke\\smoke00.tga", hex: null },
    ]);
  });

  it("reads nothing from no result", () => {
    expect(parseBitmaps(undefined)).toEqual([]);
  });
});

describe("slotOf", () => {
  it("puts each bitmap in its atlas slot", () => {
    expect(slotOf("muzzleflame")).toBe(BITMAP_MUZZLE_FLAME);
    expect(slotOf("laserfalloff")).toBe(BITMAP_LASER);
    expect(slotOf("smoke1")).toBe(BITMAP_SMOKE);
    expect(slotOf("smoke3")).toBe(BITMAP_SMOKE + 2);
  });
});

describe("missingNote", () => {
  it("says nothing when every bitmap loaded", () => {
    expect(missingNote([])).toBeNull();
  });

  it("names the missing bitmaps", () => {
    expect(missingNote(["bitmaps/laserfalloff.tga"])).toBe(
      "The game has no bitmaps/laserfalloff.tga, so those are drawn as a plain round sprite.",
    );
    expect(missingNote(["a", "b", "c"])).toBe(
      "The game has no a, b and c, so those are drawn as a plain round sprite.",
    );
  });
});

describe("packShelves", () => {
  it("places every image without overlap, a pixel apart", () => {
    const sizes = [
      { slot: 0, width: 64, height: 64 },
      { slot: 1, width: 16, height: 128 },
      { slot: 2, width: 32, height: 32 },
      { slot: 3, width: 32, height: 32 },
    ];
    const { width, height, rects } = packShelves(sizes);
    expect(rects).toHaveLength(4);
    for (const rect of rects) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(height);
    }
    for (const a of rects) {
      for (const b of rects) {
        if (a === b) continue;
        const apart =
          a.x + a.width + 1 <= b.x ||
          b.x + b.width + 1 <= a.x ||
          a.y + a.height + 1 <= b.y ||
          b.y + b.height + 1 <= a.y;
        expect(apart).toBe(true);
      }
    }
  });
});

/** One resources.lua result with every key present but the laser bitmap
 *  named nothing, the shape a game with no `laserfalloff.tga` sends back. */
function quotedResult(): string {
  const entries = [
    "muzzleflame|explo.tga|00ff",
    "laserfalloff|laserfalloff.tga|",
  ];
  for (let i = 1; i <= 12; i++) entries.push(`smoke${i}|smoke${i}.tga|00ff`);
  const escaped = entries.join(";").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

describe("loadEffectBitmaps", () => {
  it("reports the game's missing bitmaps in the note", async () => {
    vi.mocked(unitsyncLuaExec).mockResolvedValue({
      result: quotedResult(),
      errors: [],
    });
    vi.mocked(legoBitmapPng).mockImplementation(async ({ file }) => ({
      dataUrl: `data:image/png;base64,${file}`,
      width: 16,
      height: 16,
    }));
    vi.spyOn(atlasBuilder, "build").mockResolvedValue({
      texture: { dispose: vi.fn() } as never,
      packed: {
        width: 64,
        height: 64,
        rects: [
          { slot: BITMAP_MUZZLE_FLAME, x: 0, y: 0, width: 16, height: 16 },
        ],
      },
      failed: [],
    });

    const result = await loadEffectBitmaps(
      { enginePath: "/engine", dataDir: "/data" },
      "Game.sdd",
    );

    expect(result.note).toContain("bitmaps/laserfalloff.tga");
  });

  it("has no atlas, rather than a 0x0 texture, when every bitmap fails to decode", async () => {
    vi.mocked(unitsyncLuaExec).mockResolvedValue({
      result: quotedResult(),
      errors: [],
    });
    vi.mocked(legoBitmapPng).mockImplementation(async ({ file }) => ({
      dataUrl: `data:image/png;base64,${file}`,
      width: 16,
      height: 16,
    }));
    const dispose = vi.fn();
    vi.spyOn(atlasBuilder, "build").mockResolvedValue({
      texture: { dispose } as never,
      packed: { width: 0, height: 0, rects: [] },
      failed: [BITMAP_MUZZLE_FLAME],
    });

    const result = await loadEffectBitmaps(
      { enginePath: "/engine", dataDir: "/data" },
      "Game.sdd",
    );

    expect(result.atlas).toBeNull();
    expect(dispose).toHaveBeenCalled();
  });

  it("reports the read error when unitsync fails", async () => {
    vi.mocked(unitsyncLuaExec).mockResolvedValue({
      error: "no such archive",
      errors: [],
    });

    const result = await loadEffectBitmaps(
      { enginePath: "/engine", dataDir: "/data" },
      "Game.sdd",
    );

    expect(result.atlas).toBeNull();
    expect(result.note).toBe(
      "Could not read the game's bitmaps, so effects are drawn as a plain round sprite: no such archive",
    );
  });
});
