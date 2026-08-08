import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// background.ts reuses the profile's `@`-reference parser, which imports
// defineCommand from @picoframe/plugin-sdk for its file-read binding. That
// published dist won't load under Vitest's node resolver, and nothing here
// reads a file, so stub the leaf (same shim as refs.test.ts).
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import {
  BACKDROP_MAX_ALPHA,
  backdropStyle,
  DEFAULT_BACKDROP_GRADIENT,
  type HomeBackdrop,
  resolveHomeBackground,
} from "./background";

describe("resolveHomeBackground", () => {
  it("rewrites a file reference onto the coilbox protocol", () => {
    const bg = resolveHomeBackground("@.coilbox/art/bg.jpg");
    expect(bg.kind).toBe("image");
    // The same portable root the branded welcome's markup resolves against.
    expect(bg).toMatchObject({
      url: expect.stringContaining("portable/art/bg.jpg"),
    });
  });

  it("switches the backdrop off for false", () => {
    expect(resolveHomeBackground(false)).toEqual({ kind: "none" });
  });

  it("uses the default when the value is absent", () => {
    expect(resolveHomeBackground(undefined)).toEqual({ kind: "default" });
    expect(resolveHomeBackground(null)).toEqual({ kind: "default" });
  });

  it.each([
    ["a path that escapes the portable root", "@.coilbox/../../etc/passwd"],
    ["a reference in the wrong namespace", "@route/settings"],
    ["a bare path with no reference scheme", "art/bg.jpg"],
    ["an absolute URL", "https://example.test/bg.jpg"],
    ["an empty string", ""],
    ["true", true],
    ["a number", 42],
    ["an object", { url: "bg.jpg" }],
    ["an array", ["bg.jpg"]],
  ])("falls back to the default for %s", (_case, value) => {
    // Malformed input from a distribution must not blank the page, and must not
    // be silent either: a typo should look different from `false`.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveHomeBackground(value)).toEqual({ kind: "default" });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("backdropStyle", () => {
  it("paints nothing when the backdrop is off", () => {
    expect(backdropStyle({ kind: "none" })).toBeNull();
  });

  it("paints the default gradient", () => {
    expect(backdropStyle({ kind: "default" })).toEqual({
      backgroundImage: DEFAULT_BACKDROP_GRADIENT,
    });
  });

  it("covers the page with a supplied image, dimmed to the bound", () => {
    const style = backdropStyle({
      kind: "image",
      url: "coilbox://localhost/portable/art/bg.jpg",
    });
    expect(style).toEqual({
      backgroundImage: 'url("coilbox://localhost/portable/art/bg.jpg")',
      backgroundSize: "cover",
      backgroundPosition: "center",
      opacity: BACKDROP_MAX_ALPHA,
    });
  });
});

/**
 * The legibility guarantee, measured rather than asserted.
 *
 * What these tests prove: every backdrop layer composites over the theme
 * background at no more than {@link BACKDROP_MAX_ALPHA}, and at that bound the
 * worst image a distribution can supply (a flat white one, or a flat black one)
 * leaves every text colour on the page at or above WCAG AA, in both picoframe
 * ramps and every base preset it ships. Body text keeps AAA outright.
 *
 * A flat white and a flat black image are the extremes worth checking because
 * relative luminance rises with every channel, so no other image can push the
 * composite outside the range those two bracket.
 *
 * ## Absolute, and against the bases that exist
 *
 * Both halves of that changed in the accessibility pass (#1003), and each was
 * hiding the same failure.
 *
 * The criterion was relative: keep 85% of the contrast the text has on the flat
 * theme. That is only a guarantee if the text starts with room to lose, and
 * `--muted-foreground` does not. It is already the lightest ink that clears AA
 * (#1033), so on lime and yellow in the light ramp it has 5.11:1 to spend, and 85%
 * of that is 4.34:1. The old bound of 6% spent 12.3% of it and landed on 4.48:1,
 * under the bar, while passing a test that only asked about the percentage.
 *
 * The ramp model was a synthetic hue-by-saturation grid, which invents bases
 * picoframe does not ship: hue 60 at the subtle tier's saturation puts the muted
 * ink under AA on the flat theme, before any backdrop at all. A relative criterion
 * cannot notice that. An absolute one has to be measured against real presets, so
 * this enumerates the 22 the way `theme/mutedForeground.test.ts` does.
 *
 * ## What they do not prove
 *
 * The arithmetic below is over the CSS this module emits, and nothing here runs a
 * browser. It was checked once against pixels: the backdrop was rendered headless
 * over all 22 bases and both ramps in #1003, and the 6% failure reproduced at
 * 4.48:1, agreeing with this model to two decimal places.
 *
 * They also say nothing about a distribution that overrides `--background` or
 * `--foreground` through `profile.theme`, which can set any contrast it likes,
 * backdrop or not.
 */

/** Straight-alpha composite of `layer` over `base`, both linear in sRGB space. */
type Rgb = [number, number, number];
function over(base: Rgb, layer: Rgb, alpha: number): Rgb {
  return base.map((c, i) => c * (1 - alpha) + layer[i] * alpha) as Rgb;
}

/** CSS `hsl()` to sRGB channels, all inputs and outputs 0 to 1 except the hue. */
function hsl(h: number, s: number, l: number): Rgb {
  const sat = Math.min(Math.max(s, 0), 1);
  const c = (1 - Math.abs(2 * l - 1)) * sat;
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
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.2 contrast ratio between two relative luminances. */
function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every base preset picoframe ships, as `[name, --base-hue, --base-sat,
 * --base-sat-text]`. The two saturation knobs are separate because the vivid tier
 * pins the text one near the subtle tier's level, and the inks below are written
 * in terms of the text knob, so collapsing them models bases that do not exist.
 */
const BASES: readonly [string, number, number, number][] = [
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

/**
 * The lightness `src/index.css` ships for the light `--muted-foreground`, read
 * back rather than transcribed. Coilbox overrides the token (#1033) and the whole
 * bound below is derived from how little room it has left, so a change there has
 * to re-open this file rather than leave a stale number in it.
 */
function lightMutedLightness(): number {
  const css = readFileSync(
    fileURLToPath(new URL("../index.css", import.meta.url)),
    "utf8",
  );
  const found =
    /:root:not\(\.dark\)\s*\{\s*--muted-foreground:\s*var\(--base-hue\)\s*calc\(var\(--base-sat-text\)\s*\*\s*[0-9.]+%\)\s*([0-9.]+)%;/.exec(
      css,
    );
  if (!found)
    throw new Error("no --muted-foreground override in src/index.css");
  return Number(found[1]) / 100;
}

function ramp(
  mode: "light" | "dark",
  hue: number,
  sat: number,
  satText: number,
) {
  return mode === "light"
    ? {
        background: hsl(0, 0, 1),
        text: {
          foreground: hsl(hue, satText * 0.1, 0.12),
          "muted-foreground": hsl(hue, satText * 0.04, lightMutedLightness()),
        },
      }
    : {
        background: hsl(hue, sat * 0.06, 0.07),
        text: {
          foreground: hsl(0, 0, 0.95),
          "muted-foreground": hsl(hue, satText * 0.05, 0.6),
        },
      };
}

/** Text under 18.66px, which the tagline and every group label is. */
const AA_SMALL = 4.5;
/** The bar body text keeps even at the bound. */
const AAA = 7;

/** The alphas in a CSS string, summed. Overlapping layers add up. */
function totalAlpha(css: string): number {
  return [...css.matchAll(/\/\s*([0-9.]+)\s*\)/g)].reduce(
    (sum, m) => sum + Number(m[1]),
    0,
  );
}

describe("backdrop dimming", () => {
  it("keeps every layer of the default gradient within the bound", () => {
    // Summed, not per stop: the two gradients overlap on the page.
    expect(totalAlpha(DEFAULT_BACKDROP_GRADIENT)).toBeLessThanOrEqual(
      BACKDROP_MAX_ALPHA,
    );
  });

  it("gives every colour in the default gradient an explicit alpha", () => {
    // A stop written without one composites at full strength, which no amount
    // of arithmetic below would catch.
    const colours = DEFAULT_BACKDROP_GRADIENT.match(/hsl\(/g) ?? [];
    const alphas = DEFAULT_BACKDROP_GRADIENT.match(/\/\s*[0-9.]+\s*\)/g) ?? [];
    expect(alphas).toHaveLength(colours.length);
  });

  it("dims a supplied image to the bound", () => {
    const image: HomeBackdrop = { kind: "image", url: "coilbox://x" };
    expect(backdropStyle(image)?.opacity).toBeLessThanOrEqual(
      BACKDROP_MAX_ALPHA,
    );
  });

  for (const mode of ["light", "dark"] as const) {
    for (const [base, hue, sat, satText] of BASES) {
      const { background, text } = ramp(mode, hue, sat, satText);
      // The whole range a backdrop at the bound can reach, bracketed by the two
      // extreme images.
      const darkest = luminance(
        over(background, [0, 0, 0], BACKDROP_MAX_ALPHA),
      );
      const lightest = luminance(
        over(background, [1, 1, 1], BACKDROP_MAX_ALPHA),
      );

      for (const [token, colour] of Object.entries(text)) {
        const label = `${mode} ${token} on the ${base} base`;
        const ink = luminance(colour);
        const worst = Math.min(contrast(ink, darkest), contrast(ink, lightest));

        it(`never swallows ${label}`, () => {
          // Text luminance inside the reachable range would mean some image
          // makes the text disappear into the backdrop entirely.
          expect(ink < darkest || ink > lightest).toBe(true);
        });

        it(`keeps AA for ${label}`, () => {
          expect(worst).toBeGreaterThanOrEqual(AA_SMALL);
        });

        if (token === "foreground") {
          it(`keeps AAA for ${label}`, () => {
            expect(worst).toBeGreaterThanOrEqual(AAA);
          });
        }
      }
    }
  }

  it("sits under the bound with room, rather than on it", () => {
    // The margin is the point: at the ceiling the worst case is 4.51:1, so the
    // next percentage point of a token moves this file's answer without moving
    // this file. Anything that closes the gap should have to say why here.
    let ceiling = 0;
    for (let alpha = 0; alpha <= 0.2; alpha += 0.0005) {
      let worst = Number.POSITIVE_INFINITY;
      for (const mode of ["light", "dark"] as const)
        for (const [, hue, sat, satText] of BASES) {
          const { background, text } = ramp(mode, hue, sat, satText);
          for (const extreme of [
            [0, 0, 0],
            [1, 1, 1],
          ] as Rgb[]) {
            const surface = luminance(over(background, extreme, alpha));
            for (const colour of Object.values(text))
              worst = Math.min(worst, contrast(luminance(colour), surface));
          }
        }
      if (worst >= AA_SMALL) ceiling = alpha;
    }
    expect(BACKDROP_MAX_ALPHA).toBeLessThan(ceiling);
  });
});
