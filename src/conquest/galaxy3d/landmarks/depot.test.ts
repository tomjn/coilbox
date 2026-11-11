import { describe, expect, it } from "vitest";
import { buildDepot, DEPOT_COMMS, DEPOT_REACH, DEPOT_STORES } from "./depot";
import { depotPalette } from "./palettes";

const flat = () => 0;
const slope = (x: number, z: number) => 0.2 * x - 0.1 * z;
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const palette = depotPalette("temperate");
// Built once and shared, because 60 depots take over a second to build.
const onFlat = SEEDS.map((seed) => buildDepot(flat, palette, seed));
const onSlope = SEEDS.map((seed) => buildDepot(slope, palette, seed));

describe("buildDepot", () => {
  it.each([
    ["flat", onFlat],
    ["sloping", onSlope],
  ])("stays whole and inside its reach on %s ground", (_, depots) => {
    for (const { built } of depots) {
      const pos = built.solid.getAttribute("position");
      expect(pos.array.every(Number.isFinite)).toBe(true);
      let far = 0;
      for (let i = 0; i < pos.count; i++)
        far = Math.max(far, Math.hypot(pos.getX(i), pos.getZ(i)));
      expect(far).toBeLessThanOrEqual(DEPOT_REACH);
      expect(built.soft).toBeNull();
    }
  });

  it("stands its comms building on the ground, well above the crates", () => {
    for (const { built } of onFlat) {
      const tower = built.bounds("tower");
      if (!tower) throw new Error("no comms building");
      expect(tower.min.y).toBeGreaterThan(0);
      expect(tower.max.y).toBeGreaterThan(0.6);
      expect(tower.max.y).toBeLessThan(2.2);
    }
  });

  it("builds every comms building and every kind of storage", () => {
    expect(new Set(onFlat.map((d) => d.comms))).toEqual(new Set(DEPOT_COMMS));
    expect(new Set(onFlat.map((d) => d.store))).toEqual(new Set(DEPOT_STORES));
  });

  it("builds the same depot from the same seed", () => {
    const a = buildDepot(slope, palette, 9).built.solid;
    const b = buildDepot(slope, palette, 9).built.solid;
    expect(a.getAttribute("position").array).toEqual(
      b.getAttribute("position").array,
    );
    expect(a.getAttribute("color").array).toEqual(
      b.getAttribute("color").array,
    );
  });
});
