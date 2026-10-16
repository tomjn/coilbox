import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  buildModInfo,
  buildSideData,
  buildStartUnitGadget,
  SCRATCH_SIDE,
  SPAWN_FRAME,
} from "./scratchGame";

/**
 * Load the start unit gadget on `loadFrame`, play `frames`, and print each unit
 * it created. Team 0 has none of the unit, so it gets one whenever the gadget
 * decides to spawn.
 */
function runStartUnitGadget(loadFrame: number, frames: number[]) {
  const harness = `
gadget = {}
gadgetHandler = { IsSyncedCode = function() return true end }
UnitDefNames = { cakebot_test = { id = 3 } }
Spring = {
  GetGameFrame = function() return ${loadFrame} end,
  GetGaiaTeamID = function() return 9 end,
  GetTeamList = function() return { 0 } end,
  GetTeamUnitDefCount = function() return 0 end,
  GetTeamStartPosition = function() return 1, 2, 3 end,
  CreateUnit = function(d, x, y, z, f, t) print("create " .. d .. " " .. t) end,
  Echo = print,
}
assert(loadstring(io.read("*a")))()
for _, f in ipairs({ ${frames.join(", ")} }) do gadget:GameFrame(f) end
`;
  const run = spawnSync("luajit", ["-e", harness], {
    input: buildStartUnitGadget("cakebot_test"),
  });
  return {
    stderr: run.stderr?.toString() ?? "",
    lines: (run.stdout?.toString() ?? "").trim().split("\n"),
  };
}

describe("buildModInfo", () => {
  it("declares itself a launchable game", () => {
    expect(buildModInfo("Balanced Annihilation V7.11")).toContain(
      "modtype = 1",
    );
  });

  it("depends on the base game by the exact name unitsync reports", () => {
    const lua = buildModInfo("Balanced Annihilation V7.11");

    expect(lua).toContain('"Balanced Annihilation V7.11",');
    expect(lua).toContain("depend = {");
  });

  it("escapes a quote in the base game name so the file still parses", () => {
    expect(buildModInfo('Some "Game"')).toContain('"Some \\"Game\\"",');
  });

  it("gives the same output for the same base game, every time", () => {
    expect(buildModInfo("BAR")).toBe(buildModInfo("BAR"));
  });

  it("ends with exactly one newline", () => {
    const lua = buildModInfo("BAR");

    expect(lua.endsWith("\n")).toBe(true);
    expect(lua.endsWith("\n\n")).toBe(false);
  });
});

describe("buildSideData", () => {
  it("declares one side whose start unit is the built unit", () => {
    const lua = buildSideData("cakebot_test");

    expect(lua).toContain(`name = "${SCRATCH_SIDE}"`);
    expect(lua).toContain('startunit = "cakebot_test"');
    // One side, so the built unit is what the engine's default side starts with.
    expect(lua.match(/startunit =/g)).toHaveLength(1);
  });

  it("spells the key the way a game's own side data does", () => {
    // Balanced Annihilation's gamedata/sidedata.lua uses `startunit`, all lower
    // case. Anything else and no engine reading that file finds a start unit.
    expect(buildSideData("cakebot_test")).not.toContain("startUnit");
  });

  it("escapes a quote in the unit name so the file still parses", () => {
    expect(buildSideData('bad"name')).toContain('"bad\\"name"');
  });

  it("ends with exactly one newline", () => {
    const lua = buildSideData("cakebot_test");

    expect(lua.endsWith("\n")).toBe(true);
    expect(lua.endsWith("\n\n")).toBe(false);
  });
});

describe("buildStartUnitGadget", () => {
  it("is a synced gadget the base game's handler will load", () => {
    const lua = buildStartUnitGadget("cakebot_test");

    expect(lua).toContain("function gadget:GetInfo()");
    expect(lua).toContain("enabled = true");
    // Unsynced returns false: spawning is a synced job, and a gadget that ran
    // twice would create the unit on one side of the sim only.
    expect(lua).toContain("if not gadgetHandler:IsSyncedCode() then");
    expect(lua).toContain("return false");
  });

  it("spawns the built unit at each team's start position", () => {
    const lua = buildStartUnitGadget("cakebot_test");

    expect(lua).toContain('local UNIT_NAME = "cakebot_test"');
    expect(lua).toContain("Spring.GetTeamStartPosition(teamID)");
    expect(lua).toContain("Spring.CreateUnit(def.id, x, y, z, 0, teamID)");
  });

  it("leaves the team alone if it already has one", () => {
    // A game that did read the side's start unit has already spawned it, and a
    // second copy would be this gadget's doing.
    expect(buildStartUnitGadget("cakebot_test")).toContain(
      "Spring.GetTeamUnitDefCount(teamID, def.id) == 0",
    );
  });

  it("spawns once, on its frame", () => {
    const run = runStartUnitGadget(0, [1, SPAWN_FRAME, SPAWN_FRAME + 1]);
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["create 3 0"]);
  });

  // Issue #3346. `/luarules reload` loads it again into a running game, which
  // is long past its frame, and a team that has lost the unit since would be
  // handed a new one.
  it("spawns nothing when a reload loads it after its frame", () => {
    const run = runStartUnitGadget(SPAWN_FRAME + 600, [SPAWN_FRAME + 601]);
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([""]);
  });

  it("skips gaia, which is the map's own team and starts with nothing", () => {
    expect(buildStartUnitGadget("cakebot_test")).toContain(
      "Spring.GetGaiaTeamID()",
    );
  });

  it("runs once, a second in", () => {
    const lua = buildStartUnitGadget("cakebot_test");

    // 30 frames is one second: late enough that a game which spawns its own
    // start unit has already done so.
    expect(lua).toContain("local SPAWN_FRAME = 30");
    expect(lua).toContain("if spawned or frame < SPAWN_FRAME then");
  });

  it("escapes a quote in the unit name so the file still parses", () => {
    expect(buildStartUnitGadget('bad"name')).toContain(
      'local UNIT_NAME = "bad\\"name"',
    );
  });

  it("ends with exactly one newline", () => {
    const lua = buildStartUnitGadget("cakebot_test");

    expect(lua.endsWith("\n")).toBe(true);
    expect(lua.endsWith("\n\n")).toBe(false);
  });
});
