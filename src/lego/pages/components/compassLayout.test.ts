import { describe, expect, it } from "vitest";
import { COMPASS_ENDS, COMPASS_MID, compassEnds } from "./compassLayout";

/** The axes as a camera looking from +z sees them. */
const FRONT = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
} as const;

function place(
  seen: Record<"x" | "y" | "z", readonly [number, number, number]>,
) {
  return compassEnds(seen as Record<"x" | "y" | "z", [number, number, number]>);
}

describe("compassEnds", () => {
  it("places the positive end of an axis opposite its negative end", () => {
    const ends = place(FRONT);
    const x = ends.find((end) => end.id === "x+");
    const minusX = ends.find((end) => end.id === "x-");
    expect(x && minusX && x.x - COMPASS_MID).toBeCloseTo(
      COMPASS_MID - (minusX?.x ?? 0),
    );
    expect(x?.x).toBeGreaterThan(COMPASS_MID);
    expect(minusX?.x).toBeLessThan(COMPASS_MID);
  });

  it("puts +y above the middle, as the screen y grows downward", () => {
    const y = place(FRONT).find((end) => end.id === "y+");
    expect(y?.y).toBeLessThan(COMPASS_MID);
  });

  it("moves the axis that points at the camera out of the middle, one end each way", () => {
    const ends = place(FRONT);
    const front = ends.find((end) => end.id === "z+");
    const back = ends.find((end) => end.id === "z-");
    expect(
      Math.hypot((front?.x ?? 0) - COMPASS_MID, (front?.y ?? 0) - COMPASS_MID),
    ).toBeGreaterThan(24 - 1e-6);
    expect((front?.x ?? 0) - COMPASS_MID).toBeCloseTo(
      COMPASS_MID - (back?.x ?? 0),
    );
  });

  it("calls the end pointing at the camera near and the one behind it far", () => {
    const ends = place(FRONT);
    expect(ends.find((end) => end.id === "z+")?.towards).toBe(1);
    expect(ends.find((end) => end.id === "z-")?.towards).toBe(0);
  });

  it("has one end for each of the six views", () => {
    expect(new Set(COMPASS_ENDS.map((end) => end.view)).size).toBe(6);
  });
});
