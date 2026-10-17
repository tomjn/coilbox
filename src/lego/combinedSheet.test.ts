import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCombinedSheet } from "./combinedSheet";
import { type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import type { RawGeometry } from "./rawGeometry";
import { sheetSources } from "./textureSheet";

const legoTextureSizes = vi.fn();
const legoTextureSheet = vi.fn();
vi.mock("./bindings", () => ({
  legoTextureSizes: (args: unknown) => legoTextureSizes(args),
  legoTextureSheet: (args: unknown) => legoTextureSheet(args),
}));

function pack(): LoadedPack {
  const part = {
    id: "tri",
    vFirst: 0,
    vCount: 3,
    iFirst: 0,
    iCount: 3,
    bbox: { min: [0, 0, 0], max: [1, 0, 1] },
    pivot: [0, 0, 0],
  } as unknown as LegoPartInfo;
  return {
    manifest: {} as LoadedPack["manifest"],
    library: {
      packs: [],
      atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
      dir: "",
      problems: [],
    },
    parts: [part],
    byId: new Map([["tri", part]]),
    // x, y, z, nx, ny, nz, u, v
    vertices: new Float32Array([
      0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  };
}

const raw: RawGeometry = {
  byId: new Map([
    [
      "mod/m0",
      {
        id: "mod/m0",
        vFirst: 0,
        vCount: 3,
        iFirst: 0,
        iCount: 3,
        bbox: { min: [0, 0, 0], max: [0, 2, 2] },
      },
    ],
  ]),
  vertices: new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0.5, 0, 0, 0, 2, 1, 0, 0, 0.5,
    0.5,
  ]),
  indices: new Uint32Array([0, 1, 2]),
};

function mixed(): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "probe",
    unitName: "probe",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-28T00:00:00Z",
  });
  const at = {
    parentId: "root",
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
  };
  return {
    ...base,
    pieces: [
      ...base.pieces,
      { ...at, id: "hull", name: "hull", partId: "tri" },
      {
        ...at,
        id: "turret",
        name: "turret",
        partId: null,
        meshId: "mod/m0",
        lifted: {
          game: { name: "Splinter Faction", archive: "sf.sdz" },
          member: "objects3d/armcom.s3o",
          texture: { key: "arm.dds", name: "arm_color.dds" },
          texture2: { key: "arm2.dds", name: "arm_other.dds" },
        },
      },
    ],
  };
}

beforeEach(() => {
  legoTextureSizes.mockReset();
  legoTextureSheet.mockReset();
  legoTextureSizes.mockResolvedValue([
    { width: 64, height: 64 },
    { width: 128, height: 128 },
  ]);
  legoTextureSheet.mockResolvedValue({
    texture: { key: "s1.png", name: "coilbox_probe_sheet.png", source: null },
    texture2: { key: "s2.png", name: "coilbox_probe_sheet2.png", source: null },
  });
});

describe("buildCombinedSheet", () => {
  it("asks Rust for both sheets laid out the same way", async () => {
    const found = sheetSources(mixed(), pack(), raw);
    if (!found || "refused" in found) throw new Error("no sources");
    const sheet = await buildCombinedSheet(mixed(), pack(), raw, found.sources);

    const painted = legoTextureSheet.mock.calls[0][0];
    expect(painted.regions.map((r: { colour: unknown }) => r.colour)).toEqual([
      {
        atlas: { name: "atlas.png", pack: null, writeAs: "coilbox_atlas.png" },
        flipY: false,
      },
      { key: "arm.dds", flipY: true },
    ]);
    // The parts have no second texture, so the engine's stand in fills theirs.
    expect(painted.regions[0].shading).toBeNull();
    expect(painted.regions[1].shading).toEqual({
      key: "arm2.dds",
      flipY: true,
    });
    // The whole atlas plus the gutter, and the lifted half plus the gutter.
    expect(painted.regions[0].crop).toEqual([
      -8 / 64,
      -8 / 64,
      72 / 64,
      72 / 64,
    ]);
    expect(painted.regions[1].crop).toEqual([
      -8 / 128,
      -8 / 128,
      72 / 128,
      72 / 128,
    ]);

    expect(sheet.texture1).toBe("coilbox_probe_sheet.png");
    expect(sheet.place).toEqual([
      { key: "s1.png", writeAs: "coilbox_probe_sheet.png", rewrite: true },
      { key: "s2.png", writeAs: "coilbox_probe_sheet2.png", rewrite: true },
    ]);
    expect(sheet.blender.mask).toEqual({
      key: "s2.png",
      writeAs: "coilbox_probe_sheet2.png",
      role: "mask",
    });
    // The turret's (0.5, 0.5) is texel 64 of the 128 square texture, which
    // sits 72 sheet pixels into its region.
    const [x, y] = painted.regions[1].dest;
    expect(sheet.uv("turret", [0.5, 0.5])).toEqual([
      (x + 72) / painted.width,
      (y + 72) / painted.height,
    ]);
  });

  it("stops when Rust cannot measure every texture", async () => {
    legoTextureSizes.mockResolvedValue([{ width: 64, height: 64 }]);
    const found = sheetSources(mixed(), pack(), raw);
    if (!found || "refused" in found) throw new Error("no sources");
    await expect(
      buildCombinedSheet(mixed(), pack(), raw, found.sources),
    ).rejects.toThrow(/measure/);
    expect(legoTextureSheet).not.toHaveBeenCalled();
  });
});
