import { describe, expect, it } from "vitest";
import { snapAnchorsShown, snappingActive } from "./snapAnchorsShown";

describe("snappingActive", () => {
  it("snaps when it is on and Alt is up", () => {
    expect(snappingActive(true, false)).toBe(true);
  });

  it("places freely while Alt is held", () => {
    expect(snappingActive(true, true)).toBe(false);
  });

  it("places freely with the toggle off, Alt or not", () => {
    expect(snappingActive(false, false)).toBe(false);
    expect(snappingActive(false, true)).toBe(false);
  });
});

describe("snapAnchorsShown", () => {
  it("shows the snap points only while a piece moves with snapping on", () => {
    expect(snapAnchorsShown(true, true)).toBe(true);
    expect(snapAnchorsShown(true, false)).toBe(false);
  });

  it("hides them with snapping off, even mid-move", () => {
    expect(snapAnchorsShown(false, true)).toBe(false);
    expect(snapAnchorsShown(false, false)).toBe(false);
  });
});
