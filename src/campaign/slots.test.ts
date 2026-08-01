import { describe, expect, it } from "vitest";
import { clampSpin, slotSourceValue, sourceToSlot } from "./slots";

describe("slotSourceValue", () => {
  it("reads an empty slot as the image source", () => {
    expect(slotSourceValue({})).toBe("image");
  });

  it("reads each map style back as its own option", () => {
    expect(slotSourceValue({ map: { style: "textured" } })).toBe(
      "map-textured",
    );
    expect(slotSourceValue({ map: { style: "heightmap" } })).toBe(
      "map-heightmap",
    );
  });

  it("reads a unit slot as the unit source", () => {
    expect(slotSourceValue({ unit: { unitDef: "armcom" } })).toBe("unit");
  });
});

describe("sourceToSlot", () => {
  it("clears both configs for the image source", () => {
    expect(
      sourceToSlot("image", { unit: { unitDef: "armcom", spinSpeed: 2 } }),
    ).toEqual({});
  });

  it("never sets both configs at once", () => {
    const toUnit = sourceToSlot("unit", { map: { style: "textured" } });
    expect(toUnit.map).toBeUndefined();
    expect(toUnit.unit).toBeDefined();

    const toMap = sourceToSlot("map-textured", { unit: { unitDef: "armcom" } });
    expect(toMap.unit).toBeUndefined();
    expect(toMap.map).toBeDefined();
  });

  it("seeds a first unit choice with a default spin speed and no unit", () => {
    expect(sourceToSlot("unit", {}).unit).toEqual({
      unitDef: "",
      spinSpeed: 1,
    });
  });

  it("keeps the unit's tuning when only the unit changes under it", () => {
    const prev = { unit: { unitDef: "armcom", spinSpeed: -2 } };
    expect(sourceToSlot("unit", prev).unit).toEqual({
      unitDef: "armcom",
      spinSpeed: -2,
    });
  });

  it("keeps map tuning when only the style changes", () => {
    const prev = { map: { style: "textured" as const, spinSpeed: 3 } };
    expect(sourceToSlot("map-heightmap", prev).map).toEqual({
      style: "heightmap",
      spinSpeed: 3,
    });
  });
});

describe("clampSpin", () => {
  it("defaults to 1", () => {
    expect(clampSpin(undefined)).toBe(1);
  });

  it("clamps the magnitude to the slider range", () => {
    expect(clampSpin(9)).toBe(4);
    expect(clampSpin(0.1)).toBe(0.25);
  });

  it("clamps the magnitude but keeps a reversed direction", () => {
    expect(clampSpin(-9)).toBe(-4);
    expect(clampSpin(-0.1)).toBe(-0.25);
    expect(clampSpin(-2)).toBe(-2);
  });
});
