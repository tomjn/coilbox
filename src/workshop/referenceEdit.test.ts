import { describe, expect, it } from "vitest";
import {
  editableColumnIds,
  isEditableColumn,
  referenceCell,
  setReferenceValue,
} from "./referenceEdit";

const units = {
  armpw: { maxdamage: 300, buildcostmetal: 45, name: "Peewee" },
  armtank: { health: 1000 },
};

describe("isEditableColumn", () => {
  it("offers raw def fields and never a derived number", () => {
    expect(isEditableColumn("health")).toBe(true);
    expect(isEditableColumn("metalCost")).toBe(true);
    expect(isEditableColumn("dps")).toBe(false);
    expect(isEditableColumn("maxRange")).toBe(false);
  });

  it("lists the editable columns in table order", () => {
    expect(editableColumnIds()).toEqual([
      "health",
      "metalCost",
      "buildTime",
      "sightDistance",
      "speed",
    ]);
  });
});

describe("referenceCell", () => {
  it("reads the game's value under the def's own spelling", () => {
    expect(referenceCell(units, {}, "armpw", "health")).toEqual({
      path: "maxdamage",
      value: 300,
      gameValue: 300,
      edited: false,
    });
  });

  it("reports an edited cell alongside the game's value", () => {
    expect(
      referenceCell(units, { armpw: { maxdamage: 330 } }, "armpw", "health"),
    ).toEqual({ path: "maxdamage", value: 330, gameValue: 300, edited: true });
  });

  it("has no cell for a derived column or a field the unit lacks", () => {
    expect(referenceCell(units, {}, "armpw", "dps")).toBeUndefined();
    expect(referenceCell(units, {}, "armpw", "speed")).toBeUndefined();
  });
});

describe("setReferenceValue", () => {
  it("writes an override under the def's own spelling", () => {
    expect(setReferenceValue({}, units, "armpw", "health", 400)).toEqual({
      armpw: { maxdamage: 400 },
    });
  });

  it("drops the override when the game's value is typed back", () => {
    expect(
      setReferenceValue(
        { armpw: { maxdamage: 400 } },
        units,
        "armpw",
        "health",
        300,
      ),
    ).toEqual({});
  });

  it("changes nothing for a column it cannot write", () => {
    const overrides = {};
    expect(setReferenceValue(overrides, units, "armpw", "dps", 5)).toBe(
      overrides,
    );
    expect(setReferenceValue(overrides, units, "armpw", "speed", 5)).toBe(
      overrides,
    );
  });
});
