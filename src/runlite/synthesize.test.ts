import { describe, expect, it } from "vitest";
import type { SkirmishAi } from "../content/bindings";
import type { RogueliteRun, RunNode } from "./model";
import { synthesizeEncounter } from "./synthesize";

const AIS: SkirmishAi[] = [
  { kind: "native", shortName: "BARb", name: "BARb", version: "1" },
];

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
      side: "ARM",
      skin: "galaxy",
    },
    nodes: [],
    edges: [],
    progress: {
      currentNodeId: "start",
      visited: [],
      hull: 100,
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

function battleNode(over: Partial<RunNode["battle"]> = {}): RunNode {
  return {
    id: "b1",
    type: "battle",
    col: 1,
    row: 0,
    battle: {
      mapName: "Comet Catcher",
      enemyAiCount: 3,
      handicap: 20,
      techTier: 2,
      ...over,
    },
  };
}

describe("synthesizeEncounter", () => {
  it("builds you (ally 0) versus N enemy AIs (ally 1)", () => {
    const draft = synthesizeEncounter(run(), battleNode(), {
      playerName: "You",
      gameName: "Balanced Annihilation test",
      ais: AIS,
    });
    expect(draft).not.toBeNull();
    const parts = draft?.participants ?? [];
    expect(parts[0]).toMatchObject({ kind: "you", allyTeam: 0, side: "ARM" });
    const enemies = parts.filter((p) => p.kind === "ai");
    expect(enemies).toHaveLength(3);
    for (const e of enemies) {
      expect(e.allyTeam).toBe(1);
      expect(e.handicap).toBe(20);
      expect(e.ai?.shortName).toBe("BARb");
    }
    expect(draft?.mapName).toBe("Comet Catcher");
  });

  it("omits handicap when zero", () => {
    const draft = synthesizeEncounter(run(), battleNode({ handicap: 0 }), {
      playerName: "You",
      gameName: "g",
      ais: AIS,
    });
    for (const e of (draft?.participants ?? []).filter(
      (p) => p.kind === "ai",
    )) {
      expect(e.handicap).toBeUndefined();
    }
  });

  it("returns null for a non-battle node", () => {
    const reward: RunNode = { id: "r", type: "reward", col: 1, row: 0 };
    expect(
      synthesizeEncounter(run(), reward, {
        playerName: "You",
        gameName: "g",
        ais: AIS,
      }),
    ).toBeNull();
  });
});
