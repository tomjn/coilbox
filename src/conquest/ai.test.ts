import { describe, expect, it } from "vitest";
import type { SkirmishAi } from "../content/bindings";
import type { GameAiConfig } from "../play/gameAi";
import { type AiSubstitution, reconcileAi, summarizeSubstitutions } from "./ai";

const ai = (shortName: string, kind: "native" | "lua" = "lua"): SkirmishAi => ({
  shortName,
  kind,
  name: shortName,
});

describe("reconcileAi", () => {
  // A game version's list that lacks "DAI" but keeps SimpleAI (Sandbox denied).
  const list = [ai("Sandbox"), ai("SimpleAI"), ai("SurvivalAI")];

  it("keeps a desired AI that is available in this game", () => {
    const out = reconcileAi({ shortName: "SurvivalAI" }, list);
    expect(out.status).toBe("kept");
    expect(out.ai?.shortName).toBe("SurvivalAI");
  });

  it("matches case-insensitively when keeping", () => {
    const out = reconcileAi({ shortName: "survivalai" }, list);
    expect(out.status).toBe("kept");
    expect(out.ai?.shortName).toBe("SurvivalAI");
  });

  it("substitutes a desired AI this game does not offer (cross-version drop)", () => {
    const out = reconcileAi({ shortName: "DAI" }, list);
    expect(out.status).toBe("substituted");
    expect(out.ai?.shortName).toBe("SimpleAI");
  });

  it("fills a blank slot with the fallback default", () => {
    const out = reconcileAi(undefined, list);
    expect(out.status).toBe("filled");
    expect(out.ai?.shortName).toBe("SimpleAI");
  });

  it("reports unresolved when the game has no usable AI at all", () => {
    const out = reconcileAi({ shortName: "DAI" }, [
      ai("Sandbox"),
      ai("NullAI", "native"),
    ]);
    expect(out.status).toBe("unresolved");
    expect(out.ai).toBeUndefined();
  });
});

describe("summarizeSubstitutions", () => {
  it("returns undefined for no substitutions", () => {
    expect(summarizeSubstitutions([])).toBeUndefined();
  });

  it("names the one AI when a single distinct swap happened", () => {
    const subs: AiSubstitution[] = [{ from: "DAI", to: "SimpleAI" }];
    expect(summarizeSubstitutions(subs)).toBe(
      "This game doesn't offer DAI. Using SimpleAI instead.",
    );
  });

  it("collapses many identical swaps into one summary (not six)", () => {
    const subs: AiSubstitution[] = Array.from({ length: 6 }, () => ({
      from: "DAI",
      to: "SimpleAI",
    }));
    expect(summarizeSubstitutions(subs)).toBe(
      "This game doesn't offer DAI. Using SimpleAI instead.",
    );
  });

  it("lists each distinct swap when they differ", () => {
    const subs: AiSubstitution[] = [
      { from: "DAI", to: "SimpleAI" },
      { from: "KAIK", to: "SurvivalAI" },
    ];
    expect(summarizeSubstitutions(subs)).toBe(
      "This game doesn't offer some of the chosen AIs. Substituted DAI to SimpleAI, KAIK to SurvivalAI.",
    );
  });
});

describe("reconcileAi difficulty matching", () => {
  // A game that ranks its own AIs, none of them named by the built-in ranking.
  const config: GameAiConfig = { ranking: ["Brutal", "Normal", "Gentle"] };
  const list = [ai("Gentle"), ai("Brutal"), ai("Normal")];

  it("replaces a dropped AI with one of comparable difficulty", () => {
    // BARb tops the built-in ranking, so the hardest AI here takes over.
    expect(reconcileAi({ shortName: "BARb" }, list, config).ai?.shortName).toBe(
      "Brutal",
    );
  });

  it("replaces an easy AI with an easy one", () => {
    expect(
      reconcileAi({ shortName: "SimpleAI" }, list, config).ai?.shortName,
    ).toBe("Gentle");
  });

  it("falls back to the standard AI for an AI nobody has ranked", () => {
    expect(
      reconcileAi({ shortName: "HouseBot" }, list, config).ai?.shortName,
    ).toBe("Normal");
  });
});
