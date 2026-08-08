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
 * ramp picoframe ships, in both colour schemes, over any picture at all.
 *
 * The scheme used to drop out of this: the card pinned itself to the dark ramp,
 * so there was one case rather than two. Issue #1044 gave the card the page's
 * ramp, and the two cases are not each other's mirror image. On the dark ramp
 * light text sits on a dark band, and the picture that hurts is a white one. On
 * the light ramp dark text sits on a white band, and the picture that hurts is a
 * black one, because it is what the band lets through that decides how far the
 * text can be dimmed. Both worst cases are measured, and a scan of the whole
 * colour cube below shows that neither ramp has anything worse in between.
 *
 * What it does not prove: that any of it was rendered. The zone tests check that
 * the cards wear these classes, and the PRs for #991, #995, #1021 and #1044 carry
 * screenshots.
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

const BASE_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

/**
 * The two saturation knobs a base preset moves, paired as the presets pair them.
 *
 * `--base-sat` tints surfaces and `--base-sat-text` tints foregrounds. The subtle
 * tier ties them together and stays under 2.6. The vivid tier pushes surfaces to
 * between 5.5 and 11 (navy, the hottest) while pinning text back to 2, which is
 * why body copy on a vivid base is near-black rather than plum. Taking the two
 * separately would measure a text colour no base ships.
 */
const BASE_SATS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [2.6, 2.6],
  [6, 2],
  [11, 2],
];

/** The two ramps, transcribed from `@picoframe/frame/src/theme.css`. */
const RAMPS = {
  dark: {
    /** `.dark --background`, retinted by the base. */
    surface: (hue: number, sat: number) => hsl(hue, (sat * 6) / 100, 0.07),
    /** `.dark --foreground`, a literal near-white the base does not move. */
    ink: () => hsl(0, 0, 0.95),
    /** Black is the floor for a picture, white the ceiling. */
    worstArt: [1, 1, 1] as Rgb,
  },
  light: {
    /** `:root --background`, a literal white the base does not retint. */
    surface: () => hsl(0, 0, 1),
    /** `:root --foreground`, near-black and tinted by the text knob. */
    ink: (hue: number, satText: number) => hsl(hue, (satText * 10) / 100, 0.12),
    worstArt: [0, 0, 0] as Rgb,
  },
} as const;

type Scheme = keyof typeof RAMPS;
const SCHEMES = Object.keys(RAMPS) as Scheme[];

const bandAlpha = tokenAlpha(ART_BAND_CLASS, "background");
const textAlpha = tokenAlpha(ART_BAND_CLASS, "foreground");
const dimAlpha = tokenAlpha(ART_DIM_CLASS, "foreground");

/** The band and its two text colours over `art`, in one base of one ramp. */
function bandOver(
  art: Rgb,
  scheme: Scheme,
  hue: number,
  sat: number,
  satText: number,
) {
  const ramp = RAMPS[scheme];
  const band = over(art, ramp.surface(hue, sat), bandAlpha);
  const ink = ramp.ink(hue, satText);
  return {
    band,
    name: contrast(over(band, ink, textAlpha), band),
    secondary: contrast(over(band, ink, dimAlpha), band),
  };
}

/** Measure both text colours over `art`, in every base ramp picoframe ships. */
function measureBandOver(art: Rgb, scheme: Scheme) {
  for (const hue of BASE_HUES) {
    for (const [sat, satText] of BASE_SATS) {
      const measured = bandOver(art, scheme, hue, sat, satText);
      const label = `${scheme} base hue ${hue} sat ${sat}`;

      it(`clears AA for the card's name at ${label}`, () => {
        expect(measured.name).toBeGreaterThanOrEqual(4.5);
      });

      it(`clears AA for the card's secondary line at ${label}`, () => {
        expect(measured.secondary).toBeGreaterThanOrEqual(4.5);
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
 * picture of whatever the mapper made, up to and including a snowfield and a
 * night battle. Coilbox draws none of that and can promise nothing about it, so
 * what holds the text legible has to be the band and not the picture. Black and
 * white are a picture's floor and ceiling, and each ramp's worst case is one of
 * them, so a band that clears AA there clears it over every picture a source can
 * hand back and no source has to tune its own output to be safe here.
 */
describe("text on art Coilbox did not draw", () => {
  for (const scheme of SCHEMES) measureBandOver(RAMPS[scheme].worstArt, scheme);
});

/**
 * That the corner really is the worst case, rather than an assumption about a
 * composite of four colours that is not obviously monotone.
 *
 * The scan walks the sRGB cube, so it covers the procedural field, every bundled
 * illustration and every minimap in one measurement. It replaces a case that
 * measured only the brightest pixel the procedural generator can paint, which
 * this contains.
 */
describe("no picture is worse than the corner", () => {
  const STEPS = [0, 0.25, 0.5, 0.75, 1];

  for (const scheme of SCHEMES) {
    it(`holds AA over every colour a picture can be, ${scheme}`, () => {
      let name = { ratio: Number.POSITIVE_INFINITY, at: "" };
      let secondary = { ratio: Number.POSITIVE_INFINITY, at: "" };
      for (const r of STEPS)
        for (const g of STEPS)
          for (const b of STEPS)
            for (const hue of BASE_HUES)
              for (const [sat, satText] of BASE_SATS) {
                const m = bandOver([r, g, b], scheme, hue, sat, satText);
                const at = `rgb(${r} ${g} ${b}) on base ${hue}/${sat}`;
                if (m.name < name.ratio) name = { ratio: m.name, at };
                if (m.secondary < secondary.ratio)
                  secondary = { ratio: m.secondary, at };
              }
      expect(name.ratio, name.at).toBeGreaterThanOrEqual(4.5);
      expect(secondary.ratio, secondary.at).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * The trap the shell exists to stop a third zone falling into. A Tailwind colour
 * utility resolves its token at `:root`, and the band's alpha would composite in
 * oklab rather than in the straight sRGB the measurement above assumes, so
 * nothing painted inside the card may carry one.
 */
describe("the card reads raw tokens, not Tailwind's utilities", () => {
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

  it("takes the page's ramp rather than pinning itself to the dark one", () => {
    // Issue #1044. The card carried picoframe's `dark` class, so a light page
    // showed a grid of dark tiles. Nothing else in the shell changed.
    expect(ART_CARD_CLASS.split(" ")).not.toContain("dark");
  });

  it("paints a base colour under art that does not cover", () => {
    expect(ART_CARD_CLASS).toContain("bg-[hsl(var(--background))]");
  });

  it("draws the card's edge in the same ramp as its inside", () => {
    // Issue #1046 asked whether the hairline belongs to the page or to the card,
    // because `border-border` resolves at `:root` and the card was dark. With the
    // card on the page's ramp the two answers are the same colour, so the
    // question closes rather than being settled one way.
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
