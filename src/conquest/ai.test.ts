import { describe, expect, it } from "vitest";
import type { SkirmishAi } from "../content/bindings";
import {
  type AiSubstitution,
  factionAiPool,
  fallbackFactionAi,
  isChickenAi,
  isDeniedAi,
  neutralAi,
  reconcileAi,
  summarizeSubstitutions,
} from "./ai";

const ai = (shortName: string, kind: "native" | "lua" = "lua"): SkirmishAi => ({
  shortName,
  kind,
  name: shortName,
});

describe("isDeniedAi", () => {
  it("denies the built-in do-nothing bots case-insensitively", () => {
    expect(isDeniedAi(ai("Sandbox"))).toBe(true);
    expect(isDeniedAi(ai("sandbox"))).toBe(true);
    expect(isDeniedAi(ai("NullAI", "native"))).toBe(true);
  });

  it("keeps a real playing AI", () => {
    expect(isDeniedAi(ai("SimpleAI"))).toBe(false);
    expect(isDeniedAi(ai("BARb", "native"))).toBe(false);
  });

  it("honours catalog deny additions", () => {
    expect(isDeniedAi(ai("WeirdBot"), { deny: ["WeirdBot"] })).toBe(true);
    expect(isDeniedAi(ai("SimpleAI"), { deny: ["WeirdBot"] })).toBe(false);
  });
});

describe("isChickenAi", () => {
  it("matches chicken/wildlife AIs by name", () => {
    expect(isChickenAi(ai("ChickensAI"))).toBe(true);
    expect(isChickenAi(ai("SuperChickensAIv2"))).toBe(true);
  });

  it("does not match normal AIs", () => {
    expect(isChickenAi(ai("SimpleAI"))).toBe(false);
    expect(isChickenAi(ai("BARb", "native"))).toBe(false);
  });
});

describe("factionAiPool", () => {
  const list = [
    ai("SimpleAI"),
    ai("ChickensAI"),
    ai("Sandbox"),
    ai("BARb", "native"),
  ];

  it("excludes denied and chicken AIs", () => {
    expect(factionAiPool(list).map((a) => a.shortName)).toEqual([
      "SimpleAI",
      "BARb",
    ]);
  });

  it("restricts and orders by catalog enemyAis", () => {
    expect(
      factionAiPool(list, { enemyAis: ["BARb", "SimpleAI"] }).map(
        (a) => a.shortName,
      ),
    ).toEqual(["BARb", "SimpleAI"]);
  });

  it("drops enemyAis entries that are absent or denied", () => {
    expect(
      factionAiPool(list, { enemyAis: ["Sandbox", "Ghost", "SimpleAI"] }).map(
        (a) => a.shortName,
      ),
    ).toEqual(["SimpleAI"]);
  });
});

describe("fallbackFactionAi", () => {
  it("returns the first playable faction AI", () => {
    const list = [ai("Sandbox"), ai("SimpleAI"), ai("BARb", "native")];
    expect(fallbackFactionAi(list)?.shortName).toBe("SimpleAI");
  });

  it("falls back to a chicken AI as a last resort when no normal AI exists", () => {
    const list = [ai("Sandbox"), ai("ChickensAI")];
    expect(fallbackFactionAi(list)?.shortName).toBe("ChickensAI");
  });

  it("returns undefined when only denied AIs exist", () => {
    expect(fallbackFactionAi([ai("Sandbox"), ai("NullAI", "native")])).toBe(
      undefined,
    );
  });
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

describe("neutralAi", () => {
  it("auto-picks an available chicken AI for a neutral garrison", () => {
    const list = [ai("SimpleAI"), ai("ChickensAI"), ai("BARb", "native")];
    expect(neutralAi(list)?.shortName).toBe("ChickensAI");
  });

  it("uses an explicit catalog neutralAi when set", () => {
    const list = [ai("SimpleAI"), ai("ChickensAI")];
    expect(neutralAi(list, { neutralAi: "SimpleAI" })?.shortName).toBe(
      "SimpleAI",
    );
  });

  it("falls back to a normal faction AI when no chicken AI is present", () => {
    const list = [ai("Sandbox"), ai("SimpleAI")];
    expect(neutralAi(list)?.shortName).toBe("SimpleAI");
  });
});
