import { describe, expect, it } from "vitest";
import type { RogueliteRun, RunNode } from "./model";
import {
  applyEvent,
  applyReward,
  buyOffer,
  canActOn,
  deepestColumn,
  hullLoss,
  leaveNode,
  nextChoices,
  resolveBattle,
  restAtShop,
  salvageReward,
  successors,
} from "./progress";

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
  it("offers successors of the current node", () => {
    const r = run();
    expect(successors(r, "start").map((n) => n.id)).toEqual(["b1", "b2"]);
    expect(nextChoices(r).map((n) => n.id)).toEqual(["b1", "b2"]);
  });

  it("canActOn only allows forward choices or the current node", () => {
    const r = run();
    expect(canActOn(r, "b1")).toBe(true);
    expect(canActOn(r, "b2")).toBe(true);
    expect(canActOn(r, "start")).toBe(true); // the current node
    expect(canActOn(r, "boss")).toBe(false); // two hops away
  });

  it("opening a choice does not move — only resolving commits", () => {
    // Previewing a battle (no resolve) leaves you free to pick the other.
    const r = run();
    expect(r.progress.currentNodeId).toBe("start");
    const afterWin = resolveBattle(r, "b1", "victory", "now");
    expect(afterWin.progress.currentNodeId).toBe("b1");
    // From the fresh run you could equally have committed to b2.
    expect(
      resolveBattle(run(), "b2", "victory", "now").progress.currentNodeId,
    ).toBe("b2");
  });
});

describe("resolveBattle", () => {
  it("victory banks salvage, commits the move, marks the node visited", () => {
    const r = resolveBattle(run(), "b1", "victory", "now");
    expect(r.progress.currentNodeId).toBe("b1");
    expect(r.progress.visited).toContain("b1");
    expect(r.progress.salvage).toBe(salvageReward(r.nodes[1]));
    expect(r.progress.status).toBe("active");
    // Now the boss is offered.
    expect(nextChoices(r).map((n) => n.id)).toEqual(["boss"]);
  });

  it("rejects resolving a node that isn't a current choice", () => {
    const r = run();
    expect(resolveBattle(r, "boss", "victory", "now")).toBe(r);
  });

  it("defeat costs hull but still crosses the node (no soft-lock)", () => {
    const loss = hullLoss(run().nodes[1]);
    const r = resolveBattle(run(), "b1", "defeat", "now");
    expect(r.progress.hull).toBe(30 - loss);
    expect(r.progress.visited).toContain("b1");
    expect(r.progress.status).toBe("active");
  });

  it("hull hitting zero ends the run", () => {
    const base = run();
    base.progress.hull = 5;
    const r = resolveBattle(base, "b1", "defeat", "now");
    expect(r.progress.hull).toBe(0);
    expect(r.progress.status).toBe("lost");
    expect(nextChoices(r)).toEqual([]);
  });

  it("winning the boss wins the run", () => {
    let r = resolveBattle(run(), "b1", "victory", "now");
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

function nodeRun(node: RunNode, salvage = 100, hull = 50): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    name: "Test Reach",
    settings: {
      seed: 1,
      length: "standard",
      difficulty: 2,
      ascension: 0,
      game: { shortname: "ba" },
      factionId: "p",
      skin: "galaxy",
    },
    nodes: [{ id: "start", type: "start", col: 0, row: 0 }, node],
    edges: [["start", node.id]],
    progress: {
      // Standing at start; `node` is the forward choice being resolved.
      currentNodeId: "start",
      visited: ["start"],
      hull,
      maxHull: 100,
      salvage,
      unlockedUnits: ["com"],
      perks: [],
      status: "active",
    },
    history: [],
    createdAt: "t",
    updatedAt: "t",
  };
}

describe("applyReward", () => {
  it("unlock adds the unit and its branch, then resolves", () => {
    const r = nodeRun({
      id: "rw",
      type: "reward",
      col: 1,
      row: 0,
      reward: {
        title: "Cache",
        options: [
          { kind: "unlock", unit: "vplant", unitName: "V", opens: ["tank"] },
          { kind: "perk", perk: { kind: "advantage", value: 0.1, label: "p" } },
        ],
      },
    });
    const next = applyReward(r, "rw", 0, "now");
    expect(next.progress.unlockedUnits).toEqual(["com", "vplant", "tank"]);
    expect(next.progress.visited).toContain("rw");
    // The chosen option is recorded so a resolved node can show what was taken.
    expect(next.history.at(-1)?.note).toBe("Unlocked V");
  });

  it("perk option banks a perk", () => {
    const r = nodeRun({
      id: "rw",
      type: "reward",
      col: 1,
      row: 0,
      reward: {
        title: "Cache",
        options: [
          { kind: "perk", perk: { kind: "income", value: 0.2, label: "p" } },
        ],
      },
    });
    const next = applyReward(r, "rw", 0, "now");
    expect(next.progress.perks).toHaveLength(1);
  });
});

describe("applyEvent", () => {
  it("applies hull/salvage deltas and resolves", () => {
    const r = nodeRun({
      id: "ev",
      type: "event",
      col: 1,
      row: 0,
      event: {
        title: "Hulk",
        body: "",
        choices: [{ label: "Strip", salvage: 50, hull: -10 }],
      },
    });
    const next = applyEvent(r, "ev", 0, "now");
    expect(next.progress.salvage).toBe(150);
    expect(next.progress.hull).toBe(40);
    expect(next.progress.visited).toContain("ev");
    expect(next.history.at(-1)?.note).toBe("Strip");
  });

  it("clamps hull and can end the run", () => {
    const r = nodeRun(
      {
        id: "ev",
        type: "event",
        col: 1,
        row: 0,
        event: {
          title: "Trap",
          body: "",
          choices: [{ label: "Risk", hull: -100 }],
        },
      },
      100,
      20,
    );
    const next = applyEvent(r, "ev", 0, "now");
    expect(next.progress.hull).toBe(0);
    expect(next.progress.status).toBe("lost");
  });
});

describe("shop", () => {
  function shopRun(salvage: number): RogueliteRun {
    return nodeRun(
      {
        id: "sh",
        type: "shop",
        col: 1,
        row: 0,
        shop: {
          offers: [
            {
              cost: 60,
              option: {
                kind: "unlock",
                unit: "tank",
                unitName: "Tank",
                opens: [],
              },
            },
          ],
          restHull: 20,
          restCost: 30,
        },
      },
      salvage,
      50,
    );
  }

  it("buys an affordable offer and keeps the shop open", () => {
    const next = buyOffer(shopRun(100), "sh", 0, "now");
    expect(next.progress.salvage).toBe(40);
    expect(next.progress.unlockedUnits).toContain("tank");
    expect(next.progress.visited).not.toContain("sh"); // still open
  });

  it("rejects an unaffordable purchase", () => {
    const r = shopRun(10);
    expect(buyOffer(r, "sh", 0)).toBe(r);
  });

  it("rest trades salvage for hull", () => {
    const next = restAtShop(shopRun(100), "sh", "now");
    expect(next.progress.hull).toBe(70);
    expect(next.progress.salvage).toBe(70);
  });

  it("leaveNode resolves the shop", () => {
    const next = leaveNode(shopRun(100), "sh", "now");
    expect(next.progress.visited).toContain("sh");
  });
});

describe("deepestColumn", () => {
  it("reports the deepest visited column", () => {
    const r = resolveBattle(run(), "b1", "victory", "now");
    expect(deepestColumn(r)).toBe(1);
  });
});
