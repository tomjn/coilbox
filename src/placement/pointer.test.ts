import { describe, expect, it } from "vitest";
import {
  clampToMap,
  isClick,
  pointerNdc,
  pointerTargets,
  pressGesture,
} from "./pointer";

describe("isClick", () => {
  it("counts a still pointer as a click", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 12, y: 8 })).toBe(true);
  });

  it("counts a travelled pointer as a drag", () => {
    expect(isClick({ x: 10, y: 10 }, { x: 40, y: 10 })).toBe(false);
    expect(isClick({ x: 10, y: 10 }, { x: 10, y: 40 })).toBe(false);
  });
});

describe("pointerTargets", () => {
  /** A zone's sheet is the one thing a press cannot pick up. */
  const grabbable = (key: string) =>
    !key.startsWith("zone:") || key.includes("@");

  it("finds nothing under a pointer on bare ground", () => {
    expect(pointerTargets([], grabbable)).toEqual({ select: null, grab: null });
  });

  it("selects and grabs the nearest thing when it can be picked up", () => {
    expect(pointerTargets(["actor:a1", "zone:z1"], grabbable)).toEqual({
      select: "actor:a1",
      grab: "actor:a1",
    });
  });

  it("grabs a handle through the sheet lying over it", () => {
    // A zone's move handle sits at the middle of its own sheet, and other
    // zones' sheets drape over it, so the sheet is the nearer hit. Without
    // this the handle could not be grabbed at all.
    expect(
      pointerTargets(["zone:z1", "zone:z2@move", "zone:z2"], grabbable),
    ).toEqual({ select: "zone:z1", grab: "zone:z2@move" });
  });

  it("has nothing to grab where there are only sheets", () => {
    // Panning past a zone that fills the view (#910), and drawing a zone
    // inside another (#837), are both this.
    expect(pointerTargets(["zone:z1", "zone:z2"], grabbable)).toEqual({
      select: "zone:z1",
      grab: null,
    });
  });
});

describe("pressGesture", () => {
  it("picks up what the press can grab", () => {
    expect(pressGesture({ grab: "actor:a1", draws: false })).toBe("grab");
    // Even in a mode that draws: a unit is a thing, not the ground under it.
    expect(pressGesture({ grab: "actor:a1", draws: true })).toBe("grab");
  });

  it("leaves the rest to the camera, or to the mode that draws", () => {
    expect(pressGesture({ grab: null, draws: false })).toBe("camera");
    expect(pressGesture({ grab: null, draws: true })).toBe("draw");
  });
});

describe("pointerNdc", () => {
  const rect = { left: 20, top: 40, width: 200, height: 100 };

  it("puts the centre at the origin", () => {
    const at = pointerNdc({ x: 120, y: 90 }, rect);
    expect(at.x).toBeCloseTo(0);
    expect(at.y).toBeCloseTo(0);
  });

  it("puts the top left at -1, 1", () => {
    expect(pointerNdc({ x: 20, y: 40 }, rect)).toEqual({ x: -1, y: 1 });
  });

  it("survives a canvas with no size", () => {
    expect(
      pointerNdc({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 }),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("clampToMap", () => {
  it("holds a point inside the map", () => {
    expect(clampToMap({ x: -50, z: 9000 }, 4096, 4096)).toEqual({
      x: 0,
      z: 4096,
    });
  });

  it("leaves a point on the map alone", () => {
    expect(clampToMap({ x: 10, z: 20 }, 4096, 4096)).toEqual({ x: 10, z: 20 });
  });
});
