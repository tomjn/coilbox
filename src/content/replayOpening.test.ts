import { describe, expect, it } from "vitest";
import type { BuildOrder, UnitDatasetEntry } from "./bindings";
import {
  collapseOrders,
  orderedCost,
  orderedSplit,
  ordersUpTo,
  parseCutMinutes,
  splitBucket,
} from "./replayOpening";

const order = (over: Partial<BuildOrder>): BuildOrder => ({
  frame: 0,
  player: 0,
  origin: { kind: "selection" },
  unitDefId: 1,
  count: 1,
  slot: { kind: "append" },
  builders: 1,
  options: 0,
  ...over,
});

describe("collapseOrders", () => {
  it("folds consecutive orders for one unit into a count", () => {
    const entries = collapseOrders([
      order({ frame: 30, unitDefId: 1 }),
      order({ frame: 30, unitDefId: 1 }),
      order({ frame: 60, unitDefId: 1 }),
      order({ frame: 90, unitDefId: 2 }),
    ]);
    expect(
      entries.map((e) => [e.unitDefId, e.count, e.orders, e.frame]),
    ).toEqual([
      [1, 3, 3, 30],
      [2, 1, 1, 90],
    ]);
  });

  it("does not join units that another unit came between", () => {
    const entries = collapseOrders([
      order({ unitDefId: 1 }),
      order({ unitDefId: 2 }),
      order({ unitDefId: 1 }),
    ]);
    expect(entries.map((e) => e.unitDefId)).toEqual([1, 2, 1]);
  });

  it("adds up the counts of factory orders for the same unit", () => {
    const entries = collapseOrders([
      order({ unitDefId: 3, count: 5 }),
      order({ unitDefId: 3, count: 20 }),
      order({ unitDefId: 3, count: 1 }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(26);
    expect(entries[0].orders).toBe(3);
  });

  it("starts a new entry at an order that replaced the queue", () => {
    const entries = collapseOrders([
      order({ unitDefId: 1 }),
      order({ unitDefId: 1, slot: { kind: "replace" } }),
    ]);
    expect(entries.map((e) => e.count)).toEqual([1, 1]);
  });

  it("lets appends continue a run that began with a replace", () => {
    const entries = collapseOrders([
      order({ unitDefId: 1, slot: { kind: "replace" } }),
      order({ unitDefId: 1 }),
      order({ unitDefId: 1 }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(3);
    expect(entries[0].first.slot.kind).toBe("replace");
  });

  it("keeps an order inserted at the front apart from its neighbours", () => {
    const entries = collapseOrders([
      order({ unitDefId: 1 }),
      order({ unitDefId: 1, slot: { kind: "front" } }),
      order({ unitDefId: 1 }),
    ]);
    expect(entries.map((e) => e.count)).toEqual([1, 1, 1]);
    expect(entries[1].first.slot.kind).toBe("front");
  });

  it("keeps inserts by position and by tag apart", () => {
    const entries = collapseOrders([
      order({ unitDefId: 1, slot: { kind: "insertAt", position: 0 } }),
      order({
        unitDefId: 1,
        slot: { kind: "insertAtTag", tag: 4, after: true },
      }),
    ]);
    expect(entries).toHaveLength(2);
  });

  it("keeps a widget's orders apart from the player's own", () => {
    const entries = collapseOrders([
      order({ unitDefId: 1, origin: { kind: "selection" } }),
      order({ unitDefId: 1, origin: { kind: "lua" } }),
      order({ unitDefId: 1, origin: { kind: "lua" } }),
    ]);
    expect(entries.map((e) => [e.first.origin.kind, e.count])).toEqual([
      ["selection", 1],
      ["lua", 2],
    ]);
  });

  it("is empty for no orders", () => {
    expect(collapseOrders([])).toEqual([]);
  });
});

describe("parseCutMinutes", () => {
  it("reads a number of minutes from zero up", () => {
    expect(parseCutMinutes("5")).toBe(5);
    expect(parseCutMinutes("2.5")).toBe(2.5);
    expect(parseCutMinutes("0")).toBe(0);
  });

  it("means no cut for empty or unusable text", () => {
    expect(parseCutMinutes("")).toBeNull();
    expect(parseCutMinutes("  ")).toBeNull();
    expect(parseCutMinutes("soon")).toBeNull();
    expect(parseCutMinutes("-3")).toBeNull();
  });
});

describe("ordersUpTo", () => {
  const list = [
    order({ frame: -5 }),
    order({ frame: 30 * 60 }),
    order({ frame: 30 * 60 + 1 }),
  ];

  it("is the whole list with no cut", () => {
    expect(ordersUpTo(list, null)).toHaveLength(3);
  });

  it("keeps orders up to and including the minute, and pre-game orders", () => {
    expect(ordersUpTo(list, 1)).toHaveLength(2);
    expect(ordersUpTo(list, 0)).toHaveLength(1);
  });
});

describe("orderedCost", () => {
  const units: UnitDatasetEntry[] = [
    { name: "mex", stats: { metalCost: 50, energyCost: 500 } },
    { name: "solar", stats: { energyCost: 200 } },
    { name: "mystery" },
  ];

  it("keeps metal and energy apart", () => {
    const cost = orderedCost([order({ unitDefId: 1 })], units);
    expect(cost).toEqual({ metal: 50, energy: 500, priced: 1, unpriced: 0 });
  });

  it("multiplies a factory order by its count", () => {
    const cost = orderedCost([order({ unitDefId: 1, count: 20 })], units);
    expect(cost.metal).toBe(1000);
    expect(cost.energy).toBe(10000);
    expect(cost.priced).toBe(20);
  });

  it("adds what a definition declares and leaves the rest at zero", () => {
    const cost = orderedCost([order({ unitDefId: 2, count: 2 })], units);
    expect(cost).toEqual({ metal: 0, energy: 400, priced: 2, unpriced: 0 });
  });

  it("counts units with no cost as unpriced", () => {
    const cost = orderedCost(
      [
        order({ unitDefId: 3, count: 4 }),
        order({ unitDefId: 99 }),
        order({ unitDefId: 1 }),
      ],
      units,
    );
    expect(cost).toEqual({ metal: 50, energy: 500, priced: 1, unpriced: 5 });
  });

  it("prices nothing without a dataset", () => {
    const cost = orderedCost([order({ unitDefId: 1, count: 3 })], null);
    expect(cost).toEqual({ metal: 0, energy: 0, priced: 0, unpriced: 3 });
  });
});

describe("orderedSplit", () => {
  const gun = { damage: 5, range: 100 };
  const units: UnitDatasetEntry[] = [
    {
      name: "mex",
      stats: { metalCost: 50, energyCost: 500, extractsMetal: 1 },
    },
    {
      name: "tower",
      stats: { metalCost: 100, energyCost: 10, weapons: [gun] },
    },
    {
      name: "tank",
      mobile: true,
      stats: { metalCost: 200, energyCost: 20, weapons: [gun] },
    },
    {
      name: "lab",
      buildOptions: ["tank"],
      stats: { metalCost: 300, energyCost: 30, builder: true },
    },
    { name: "blob", stats: { metalCost: 7, energyCost: 70 } },
    { name: "free", stats: { health: 10 } },
  ];

  it("puts each order's cost in the column of its unit's kind", () => {
    const split = orderedSplit(
      [
        order({ unitDefId: 1 }),
        order({ unitDefId: 2 }),
        order({ unitDefId: 3 }),
        order({ unitDefId: 4 }),
        order({ unitDefId: 5 }),
      ],
      units,
    );
    expect(split.buckets).toEqual({
      economy: { metal: 50, energy: 500 },
      defence: { metal: 100, energy: 10 },
      offence: { metal: 200, energy: 20 },
      other: { metal: 300, energy: 30 },
      unclassified: { metal: 7, energy: 70 },
    });
    expect(split.unpriced).toBe(0);
  });

  it("multiplies by the order's count and keeps the unpriced total", () => {
    const split = orderedSplit(
      [
        order({ unitDefId: 3, count: 5 }),
        order({ unitDefId: 6, count: 2 }),
        order({ unitDefId: 99 }),
      ],
      units,
    );
    expect(split.buckets.offence).toEqual({ metal: 1000, energy: 100 });
    expect(split.unpriced).toBe(3);
  });

  it("adds up to the plain cost for the same orders", () => {
    const orders = [
      order({ unitDefId: 1, count: 3 }),
      order({ unitDefId: 2 }),
      order({ unitDefId: 4, count: 20 }),
      order({ unitDefId: 5 }),
      order({ unitDefId: 6 }),
    ];
    const split = orderedSplit(orders, units);
    const cost = orderedCost(orders, units);
    const buckets = Object.values(split.buckets);
    expect(buckets.reduce((n, b) => n + b.metal, 0)).toBe(cost.metal);
    expect(buckets.reduce((n, b) => n + b.energy, 0)).toBe(cost.energy);
    expect(split.unpriced).toBe(cost.unpriced);
  });

  it("splits nothing without a dataset", () => {
    const split = orderedSplit([order({ unitDefId: 1, count: 2 })], null);
    expect(split.unpriced).toBe(2);
    expect(split.buckets.economy).toEqual({ metal: 0, energy: 0 });
  });

  it("counts a builder, factory, sensor or transport as other", () => {
    for (const kind of [
      "builder",
      "factory",
      "intelligence",
      "transport",
    ] as const) {
      expect(splitBucket(kind)).toBe("other");
    }
    expect(splitBucket("unclassified")).toBe("unclassified");
  });
});
