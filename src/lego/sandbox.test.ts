import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { effectiveTeams } from "@/play/participants";
import { compileScenario } from "@/scenario/compile";
import {
  buildDownloadMenu,
  buildSandboxGadget,
  buildSandboxScenario,
  SANDBOX_LOADED_REPLY,
  SANDBOX_MISSION_ID,
  SANDBOX_PLAYER,
  SANDBOX_RELOAD_MESSAGE,
  SANDBOX_REPLY,
  SANDBOX_TARGETS,
  SANDBOX_TEXTURES_MESSAGE,
  SANDBOX_TEXTURES_REPLY,
  sandboxModOptions,
  sandboxParticipants,
  TARGET_COUNT,
  TARGET_DISTANCE,
  targetSpot,
} from "./sandbox";
import { SCRATCH_SIDE } from "./scratchGame";

describe("targetSpot", () => {
  it("puts the targets a fixed distance from the first spot, towards the second", () => {
    const spot = targetSpot([
      { x: 1000, z: 1000 },
      { x: 1000, z: 5000 },
    ]);
    expect(spot).toEqual({
      player: { x: 1000, z: 1000 },
      targets: { x: 1000, z: 1000 + TARGET_DISTANCE },
    });
  });

  it("points at the middle of the map when there is only one spot", () => {
    const spot = targetSpot([{ x: 0, z: 0 }], { width: 4000, height: 4000 });
    const along = TARGET_DISTANCE / Math.SQRT2;
    expect(spot?.targets.x).toBeCloseTo(along, 0);
    expect(spot?.targets.z).toBeCloseTo(along, 0);
  });

  it("has nowhere to put them on a map with no start positions", () => {
    expect(targetSpot([])).toBeNull();
  });
});

describe("buildSandboxScenario", () => {
  const scenario = buildSandboxScenario({
    unitName: "probe_unit",
    builder: "fedcommander",
    gameName: "SplinterFaction 0.1.89",
    mapName: "AcidicQuarry 5.17",
    targets: { x: 1320, z: 1000 },
  });

  it("starts the player with the unit, the builder and a bank, and no commander", () => {
    const player = scenario.teams[SANDBOX_PLAYER];
    expect(player?.startUnits).toEqual(["probe_unit", "fedcommander"]);
    expect(player?.noCommander).toBe(true);
    expect(player?.resources?.metal).toBeGreaterThan(0);
    expect(player?.resources?.energy).toBeGreaterThan(0);
  });

  it("stands a group of the unit for the targets, at the spot, with no orders", () => {
    expect(scenario.teams[SANDBOX_TARGETS]?.noCommander).toBe(true);
    expect(scenario.groups).toEqual([
      {
        id: SANDBOX_TARGETS,
        team: SANDBOX_TARGETS,
        units: [{ def: "probe_unit", count: TARGET_COUNT }],
        pos: { x: 1320, z: 1000 },
        orders: [],
        dormant: false,
      },
    ]);
  });

  it("puts the player on team 0 and the targets on an empty team 1", () => {
    const { teamIndexById } = effectiveTeams(scenario.setup.participants);
    expect(teamIndexById.get(SANDBOX_PLAYER)).toBe(0);
    expect(teamIndexById.get(SANDBOX_TARGETS)).toBe(1);
    const targets = scenario.setup.participants.find(
      (p) => p.id === SANDBOX_TARGETS,
    );
    expect(targets?.kind).toBe("ai");
    expect(targets?.ai).toBeUndefined();
    expect(scenario.setup.startPosType).toBe(0);
  });

  it("compiles to a mission naming both teams and the group", () => {
    const mission = compileScenario(scenario);
    expect(mission).toContain('"fedcommander"');
    expect(mission).toContain(`"${SANDBOX_TARGETS}"`);
    expect(scenario.id).toBe(SANDBOX_MISSION_ID);
  });

  it("starts the player with the unit alone when the game has no builder", () => {
    const alone = buildSandboxScenario({
      unitName: "probe_unit",
      builder: null,
      gameName: "g",
      mapName: "m",
      targets: { x: 0, z: 0 },
    });
    expect(alone.teams[SANDBOX_PLAYER]?.startUnits).toEqual(["probe_unit"]);
  });
});

