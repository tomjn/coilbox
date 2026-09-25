import { describe, expect, it } from "vitest";
import type { Collections } from "./collections";
import {
  applyRandomModPlan,
  DEFAULT_TIER_WEIGHTS,
  describeRandomModRules,
  planRandomMod,
  RARITY_TIERS,
  randomModChangeCount,
  randomModProjectName,
  resolveRandomScope,
} from "./randomMod";

/** A tiny synthetic game, standing in for a real unit table (issue #1318).
 *  Four units so a weighted tier roll can land on more than one tier, and a
 *  mix of fields so "missing" and "not numeric" both have something to skip. */
const UNITS: Record<string, Record<string, unknown>> = {
  armcom: {
    metalCost: 2000,
    health: 3400,
    speed: 45,
    buildTime: 12000,
    name: "Commander",
  },
  armpw: {
    metalCost: 55,
    health: 220,
    speed: 90,
    buildTime: 900,
  },
  armflash: {
    metalCost: 60,
    health: 160,
    speed: 130,
    buildTime: 800,
  },
  // No numeric buildTime at all, and cost is a string: exercises "missing"
  // and "not numeric" in the same unit.
  armsolar: {
    metalCost: "free",
    health: 0,
    speed: 0,
  },
};

describe("resolveRandomScope", () => {
  it("returns every unit, sorted, for the all scope", () => {
    expect(resolveRandomScope({ kind: "all" }, UNITS)).toEqual([
      "armcom",
      "armflash",
      "armpw",
      "armsolar",
    ]);
  });

  it("filters by a search query", () => {
    expect(
      resolveRandomScope({ kind: "query", query: "cost < 100" }, UNITS),
    ).toEqual(["armflash", "armpw"]);
  });

  it("matches nothing for a query that fails to parse", () => {
    expect(
      resolveRandomScope({ kind: "query", query: "cost <" }, UNITS),
    ).toEqual([]);
  });

  it("resolves a named collection, including a rule", () => {
    const collections: Collections = {
      cheap: {
        id: "cheap",
        name: "Cheap stuff",
        units: [],
        rule: "cost < 100",
      },
    };
    expect(
      resolveRandomScope(
        { kind: "collection", collections, collectionId: "cheap" },
        UNITS,
      ),
    ).toEqual(["armflash", "armpw"]);
  });

  it("matches nothing for a collection id that does not exist", () => {
    expect(
      resolveRandomScope(
        { kind: "collection", collections: {}, collectionId: "nope" },
        UNITS,
      ),
    ).toEqual([]);
  });
});

describe("planRandomMod", () => {
  const rules = {
    seed: 4242,
    fields: ["cost", "health", "speed", "buildtime"],
    tierWeights: DEFAULT_TIER_WEIGHTS,
  };

  it("touches only units it was given, in that order", () => {
    const rows = planRandomMod(["armpw", "armflash"], UNITS, rules);
    expect(rows.map((r) => r.unit)).toEqual(["armpw", "armflash"]);
  });

  it("always lands on one of the known tiers", () => {
    const rows = planRandomMod(Object.keys(UNITS), UNITS, rules);
    const tierIds = new Set(RARITY_TIERS.map((t) => t.id));
    for (const row of rows) expect(tierIds.has(row.tier)).toBe(true);
  });

  it("skips a missing or non-numeric field rather than guessing", () => {
    const rows = planRandomMod(["armsolar"], UNITS, rules);
    const fields = rows[0].changes.map((c) => c.field);
    // cost is a string, health and speed are 0 (never touched, since only a
    // positive number is a safe base to multiply), buildTime is absent.
    expect(fields).toEqual([]);
  });

  it("never produces a change at or below zero", () => {
    // A wide seed sweep, since a single seed proves nothing about the clamp.
    for (let seed = 0; seed < 500; seed++) {
      const rows = planRandomMod(Object.keys(UNITS), UNITS, { ...rules, seed });
      for (const row of rows) {
        for (const change of row.changes)
          expect(change.after).toBeGreaterThan(0);
      }
    }
  });

  it("is reproducible: the same seed and rules produce the same plan", () => {
    const first = planRandomMod(Object.keys(UNITS), UNITS, rules);
    const second = planRandomMod(Object.keys(UNITS), UNITS, rules);
    expect(second).toEqual(first);
  });

  it("does not move another unit's roll when the scope grows", () => {
    const smaller = planRandomMod(["armpw", "armflash"], UNITS, rules);
    const larger = planRandomMod(Object.keys(UNITS), UNITS, rules);
    const byUnit = new Map(larger.map((r) => [r.unit, r]));
    for (const row of smaller) expect(byUnit.get(row.unit)).toEqual(row);
  });

  it("draws nothing for a field the rules did not enable", () => {
    const allFields = planRandomMod(["armpw"], UNITS, rules);
    const costOnly = planRandomMod(["armpw"], UNITS, {
      ...rules,
      fields: ["cost"],
    });
    // Both rolled the same tier off the same first draw, but only one drew a
    // health/speed/buildtime factor afterwards.
    expect(costOnly[0].tier).toBe(allFields[0].tier);
    expect(costOnly[0].changes.every((c) => c.field === "cost")).toBe(true);
  });
});

