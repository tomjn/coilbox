import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { BattleConfig } from "../play/bindings";
import { buildPlayerLimitGadget, withPlayerUnits } from "./playerLimit";

/**
 * Load the gadget under luajit with a stand-in for the engine, where team 0 is
 * limited to `com` and `lab`, then run `script` and read back what it printed.
 */
function runGadget(options: string, script: string): string[] {
  const harness = `
    local source = io.read("*a")
    UnitDefs = {
      [1] = { name = "com", buildOptions = { 2, 3, 4 }, maxThisUnit = 1 },
      [2] = { name = "lab", buildOptions = {}, maxThisUnit = 1 },
      [3] = { name = "tank", buildOptions = {}, maxThisUnit = 1 },
      [4] = { name = "banned", buildOptions = {}, maxThisUnit = 0 },
    }
    CMD = { INSERT = 1 }
    edits = {}
    Spring = {
      GetModOptions = function() return { ${options} } end,
      GetTeamUnits = function() return {} end,
      FindUnitCmdDesc = function(_, cmdID) return cmdID end,
      EditUnitCmdDesc = function(_, index, desc) edits[-index] = desc.disabled end,
    }
    gadgetHandler = { IsSyncedCode = function() return true end }
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

describe("withPlayerUnits", () => {
  const config = {
    players: [{ team: 2 }],
    modOptions: { other: "1" },
  } as unknown as BattleConfig;

  it("names the player's team and the units, sorted", () => {
    expect(withPlayerUnits(config, ["b", "a"]).modOptions).toEqual({
      other: "1",
      coilbox_player_team: "2",
      coilbox_player_units: "a b",
    });
  });

  it("leaves a spectator's config alone", () => {
    const spectating = { players: [{}] } as unknown as BattleConfig;
    expect(withPlayerUnits(spectating, ["a"])).toBe(spectating);
  });
});
