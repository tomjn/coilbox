import { describe, expect, it } from "vitest";
import type { SkirmishAi } from "../content/bindings";
import {
  factionAiPool,
  fallbackFactionAi,
  isChickenAi,
  isDeniedAi,
  neutralAi,
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
