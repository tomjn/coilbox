import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { BattleConfig } from "../play/bindings";
import { buildPlayerLimitGadget, withPlayerUnits } from "./playerLimit";

/**
 * Load the gadget under luajit with a stand-in for the engine, where team 0 is
 * limited to `com` and `lab`, then run `script` and read back what it printed.
 */
function runGadget(
  options: string,
  script: string,
  synced = true,
): string[] {
  const harness = `
    local source = io.read("*a")
    UnitDefs = {
      [1] = { name = "com", buildOptions = { 2, 3, 4 }, maxThisUnit = 1 },
      [2] = { name = "lab", buildOptions = {}, maxThisUnit = 1 },
      [3] = { name = "tank", buildOptions = {}, maxThisUnit = 1 },
      [4] = { name = "banned", buildOptions = {}, maxThisUnit = 0 },
    }
    UnitDefNames = { com = { id = 1 } }
    CMD = { INSERT = 1 }
    edits = {}
    params = {}
    drawn = {}
    gl = { Text = function(text) drawn[#drawn + 1] = text end }
    Spring = {
      GetModOptions = function() return { ${options} } end,
      GetTeamUnits = function() return {} end,
      GetUnitTeam = function(unitID) return unitID == 8 and 1 or 0 end,
      GetUnitCmdDescs = function(_, index) return { { id = -index } } end,
      FindUnitCmdDesc = function(_, cmdID) return cmdID end,
      EditUnitCmdDesc = function(_, index, desc) edits[-index] = desc.disabled end,
      GetSideData = function(side) return side == "Kala" and "COM" or nil end,
      GetSpectatingState = function() return spectating end,
      SetTeamRulesParam = function(team, name, value) params[team .. name] = value end,
      GetTeamRulesParam = function(team, name) return params[team .. name] end,
    }
    gadgetHandler = { IsSyncedCode = function() return ${synced} end }
    gadget = {}
    loaded = assert(loadstring(source))()
    ${script}
  `;
  const run = spawnSync("luajit", ["-e", harness], {
    input: buildPlayerLimitGadget(),
  });
  expect(run.stderr?.toString()).toBe("");
  return (run.stdout?.toString() ?? "").trim().split("\n");
}

const LIMITED = 'coilbox_player_team = "0", coilbox_player_units = "com lab"';

describe("the player limit gadget", () => {
  it("removes itself when the start script names no limit", () => {
    expect(runGadget("", "print(loaded)")).toEqual(["false"]);
  });

  it("refuses a locked unit for the player's team", () => {
    const [allowed, locked] = runGadget(
      LIMITED,
      `print(gadget:AllowCommand(9, 1, 0, -2, {}))
       print(gadget:AllowCommand(9, 1, 0, -3, {}))`,
    );
    expect(allowed).toBe("true");
    expect(locked).toBe("false");
  });

  it("refuses a locked unit inside an inserted order", () => {
    expect(
      runGadget(
        LIMITED,
        "print(gadget:AllowCommand(9, 1, 0, 1, { 0, -3, 0 }))",
      ),
    ).toEqual(["false"]);
  });

  it("leaves an order that builds nothing alone", () => {
    expect(
      runGadget(LIMITED, "print(gadget:AllowCommand(9, 1, 0, 10, {}))"),
    ).toEqual(["true"]);
  });

  it("does not limit another team", () => {
    expect(
      runGadget(
        LIMITED,
        `print(gadget:AllowCommand(9, 1, 1, -3, {}))
         print(gadget:AllowUnitCreation(3, 9, 1))`,
      ),
    ).toEqual(["true", "true"]);
  });

  it("stops a factory making a locked unit for the player's team", () => {
    expect(
      runGadget(
        LIMITED,
        `print(gadget:AllowUnitCreation(3, 9, 0))
         print(gadget:AllowUnitCreation(2, 9, 0))`,
      ),
    ).toEqual(["false", "true"]);
  });

  it("marks locked build options on the player's units only", () => {
    expect(
      runGadget(
        LIMITED,
        `gadget:UnitCreated(9, 1, 1)
         print(next(edits))
         gadget:UnitCreated(9, 1, 0)
         print(edits[2], edits[3], edits[4])`,
      ),
    ).toEqual(["nil", "nil\ttrue\ttrue"]);
  });

  it("keeps a locked entry off when a game's own Lua switches it back on", () => {
    expect(
      runGadget(
        LIMITED,
        `local function edited(unitID, index)
           local desc = { disabled = false }
           Spring.EditUnitCmdDesc(unitID, index, desc)
           return desc.disabled
         end
         print(edited(9, 3), edited(9, 2), edited(8, 3))`,
      ),
    ).toEqual(["true\tfalse\tfalse"]);
  });

  it("hands a unit leaving the team back to the start script's list", () => {
    expect(
      runGadget(
        LIMITED,
        `gadget:UnitGiven(9, 1, 1, 0)
         print(edits[3], edits[4])`,
      ),
    ).toEqual(["false\ttrue"]);
  });
});

