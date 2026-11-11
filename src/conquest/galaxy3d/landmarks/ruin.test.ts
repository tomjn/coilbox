import { describe, expect, it } from "vitest";
import { RUIN_PALETTES } from "./palettes";
import { buildRuin, RUIN_REACH, RUIN_WALLS } from "./ruin";
import { STRONGHOLD_REACH } from "./stronghold";

const flat = () => 0;

describe("buildRuin", () => {
  const { built } = buildRuin(flat, RUIN_PALETTES.temperate, 7);

  it("has nothing that shines", () => {
    expect(built.glow).toBeNull();
  });

  it("is smaller than the stronghold and stays inside its reach", () => {
    expect(RUIN_REACH).toBeLessThan(STRONGHOLD_REACH);
    let far = 0;
    for (const g of [built.solid, built.soft]) {
      if (!g) continue;
      const pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++)
        far = Math.max(far, Math.hypot(pos.getX(i), pos.getZ(i)));
    }
    // The mound's sheet ends at the reach itself, give or take float rounding.
    expect(far).toBeLessThanOrEqual(RUIN_REACH + 1e-6);
  });

  it.each(RUIN_WALLS)("leaves gaps in the wall at radius $r", ({ r, top }) => {
    // Which of 72 bearings have standing wall: anything well above the
    // ground the ring stands on, close to the ring's radius.
    const bins = new Array(72).fill(false);
    const pos = built.solid.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (Math.abs(Math.hypot(x, z) - r) > 0.12) continue;
      if (pos.getY(i) < top + 0.04) continue;
      const a = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
      bins[Math.floor((a / (Math.PI * 2)) * 72) % 72] = true;
    }
    const standing = bins.filter(Boolean).length;
    expect(standing).toBeGreaterThan(12);
    expect(standing).toBeLessThan(66);
  });
});
