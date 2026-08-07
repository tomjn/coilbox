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
 * leaves on-page text with at least {@link MIN_CONTRAST_RETAINED} of the contrast
 * it has on the flat theme, across both picoframe ramps and the whole range of
 * its base presets. Body text keeps AAA outright.
 *
 * A flat white and a flat black image are the extremes worth checking because
 * relative luminance rises with every channel, so no other image can push the
 * composite outside the range those two bracket.
 *
 * What they do not prove: that any of it was rendered. The bound is arithmetic
 * over the CSS this module emits, and nothing here runs a browser. They also say
 * nothing about a distribution that overrides `--background` or `--foreground`
 * through `profile.theme`, which can set any contrast it likes, backdrop or not.
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
 * picoframe's theme tokens, transcribed from `@picoframe/frame/src/theme.css`.
 * `--base-hue` and `--base-sat` are the knobs its base presets turn, and every
 * token that is not a literal is written in terms of them, so scanning both
 * covers every base Coilbox can be themed with.
 */
const BASE_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
/** Neutral through the subtle tier to the vivid one, which tops out around 6. */
const BASE_SATS = [0, 1, 2.6, 5, 6];

function ramp(mode: "light" | "dark", hue: number, sat: number) {
  return mode === "light"
    ? {
        background: hsl(0, 0, 1),
        text: {
          foreground: hsl(hue, sat * 0.1, 0.12),
          "muted-foreground": hsl(hue, sat * 0.04, 0.46),
        },
      }
    : {
        background: hsl(hue, sat * 0.06, 0.07),
        text: {
          foreground: hsl(0, 0, 0.95),
          "muted-foreground": hsl(hue, sat * 0.05, 0.6),
        },
      };
}

/** How much of the flat theme's contrast a supplied image may cost. */
const MIN_CONTRAST_RETAINED = 0.85;

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
    for (const hue of BASE_HUES) {
      for (const sat of BASE_SATS) {
        const { background, text } = ramp(mode, hue, sat);
        const flat = luminance(background);
        // The whole range a backdrop at the bound can reach, bracketed by the
        // two extreme images.
        const darkest = luminance(
          over(background, [0, 0, 0], BACKDROP_MAX_ALPHA),
        );
        const lightest = luminance(
          over(background, [1, 1, 1], BACKDROP_MAX_ALPHA),
        );

        for (const [token, colour] of Object.entries(text)) {
          const label = `${mode} ${token} at base hue ${hue} sat ${sat}`;
          const ink = luminance(colour);
          const worst = Math.min(
            contrast(ink, darkest),
            contrast(ink, lightest),
          );

          it(`never swallows ${label}`, () => {
            // Text luminance inside the reachable range would mean some image
            // makes the text disappear into the backdrop entirely.
            expect(ink < darkest || ink > lightest).toBe(true);
          });

          it(`keeps ${MIN_CONTRAST_RETAINED} of the flat contrast for ${label}`, () => {
            expect(worst / contrast(ink, flat)).toBeGreaterThanOrEqual(
              MIN_CONTRAST_RETAINED,
            );
          });

          if (token === "foreground") {
            it(`keeps AAA for ${label}`, () => {
              expect(worst).toBeGreaterThanOrEqual(7);
            });
          }
        }
      }
    }
  }
});
