import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bracketColor,
  HUD_ACCENT_INK,
  HUD_CARD_CLASS,
  HUD_DIM_INK_CLASS,
  HUD_INK_CLASS,
  MAP_BAND_CLASS,
  MAP_DIM_INK_CLASS,
  MAP_INK_CLASS,
} from "./hudChrome";

/**
 * The legibility guarantee for a label sitting on the galaxy canvas (#1052).
 *
 * The conquest map and the warpath map both draw HTML over a live 3D starfield.
 * Most of that HTML is inside a `BracketFrame`, which paints a card under it. A
 * couple of labels were not, and theme ink straight on a starfield is not a
 * colour pair at all: `--muted-foreground` is a 41% dark grey in the light
 * scheme, and the pan/zoom hint measured 3.60:1 against the empty backdrop in
 * the running app, worse over any star it happened to cross. Nothing could
 * measure it, which is what the issue was really about.
 *
 * The band fixes that by deciding the backdrop instead of guessing it. What this
 * file proves is that once 78% of the page's own background is between the text
 * and the canvas, both inks clear WCAG AA (4.5:1) whatever the canvas was
 * painting, in either ramp and on every base preset picoframe ships.
 *
 * The alphas are read out of the shipped class strings, so weakening the band
 * re-runs the measurement rather than leaving a stale number here.
 *
 * The scan below is over the whole sRGB cube rather than over the starfield's
 * own palette. That is deliberate: the palette varies per galaxy (see
 * `galaxyPalette`), a distribution can theme it, and the camera can put a
 * corona, a nebula or a lane under any pixel. Bounding the backdrop by black and
 * white covers all of it at once and leaves nothing for a new galaxy theme to
 * have to check.
 *
 * The colour maths is transcribed from WCAG 2.2, copied rather than imported for
 * the reason `src/theme/mutedForeground.test.ts` gives.
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
 * The two saturation knobs a base preset moves, paired as the presets pair them:
 * `--base-sat` tints surfaces, `--base-sat-text` tints foregrounds. Taking them
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
  },
  light: {
    /** `:root --background`, a literal white the base does not retint. */
    surface: () => hsl(0, 0, 1),
    /** `:root --foreground`, near-black and tinted by the text knob. */
    ink: (hue: number, satText: number) => hsl(hue, (satText * 10) / 100, 0.12),
  },
} as const;

type Scheme = keyof typeof RAMPS;
const SCHEMES = Object.keys(RAMPS) as Scheme[];

const bandAlpha = tokenAlpha(MAP_BAND_CLASS, "background");
const inkAlpha = tokenAlpha(MAP_INK_CLASS, "foreground");
const dimAlpha = tokenAlpha(MAP_DIM_INK_CLASS, "foreground");

/** The band and its two inks over `canvas`, in one base of one ramp. */
function bandOver(
  canvas: Rgb,
  scheme: Scheme,
  hue: number,
  sat: number,
  satText: number,
) {
  const ramp = RAMPS[scheme];
  const band = over(canvas, ramp.surface(hue, sat), bandAlpha);
  const ink = ramp.ink(hue, satText);
  return {
    body: contrast(over(band, ink, inkAlpha), band),
    dim: contrast(over(band, ink, dimAlpha), band),
  };
}

describe("the band under a label on the galaxy canvas", () => {
  it("lets some of the canvas through, so it is a band and not a panel", () => {
    expect(bandAlpha).toBeGreaterThan(0);
    expect(bandAlpha).toBeLessThan(1);
  });

  it("keeps the quiet ink quieter than the body ink", () => {
    // Losing the step would make the hint shout as loudly as the recap it sits
    // under, which is the hierarchy the old muted token was carrying.
    expect(dimAlpha).toBeLessThan(inkAlpha);
  });
});

