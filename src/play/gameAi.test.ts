import { describe, expect, it } from "vitest";
import type { SkirmishAi } from "../content/bindings";
import {
  aiForDifficulty,
  aiPips,
  battlePool,
  type GameAiConfig,
  isMinigameAi,
  isNeverAi,
  mergeGameAi,
  neutralPick,
  orderedAis,
  rankedAis,
  standardAi,
} from "./gameAi";

const ai = (shortName: string, kind: "native" | "lua" = "lua"): SkirmishAi => ({
  shortName,
  kind,
  name: shortName,
});

const names = (list: { shortName: string }[]) => list.map((a) => a.shortName);

/** A game that ranks its own four AIs, hardest first. */
const ranked: GameAiConfig = {
  ranking: ["Brutal", "Hard", "Normal", "Gentle"],
  standard: "Normal",
};
const rankedList = [
  ai("Gentle"),
  ai("Brutal"),
  ai("Normal"),
  ai("Hard"),
  ai("Sandbox"),
];

describe("isNeverAi", () => {
  it("bans the built-in do-nothing bots case-insensitively", () => {
    expect(isNeverAi(ai("Sandbox"))).toBe(true);
    expect(isNeverAi(ai("sandbox"))).toBe(true);
    expect(isNeverAi(ai("NullAI", "native"))).toBe(true);
  });

  it("keeps a real playing AI", () => {
    expect(isNeverAi(ai("SimpleAI"))).toBe(false);
  });

  it("honours a configured never list", () => {
    expect(isNeverAi(ai("WeirdBot"), { never: ["weirdbot"] })).toBe(true);
    expect(isNeverAi(ai("SimpleAI"), { never: ["WeirdBot"] })).toBe(false);
  });
});

describe("isMinigameAi", () => {
  it("recognises chicken and scavenger AIs without configuration", () => {
    expect(isMinigameAi(ai("ChickensAI"))).toBe(true);
    expect(isMinigameAi(ai("ScavengersAI"))).toBe(true);
    expect(isMinigameAi(ai("Scav"))).toBe(true);
  });

  it("does not match a normal AI", () => {
    expect(isMinigameAi(ai("SimpleAI"))).toBe(false);
    expect(isMinigameAi(ai("BARb", "native"))).toBe(false);
  });

  it("honours a configured minigame list", () => {
    expect(isMinigameAi(ai("RaptorAI"), { minigame: ["RaptorAI"] })).toBe(true);
  });
});

describe("rankedAis", () => {
  it("orders by the game's own ranking, hardest first", () => {
    expect(names(rankedAis(rankedList, ranked))).toEqual([
      "Brutal",
      "Hard",
      "Normal",
      "Gentle",
    ]);
  });

  it("falls back to the built-in ranking when a game declares none", () => {
    const list = [ai("SimpleAI"), ai("AAI", "native"), ai("BARb", "native")];
    expect(names(rankedAis(list))).toEqual(["BARb", "AAI", "SimpleAI"]);
  });

  it("leaves out AIs no ranking mentions", () => {
    const list = [ai("SimpleAI"), ai("HouseBot")];
    expect(names(rankedAis(list))).toEqual(["SimpleAI"]);
  });

  it("leaves out banned and mini-game AIs", () => {
    const list = [ai("SimpleAI"), ai("ChickensAI"), ai("Sandbox")];
    expect(names(rankedAis(list))).toEqual(["SimpleAI"]);
  });
});

describe("orderedAis", () => {
  it("puts ranked AIs first and unranked ones last", () => {
    const list = [ai("HouseBot"), ai("SimpleAI"), ai("BARb", "native")];
    expect(names(orderedAis(list))).toEqual(["BARb", "SimpleAI", "HouseBot"]);
  });

  it("keeps every AI, including banned and mini-game ones", () => {
    const list = [ai("Sandbox"), ai("ChickensAI"), ai("SimpleAI")];
    expect(names(orderedAis(list))).toEqual([
      "SimpleAI",
      "Sandbox",
      "ChickensAI",
    ]);
  });
});

describe("aiPips", () => {
  it("reads the hardest at the top of the scale and the easiest at the bottom", () => {
    expect(aiPips(ai("Brutal"), rankedList, ranked)).toBe(5);
    expect(aiPips(ai("Gentle"), rankedList, ranked)).toBe(1);
  });

  it("spreads the middle of the ranking across the scale", () => {
    expect(aiPips(ai("Hard"), rankedList, ranked)).toBe(4);
    expect(aiPips(ai("Normal"), rankedList, ranked)).toBe(2);
  });

  it("reads a lone ranked AI mid-scale", () => {
    const list = [ai("SimpleAI"), ai("HouseBot")];
    expect(aiPips(ai("SimpleAI"), list)).toBe(3);
  });

  it("gives no reading for an AI no ranking places", () => {
    expect(aiPips(ai("HouseBot"), [ai("SimpleAI"), ai("HouseBot")])).toBe(
      undefined,
    );
  });
});

