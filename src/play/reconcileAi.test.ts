import { describe, expect, it } from "vitest";
import type { SkirmishAi } from "@/content/bindings";
import type { Participant } from "./participants";
import { reconcileParticipantAis } from "./reconcileAi";

const skAi = (
  shortName: string,
  kind: "native" | "lua" = "lua",
): SkirmishAi => ({ shortName, kind, name: shortName });

// A game version's list lacking "DAI" but keeping SimpleAI (Sandbox denied).
const GAME_AIS = [skAi("Sandbox"), skAi("SimpleAI"), skAi("SurvivalAI")];

const you = (p: Partial<Participant> = {}): Participant => ({
  id: "you",
  kind: "you",
  name: "You",
  side: "",
  color: [1, 0, 0],
  allyTeam: 0,
  spectator: false,
  ...p,
});

const bot = (id: string, ai?: Participant["ai"]): Participant => ({
  id,
  kind: "ai",
  name: id,
  ai,
  side: "",
  color: [0, 0, 1],
  allyTeam: 1,
  spectator: false,
});

describe("reconcileParticipantAis", () => {
  it("keeps an AI that is available in this game (no flag, no change)", () => {
    const parts = [you(), bot("a", { kind: "lua", shortName: "SurvivalAI" })];
    const res = reconcileParticipantAis(parts, GAME_AIS, true);
    expect(res.changed).toBe(false);
    expect(res.substitutions).toEqual([]);
    expect(res.participants).toBe(parts);
  });

  it("remaps an unavailable AI and reports the substitution", () => {
    const parts = [you(), bot("a", { kind: "native", shortName: "DAI" })];
    const res = reconcileParticipantAis(parts, GAME_AIS, true);
    expect(res.changed).toBe(true);
    expect(res.participants[1].ai?.shortName).toBe("SimpleAI");
    expect(res.substitutions).toEqual([{ from: "DAI", to: "SimpleAI" }]);
  });

  it("produces one substitution per slot for many unavailable AIs (caller dedupes)", () => {
    const parts = [
      you(),
      bot("a", { kind: "native", shortName: "DAI" }),
      bot("b", { kind: "native", shortName: "DAI" }),
      bot("c", { kind: "native", shortName: "DAI" }),
    ];
    const res = reconcileParticipantAis(parts, GAME_AIS, true);
    expect(res.substitutions).toHaveLength(3);
    expect(res.substitutions.every((s) => s.to === "SimpleAI")).toBe(true);
    for (const p of res.participants.slice(1))
      expect(p.ai?.shortName).toBe("SimpleAI");
  });

  it("leaves a genuinely empty AI slot for the fill pass (never counts it)", () => {
    const parts = [you(), bot("a", undefined)];
    const res = reconcileParticipantAis(parts, GAME_AIS, true);
    expect(res.changed).toBe(false);
    expect(res.participants[1].ai).toBeUndefined();
    expect(res.substitutions).toEqual([]);
  });

  it("does nothing with no AI data (degrades, keeps picks intact)", () => {
    const parts = [you(), bot("a", { kind: "native", shortName: "DAI" })];
    const res = reconcileParticipantAis(parts, [], true);
    expect(res.changed).toBe(false);
    expect(res.participants).toBe(parts);
    expect(res.participants[1].ai?.shortName).toBe("DAI");
  });

  it("counts an unavailable AI as unresolved when the game has no usable AI", () => {
    const parts = [you(), bot("a", { kind: "native", shortName: "DAI" })];
    const res = reconcileParticipantAis(
      parts,
      [skAi("Sandbox"), skAi("NullAI", "native")],
      true,
    );
    expect(res.unresolvedCount).toBe(1);
    expect(res.changed).toBe(false);
    expect(res.participants[1].ai?.shortName).toBe("DAI");
  });

  it("does nothing until the list is ready (the pre-game natives list)", () => {
    // Before a game is selected the AI list is the engine's natives, which lack
    // the game's Lua AIs. Reconciling then would swap a valid pick for a native.
    const natives = [skAi("BARb", "native"), skAi("NullAI", "native")];
    const parts = [you(), bot("a", { kind: "lua", shortName: "SimpleAI" })];
    const res = reconcileParticipantAis(parts, natives, false);
    expect(res.changed).toBe(false);
    expect(res.participants).toBe(parts);
    expect(res.participants[1].ai?.shortName).toBe("SimpleAI");
    expect(res.substitutions).toEqual([]);
  });

  it("handles a differing cross-version list (matches by shortName)", () => {
    // Same game name, newer build dropped SurvivalAI in favour of BARb.
    const newer = [skAi("Sandbox"), skAi("SimpleAI"), skAi("BARb", "native")];
    const parts = [
      you(),
      bot("a", { kind: "native", shortName: "SurvivalAI" }),
    ];
    const res = reconcileParticipantAis(parts, newer, true);
    expect(res.changed).toBe(true);
    expect(res.substitutions).toEqual([{ from: "SurvivalAI", to: "SimpleAI" }]);
  });
});
