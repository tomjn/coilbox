import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARD_FOCUS_CLASS } from "./cardShell";

/**
 * Why the welcome cards' focus ring is drawn in `--foreground` and not `--ring`.
 *
 * WCAG 1.4.11 asks a focus indicator for 3:1 against the colour beside it.
 * {@link CARD_FOCUS_CLASS} offsets the ring outward, so the colour beside it is
 * the page's own surface and never the card's artwork, and the question is one
 * these numbers can answer: how far the ink sits from `--background` and `--card`.
 *
 * `--ring` is not obliged to sit anywhere. picoframe hands it to the accent, which
 * is a hue chosen to look like the product rather than to contrast with the page,
 * and on the accent every install starts with it is a mid-grey. `--foreground` has
 * no such freedom: it is the ink body text is set in, so the ramp has to keep it
 * far from the surface or nothing on the page is readable.
 *
 * That is the whole argument, and the sweep below is what makes it a measurement.
 * Accents are read out of `@picoframe/frame/src/theme.css` rather than transcribed,
 * so an accent added upstream joins the sweep on the next `bun install` instead of
 * quietly sitting outside it.
 *
 * What this does not cover: the buttons on the same page. picoframe's own button
 * variant draws `ring-ring` and inherits the failure, as do the five older Coilbox
 * cards that copied `outline-ring`. That is one defect in one token reaching the
 * whole app, and it is filed (#1089) rather than worked around card by card.
 *
 * The colour maths is transcribed from WCAG 2.2, copied rather than imported for
 * the reason `theme/mutedForeground.test.ts` gives.
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
const THEME = readFileSync(
  fileURLToPath(
    new URL(
      "../../node_modules/@picoframe/frame/src/theme.css",
      import.meta.url,
    ),
  ),
  "utf8",
);

/** Every base preset, as `[name, --base-hue, --base-sat, --base-sat-text]`. */
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

/** One accent's `--ring`, named, or `null` for the base-derived neutral. */
type Accent = [string, Rgb | null];

/**
 * The `--ring` every accent preset sets, per scheme, read out of theme.css.
 *
 * The two animated accents write their hue as `var(--pf-accent-hue)` and sweep it
 * through the wheel, so each is sampled every five degrees rather than counted
 * once. A `.dark[data-accent]` block only restates the tokens it changes, so an
 * accent with no dark `--ring` of its own keeps the light one.
 */
function accents(): { light: Accent[]; dark: Accent[] } {
  const light: Accent[] = [["neutral", null]];
  const dark: Accent[] = [["neutral", null]];
  const block =
    /(\.dark)?\[data-accent="([a-z]+)"\](:not\(\.dark\))?\s*\{([^}]*)\}/g;
  let found = block.exec(THEME);
  while (found) {
    const [, isDark, name, , body] = found;
    const fixed = /--ring:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(body);
    const cycling =
      /--ring:\s*var\(--pf-accent-hue\)\s+([\d.]+)%\s+([\d.]+)%/.exec(body);
    // A cycling accent declared without `.dark` applies in both schemes.
    const targets = isDark ? [dark] : cycling ? [light, dark] : [light];
    if (fixed)
      for (const t of targets)
        t.push([name, hsl(+fixed[1], +fixed[2] / 100, +fixed[3] / 100)]);
    if (cycling)
      for (const t of targets)
        for (let hue = 0; hue < 360; hue += 5)
          t.push([
            `${name}@${hue}`,
            hsl(hue, +cycling[1] / 100, +cycling[2] / 100),
          ]);
    found = block.exec(THEME);
  }
  for (const [name, ring] of light)
    if (!dark.some(([n]) => n === name)) dark.push([name, ring]);
  return { light, dark };
}

const ACCENTS = accents();

/** The surfaces an offset focus ring can land beside, per base and scheme. */
function surfaces(scheme: "light" | "dark", hue: number, sat: number): Rgb[] {
  return scheme === "light"
    ? [hsl(0, 0, 1)]
    : [hsl(hue, (sat * 6) / 100, 0.07), hsl(hue, (sat * 5) / 100, 0.1)];
}