describe("standardAi", () => {
  it("uses the configured standard AI", () => {
    expect(standardAi(rankedList, ranked)?.shortName).toBe("Normal");
  });

  it("falls back to the middle of the ranking", () => {
    const list = [ai("Gentle"), ai("Brutal"), ai("Hard")];
    expect(
      standardAi(list, { ranking: ["Brutal", "Hard", "Gentle"] })?.shortName,
    ).toBe("Hard");
  });

  it("uses an unranked AI when the ranking matches nothing installed", () => {
    expect(standardAi([ai("Sandbox"), ai("HouseBot")])?.shortName).toBe(
      "HouseBot",
    );
  });

  it("falls back to a mini-game AI as a last resort", () => {
    expect(standardAi([ai("Sandbox"), ai("ChickensAI")])?.shortName).toBe(
      "ChickensAI",
    );
  });

  it("returns undefined when every AI is banned", () => {
    expect(standardAi([ai("Sandbox"), ai("NullAI", "native")])).toBe(undefined);
  });

  it("ignores a standard naming an AI this game does not have", () => {
    const list = [ai("SimpleAI"), ai("BARb", "native")];
    expect(standardAi(list, { standard: "Ghost" })?.shortName).toBe("SimpleAI");
  });
});

describe("battlePool", () => {
  it("fields only ranked AIs, hardest first", () => {
    expect(names(battlePool(rankedList, ranked))).toEqual([
      "Brutal",
      "Hard",
      "Normal",
      "Gentle",
    ]);
  });

  it("falls back to unranked AIs when they are the only option", () => {
    const list = [ai("HouseBot"), ai("Sandbox"), ai("OtherBot")];
    expect(names(battlePool(list))).toEqual(["HouseBot", "OtherBot"]);
  });

  it("is empty when only banned and mini-game AIs are installed", () => {
    expect(battlePool([ai("Sandbox"), ai("ChickensAI")])).toEqual([]);
  });
});

describe("aiForDifficulty", () => {
  it("fields the hardest AI at the top level and the easiest at the bottom", () => {
    expect(aiForDifficulty(5, rankedList, ranked)?.shortName).toBe("Brutal");
    expect(aiForDifficulty(1, rankedList, ranked)?.shortName).toBe("Gentle");
  });

  it("walks the ranking as the level rises", () => {
    const picks = [1, 2, 3, 4, 5].map(
      (l) => aiForDifficulty(l, rankedList, ranked)?.shortName,
    );
    expect(picks).toEqual(["Gentle", "Normal", "Normal", "Hard", "Brutal"]);
  });

  it("clamps a level outside the scale", () => {
    expect(aiForDifficulty(9, rankedList, ranked)?.shortName).toBe("Brutal");
    expect(aiForDifficulty(0, rankedList, ranked)?.shortName).toBe("Gentle");
  });

  it("falls back to the standard AI when nothing is rankable", () => {
    expect(
      aiForDifficulty(4, [ai("Sandbox"), ai("ChickensAI")])?.shortName,
    ).toBe("ChickensAI");
  });
});

describe("neutralPick", () => {
  it("uses the configured neutral AI", () => {
    const list = [ai("SimpleAI"), ai("ChickensAI"), ai("RaptorAI")];
    expect(neutralPick(list, { neutral: ["RaptorAI"] })?.shortName).toBe(
      "RaptorAI",
    );
  });

  it("skips a configured neutral AI this game does not have", () => {
    const list = [ai("SimpleAI"), ai("ChickensAI")];
    expect(
      neutralPick(list, { neutral: ["Ghost", "ChickensAI"] })?.shortName,
    ).toBe("ChickensAI");
  });

  it("auto-picks a mini-game AI when nothing is configured", () => {
    const list = [ai("SimpleAI"), ai("ScavengersAI")];
    expect(neutralPick(list)?.shortName).toBe("ScavengersAI");
  });

  it("falls back to the standard AI when no mini-game AI exists", () => {
    expect(neutralPick([ai("Sandbox"), ai("SimpleAI")])?.shortName).toBe(
      "SimpleAI",
    );
  });
});

describe("mergeGameAi", () => {
  const branding: GameAiConfig = {
    ranking: ["Brutal", "Gentle"],
    standard: "Gentle",
    never: ["WeirdBot"],
    neutral: ["ChickensAI"],
  };

  it("returns undefined when neither source sets anything", () => {
    expect(mergeGameAi(undefined, undefined)).toBeUndefined();
  });

  it("takes the branding entry when no profile overrides it", () => {
    expect(mergeGameAi(undefined, branding)?.standard).toBe("Gentle");
  });

  it("lets a profile win per field, leaving the rest to branding", () => {
    const merged = mergeGameAi({ standard: "Brutal" }, branding);
    expect(merged?.standard).toBe("Brutal");
    expect(merged?.ranking).toEqual(["Brutal", "Gentle"]);
  });

  it("treats an empty profile array as absent, never blanking a field", () => {
    expect(mergeGameAi({ ranking: [] }, branding)?.ranking).toEqual([
      "Brutal",
      "Gentle",
    ]);
  });
});