describe("both inks clear AA over anything the canvas can paint", () => {
  const STEPS = [0, 0.25, 0.5, 0.75, 1];

  for (const scheme of SCHEMES) {
    it(`holds over every colour a starfield can be, ${scheme}`, () => {
      let body = { ratio: Number.POSITIVE_INFINITY, at: "" };
      let dim = { ratio: Number.POSITIVE_INFINITY, at: "" };
      for (const r of STEPS)
        for (const g of STEPS)
          for (const b of STEPS)
            for (const hue of BASE_HUES)
              for (const [sat, satText] of BASE_SATS) {
                const m = bandOver([r, g, b], scheme, hue, sat, satText);
                const at = `rgb(${r} ${g} ${b}) on base ${hue}/${sat}`;
                if (m.body < body.ratio) body = { ratio: m.body, at };
                if (m.dim < dim.ratio) dim = { ratio: m.dim, at };
              }
      expect(body.ratio, body.at).toBeGreaterThanOrEqual(4.5);
      expect(dim.ratio, dim.at).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * The trap the raw tokens exist to dodge. A Tailwind colour utility resolves its
 * token at `:root`, and its alpha syntax composites in oklab rather than in the
 * straight sRGB the measurement above assumes, so the band that got measured
 * would not be the band that got painted.
 */
describe("the band reads raw tokens, not Tailwind's utilities", () => {
  const strings = {
    "the band": MAP_BAND_CLASS,
    "the body ink": MAP_INK_CLASS,
    "the quiet ink": MAP_DIM_INK_CLASS,
  };

  for (const [name, value] of Object.entries(strings)) {
    it(`keeps ${name} off the root-resolved colour utilities`, () => {
      expect(value).not.toMatch(
        /(?:^|[\s:])(?:bg|text|from|to)-(?:background|foreground|accent|muted|card|popover)(?:\/|\s|$)/,
      );
    });
  }
});

describe("the labels that sit straight on the canvas", () => {
  // The pan/zoom hint and the "Last turn" recap are the two overlays on
  // GalaxyPage with no BracketFrame under them. Everything else on either map
  // is inside a card. If a third one appears it needs the band too, and this is
  // the line that will look wrong when it does.
  const page = readFileSync(
    fileURLToPath(new URL("../GalaxyPage.tsx", import.meta.url)),
    "utf8",
  );

  /** The opening tag `text` is inside, back to the nearest `<tag`. */
  function tagAround(text: string, tag: string): string {
    const at = page.indexOf(text);
    expect(at, `no "${text}" in GalaxyPage.tsx`).toBeGreaterThan(-1);
    return page.slice(page.lastIndexOf(tag, at), at);
  }

  /** A whole component, from its declaration to the closing brace in column one. */
  function component(name: string): string {
    const at = page.indexOf(`function ${name}(`);
    expect(at, `no ${name} in GalaxyPage.tsx`).toBeGreaterThan(-1);
    return page.slice(at, page.indexOf("\n}\n", at));
  }

  const sites = {
    "the pan/zoom hint": tagAround("drag to pan", "<p"),
    "the turn recap": component("TurnRecap"),
  };

  for (const [name, markup] of Object.entries(sites)) {
    it(`puts the band under ${name}`, () => {
      expect(markup).toContain("MAP_BAND_CLASS");
    });

    it(`sets ${name} in the band's ink, not a theme token`, () => {
      // `text-muted-foreground` here measured 3.60:1 on the empty backdrop, and
      // worse over a star.
      expect(markup).toMatch(/MAP_(?:DIM_)?INK_CLASS/);
      expect(markup).not.toContain("text-muted-foreground");
    });
  }
});

/**
 * The legibility guarantee for text on a HUD card over the galaxy canvas (#1785).
 *
 * The band above covers the two labels with nothing under them. This covers the
 * rest of the HUD, which is every tile on the conquest map and the warpath map,
 * and which does have something under it. The card was `bg-card/70`, so a third
 * of whatever the starfield rendered landed behind the text, and the worst pixel
 * a starfield can paint is white.
 *
 * Three things had to hold at once and only one of them was the alpha:
 *
 * - The card's own ink. Fine at 70% already, and better at 78%.
 * - `--muted-foreground`. Not fine at any alpha worth having: it needs the card
 *   at 95% to survive a star, which is opaque in all but name. `.hud-card` in
 *   `src/index.css` points the token at the card's ink at 75% instead, and this
 *   file reads that number back out of the stylesheet.
 * - The accent inks. Those were Tailwind 300/400 shades, picked for a dark
 *   surface, on a HUD that does not force a dark scheme. On a light one they
 *   measured 1.0:1. No card alpha could have fixed that, because the card is
 *   white there too, so they became a value per ramp.
 *
 * The sweep is the same one the band uses: the whole sRGB cube for the canvas,
 * both ramps, every base preset. The alphas and the accent triples are read out
 * of the shipped strings, so weakening any of them re-runs the measurement.
 */

/** The two card ramps, transcribed from `@picoframe/frame/src/theme.css`. */
const CARD_RAMPS = {
  dark: {
    /** `.dark --card`, retinted by the base. */
    surface: (hue: number, sat: number) => hsl(hue, (sat * 5) / 100, 0.1),
    /** `.dark --card-foreground`, a literal near-white. */
    ink: () => hsl(0, 0, 0.95),
  },
  light: {
    /** `:root --card`, a literal white. */
    surface: () => hsl(0, 0, 1),
    /** `:root --card-foreground`, near-black and tinted by the text knob. */
    ink: (hue: number, satText: number) => hsl(hue, (satText * 10) / 100, 0.12),
  },
} as const;

const cardAlpha = tokenAlpha(HUD_CARD_CLASS, "card");
const cardInkAlpha = tokenAlpha(HUD_INK_CLASS, "card-foreground");
const cardDimAlpha = tokenAlpha(HUD_DIM_INK_CLASS, "card-foreground");

/**
 * The alpha `.hud-card` steps `--muted-foreground` down to, straight out of
 * `src/index.css`.
 *
 * The whole declaration is matched, not just the number. It has to be the
 * Tailwind theme variable rather than picoframe's raw token, because Tailwind
 * resolves `--color-muted-foreground` at `:root` and a subtree redefining
 * `--muted-foreground` would change nothing at all while looking like it had.
 * It also has to point at the card's ink rather than at a fixed grey, so a base
 * preset keeps its tint.
 */
function scopedMutedAlpha(): number {
  const css = readFileSync(
    fileURLToPath(new URL("../../../index.css", import.meta.url)),
    "utf8",
  );
  const found =
    /\.hud-card\s*\{\s*--color-muted-foreground:\s*hsl\(var\(--card-foreground\)\s*\/\s*([0-9.]+)\);/.exec(
      css,
    );
  if (!found) throw new Error("no .hud-card muted override in src/index.css");
  return Number(found[1]);
}

/** An `hsl(H_S%_L%)` arbitrary value, light ramp and dark ramp. */
function accentInks(className: string): { light: Rgb; dark: Rgb } {
  const read = (prefix: string) => {
    const found = new RegExp(
      `${prefix}text-\\[hsl\\(([0-9.]+)_([0-9.]+)%_([0-9.]+)%\\)\\]`,
    ).exec(className);
    if (!found) throw new Error(`no ${prefix || "light"} ink in ${className}`);
    return hsl(
      Number(found[1]),
      Number(found[2]) / 100,
      Number(found[3]) / 100,
    );
  };
  // The light value is the bare utility, so anchor it to a word boundary that
  // `dark:` cannot satisfy.
  return { light: read("(?:^|\\s)"), dark: read("dark:") };
}

/** The card and everything set on it, over `canvas`, in one base of one ramp. */
function cardOver(
  canvas: Rgb,
  scheme: Scheme,
  hue: number,
  sat: number,
  satText: number,
) {
  const ramp = CARD_RAMPS[scheme];
  const card = over(canvas, ramp.surface(hue, sat), cardAlpha);
  const ink = ramp.ink(hue, satText);
  const ratios: Record<string, number> = {
    body: contrast(over(card, ink, cardInkAlpha), card),
    dim: contrast(over(card, ink, cardDimAlpha), card),
    muted: contrast(over(card, ink, scopedMutedAlpha()), card),
  };
  for (const [name, value] of Object.entries(HUD_ACCENT_INK)) {
    ratios[name] = contrast(accentInks(value)[scheme], card);
  }
  return ratios;
}

describe("the card under the HUD", () => {
  it("still lets the map through, so the HUD is a console and not a wall", () => {
    // The point of raising 70% at all was to afford the quiet ink. Taking it to
    // the 95% `--muted-foreground` would have needed loses the map entirely.
    expect(cardAlpha).toBeGreaterThan(0);
    expect(cardAlpha).toBeLessThanOrEqual(0.8);
  });

  it("keeps the quiet ink quieter than the body ink", () => {
    expect(cardDimAlpha).toBeLessThan(cardInkAlpha);
  });

  it("carries the class that bounds --muted-foreground inside it", () => {
    // Without this the stylesheet rule matches nothing and every muted label on
    // both maps silently goes back to 2.3:1.
    expect(HUD_CARD_CLASS).toMatch(/(?:^|\s)hud-card(?:\s|$)/);
  });
});

describe("everything set on a HUD card clears AA over anything the canvas can paint", () => {
  const STEPS = [0, 0.25, 0.5, 0.75, 1];

  for (const scheme of SCHEMES) {
    it(`holds over every colour a starfield can be, ${scheme}`, () => {
      const worst: Record<string, { ratio: number; at: string }> = {};
      for (const r of STEPS)
        for (const g of STEPS)
          for (const b of STEPS)
            for (const hue of BASE_HUES)
              for (const [sat, satText] of BASE_SATS) {
                const at = `rgb(${r} ${g} ${b}) on base ${hue}/${sat}`;
                for (const [name, ratio] of Object.entries(
                  cardOver([r, g, b], scheme, hue, sat, satText),
                )) {
                  if (!worst[name] || ratio < worst[name].ratio)
                    worst[name] = { ratio, at };
                }
              }
      for (const [name, { ratio, at }] of Object.entries(worst)) {
        expect(ratio, `${name} at ${at}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe("the HUD card reads raw tokens, not Tailwind's utilities", () => {
  const strings = {
    "the card": HUD_CARD_CLASS,
    "the body ink": HUD_INK_CLASS,
    "the quiet ink": HUD_DIM_INK_CLASS,
  };

  for (const [name, value] of Object.entries(strings)) {
    it(`keeps ${name} off the root-resolved colour utilities`, () => {
      expect(value).not.toMatch(
        /(?:^|[\s:])(?:bg|text|from|to)-(?:background|foreground|accent|muted|card|popover)(?:\/|\s|$)/,
      );
    });
  }

  it("keeps the accent inks off the Tailwind palette", () => {
    // `text-cyan-300` and friends are one value used in both ramps, and the
    // light ramp is where they measured 1.0:1.
    for (const value of Object.values(HUD_ACCENT_INK)) {
      expect(value).not.toMatch(/text-[a-z]+-\d{2,3}/);
    }
  });
});

describe("the faction colour a galaxy document names", () => {
  // `parseFaction` accepts any string for `Faction.color`, and a galaxy can
  // arrive from an imported challenge code, so the frame decides for itself what
  // it is willing to paint.
  it("paints a hex literal", () => {
    expect(bracketColor("#ff8800")).toBe("#ff8800");
    expect(bracketColor("#F80")).toBe("#F80");
    expect(bracketColor("  #ff8800  ")).toBe("#ff8800");
  });

  it("ignores anything that is not one", () => {
    for (const hostile of [
      undefined,
      "",
      "   ",
      "red",
      "currentColor",
      "transparent",
      "inherit",
      "rgb(255 0 0)",
      "var(--destructive)",
      "#ff88",
      "#ff88000",
      "#gggggg",
      "red; background-image: url(https://example.invalid/x.png)",
      "url(https://example.invalid/x.png)",
      "attr(data-x)",
      "#ff8800 !important",
    ]) {
      expect(bracketColor(hostile), String(hostile)).toBeUndefined();
    }
  });
});
