import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = new Map<string, string>();

vi.mock("@/content/bindings", () => ({
  unitsyncLuaExec: vi.fn(),
}));
vi.mock("@/content/config", () => ({
  primeScan: vi.fn(),
}));
vi.mock("@/workshop/compile", () => ({
  workshopCompile: vi.fn(),
}));
vi.mock("./bindings", () => ({
  legoExport: vi.fn(),
  legoScratchGame: vi.fn(),
  legoScratchPrune: vi.fn(),
  legoReadTextFile: vi.fn(),
  legoWriteTextFile: vi.fn(),
}));

import { unitsyncLuaExec } from "@/content/bindings";
import { primeScan } from "@/content/config";
import type { PlayTarget } from "@/play/config";
import {
  legoExport,
  legoReadTextFile,
  legoScratchGame,
  legoScratchPrune,
  legoWriteTextFile,
} from "./bindings";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import {
  clearStamp,
  luaRulesEntries,
  type MutatorArgs,
  type MutatorUnit,
  writeMutator,
} from "./mutator";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { buildLuaRulesEntry, LUARULES_ENTRIES_LUA } from "./scratchGame";

const target = {
  enginePath: "/engine",
  dataDir: "/data",
  executable: "/engine/spring",
} as PlayTarget;

function answers(result: string) {
  vi.mocked(unitsyncLuaExec).mockResolvedValue({ result, errors: [] });
}

// Issue #4475. The engine drops LuaRules whole when either entry file is
// missing, so a game lacking one never runs the spawn gadget.
describe("luaRulesEntries", () => {
  it("asks unitsync about the base game's own archive", async () => {
    answers('"LuaRules/main.lua;LuaRules/draw.lua"');
    await luaRulesEntries(target, "Metal Factions v2.58", "metal_factions.sdz");
    expect(unitsyncLuaExec).toHaveBeenCalledWith({
      enginePath: "/engine",
      dataDir: "/data",
      archive: "metal_factions.sdz",
      source: LUARULES_ENTRIES_LUA,
    });
  });

  it("supplies nothing for a game that has both files", async () => {
    answers('"LuaRules/main.lua;LuaRules/draw.lua"');
    expect(
      await luaRulesEntries(target, "Metal Factions v2.58", "mf.sdz"),
    ).toEqual({});
  });

  it("supplies draw.lua for Empty Mod, which has only main.lua", async () => {
    answers('"LuaRules/main.lua"');
    expect(await luaRulesEntries(target, "Empty Mod", "empty_mod.sdz")).toEqual(
      { luaRulesDraw: buildLuaRulesEntry() },
    );
  });

  it("supplies both for a game with no LuaRules at all", async () => {
    answers('""');
    expect(await luaRulesEntries(target, "Bare", "bare.sdz")).toEqual({
      luaRulesMain: buildLuaRulesEntry(),
      luaRulesDraw: buildLuaRulesEntry(),
    });
  });

  it("refuses rather than guess when unitsync cannot say", async () => {
    vi.mocked(unitsyncLuaExec).mockResolvedValue({
      error: "archive not found",
      errors: [],
    });
    await expect(
      luaRulesEntries(target, "Empty Mod", "empty_mod.sdz"),
    ).rejects.toThrow("Could not read Empty Mod's LuaRules: archive not found");
  });
});

