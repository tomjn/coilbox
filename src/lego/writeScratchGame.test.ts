import { describe, expect, it, vi } from "vitest";

vi.mock("@/content/bindings", () => ({
  unitsyncLuaExec: vi.fn(),
}));
vi.mock("@/content/config", () => ({
  primeScan: vi.fn(),
}));
vi.mock("./bindings", () => ({
  legoExport: vi.fn(),
  legoScratchGame: vi.fn(),
}));

import { unitsyncLuaExec } from "@/content/bindings";
import type { PlayTarget } from "@/play/config";
import { buildLuaRulesEntry, LUARULES_ENTRIES_LUA } from "./scratchGame";
import { luaRulesEntries } from "./writeScratchGame";

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
