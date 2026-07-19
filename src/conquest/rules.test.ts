import { describe, expect, it } from "vitest";
import type { ConquestState, GalaxyDoc, GalaxyNode } from "./model";
import { newConquestState } from "./model";
import {
  advanceAfterBattle,
  advanceTurn,
  applyBattleOutcome,
  applyExpiry,
  attackableNodes,
  difficultyHandicap,
  difficultyTable,
  enemyRound,
  evaluateStatus,
  expansionTargets,
  factionStrength,
  frontierNodes,
  turnRng,
  winOdds,
} from "./rules";

/** rng that always wins the odds check (0 < any positive probability). */
const alwaysWin = () => 0;
/** rng that always loses the odds check (0.999 exceeds any realistic odds). */
const alwaysLose = () => 0.999;

function node(
  id: string,
  owner: string,
  kind?: GalaxyNode["kind"],
): GalaxyNode {
  return {
    id,
    name: id.toUpperCase(),
    pos: [0, 0],
    owner,
    kind,
    difficulty: 3,
    battle: { mapName: "Map" },
  };
}

/** a(p capital) - b(neutral) - c(e) - d(e capital), plus a - e(p). */
function galaxy(overrides: Partial<GalaxyDoc> = {}): GalaxyDoc {
  return {
    schemaVersion: 1,
    id: "g",
    type: "conquest-galaxy",
    title: "G",
    description: "",
    game: { shortname: "TG" },
    playerFactionId: "p",
    factions: [
      { id: "p", name: "Player", color: "#4f8cff" },
      { id: "e", name: "Enemy", color: "#e63c33", aggression: 1 },
    ],
    nodes: [
      node("a", "p", "capital"),
      node("b", "neutral"),
      node("c", "e"),
      node("d", "e", "capital"),
      node("e", "p"),
    ],
    links: [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["a", "e"],
    ],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const fresh = (g = galaxy()): ConquestState =>
  newConquestState(g, { seed: 42 }, "t0");

describe("adjacent sets", () => {
  it("attackable = non-player nodes touching player territory", () => {
    expect(attackableNodes(galaxy(), fresh()).map((n) => n.id)).toEqual(["b"]);
  });

  it("frontier = player nodes touching a faction's territory", () => {
    const g = galaxy();
    const s = fresh(g);
    s.owners.b = "e";
    expect(frontierNodes(g, s, "e").map((n) => n.id)).toEqual(["a"]);
  });
});

describe("applyBattleOutcome", () => {
  it("attack victory flips the node and ticks the turn", () => {
    const g = galaxy();
    const s = applyBattleOutcome(g, fresh(g), "b", "attack", "victory", "t1");
    expect(s.owners.b).toBe("p");
    expect(s.turn).toBe(1);
    expect(s.history).toEqual([
      { turn: 0, nodeId: "b", mode: "attack", outcome: "victory" },
    ]);
  });

  it("attack defeat flips nothing but still ticks", () => {
    const g = galaxy();
    const s = applyBattleOutcome(g, fresh(g), "b", "attack", "defeat", "t1");
    expect(s.owners.b).toBe("neutral");
    expect(s.turn).toBe(1);
  });

  it("defence victory clears that incursion; defeat forfeits the node", () => {
    const g = galaxy();
    const base = fresh(g);
    base.incursions = [{ nodeId: "e", factionId: "e", expiresOnTurn: 2 }];
    const won = applyBattleOutcome(g, base, "e", "defend", "victory", "t1");
    expect(won.incursions).toEqual([]);
    expect(won.owners.e).toBe("p");
    const lost = applyBattleOutcome(g, base, "e", "defend", "defeat", "t1");
    expect(lost.incursions).toEqual([]);
    expect(lost.owners.e).toBe("e");
  });

  it("defending one incursion leaves others standing", () => {
    const g = galaxy();
    const base = fresh(g);
    base.incursions = [
      { nodeId: "e", factionId: "e", expiresOnTurn: 2 },
      { nodeId: "a", factionId: "e", expiresOnTurn: 3 },
    ];
    const s = applyBattleOutcome(g, base, "e", "defend", "victory", "t1");
    expect(s.incursions.map((i) => i.nodeId)).toEqual(["a"]);
  });

  it("losing the capital defence loses the run", () => {
    const g = galaxy();
    const base = fresh(g);
    base.incursions = [{ nodeId: "a", factionId: "e", expiresOnTurn: 2 }];
    const s = applyBattleOutcome(g, base, "a", "defend", "defeat", "t1");
    expect(s.status).toBe("lost");
  });

  it("taking the last enemy capital wins the run", () => {
    const g = galaxy();
    const base = fresh(g);
    base.owners.b = "p";
    base.owners.c = "p";
    const s = applyBattleOutcome(g, base, "d", "attack", "victory", "t1");
    expect(s.status).toBe("won");
  });
});

describe("factionStrength / winOdds", () => {
  it("sums (1 + difficulty) over a faction's systems", () => {
    const g = galaxy();
    const s = fresh(g);
    // enemy owns c and d (difficulty 3 each) -> (1+3) * 2 = 8.
    expect(factionStrength(g, s, "e")).toBe(8);
  });

  it("is deterministic and rises with attacker strength", () => {
    const g = galaxy();
    const weak = fresh(g);
    const strong = fresh(g);
    strong.owners.b = "e"; // enemy now holds an extra system
    expect(winOdds(g, strong, "e", "a")).toBeGreaterThan(
      winOdds(g, weak, "e", "a"),
    );
  });
});

describe("expansionTargets", () => {
  it("is the non-owned nodes adjacent to a faction's territory", () => {
    const g = galaxy();
    const s = fresh(g);
    // enemy owns c,d; only neutral b touches that front.
    expect(expansionTargets(g, s, "e").map((n) => n.id)).toEqual(["b"]);
  });
});

describe("applyExpiry", () => {
  it("auto-resolves an expired incursion: node falls when the attacker wins", () => {
    const g = galaxy();
    const s = fresh(g);
    s.turn = 2;
    s.incursions = [{ nodeId: "e", factionId: "e", expiresOnTurn: 2 }];
    const after = applyExpiry(g, s, alwaysWin, "t1");
    expect(after.state.owners.e).toBe("e");
    expect(after.state.incursions).toEqual([]);
    expect(after.events).toEqual([{ factionId: "e", nodeId: "e", from: "p" }]);
  });

  it("auto-resolves an expired incursion: node holds when the defender wins", () => {
    const g = galaxy();
    const s = fresh(g);
    s.turn = 2;
    s.incursions = [{ nodeId: "e", factionId: "e", expiresOnTurn: 2 }];
    const after = applyExpiry(g, s, alwaysLose, "t1");
    expect(after.state.owners.e).toBe("p");
    expect(after.state.incursions).toEqual([]);
    expect(after.events).toEqual([]);
  });

  it("leaves an unexpired incursion alone", () => {
    const g = galaxy();
    const s = fresh(g);
    s.turn = 1;
    s.incursions = [{ nodeId: "e", factionId: "e", expiresOnTurn: 2 }];
    const after = applyExpiry(g, s, alwaysWin, "t1");
    expect(after.state.incursions).toEqual(s.incursions);
    expect(after.state.owners.e).toBe("p");
    expect(after.events).toEqual([]);
  });
});

describe("enemyRound", () => {
  it("is deterministic for a fixed rng", () => {
    const g = galaxy();
    const s = fresh(g);
    const a = enemyRound(g, s, turnRng(s), "t1");
    const b = enemyRound(g, s, turnRng(s), "t1");
    expect(a.state.owners).toEqual(b.state.owners);
    expect(a.events).toEqual(b.events);
  });

  it("captures an adjacent neutral, recording the event", () => {
    const g = galaxy();
    const s = fresh(g);
    const { state, events } = enemyRound(g, s, alwaysWin, "t1");
    expect(state.owners.b).toBe("e");
    expect(events).toEqual([{ factionId: "e", nodeId: "b", from: "neutral" }]);
  });

  it("opens an incursion (not an instant capture) against a player node", () => {
    const g = galaxy();
    const s = fresh(g);
    s.owners.b = "e"; // enemy now borders the player capital a
    const { state } = enemyRound(g, s, alwaysWin, "t1");
    expect(state.owners.a).toBe("p"); // not taken outright
    expect(state.incursions).toContainEqual({
      nodeId: "a",
      factionId: "e",
      expiresOnTurn: s.turn + 2,
    });
  });

  it("skips eliminated factions", () => {
    const g = galaxy();
    const s = fresh(g);
    s.owners.c = "p";
    s.owners.d = "p";
    const { state, events } = enemyRound(g, s, alwaysWin, "t1");
    expect(events).toEqual([]);
    expect(state.owners).toEqual(s.owners);
  });
});

describe("advanceAfterBattle", () => {
  it("runs outcome -> expiry -> enemy round in order", () => {
    const g = galaxy();
    const base = fresh(g);
    // An incursion at e expires on turn 1; attacking elsewhere ticks to turn 1,
    // so it auto-resolves and drops. A fresh round may open new incursions.
    base.incursions = [{ nodeId: "e", factionId: "e", expiresOnTurn: 1 }];
    const s = advanceAfterBattle(g, base, "b", "attack", "victory", "t1");
    expect(s.owners.b).toBe("p");
    expect(s.turn).toBe(1);
    expect(s.incursions.every((i) => i.nodeId !== "e")).toBe(true);
  });

  it("stops the pipeline on a terminal state", () => {
    const g = galaxy();
    const base = fresh(g);
    base.owners.b = "p";
    base.owners.c = "p";
    const s = advanceAfterBattle(g, base, "d", "attack", "victory", "t1");
    expect(s.status).toBe("won");
    expect(s.incursions).toEqual([]);
  });
});

describe("advanceTurn (Hold position)", () => {
  it("advances the turn and runs an enemy round without a player battle", () => {
    const g = galaxy();
    const s = fresh(g);
    const after = advanceTurn(g, s, "t1");
    expect(after.turn).toBe(1);
    expect(after.status).toBe("active");
    expect(after.lastRound).toBeDefined();
  });

  it("is a no-op on a finished run", () => {
    const g = galaxy();
    const s = { ...fresh(g), status: "won" as const };
    expect(advanceTurn(g, s, "t1")).toBe(s);
  });
});

describe("fog of war", () => {
  it("seeds revealed on a new run and grows it on capture", () => {
    const g = galaxy({ rules: { fogOfWar: true } });
    const s = fresh(g);
    // Player holds a (capital) and e; within two jumps reveals a,b,e (and c via
    // b), but not d (the enemy capital, three hops from a).
    expect(s.revealed).toBeDefined();
    expect(s.revealed).not.toContain("d");
    const after = advanceAfterBattle(g, s, "b", "attack", "victory", "t1");
    // Capturing b brings d into range; it stays revealed thereafter.
    expect(after.revealed).toContain("d");
  });

  it("leaves revealed untouched when fog is off", () => {
    const g = galaxy();
    const s = fresh(g);
    expect(s.revealed).toBeUndefined();
    const after = advanceAfterBattle(g, s, "b", "attack", "victory", "t1");
    expect(after.revealed).toBeUndefined();
  });
});

describe("difficulty tables", () => {
  it("maps difficulty to AI count and handicap", () => {
    expect([1, 2, 3, 4, 5].map(difficultyTable)).toEqual([1, 1, 2, 2, 3]);
    expect([1, 2, 3, 4, 5].map(difficultyHandicap)).toEqual([0, 0, 10, 25, 40]);
  });
});

describe("evaluateStatus", () => {
  it("stays active while any enemy capital stands", () => {
    const g = galaxy();
    expect(evaluateStatus(g, fresh(g))).toBe("active");
  });
});
