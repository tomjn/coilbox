import { describe, expect, it } from "vitest";
import {
  buildLanding,
  LANDING_PADS,
  LANDING_REACH,
  LANDING_TOWERS,
} from "./landing";
import { landingPalette } from "./palettes";

const flat = () => 0;
const slope = (x: number, z: number) => 0.2 * x - 0.1 * z;
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const palette = landingPalette("temperate");
// Built once and shared between the tests.
const onFlat = SEEDS.map((seed) => buildLanding(flat, palette, seed));
const onSlope = SEEDS.map((seed) => buildLanding(slope, palette, seed));

describe("buildLanding", () => {
  it.each([
    ["flat", onFlat],
    ["sloping", onSlope],
  ])("stays whole and inside its reach on %s ground", (_, pads) => {
    for (const { built } of pads) {
      const pos = built.solid.getAttribute("position");
      expect(pos.array.every(Number.isFinite)).toBe(true);
      let far = 0;
      for (let i = 0; i < pos.count; i++)
        far = Math.max(far, Math.hypot(pos.getX(i), pos.getZ(i)));
      expect(far).toBeLessThanOrEqual(LANDING_REACH);
      expect(built.soft).toBeNull();
    }
  });

  it("builds all four: raised or flush, with one tower or two", () => {
    const seen = new Set(onFlat.map((l) => `${l.pad} ${l.towers}`));
    expect(seen.size).toBe(LANDING_PADS.length * LANDING_TOWERS.length);
  });

  it("stands a second tower on the other side of the deck", () => {
    for (const { built, towers } of onFlat) {
      const tower = built.bounds("tower");
      if (!tower) throw new Error("no tower");
      const bothSides = tower.min.z < -1 && tower.max.z > 1;
      expect(bothSides).toBe(towers === 2);
    }
  });

  it("lifts a raised deck clear of the ground and keeps a flush one low", () => {
    for (const ground of [onFlat, onSlope])
      for (const { built, pad } of ground) {
        // The deck is the widest thing in the body, so its top is where the
        // body is widest.
        const v = built.vertices("body");
        let far = 0;
        let top = 0;
        for (let i = 0; i < v.length; i += 3) {
          const d = Math.hypot(v[i] - 0.2, v[i + 2]);
          if (d > 1.25 && v[i + 1] > top) top = v[i + 1];
          far = Math.max(far, d);
        }
        expect(far).toBeGreaterThan(1.25);
        if (pad === "raised") expect(top).toBeGreaterThan(0.7);
        else expect(top).toBeLessThan(0.5);
      }
  });

  it("builds the same pad from the same seed", () => {
    const a = buildLanding(slope, palette, 9).built.solid;
    const b = buildLanding(slope, palette, 9).built.solid;
    expect(a.getAttribute("position").array).toEqual(
      b.getAttribute("position").array,
    );
  });
});
