import { describe, expect, it } from "vitest";
import type { Side, SkirmishAi } from "@/content/bindings";
import type { SkirmishDraft } from "@/play/drafts";
import { type Participant, RANDOM_SIDE } from "@/play/participants";
import { reconcileParticipantAis } from "@/play/reconcileAi";
import { draftToHostSeed, hostSeedAiNotice } from "./fromSkirmish";

const SIDES: Side[] = [{ name: "Armada" }, { name: "Cortex" }];

// Sandbox is a built-in denied (do-nothing) AI (see `conquest/ai.ts`), so a
// remap falls through it to SimpleAI, the next non-denied entry.
const AIS: Pick<SkirmishAi, "shortName">[] = [
  { shortName: "BARb" },
  { shortName: "Sandbox" },
  { shortName: "SimpleAI" },
];

// Live-tested scenario (issue #373): a game whose AI list doesn't include the
// preset's desired AI at all, e.g. SplinterFaction's own Sandbox/SimpleAI/
// SurvivalAI, none of which is "BARb" or "DAI".
const GAME_AIS: Pick<SkirmishAi, "shortName">[] = [
  { shortName: "Sandbox" },
  { shortName: "SimpleAI" },
  { shortName: "SurvivalAI" },
];

const you = (p: Partial<Participant> = {}): Participant => ({
  id: "you",
  kind: "you",
  name: "You",
  side: "Cortex",
  color: [1, 0, 0],
  allyTeam: 0,
  spectator: false,
  ...p,
});

const ai = (p: Partial<Participant> = {}): Participant => ({
  id: "ai1",
  kind: "ai",
  name: "AI 1",
  side: "Armada",
  color: [0, 0, 1],
  allyTeam: 1,
  spectator: false,
  ai: { kind: "native", shortName: "BARb", name: "BARbarian" },
  ...p,
});

function mkDraft(p: Partial<SkirmishDraft> = {}): SkirmishDraft {
  return {
    participants: [you(), ai()],
    gameName: "Beyond All Reason test-1234",
    mapName: "Comet Catcher Remake 1.8",
    startPosType: 1,
    modOptionValues: {},
    ...p,
  };
}

