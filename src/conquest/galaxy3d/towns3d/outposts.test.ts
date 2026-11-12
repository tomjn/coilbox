import { describe, expect, it } from "vitest";
import { footprint, OUTPOST_GRID } from "./layout";
import {
  OUTPOST_COLOURWAYS,
  outpostPaint,
  type SealedPlanetId,
} from "./outpostColourways";
import { buildOutpost, OUTPOSTS } from "./outposts";

const PLANETS: SealedPlanetId[] = ["red", "moon", "volcanic", "acid"];

describe("outpost inventory", () => {
  it("gives every structure a unique id", () => {
    const ids = OUTPOSTS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a single-lot structure", () => {
    expect(OUTPOSTS.some((m) => m.lots[0] === 1 && m.lots[1] === 1)).toBe(true);
  });

  it.each(
    OUTPOSTS,
  )("stands $id on the ground inside its footprint in every colourway", (m) => {
    const [w, d] = footprint(m, OUTPOST_GRID);
    let triangles = 0;
    for (const planet of PLANETS)
      for (const c of OUTPOST_COLOURWAYS[planet]) {
        if (c.families && !c.families.includes(m.family)) continue;
        const g = buildOutpost(m, w, d, outpostPaint(planet, c));
        g.computeBoundingBox();
        const b = g.boundingBox as NonNullable<typeof g.boundingBox>;
        const at = `${m.id} in ${planet} ${c.id}`;
        expect(b.min.y, at).toBeCloseTo(0, 6);
        expect(b.max.y, at).toBeCloseTo(m.height, 6);
        expect(b.min.x, at).toBeGreaterThanOrEqual(-w / 2 - 1e-6);
        expect(b.max.x, at).toBeLessThanOrEqual(w / 2 + 1e-6);
        expect(b.min.z, at).toBeGreaterThanOrEqual(-d / 2 - 1e-6);
        expect(b.max.z, at).toBeLessThanOrEqual(d / 2 + 1e-6);
        triangles = g.getAttribute("position").count / 3;
        g.dispose();
      }
    console.info(`${m.id}: ${triangles} triangles`);
  });
});
