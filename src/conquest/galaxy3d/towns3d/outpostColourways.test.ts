import { describe, expect, it } from "vitest";
import { townPalette } from "../landmarks/palettes";
import {
  colourwayFor,
  isSealedPlanet,
  OUTPOST_COLOURWAYS,
  type OutpostFamily,
  outpostPaint,
  type SealedPlanetId,
} from "./outpostColourways";

const PLANETS: SealedPlanetId[] = ["red", "moon", "volcanic", "acid"];
const FAMILIES: OutpostFamily[] = [
  "dome",
  "deck",
  "stacked",
  "spire",
  "saucer",
  "fortress",
  "capsule",
  "research",
  "utility",
];

describe("outpost colourways", () => {
  it("gives every sealed planet colourways that are each taken", () => {
    for (const planet of PLANETS) {
      const set = OUTPOST_COLOURWAYS[planet];
      expect(set.length, planet).toBeGreaterThan(0);
      for (const c of set) expect(c.share, c.id).toBeGreaterThan(0);
      expect(new Set(set.map((c) => c.id)).size).toBe(set.length);
    }
  });

  it("finds a colourway for every family on every planet", () => {
    for (const planet of PLANETS)
      for (const family of FAMILIES)
        for (const pick of [0, 0.5, 0.999]) {
          const c = colourwayFor(planet, family, pick);
          expect(c, `${planet} ${family}`).toBeDefined();
          if (c.families) expect(c.families).toContain(family);
        }
  });

  it("keeps a colourway to the families it names", () => {
    for (let i = 0; i < 100; i++) {
      const c = colourwayFor("red", "deck", i / 100);
      expect(c.families === undefined || c.families.includes("deck")).toBe(
        true,
      );
    }
  });

  it("knows which planets are sealed", () => {
    for (const planet of PLANETS) expect(isSealedPlanet(planet)).toBe(true);
    expect(isSealedPlanet("temperate")).toBe(false);
    expect(isSealedPlanet(undefined)).toBe(false);
  });

  it("dusts a structure with its planet's ground, thickest at the foot", () => {
    const paint = outpostPaint("red", OUTPOST_COLOURWAYS.red[0]);
    expect(paint.top).toEqual(townPalette("red").top);
    expect(paint.topCover).toBe(townPalette("red").topCover);
    expect(paint.dust).toHaveLength(1);
    expect(paint.dust[0].colour).toEqual(townPalette("red").top);
    expect(paint.dust[0].at(0, 0, 0)).toBeCloseTo(1);
    expect(paint.dust[0].at(0, 0.3, 0)).toBeCloseTo(0);
  });
});
