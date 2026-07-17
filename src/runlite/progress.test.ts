import { describe, expect, it } from "vitest";
import type { RogueliteRun } from "./model";
import {
  hullLoss,
  moveTo,
  nextChoices,
  pendingNode,
  resolveBattle,
  salvageReward,
  successors,
} from "./progress";

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

describe("navigation", () => {
  it("offers successors of the resolved current node", () => {
    const r = run();
    expect(successors(r, "start").map((n) => n.id)).toEqual(["b1", "b2"]);
    expect(nextChoices(r).map((n) => n.id)).toEqual(["b1", "b2"]);
    expect(pendingNode(r)).toBeNull();
  });

  it("moving to a successor makes it the pending (unresolved) node", () => {
    const r = moveTo(run(), "b1", "now");
    expect(r.progress.currentNodeId).toBe("b1");
    expect(pendingNode(r)?.id).toBe("b1");
    // No further choices until b1 is resolved.
    expect(nextChoices(r)).toEqual([]);
  });

  it("rejects an illegal move", () => {
    const r = run();
    expect(moveTo(r, "boss")).toBe(r);
  });
});

describe("resolveBattle", () => {
  it("victory banks salvage and marks the node visited", () => {
    let r = moveTo(run(), "b1", "now");
    r = resolveBattle(r, "b1", "victory", "now");
    expect(r.progress.visited).toContain("b1");
    expect(r.progress.salvage).toBe(salvageReward(r.nodes[1]));
    expect(r.progress.status).toBe("active");
    // Now the boss is offered.
    expect(nextChoices(r).map((n) => n.id)).toEqual(["boss"]);
  });

  it("defeat costs hull but still crosses the node (no soft-lock)", () => {
    let r = moveTo(run(), "b1", "now");
    const loss = hullLoss(r.nodes[1]);
    r = resolveBattle(r, "b1", "defeat", "now");
    expect(r.progress.hull).toBe(30 - loss);
    expect(r.progress.visited).toContain("b1");
    expect(r.progress.status).toBe("active");
  });

  it("hull hitting zero ends the run", () => {
    let r = run();
    r.progress.hull = 5;
    r = moveTo(r, "b1", "now");
    r = resolveBattle(r, "b1", "defeat", "now");
    expect(r.progress.hull).toBe(0);
    expect(r.progress.status).toBe("lost");
    expect(nextChoices(r)).toEqual([]);
  });

  it("winning the boss wins the run", () => {
    let r = moveTo(run(), "b1", "now");
    r = resolveBattle(r, "b1", "victory", "now");
    r = moveTo(r, "boss", "now");
    r = resolveBattle(r, "boss", "victory", "now");
    expect(r.progress.status).toBe("won");
  });

  it("boss salvage and hull loss scale above a normal battle", () => {
    const r = run();
    expect(salvageReward(r.nodes[3])).toBeGreaterThan(
      salvageReward(r.nodes[1]),
    );
    expect(hullLoss(r.nodes[3])).toBeGreaterThan(hullLoss(r.nodes[1]));
  });
});
