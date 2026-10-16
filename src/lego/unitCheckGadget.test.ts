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
function runCheck(
  unitScript: string,
  options: { def?: string; positions?: string; lastFrame?: boolean } = {},
) {
  const harness = `
gadget = {}
gadgetHandler = { IsSyncedCode = function() return true end }
VFS = {
  FileExists = function() return true end,
  Include = function() return { unitName = "cakebot_test", spawnFrame = 30, frames = 450 } end,
}
UnitDefNames = { cakebot_test = ${options.def ?? '{ id = 3, scriptName = "cakebot_test.lua" }'} }
CMD = { MOVE = 10 }
local positions = ${options.positions ?? "{ { 50, 0, 50 } }"}
local asked = 0
Game = { mapSizeX = 100, mapSizeZ = 100 }
Spring = {
  UnitScript = ${unitScript},
  Log = function(_, level, text) print(level .. ": " .. text) end,
  GetGroundHeight = function() return 0 end,
  CreateUnit = function() return 7 end,
  GetUnitPieceList = function() return { 1, 2, 3 } end,
  GetUnitIsDead = function() return false end,
  GiveOrderToUnit = function(_, cmd) print("order: " .. cmd) end,
  GetUnitPosition = function()
    asked = math.min(asked + 1, #positions)
    return unpack(positions[asked])
  end,
}
SendToUnsynced = function() end
assert(loadstring(io.read("*a")))()
gadget:GameFrame(30)
${options.lastFrame ? "gadget:GameFrame(480)" : ""}
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

  // Issue #3255. A unit the engine gave a move class is sent off and says how
  // far it got, which is the engine's own word that it can move.
  const MOVER =
    '{ id = 3, scriptName = "cakebot_test.cob", canMove = true, moveDef = { name = "wheeledtank2" } }';

  it("orders a unit with a move class to move and reports how far it went", () => {
    const run = runCheck("{}", {
      def: MOVER,
      positions: "{ { 50, 0, 50 }, { 20, 0, 10 } }",
      lastFrame: true,
    });
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "notice: spawned cakebot_test with 3 pieces",
      "order: 10",
      "notice: moved 50 elmos on wheeledtank2",
      "notice: done at frame 480",
    ]);
  });

  it("reports a unit that was ordered to move and stayed put", () => {
    const run = runCheck("{}", { def: MOVER, lastFrame: true });
    expect(run.stderr).toBe("");
    expect(run.lines).toContain(
      "error: cakebot_test was ordered to move and did not",
    );
  });

  it("gives a static unit no order", () => {
    const run = runCheck("{}", {
      def: '{ id = 3, scriptName = "cakebot_test.cob" }',
      lastFrame: true,
    });
    expect(run.lines).toEqual([
      "notice: spawned cakebot_test with 3 pieces",
      "notice: done at frame 480",
    ]);
  });
});