describe("starting the player on the run's side", () => {
  const options = (picker: string, side: string) =>
    `${LIMITED}, coilbox_player_picker = "${picker}", coilbox_player_side = "${side}", coilbox_player_side_note = "Wrong side"`;
  const METAL = options("faction_selected", "Claw");
  const SPLINTER = options("startUnit", "Kala");

  it("writes a side name to a picker that reads one", () => {
    expect(
      runGadget(METAL, "gadget:Initialize() print(params['0faction_selected'])"),
    ).toEqual(["claw"]);
  });

  it("writes the side's start unit to a picker that reads a def id", () => {
    expect(
      runGadget(SPLINTER, "gadget:Initialize() print(params['0startUnit'])"),
    ).toEqual(["1"]);
  });

  it("writes nothing for a side the game does not have", () => {
    expect(
      runGadget(
        options("startUnit", "Nobody"),
        "gadget:Initialize() print(next(params))",
      ),
    ).toEqual(["nil"]);
  });

  it("writes nothing when the script names no picker", () => {
    expect(
      runGadget(LIMITED, "gadget:Initialize() print(next(params))"),
    ).toEqual(["nil"]);
  });

  const drawnAfter = (setup: string, overrides = METAL) =>
    runGadget(
      overrides,
      `${setup}
       gadget:DrawScreen(100, 100)
       print(#drawn)`,
      false,
    );

  it("says nothing on the run's side or before the param is set", () => {
    expect(drawnAfter("")).toEqual(["0"]);
    expect(drawnAfter("params['0faction_selected'] = 'claw'")).toEqual(["0"]);
  });

  it("says why when the player picks another faction", () => {
    expect(drawnAfter("params['0faction_selected'] = 'aven'")).toEqual(["1"]);
  });

  it("says nothing to a spectator, so not in a replay", () => {
    expect(
      drawnAfter("spectating = true params['0faction_selected'] = 'aven'"),
    ).toEqual(["0"]);
  });

  it("says nothing when Random lands on the run's side", () => {
    expect(
      drawnAfter(
        "params['0faction_selected'] = 'random' params['0faction'] = 'random_claw'",
      ),
    ).toEqual(["0"]);
  });

  it("says why when Random lands on another side", () => {
    expect(
      drawnAfter(
        "params['0faction_selected'] = 'random' params['0faction'] = 'random_aven'",
      ),
    ).toEqual(["1"]);
  });

  it("removes its unsynced half when the script names no picker", () => {
    expect(runGadget(LIMITED, "print(loaded)", false)).toEqual(["false"]);
  });
});

describe("withPlayerUnits", () => {
  const config = {
    players: [{ team: 2 }],
    modOptions: { other: "1" },
  } as unknown as BattleConfig;

  it("names the player's team and the units, sorted", () => {
    expect(withPlayerUnits(config, ["b", "a"], "Zero-K v1", "Robots").modOptions).toEqual({
      other: "1",
      coilbox_player_team: "2",
      coilbox_player_units: "a b",
    });
  });

  it.each([
    ["Metal Factions v2.58", "Claw", "faction_selected"],
    ["SplinterFaction 0.1.96", "Federation of Kala", "startUnit"],
  ])("names the picker and the side for %s", (game, side, picker) => {
    expect(withPlayerUnits(config, ["a"], game, side).modOptions).toMatchObject(
      {
        coilbox_player_picker: picker,
        coilbox_player_side: side,
        coilbox_player_side_note: expect.stringContaining(side),
      },
    );
  });

  it.each([
    ["a game with no known picker", "Zero-K v1", "Robots"],
    ["a Random side", "Metal Factions v2.58", "Random"],
    ["no side", "Metal Factions v2.58", ""],
    ["an unset side", "Metal Factions v2.58", undefined],
  ])("adds no side for %s", (_, game, side) => {
    expect(withPlayerUnits(config, ["a"], game, side).modOptions).toEqual({
      other: "1",
      coilbox_player_team: "2",
      coilbox_player_units: "a",
    });
  });

  it("keeps a semicolon out of the note, which would end its value", () => {
    const note = withPlayerUnits(
      config,
      ["a"],
      "Metal Factions v2.58",
      "Claw; the old guard",
    ).modOptions?.coilbox_player_side_note;
    expect(note).not.toContain(";");
  });

  it("leaves a spectator's config alone", () => {
    const spectating = { players: [{}] } as unknown as BattleConfig;
    expect(withPlayerUnits(spectating, ["a"], "Zero-K v1", "Robots")).toBe(spectating);
  });
});
