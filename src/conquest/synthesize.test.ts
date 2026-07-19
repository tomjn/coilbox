import { describe, expect, it } from "vitest";
import type { SkirmishAi } from "../content/bindings";
import type { GalaxyDoc } from "./model";
import { newConquestState } from "./model";
import { synthesizeBattle } from "./synthesize";

const ais: SkirmishAi[] = [
  { kind: "native", shortName: "BARb", name: "BARbarIAn" },
  { kind: "lua", shortName: "STAI", name: "STAI" },
] as SkirmishAi[];

function galaxy(): GalaxyDoc {
  return {
    schemaVersion: 1,
    id: "g",
    type: "conquest-galaxy",
    title: "G",
    description: "",
    game: { shortname: "TG" },
    playerFactionId: "p",
    factions: [
      { id: "p", name: "Player", color: "#0000ff" },
      {
        id: "e",
        name: "Enemy",
        color: "#ff0000",
        aiKey: "lua:STAI",
        side: "Core",
      },
    ],
    nodes: [
      {
        id: "a",
        name: "A",
        pos: [0, 0],
        owner: "p",
        kind: "capital",
        difficulty: 1,
        battle: { mapName: "Home" },
      },
      {
        id: "b",
        name: "B",
        pos: [1, 0],
        owner: "neutral",
        difficulty: 2,
        battle: { mapName: "Border" },
      },
      {
        id: "c",
        name: "C",
        pos: [2, 0],
        owner: "e",
        kind: "capital",
        difficulty: 5,
        battle: {
          mapName: "Citadel",
          startPosType: 2,
          modOptionValues: { deathmode: "com" },
          handicap: 55,
          enemyAiCount: 2,
        },
      },
    ],
    links: [
      ["a", "b"],
      ["b", "c"],
    ],
    createdAt: "",
    updatedAt: "",
  };
}

const opts = { playerName: "You", gameName: "Test Game 1.0", ais };

describe("synthesizeBattle", () => {
  it("returns a launchable draft shaped like a skirmish", () => {
    const g = galaxy();
    const s = newConquestState(g, { seed: 1, playerSide: "Arm" }, "t0");
    const draft = synthesizeBattle(g, s, "c", "attack", opts);
    expect(draft).not.toBeNull();
    expect(draft?.gameName).toBe("Test Game 1.0");
    expect(draft?.mapName).toBe("Citadel");
    expect(draft?.startPosType).toBe(2);
    expect(draft?.modOptionValues).toEqual({ deathmode: "com" });
    const [you, ...enemies] = draft?.participants ?? [];
    expect(you.kind).toBe("you");
    expect(you.name).toBe("You");
    expect(you.side).toBe("Arm");
    expect(you.color).toEqual([0, 0, 1]);
    expect(you.allyTeam).toBe(0);
    // Author overrides: 2 AIs at handicap 55, faction AI + side + colour.
    expect(enemies).toHaveLength(2);
    for (const e of enemies) {
      expect(e.kind).toBe("ai");
      expect(e.ai?.shortName).toBe("STAI");
      expect(e.side).toBe("Core");
      expect(e.color).toEqual([1, 0, 0]);
      expect(e.allyTeam).toBe(1);
      expect(e.handicap).toBe(55);
    }
  });

  it("derives AI count and handicap from difficulty", () => {
    const g = galaxy();
    const s = newConquestState(g, { seed: 1 }, "t0");
    const draft = synthesizeBattle(g, s, "b", "attack", opts);
    // difficulty 2 -> one AI, no handicap; neutral garrison uses first AI.
    expect(draft?.participants).toHaveLength(2);
    const enemy = draft?.participants[1];
    expect(enemy?.ai?.shortName).toBe("BARb");
    expect(enemy?.side).toBe("");
    expect(enemy?.handicap).toBeUndefined();
    expect(enemy?.name).toBe("Garrison 1");
  });

  it("defends against the incursion's faction on the defended map", () => {
    const g = galaxy();
    const s = newConquestState(g, { seed: 1 }, "t0");
    s.incursions = [{ nodeId: "a", factionId: "e", expiresOnTurn: 2 }];
    const draft = synthesizeBattle(g, s, "a", "defend", opts);
    expect(draft?.mapName).toBe("Home");
    expect(draft?.participants[1]?.name).toBe("Enemy 1");
    expect(draft?.participants[1]?.side).toBe("Core");
  });

  it("returns null for an unknown node", () => {
    const g = galaxy();
    const s = newConquestState(g, { seed: 1 }, "t0");
    expect(synthesizeBattle(g, s, "zz", "attack", opts)).toBeNull();
  });

  it("never fields a denied AI even when a faction is baked to one", () => {
    const g = galaxy();
    // An old galaxy whose enemy faction was assigned the do-nothing Sandbox bot.
    g.factions[1].aiKey = "lua:Sandbox";
    const withSandbox: SkirmishAi[] = [
      { kind: "lua", shortName: "Sandbox", name: "Sandbox" },
      { kind: "native", shortName: "BARb", name: "BARbarIAn" },
    ] as SkirmishAi[];
    const s = newConquestState(g, { seed: 1 }, "t0");
    const draft = synthesizeBattle(g, s, "c", "attack", {
      ...opts,
      ais: withSandbox,
    });
    for (const e of draft?.participants.slice(1) ?? []) {
      expect(e.ai?.shortName).toBe("BARb");
    }
  });

  it("fields a chicken AI on a neutral garrison and merges neutral mod options", () => {
    const g = galaxy();
    const withChickens: SkirmishAi[] = [
      { kind: "native", shortName: "BARb", name: "BARbarIAn" },
      { kind: "lua", shortName: "ChickensAI", name: "Chickens" },
    ] as SkirmishAi[];
    const s = newConquestState(g, { seed: 1 }, "t0");
    const draft = synthesizeBattle(g, s, "b", "attack", {
      ...opts,
      ais: withChickens,
      aiConfig: { neutralModOptions: { chicken_difficulty: "hard" } },
    });
    expect(draft?.participants[1]?.ai?.shortName).toBe("ChickensAI");
    expect(draft?.modOptionValues).toEqual({ chicken_difficulty: "hard" });
  });

  it("lets an authored node battle override the neutral chicken options", () => {
    const g = galaxy();
    // Node "b" is neutral; author pins its own mod options on the battle spec.
    g.nodes[1].battle.modOptionValues = { chicken_difficulty: "easy" };
    const withChickens: SkirmishAi[] = [
      { kind: "native", shortName: "BARb", name: "BARbarIAn" },
      { kind: "lua", shortName: "ChickensAI", name: "Chickens" },
    ] as SkirmishAi[];
    const s = newConquestState(g, { seed: 1 }, "t0");
    const draft = synthesizeBattle(g, s, "b", "attack", {
      ...opts,
      ais: withChickens,
      aiConfig: { neutralModOptions: { chicken_difficulty: "hard" } },
    });
    expect(draft?.modOptionValues).toEqual({ chicken_difficulty: "easy" });
  });
});
