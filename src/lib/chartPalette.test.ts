import { describe, expect, it } from "vitest";
import { CHART_PALETTE } from "./chartPalette";
import { BASES, contrast, hsl, type Rgb } from "./contrast.testhelper";

/**
 * Measures the chart palette instead of asserting that it is good (#1142).
 *
 * Thresholds, each with where it comes from:
 *
 * - SURFACE_CONTRAST 3: WCAG 2.2 SC 1.4.11 Non-text Contrast, for the graphical
 *   objects a chart is made of.
 * - NORMAL_FLOOR 15 and CVD_TARGET 8: the dataviz skill's `validate_palette.js`
 *   (NORMAL_FLOOR and CVD_TARGET), the same method `allyPalette.ts` already cites
 *   for its own palette. Both are OKLab Delta E x100. They are applied to every
 *   pair, which is the script's `--pairs all` mode, because a chart can put any
 *   two teams side by side.
 *
 * Colour vision deficiency is simulated with the Machado, Oliveira and
 * Fernandes (2009) severity 1.0 matrices, "A Physiologically-based Model for
 * Simulation of Color Vision Deficiency", IEEE Transactions on Visualization
 * and Computer Graphics 15(6), applied to linear sRGB. OKLab is Bjorn Ottosson's
 * 2020 definition. The maths is written here rather than imported so the test
 * never re-runs the code it checks.
 */
const SURFACE_CONTRAST = 3;
const NORMAL_FLOOR = 15;
const CVD_TARGET = 8;

const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;

const toRgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
];

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

function oklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function seen(hex: string, kind?: keyof typeof MACHADO): Rgb {
  const lin = toRgb(hex).map(toLinear) as Rgb;
  if (!kind) return lin;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return MACHADO[kind].map((row) =>
    clamp(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]),
  ) as Rgb;
}

function deltaE(a: string, b: string, kind?: keyof typeof MACHADO): number {
  const x = oklab(seen(a, kind));
  const y = oklab(seen(b, kind));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/**
 * The chart sits on `bg-card`. Light is `0 0% 100%`, dark is
 * `--base-hue calc(--base-sat * 5%) 10%`, both from picoframe's `theme.css`.
 */
const SURFACES: [string, Rgb][] = [
  ["light", [1, 1, 1]],
  ...BASES.map(([name, hue, sat]) => [
    `dark ${name}`,
    hsl(hue, sat * 0.05, 0.1),
  ]) as [string, Rgb][],
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

  it.each(["protan", "deutan"] as const)(
    "keeps every pair apart under %s simulation",
    (kind) => {
      const close = pairs.filter(([a, b]) => deltaE(a, b, kind) < CVD_TARGET);
      expect(close).toEqual([]);
    },
  );

  it("covers all 22 presets", () => {
    expect(SURFACES).toHaveLength(BASES.length + 1);
    expect(BASES).toHaveLength(22);
  });
});
