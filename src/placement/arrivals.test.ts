/**
 * Issue #1716. The layers redraw everything on every edit, so the only way an
 * arrival can be told from a redraw is by name, and the only reason to keep this
 * arithmetic out of the layer is that the layer cannot be tested.
 */

import { describe, expect, it } from "vitest";

import { arrivals, eased, fadeAt, pulseAt } from "./arrivals";

describe("arrivals", () => {
  it("reports nothing when a pass draws what the last one drew", () => {
    expect(arrivals(["a", "b"], ["a", "b"])).toEqual({ arrived: [], left: [] });
  });

  it("reports a name the last pass did not have as arrived", () => {
    expect(arrivals(["a"], ["a", "b"])).toEqual({ arrived: ["b"], left: [] });
  });

  it("reports a name this pass has stopped drawing as gone", () => {
    expect(arrivals(["a", "b"], ["a"])).toEqual({ arrived: [], left: ["b"] });
  });

  /** A move is one thing leaving and another arriving, because a name says
   *  where a thing stands. That is what makes a dragged building land rather
   *  than teleport. */
  it("reads a move as one leaving and one arriving", () => {
    expect(arrivals(["at-1"], ["at-2"])).toEqual({
      arrived: ["at-2"],
      left: ["at-1"],
    });
  });

  it("starts every name off as an arrival", () => {
    expect(arrivals([], ["a", "b"]).arrived).toEqual(["a", "b"]);
  });
});

describe("fadeAt", () => {
  it("runs from nothing to all of it over the duration", () => {
    expect(fadeAt(0, 200)).toBe(0);
    expect(fadeAt(100, 200)).toBe(0.5);
    expect(fadeAt(200, 200)).toBe(1);
  });

  it("holds at the end rather than running past it", () => {
    expect(fadeAt(900, 200)).toBe(1);
  });

  /** What switches the animation off: a duration of nothing is a fade that has
   *  already finished, so a layer that does not animate draws everything solid
   *  on the first frame. */
  it("finishes at once when there is no duration", () => {
    expect(fadeAt(0, 0)).toBe(1);
  });
});

describe("eased", () => {
  it("starts at nothing and ends at all of it", () => {
    expect(eased(0)).toBe(0);
    expect(eased(1)).toBe(1);
  });

  it("is further along than a linear fade in the middle", () => {
    expect(eased(0.5)).toBeGreaterThan(0.5);
  });
});

describe("pulseAt", () => {
  it("stays between the two ends", () => {
    for (let at = 0; at < 2000; at += 97) {
      const value = pulseAt(at, 1800, 0.4, 0.9);
      expect(value).toBeGreaterThanOrEqual(0.4);
      expect(value).toBeLessThanOrEqual(0.9);
    }
  });

  it("comes back to where it started after one period", () => {
    expect(pulseAt(1800, 1800, 0.4, 0.9)).toBeCloseTo(
      pulseAt(0, 1800, 0.4, 0.9),
    );
  });

  it("reaches the top a quarter of the way through", () => {
    expect(pulseAt(450, 1800, 0.4, 0.9)).toBeCloseTo(0.9);
  });
});
