import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASES, contrast, hsl, type Rgb } from "../lib/contrast.testhelper";

/**
 * The legibility guarantee for `text-muted-foreground`, app-wide, measured rather
 * than eyeballed (#1019, #1016).
 *
 * What this proves: the `--muted-foreground` value Coilbox actually ships clears
 * WCAG AA (4.5:1) for text under 18.66px, on every one of the 22 base presets
 * picoframe ships, on every surface the token is put on in this app, with every
 * accent preset including the two that cycle their hue. It also proves the token
 * stays clearly quieter than body text, which is the thing a darker value would
 * cost.
 *
 * The value is read out of `src/index.css` rather than written here, so weakening
 * the override re-runs the measurement instead of leaving a stale number behind.
 *
 * What it does not prove: anything about text over artwork or over a photographic
 * backdrop, which does not go through this token. `ART_DIM_CLASS` on the tool
 * cards covers that case separately.
 */

/** Straight-alpha composite of `layer` over `base`. */
function over(base: Rgb, layer: Rgb, alpha: number): Rgb {
  return base.map((c, i) => c * (1 - alpha) + layer[i] * alpha) as Rgb;
}

const CSS = readFileSync(
  fileURLToPath(new URL("../index.css", import.meta.url)),
  "utf8",
);

/**
 * The shipped `--muted-foreground` override, selector and all, straight out of
 * `src/index.css`.
 *
 * The selector is matched, not just the value, because the selector is what keeps
 * the override off the dark scheme. picoframe's `.dark` block and a bare `:root`
 * have the same specificity, so a bare `:root` would win the source-order tie and
 * paint the light foreground into dark mode. That renders at 2.63:1 and no
 * measurement of the light ramp would notice.
 *
 * Matching the whole declaration also means a change to the hue channel or the
 * saturation coefficient is caught here, instead of being measured against a
 * formula this file assumed.
 */
