import { describe, expect, it } from "vitest";
import type { ConquestState, GalaxyDoc, GalaxyNode } from "./model";
import { newConquestState } from "./model";
import {
  advanceAfterBattle,
  applyBattleOutcome,
  applyExpiry,
  attackableNodes,
  difficultyHandicap,
  difficultyTable,
  enemyPhase,
  evaluateStatus,
  frontierNodes,
  turnRng,
} from "./rules";

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

  it("defence victory clears the incursion; defeat forfeits the node", () => {
    const g = galaxy();
    const base = fresh(g);
    base.incursion = { nodeId: "e", factionId: "e", expiresOnTurn: 2 };
    const won = applyBattleOutcome(g, base, "e", "defend", "victory", "t1");
    expect(won.incursion).toBeUndefined();
    expect(won.owners.e).toBe("p");
    const lost = applyBattleOutcome(g, base, "e", "defend", "defeat", "t1");
    expect(lost.incursion).toBeUndefined();
    expect(lost.owners.e).toBe("e");
  });

  it("losing the capital defence loses the run", () => {
    const g = galaxy();
    const base = fresh(g);
    base.incursion = { nodeId: "a", factionId: "e", expiresOnTurn: 2 };
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

describe("applyExpiry", () => {
  it("forfeits the node once grace runs out", () => {
    const g = galaxy();
    const s = fresh(g);
    s.turn = 2;
    s.incursion = { nodeId: "e", factionId: "e", expiresOnTurn: 2 };
    const after = applyExpiry(g, s, "t1");
    expect(after.owners.e).toBe("e");
    expect(after.incursion).toBeUndefined();
  });

  it("leaves an unexpired incursion alone", () => {
    const g = galaxy();
    const s = fresh(g);
    s.turn = 1;
    s.incursion = { nodeId: "e", factionId: "e", expiresOnTurn: 2 };
    expect(applyExpiry(g, s, "t1")).toBe(s);
  });
});

describe("enemyPhase", () => {
  it("is deterministic for a fixed seed", () => {
    const g = galaxy();
    const s = fresh(g);
    s.owners.b = "e"; // bring the enemy front adjacent to player territory
    const a = enemyPhase(g, s, turnRng(s), "t1");
    const b = enemyPhase(g, s, turnRng(s), "t1");
    expect(a.incursion).toEqual(b.incursion);
    // aggression 1 always rolls an incursion when a frontier exists.
    expect(a.incursion?.factionId).toBe("e");
    expect(a.incursion?.expiresOnTurn).toBe(s.turn + 2);
  });

  it("skips while an incursion is already active", () => {
    const g = galaxy();
    const s = fresh(g);
    s.incursion = { nodeId: "e", factionId: "e", expiresOnTurn: 5 };
    expect(enemyPhase(g, s, turnRng(s), "t1")).toBe(s);
  });

  it("never rolls for dead factions", () => {
    const g = galaxy();
    const s = fresh(g);
    s.owners.c = "p";
    s.owners.d = "p";
    expect(enemyPhase(g, s, turnRng(s), "t1").incursion).toBeUndefined();
  });
});

describe("advanceAfterBattle", () => {
  it("runs outcome -> expiry -> enemy phase in order", () => {
    const g = galaxy();
    const base = fresh(g);
    // An incursion at e expires on turn 1; attacking elsewhere on turn 0
    // ticks to turn 1, so the node falls, then a new incursion may open.
    base.incursion = { nodeId: "e", factionId: "e", expiresOnTurn: 1 };
    const s = advanceAfterBattle(g, base, "b", "attack", "victory", "t1");
    expect(s.owners.b).toBe("p");
    expect(s.owners.e).toBe("e");
    expect(s.turn).toBe(1);
  });

  it("stops the pipeline on a terminal state", () => {
    const g = galaxy();
    const base = fresh(g);
    base.owners.b = "p";
    base.owners.c = "p";
    const s = advanceAfterBattle(g, base, "d", "attack", "victory", "t1");
    expect(s.status).toBe("won");
    expect(s.incursion).toBeUndefined();
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
