import { describe, expect, it } from "vitest";
import { at, Builder } from "../landmarks/kit";
import { OUTPOST_COLOURWAYS, outpostPaint } from "./outpostColourways";
import { foundationPlate, PLATE_DECK } from "./outpostParts";

describe("foundationPlate", () => {
  const paint = outpostPaint("moon", OUTPOST_COLOURWAYS.moon[0]);

  it("covers its size and reaches from its deck down to the ground", () => {
    const b = new Builder();
    foundationPlate(b, 0.6, 0.4, 0.2, paint, at(0, 0, 0));
    const g = b.build().solid;
    g.computeBoundingBox();
    const box = g.boundingBox as NonNullable<typeof g.boundingBox>;
    expect(box.min.x).toBeCloseTo(-0.3, 6);
    expect(box.max.x).toBeCloseTo(0.3, 6);
    expect(box.min.z).toBeCloseTo(-0.2, 6);
    expect(box.max.z).toBeCloseTo(0.2, 6);
    expect(box.min.y).toBeCloseTo(-0.2, 6);
    expect(box.max.y).toBeGreaterThan(PLATE_DECK);
  });

  it("stripes its rim", () => {
    const b = new Builder();
    foundationPlate(b, 0.6, 0.4, 0.2, paint, at(0, 0, 0));
    const kinds = Array.from(b.build().solid.getAttribute("kind").array);
    expect(kinds).toContain(14);
    expect(kinds).toContain(11);
  });
});
