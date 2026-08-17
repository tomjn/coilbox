import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Why the inactive tab label is `text-muted-foreground` and not `text-foreground/60`
 * (#1051).
 *
 * Stock shadcn dims the foreground for an inactive tab, and picoframe's registry
 * copies that, so the vendored `src/components/ui/tabs.tsx` arrived with it. At 14px
 * the 4.5:1 threshold applies, and the dimmed ink is under it on most of the base
 * presets. The same class list already reaches for `--muted-foreground` in the dark
 * scheme, so the fix is to say that in both.
 *
 * The other alpha-dimmed `text-foreground` sites in the app sit at `/80` and above,
 * which is why this is not the blanket ban that `tertiaryText.test.ts` puts on dimming
 * `--muted-foreground`. The two measurements below place the line between `/60` and
 * `/70`, so the surviving sites are covered by the same numbers rather than by
 * assertion.
 *
 * The colour maths is transcribed from WCAG 2.2, copied rather than imported for the
 * reason `mutedForeground.test.ts` gives.
 */

type Rgb = [number, number, number];

/** CSS `hsl()` to sRGB channels, all 0 to 1 except the hue. */
function hsl(h: number, s: number, l: number): Rgb {
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

/** Straight-alpha composite of `layer` over `base`. */
function over(base: Rgb, layer: Rgb, alpha: number): Rgb {
  return base.map((c, i) => c * (1 - alpha) + layer[i] * alpha) as Rgb;
}

/** WCAG 2.2 relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.2 contrast ratio between two colours. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Every base preset, as `[name, --base-hue, --base-sat, --base-sat-text]`. */
const BASES: [string, number, number, number?][] = [
  ["zinc", 240, 1],
  ["slate", 215, 1.6],
  ["gray", 220, 0.5],
  ["stone", 30, 1.5],
  ["neutral", 0, 0],
  ["rose", 345, 2.4],
  ["red", 2, 2.4],
  ["amber", 40, 2.4],
  ["green", 150, 2.2],
  ["teal", 185, 2.2],
  ["blue", 214, 2.6],
  ["indigo", 250, 2.4],
  ["violet", 276, 2.4],
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

/** Light-scheme `--primary` per accent preset, for the 5% tint each one lays down. */
const ACCENTS_LIGHT: [number, number, number][] = [
  [221.2, 0.832, 0.533],
  [142.1, 0.762, 0.363],
  [346.8, 0.772, 0.498],
  [262.1, 0.833, 0.578],
  [24.6, 0.95, 0.531],
  [0, 0.72, 0.51],
  [38, 0.92, 0.5],
  [48, 0.96, 0.53],
  [173, 0.8, 0.32],
  [192, 0.91, 0.34],
  [200, 0.9, 0.4],
  [243, 0.75, 0.59],
  [271, 0.76, 0.53],
  [330, 0.75, 0.47],
];

/**
 * Light surfaces a tab strip sits on. `bg-muted` is the default `TabsList`
 * background, and `background` is what the `line` variant leaves showing.
 */
function lightSurfaces(hue: number, sat: number): [string, Rgb][] {
  const white = hsl(0, 0, 1);
  return [
    ["background", white],
    ["muted", hsl(hue, (sat * 5) / 100, 0.96)],
    ["tint/none", over(white, hsl(hue, (sat * 6) / 100, 0.16), 0.05)],
    ...ACCENTS_LIGHT.map(
      ([h, s, l], i) =>
        [`tint/${i}`, over(white, hsl(h, s, l), 0.05)] as [string, Rgb],
    ),
  ];
}

/** Worst contrast of the light `--foreground` at `alpha`, over every base. */
function worstDimmedForeground(alpha: number) {
  let ratio = Number.POSITIVE_INFINITY;
  let where = "";
  for (const [name, hue, sat, satText] of BASES) {
    // `--foreground: var(--base-hue) calc(var(--base-sat-text) * 10%) 12%`.
    const ink = hsl(hue, ((satText ?? sat) * 10) / 100, 0.12);
    for (const [sn, surface] of lightSurfaces(hue, sat)) {
      const r = contrast(
        alpha === 1 ? ink : over(surface, ink, alpha),
        surface,
      );
      if (r < ratio) {
        ratio = r;
        where = `${name}/${sn}`;
      }
    }
  }
  return { ratio, where };
}

/** Text under 18.66px, which a tab label is at `text-sm`. */
const AA_SMALL = 4.5;

describe("dimming the light foreground", () => {
  it("/60 is under AA, which is what the tab label used", () => {
    const { ratio, where } = worstDimmedForeground(0.6);
    expect(ratio, where).toBeLessThan(AA_SMALL);
  });

  it("/70 clears it, so the line falls between the two steps", () => {
    // The eight sites left dimming `text-foreground` are all at /80 or above, well
    // clear of this. /60 is the only step in use that was under.
    expect(worstDimmedForeground(0.7).ratio).toBeGreaterThanOrEqual(AA_SMALL);
  });
});

describe("the inactive tab label", () => {
  const tabs = readFileSync(`${SRC}/components/ui/tabs.tsx`, "utf8");

  it("uses the muted token rather than a dimmed foreground", () => {
    // Re-running `shadcn add @picoframe/tabs` would overwrite this file with the
    // stock value, so the guard is here rather than in a comment.
    expect(tabs).not.toContain("whitespace-nowrap text-foreground/60");
    expect(tabs).toContain("whitespace-nowrap text-muted-foreground");
  });
});