/** One base's knobs and the accent's ring, as an ink function sees them. */
type Ink = (
  scheme: "light" | "dark",
  base: { hue: number; sat: number; satText: number },
  ring: Rgb | null,
) => Rgb;

/** The worst contrast an ink reaches over every base, accent and surface. */
function worst(scheme: "light" | "dark", ink: Ink) {
  let out = { ratio: Number.POSITIVE_INFINITY, where: "" };
  for (const [base, hue, sat, satText] of BASES)
    for (const [accent, ring] of ACCENTS[scheme])
      for (const surface of surfaces(scheme, hue, sat)) {
        const ratio = contrast(
          ink(scheme, { hue, sat, satText }, ring),
          surface,
        );
        if (ratio < out.ratio)
          out = { ratio, where: `${base} base, ${accent} accent` };
      }
  return out;
}

/** WCAG 1.4.11, the bar a focus indicator has to clear. */
const AA_NON_TEXT = 3;

/** `--ring`, falling back to the base-derived value where no accent sets one. */
const ringInk: Ink = (scheme, { hue, sat }, ring) =>
  ring ?? hsl(hue, (sat * 5) / 100, scheme === "light" ? 0.65 : 0.4);

/** `--foreground`: near-black tinted by the text knob in light, near-white in dark. */
const foregroundInk: Ink = (scheme, { hue, satText }) =>
  scheme === "light" ? hsl(hue, (satText * 10) / 100, 0.12) : hsl(0, 0, 0.95);

describe("the focus ring's colour", () => {
  for (const scheme of ["light", "dark"] as const) {
    it(`--ring cannot carry a conformant indicator in the ${scheme} scheme`, () => {
      // Not a wish for it to fail: this is the reason the cards do not use it,
      // and if picoframe ever calibrates the token this test says so by failing.
      const measured = worst(scheme, ringInk);
      expect(measured.ratio, measured.where).toBeLessThan(AA_NON_TEXT);
    });

    it(`--foreground clears 1.4.11 everywhere in the ${scheme} scheme`, () => {
      const measured = worst(scheme, foregroundInk);
      expect(measured.ratio, measured.where).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
    });
  }

  it("is the ink the shipped class actually names", () => {
    // The numbers above describe `--foreground`. A class that named something
    // else would leave them measuring a colour the page does not draw.
    expect(CARD_FOCUS_CLASS).toContain("outline-foreground");
    // Outward, so the ring sits on the page's surface and never on card art,
    // which is what lets the sweep above ignore artwork entirely.
    expect(CARD_FOCUS_CLASS).toContain("focus-visible:outline-offset-2");
    expect(CARD_FOCUS_CLASS).not.toContain("-outline-offset");
  });
});

describe("every welcome card wears it", () => {
  // The cards took the engine's own ring before this, which is a different ring
  // on macOS and on Windows and is not the one the rest of the page draws. A card
  // added later that forgets the class would go back to that silently.
  const CARD_FILES = [
    "home/zones/ToolCards.tsx",
    "home/zones/ResumeRail.tsx",
    "home/zones/SuggestedMap.tsx",
  ];

  for (const rel of CARD_FILES)
    it(`${rel} applies the shared focus class`, () => {
      expect(readFileSync(`${SRC}/${rel}`, "utf8")).toContain(
        "CARD_FOCUS_CLASS",
      );
    });

  it("names every zone file that draws a focusable card", () => {
    // A new zone with a card in it should join the list above rather than be
    // missed by it, so the list is checked against what is on disk.
    const drawn = readdirSync(`${SRC}/home/zones`)
      .filter((name) => name.endsWith(".tsx"))
      .filter((name) => {
        const body = readFileSync(`${SRC}/home/zones/${name}`, "utf8");
        return /CARD_SHELL_CLASS|RAIL_CARD_CLASS/.test(body);
      })
      .map((name) => `home/zones/${name}`);
    // LinkCard draws chips inside a card that is never focused itself, so it
    // carries the shell without needing the ring.
    expect(drawn.filter((f) => !f.endsWith("LinkCard.tsx")).sort()).toEqual(
      [...CARD_FILES].sort(),
    );
  });
});