function shippedOverride(): {
  darkExcluded: boolean;
  satCoefficient: number;
  lightness: number;
} {
  const found =
    /(:root(:not\(\.dark\))?)\s*\{\s*--muted-foreground:\s*var\(--base-hue\)\s*calc\(var\(--base-sat-text\)\s*\*\s*([0-9.]+)%\)\s*([0-9.]+)%;/.exec(
      CSS,
    );
  if (!found)
    throw new Error("no --muted-foreground override in src/index.css");
  return {
    darkExcluded: found[2] !== undefined,
    satCoefficient: Number(found[3]),
    lightness: Number(found[4]) / 100,
  };
}

/**
 * Light-scheme `--primary` for each accent preset, transcribed from theme.css.
 * "none" is the neutral `:root` value, which is base-derived and built per base.
 */
const ACCENTS_LIGHT: [string, number, number, number][] = [
  ["blue", 221.2, 0.832, 0.533],
  ["green", 142.1, 0.762, 0.363],
  ["rose", 346.8, 0.772, 0.498],
  ["violet", 262.1, 0.833, 0.578],
  ["orange", 24.6, 0.95, 0.531],
  ["red", 0, 0.72, 0.51],
  ["amber", 38, 0.92, 0.5],
  ["yellow", 48, 0.96, 0.53],
  ["teal", 173, 0.8, 0.32],
  ["cyan", 192, 0.91, 0.34],
  ["sky", 200, 0.9, 0.4],
  ["indigo", 243, 0.75, 0.59],
  ["purple", 271, 0.76, 0.53],
  ["pink", 330, 0.75, 0.47],
];

/**
 * The two animated accents sweep `--pf-accent-hue` through the whole wheel, so
 * every hue is a case rather than one. Sampled every 5 degrees.
 */
const CYCLING_LIGHT: [string, number, number, number][] = [];
for (let h = 0; h < 360; h += 5) {
  CYCLING_LIGHT.push([`rainbow@${h}`, h, 0.68, 0.48]);
  CYCLING_LIGHT.push([`opal@${h}`, h, 0.6, 0.78]);
}

/** The light-scheme tokens for one base, with the shipped muted-foreground. */
function lightTokens(hue: number, sat: number, satText: number) {
  const { satCoefficient, lightness } = shippedOverride();
  return {
    muted: hsl(hue, (satText * satCoefficient) / 100, lightness),
    body: hsl(hue, (satText * 10) / 100, 0.12),
    /**
     * The surfaces `text-muted-foreground` is actually put on in this app. White
     * covers `--background`, `--card` and `--popover`, which are all `0 0% 100%`.
     * `--muted` and `--sidebar` share a value and carry the small badges. `--accent`
     * is deliberately absent: the seven places that pair it with this token are all
     * `hover:bg-accent`/`focus:bg-accent` rules that swap the text to
     * `--accent-foreground` or `--foreground` in the same breath.
     */
    surfaces: {
      white: hsl(0, 0, 1),
      muted: hsl(hue, (sat * 5) / 100, 0.96),
      sidebar: hsl(hue, (sat * 5) / 100, 0.96),
    },
    /** The neutral `--primary`, for the no-accent case of the tint. */
    neutralPrimary: hsl(hue, (sat * 6) / 100, 0.16),
  };
}

/** The dark-scheme tokens for one base. Coilbox overrides nothing here. */
function darkTokens(hue: number, sat: number, satText: number) {
  return {
    muted: hsl(hue, (satText * 5) / 100, 0.6),
    surfaces: {
      background: hsl(hue, (sat * 6) / 100, 0.07),
      card: hsl(hue, (sat * 5) / 100, 0.1),
      muted: hsl(hue, (sat * 4) / 100, 0.16),
      sidebar: hsl(hue, (sat * 6) / 100, 0.09),
    },
    neutralPrimary: hsl(0, 0, 0.95),
  };
}

/** Text under 18.66px, which is what `text-xs` and `text-sm` are. */
const AA_SMALL = 4.5;

describe("the shipped --muted-foreground override", () => {
  it("stays off the dark scheme", () => {
    // The dark ramp already clears AA. A bare `:root` here would tie picoframe's
    // `.dark` on specificity, win on source order and drop the light foreground
    // into dark mode at 2.63:1, which nothing else in this file would catch.
    expect(shippedOverride().darkExcluded).toBe(true);
    // Nor may Coilbox redefine the dark value outright.
    expect(/\.dark\s*\{[^}]*--muted-foreground/.test(CSS)).toBe(false);
  });

  it("keeps picoframe's hue and saturation, changing only the lightness", () => {
    // The base hue is what makes a preset recognisable. Draining it would be a
    // bigger loss than a shade of lightness, so the fix must not reach for it.
    const { satCoefficient } = shippedOverride();
    expect(satCoefficient).toBe(4);
  });
});

describe("secondary text on a plain surface, light scheme", () => {
  for (const [name, hue, sat, satText] of BASES) {
    const t = lightTokens(hue, sat, satText);
    for (const [surface, colour] of Object.entries(t.surfaces)) {
      it(`clears AA on ${name} over ${surface}`, () => {
        expect(contrast(t.muted, colour)).toBeGreaterThanOrEqual(AA_SMALL);
      });
    }
  }
});

describe("secondary text on a bg-primary/5 tint over a card, light scheme", () => {
  // #1016: the treatment RunListPage gives the run you can resume. The tint moves
  // with the accent, so every accent is a case, and the two animated accents make
  // every hue one.
  for (const [name, hue, sat, satText] of BASES) {
    const t = lightTokens(hue, sat, satText);
    const primaries: [string, Rgb][] = [
      ["none", t.neutralPrimary],
      ...ACCENTS_LIGHT.map(
        ([n, h, s, l]) => [n, hsl(h, s, l)] as [string, Rgb],
      ),
      ...CYCLING_LIGHT.map(
        ([n, h, s, l]) => [n, hsl(h, s, l)] as [string, Rgb],
      ),
    ];

    it(`clears AA on ${name} under every accent's tint`, () => {
      for (const [accent, primary] of primaries) {
        const tinted = over(t.surfaces.white, primary, 0.05);
        expect(
          contrast(t.muted, tinted),
          `${name} + ${accent}`,
        ).toBeGreaterThanOrEqual(AA_SMALL);
      }
    });
  }
});

describe("secondary text in the dark scheme, which is untouched", () => {
  for (const [name, hue, sat, satText] of BASES) {
    const t = darkTokens(hue, sat, satText);
    it(`still clears AA on ${name}`, () => {
      for (const [surface, colour] of Object.entries(t.surfaces)) {
        expect(
          contrast(t.muted, colour),
          `${name}/${surface}`,
        ).toBeGreaterThanOrEqual(AA_SMALL);
      }
      const tinted = over(t.surfaces.card, t.neutralPrimary, 0.05);
      expect(contrast(t.muted, tinted), `${name}/tint`).toBeGreaterThanOrEqual(
        AA_SMALL,
      );
    });
  }
});

describe("the type hierarchy the app relies on", () => {
  // A muted foreground that is too dark stops being muted. These are the numbers
  // that say it is still secondary, not a second body copy.
  for (const [name, hue, sat, satText] of BASES) {
    const t = lightTokens(hue, sat, satText);
    const card = t.surfaces.white;
    const bodyRatio = contrast(t.body, card);
    const mutedRatio = contrast(t.muted, card);

    it(`keeps muted text visibly quieter than body text on ${name}`, () => {
      // Body copy is near-black on white, so it sits around 16:1. Muted has to stay
      // a long way below that or the two stop reading as different tiers.
      expect(mutedRatio).toBeLessThan(bodyRatio * 0.45);
      expect(bodyRatio - mutedRatio).toBeGreaterThan(9);
    });
  }
});
