import { describe, expect, it } from "vitest";
import type { DemoInfo, SkirmishAi } from "./bindings";
import { demoInfoToSkirmishDraft } from "./demoToSkirmish";

const ais: SkirmishAi[] = [
  { shortName: "Sandbox", kind: "native", name: "Sandbox" }, // denied test bot
  { shortName: "BARb", kind: "lua", name: "BARb" },
  { shortName: "E323AI", kind: "native", name: "E323AI" },
];

function demoInfo(overrides: Partial<DemoInfo> = {}): DemoInfo {
  return {
    engineVersion: "105.1.1",
    startTimeMs: 1_700_000_000_000,
    durationSec: 900,
    wallclockSec: 950,
    mapName: "Comet Catcher",
    gameType: "Beyond All Reason test-30018",
    startPosType: 2,
    winningAllyTeams: [0],
    winnersKnown: true,
    numAllyTeams: 2,
    allyTeams: [],
    players: [
      {
        name: "Alice",
        allyTeam: 0,
        side: "Armada",
        rgbColor: [0.9, 0.1, 0.1],
        spectator: false,
        won: true,
      },
      {
        name: "Bob",
        allyTeam: 1,
        side: "Cortex",
        rgbColor: [0.1, 0.1, 0.9],
        spectator: false,
        won: false,
      },
      { name: "Referee", spectator: true },
    ],
    modOptions: { zombies: "disabled" },
    ...overrides,
  };
}

const sides = [{ name: "Armada" }, { name: "Cortex" }];

describe("demoInfoToSkirmishDraft", () => {
  it("converts every seated player into an AI opponent, dropping spectators", () => {
    const draft = demoInfoToSkirmishDraft({ info: demoInfo(), ais, sides });
    expect(draft).not.toBeNull();
    expect(draft?.participants).toHaveLength(3); // you + Alice + Bob
    const [you, alice, bob] = draft?.participants ?? [];
    expect(you?.kind).toBe("you");
    expect(you?.spectator).toBe(true);
    expect(alice).toMatchObject({
      kind: "ai",
      name: "Alice",
      side: "Armada",
      color: [0.9, 0.1, 0.1],
      allyTeam: 0,
    });
    expect(bob).toMatchObject({
      kind: "ai",
      name: "Bob",
      side: "Cortex",
      allyTeam: 1,
    });
  });

  it("keeps the map, game, start-pos type and mod options", () => {
    const draft = demoInfoToSkirmishDraft({ info: demoInfo(), ais, sides });
    expect(draft?.mapName).toBe("Comet Catcher");
    expect(draft?.gameName).toBe("Beyond All Reason test-30018");
    expect(draft?.startPosType).toBe(2);
    expect(draft?.modOptionValues).toEqual({ zombies: "disabled" });
  });

  it("defaults every converted slot to the game's standard AI", () => {
    const draft = demoInfoToSkirmishDraft({ info: demoInfo(), ais, sides });
    for (const p of draft?.participants.filter((p) => p.kind === "ai") ?? []) {
      expect(p.ai?.shortName).toBe("E323AI");
    }
  });

  it("uses the caller-supplied AI over the fallback when given", () => {
    const draft = demoInfoToSkirmishDraft({
      info: demoInfo(),
      ais,
      sides,
      ai: { kind: "native", shortName: "E323AI", name: "E323AI" },
    });
    for (const p of draft?.participants.filter((p) => p.kind === "ai") ?? []) {
      expect(p.ai?.shortName).toBe("E323AI");
    }
  });

  it("rolls a random side for a recorded faction not in the target game", () => {
    const draft = demoInfoToSkirmishDraft({
      info: demoInfo({
        players: [
          {
            name: "Alice",
            allyTeam: 0,
            side: "Legion", // not in `sides`
            spectator: false,
          },
        ],
      }),
      ais,
      sides,
    });
    expect(draft?.participants[1]?.side).toBe("__random__");
  });

  it("keeps an unvalidated side as-is when the target sides aren't known yet", () => {
    const draft = demoInfoToSkirmishDraft({
      info: demoInfo({
        players: [
          { name: "Alice", allyTeam: 0, side: "Legion", spectator: false },
        ],
      }),
      ais,
      sides: [],
    });
    expect(draft?.participants[1]?.side).toBe("Legion");
  });

  it("returns null for a spectator-only or empty roster instead of crashing", () => {
    expect(
      demoInfoToSkirmishDraft({
        info: demoInfo({ players: [{ name: "Referee", spectator: true }] }),
        ais,
        sides,
      }),
    ).toBeNull();
    expect(
      demoInfoToSkirmishDraft({ info: demoInfo({ players: [] }), ais, sides }),
    ).toBeNull();
  });

  it("falls back to a placeholder name for a malformed (nameless) player", () => {
    const draft = demoInfoToSkirmishDraft({
      info: demoInfo({
        players: [{ name: "", allyTeam: 0, spectator: false }],
      }),
      ais,
      sides,
    });
    expect(draft?.participants[1]?.name).toBe("Player 1");
  });
});
