import { twMerge } from "tailwind-merge";
import { describe, expect, it } from "vitest";
import {
  ART_BAND_CLASS,
  ART_BUTTON_CLASS,
  ART_CARD_CLASS,
  ART_DIM_CLASS,
  ART_FADE_CLASS,
} from "./cardShell";

/**
 * The legibility guarantee for text on card art, measured rather than eyeballed.
 *
 * What this proves: the band across the foot of an art card dims whatever is
 * under it enough that both its text colours clear WCAG AA (4.5:1), in every base
 * ramp picoframe ships. It holds identically in light and dark mode, because the
 * card re-declares the dark ramp on itself, so there is one case to check and not
 * two.
 *
 * What it does not prove: that any of it was rendered. The zone tests check that
 * the cards wear these classes, and the PRs for #991, #995 and #1021 carry
 * screenshots.
 *
 * This measurement was written twice, once per zone, before the shell existed.
 * It now runs once over the shell's own strings, so a zone that adopts the shell
 * inherits the guarantee instead of deriving a weaker one.
 *
 * The alphas come out of the shipped class strings, so weakening the band in
 * `cardShell.ts` re-runs the measurement instead of leaving it stale.
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

/** The alpha in a `hsl(var(--token)/N)` arbitrary value, or 1 if it has none. */
function tokenAlpha(className: string, token: string): number {
  const found = new RegExp(`hsl\\(var\\(--${token}\\)(?:/([0-9.]+))?\\)`).exec(
    className,
  );
  if (!found) throw new Error(`no --${token} in ${className}`);
  return found[1] ? Number(found[1]) : 1;
}

/**
 * The brightest pixel `proceduralCardArtSvg` can paint, scanned over its whole
 * parameter space.
 *
 * Its layers, from that module: a field at up to 22% lightness and 55%
 * saturation, two glows at 22% opacity of a 58%-lightness colour at up to 70%
 * saturation, and rings at 13% of a 64%-lightness colour. The worst case for
 * text is all of them stacked on the same pixel, at whichever hue carries the
 * most luminance.
 */
function brightestProceduralPixel(): Rgb {
  let worst: Rgb = [0, 0, 0];
  for (let hue = 0; hue < 360; hue += 5) {
    let pixel = hsl(hue, 0.55, 0.22);
    pixel = over(pixel, hsl(hue, 0.7, 0.58), 0.22);
    pixel = over(pixel, hsl(hue, 0.7, 0.58), 0.22);
    pixel = over(pixel, hsl(hue, 0.7, 0.64), 0.13);
    if (luminance(pixel) > luminance(worst)) worst = pixel;
  }
  return worst;
}

/** picoframe's `.dark` ramp, transcribed from `@picoframe/frame/src/theme.css`. */
const BASE_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
/** Neutral through the subtle tier to the vivid one, which tops out around 11. */
const BASE_SATS = [0, 1, 2.6, 6, 11];

const bandAlpha = tokenAlpha(ART_BAND_CLASS, "background");
const textAlpha = tokenAlpha(ART_BAND_CLASS, "foreground");
const dimAlpha = tokenAlpha(ART_DIM_CLASS, "foreground");