describe("sandboxParticipants", () => {
  it("puts both teams on the scratch game's side", () => {
    expect(sandboxParticipants().map((p) => p.side)).toEqual([
      SCRATCH_SIDE,
      SCRATCH_SIDE,
    ]);
  });

  it("names the sandbox mission in the mod options", () => {
    expect(sandboxModOptions()).toEqual({
      coilbox_mission: SANDBOX_MISSION_ID,
    });
  });
});

describe("buildDownloadMenu", () => {
  it("adds the unit to the builder's menu in the form the engine reads", () => {
    const tdf = buildDownloadMenu("fedcommander", "probe_unit");
    expect(tdf).toContain("[MENUENTRY1]");
    expect(tdf).toContain("\tunitmenu=fedcommander;\n");
    expect(tdf).toContain("\tunitname=probe_unit;\n");
  });

  it("holds no entry when there is no builder", () => {
    expect(buildDownloadMenu(null, "probe_unit")).not.toContain("MENUENTRY");
  });

  it("refuses a name that would break the file", () => {
    expect(() => buildDownloadMenu("fed;}", "probe_unit")).toThrow();
  });
});

/**
 * Runs the gadget against a stub of the slice of the engine it touches, and
 * prints what it asked the engine to do, one call a line.
 */
function runGadget(
  gadget: string,
  modMission: string,
  script: string,
  {
    synced = true,
    framework = "loads",
  }: { synced?: boolean; framework?: "loads" | "fails" | "missing" } = {},
) {
  const harness = `
local calls = {}
local function log(s) calls[#calls + 1] = s end
gadget = {}
gadgetHandler = { IsSyncedCode = function() return ${synced} end }
CMD = { FIRE_STATE = 45, MOVE_STATE = 50 }
UnitDefNames = { fedcommander = { id = 7 } }
local dead = {}
Spring = {
  GetModOptions = function() return { coilbox_mission = ${JSON.stringify(modMission)} } end,
  GetGaiaTeamID = function() return 2 end,
  SendLuaRulesMsg = function(m) log("message " .. m) end,
  SendCommands = function(c) log("command " .. c) end,
  GetPlayerList = function() return { 0 } end,
  GetPlayerInfo = function() return "you", true, false, 0 end,
  GiveOrderToUnit = function(u, cmd, p) log("order " .. u .. " " .. cmd .. " " .. p[1]) end,
  GetTeamInfo = function(t) return t, 0, dead[t] or false end,
  GetUnitHealth = function(u) return 100, 100, 0, 0, u == 99 and 0.5 or 1 end,
  GetUnitPosition = function() return 10, 20, 30 end,
  GetUnitBuildFacing = function() return 1 end,
  CreateUnit = function(d, x, y, z, f, t) log("create " .. d .. " " .. x .. " " .. y .. " " .. z .. " " .. f .. " " .. t) end,
}
local chunk = assert(loadstring(io.read("*a")))
local result = chunk()
if result == false then print("off") return end
-- What a gadget asking for \`handler = true\` holds once it has loaded.
local framework = ${JSON.stringify(framework)}
gadgetHandler = {
  knownGadgets = {
    ["Some other gadget"] = { basename = "other.lua", active = true },
    ["Lua unit script framework"] = framework ~= "missing"
      and { basename = "unit_script.lua", active = true } or nil,
  },
  DisableGadget = function(_, name) log("disable " .. name) return true end,
  EnableGadget = function(_, name) log("enable " .. name) return framework == "loads" end,
}
SendToUnsynced = function(...) log("to unsynced " .. table.concat({ ... }, " ")) end
${script}
for _, c in ipairs(calls) do print(c) end
`;
  const run = spawnSync("luajit", ["-e", harness], { input: gadget });
  return {
    status: run.status,
    stderr: run.stderr?.toString() ?? "",
    lines: (run.stdout?.toString() ?? "").trim().split("\n"),
  };
}

