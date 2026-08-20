import { readdirSync, readFileSync } from "node:fs";
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
 * painting, on every base preset picoframe ships.
 *
 * Every sweep here is over the dark ramp alone. Both maps hold that ramp whoever
 * is looking at them (#1810), because a starfield has no light version, and
 * nothing outside those two routes uses this chrome. `no importer outside the
 * two forced-dark routes` at the foot of this file is what keeps that true, and
 * a light measurement without it would be measuring a screen nobody sees.
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
 * The saturation knob a base preset moves surfaces by, `--base-sat`.
 *
 * A preset moves foregrounds too, with `--base-sat-text`, and that one does not
 * appear below: the dark ramp's inks are literal near-whites the base leaves
 * alone. The light ramp's are the tinted ones, and the light ramp is not on
 * screen here.
 */
const BASE_SATS = [0, 1, 2.6, 6, 11];

/** The dark ramp's page surface, transcribed from `@picoframe/frame/src/theme.css`. */
const DARK_BAND = {
  /** `.dark --background`, retinted by the base. */
  surface: (hue: number, sat: number) => hsl(hue, (sat * 6) / 100, 0.07),
  /** `.dark --foreground`, a literal near-white the base does not move. */
  ink: hsl(0, 0, 0.95),
};

const bandAlpha = tokenAlpha(MAP_BAND_CLASS, "background");
const inkAlpha = tokenAlpha(MAP_INK_CLASS, "foreground");
const dimAlpha = tokenAlpha(MAP_DIM_INK_CLASS, "foreground");

/** The band and its two inks over `canvas`, in one base. */
function bandOver(canvas: Rgb, hue: number, sat: number) {
  const band = over(canvas, DARK_BAND.surface(hue, sat), bandAlpha);
  const ink = DARK_BAND.ink;
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

  it("holds over every colour a starfield can be", () => {
    let body = { ratio: Number.POSITIVE_INFINITY, at: "" };
    let dim = { ratio: Number.POSITIVE_INFINITY, at: "" };
    for (const r of STEPS)
      for (const g of STEPS)
        for (const b of STEPS)
          for (const hue of BASE_HUES)
            for (const sat of BASE_SATS) {
              const m = bandOver([r, g, b], hue, sat);
              const at = `rgb(${r} ${g} ${b}) on base ${hue}/${sat}`;
              if (m.body < body.ratio) body = { ratio: m.body, at };
              if (m.dim < dim.ratio) dim = { ratio: m.dim, at };
            }
    expect(body.ratio, body.at).toBeGreaterThanOrEqual(4.5);
    expect(dim.ratio, dim.at).toBeGreaterThanOrEqual(4.5);
  });
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
 *   surface, on a HUD that did not force a dark scheme. On a light one they
 *   measured 1.0:1. No card alpha could have fixed that, because the card is
 *   white there too, so they became a measured value. #1810 then made both maps
 *   hold the dark ramp, so that is the one value they need (#1811).
 *
 * The sweep is the same one the band uses: the whole sRGB cube for the canvas,
 * every base preset. The alphas and the accent triples are read out of the
 * shipped strings, so weakening any of them re-runs the measurement.
 */

/** The dark ramp's card, transcribed from `@picoframe/frame/src/theme.css`. */
const DARK_CARD = {
  /** `.dark --card`, retinted by the base. */
  surface: (hue: number, sat: number) => hsl(hue, (sat * 5) / 100, 0.1),
  /** `.dark --card-foreground`, a literal near-white the base does not move. */
  ink: hsl(0, 0, 0.95),
};

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

/** The `hsl(H_S%_L%)` arbitrary value an accent ships as. */
function accentInk(className: string): Rgb {
  const found = /text-\[hsl\(([0-9.]+)_([0-9.]+)%_([0-9.]+)%\)\]/.exec(
    className,
  );
  if (!found) throw new Error(`no ink in ${className}`);
  return hsl(Number(found[1]), Number(found[2]) / 100, Number(found[3]) / 100);
}

/** The card and everything set on it, over `canvas`, in one base. */
function cardOver(canvas: Rgb, hue: number, sat: number) {
  const card = over(canvas, DARK_CARD.surface(hue, sat), cardAlpha);
  const ink = DARK_CARD.ink;
  const ratios: Record<string, number> = {
    body: contrast(over(card, ink, cardInkAlpha), card),
    dim: contrast(over(card, ink, cardDimAlpha), card),
    muted: contrast(over(card, ink, scopedMutedAlpha()), card),
  };
  for (const [name, value] of Object.entries(HUD_ACCENT_INK)) {
    ratios[name] = contrast(accentInk(value), card);
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

  it("holds over every colour a starfield can be", () => {
    const worst: Record<string, { ratio: number; at: string }> = {};
    for (const r of STEPS)
      for (const g of STEPS)
        for (const b of STEPS)
          for (const hue of BASE_HUES)
            for (const sat of BASE_SATS) {
              const at = `rgb(${r} ${g} ${b}) on base ${hue}/${sat}`;
              for (const [name, ratio] of Object.entries(
                cardOver([r, g, b], hue, sat),
              )) {
                if (!worst[name] || ratio < worst[name].ratio)
                  worst[name] = { ratio, at };
              }
            }
    for (const [name, { ratio, at }] of Object.entries(worst)) {
      expect(ratio, `${name} at ${at}`).toBeGreaterThanOrEqual(4.5);
    }
  });
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
    // `text-cyan-300` and friends are a shade somebody picked by eye, and the
    // point of an `hsl()` literal is that this file can read it back and
    // re-measure it. A palette class it cannot.
    for (const value of Object.values(HUD_ACCENT_INK)) {
      expect(value).not.toMatch(/text-[a-z]+-\d{2,3}/);
    }
  });
});

/**
 * The accent inks over the band rather than over the card (#1801).
 *
 * Two accented labels are not on a card at all: the warpath's run name and its
 * difficulty badge, which sit straight on the node map. Both now take
 * {@link MAP_BAND_CLASS}, so what is behind their ink is 78% of `--background`
 * rather than 78% of `--card`.
 *
 * Those are different surfaces, so the card's measurement does not carry over on
 * its own. It happens to be the safe direction, the dark `--background` being
 * darker than the dark `--card`, but "it happens to be" is exactly the kind of
 * thing that stops being true when picoframe retunes a ramp.
 */
describe("the accent inks clear AA on the band too", () => {
  const STEPS = [0, 0.25, 0.5, 0.75, 1];

  it("holds over every colour the map can be", () => {
    const worst: Record<string, { ratio: number; at: string }> = {};
    for (const r of STEPS)
      for (const g of STEPS)
        for (const b of STEPS)
          for (const hue of BASE_HUES)
            for (const sat of BASE_SATS) {
              const band = over(
                [r, g, b],
                DARK_BAND.surface(hue, sat),
                bandAlpha,
              );
              const at = `rgb(${r} ${g} ${b}) on base ${hue}/${sat}`;
              for (const [name, value] of Object.entries(HUD_ACCENT_INK)) {
                const ratio = contrast(accentInk(value), band);
                if (!worst[name] || ratio < worst[name].ratio)
                  worst[name] = { ratio, at };
              }
            }
    for (const [name, { ratio, at }] of Object.entries(worst)) {
      expect(ratio, `${name} at ${at}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/**
 * The Tailwind palette classes the HUD still writes at a call site (#1801).
 *
 * #1785 moved the shared accents to a measured ink. #1801 was the
 * same defect at the call sites, roughly two dozen 300/400 shades, and most of
 * what made it a defect was the light ramp: `text-cyan-300` on a white card is
 * 1.0:1. #1810 then made both maps hold the dark ramp whatever theme the player
 * picked, so the light half of that stopped being reachable and the question
 * became narrower. Which of these fail against a dark backdrop?
 *
 * Twelve did and are now measured inks. What is left is the list below, which
 * passed, and this is what stops it drifting back. A shade is one keystroke from
 * its neighbour and `text-emerald-400` clears its bar by 0.8, so a later edit
 * that reaches for a 500 has no way of knowing it just broke this.
 *
 * The bar per row is what WCAG asks of that thing, not one figure applied to
 * everything. 4.5:1 for small text, 3:1 for text at 24px bold, and 3:1 for an
 * `aria-hidden` icon or a bar that repeats a figure printed beside it. That last
 * one is decoration and carries no WCAG requirement at all, but decoration
 * nobody can see is not decoration, and 3:1 is the nearest honest bar.
 *
 * Only the dark ramp is swept, as everywhere else in this file. These are one
 * value used in both ramps, and the light one cannot be reached on either route,
 * so a light measurement here would be measuring a screen nobody sees. If the
 * forcing ever goes, most of these rows fail on the light ramp.
 */

/** The `oklch()` values Tailwind's palette ships, as sRGB. */
function tailwindPalette(): Record<string, Rgb> {
  const css = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../node_modules/tailwindcss/theme.css",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const out: Record<string, Rgb> = {};
  for (const [, name, l, c, h] of css.matchAll(
    /--color-([a-z]+-\d{2,3}):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g,
  )) {
    out[name] = oklch(Number(l) / 100, Number(c), Number(h));
  }
  return out;
}

/**
 * One OKLCh colour as sRGB.
 *
 * Out-of-gamut channels are clipped, where a browser reduces chroma instead. A
 * third of Tailwind's palette is outside sRGB, so the two do differ, but the
 * gap was under 0.02 on every ratio below when this was checked against Chrome's
 * own painted pixels, and the tightest row here clears its bar by 0.7.
 */
function oklch(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const cube = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ];
  const linear = [
    [4.0767416621, -3.3077115913, 0.2309699292],
    [-1.2684380046, 2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147, 1.707614701],
  ].map((row) => row.reduce((sum, k, i) => sum + k * cube[i], 0));
  return linear.map((v) => {
    const clipped = Math.min(1, Math.max(0, v));
    return clipped <= 0.0031308
      ? 12.92 * clipped
      : 1.055 * clipped ** (1 / 2.4) - 0.055;
  }) as Rgb;
}

/** Where a palette class sits, and what WCAG asks of it there. */
type PaletteSite = {
  /** A file in `src/conquest/pages` or `src/runlite/pages`, from this one. */
  file: string;
  /** The class exactly as the file writes it. */
  className: string;
  /** `card` for a `BracketFrame`, `band` for a {@link MAP_BAND_CLASS} label. */
  on: "card" | "band";
  /** 4.5 for small text, 3 for large text, an icon or a bar. */
  bar: number;
  /** What it colours, for the failure message. */
  what: string;
};

const PALETTE_SITES: PaletteSite[] = [
  {
    file: "../GalaxyPage.tsx",
    className: "text-amber-200",
    on: "card",
    bar: 4.5,
    what: "the incursion warning button",
  },
  {
    file: "../GalaxyPage.tsx",
    className: "hover:text-amber-100",
    on: "card",
    bar: 4.5,
    what: "the incursion warning button, hovered",
  },
  {
    file: "../GalaxyPage.tsx",
    className: "bg-amber-400",
    on: "card",
    bar: 3,
    what: "a lit difficulty pip",
  },
  {
    file: "../GalaxyPage.tsx",
    className: "border-cyan-400",
    on: "card",
    bar: 3,
    what: "the chosen faction's outline, which is what says it is chosen",
  },
  {
    file: "../GalaxyPage.tsx",
    className: "text-emerald-400",
    on: "card",
    bar: 3,
    what: "the Galaxy conquered heading",
  },
  {
    file: "./BattleOverlay.tsx",
    className: "text-amber-400",
    on: "card",
    bar: 3,
    what: "the shield icon on the Defend heading",
  },
  {
    file: "./BattleOverlay.tsx",
    className: "text-emerald-400",
    on: "card",
    bar: 3,
    what: "the Victory heading",
  },
  {
    file: "./BattleOverlay.tsx",
    className: "text-emerald-300",
    on: "card",
    bar: 4.5,
    what: "the galaxy-is-yours line",
  },
  {
    file: "./BattleOverlay.tsx",
    className: "text-amber-300",
    on: "card",
    bar: 4.5,
    what: "the enemy-incursion line",
  },
  {
    file: "../../../runlite/pages/RunPage.tsx",
    className: "text-yellow-300",
    on: "card",
    bar: 3,
    what: "the trophy on the end screen",
  },
  {
    file: "../../../runlite/pages/RunPage.tsx",
    className: "text-emerald-400",
    on: "card",
    bar: 3,
    what: "the Warpath complete heading",
  },
  {
    file: "../../../runlite/pages/components/RunHud.tsx",
    className: "bg-cyan-400",
    on: "card",
    bar: 3,
    what: "the hull bar, stable",
  },
  {
    file: "../../../runlite/pages/components/RunHud.tsx",
    className: "bg-amber-400",
    on: "card",
    bar: 3,
    what: "the hull bar strained, and a crossed sector pip",
  },
  {
    file: "../../../runlite/pages/components/RunHud.tsx",
    className: "bg-red-300",
    on: "card",
    bar: 3,
    what: "the hull bar, critical",
  },
  {
    file: "../../../runlite/pages/components/RunHud.tsx",
    className: "text-cyan-400",
    on: "card",
    bar: 3,
    what: "the hull icon",
  },
  {
    file: "../../../runlite/pages/components/RunHud.tsx",
    className: "text-amber-400",
    on: "card",
    bar: 3,
    what: "the depth icon",
  },
  {
    file: "../../../runlite/pages/components/RunHud.tsx",
    className: "bg-amber-300",
    on: "card",
    bar: 3,
    what: "the sector pip you are on",
  },
  {
    file: "../../../runlite/pages/components/RunHud.tsx",
    className: "text-yellow-300",
    on: "card",
    bar: 3,
    what: "the salvage icon",
  },
  {
    file: "../../../runlite/pages/components/RunHud.tsx",
    className: "border-amber-400/80",
    on: "band",
    bar: 3,
    what: "the difficulty badge's dashed outline",
  },
  {
    file: "../../../runlite/pages/components/NodeOverlays.tsx",
    className: "text-yellow-300",
    on: "card",
    bar: 3,
    what: "the salvage cache icon",
  },
  {
    file: "../../../runlite/pages/components/NodeOverlays.tsx",
    className: "text-emerald-400",
    on: "card",
    bar: 3,
    what: "the depot icon",
  },
  {
    file: "../../../runlite/pages/components/EncounterOverlay.tsx",
    className: "text-emerald-400",
    on: "card",
    bar: 3,
    what: "the Victory heading",
  },
];

describe("the palette classes the HUD still writes by hand", () => {
  const palette = tailwindPalette();
  const STEPS = [0, 0.25, 0.5, 0.75, 1];

  for (const site of PALETTE_SITES) {
    const source = readFileSync(
      fileURLToPath(new URL(site.file, import.meta.url)),
      "utf8",
    );
    const name = `${site.className} on ${site.file.split("/").pop()}`;

    it(`still colours ${site.what} with ${name}`, () => {
      // A row that stops matching its file is measuring a colour nobody
      // paints, which is worse than not measuring it.
      expect(source).toContain(site.className);
    });

    it(`clears ${site.bar}:1 with ${name}`, () => {
      const shade = /(?:^|:)(?:text|bg|border)-([a-z]+-\d{2,3})/.exec(
        site.className,
      );
      if (!shade) throw new Error(`no palette shade in ${site.className}`);
      const ink = palette[shade[1]];
      if (!ink) throw new Error(`${shade[1]} is not in Tailwind's palette`);
      const alpha = /\/(\d+)$/.exec(site.className);
      const inkAlpha = alpha ? Number(alpha[1]) / 100 : 1;

      let worst = { ratio: Number.POSITIVE_INFINITY, at: "" };
      for (const r of STEPS)
        for (const g of STEPS)
          for (const b of STEPS)
            for (const hue of BASE_HUES)
              for (const sat of BASE_SATS) {
                const surface =
                  site.on === "card"
                    ? over([r, g, b], DARK_CARD.surface(hue, sat), cardAlpha)
                    : over([r, g, b], DARK_BAND.surface(hue, sat), bandAlpha);
                const ratio = contrast(over(surface, ink, inkAlpha), surface);
                if (ratio < worst.ratio)
                  worst = {
                    ratio,
                    at: `rgb(${r} ${g} ${b}) on base ${hue}/${sat}`,
                  };
              }
      expect(worst.ratio, `${site.what} at ${worst.at}`).toBeGreaterThanOrEqual(
        site.bar,
      );
    });
  }
});

/**
 * What makes every measurement above a dark-only one (#1811).
 *
 * The accent inks used to carry a light value beside the dark one. Both maps hold
 * the dark ramp now (#1810), so the light half was a colour nobody could reach,
 * and the next accent would have had to invent one to match its siblings. They
 * are single values again.
 *
 * That is only safe while this chrome stays on those two routes. A HUD card on an
 * ordinary page would paint a near-white teal on white, and nothing else in this
 * file would notice, because the sweeps no longer look at the light ramp. So the
 * list is the check. A new importer either renders inside one of the two roots
 * and gets added here, or the inks need their light values back.
 */
describe("no importer outside the two forced-dark routes", () => {
  const SRC = fileURLToPath(new URL("../../..", import.meta.url));

  /** The two elements `useForcedDark` goes on. */
  const ROOTS = ["conquest/pages/GalaxyPage.tsx", "runlite/pages/RunPage.tsx"];

  /** The rest, each rendered inside one of those two. */
  const INSIDE_A_ROOT = [
    "conquest/pages/components/BattleOverlay.tsx",
    "conquest/pages/components/RunSetup.tsx",
    "runlite/pages/components/EncounterOverlay.tsx",
    "runlite/pages/components/NodeOverlays.tsx",
    "runlite/pages/components/RunHud.tsx",
  ];

  it("is imported only by files on the conquest or warpath map", () => {
    const importers: string[] = [];
    for (const entry of readdirSync(SRC, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      if (entry.name.startsWith("hudChrome.")) continue;
      const full = `${entry.parentPath}/${entry.name}`;
      if (!/from "[^"]*hudChrome"/.test(readFileSync(full, "utf8"))) continue;
      importers.push(full.slice(SRC.length).replace(/^\/+/, ""));
    }
    expect(
      importers.sort(),
      "The HUD accent inks are dark-ramp values with no light half (#1811), so " +
        "this chrome only works inside a useForcedDark subtree. Add the file " +
        "here if it is one, or give the inks their light values back.",
    ).toEqual([...ROOTS, ...INSIDE_A_ROOT].sort());
  });

  it("still forces the dark ramp at both roots", () => {
    // The other five inherit it. This is the pair that turns it on, and losing
    // it is what would make the sweeps above measure the wrong screen.
    for (const rel of ROOTS) {
      expect(readFileSync(`${SRC}/${rel}`, "utf8"), rel).toContain(
        "useForcedDark(",
      );
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
