import { describe, expect, it } from "vitest";
import {
  CHART_PALETTE,
  CVD_TARGET,
  deltaE,
  NORMAL_FLOOR,
  SURFACE_CONTRAST,
} from "./chartPalette";
import { BASES, contrast, hsl, type Rgb } from "./contrast.testhelper";

/**
 * Measures the chart palette instead of asserting that it is good (#1142). The
 * thresholds and the colour difference maths are the app's own, from
 * `chartPalette.ts`, so the palette is held to exactly what the automatic colour
 * mode asks of a game's colours (#3830). The WCAG contrast maths stays in
 * `contrast.testhelper.ts`.
 */
const toRgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
];

/**
 * The chart sits on `bg-card`. Light is `0 0% 100%`, dark is
 * `--base-hue calc(--base-sat * 5%) 10%`, both from picoframe's `theme.css`.
 */
const SURFACES: [string, Rgb][] = [
  ["light", [1, 1, 1]],
  ...(BASES.map(([name, hue, sat]) => [
    `dark ${name}`,
    hsl(hue, sat * 0.05, 0.1),
  ]) as [string, Rgb][]),
];

const pairs = CHART_PALETTE.flatMap((a, i) =>
  CHART_PALETTE.slice(i + 1).map((b) => [a, b] as const),
);

describe("CHART_PALETTE", () => {
  it("is eight distinct #rrggbb colours", () => {
    expect(CHART_PALETTE).toHaveLength(8);
    for (const c of CHART_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(CHART_PALETTE).size).toBe(CHART_PALETTE.length);
  });

  it("clears 3:1 on the card of every theme preset, light and dark", () => {
    const worst: string[] = [];
    for (const [name, surface] of SURFACES)
      for (const c of CHART_PALETTE)
        if (contrast(toRgb(c), surface) < SURFACE_CONTRAST)
          worst.push(`${c} on ${name}`);
    expect(worst).toEqual([]);
  });

  it("keeps every pair apart for normal vision", () => {
    const close = pairs.filter(([a, b]) => deltaE(a, b) < NORMAL_FLOOR);
    expect(close).toEqual([]);
  });

  it.each([
    "protan",
    "deutan",
  ] as const)("keeps every pair apart under %s simulation", (kind) => {
    const close = pairs.filter(([a, b]) => deltaE(a, b, kind) < CVD_TARGET);
    expect(close).toEqual([]);
  });

  it("covers all 22 presets", () => {
    expect(SURFACES).toHaveLength(BASES.length + 1);
    expect(BASES).toHaveLength(22);
  });
});