describe("buildSandboxGadget", () => {
  const gadget = buildSandboxGadget("fedcommander");

  it("holds a target's fire and position, and the placed builder's fire", () => {
    const run = runGadget(
      gadget,
      SANDBOX_MISSION_ID,
      `gadget:UnitCreated(11, 3, 1)
       gadget:UnitCreated(12, 7, 0)
       gadget:UnitCreated(13, 7, 0, 12)
       gadget:UnitCreated(14, 3, 0)
       gadget:UnitCreated(15, 3, 2)`,
    );
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "order 11 45 0",
      "order 11 50 0",
      "order 12 45 0",
    ]);
  });

  it("replaces a target that dies where it stood, and nothing else", () => {
    const run = runGadget(
      gadget,
      SANDBOX_MISSION_ID,
      `gadget:UnitDestroyed(11, 3, 1)
       gadget:UnitDestroyed(99, 3, 1)
       gadget:UnitDestroyed(12, 3, 0)
       dead[1] = true
       gadget:UnitDestroyed(13, 3, 1)`,
    );
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["create 3 10 20 30 1 1"]);
  });

  it("switches itself off in a game that is not the sandbox", () => {
    const run = runGadget(gadget, "", "");
    expect(run.status).toBe(0);
    expect(run.lines).toEqual(["off"]);
  });

  // Issue #3346. Reloading every gadget restarts the game's own as well, and
  // Splinter Faction's kills a team with no commander when it starts again
  // mid-game, which the targets are. So the sandbox reloads the one gadget that
  // holds the unit scripts.
  const ask = (script: string) =>
    `log("handled " .. tostring(gadget:GotChatMsg(${JSON.stringify(SANDBOX_RELOAD_MESSAGE)}, 255)))${script}`;

  it("reloads the unit script framework alone when coilbox asks, and says so", () => {
    const run = runGadget(gadget, SANDBOX_MISSION_ID, ask(""));
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "disable Lua unit script framework",
      "enable Lua unit script framework",
      `to unsynced coilbox_sandbox ${SANDBOX_LOADED_REPLY}`,
      "handled true",
    ]);
  });

  it("says so when the framework does not load again", () => {
    const run = runGadget(gadget, SANDBOX_MISSION_ID, ask(""), {
      framework: "fails",
    });
    expect(run.stderr).toBe("");
    expect(run.lines[2]).toMatch(
      new RegExp(`^to unsynced coilbox_sandbox ${SANDBOX_REPLY}failed:`),
    );
  });

  it("says so when the game runs no Lua unit scripts", () => {
    const run = runGadget(gadget, SANDBOX_MISSION_ID, ask(""), {
      framework: "missing",
    });
    expect(run.lines[0]).toMatch(
      new RegExp(`^to unsynced coilbox_sandbox ${SANDBOX_REPLY}failed:`),
    );
  });

  it("leaves every other chat message to the gadgets it is for", () => {
    const run = runGadget(
      gadget,
      SANDBOX_MISSION_ID,
      `log("handled " .. tostring(gadget:GotChatMsg("reload_scripts", 0)))`,
    );
    expect(run.lines).toEqual(["handled false"]);
  });

  it("passes the answer to coilbox from its unsynced half", () => {
    const run = runGadget(
      gadget,
      SANDBOX_MISSION_ID,
      `gadget:RecvFromSynced("someone_else", "x")
       log("handled " .. tostring(gadget:RecvFromSynced("coilbox_sandbox", "coilbox_sandbox:loaded")))`,
      { synced: false },
    );
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "message coilbox_sandbox:loaded",
      "handled true",
    ]);
  });

  // Issue #4146. The command is unsynced, and one from the autohost is never
  // run, so the gadget's unsynced half sends it.
  it("hands a texture reload to its unsynced half when coilbox asks", () => {
    const run = runGadget(
      gadget,
      SANDBOX_MISSION_ID,
      `log("handled " .. tostring(gadget:GotChatMsg(${JSON.stringify(SANDBOX_TEXTURES_MESSAGE)}, 255)))`,
    );
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "to unsynced coilbox_sandbox_textures",
      "handled true",
    ]);
  });

  it("reloads the textures from its unsynced half, then says so", () => {
    const run = runGadget(
      gadget,
      SANDBOX_MISSION_ID,
      `log("handled " .. tostring(gadget:RecvFromSynced("coilbox_sandbox_textures")))`,
      { synced: false },
    );
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "command reloadtextures s3o",
      `message ${SANDBOX_TEXTURES_REPLY}`,
      "handled true",
    ]);
  });

  it("switches its unsynced half off in a game that is not the sandbox", () => {
    const run = runGadget(gadget, "", "", { synced: false });
    expect(run.lines).toEqual(["off"]);
  });

  it("still loads when the game has no builder", () => {
    const run = runGadget(
      buildSandboxGadget(null),
      SANDBOX_MISSION_ID,
      "gadget:UnitCreated(12, 7, 0)",
    );
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([""]);
  });
});
