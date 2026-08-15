import { describe, expect, it } from "vitest";
import {
  placeholderBox,
  placeholderLabel,
  placeholderMeasure,
} from "./placeholder";

describe("placeholderBox", () => {
  it("draws a square when nothing knew the size", () => {
    expect(placeholderBox(null)).toEqual({ width: 100, height: 100 });
  });

  it("draws a square map square", () => {
    expect(placeholderBox({ width: 12, height: 12 })).toEqual({
      width: 100,
      height: 100,
    });
  });

  it("normalises a wide map so its longer side is the same as every other", () => {
    expect(placeholderBox({ width: 24, height: 12 })).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("normalises a tall map the same way", () => {
    expect(placeholderBox({ width: 8, height: 16 })).toEqual({
      width: 50,
      height: 100,
    });
  });

  it("caps a nonsense ratio rather than drawing a one pixel line", () => {
    expect(placeholderBox({ width: 4000, height: 1 })).toEqual({
      width: 100,
      height: 12.5,
    });
  });

  it("draws a square rather than an empty viewBox for a zero side", () => {
    expect(placeholderBox({ width: 12, height: 0 })).toEqual({
      width: 100,
      height: 100,
    });
  });

  it("draws a square rather than a NaN viewBox", () => {
    expect(placeholderBox({ width: Number.NaN, height: 12 })).toEqual({
      width: 100,
      height: 100,
    });
  });
});

describe("placeholderMeasure", () => {
  it("says the size the way a player names one, with no unit after it", () => {
    expect(
      placeholderMeasure({ name: "Isthmus", size: { width: 12, height: 12 } }),
    ).toBe("12 by 12");
  });

  it("says nothing when nothing knew the size", () => {
    expect(placeholderMeasure({ name: "Isthmus", size: null })).toBeNull();
  });

  it("says nothing rather than a measurement nobody can act on", () => {
    expect(
      placeholderMeasure({ name: "Isthmus", size: { width: -4, height: 12 } }),
    ).toBeNull();
  });

  it("rounds a fraction somebody else's list put in", () => {
    expect(
      placeholderMeasure({
        name: "Isthmus",
        size: { width: 11.96, height: 12 },
      }),
    ).toBe("12 by 12");
  });
});

describe("placeholderLabel", () => {
  it("tells a screen reader there is no picture, not that there is a box", () => {
    expect(
      placeholderLabel({ name: "Isthmus", size: { width: 12, height: 12 } }),
    ).toBe("No picture of Isthmus, a 12 by 12 map");
  });

  it("still names the map when the size is unknown", () => {
    expect(placeholderLabel({ name: "Isthmus", size: null })).toBe(
      "No picture of Isthmus",
    );
  });
});
