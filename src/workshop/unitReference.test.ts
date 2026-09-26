import { describe, expect, it } from "vitest";
import {
  ALL_FACTIONS,
  differingColumns,
  filterReferenceRows,
  formatReferenceValue,
  REFERENCE_COLUMNS,
  sortReferenceRows,
  type UnitReferenceRow,
  unitReferenceRow,
  unitReferenceRows,
} from "./unitReference";

const laser = {
  weaponType: "Cannon",
  range: 300,
  reloadTime: 2,
  damage: { default: 50 },
};

function tank(overrides: Record<string, unknown> = {}) {
  return {
    health: 1000,
    metalCost: 200,
    buildTime: 4000,
    sightDistance: 400,
    speed: 60,
    weapons: [{ name: "armtank_laser" }],
    weapondefs: { laser },
    ...overrides,
  };
}

describe("unitReferenceRow", () => {
  it("reads a unit's own fields and its weapon's derived numbers", () => {
    const row = unitReferenceRow("armtank", "Tank", tank(), {});
    expect(row.health).toBe(1000);
    expect(row.metalCost).toBe(200);
    expect(row.buildTime).toBe(4000);
    expect(row.sightDistance).toBe(400);
    expect(row.speed).toBe(60);
    expect(row.maxRange).toBe(300);
    // 50 damage every 2 seconds.
    expect(row.derived.dps).toBe(25);
    expect(row.derived.costPerHitPoint).toBeCloseTo(0.2);
  });

  it("falls back to the older field spellings, same as derivedStats.ts", () => {
    const row = unitReferenceRow(
      "oldunit",
      "Old",
      { maxDamage: 500, buildCostMetal: 50 },
      {},
    );
    expect(row.health).toBe(500);
    expect(row.metalCost).toBe(50);
  });

  it("has no range when a unit carries no ranged weapon", () => {
    const row = unitReferenceRow("nolaser", "No laser", { health: 10 }, {});
    expect(row.maxRange).toBeUndefined();
    expect(row.derived.dps).toBeNull();
  });

  it("leaves a shield's range out of the unit's maximum", () => {
    const row = unitReferenceRow(
      "shielder",
      "Shielder",
      {
        weapons: [{ name: "shielder_bubble" }],
        weapondefs: { bubble: { weaponType: "Shield", range: 900 } },
      },
      {},
    );
    expect(row.maxRange).toBeUndefined();
  });
});

describe("unitReferenceRow with an equipped library weapon", () => {
  const library = {
    bigcannon: {
      key: "bigcannon",
      source: "bigcannon",
      def: {
        weaponType: "Cannon",
        range: 500,
        reloadTime: 1,
        damage: { default: 100 },
      },
    },
  };

  it("resolves the equipped weapon's numbers rather than the slot's own (issue #3081)", () => {
    const row = unitReferenceRow("armtank", "Tank", tank(), {}, library, {
      "0": "bigcannon",
    });
    // 100 damage every second, not the game's laser (50 damage / 2s = 25).
    expect(row.derived.dps).toBe(100);
    expect(row.maxRange).toBe(500);
  });

  it("falls back to the slot's own weapon when nothing is equipped", () => {
    const row = unitReferenceRow(
      "armtank",
      "Tank",
      tank(),
      {},
      library,
      undefined,
    );
    expect(row.derived.dps).toBe(25);
  });
});

describe("unitReferenceRows", () => {
  it("joins every unit against the game's shared weapon table", () => {
    const rows = unitReferenceRows({ armtank: tank() }, {}, (key) => `${key}!`);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("armtank");
    expect(rows[0].name).toBe("armtank!");
  });
});

