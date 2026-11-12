import { describe, expect, it } from "vitest";
import { HOME_RING_WIDTH, homeRingGeometry } from "./homeRing";

const flat = { groundHeightAtWorld: () => 2 };
const hill = {
  groundHeightAtWorld: (x: number, z: number) => 2 + 0.3 * x - 0.1 * z,
};

const points = (g: ReturnType<typeof homeRingGeometry>) => {
  const pos = g.getAttribute("position");
  return Array.from({ length: pos.count }, (_, i) => ({
    x: pos.getX(i),
    y: pos.getY(i),
    z: pos.getZ(i),
  }));
};

describe("homeRingGeometry", () => {
  it.each([0, 3, 4, 6])("keeps a shape of %i sides clear of the town", (n) => {
    const g = homeRingGeometry(flat, 10, -4, 5, n);
    for (const p of points(g))
      expect(Math.hypot(p.x - 10, p.z + 4)).toBeGreaterThanOrEqual(5 - 1e-6);
  });

  it("draws a circle as wide as the ring", () => {
    const g = homeRingGeometry(flat, 0, 0, 5, 0);
    const reach = Math.max(...points(g).map((p) => Math.hypot(p.x, p.z)));
    // The corners of a 48 sided shape lie a little outside its sides.
    expect(reach).toBeGreaterThanOrEqual(5 + HOME_RING_WIDTH);
    expect(reach).toBeLessThan((5 + HOME_RING_WIDTH) * 1.003);
  });

  it("puts a shape's first corner to the north", () => {
    const first = points(homeRingGeometry(flat, 0, 0, 5, 3))[0];
    expect(first.x).toBeCloseTo(0, 6);
    expect(first.z).toBeCloseTo(-10, 6);
  });

  it("lies on the ground", () => {
    for (const p of points(homeRingGeometry(hill, 1, 2, 5, 0))) {
      const lift = p.y - hill.groundHeightAtWorld(p.x, p.z);
      expect(lift).toBeGreaterThan(0);
      expect(lift).toBeLessThan(0.05);
    }
  });

  it("is a closed band", () => {
    const g = homeRingGeometry(flat, 0, 0, 5, 4);
    const pos = g.getAttribute("position");
    expect(g.index?.count).toBe(pos.count * 3);
  });
});
