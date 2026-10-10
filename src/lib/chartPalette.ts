import { NON_TEXT_CONTRAST } from "./teamColor";

/**
 * The categorical palette coilbox owns for charts, one slot per team (#1142).
 *
 * A game is free to give a player near black, or the same lobby placeholder as
 * everybody else, so a chart cannot rely on in-game colours being readable.
 * These eight are chosen so that, taken as any two of them (not only
 * neighbours), they stay apart for normal vision and for protan and deutan
 * simulation, and so that each clears 3:1 against the white card and against
 * the lightest dark card of every picoframe base preset. One set serves both
 * themes, so a team keeps its colour when the theme changes.
 *
 * Found by a greedy farthest-point search in OKLCH over the gamut, then kept
 * in the order the search picked them, which is also the order of slots handed
 * out: the earliest slots are the most mutually distinct, so a small match
 * gets the safest colours. `chartPalette.test.ts` re-measures all of it
 * against `BASES` and fails if an edit here breaks a floor.
 *
 * Slot order is part of the contract. A slot is never reassigned, so a team
 * that is deselected does not repaint the others.
 */
export const CHART_PALETTE: readonly string[] = [
  "#b979c5", // orchid
  "#27a902", // green
  "#1c58fc", // blue
  "#9a5835", // brown
  "#067396", // teal
  "#cf027e", // magenta
  "#4296fb", // sky
  "#fa5e75", // salmon
];

/**
 * Where the thresholds a chart colour must clear come from. The palette test and
 * the app's choice of colour mode (#3830) both read them from here, so the two
 * cannot drift apart.
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
 * 2020 definition.
 */
export const SURFACE_CONTRAST = NON_TEXT_CONTRAST;
export const NORMAL_FLOOR = 15;
export const CVD_TARGET = 8;

export const MACHADO = {
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

export type Vision = keyof typeof MACHADO;

type Triple = [number, number, number];

const toRgb = (hex: string): Triple => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
];

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

function oklab([r, g, b]: Triple): Triple {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function seen(hex: string, kind?: Vision): Triple {
  const lin = toRgb(hex).map(toLinear) as Triple;
  if (!kind) return lin;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return MACHADO[kind].map((row) =>
    clamp(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]),
  ) as Triple;
}

/** OKLab Delta E x100 between two `#rrggbb` colours, as `kind` sees them. */
export function deltaE(a: string, b: string, kind?: Vision): number {
  const x = oklab(seen(a, kind));
  const y = oklab(seen(b, kind));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/**
 * Whether every pair of `#rrggbb` colours is far enough apart under normal
 * vision, protan and deutan. Fewer than two colours cannot disagree.
 */
export function pairsStayApart(colors: readonly string[]): boolean {
  return colors.every((a, i) =>
    colors
      .slice(i + 1)
      .every(
        (b) =>
          deltaE(a, b) >= NORMAL_FLOOR &&
          deltaE(a, b, "protan") >= CVD_TARGET &&
          deltaE(a, b, "deutan") >= CVD_TARGET,
      ),
  );
}
