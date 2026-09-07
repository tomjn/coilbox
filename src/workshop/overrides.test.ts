import { describe, expect, it } from "vitest";
import {
  clearOverride,
  clearUnit,
  fieldState,
  overriddenPaths,
  overrideCount,
  overrideValue,
  readPath,
  resolvedDef,
  sameValue,
  setOverride,
  type UnitOverrides,
} from "./overrides";

/** A stand-in for a game's own unit table, with the shapes the worker sends. */
const def: Record<string, unknown> = {
  name: "armcom",
  health: 3000,
  metalCost: 1200,
  canFly: false,
  collisionVolume: { type: "b", scales: [30, 40, 30] },
  weapons: [{ name: "disintegrator" }, { name: "armcomlaser" }],
  customParams: { model_author: "somebody" },
};

describe("readPath", () => {
  it("reads a root key", () => {
    expect(readPath(def, "health")).toBe(3000);
  });

  it("reads through tables and array indices", () => {
    expect(readPath(def, "collisionVolume.type")).toBe("b");
    expect(readPath(def, "weapons.1.name")).toBe("armcomlaser");
  });

  it("answers undefined for a path the table does not reach", () => {
    expect(readPath(def, "weapons.9.name")).toBeUndefined();
    expect(readPath(def, "nothingLikeThis")).toBeUndefined();
    expect(readPath(undefined, "health")).toBeUndefined();
  });

  it("does not walk into a scalar", () => {
    expect(readPath(def, "health.somethingElse")).toBeUndefined();
  });
});

describe("sameValue", () => {
  it("compares scalars", () => {
    expect(sameValue(3000, 3000)).toBe(true);
    expect(sameValue(3000, "3000")).toBe(false);
    expect(sameValue(false, undefined)).toBe(false);
    expect(sameValue(null, undefined)).toBe(false);
  });

  it("compares arrays and tables by value", () => {
    expect(sameValue([30, 40, 30], [30, 40, 30])).toBe(true);
    expect(sameValue([30, 40, 30], [30, 40, 31])).toBe(false);
    expect(sameValue({ type: "b" }, { type: "b" })).toBe(true);
    expect(sameValue({ type: "b" }, { type: "b", axis: "y" })).toBe(false);
  });
});

describe("setOverride", () => {
  it("records the edit and nothing else", () => {
    const after = setOverride({}, "armcom", "health", 5000, 3000);
    expect(after).toEqual({ armcom: { health: 5000 } });
  });

  it("keeps earlier edits and other units", () => {
    const first = setOverride({}, "armcom", "health", 5000, 3000);
    const second = setOverride(first, "armcom", "metalCost", 1, 1200);
    const third = setOverride(second, "corcom", "health", 10, 3000);
    expect(third).toEqual({
      armcom: { health: 5000, metalCost: 1 },
      corcom: { health: 10 },
    });
  });

  it("does not mutate what it was given", () => {
    const before: UnitOverrides = { armcom: { health: 5000 } };
    setOverride(before, "armcom", "metalCost", 1, 1200);
    expect(before).toEqual({ armcom: { health: 5000 } });
  });

  /**
   * The rule issue #1271 exists for. Writing the inherited value back is not an
   * edit, so it leaves no key behind to freeze the game's number.
   */
  it("stores nothing when the value equals what was inherited", () => {
    expect(setOverride({}, "armcom", "health", 3000, 3000)).toEqual({});
    expect(
      setOverride({}, "armcom", "collisionVolume.scales", [1, 2, 3], [1, 2, 3]),
    ).toEqual({});
  });

  it("drops an existing override when it is set back to the inherited value", () => {
    const edited = setOverride({}, "armcom", "health", 5000, 3000);
    expect(setOverride(edited, "armcom", "health", 3000, 3000)).toEqual({});
  });
});

/**
 * The guarantee that makes a tweak project age: a field nobody touched is
 * absent, so a later game update still reaches it. Everything else in this file
 * is in service of this test.
 */
