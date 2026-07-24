import { describe, expect, it } from "vitest";
import type { Side, SkirmishAi } from "@/content/bindings";
import type { SkirmishDraft } from "@/play/drafts";
import { type Participant, RANDOM_SIDE } from "@/play/participants";
import { draftToHostSeed } from "./fromSkirmish";

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
