import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const GADGET = readFileSync(
  "lua/unit-check/luarules/gadgets/coilbox_unit_check.lua",
  "utf8",
);

/**
 * Load the check gadget, play to its spawn frame and print what it logged as
 * `level: text`. `unitScript` is the `Spring.UnitScript` table of the game it
 * runs in, as Lua: `nil` for a game that never turned the framework on.
 */
function runCheck(unitScript: string) {
  const harness = `
gadget = {}
gadgetHandler = { IsSyncedCode = function() return true end }
VFS = {
  FileExists = function() return true end,
  Include = function() return { unitName = "cakebot_test", spawnFrame = 30, frames = 450 } end,
}
UnitDefNames = { cakebot_test = { id = 3, scriptName = "cakebot_test.lua" } }
Game = { mapSizeX = 100, mapSizeZ = 100 }
Spring = {
  UnitScript = ${unitScript},
  Log = function(_, level, text) print(level .. ": " .. text) end,
  GetGroundHeight = function() return 0 end,
  CreateUnit = function() return 7 end,
  GetUnitPieceList = function() return { 1, 2, 3 } end,
}
assert(loadstring(io.read("*a")))()
gadget:GameFrame(30)
`;
  const run = spawnSync("luajit", ["-e", harness], { input: GADGET });
  return {
    stderr: run.stderr?.toString() ?? "",
    lines: (run.stdout?.toString() ?? "").trim().split("\n"),
  };
}

describe("the unit check gadget", () => {
  it("reports a Lua script that loaded", () => {
    const run = runCheck("{ GetScriptEnv = function() return {} end }");
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["notice: spawned cakebot_test with 3 pieces"]);
  });

  it("reports a Lua script that did not load", () => {
    const run = runCheck("{ GetScriptEnv = function() return nil end }");
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "error: the unit script did not load: cakebot_test.lua",
      "notice: spawned cakebot_test with 3 pieces",
    ]);
  });

  // Issue #4139. Metal Factions never turns the framework on, so
  // Spring.UnitScript has no GetScriptEnv, and calling it threw before the
  // spawn was reported.
  it("still reports the spawn in a game that does not run Lua unit scripts", () => {
    const run = runCheck("{}");
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "error: the game does not run Lua unit scripts: cakebot_test.lua",
      "notice: spawned cakebot_test with 3 pieces",
    ]);
  });
});
