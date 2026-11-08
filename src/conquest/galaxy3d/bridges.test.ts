import { describe, expect, it } from "vitest";
import { straightenOverRivers } from "./bridges";
import type { MapXY } from "./roadRoute";

// A river running down x = 50, half width 0.5 map units, at 0.1 world units
// a map unit.
const SCALE = 0.1;
const river = new Float32Array([50, 0, 0.5, 50, 100, 0.5]);

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
    const second = new Float32Array([52, 0, 0.5, 52, 100, 0.5]);
    const line: MapXY[] = [
      [0, 50],
      [51, 53],
      [100, 50],
    ];
    const out = straightenOverRivers(line, [river, second], SCALE);
    // One stretch from before the first river to past the second, with no
    // corner between.
    const k = out.findIndex((p, i) => i > 0 && out[i - 1][0] < 50 && p[0] > 52);
    expect(k).toBeGreaterThan(0);
    expect(out.filter((p) => p[0] > 49 && p[0] < 53)).toEqual([]);
  });
});
