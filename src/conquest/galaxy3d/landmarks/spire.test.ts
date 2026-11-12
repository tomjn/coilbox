import { describe, expect, it } from "vitest";
import { SPIRE_LIVERIES, spirePalette } from "./palettes";
import { buildSpire, SPIRE_REACH } from "./spire";

const flat = () => 0;
const p = spirePalette("temperate");

/** The furthest any vertex lies from the origin, and the lowest and highest. */
const extent = (built: ReturnType<typeof buildSpire>["built"]) => {
  const pos = built.solid.getAttribute("position");
  let far = 0;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < pos.count; i++) {
    far = Math.max(far, Math.hypot(pos.getX(i), pos.getZ(i)));
    lo = Math.min(lo, pos.getY(i));
    hi = Math.max(hi, pos.getY(i));
  }
  return { far, lo, hi };
};

describe("buildSpire", () => {
  const { built } = buildSpire(flat, p, SPIRE_LIVERIES[0], 7);

  it("has a core and masts, and nothing see-through", () => {
    for (const tag of ["tower", "mast"] as const)
      expect(built.bounds(tag), tag).not.toBeNull();
    expect(built.soft).toBeNull();
    console.info(`spire triangles: ${built.triangles}`);
  });

  it("stays inside its reach", () => {
    const { far, hi } = extent(built);
    console.info(`spire footprint: ${far}, height: ${hi}`);
    expect(far).toBeLessThanOrEqual(SPIRE_REACH);
  });

  it("has no vertex that is not a number", () => {
    const pos = built.solid.getAttribute("position");
    for (let i = 0; i < pos.count; i++)
      expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(
        true,
      );
  });

  it("stands level on a slope, its hardstand reaching below the low side", () => {
    const slope = (x: number) => x * 0.1;
    const { lo, hi } = extent(buildSpire(slope, p, SPIRE_LIVERIES[0], 7).built);
    expect(lo).toBeLessThan(-0.2);
    // The hardstand lies level with the high side, so the top rises by that much.
    expect(hi - extent(built).hi).toBeCloseTo(0.205, 2);
  });

  it("wears each livery's own paint", () => {
    const mean = (livery: (typeof SPIRE_LIVERIES)[number]) => {
      const col = buildSpire(flat, p, livery, 7).built.solid.getAttribute(
        "color",
      );
      let sum = 0;
      for (let i = 0; i < col.count; i++) sum += col.getX(i);
      return sum / col.count;
    };
    const seen = new Set(SPIRE_LIVERIES.map((l) => mean(l).toFixed(3)));
    expect(seen.size).toBe(SPIRE_LIVERIES.length);
  });

  it("names every livery once", () => {
    expect(new Set(SPIRE_LIVERIES.map((l) => l.id)).size).toBe(
      SPIRE_LIVERIES.length,
    );
  });
});
