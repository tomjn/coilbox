import { describe, expect, it } from "vitest";
import type { BattleConfig } from "../play/bindings";
import { applyPerks, disabledUnitsFor, perkTotals } from "./build";
import type { Perk, RogueliteRun } from "./model";

const EDGES = new Map<string, string[]>([
  ["com", ["mex", "vplant"]],
  ["mex", []],
  ["vplant", ["tank", "con"]],
  ["tank", []],
  ["con", ["radar"]],
  ["radar", []],
]);

function run(
  unlocked: string[],
  startUnit: string | undefined = "com",
): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    settings: {
      seed: 1,
      length: "standard",
      difficulty: 2,
      ascension: 0,
      game: { shortname: "ba" },
      factionId: "p",
      skin: "galaxy",
    },
    startUnit,
    nodes: [{ id: "start", type: "start", col: 0, row: 0 }],
    edges: [],
    progress: {
      currentNodeId: "start",
      visited: ["start"],
      hull: 100,
      maxHull: 100,
      salvage: 0,
      unlockedUnits: unlocked,
      perks: [],
      status: "active",
    },
    history: [],
    createdAt: "t",
    updatedAt: "t",
  };
}

describe("disabledUnitsFor", () => {
  it("disables the reachable arsenal minus the unlocked set", () => {
    const disabled = disabledUnitsFor(run(["com", "mex", "vplant"]), EDGES);
    expect(disabled.sort()).toEqual(["con", "radar", "tank"]);
  });

  it("disables nothing when everything reachable is unlocked", () => {
    const all = ["com", "mex", "vplant", "tank", "con", "radar"];
    expect(disabledUnitsFor(run(all), EDGES)).toEqual([]);
  });

  it("is case-insensitive on the unlocked set", () => {
    const disabled = disabledUnitsFor(run(["COM", "MEX", "VPLANT"]), EDGES);
    expect(disabled).not.toContain("com");
    expect(disabled.sort()).toEqual(["con", "radar", "tank"]);
  });

  it("disables nothing when there is no start unit (full arsenal)", () => {
    const r = run([]);
    r.startUnit = undefined;
    expect(disabledUnitsFor(r, EDGES)).toEqual([]);
  });
});

describe("applyPerks", () => {
  function config(): BattleConfig {
    return {
      mapName: "m",
      gameType: "g",
      myPlayerName: "You",
      startPosType: 0,
      players: [{ name: "You", team: 0, spectator: false }],
      ais: [],
      teams: [{ teamLeader: 0, allyTeam: 0, rgbColor: [0, 0, 1] }],
      allyTeams: [{ numAllies: 0 }],
    };
  }

  it("sums advantage and income onto the player team", () => {
    const perks: Perk[] = [
      { kind: "advantage", value: 0.1, label: "a" },
      { kind: "advantage", value: 0.05, label: "b" },
      { kind: "income", value: 0.2, label: "c" },
    ];
    const cfg = applyPerks(config(), perks);
    expect(cfg.teams[0].advantage).toBeCloseTo(0.15, 5);
    expect(cfg.teams[0].incomeMultiplier).toBeCloseTo(1.2, 5);
  });

  it("leaves levers unset when there are no perks", () => {
    const cfg = applyPerks(config(), []);
    expect(cfg.teams[0].advantage).toBeUndefined();
    expect(cfg.teams[0].incomeMultiplier).toBeUndefined();
  });
});

describe("perkTotals", () => {
  it("sums advantage and income across a perk list", () => {
    const totals = perkTotals([
      { kind: "advantage", value: 0.1, label: "a" },
      { kind: "advantage", value: 0.05, label: "b" },
      { kind: "income", value: 0.2, label: "c" },
    ]);
    expect(totals.advantage).toBeCloseTo(0.15, 5);
    expect(totals.income).toBeCloseTo(0.2, 5);
  });

  it("returns zeroes for an empty list", () => {
    expect(perkTotals([])).toEqual({ advantage: 0, income: 0 });
  });
});
