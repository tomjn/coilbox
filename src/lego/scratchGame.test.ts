import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  buildLuaRulesEntry,
  buildModInfo,
  buildSideData,
  buildStartUnitGadget,
  buildUnitScriptGadget,
  LUARULES_ENTRIES_LUA,
  missingLuaRulesEntries,
  SCRATCH_SIDE,
  SPAWN_FRAME,
} from "./scratchGame";

/** Run generated Lua under luajit and read back what it printed. */
function runLua(source: string, harness: string) {
  const run = spawnSync("luajit", ["-e", harness], { input: source });
  return {
    stderr: run.stderr?.toString() ?? "",
    lines: (run.stdout?.toString() ?? "").trim().split("\n"),
  };
}

/**
 * Load the side data the way the engine's side parser does, in a game whose
 * `gamedata/sidedata.tdf` parses to `tdf` (null for a game with no such file),
 * and print each side as `name=startunit`.
 */
function runSideData(tdf: string | null) {
  return runLua(
    buildSideData("cakebot_test"),
    `
VFS = {
  FileExists = function(path) return ${tdf ? "path == 'gamedata/sidedata.tdf'" : "false"} end,
  Include = function(path)
    assert(path == "gamedata/parse_tdf.lua", path)
    return { Parse = function() return ${tdf ?? "nil"} end }
  end,
}
for _, side in ipairs(assert(loadstring(io.read("*a")))()) do
  print(side.name .. "=" .. side.startunit)
end
`,
  );
}

/**
 * Load the unit script gadget in a game whose synced gadget folder holds
 * `gadgets` (file name to text), and print what the file hands the gadget
 * handler.
 */
function runUnitScriptGadget(gadgets: Record<string, string>) {
  const files = Object.entries(gadgets)
    .map(
      ([name, text]) =>
        `files["LuaRules/Gadgets/${name}"] = ${JSON.stringify(text)}`,
    )
    .join("\n");
  return runLua(
    buildUnitScriptGadget(),
    `
local files = {}
${files}
VFS = {
  ZIP_ONLY = "zip",
  DirList = function()
    local list = {}
    for path in pairs(files) do list[#list + 1] = path end
    table.sort(list)
    return list
  end,
  LoadFile = function(path) return files[path] end,
  Include = function(path, env, mode) return "included " .. path .. " from " .. mode end,
}
print(tostring(assert(loadstring(io.read("*a")))()))
`,
  );
}

/** A unit already on the map when the gadget spawns, such as a commander. */
interface StandingUnit {
  x: number;
  z: number;
  radius: number;
  /** Half the width of the ground it blocks, in elmos. */
  half: number;
}

/**
 * Load the start unit gadget on `loadFrame`, play `frames`, and print each unit
 * it created with where it went. Team 0 has none of the unit, so it gets one
 * whenever the gadget decides to spawn. The map is 512 elmos square, the team
 * starts at (256, 256), and the built unit has a 2 by 2 square footprint, so
 * 16 elmos, and a radius of 5. `TestBuildOrder` answers 1 for a footprint that
 * meets a standing unit's blocked ground, 0 inside `blocked`, and 2 elsewhere.
 */