function pack(): LoadedPack {
  const part: LegoPartInfo = {
    id: "tri",
    packId: "lego",
    shapeId: "tri",
    name: "tri",
    category: "grey",
    colourway: "grey",
    shape: "tri",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 3,
    iFirst: 0,
    iCount: 3,
    bbox: { min: [0, 0, 0], max: [1, 0, 1] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
  return {
    manifest: {} as LoadedPack["manifest"],
    library: {
      packs: [],
      atlases: [
        { tex1: "atlas.png", packId: "base", folder: null },
        { tex1: "other.png", packId: "base", folder: null },
      ],
      dir: "",
      problems: [],
    },
    parts: [part],
    byId: new Map([["tri", part]]),
    vertices: new Float32Array([
      0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  };
}

function unit(unitName: string, extra: Partial<LegoPiece> = {}): MutatorUnit {
  const base = newProject({
    id: unitName,
    rootPieceId: "root",
    name: unitName,
    packId: "lego",
    packVersion: "1",
    now: "2026-07-28T00:00:00Z",
  });
  const project: LegoProject = {
    ...base,
    unitName,
    pieces: [
      ...base.pieces,
      {
        id: "hull",
        name: "hull",
        parentId: "root",
        partId: "tri",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        ...extra,
      },
    ],
  };
  return { project, pack: pack(), raw: null };
}

function args(overrides: Partial<MutatorArgs> = {}): MutatorArgs {
  return {
    target,
    folder: "coilbox-lego-campaign.sdd",
    baseGame: "Splinter Faction v0.1.86",
    baseArchive: "SplinterFaction_0.1.86.sdz",
    workshopProjects: [],
    gameWeapons: null,
    gameMovement: null,
    units: [unit("alpha")],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  fs.clear();
  answers('"LuaRules/main.lua;LuaRules/draw.lua"');
  vi.mocked(legoReadTextFile).mockImplementation(async ({ path }) => {
    const text = fs.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return { text };
  });
  vi.mocked(legoWriteTextFile).mockImplementation(async ({ path, text }) => {
    fs.set(path, text);
    return { path };
  });
  vi.mocked(legoScratchGame).mockImplementation(async (written) => {
    const dir = `${written.dataDir}/games/${written.folder}`;
    fs.set(`${dir}/modinfo.lua`, written.modinfo);
    return { dir };
  });
  vi.mocked(legoScratchPrune).mockResolvedValue({ removed: [], kept: [] });
  vi.mocked(legoExport).mockImplementation(
    async ({ dir, unitName }) =>
      ({
        owned: [
          { path: `${dir}/units/${unitName}.lua`, sha256: `sha-${unitName}` },
        ],
      }) as never,
  );
  vi.mocked(primeScan).mockImplementation(
    async () =>
      ({
        games: [
          {
            name: "coilbox-lego-campaign",
            primaryArchive: { name: "coilbox-lego-campaign.sdd" },
          },
          {
            name: "coilbox-lego-test",
            primaryArchive: { name: "coilbox-lego-test.sdd" },
          },
        ],
      }) as never,
  );
});

// Issue #4514. A rescan is a full unitsync scan, so a launch that finds the
// folder already holding this set must not write or scan.
describe("writeMutator", () => {
  it("writes the folder, exports each unit into it and answers the scanned name", async () => {
    const result = await writeMutator(
      args({ units: [unit("alpha"), unit("beta")] }),
    );

    expect(result.name).toBe("coilbox-lego-campaign");
    expect(result.dir).toBe("/data/games/coilbox-lego-campaign.sdd");
    expect(result.skipped).toBe(false);
    expect(result.units.map((u) => u.files[0]?.sha256)).toEqual([
      "sha-alpha",
      "sha-beta",
    ]);
    expect(legoScratchGame).toHaveBeenCalledTimes(1);
    expect(legoScratchGame).toHaveBeenCalledWith(
      expect.objectContaining({ folder: "coilbox-lego-campaign.sdd" }),
    );
    expect(
      vi.mocked(legoExport).mock.calls.map(([call]) => call.unitName),
    ).toEqual(["alpha", "beta"]);
    expect(primeScan).toHaveBeenCalledWith("/engine", "/data", true);
  });

  it("finds its own folder by archive, not the first generated game", async () => {
    const result = await writeMutator(
      args({ folder: "coilbox-lego-test.sdd" }),
    );
    expect(result.name).toBe("coilbox-lego-test");
  });

  it("writes no start unit unless the caller supplies one", async () => {
    await writeMutator(args());
    const plain = vi.mocked(legoScratchGame).mock.calls[0]?.[0];
    expect(plain).not.toHaveProperty("sidedata");
    expect(plain).not.toHaveProperty("gadget");

    await writeMutator(
      args({
        folder: "coilbox-lego-test.sdd",
        extras: { startUnit: { sidedata: "side", gadget: "gadget" } },
      }),
    );
    expect(vi.mocked(legoScratchGame).mock.calls[1]?.[0]).toMatchObject({
      sidedata: "side",
      gadget: "gadget",
    });
  });

  describe("an unchanged set", () => {
    it("neither rewrites nor rescans, and answers what the last launch did", async () => {
      const first = await writeMutator(args());
      const onWritten = vi.fn();
      const onScanning = vi.fn();

      const second = await writeMutator(args({ onWritten, onScanning }));

      expect(second).toEqual({ ...first, skipped: true });
      expect(legoScratchGame).toHaveBeenCalledTimes(1);
      expect(legoExport).toHaveBeenCalledTimes(1);
      expect(primeScan).toHaveBeenCalledTimes(1);
      expect(onWritten).toHaveBeenCalledWith(first.dir);
      expect(onScanning).not.toHaveBeenCalled();
    });

    it("still skips when the units are given in a fresh object each time", async () => {
      await writeMutator(args({ units: [unit("alpha"), unit("beta")] }));
      const again = await writeMutator(
        args({ units: [unit("alpha"), unit("beta")] }),
      );
      expect(again.skipped).toBe(true);
    });
  });

  describe("a changed set", () => {
    it("rewrites and rescans when a unit is edited", async () => {
      await writeMutator(args());
      const edited = await writeMutator(
        args({ units: [unit("alpha", { position: [0, 2, 0] })] }),
      );
      expect(edited.skipped).toBe(false);
      expect(legoScratchGame).toHaveBeenCalledTimes(2);
      expect(primeScan).toHaveBeenCalledTimes(2);
    });

    it("rewrites when a unit is added, and when one is removed", async () => {
      await writeMutator(args());
      const added = await writeMutator(
        args({ units: [unit("alpha"), unit("beta")] }),
      );
      const removed = await writeMutator(args());
      expect([added.skipped, removed.skipped]).toEqual([false, false]);
      expect(primeScan).toHaveBeenCalledTimes(3);
    });

    it("rewrites when the base game changes", async () => {
      await writeMutator(args());
      const updated = await writeMutator(
        args({ baseGame: "Splinter Faction v0.1.87" }),
      );
      expect(updated.skipped).toBe(false);
    });

    it("rewrites when the base game's missing LuaRules entries change", async () => {
      await writeMutator(args());
      answers('"LuaRules/main.lua"');
      const updated = await writeMutator(args());
      expect(updated.skipped).toBe(false);
    });

    it("rewrites when the folder has been deleted since", async () => {
      const first = await writeMutator(args());
      fs.delete(`${first.dir}/modinfo.lua`);
      const again = await writeMutator(args());
      expect(again.skipped).toBe(false);
      expect(primeScan).toHaveBeenCalledTimes(2);
    });

    it("rewrites when the stamp cannot be read", async () => {
      await writeMutator(args());
      fs.set("/data/games/coilbox-lego-campaign.sdd.stamp", "{not json");
      expect((await writeMutator(args())).skipped).toBe(false);
    });

    it("rewrites after something else wrote to the folder and cleared the stamp", async () => {
      await writeMutator(args());
      await clearStamp("/data", "coilbox-lego-campaign.sdd");
      expect((await writeMutator(args())).skipped).toBe(false);
    });

    it("always rewrites for a sandbox that ships the runtime", async () => {
      const sandbox = {
        download: "d",
        gadget: "g",
        missionId: "m",
        mission: "x",
        shipRuntime: true,
      };
      await writeMutator(args({ extras: { sandbox } }));
      const again = await writeMutator(args({ extras: { sandbox } }));
      expect(again.skipped).toBe(false);
    });

    it("keeps one folder's stamp apart from another's", async () => {
      await writeMutator(args());
      const other = await writeMutator(
        args({ folder: "coilbox-lego-test.sdd" }),
      );
      expect(other.skipped).toBe(false);
      expect((await writeMutator(args())).skipped).toBe(true);
    });
  });

  describe("a launch that fails part way", () => {
    it("leaves no stamp when the export throws, so the next launch writes again", async () => {
      await writeMutator(args());
      vi.mocked(legoExport).mockRejectedValueOnce(new Error("disk full"));
      await expect(
        writeMutator(args({ units: [unit("alpha", { position: [0, 2, 0] })] })),
      ).rejects.toThrow("disk full");

      // The first set is back, and the folder holds half of the second.
      const retry = await writeMutator(args());
      expect(retry.skipped).toBe(false);
    });

    it("leaves no stamp when unitsync does not find the folder", async () => {
      vi.mocked(primeScan).mockResolvedValueOnce({ games: [] } as never);
      await expect(writeMutator(args())).rejects.toThrow(
        "The engine did not pick up coilbox-lego-campaign.sdd. Check that Splinter Faction v0.1.86 is still installed.",
      );
      expect((await writeMutator(args())).skipped).toBe(false);
    });
  });
});

function onAtlas(built: MutatorUnit, atlas: string): MutatorUnit {
  return { ...built, project: { ...built.project, atlas } };
}

// Issue #4521. A unit taken out of the set must leave nothing in the folder.
describe("writeMutator pruning", () => {
  const folder = "coilbox-lego-campaign.sdd";

  it("removes the files of a unit that left the set, by the digests it was written with", async () => {
    await writeMutator(args({ units: [unit("alpha"), unit("beta")] }));
    await writeMutator(args({ units: [unit("alpha")] }));

    expect(legoScratchPrune).toHaveBeenCalledTimes(1);
    expect(legoScratchPrune).toHaveBeenCalledWith({
      dataDir: "/data",
      folder,
      units: [{ unitName: "beta", digests: ["sha-beta"] }],
      textures: [],
    });
  });

  it("prunes after the folder exists and before the new units are written", async () => {
    await writeMutator(args({ units: [unit("alpha"), unit("beta")] }));
    vi.mocked(legoScratchGame).mockClear();
    vi.mocked(legoExport).mockClear();
    await writeMutator(args({ units: [unit("alpha")] }));

    const scratch = vi.mocked(legoScratchGame).mock.invocationCallOrder[0];
    const prune = vi.mocked(legoScratchPrune).mock.invocationCallOrder[0];
    const exported = vi.mocked(legoExport).mock.invocationCallOrder[0];
    expect(scratch).toBeLessThan(prune as number);
    expect(prune).toBeLessThan(exported as number);
  });

  it("does not prune on the first write, or for a set that only gained units", async () => {
    await writeMutator(args({ units: [unit("alpha")] }));
    await writeMutator(args({ units: [unit("alpha"), unit("beta")] }));
    expect(legoScratchPrune).not.toHaveBeenCalled();
  });

  it("does not prune when the set is unchanged and the launch is skipped", async () => {
    await writeMutator(args({ units: [unit("alpha"), unit("beta")] }));
    await writeMutator(args({ units: [unit("alpha"), unit("beta")] }));
    expect(legoScratchPrune).not.toHaveBeenCalled();
  });

  it("removes every unit when the set becomes empty", async () => {
    await writeMutator(args({ units: [unit("alpha"), unit("beta")] }));
    await writeMutator(args({ units: [] }));
    expect(legoScratchPrune).toHaveBeenCalledWith(
      expect.objectContaining({
        units: [
          { unitName: "alpha", digests: ["sha-alpha"] },
          { unitName: "beta", digests: ["sha-beta"] },
        ],
      }),
    );
  });

  it("removes a texture that no remaining unit uses", async () => {
    const first = await writeMutator(
      args({
        units: [unit("alpha"), onAtlas(unit("beta"), "other.png")],
      }),
    );
    const [alphaTexture] = first.units[0]?.textureFiles ?? [];
    const [betaTexture] = first.units[1]?.textureFiles ?? [];
    expect(alphaTexture).toBeDefined();
    expect(betaTexture).toBeDefined();
    expect(betaTexture).not.toBe(alphaTexture);

    await writeMutator(args({ units: [unit("alpha")] }));

    expect(legoScratchPrune).toHaveBeenCalledWith(
      expect.objectContaining({ textures: [betaTexture] }),
    );
  });

  it("keeps a texture a remaining unit still uses", async () => {
    await writeMutator(args({ units: [unit("alpha"), unit("beta")] }));
    await writeMutator(args({ units: [unit("alpha")] }));
    expect(legoScratchPrune).toHaveBeenCalledWith(
      expect.objectContaining({ textures: [] }),
    );
  });

  it("removes the old texture of a unit that stays but changes its atlas", async () => {
    const first = await writeMutator(args({ units: [unit("alpha")] }));
    const [old] = first.units[0]?.textureFiles ?? [];
    await writeMutator(args({ units: [onAtlas(unit("alpha"), "other.png")] }));
    expect(legoScratchPrune).toHaveBeenCalledWith({
      dataDir: "/data",
      folder,
      units: [],
      textures: [old],
    });
  });

  it("still prunes a unit written by a launch that failed part way", async () => {
    await writeMutator(args({ units: [unit("alpha")] }));
    vi.mocked(legoExport).mockImplementation(async ({ dir, unitName }) => {
      if (unitName === "gamma") throw new Error("disk full");
      return {
        owned: [
          { path: `${dir}/units/${unitName}.lua`, sha256: `sha-${unitName}` },
        ],
      } as never;
    });
    await expect(
      writeMutator(
        args({ units: [unit("alpha"), unit("beta"), unit("gamma")] }),
      ),
    ).rejects.toThrow("disk full");

    await writeMutator(args({ units: [unit("alpha")] }));

    expect(legoScratchPrune).toHaveBeenCalledWith(
      expect.objectContaining({
        units: [{ unitName: "beta", digests: ["sha-beta"] }],
      }),
    );
  });

  it("prunes what an earlier launch recorded even after another writer cleared the stamp", async () => {
    await writeMutator(args({ units: [unit("alpha"), unit("beta")] }));
    await clearStamp("/data", folder);
    await writeMutator(args({ units: [unit("alpha")] }));
    expect(legoScratchPrune).toHaveBeenCalledWith(
      expect.objectContaining({
        units: [{ unitName: "beta", digests: ["sha-beta"] }],
      }),
    );
  });

  it("prunes nothing from a stamp it cannot read", async () => {
    await writeMutator(args({ units: [unit("alpha"), unit("beta")] }));
    fs.set(`/data/games/${folder}.stamp`, "{not json");
    await writeMutator(args({ units: [unit("alpha")] }));
    expect(legoScratchPrune).not.toHaveBeenCalled();
  });

  it("does not leave a stamp behind when the prune fails", async () => {
    await writeMutator(args({ units: [unit("alpha"), unit("beta")] }));
    vi.mocked(legoScratchPrune).mockRejectedValueOnce(new Error("locked"));
    await expect(
      writeMutator(args({ units: [unit("alpha")] })),
    ).rejects.toThrow("locked");
    expect((await writeMutator(args({ units: [unit("alpha")] }))).skipped).toBe(
      false,
    );
  });
});
