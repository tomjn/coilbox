import { describe, expect, it } from "vitest";
import type {
  ReplayUnitDefSets,
  UnitDatasetEntry,
  UnitDefLink,
} from "./bindings";
import dataset from "./fixtures/splinter-faction-unit-dataset.json";
import { orderedCost, orderedSplit } from "./replayOpening";
import {
  listDate,
  misfits,
  orderFit,
  storedListFor,
  storedListSentence,
  storedToUnit,
  unitToStored,
} from "./replayUnitDefs";
import { classifyUnit } from "./unitCategory";

const UNITS = (dataset as { units: UnitDatasetEntry[] }).units;

const link = (over: Partial<UnitDefLink> = {}): UnitDefLink => ({
  digest: `sha256:${"a".repeat(64)}`,
  origin: "archive",
  game: "SplinterFaction 0.1.88",
  // Noon, so the date is the same in every time zone a test runs in.
  takenAtMs: Date.UTC(2026, 9, 10, 12),
  ...over,
});

describe("a unit list through the store and back", () => {
  it("keeps every unit of a real game in the same place", () => {
    const back = UNITS.map(unitToStored).map(storedToUnit);
    expect(back).toHaveLength(154);
    expect(back.map((u) => u.name)).toEqual(UNITS.map((u) => u.name));
    expect(back.map((u) => u.fullName)).toEqual(UNITS.map((u) => u.fullName));
  });

  it("sorts every unit of a real game into the kind the dataset does", () => {
    const back = UNITS.map(unitToStored).map(storedToUnit);
    expect(back.map(classifyUnit)).toEqual(UNITS.map(classifyUnit));
    // The fixture uses every kind but one, so this is not all one answer.
    expect(new Set(UNITS.map(classifyUnit)).size).toBeGreaterThan(5);
  });

  it("prices and splits an opening the same from a stored list", () => {
    const back = UNITS.map(unitToStored).map(storedToUnit);
    const orders = UNITS.map((_, i) => ({
      frame: i,
      player: 0,
      origin: { kind: "selection" as const },
      unitDefId: i + 1,
      count: 1,
      slot: { kind: "append" as const },
      builders: 1,
      options: 0,
    }));
    expect(orderedCost(orders, back)).toEqual(orderedCost(orders, UNITS));
    expect(orderedSplit(orders, back)).toEqual(orderedSplit(orders, UNITS));
  });

  it("keeps a cost of nothing apart from no cost at all", () => {
    const free = unitToStored({ name: "free", stats: { metalCost: 0 } });
    const unsaid = unitToStored({ name: "unsaid", stats: {} });
    expect(free).toEqual({ name: "free", metalCost: 0 });
    expect(unsaid).toEqual({ name: "unsaid" });
    expect(storedToUnit(free).stats).toEqual({ metalCost: 0 });
    expect(storedToUnit(unsaid).stats).toEqual({});
  });

  it("stores what the page reads and nothing else", () => {
    const stored = unitToStored({
      name: "fedtank",
      fullName: "Tank",
      mobile: true,
      objectName: "fedtank.s3o",
      footprintX: 3,
      footprintZ: 3,
      buildOptions: [],
      stats: {
        metalCost: 120,
        energyCost: 900,
        health: 800,
        weapons: [{ damage: 40, range: 300 }],
        builder: false,
        radarDistance: 0,
      },
    });
    expect(stored).toEqual({
      name: "fedtank",
      humanName: "Tank",
      metalCost: 120,
      energyCost: 900,
      mobile: true,
      armed: true,
      radarDistance: 0,
    });
  });

  it("drops a number that is not one", () => {
    const stored = unitToStored({
      name: "odd",
      stats: { metalCost: Number.NaN, energyCost: "12", metalMake: Infinity },
    });
    expect(stored).toEqual({ name: "odd" });
  });
});

describe("storedListFor", () => {
  const stream = link({ origin: "folder" });
  const events = link({ digest: `sha256:${"b".repeat(64)}`, origin: "engine" });
  const sets: ReplayUnitDefSets = {
    links: [stream, events],
    stream,
    events,
    sets: {
      [stream.digest]: [{ name: "a", humanName: "Alpha", mobile: true }],
      [events.digest]: [{ name: "b" }, { name: "c" }],
    },
  };

  it("hands back the list that names each kind of id", () => {
    expect(storedListFor(sets, "stream")?.units.map((u) => u.name)).toEqual([
      "a",
    ]);
    expect(storedListFor(sets, "events")?.units.map((u) => u.name)).toEqual([
      "b",
      "c",
    ]);
    expect(storedListFor(sets, "stream")?.link).toBe(stream);
  });

  it("has nothing for a replay with no list, or a link whose list is gone", () => {
    expect(storedListFor(null, "stream")).toBeNull();
    expect(storedListFor({ ...sets, stream: null }, "stream")).toBeNull();
    expect(storedListFor({ ...sets, sets: {} }, "events")).toBeNull();
  });
});

describe("orderFit", () => {
  const units: UnitDatasetEntry[] = [
    { name: "factory", mobile: false },
    { name: "tank", mobile: true },
    { name: "solar" },
  ];
  const placed = (unitDefId: number) => ({
    unitDefId,
    position: { x: 1, y: 0, z: 1 },
  });
  const queued = (unitDefId: number) => ({ unitDefId });

  it("finds nothing wrong when buildings are placed and units are queued", () => {
    const fit = orderFit([placed(1), placed(3), queued(2)], units);
    expect(fit).toEqual({
      orders: 3,
      outOfRange: 0,
      placedMobile: 0,
      queuedStatic: 0,
    });
    expect(misfits(fit)).toBe(0);
  });

  it("counts each way an order can contradict the list", () => {
    const fit = orderFit(
      [placed(2), queued(1), queued(3), placed(4), queued(0), placed(1)],
      units,
    );
    expect(fit).toEqual({
      orders: 6,
      outOfRange: 2,
      placedMobile: 1,
      queuedStatic: 2,
    });
    expect(misfits(fit)).toBe(5);
  });

  it("fits a real game's list and not that list moved along by one", () => {
    // Every building placed and every unit that moves queued, which is what
    // a replay read against the right list looks like.
    const orders = UNITS.map((unit, i) =>
      unit.mobile ? queued(i + 1) : placed(i + 1),
    );
    expect(misfits(orderFit(orders, UNITS))).toBe(0);
    // One definition the engine refused, or one a mod option added.
    expect(misfits(orderFit(orders, UNITS.slice(1)))).toBeGreaterThan(0);
  });

  it("has nothing to say about a replay with no orders", () => {
    expect(misfits(orderFit([], units))).toBe(0);
  });
});

describe("storedListSentence", () => {
  const date = listDate(link());

  it("says a packaged archive's list was recorded when the replay was read", () => {
    expect(storedListSentence(link())).toBe(
      `Unit names come from the unit list recorded when this replay was read on ${date}, from SplinterFaction 0.1.88.`,
    );
  });

  it("says a list from a loose folder came from one, in the same sentence", () => {
    expect(
      storedListSentence(
        link({ origin: "folder", game: "SplinterFaction $VERSION" }),
      ),
    ).toBe(
      `Unit names come from the unit list recorded when this replay was read on ${date}, from SplinterFaction $VERSION, a loose game folder that can change under that name.`,
    );
  });

  it("says the engine wrote its own list, and names the game it ran", () => {
    expect(
      storedListSentence(link({ origin: "engine" }), "Costs and kinds"),
    ).toBe(
      `Costs and kinds come from the unit list the engine wrote when this replay was analysed on ${date}, on SplinterFaction 0.1.88.`,
    );
  });
});
