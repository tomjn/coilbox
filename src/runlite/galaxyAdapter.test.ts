import { describe, expect, it } from "vitest";
import { forwardReachable, RUN_DIM, runEmphasis } from "./galaxyAdapter";
import type { RogueliteRun } from "./model";
import { resolveBattle } from "./progress";

// start -> {b1, b2} -> boss (a diamond).
function run(): RogueliteRun {
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
    nodes: [
      { id: "start", type: "start", col: 0, row: 0 },
      {
        id: "b1",
        type: "battle",
        col: 1,
        row: 0,
        battle: { mapName: "m", enemyAiCount: 1, handicap: 0, techTier: 2 },
      },
      {
        id: "b2",
        type: "battle",
        col: 1,
        row: 1,
        battle: { mapName: "m", enemyAiCount: 1, handicap: 0, techTier: 2 },
      },
      {
        id: "boss",
        type: "boss",
        col: 2,
        row: 0,
        battle: { mapName: "m", enemyAiCount: 3, handicap: 30, techTier: 5 },
      },
    ],
    edges: [
      ["start", "b1"],
      ["start", "b2"],
      ["b1", "boss"],
      ["b2", "boss"],
    ],
    progress: {
      currentNodeId: "start",
      visited: ["start"],
      hull: 30,
      maxHull: 100,
      salvage: 0,
      unlockedUnits: [],
      perks: [],
      status: "active",
    },
    history: [],
    createdAt: "t",
    updatedAt: "t",
  };
}

describe("forwardReachable", () => {
  it("collects the node and all its forward descendants", () => {
    expect(forwardReachable(run(), "start")).toEqual(
      new Set(["start", "b1", "b2", "boss"]),
    );
    expect(forwardReachable(run(), "b1")).toEqual(new Set(["b1", "boss"]));
  });
});

describe("runEmphasis", () => {
  it("leaves the current node and its choices at full brightness", () => {
    const e = runEmphasis(run());
    // start (current) is absent = bright.
    expect(e.has("start")).toBe(false);
    // b1/b2 (the choices ahead) stay bright (no opacity) but flash as battles.
    expect(e.get("b1")?.opacity).toBeUndefined();
    expect(e.get("b1")?.flash).toBe(true);
    expect(e.get("b2")?.opacity).toBeUndefined();
    // boss is reachable but not an immediate choice -> dimmed future, flashing.
    expect(e.get("boss")?.opacity).toBe(RUN_DIM.future);
    expect(e.get("boss")?.flash).toBe(true);
  });

  it("mutes the crossed path and greatly dims the branch not taken", () => {
    const r = resolveBattle(run(), "b1", "victory", "now"); // now at b1
    const e = runEmphasis(r);
    // boss is the only choice now -> bright (no opacity), still flashes.
    expect(e.get("boss")?.opacity).toBeUndefined();
    expect(e.get("boss")?.flash).toBe(true);
    expect(e.has("b1")).toBe(false); // current
    // start is behind you -> muted and marked done.
    expect(e.get("start")?.opacity).toBe(RUN_DIM.done);
    expect(e.get("start")?.marker).toBe("check");
    // b2 (the fork you passed on) is unreachable now -> greatly dimmed.
    expect(e.get("b2")?.opacity).toBe(RUN_DIM.unreachable);
  });
});