function runStartUnitGadget(
  loadFrame: number,
  frames: number[],
  opts: { standing?: StandingUnit[]; blocked?: string } = {},
) {
  const standing = (opts.standing ?? [])
    .map(
      (u) =>
        `{ x = ${u.x}, z = ${u.z}, radius = ${u.radius}, half = ${u.half} }`,
    )
    .join(", ");
  const harness = `
gadget = {}
gadgetHandler = { IsSyncedCode = function() return true end }
UnitDefNames = { cakebot_test = { id = 3, xsize = 2, zsize = 2, radius = 5 } }
Game = { squareSize = 8, mapSizeX = 512, mapSizeZ = 512 }
local standing = { ${standing} }
local function blocked(x, z) return ${opts.blocked ?? "false"} end
Spring = {
  GetGameFrame = function() return ${loadFrame} end,
  GetGaiaTeamID = function() return 9 end,
  GetTeamList = function() return { 0 } end,
  GetTeamUnitDefCount = function() return 0 end,
  GetTeamStartPosition = function() return 256, 2, 256 end,
  GetGroundHeight = function() return 7 end,
  GetAllUnits = function()
    local ids = {}
    for i in ipairs(standing) do ids[#ids + 1] = i end
    return ids
  end,
  GetUnitPosition = function(id) return standing[id].x, 7, standing[id].z end,
  GetUnitRadius = function(id) return standing[id].radius end,
  TestBuildOrder = function(d, x, y, z, facing)
    if blocked(x, z) then return 0 end
    for _, u in ipairs(standing) do
      if math.abs(x - u.x) < u.half + 8 and math.abs(z - u.z) < u.half + 8 then return 1 end
    end
    return 2
  end,
  CreateUnit = function(d, x, y, z, f, t)
    print("create " .. d .. " " .. t .. " at " .. x .. " " .. y .. " " .. z)
  end,
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
    // One side when the base game declares none the TDF way, so the built unit
    // is what the engine's default side starts with.
    const run = runSideData(null);
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([`${SCRATCH_SIDE}=cakebot_test`]);
  });

  // Issue #4139. Metal Factions declares its sides in gamedata/sidedata.tdf and
  // its start gadget looks one up by name, so replacing the list wholesale left
  // Spring.GetSideData("random") with nothing to return.
  it("keeps the sides a base game declares in sidedata.tdf, after its own", () => {
    const run = runSideData(
      '{ side0 = { name = "Random", commander = "random" }, side1 = { name = "Aven", commander = "aven_commander" }, other = {} }',
    );
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      `${SCRATCH_SIDE}=cakebot_test`,
      "Random=random",
      "Aven=aven_commander",
    ]);
  });

  it("is left with its own side when the base game's tdf does not parse", () => {
    const run = runSideData("nil");
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([`${SCRATCH_SIDE}=cakebot_test`]);
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

  it("spawns the built unit at a team's start position when it is clear", () => {
    expect(buildStartUnitGadget("cakebot_test")).toContain(
      'local UNIT_NAME = "cakebot_test"',
    );
    const run = runStartUnitGadget(0, [SPAWN_FRAME]);
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["create 3 0 at 256 7 256"]);
  });

  // Issue #4476. Metal Factions puts its commander on the start position too,
  // and the unit used to land inside it. In an engine run the commander's
  // radius was 39 and the engine called ground 25 elmos from its centre open,
  // because its model reaches well past the ground it blocks.
  it("spawns clear of a commander standing on the start position", () => {
    const commander = { x: 263, z: 250, radius: 39, half: 12 };
    const run = runStartUnitGadget(0, [SPAWN_FRAME], { standing: [commander] });
    expect(run.stderr).toBe("");
    expect(run.lines).toHaveLength(1);
    const [, , , , x, , z] = run.lines[0].split(" ").map(Number);
    // Clear of the commander's model, not just of its blocked ground.
    expect(Math.hypot(x - commander.x, z - commander.z)).toBeGreaterThanOrEqual(
      commander.radius + 5,
    );
    // And in the nearest ring that has such a spot. Every spot one footprint
    // step out, 16 elmos, is closer to the commander than the two radii.
    expect(Math.max(Math.abs(x - 256), Math.abs(z - 256))).toBe(32);
  });

  it("keeps the start position when no ground on the map is clear", () => {
    const run = runStartUnitGadget(0, [SPAWN_FRAME], { blocked: "true" });
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["create 3 0 at 256 7 256"]);
  });

  it("skips ground the engine calls blocked, such as a cliff", () => {
    const run = runStartUnitGadget(0, [SPAWN_FRAME], {
      blocked: "x <= 256",
    });
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["create 3 0 at 272 7 240"]);
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
    expect(run.lines).toEqual(["create 3 0 at 256 7 256"]);
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

// Issue #4139. A Lua unit script runs only where the game has turned the
// engine's framework on, and Metal Factions has not (its units are all COB).
describe("buildUnitScriptGadget", () => {
  const framework = 'return VFS.Include("LuaGadgets/Gadgets/unit_script.lua")';

  it("turns the framework on in a game that has not", () => {
    const run = runUnitScriptGadget({
      "game_start.lua": "-- spawns a commander",
    });
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "included LuaGadgets/Gadgets/unit_script.lua from zip",
    ]);
  });

  it("leaves a game that has turned it on to its own copy", () => {
    // Two copies of the framework would each wrap every Lua unit.
    const run = runUnitScriptGadget({
      "game_start.lua": "-- spawns a commander",
      "unit_script.lua": framework,
    });
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["false"]);
  });

  it("finds the framework turned on under any file name", () => {
    const run = runUnitScriptGadget({ "unit_lua_scripts.lua": framework });
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["false"]);
  });

  it("does not take its own file for the game's", () => {
    const run = runUnitScriptGadget({
      "coilbox_unit_script.lua": buildUnitScriptGadget(),
    });
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual([
      "included LuaGadgets/Gadgets/unit_script.lua from zip",
    ]);
  });
});

// Issue #4475. The engine runs no gadget at all when a game lacks either file
// LuaRules starts from, and Empty Mod lacks `draw.lua`.
describe("LuaRules entry files", () => {
  /** Run the probe under luajit in a game holding `files`, and print its answer. */
  function probe(files: string[]) {
    return runLua(
      LUARULES_ENTRIES_LUA,
      `
local files = { ${files.map((f) => JSON.stringify(f)).join(", ")} }
VFS = {
  FileExists = function(path)
    for _, f in ipairs(files) do if f == path then return true end end
    return false
  end,
}
print(assert(loadstring(io.read("*a")))())
`,
    );
  }

  it("asks for both files and answers the ones the game has", () => {
    const run = probe(["LuaRules/main.lua"]);
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["LuaRules/main.lua"]);
    expect(probe(["LuaRules/main.lua", "LuaRules/draw.lua"]).lines).toEqual([
      "LuaRules/main.lua;LuaRules/draw.lua",
    ]);
  });

  it("reads the parser's quoted answer back as what is missing", () => {
    expect(missingLuaRulesEntries('"LuaRules/main.lua"')).toEqual([
      "LuaRules/draw.lua",
    ]);
    expect(
      missingLuaRulesEntries('"LuaRules/main.lua;LuaRules/draw.lua"'),
    ).toEqual([]);
    expect(missingLuaRulesEntries('""')).toEqual([
      "LuaRules/main.lua",
      "LuaRules/draw.lua",
    ]);
  });

  it("matches a game's file whatever its case", () => {
    expect(
      missingLuaRulesEntries('"luarules/main.lua;LUARULES/DRAW.LUA"'),
    ).toEqual([]);
  });

  it("starts the engine's own gadget handler from base content", () => {
    const run = runLua(
      buildLuaRulesEntry(),
      `
VFS = {
  BASE = "base",
  Include = function(path, env, mode) print(path .. " from " .. mode) end,
}
assert(loadstring(io.read("*a")))()
`,
    );
    expect(run.stderr).toBe("");
    expect(run.lines).toEqual(["LuaGadgets/gadgets.lua from base"]);
  });
});