describe("draftToHostSeed", () => {
  it("maps the you participant to the host seat and each ai to a bot", () => {
    const seed = draftToHostSeed({ draft: mkDraft(), sides: SIDES, ais: AIS });

    expect(seed.self).toEqual({
      side: 1, // Cortex
      colorHex: "#ff0000",
      teamId: 0,
      ally: 0,
      spectator: false,
    });
    expect(seed.bots).toHaveLength(1);
    expect(seed.bots[0]).toEqual({
      name: "AI 1",
      aiDll: "BARb",
      side: 0, // Armada
      colorHex: "#0000ff",
      teamId: 1,
      ally: 1,
      handicap: 0,
    });
    expect(seed.openSlots).toBe(0);
    expect(seed.unresolvedAiCount).toBe(0);
  });

  it("carries mod options and start-pos type as script tags", () => {
    const seed = draftToHostSeed({
      draft: mkDraft({
        startPosType: 2,
        modOptionValues: { maxunits: "2000" },
      }),
      sides: SIDES,
      ais: AIS,
    });
    expect(seed.scriptTags).toEqual({
      "game/startpostype": "2",
      "game/modoptions/maxunits": "2000",
    });
  });

  it("carries disabled units as restrict tags, dropping advantage/income (no lobby equivalent)", () => {
    const seed = draftToHostSeed({
      draft: mkDraft({
        restrictions: {
          disabledUnits: ["armcom"],
          advantage: 0.1,
          incomeMultiplier: 0.2,
        },
      }),
      sides: SIDES,
      ais: AIS,
    });
    expect(seed.scriptTags["game/restrict/numrestrictions"]).toBe("1");
    expect(seed.scriptTags["game/restrict/unit0"]).toBe("armcom");
    expect(seed.scriptTags["game/restrict/limit0"]).toBe("0");
  });

  it("resolves RANDOM_SIDE via the injected roll function", () => {
    const seed = draftToHostSeed({
      draft: mkDraft({
        participants: [you(), ai({ side: RANDOM_SIDE })],
      }),
      sides: SIDES,
      ais: AIS,
      roll: () => 0, // picks sides[0], Armada
    });
    expect(seed.bots[0].side).toBe(0);
  });

  it("skips an ai participant with no ai assigned when the game has no usable fallback", () => {
    const seed = draftToHostSeed({
      draft: mkDraft({
        participants: [you(), ai({ ai: undefined })],
      }),
      sides: SIDES,
      ais: [{ shortName: "Sandbox" }], // only a denied (do-nothing) AI available
    });
    expect(seed.bots).toHaveLength(0);
    expect(seed.unresolvedAiCount).toBe(1);
    expect(seed.openSlots).toBe(0);
  });

  it("resolves a fallback AI when no desired AI is assigned", () => {
    const seed = draftToHostSeed({
      draft: mkDraft({ participants: [you(), ai({ ai: undefined })] }),
      sides: SIDES,
      ais: GAME_AIS, // no desired AI, but a usable fallback (SimpleAI) exists
    });
    expect(seed.bots).toHaveLength(1);
    expect(seed.bots[0].aiDll).toBe("SimpleAI");
    expect(seed.unresolvedAiCount).toBe(0);
  });

  it("remaps a bot whose desired AI isn't offered by the hosted game to a sensible default", () => {
    const seed = draftToHostSeed({
      draft: mkDraft({
        participants: [you(), ai({ ai: { kind: "native", shortName: "DAI" } })],
      }),
      sides: SIDES,
      ais: GAME_AIS, // "DAI" isn't in this game's list, falls back to SimpleAI
    });
    expect(seed.bots).toHaveLength(1);
    expect(seed.bots[0].aiDll).toBe("SimpleAI");
  });

  it("reports a substitution when a bot's desired AI is remapped (issue #501)", () => {
    const seed = draftToHostSeed({
      draft: mkDraft({
        participants: [you(), ai({ ai: { kind: "native", shortName: "DAI" } })],
      }),
      sides: SIDES,
      ais: GAME_AIS, // "DAI" absent, remapped to SimpleAI
    });
    expect(seed.substitutions).toEqual([{ from: "DAI", to: "SimpleAI" }]);
  });

  it("reports no substitution when the desired AI is kept", () => {
    const seed = draftToHostSeed({
      draft: mkDraft({
        participants: [
          you(),
          ai({ ai: { kind: "native", shortName: "SurvivalAI" } }),
        ],
      }),
      sides: SIDES,
      ais: GAME_AIS,
    });
    expect(seed.substitutions).toEqual([]);
  });

  it("keeps a bot's AI when it is present in the hosted game's AI list, even alongside other games' AIs", () => {
    const seed = draftToHostSeed({
      draft: mkDraft({
        participants: [
          you(),
          ai({ ai: { kind: "native", shortName: "SurvivalAI" } }),
        ],
      }),
      sides: SIDES,
      ais: GAME_AIS,
    });
    expect(seed.bots).toHaveLength(1);
    expect(seed.bots[0].aiDll).toBe("SurvivalAI");
  });

  it("reports unresolved when the hosted game offers no usable AI at all", () => {
    const seed = draftToHostSeed({
      draft: mkDraft({
        participants: [you(), ai({ ai: { kind: "native", shortName: "DAI" } })],
      }),
      sides: SIDES,
      ais: [{ shortName: "Sandbox" }, { shortName: "NullAI" }], // both denied
    });
    expect(seed.bots).toHaveLength(0);
    expect(seed.unresolvedAiCount).toBe(1);
  });

  it("hosts as a spectator when the you participant is spectating", () => {
    const seed = draftToHostSeed({
      draft: mkDraft({ participants: [you({ spectator: true }), ai()] }),
      sides: SIDES,
      ais: AIS,
    });
    expect(seed.self.spectator).toBe(true);
  });

  // The exact live bug (#531): a SplinterFaction preset whose bot wants a native
  // the game doesn't offer must remap to one of the game's OWN AIs, never to a
  // different native (e.g. BARb) the game itself rejects.
  it("remaps to a member of the hosted game's own AI list, never a native it omits (#531)", () => {
    const SPLINTER_AIS: Pick<SkirmishAi, "shortName">[] = [
      { shortName: "Sandbox" },
      { shortName: "SimpleAI" },
    ];
    const seed = draftToHostSeed({
      draft: mkDraft({
        participants: [
          you(),
          ai({ ai: { kind: "native", shortName: "BARb" } }),
        ],
      }),
      sides: SIDES,
      ais: SPLINTER_AIS,
    });
    expect(seed.bots[0].aiDll).toBe("SimpleAI");
    expect(SPLINTER_AIS.map((a) => a.shortName)).toContain(seed.bots[0].aiDll);
  });

  // Singleplayer (`reconcileParticipantAis`) and hosting (`draftToHostSeed`) share
  // `reconcileAi`, so against the same game AI list they must pick the same AI.
  it("agrees with the singleplayer reconciliation on the same game's AI list (#531)", () => {
    const SPLINTER_AIS: Pick<SkirmishAi, "shortName" | "kind" | "name">[] = [
      { shortName: "Sandbox", kind: "lua", name: "Sandbox" },
      { shortName: "SimpleAI", kind: "lua", name: "SimpleAI" },
    ];
    const participants = [
      you(),
      ai({ ai: { kind: "native", shortName: "BARb", name: "BARbarian" } }),
    ];
    const sp = reconcileParticipantAis(participants, SPLINTER_AIS, true);
    const spBot = sp.participants.find((p) => p.kind === "ai");
    const seed = draftToHostSeed({
      draft: mkDraft({ participants }),
      sides: SIDES,
      ais: SPLINTER_AIS,
    });
    expect(seed.bots[0].aiDll).toBe("SimpleAI");
    expect(seed.bots[0].aiDll).toBe(spBot?.ai?.shortName);
  });

  it("falls back to side index 0 for an unresolvable side name", () => {
    const seed = draftToHostSeed({
      draft: mkDraft({
        participants: [you(), ai({ side: "NotARealSide" })],
      }),
      sides: SIDES,
      ais: AIS,
    });
    expect(seed.bots[0].side).toBe(0);
  });

  it("treats an unexpected non-ai, non-primary-you participant as a human, dropping it into an open slot rather than a bot (defensive: only a hand-edited/imported preset produces this)", () => {
    const malformed = {
      ...ai({ id: "second-you" }),
      kind: "you" as const,
    };
    const seed = draftToHostSeed({
      draft: mkDraft({ participants: [you(), malformed, ai()] }),
      sides: SIDES,
      ais: AIS,
    });
    // Only the first "you" becomes the host seat. The second is dropped, not
    // added as a bot, and the real ai participant is still added.
    expect(seed.bots).toHaveLength(1);
    expect(seed.bots[0].aiDll).toBe("BARb");
    expect(seed.openSlots).toBe(1);
  });
});

