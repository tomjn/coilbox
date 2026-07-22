import { describe, expect, it } from "vitest";
import { isBlackHex } from "@/lib/teamColor";
import type { BattleConfig } from "./bindings";
import {
  aiByline,
  applyRestrictions,
  initialParticipants,
  makeAiParticipant,
  PALETTE,
  type Participant,
  RANDOM_SIDE,
  resolveRandomSides,
  rgbToHex,
  sanitizeColors,
  toBattleConfig,
} from "./participants";

const you = (color: Participant["color"]): Participant => ({
  id: "you",
  kind: "you",
  name: "You",
  side: "",
  color,
  allyTeam: 0,
  spectator: false,
});

const ai = (id: string, color: Participant["color"]): Participant => ({
  id,
  kind: "ai",
  name: id,
  side: "",
  color,
  allyTeam: 1,
  spectator: false,
});

describe("makeAiParticipant colours", () => {
  it("gives each added AI a distinct, non-black colour as participants accumulate", () => {
    let ps = initialParticipants();
    const seen = new Set(ps.map((p) => rgbToHex(p.color)));
    for (let i = 0; i < 8; i++) {
      const next = makeAiParticipant(ps);
      const hex = rgbToHex(next.color);
      expect(isBlackHex(hex)).toBe(false);
      expect(seen.has(hex)).toBe(false);
      seen.add(hex);
      ps = [...ps, next];
    }
  });
});

describe("makeAiParticipant default side", () => {
  it("defaults a newly added AI to Random", () => {
    const p = makeAiParticipant(initialParticipants());
    expect(p.side).toBe(RANDOM_SIDE);
  });

  it("honours an explicit side when given one", () => {
    const p = makeAiParticipant(initialParticipants(), "Armada");
    expect(p.side).toBe("Armada");
  });
});

describe("resolveRandomSides", () => {
  const sides = [{ name: "Armada" }, { name: "Cortex" }, { name: "Legion" }];
  const randomAi = (id: string): Participant => ({
    ...ai(id, PALETTE[1]),
    side: RANDOM_SIDE,
  });

  it("resolves a Random row to a concrete side via the injected roll", () => {
    // roll 0.5 * 3 = 1.5 -> floor 1 -> the second side.
    const out = resolveRandomSides([randomAi("a")], sides, () => 0.5);
    expect(out[0].side).toBe("Cortex");
  });

  it("rolls each Random AI independently", () => {
    const rolls = [0, 0.99]; // -> Armada, then Legion
    let i = 0;
    const out = resolveRandomSides(
      [randomAi("a"), randomAi("b")],
      sides,
      () => rolls[i++],
    );
    expect(out.map((p) => p.side)).toEqual(["Armada", "Legion"]);
  });

  it("resolves to the only side when the game has a single side", () => {
    const out = resolveRandomSides(
      [randomAi("a")],
      [{ name: "Solo" }],
      () => 0.9,
    );
    expect(out[0].side).toBe("Solo");
  });

  it("falls back to engine default when the sides list is empty", () => {
    const out = resolveRandomSides([randomAi("a")], []);
    expect(out[0].side).toBe("");
  });

  it("clamps a roll of exactly 1 to the last side", () => {
    const out = resolveRandomSides([randomAi("a")], sides, () => 1);
    expect(out[0].side).toBe("Legion");
  });

  it("leaves concrete and engine-default rows untouched, returning the same reference", () => {
    const ps = [you(PALETTE[0]), { ...ai("a", PALETTE[1]), side: "Armada" }];
    expect(resolveRandomSides(ps, sides)).toBe(ps);
  });
});