describe("the override set stays sparse", () => {
  it("holds only the fields that were edited, out of every field the unit has", () => {
    const paths = [
      "name",
      "health",
      "metalCost",
      "canFly",
      "collisionVolume.type",
      "collisionVolume.scales",
      "weapons.0.name",
      "weapons.1.name",
      "customParams",
    ];

    // Open every field on the page, which for the real page means rendering a
    // row that reads its inherited value. Reading must never write.
    let overrides: UnitOverrides = {};
    for (const path of paths) {
      expect(fieldState(overrides, "armcom", path)).toBe("inherited");
      expect(overrideValue(overrides, "armcom", path)).toBeUndefined();
    }
    expect(overrides).toEqual({});

    // Change exactly one of them.
    overrides = setOverride(
      overrides,
      "armcom",
      "health",
      5000,
      readPath(def, "health"),
    );

    expect(overriddenPaths(overrides, "armcom")).toEqual(["health"]);
    expect(overrideCount(overrides)).toBe(1);
    for (const path of paths.filter((p) => p !== "health")) {
      expect(fieldState(overrides, "armcom", path)).toBe("inherited");
      expect(Object.hasOwn(overrides.armcom, path)).toBe(false);
    }

    // Reset it, and the project is back to holding nothing at all, not an empty
    // unit table standing in for one.
    const reset = clearOverride(overrides, "armcom", "health");
    expect(reset).toEqual({});
    expect(Object.hasOwn(reset, "armcom")).toBe(false);
    expect(overrideCount(reset)).toBe(0);
  });
});

describe("fieldState", () => {
  it("calls a field with a key overridden, even when the value is falsy", () => {
    const overrides = setOverride({}, "armcom", "canFly", true, false);
    expect(fieldState(overrides, "armcom", "canFly")).toBe("overridden");
    const zeroed = setOverride({}, "armcom", "health", 0, 3000);
    expect(fieldState(zeroed, "armcom", "health")).toBe("overridden");
    expect(overrideValue(zeroed, "armcom", "health")).toBe(0);
  });
});

describe("clearOverride", () => {
  it("leaves the other edits on the unit alone", () => {
    const overrides: UnitOverrides = {
      armcom: { health: 5000, metalCost: 1 },
      corcom: { health: 10 },
    };
    expect(clearOverride(overrides, "armcom", "health")).toEqual({
      armcom: { metalCost: 1 },
      corcom: { health: 10 },
    });
  });

  it("returns the same object for a path that was never overridden", () => {
    const overrides: UnitOverrides = { armcom: { health: 5000 } };
    expect(clearOverride(overrides, "armcom", "metalCost")).toBe(overrides);
    expect(clearOverride(overrides, "corcom", "health")).toBe(overrides);
  });
});

describe("resolvedDef", () => {
  it("writes each edit into a copy and leaves the rest alone", () => {
    const out = resolvedDef(def, {
      health: 5000,
      "weapons.1.name": "bigger",
      "collisionVolume.scales": [1, 2, 3],
    });
    expect(out.health).toBe(5000);
    expect(out.weapons).toEqual([
      { name: "disintegrator" },
      { name: "bigger" },
    ]);
    expect(out.metalCost).toBe(1200);
    expect(readPath(out, "collisionVolume.scales")).toEqual([1, 2, 3]);
  });

  it("creates a path the definition does not have", () => {
    const out = resolvedDef({}, { sonarDistance: 400, "weapons.0.name": "x" });
    expect(out.sonarDistance).toBe(400);
    expect(out.weapons).toEqual([{ name: "x" }]);
  });

  it("never reaches back into the definition it read", () => {
    const out = resolvedDef(def, { health: 5000 });
    (out.weapons as { name: string }[])[0].name = "nothing";
    (out.collisionVolume as { scales: number[] }).scales[0] = 99;
    expect(def.health).toBe(3000);
    expect(readPath(def, "weapons.0.name")).toBe("disintegrator");
    expect(readPath(def, "collisionVolume.scales")).toEqual([30, 40, 30]);
  });

  it("is the definition itself when nothing was edited", () => {
    expect(resolvedDef(def, undefined)).toEqual(def);
    expect(resolvedDef(undefined, undefined)).toEqual({});
  });
});

describe("clearUnit", () => {
  it("forgets one unit and keeps the rest", () => {
    const overrides: UnitOverrides = {
      armcom: { health: 5000 },
      corcom: { health: 10 },
    };
    expect(clearUnit(overrides, "armcom")).toEqual({ corcom: { health: 10 } });
    expect(clearUnit(overrides, "nothing")).toBe(overrides);
  });
});