describe("sortReferenceRows", () => {
  const rows: UnitReferenceRow[] = [
    unitReferenceRow("a", "Bravo", tank({ health: 500 }), {}),
    unitReferenceRow("b", "Alpha", tank({ health: 1500 }), {}),
    unitReferenceRow("c", "Charlie", { health: undefined }, {}),
  ];

  it("sorts by name", () => {
    const sorted = sortReferenceRows(rows, {
      columnId: "name",
      direction: "asc",
    });
    expect(sorted.map((r) => r.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("sorts a numeric column ascending and descending", () => {
    const asc = sortReferenceRows(rows, {
      columnId: "health",
      direction: "asc",
    });
    expect(asc.map((r) => r.key)).toEqual(["a", "b", "c"]);

    const desc = sortReferenceRows(rows, {
      columnId: "health",
      direction: "desc",
    });
    // The unit with no health still sorts last, not first, when the
    // direction reverses.
    expect(desc.map((r) => r.key)).toEqual(["b", "a", "c"]);
  });
});

describe("differingColumns", () => {
  it("is empty for fewer than two rows", () => {
    const rows = [unitReferenceRow("a", "A", tank(), {})];
    expect(differingColumns(rows)).toEqual([]);
  });

  it("names only the columns that are not the same across every row", () => {
    const rows = [
      unitReferenceRow("a", "A", tank(), {}),
      unitReferenceRow("b", "B", tank({ health: 2000 }), {}),
    ];
    const columns = differingColumns(rows).map((c) => c.id);
    expect(columns).toContain("health");
    expect(columns).toContain("costPerHitPoint");
    expect(columns).not.toContain("metalCost");
    expect(columns).not.toContain("speed");
  });

  it("treats two units with no weapon as equal on combat columns", () => {
    const rows = [
      unitReferenceRow("a", "A", { health: 10 }, {}),
      unitReferenceRow("b", "B", { health: 10 }, {}),
    ];
    expect(differingColumns(rows).map((c) => c.id)).toEqual([]);
  });
});

describe("formatReferenceValue", () => {
  it("shows a dash for an unknown value", () => {
    expect(formatReferenceValue(undefined)).toBe("—");
  });

  it("rounds to two decimal places", () => {
    expect(formatReferenceValue(1.23456)).toBe("1.23");
  });
});

it("every column resolves without throwing on a row with nothing", () => {
  const row = unitReferenceRow("empty", "Empty", {}, {});
  for (const column of REFERENCE_COLUMNS)
    expect(() => column.value(row)).not.toThrow();
});

describe("filterReferenceRows", () => {
  function rows(): UnitReferenceRow[] {
    return [
      unitReferenceRow("armtank", "Tank", { health: 1000, metalCost: 200 }, {}),
      unitReferenceRow(
        "corcom",
        "Commander",
        { health: 3000, metalCost: 1000 },
        {},
      ),
    ];
  }
  const factionOf = (key: string) => (key === "armtank" ? "Arm" : "Core");

  it("matches every row with an empty query and no faction chosen", () => {
    const result = filterReferenceRows(rows(), "", ALL_FACTIONS);
    expect(result.ok).toBe(true);
    expect(result.rows.map((r) => r.key)).toEqual(["armtank", "corcom"]);
  });

  it("filters by a stat comparison, the same query the table reads", () => {
    const result = filterReferenceRows(rows(), "hp > 2000", ALL_FACTIONS);
    expect(result.ok).toBe(true);
    expect(result.rows.map((r) => r.key)).toEqual(["corcom"]);
  });

  it("reports a bad query rather than matching everything or nothing", () => {
    const result = filterReferenceRows(rows(), "hp >", ALL_FACTIONS);
    expect(result.ok).toBe(false);
    expect(result.rows).toEqual([]);
  });

  it("filters by faction when given a factionOf", () => {
    const result = filterReferenceRows(rows(), "", "Core", factionOf);
    expect(result.rows.map((r) => r.key)).toEqual(["corcom"]);
  });

  it("ignores the faction filter when there is no factionOf to ask", () => {
    const result = filterReferenceRows(rows(), "", "Core");
    expect(result.rows.map((r) => r.key)).toEqual(["armtank", "corcom"]);
  });

  it("combines the query and the faction filter", () => {
    const result = filterReferenceRows(rows(), "hp > 2000", "Arm", factionOf);
    expect(result.rows).toEqual([]);
  });

  it("narrows to a collection's units, on top of the query and faction", () => {
    const inCollection = new Set(["armtank"]);
    expect(
      filterReferenceRows(
        rows(),
        "",
        ALL_FACTIONS,
        factionOf,
        inCollection,
      ).rows.map((r) => r.key),
    ).toEqual(["armtank"]);
    expect(
      filterReferenceRows(
        rows(),
        "hp > 2000",
        ALL_FACTIONS,
        factionOf,
        inCollection,
      ).rows,
    ).toEqual([]);
  });

  it("matches a collection's lowercased keys against any key casing", () => {
    const mixed = [unitReferenceRow("ArmTank", "Tank", { health: 1000 }, {})];
    const result = filterReferenceRows(
      mixed,
      "",
      ALL_FACTIONS,
      undefined,
      new Set(["armtank"]),
    );
    expect(result.rows.map((r) => r.key)).toEqual(["ArmTank"]);
  });
});
