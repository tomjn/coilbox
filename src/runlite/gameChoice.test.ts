import { describe, expect, it } from "vitest";
import { unitsMissingFrom, withGameChoice } from "./gameChoice";
import type { RogueliteRun } from "./model";

function run(): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    name: "Test Reach",
    settings: {
      seed: 1,
      length: "standard",
      difficulty: 2,
      ascension: 0,
      game: { shortname: "ZK" },
      factionId: "player",
      skin: "galaxy",
    },
    startUnit: "ZK_Commander",
    nodes: [],
    edges: [],
    progress: {
      currentNodeId: "n0",
      visited: [],
      hull: 100,
      maxHull: 100,
      salvage: 0,
      perks: [],
      unlockedUnits: ["Cloakraid", "gone"],
      status: "active",
    } as unknown as RogueliteRun["progress"],
    history: [],
    createdAt: "t",
    updatedAt: "t",
  };
}

describe("withGameChoice", () => {
  it("pins the answered game and leaves the rest of the run alone", () => {
    const before = run();
    const after = withGameChoice(before, { pinnedName: "Zero-K v1.14.10.1" });
    expect(after.settings.game).toEqual({
      shortname: "ZK",
      pinnedName: "Zero-K v1.14.10.1",
    });
    expect(after.settings.seed).toBe(before.settings.seed);
    expect(after.progress).toBe(before.progress);
    expect(before.settings.game).toEqual({ shortname: "ZK" });
  });

  it("remembers a declined update without changing the game", () => {
    const after = withGameChoice(run(), { declinedUpdate: "Zero-K v1.15.0.0" });
    expect(after.declinedGameUpdate).toBe("Zero-K v1.15.0.0");
    expect(after.settings.game).toEqual({ shortname: "ZK" });
  });
});

describe("unitsMissingFrom", () => {
  it("lists the start unit and unlocked units the other game lacks", () => {
    expect(unitsMissingFrom(run(), ["zk_commander", "cloakraid"])).toEqual([
      "gone",
    ]);
    expect(unitsMissingFrom(run(), ["cloakraid", "gone"])).toEqual([
      "ZK_Commander",
    ]);
  });

  it("is empty when everything moves over", () => {
    expect(
      unitsMissingFrom(run(), ["ZK_Commander", "Cloakraid", "gone"]),
    ).toEqual([]);
  });
});
