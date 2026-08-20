import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Why Coilbox has two text tiers and not three (#1034).
 *
 * 31 places used to dim `text-muted-foreground` with an alpha step, `/40` through
 * `/80`, reaching for a tertiary tier below "muted". Every one of them was under
 * WCAG AA. This file is the evidence for the decision that replaced them, which was
 * to delete the tier rather than to name it.
 *
 * The load-bearing claim is that the ramp has no room for a third text tier. #1033
 * put `--muted-foreground` at 41% lightness because that is the *highest* lightness
 * clearing 4.5:1 on every base, surface and accent. A tertiary tier has to be
 * quieter than secondary, and in the light scheme "quieter" means lighter, so any
 * conformant tertiary ink would have to sit at 41% too. There is no gap to put it
 * in. `no room for a third tier` below measures that rather than asserting it, and
 * it re-measures against whatever value `src/index.css` actually ships, so moving
 * the token re-opens the question instead of leaving a stale conclusion here.
 *
 * The dark scheme is not overridden by Coilbox and has a one-percentage-point
 * window, which is the same answer.
 *
 * What this does not cover: text drawn over artwork, where no surface token
 * governs the backdrop and none of these numbers describe it. `GalaxyPage`'s
 * pan/zoom hint was the example, and #1052 settled it by putting a band under the
 * text rather than by choosing an ink: see `MAP_BAND_CLASS` in `hudChrome.tsx`.
 *
 * The colour maths is transcribed from WCAG 2.2, copied rather than imported for
 * the reason `mutedForeground.test.ts` gives.
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

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC = fileURLToPath(new URL("..", import.meta.url));
const CSS = readFileSync(`${HERE}../index.css`, "utf8");

/** The lightness `src/index.css` actually ships for `--muted-foreground`, 0 to 1. */
function shippedLightness(): number {
  const found =
    /:root:not\(\.dark\)\s*\{\s*--muted-foreground:\s*var\(--base-hue\)\s*calc\(var\(--base-sat-text\)\s*\*\s*[0-9.]+%\)\s*([0-9.]+)%;/.exec(
      CSS,
    );
  if (!found)
    throw new Error("no --muted-foreground override in src/index.css");
  return Number(found[1]) / 100;
}

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

/** Light-scheme `--primary` per accent preset, plus the two that cycle their hue. */
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
for (let h = 0; h < 360; h += 5) {
  ACCENTS_LIGHT.push([h, 0.68, 0.48]);
  ACCENTS_LIGHT.push([h, 0.6, 0.78]);
}

/** Light surfaces `text-muted-foreground` sits on, per base. */
function lightSurfaces(hue: number, sat: number): [string, Rgb][] {
  const white = hsl(0, 0, 1);
  const muted = hsl(hue, (sat * 5) / 100, 0.96);
  const tints: [string, Rgb][] = [
    ["tint/none", over(white, hsl(hue, (sat * 6) / 100, 0.16), 0.05)],
    ...ACCENTS_LIGHT.map(
      ([h, s, l], i) =>
        [`tint/${i}`, over(white, hsl(h, s, l), 0.05)] as [string, Rgb],
    ),
  ];
  return [
    ["background", white],
    ["muted", muted],
    ["sidebar", muted],
    ...tints,
  ];
}

/** Dark surfaces, which Coilbox does not override. */
function darkSurfaces(hue: number, sat: number): [string, Rgb][] {
  const card = hsl(hue, (sat * 5) / 100, 0.1);
  return [
    ["background", hsl(hue, (sat * 6) / 100, 0.07)],
    ["card", card],
    ["muted", hsl(hue, (sat * 4) / 100, 0.16)],
    ["sidebar", hsl(hue, (sat * 6) / 100, 0.09)],
    ["tint", over(card, hsl(0, 0, 0.95), 0.05)],
  ];
}

/** Worst contrast of an ink at lightness `l`, over every base and surface. */
function worst(scheme: "light" | "dark", l: number, alpha = 1) {
  let ratio = Number.POSITIVE_INFINITY;
  let where = "";
  for (const [name, hue, sat, satText] of BASES) {
    const st = satText ?? sat;
    // The light ramp is Coilbox's override, coefficient 4. The dark ramp is
    // picoframe's own, coefficient 5.
    const ink = hsl(hue, (st * (scheme === "light" ? 4 : 5)) / 100, l);
    const surfaces =
      scheme === "light" ? lightSurfaces(hue, sat) : darkSurfaces(hue, sat);
    for (const [sn, surface] of surfaces) {
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

/** Text under 18.66px, which every one of these sites is. */
const AA_SMALL = 4.5;
/** WCAG 1.4.11, for icons and controls. */
const AA_NON_TEXT = 3;
/** picoframe's dark `--muted-foreground` lightness. Coilbox leaves it alone. */
const DARK_MUTED_L = 0.6;

describe("no room for a third text tier", () => {
  // This is the whole argument for deleting the tier rather than naming it.
  it("light: nothing lighter than the shipped muted ink clears AA", () => {
    const shipped = shippedLightness();
    expect(worst("light", shipped).ratio).toBeGreaterThanOrEqual(AA_SMALL);
    // A tertiary tier must be lighter to read as quieter. Every lighter value
    // fails, so there is nowhere to put one.
    for (let l = shipped + 0.01; l <= 0.6; l += 0.01) {
      const { ratio, where } = worst("light", Number(l.toFixed(4)));
      expect(ratio, `L=${(l * 100).toFixed(0)}% ${where}`).toBeLessThan(
        AA_SMALL,
      );
    }
  });

  it("dark: the window below the muted ink is one percentage point wide", () => {
    // Quieter on a dark backdrop means darker. 59% is the last passing value
    // under picoframe's 60%, so a conformant tertiary would sit one point away
    // from secondary, which is not a tier anyone could see.
    expect(worst("dark", DARK_MUTED_L).ratio).toBeGreaterThanOrEqual(AA_SMALL);
    expect(worst("dark", 0.59).ratio).toBeGreaterThanOrEqual(AA_SMALL);
    expect(worst("dark", 0.58).ratio).toBeLessThan(AA_SMALL);
  });
});

describe("the alpha steps that were removed", () => {
  // Every step the 31 sites used, measured on the surfaces they sat on. The point
  // is that no step was salvageable, in either scheme.
  for (const alpha of [0.4, 0.5, 0.6, 0.7, 0.8]) {
    it(`/${alpha * 100} failed AA for text in both schemes`, () => {
      const light = worst("light", shippedLightness(), alpha);
      const dark = worst("dark", DARK_MUTED_L, alpha);
      expect(light.ratio, `light ${light.where}`).toBeLessThan(AA_SMALL);
      expect(dark.ratio, `dark ${dark.where}`).toBeLessThan(AA_SMALL);
    });
  }

  for (const alpha of [0.4, 0.5, 0.6]) {
    it(`/${alpha * 100} also failed the 3:1 bar for icons and controls`, () => {
      // The four icon sites that carry meaning sat at /40, /50 and /60, so the
      // non-text threshold did not rescue them either.
      const light = worst("light", shippedLightness(), alpha);
      const dark = worst("dark", DARK_MUTED_L, alpha);
      expect(light.ratio, `light ${light.where}`).toBeLessThan(AA_NON_TEXT);
      expect(dark.ratio, `dark ${dark.where}`).toBeLessThan(AA_NON_TEXT);
    });
  }
});

describe("what the sites use now", () => {
  it("full-strength muted clears AA for text in both schemes", () => {
    expect(worst("light", shippedLightness()).ratio).toBeGreaterThanOrEqual(
      AA_SMALL,
    );
    expect(worst("dark", DARK_MUTED_L).ratio).toBeGreaterThanOrEqual(AA_SMALL);
  });

  it("and clears the 3:1 bar for the icons, with room to spare", () => {
    expect(worst("light", shippedLightness()).ratio).toBeGreaterThan(
      AA_NON_TEXT,
    );
    expect(worst("dark", DARK_MUTED_L).ratio).toBeGreaterThan(AA_NON_TEXT);
  });
});

/**
 * The only `text-muted-foreground/<alpha>` uses left in the app.
 *
 * Each is a placeholder glyph standing in for an image that is not there, or a
 * spinner next to text that says the same thing. WCAG 1.4.11 exempts pure
 * decoration and anything redundant with adjacent text, so the 3:1 bar does not
 * reach them, and dimming them is the point: a full-strength glyph in an empty
 * thumbnail would pull the eye to the one card with no artwork.
 */
const DECORATIVE_EXEMPTIONS: Record<string, string> = {
  "mapconv/pages/components/AssetPreview.tsx":
    "spinner beside a full-strength 'generating preview' label",
  "content/pages/components/MapThumb.tsx":
    "placeholder glyph for a map with no minimap",
  "campaign/pages/components/CampaignImage.tsx":
    "placeholder glyph for a campaign with no icon",
  "downloads/pages/MapsPage.tsx": "placeholder glyph for a map with no minimap",
};

describe("the tier stays deleted", () => {
  // A named token would have been the alternative outcome. There is no third tier
  // to reach for, so the guard is that nobody re-invents one with an alpha step.
  it("no file dims text-muted-foreground outside the decorative exemptions", () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(SRC, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const full = `${entry.parentPath}/${entry.name}`;
      const rel = full.slice(SRC.length).replace(/^\/+/, "");
      if (rel in DECORATIVE_EXEMPTIONS) continue;
      if (/text-muted-foreground\/\d/.test(readFileSync(full, "utf8")))
        offenders.push(rel);
    }
    expect(
      offenders,
      "Coilbox has two text tiers, not three: --muted-foreground is already the " +
        "lightest ink that clears AA, so dimming it cannot be made conformant " +
        "(#1034). Use text-muted-foreground, or carry the hierarchy with size, " +
        "weight or position instead.",
    ).toEqual([]);
  });

  it("every exemption still exists and is still dimmed", () => {
    // A stale allowlist would silently stop guarding the file it names.
    for (const rel of Object.keys(DECORATIVE_EXEMPTIONS)) {
      const body = readFileSync(`${SRC}/${rel}`, "utf8");
      expect(/text-muted-foreground\/\d/.test(body), rel).toBe(true);
    }
  });
});
