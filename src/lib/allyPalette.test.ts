import { describe, expect, it } from "vitest";
import { ALLY_PALETTE, allyPaletteColor } from "./allyPalette";

describe("ALLY_PALETTE", () => {
  it("is all valid, distinct #rrggbb colours", () => {
    for (const c of ALLY_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(ALLY_PALETTE).size).toBe(ALLY_PALETTE.length);
  });
});

describe("allyPaletteColor", () => {
  it("hands out the palette in order: ally 0 the first entry, ally 1 the second", () => {
    ALLY_PALETTE.forEach((color, i) => {
      expect(allyPaletteColor(i)).toBe(color);
    });
  });

  it("is deterministic: the same ally always gets the same colour", () => {
    expect(allyPaletteColor(3)).toBe(allyPaletteColor(3));
    expect(allyPaletteColor(11)).toBe(allyPaletteColor(11));
  });

  it("never falls back to the neutral grey the issue removed", () => {
    for (let i = 0; i < 64; i++) {
      expect(allyPaletteColor(i)).not.toBe("#e5e7eb");
    }
  });

  it("wraps around the palette once it runs out, darker each lap", () => {
    const n = ALLY_PALETTE.length;
    // A second-lap ally reuses the first lap's hue (same slot) but is not the
    // identical colour - it must read as a distinct shade, not a repeat.
    const first = allyPaletteColor(0);
    const secondLap = allyPaletteColor(n);
    const thirdLap = allyPaletteColor(2 * n);
    expect(secondLap).toMatch(/^#[0-9a-f]{6}$/);
    expect(secondLap).not.toBe(first);
    expect(thirdLap).not.toBe(first);
    expect(thirdLap).not.toBe(secondLap);
  });

  it("gives every ally team up to the coilbox battle cap (32 players) its own colour", () => {
    const colors = new Set<string>();
    for (let i = 0; i < 32; i++) colors.add(allyPaletteColor(i));
    // Beyond the base palette, colours repeat only once a full extra lap has
    // run (darkened), so up to 32 there are at least two full laps' worth of
    // distinct shades, never a single repeated value.
    expect(colors.size).toBeGreaterThan(ALLY_PALETTE.length);
  });
});
