import { describe, expect, it } from "vitest";
import {
  evaluateUnitQuery,
  parseUnitQuery,
  type UnitQueryContext,
} from "./searchQuery";

function ctx(over: Partial<UnitQueryContext> = {}): UnitQueryContext {
  return {
    key: "armcom",
    name: "Commander",
    def: { health: 3500, metalCost: 200, buildTime: 100 },
    ...over,
  };
}

function matches(input: string, context: UnitQueryContext): boolean {
  const parsed = parseUnitQuery(input);
  if (!parsed.ok)
    throw new Error(`expected a valid query, got: ${parsed.error}`);
  return evaluateUnitQuery(parsed.query, context);
}

describe("plain name search", () => {
  it("matches a name substring, case-insensitively", () => {
    expect(matches("command", ctx())).toBe(true);
    expect(matches("COMMAND", ctx())).toBe(true);
  });

  it("matches a key substring", () => {
    expect(matches("armc", ctx())).toBe(true);
  });

  it("keeps a multi word phrase together rather than ANDing each word apart", () => {
    const unit = ctx({ key: "armap", name: "Advanced Aircraft Plant" });
    expect(matches("aircraft plant", unit)).toBe(true);
    // A phrase that is not contiguous in the name should not match, proving
    // the words were not split and ANDed independently.
    expect(matches("plant aircraft", unit)).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(matches("", ctx())).toBe(true);
    expect(matches("   ", ctx())).toBe(true);
  });
});

describe("comparisons", () => {
  it.each([
    ["hp > 3000", true],
    ["hp > 4000", false],
    ["hp < 4000", true],
    ["hp >= 3500", true],
    ["hp <= 3499", false],
    ["hp = 3500", true],
    ["hp != 3500", false],
  ] as const)("%s -> %s", (query, expected) => {
    expect(matches(query, ctx())).toBe(expected);
  });

  it("accepts a comparison glued together with no spaces", () => {
    expect(matches("hp>3000", ctx())).toBe(true);
  });

  it("is case-insensitive on the field name", () => {
    expect(matches("HP > 3000", ctx())).toBe(true);
  });

  it("a field absent from the unit's def never matches", () => {
    expect(matches("hp > 0", ctx({ def: {} }))).toBe(false);
    expect(matches("hp != 0", ctx({ def: {} }))).toBe(false);
  });
});

describe("aliases", () => {
  it("hp reads health, falling back to the old maxDamage spelling", () => {
    expect(matches("hp > 100", ctx({ def: { maxDamage: 500 } }))).toBe(true);
  });

  it("speed reads speed, falling back to the old maxVelocity spelling", () => {
    expect(matches("speed < 50", ctx({ def: { speed: 40 } }))).toBe(true);
    expect(matches("speed < 50", ctx({ def: { maxVelocity: 40 } }))).toBe(true);
  });

  it("cost and metal both read metalCost, falling back to buildCostMetal", () => {
    expect(matches("cost < 250", ctx())).toBe(true);
    expect(matches("metal < 250", ctx())).toBe(true);
    expect(matches("cost < 250", ctx({ def: { buildCostMetal: 100 } }))).toBe(
      true,
    );
  });

  it("buildtime and time both read buildTime", () => {
    expect(matches("buildtime < 200", ctx())).toBe(true);
    expect(matches("time < 200", ctx())).toBe(true);
  });

  it("a real engine field name works without an alias", () => {
    expect(matches("maxVelocity < 50", ctx({ def: { maxVelocity: 40 } }))).toBe(
      true,
    );
  });
});

describe("combining terms", () => {
  it("ANDs terms with no keyword between them", () => {
    expect(matches("commander hp > 1000", ctx())).toBe(true);
    expect(matches("commander hp > 9000", ctx())).toBe(false);
  });

  it("ANDs terms with the word and", () => {
    expect(matches("hp > 1000 and cost < 250", ctx())).toBe(true);
    expect(matches("hp > 1000 and cost > 250", ctx())).toBe(false);
  });

  it("ORs groups with the word or", () => {
    expect(matches("hp > 9000 or cost < 250", ctx())).toBe(true);
    expect(matches("hp > 9000 or cost > 9000", ctx())).toBe(false);
  });

  it("is case-insensitive on and/or", () => {
    expect(matches("hp > 1000 AND cost < 250", ctx())).toBe(true);
  });
});

describe("overrides win over the game's own def", () => {
  it("reads the project's override before the def", () => {
    expect(matches("hp > 5000", ctx({ overrides: { health: 6000 } }))).toBe(
      true,
    );
  });
});

describe("string fields", () => {
  it("compares equality case-insensitively", () => {
    const unit = ctx({ def: { objectName: "Units/ARMCOM.s3o" } });
    expect(matches('objectname = "units/armcom.s3o"', unit)).toBe(true);
    expect(matches('objectname != "units/armcom.s3o"', unit)).toBe(false);
  });
});

describe("parse errors, never a thrown exception", () => {
  it.each([
    "hp >",
    "> 100",
    "hp > vtol",
    "notarealfield > 5",
    "hp > 5 or",
    "or hp > 5",
  ])("reports an inline error for %s", (query) => {
    const result = parseUnitQuery(query);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
