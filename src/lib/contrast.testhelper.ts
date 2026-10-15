/**
 * The WCAG colour maths and the picoframe base presets that the legibility tests
 * measure against. It is named `.testhelper.ts` so vitest does not collect it as a
 * test file, as with `png.testhelper.ts`.
 *
 * The formulas are transcribed from WCAG 2.2 and the presets from
 * `@picoframe/frame/src/theme.css`, rather than imported from production code, so
 * a test never re-runs the formula it is checking.
 */

export type Rgb = [number, number, number];

/** CSS `hsl()` to sRGB channels, all 0 to 1 except the hue. */
export function hsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * Math.min(Math.max(s, 0), 1);
  const sector = ((((h % 360) + 360) % 360) / 60) % 6;
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const rgb: Rgb =
    sector < 1
      ? [c, x, 0]
      : sector < 2
        ? [x, c, 0]
        : sector < 3
          ? [0, c, x]
          : sector < 4
            ? [0, x, c]
            : sector < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return rgb.map((v) => v + m) as Rgb;
}

/** WCAG 2.2 relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.2 contrast ratio between two relative luminances. */
export function contrastOfLuminances(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.2 contrast ratio between two colours. */
export function contrast(a: Rgb, b: Rgb): number {
  return contrastOfLuminances(luminance(a), luminance(b));
}

/**
 * Every base preset, as `[name, --base-hue, --base-sat, --base-sat-text]`,
 * transcribed from `@picoframe/frame/src/theme.css`. A preset that sets no text
 * knob gets the surface knob, which is what theme.css does with
 * `--base-sat-text: var(--base-sat)`.
 */
export const BASES: readonly [string, number, number, number][] = [
  ["zinc", 240, 1, 1],
  ["slate", 215, 1.6, 1.6],
  ["gray", 220, 0.5, 0.5],
  ["stone", 30, 1.5, 1.5],
  ["neutral", 0, 0, 0],
  ["rose", 345, 2.4, 2.4],
  ["red", 2, 2.4, 2.4],
  ["amber", 40, 2.4, 2.4],
  ["green", 150, 2.2, 2.2],
  ["teal", 185, 2.2, 2.2],
  ["blue", 214, 2.6, 2.6],
  ["indigo", 250, 2.4, 2.4],
  ["violet", 276, 2.4, 2.4],
  ["purple", 280, 7, 2],
  ["sky", 208, 6, 2],
  ["navy", 225, 11, 2],
  ["fuchsia", 330, 6, 2],
  ["orange", 25, 6, 2],
  ["lime", 95, 5.5, 2],
  ["emerald", 160, 6.5, 2],
  ["yellow", 50, 6, 2],
  ["crimson", 350, 6.5, 2],
];