describe("applyRandomModPlan / randomModChangeCount", () => {
  it("writes one override per changed field, and none for a no-op field", () => {
    const rows = planRandomMod(["armpw", "armflash"], UNITS, {
      seed: 7,
      fields: ["cost", "health", "speed", "buildtime"],
      tierWeights: DEFAULT_TIER_WEIGHTS,
    });
    const overrides = applyRandomModPlan(rows);
    for (const row of rows) {
      for (const change of row.changes) {
        expect(overrides[row.unit]?.[change.path]).toBe(change.after);
      }
    }
  });

  it("counts only units with at least one real change", () => {
    const rows = planRandomMod(["armsolar"], UNITS, {
      seed: 1,
      fields: ["cost", "health", "speed", "buildtime"],
      tierWeights: DEFAULT_TIER_WEIGHTS,
    });
    expect(randomModChangeCount(rows)).toBe(0);
  });
});

describe("randomModProjectName", () => {
  it("names the game and the seed", () => {
    expect(randomModProjectName("Balanced Annihilation", 4242)).toBe(
      "Balanced Annihilation random 4242",
    );
  });
});

describe("describeRandomModRules", () => {
  it("reads back the seed, scope, fields and tier weights", () => {
    const text = describeRandomModRules(
      {
        seed: 4242,
        fields: ["cost", "health"],
        tierWeights: DEFAULT_TIER_WEIGHTS,
      },
      { kind: "all" },
    );
    expect(text).toContain("seed 4242");
    expect(text).toContain("Scope: all units");
    expect(text).toContain("Metal cost, Health");
    expect(text).toContain("Common 60");
  });
});

/**
 * Golden plan (issue #1318's own reproducibility requirement): the same seed
 * and rules against a fixed unit table must produce exactly this, byte for
 * byte, on every platform. Safe as a plain `toEqual` rather than a checked-in
 * fixture the way `conquest`'s galaxy golden is: this generator only ever
 * adds, multiplies, rounds and compares, all four of which IEEE-754 pins
 * exactly, unlike `Math.sin`/`Math.cos`/`Math.log` which conquest's galaxy
 * layout depends on and which the spec leaves implementation-approximated.
 *
 * A deliberate change to the tier ladder, the field list or the rounding rule
 * will move these numbers. Re-run and read the diff before updating it.
 */
it("golden: seed 4242 against the fixture units", () => {
  const rows = planRandomMod(Object.keys(UNITS), UNITS, {
    seed: 4242,
    fields: ["cost", "health", "speed", "buildtime"],
    tierWeights: DEFAULT_TIER_WEIGHTS,
  });
  expect(rows).toEqual([
    {
      unit: "armcom",
      tier: "common",
      changes: [
        { field: "cost", path: "metalCost", before: 2000, after: 1994 },
        { field: "health", path: "health", before: 3400, after: 3111 },
        { field: "speed", path: "speed", before: 45, after: 39 },
        { field: "buildtime", path: "buildTime", before: 12000, after: 10356 },
      ],
    },
    {
      unit: "armpw",
      tier: "common",
      changes: [
        { field: "cost", path: "metalCost", before: 55, after: 49 },
        { field: "health", path: "health", before: 220, after: 227 },
        { field: "speed", path: "speed", before: 90, after: 93 },
        { field: "buildtime", path: "buildTime", before: 900, after: 1001 },
      ],
    },
    {
      unit: "armflash",
      tier: "uncommon",
      changes: [
        { field: "cost", path: "metalCost", before: 60, after: 94 },
        { field: "health", path: "health", before: 160, after: 132 },
        { field: "speed", path: "speed", before: 130, after: 157 },
        { field: "buildtime", path: "buildTime", before: 800, after: 1138 },
      ],
    },
    { unit: "armsolar", tier: "uncommon", changes: [] },
  ]);
});
