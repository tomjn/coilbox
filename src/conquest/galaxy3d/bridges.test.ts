import { describe, expect, it } from "vitest";
import { straightenOverRivers } from "./bridges";
import type { MapXY } from "./roadRoute";

// A river running down x = 50, half width 0.05 world units, at 0.1 world
// units a map unit.
const SCALE = 0.1;
const river = new Float32Array([50, 0, 0.05, 50, 100, 0.05]);

/** Distance from point `p` to the line through `a` and `b`. */
function offLine(p: MapXY, a: MapXY, b: MapXY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return (
    Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) /
    Math.sqrt(dx * dx + dy * dy)
  );
}

describe("straightenOverRivers", () => {
  it("runs a road straight over a river it bends across", () => {
    // Bends at the water: in from the left going down and out going up.
    const line: MapXY[] = [
      [0, 40],
      [49, 49],
      [50, 50],
      [51, 49],
      [100, 40],
    ];
    const out = straightenOverRivers(line, [river], SCALE);
    // No corner within two map units of the water, so the bridge and its
    // approaches are one straight stretch.
    expect(out.filter((p) => Math.abs(p[0] - 50) < 2)).toEqual([]);
    const k = out.findIndex((p, i) => i > 0 && out[i - 1][0] < 50 && p[0] > 50);
    expect(k).toBeGreaterThan(0);
    // The ends stay where they were.
    expect(out[0]).toEqual([0, 40]);
    expect(out[out.length - 1]).toEqual([100, 40]);
  });

  it("leaves a road that crosses no river alone", () => {
    const line: MapXY[] = [
      [0, 0],
      [10, 5],
      [20, 0],
    ];
    expect(straightenOverRivers(line, [river], SCALE)).toEqual(line);
  });

  it("joins two crossings close together into one straight run", () => {
    const second = new Float32Array([51, 0, 0.05, 51, 100, 0.05]);
    const line: MapXY[] = [
      [0, 50],
      [50.5, 52],
      [100, 50],
    ];
    const out = straightenOverRivers(line, [river, second], SCALE);
    const near = out.filter((p) => Math.abs(p[0] - 50.5) < 2);
    for (const p of near)
      expect(offLine(p, near[0], near[near.length - 1])).toBeLessThan(1e-9);
  });
});
