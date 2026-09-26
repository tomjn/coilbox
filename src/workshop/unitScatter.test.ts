import { describe, expect, it } from "vitest";
import { type UnitReferenceRow, unitReferenceRow } from "./unitReference";
import {
  canLogColumn,
  computeScatterPoints,
  DEFAULT_X_COLUMN,
  DEFAULT_Y_COLUMN,
  referenceColumn,
} from "./unitScatter";

const laser = {
  weaponType: "Cannon",
  range: 300,
  reloadTime: 2,
  damage: { default: 50 },
};

function row(key: string, overrides: Record<string, unknown> = {}) {
  return unitReferenceRow(
    key,
    key,
    {
      health: 1000,
      metalCost: 200,
      weapons: [{ name: `${key}_laser` }],
      weapondefs: { laser },
      ...overrides,
    },
    {},
  );
}

describe("default axes", () => {
  it("defaults to metal cost against DPS (issue #3115)", () => {
    expect(DEFAULT_X_COLUMN).toBe("metalCost");
    expect(DEFAULT_Y_COLUMN).toBe("dps");
  });
});

describe("canLogColumn", () => {
  it("offers a log toggle for cost and health only", () => {
    expect(canLogColumn("metalCost")).toBe(true);
    expect(canLogColumn("health")).toBe(true);
    expect(canLogColumn("dps")).toBe(false);
    expect(canLogColumn("sightDistance")).toBe(false);
  });
});

describe("referenceColumn", () => {
  it("finds a column by id", () => {
    expect(referenceColumn("metalCost").label).toBe("Metal cost");
  });
});

describe("computeScatterPoints", () => {
  const xColumn = referenceColumn("metalCost");
  const yColumn = referenceColumn("dps");

  it("plots each row against the chosen axes", () => {
    const rows = [row("armtank"), row("corcom", { metalCost: 1000 })];
    const points = computeScatterPoints(rows, xColumn, yColumn, false, false);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ key: "armtank", x: 200 });
    expect(points[1]).toMatchObject({ key: "corcom", x: 1000 });
  });

  it("leaves off a row missing either axis's value", () => {
    const rows = [row("armtank"), row("noweapon", { weapons: [] })];
    const points = computeScatterPoints(rows, xColumn, yColumn, false, false);
    expect(points.map((p) => p.key)).toEqual(["armtank"]);
  });

  it("has no ghost when there is no baseline to compare against", () => {
    const rows = [row("armtank")];
    const points = computeScatterPoints(rows, xColumn, yColumn, false, false);
    expect(points[0].ghost).toBeUndefined();
  });

  it("has no ghost when the baseline is the same as the current row", () => {
    const rows = [row("armtank")];
    const baselineOf = () => row("armtank");
    const points = computeScatterPoints(
      rows,
      xColumn,
      yColumn,
      false,
      false,
      baselineOf,
    );
    expect(points[0].ghost).toBeUndefined();
  });

  it("draws a ghost at the game's position for a unit the project changed", () => {
    const rows = [row("armtank", { metalCost: 400 })];
    const baseline: Record<string, UnitReferenceRow> = {
      armtank: row("armtank", { metalCost: 200 }),
    };
    const points = computeScatterPoints(
      rows,
      xColumn,
      yColumn,
      false,
      false,
      (key) => baseline[key],
    );
    expect(points[0].x).toBe(400);
    expect(points[0].ghost).toEqual({ x: 200, y: points[0].y });
  });

  it("has no ghost for a unit the game never had, such as a project's own clone", () => {
    const rows = [row("mynewunit")];
    const points = computeScatterPoints(
      rows,
      xColumn,
      yColumn,
      false,
      false,
      () => undefined,
    );
    expect(points[0].ghost).toBeUndefined();
  });

  it("drops a non-positive value off a log-scale axis", () => {
    const rows = [row("free", { metalCost: 0 }), row("armtank")];
    const points = computeScatterPoints(rows, xColumn, yColumn, true, false);
    expect(points.map((p) => p.key)).toEqual(["armtank"]);
  });

  it("drops a ghost whose own baseline value is non-positive on a log axis", () => {
    const rows = [row("armtank", { metalCost: 400 })];
    const baseline: Record<string, UnitReferenceRow> = {
      armtank: row("armtank", { metalCost: 0 }),
    };
    const points = computeScatterPoints(
      rows,
      xColumn,
      yColumn,
      true,
      false,
      (key) => baseline[key],
    );
    expect(points[0].x).toBe(400);
    expect(points[0].ghost).toBeUndefined();
  });
});