describe("hostSeedAiNotice", () => {
  it("returns undefined when nothing was substituted or dropped", () => {
    expect(
      hostSeedAiNotice({ substitutions: [], unresolvedAiCount: 0 }),
    ).toBeUndefined();
  });

  it("summarises a substitution (#501)", () => {
    expect(
      hostSeedAiNotice({
        substitutions: [{ from: "BARb", to: "SimpleAI" }],
        unresolvedAiCount: 0,
      }),
    ).toBe("This game doesn't offer BARb. Using SimpleAI instead.");
  });

  it("reports a single bot dropped for having no available AI", () => {
    expect(hostSeedAiNotice({ substitutions: [], unresolvedAiCount: 1 })).toBe(
      "One bot had no AI available in this game and was skipped.",
    );
  });

  it("reports several dropped bots", () => {
    expect(hostSeedAiNotice({ substitutions: [], unresolvedAiCount: 3 })).toBe(
      "3 bots had no AI available in this game and were skipped.",
    );
  });

  it("combines a substitution and a dropped bot", () => {
    expect(
      hostSeedAiNotice({
        substitutions: [{ from: "BARb", to: "SimpleAI" }],
        unresolvedAiCount: 1,
      }),
    ).toBe(
      "This game doesn't offer BARb. Using SimpleAI instead. One bot had no AI available in this game and was skipped.",
    );
  });
});
