import { describe, expect, it } from "vitest";

import { controlFor } from "./unitValueControls";

describe("controlFor", () => {
  it("gives a switch to a value that is only ever on or off", () => {
    const control = controlFor(1, "ACTIVATION");

    expect(control).toEqual({ kind: "switch", label: "Activation" });
  });

  it("gives a 0 to 100 percent slider to a value already on that scale", () => {
    const control = controlFor(4, "HEALTH");
    if (control.kind !== "slider")
      throw new Error(`expected a slider: ${control.kind}`);

    expect(control.label).toBe("Health");
    expect(control.min).toBe(0);
    expect(control.max).toBe(100);
    expect(control.suffix).toBe("%");
    expect(control.toDisplay(42)).toBe(42);
    expect(control.toRaw(42)).toBe(42);
  });

  it("offers standing move orders as a select of the engine's three states", () => {
    const control = controlFor(2, "STANDINGMOVEORDERS");
    if (control.kind !== "select")
      throw new Error(`expected a select: ${control.kind}`);

    expect(control.label).toBe("Move orders");
    expect(control.options).toEqual([
      { value: 0, label: "Hold position" },
      { value: 1, label: "Manoeuvre" },
      { value: 2, label: "Roam" },
    ]);
  });

  it("offers standing fire orders as a select of the engine's three states", () => {
    const control = controlFor(3, "STANDINGFIREORDERS");
    if (control.kind !== "select")
      throw new Error(`expected a select: ${control.kind}`);

    expect(control.options).toEqual([
      { value: 0, label: "Hold fire" },
      { value: 1, label: "Return fire" },
      { value: 2, label: "Fire at will" },
    ]);
  });

  it("shows heading in degrees and stores it as a COB angle", () => {
    const control = controlFor(82, "HEADING");
    if (control.kind !== "slider")
      throw new Error(`expected a slider: ${control.kind}`);

    expect(control.min).toBe(-180);
    expect(control.max).toBe(180);
    // A quarter turn is 16384 of COB's 65536ths of a circle.
    expect(control.toDisplay(16384)).toBeCloseTo(90);
    expect(control.toRaw(90)).toBe(16384);
  });

  it("shows speed in elmos a frame and stores it as a fixed-point number", () => {
    const control = controlFor(29, "CURRENT_SPEED");
    if (control.kind !== "slider")
      throw new Error(`expected a slider: ${control.kind}`);

    expect(control.min).toBe(0);
    expect(control.max).toBe(2);
    expect(control.step).toBe(0.05);
    expect(control.toDisplay(65536)).toBe(1);
    expect(control.toRaw(1)).toBe(65536);
  });

  it("falls back to the engine's own name, sentence-cased, for anything else named", () => {
    const control = controlFor(129, "WEAPON_RANGE");

    expect(control).toEqual({ kind: "number", label: "Weapon range" });
  });

  it("falls back to a number input naming the id when nothing named it", () => {
    const control = controlFor(2048, null);

    expect(control).toEqual({ kind: "number", label: "Value 2048" });
  });
});
