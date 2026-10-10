import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASES, contrast, hsl, type Rgb } from "../lib/contrast.testhelper";

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

/** Straight-alpha composite of `layer` over `base`. */
function over(base: Rgb, layer: Rgb, alpha: number): Rgb {
  return base.map((c, i) => c * (1 - alpha) + layer[i] * alpha) as Rgb;
}

const SRC = fileURLToPath(new URL("..", import.meta.url));

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
    const ink = hsl(hue, (satText * 10) / 100, 0.12);
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
