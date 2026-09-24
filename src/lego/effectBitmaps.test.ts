import { describe, expect, it, vi } from "vitest";
import {
  BITMAP_LASER,
  BITMAP_LASER_END,
  BITMAP_MUZZLE_FLAME,
  BITMAP_SMOKE,
} from "./effects";

vi.mock("@tauri-apps/api/path", () => ({
  tempDir: vi.fn().mockResolvedValue("/tmp"),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));
vi.mock("@/content/bindings", () => ({
  unitsyncLuaExec: vi.fn(),
  unitsyncArchiveExtract: vi.fn(),
}));
vi.mock("@/content/config", () => ({
  primeScan: vi.fn(),
}));
vi.mock("./bindings", () => ({
  legoBitmapPng: vi.fn(),
}));

import { unitsyncArchiveExtract, unitsyncLuaExec } from "@/content/bindings";
import { primeScan } from "@/content/config";
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
  it("reads each bitmap's key, file and presence from the quoted result", () => {
    const result =
      '"muzzleflame|explo.tga|1;laserfalloff||;smoke1|smoke\\\\smoke00.tga|"';
    expect(parseBitmaps(result)).toEqual([
      { key: "muzzleflame", file: "explo.tga", present: true },
      { key: "laserfalloff", file: null, present: false },
      { key: "smoke1", file: "smoke\\smoke00.tga", present: false },
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
    expect(slotOf("laserend")).toBe(BITMAP_LASER_END);
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
    "muzzleflame|explo.tga|1",
    "laserfalloff|laserfalloff.tga|",
    "laserend|laserend.tga|1",
  ];
  for (let i = 1; i <= 12; i++) entries.push(`smoke${i}|smoke${i}.tga|1`);
  const escaped = entries.join(";").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** One resources.lua result naming only the muzzle flame bitmap, present or
 *  not, for the tests that only care about how that one file is fetched. */
function muzzleFlameResult(present: boolean): string {
  return `"muzzleflame|explo.tga|${present ? "1" : ""}"`;
}

describe("loadEffectBitmaps", () => {
  it("reports the game's missing bitmaps in the note", async () => {
    vi.mocked(unitsyncLuaExec).mockResolvedValue({
      result: quotedResult(),
      errors: [],
    });
    vi.mocked(unitsyncArchiveExtract).mockResolvedValue({
      size: 100,
      errors: [],
    });
    vi.mocked(legoBitmapPng).mockImplementation(async ({ path }) => ({
      dataUrl: `data:image/png;base64,${path}`,
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
    vi.mocked(unitsyncArchiveExtract).mockResolvedValue({
      size: 100,
      errors: [],
    });
    vi.mocked(legoBitmapPng).mockImplementation(async ({ path }) => ({
      dataUrl: `data:image/png;base64,${path}`,
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

  it("reads a present bitmap's bytes out of the project's own archive", async () => {
    vi.mocked(unitsyncLuaExec).mockResolvedValue({
      result: muzzleFlameResult(true),
      errors: [],
    });
    vi.mocked(unitsyncArchiveExtract).mockResolvedValue({
      size: 100,
      errors: [],
    });
    vi.mocked(legoBitmapPng).mockResolvedValue({
      dataUrl: "data:image/png;base64,x",
      width: 16,
      height: 16,
    });
    vi.spyOn(atlasBuilder, "build").mockResolvedValue({
      texture: { dispose: vi.fn() } as never,
      packed: {
        width: 16,
        height: 16,
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

    expect(unitsyncArchiveExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        archive: "Game.sdd",
        file: "bitmaps/explo.tga",
      }),
    );
    expect(primeScan).not.toHaveBeenCalled();
    expect(result.atlas).not.toBeNull();
  });

  it("falls back to a dependency archive when the primary lacks the bitmap", async () => {
    vi.mocked(unitsyncLuaExec).mockResolvedValue({
      result: muzzleFlameResult(true),
      errors: [],
    });
    vi.mocked(unitsyncArchiveExtract).mockImplementation(
      async ({ archive }) => ({
        size: archive === "Base.sdz" ? 100 : 0,
        errors: archive === "Base.sdz" ? [] : ["not found"],
      }),
    );
    vi.mocked(primeScan).mockResolvedValue({
      maps: [],
      games: [
        {
          name: "Game",
          primaryArchive: { name: "Game.sdd" } as never,
          dependencyArchives: [{ name: "Base.sdz" } as never],
          info: {},
        },
      ],
      errors: [],
    });
    vi.mocked(legoBitmapPng).mockResolvedValue({
      dataUrl: "data:image/png;base64,x",
      width: 16,
      height: 16,
    });
    vi.spyOn(atlasBuilder, "build").mockResolvedValue({
      texture: { dispose: vi.fn() } as never,
      packed: {
        width: 16,
        height: 16,
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

    expect(unitsyncArchiveExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        archive: "Game.sdd",
        file: "bitmaps/explo.tga",
      }),
    );
    expect(unitsyncArchiveExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        archive: "Base.sdz",
        file: "bitmaps/explo.tga",
      }),
    );
    expect(result.atlas).not.toBeNull();
  });

  it("falls back to the engine's bitmaps.sdz when neither the game nor its dependencies have the bitmap", async () => {
    vi.mocked(unitsyncLuaExec).mockResolvedValue({
      result: muzzleFlameResult(true),
      errors: [],
    });
    vi.mocked(unitsyncArchiveExtract).mockImplementation(
      async ({ archive }) => ({
        size: archive === "bitmaps.sdz" ? 100 : 0,
        errors: archive === "bitmaps.sdz" ? [] : ["not found"],
      }),
    );
    vi.mocked(primeScan).mockResolvedValue({
      maps: [],
      games: [
        {
          name: "Game",
          primaryArchive: { name: "Game.sdd" } as never,
          dependencyArchives: [{ name: "Base.sdz" } as never],
          info: {},
        },
      ],
      errors: [],
    });
    vi.mocked(legoBitmapPng).mockResolvedValue({
      dataUrl: "data:image/png;base64,x",
      width: 16,
      height: 16,
    });
    vi.spyOn(atlasBuilder, "build").mockResolvedValue({
      texture: { dispose: vi.fn() } as never,
      packed: {
        width: 16,
        height: 16,
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

    expect(unitsyncArchiveExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        archive: "bitmaps.sdz",
        file: "bitmaps/explo.tga",
      }),
    );
    expect(result.atlas).not.toBeNull();
  });

  it("reports a bitmap missing by its bitmaps/<file> name when it is in neither archive", async () => {
    vi.mocked(unitsyncLuaExec).mockResolvedValue({
      result: muzzleFlameResult(true),
      errors: [],
    });
    vi.mocked(unitsyncArchiveExtract).mockResolvedValue({
      size: 0,
      errors: ["not found"],
    });
    vi.mocked(primeScan).mockResolvedValue({
      maps: [],
      games: [
        {
          name: "Game",
          primaryArchive: { name: "Game.sdd" } as never,
          dependencyArchives: [{ name: "Base.sdz" } as never],
          info: {},
        },
      ],
      errors: [],
    });

    const result = await loadEffectBitmaps(
      { enginePath: "/engine", dataDir: "/data" },
      "Game.sdd",
    );

    expect(result.atlas).toBeNull();
    expect(result.note).toContain("bitmaps/explo.tga");
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