/** Measure both text colours over `art`, in every base ramp picoframe ships. */
function measureBandOver(art: Rgb) {
  for (const hue of BASE_HUES) {
    for (const sat of BASE_SATS) {
      // The dark ramp's --background, which is what the band is painted in.
      const scrim = hsl(hue, (sat * 6) / 100, 0.07);
      const band = over(art, scrim, bandAlpha);
      // The dark ramp's --foreground is achromatic, so the base does not move it.
      const ink = over(band, hsl(0, 0, 0.95), textAlpha);
      const dim = over(band, hsl(0, 0, 0.95), dimAlpha);
      const label = `base hue ${hue} sat ${sat}`;

      it(`clears AA for the card's name at ${label}`, () => {
        expect(contrast(ink, band)).toBeGreaterThanOrEqual(4.5);
      });

      it(`clears AA for the card's secondary line at ${label}`, () => {
        expect(contrast(dim, band)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
}

describe("text on card art", () => {
  it("dims the art under the band", () => {
    expect(bandAlpha).toBeGreaterThan(0);
    expect(bandAlpha).toBeLessThan(1);
  });

  it("fades in from nothing above the band, so no text sits on the fade", () => {
    expect(ART_FADE_CLASS).toContain("to-transparent");
    expect(ART_FADE_CLASS).toContain("bottom-full");
  });
});

/**
 * The guarantee the shell carries, and the reason it is the strict one.
 *
 * Issue #989 puts real minimaps and loading-screen art on these cards, #1000 lets
 * a distribution supply any image file at all, and the featured map shows a
 * picture of whatever the mapper made, up to and including a snowfield. Coilbox
 * draws none of that and cannot promise any of it is dark, so the dark contract
 * cannot be what holds the text legible. White is the ceiling for an image, so a
 * band that clears AA over white clears it over every picture a source can hand
 * back, and no source has to darken its own output to be safe here.
 */
describe("text on art Coilbox did not draw", () => {
  measureBandOver([1, 1, 1]);
});

/**
 * The same measurement over the only art Coilbox generates itself.
 *
 * Mathematically implied by the white case, since a darker pixel under the band
 * can only raise the contrast. Kept because it is what states the procedural
 * field's ceiling in numbers, and because the two zones each shipped this
 * measurement before the shell existed: consolidating them into one file is the
 * point, dropping cases is not.
 */
describe("text on the procedural field", () => {
  measureBandOver(brightestProceduralPixel());
});

/**
 * The trap the shell exists to stop a third zone falling into. Neither Tailwind
 * colour utility works inside the dark island, because v4 substitutes the token
 * at `:root`, so nothing painted inside may carry one.
 */
describe("the dark island reads raw tokens, not Tailwind's utilities", () => {
  const inside = {
    "the card surface": ART_CARD_CLASS,
    "the band": ART_BAND_CLASS,
    "the secondary text": ART_DIM_CLASS,
    "the fade": ART_FADE_CLASS,
    "a control": ART_BUTTON_CLASS,
  };

  for (const [name, value] of Object.entries(inside)) {
    it(`keeps ${name} off the root-resolved colour utilities`, () => {
      expect(value).not.toMatch(
        /(?:^|[\s:])(?:bg|text|from|to)-(?:background|foreground|accent|muted|card|popover)(?:\/|\s|$)/,
      );
    });
  }

  it("declares the card a dark island", () => {
    expect(ART_CARD_CLASS.split(" ")).toContain("dark");
  });

  it("paints a base colour under art that does not cover", () => {
    expect(ART_CARD_CLASS).toContain("bg-[hsl(var(--background))]");
  });

  it("leaves the card's outer edge on the page's scheme, not the island's", () => {
    // `border-border` is one of the utilities above, resolved at `:root`, so this
    // hairline is the page's and not the card's. Deliberate, and what both zones
    // have shipped since #991: the edge is where the card meets the page, so it
    // belongs to the page. Everything the island paints is inside it.
    expect(ART_CARD_CLASS.split(" ")).toContain("border-border");
  });
});

/**
 * The install button, and the merge it has to win.
 *
 * picoframe's outline variant is `border-input bg-background`. Left alone, a
 * button in the band on a light page paints the page's white and keeps the band's
 * light text, so it reads as blank. `cn`'s tailwind-merge has to drop the
 * variant's versions in favour of the raw tokens, which is what this asserts
 * against the real merge rather than by inspection.
 */
describe("a control on card art", () => {
  const PICOFRAME_OUTLINE =
    "border border-input bg-background hover:bg-accent hover:text-accent-foreground";
  const merged = twMerge(`${PICOFRAME_OUTLINE} ${ART_BUTTON_CLASS}`).split(" ");

  it("keeps the card's own background, not the page's", () => {
    expect(merged).toContain("bg-[hsl(var(--background))]");
    expect(merged).not.toContain("bg-background");
  });

  it("keeps the card's own border, not the page's", () => {
    expect(merged).toContain("border-[hsl(var(--border))]");
    expect(merged).not.toContain("border-input");
  });

  it("keeps the card's own hover, not the page's", () => {
    expect(merged).toContain("hover:bg-[hsl(var(--accent))]");
    expect(merged).not.toContain("hover:bg-accent");
  });
});