describe("sanitizeColors", () => {
  it("heals a black 'you' row by seeding from the remembered colour", () => {
    const ps = [you([0, 0, 0]), ai("AI 1", PALETTE[1])];
    const out = sanitizeColors(ps, "#ff0000");
    expect(rgbToHex(out[0].color)).toBe("#ff0000");
  });

  it("picks a non-black colour for 'you' when there is no remembered colour", () => {
    const ps = [you([0, 0, 0]), ai("AI 1", PALETTE[1])];
    const out = sanitizeColors(ps, "");
    expect(isBlackHex(rgbToHex(out[0].color))).toBe(false);
  });

  it("keeps a valid 'you' colour and only heals black opponents", () => {
    const green = PALETTE[2];
    const ps = [you(green), ai("AI 1", [0, 0, 0])];
    const out = sanitizeColors(ps, "#ff0000");
    expect(rgbToHex(out[0].color)).toBe(rgbToHex(green)); // untouched
    expect(isBlackHex(rgbToHex(out[1].color))).toBe(false); // healed
  });

  it("returns the same array reference when nothing needs healing", () => {
    const ps = initialParticipants();
    expect(sanitizeColors(ps, "")).toBe(ps);
  });
});

describe("toBattleConfig AI blocks", () => {
  const base = {
    mapName: "All That Glitters v2.2.3",
    gameType: "SplinterFaction 0.1.75",
    startPosType: 0,
    modOptions: {},
  };

  const withAi = (kind: "native" | "lua", shortName: string) =>
    toBattleConfig({
      ...base,
      participants: [
        you(PALETTE[0]),
        {
          ...ai("bot1", PALETTE[1]),
          ai: { kind, shortName, name: shortName },
        },
      ],
    });

  it("emits a game Lua AI as an [AI] block the engine parses, not a team key", () => {
    const cfg = withAi("lua", "SimpleAI");
    // The engine only reads [GAME]\AIn sections; a `LuaAI` team key is ignored,
    // leaving the team with no controller at all.
    expect(cfg.ais).toEqual([
      {
        name: "bot1",
        shortName: "SimpleAI",
        version: "<game>",
        team: 1,
        host: 0,
      },
    ]);
  });

  it("emits a native AI as an [AI] block with no version", () => {
    const cfg = withAi("native", "NullAI");
    expect(cfg.ais).toEqual([
      {
        name: "bot1",
        shortName: "NullAI",
        version: undefined,
        team: 1,
        host: 0,
      },
    ]);
  });
});

describe("applyRestrictions", () => {
  const cfg = (): BattleConfig =>
    toBattleConfig({
      participants: [you(PALETTE[0]), ai("a", PALETTE[1])],
      mapName: "m",
      gameType: "g",
      startPosType: 0,
      modOptions: {},
    });

  it("adds advantage and income onto the player team (team 0)", () => {
    const out = applyRestrictions(cfg(), {
      advantage: 0.1,
      incomeMultiplier: 0.2,
    });
    expect(out.teams[0].advantage).toBeCloseTo(0.1, 5);
    expect(out.teams[0].incomeMultiplier).toBeCloseTo(1.2, 5);
  });

  it("leaves the config untouched when there are no restrictions", () => {
    const out = applyRestrictions(cfg(), undefined);
    expect(out.teams[0].advantage).toBeUndefined();
    expect(out.teams[0].incomeMultiplier).toBeUndefined();
  });

  it("is a no-op on a team-less config", () => {
    const empty = { ...cfg(), teams: [] };
    expect(() => applyRestrictions(empty, { advantage: 0.5 })).not.toThrow();
  });
});

describe("aiByline", () => {
  it("joins a v-prefixed numeric version and description", () => {
    expect(aiByline({ version: "1.2", description: "Balanced macro AI" })).toBe(
      "v1.2 · Balanced macro AI",
    );
  });

  it("shows the description alone when there is no version", () => {
    expect(aiByline({ description: "Rushes early" })).toBe("Rushes early");
  });

  it("shows a version alone, v-prefixed only when numeric", () => {
    expect(aiByline({ version: "1.0" })).toBe("v1.0");
    expect(aiByline({ version: "stable" })).toBe("stable");
  });

  it("returns undefined when neither field is present or usable", () => {
    expect(aiByline({})).toBeUndefined();
    expect(aiByline({ version: "  ", description: "" })).toBeUndefined();
  });
});
