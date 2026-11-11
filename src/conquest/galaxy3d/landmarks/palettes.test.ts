import { describe, expect, it } from "vitest";
import { PLANETS } from "../../planets";
import {
  RUIN_PALETTES,
  ruinPalette,
  STRONGHOLD_PALETTES,
  strongholdPalette,
} from "./palettes";

const channels = (p: object) =>
  Object.values(p).flatMap((v) => (Array.isArray(v) ? v : []));

describe("landmark palettes", () => {
  it.each(PLANETS)("has both palettes for %s", (id) => {
    for (const p of [strongholdPalette(id), ruinPalette(id)]) {
      const c = channels(p);
      expect(c.length).toBeGreaterThan(0);
      for (const v of c) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it("falls back to temperate on a map with no planet", () => {
    expect(strongholdPalette(undefined)).toBe(STRONGHOLD_PALETTES.temperate);
    expect(ruinPalette(undefined)).toBe(RUIN_PALETTES.temperate);
  });
});
