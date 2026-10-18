import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASES, contrast, hsl, type Rgb } from "../lib/contrast.testhelper";
import { CARD_FOCUS_CLASS } from "./cardShell";

/**
 * Whether `--ring` clears 3:1, and why the welcome cards still draw theirs in
 * `--foreground`.
 *
 * WCAG 1.4.11 asks a focus indicator for 3:1 against the colour beside it.
 * {@link CARD_FOCUS_CLASS} offsets the ring outward, so the colour beside it is
 * the page's own surface and never the card's artwork, and the question is one
 * these numbers can answer: how far the ink sits from `--background` and `--card`.
 *
 * `--ring` used to sit nowhere in particular: picoframe handed it to the accent, a
 * hue chosen to look like the product, and the default was a mid-grey (#1089).
 * From @picoframe/frame 0.10.0 every base and accent keeps `--ring` at 3:1 or
 * better against the page, and the sweep below asserts it from the shipped
 * theme.css, so a later release that regresses it fails here. `--foreground` is
 * measured beside it because the welcome cards were built on it while `--ring`
 * could not carry the indicator.
 *
 * The sweep below is what makes it a measurement.
 * Accents are read out of `@picoframe/frame/src/theme.css` rather than transcribed,
 * so an accent added upstream joins the sweep on the next `bun install` instead of
 * quietly sitting outside it.
 *
 * The buttons on the same page draw `ring-ring`, as do the five older Coilbox
 * cards that copied `outline-ring`, so the token fix reaches them without a
 * change in this repo.
 *
 * The colour maths is transcribed from WCAG 2.2, copied rather than imported for
 * the reason `theme/mutedForeground.test.ts` gives.
 */

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
  // An accent whose `.dark` block sets its own `--ring` overrides the light one.
  const darkOwn = new Set<string>();
  for (const m of THEME.matchAll(
    /\.dark\[data-accent="([a-z]+)"\]\s*\{([^}]*)\}/g,
  ))
    if (/--ring:/.test(m[2])) darkOwn.add(m[1]);
  let found = block.exec(THEME);
  while (found) {
    const [, isDark, name, , body] = found;
    const fixed = /--ring:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(body);
    const cycling =
      /--ring:\s*var\(--pf-accent-hue\)\s+([\d.]+)%\s+([\d.]+)%/.exec(body);
    // A cycling accent declared without `.dark` applies in both schemes.
    const targets = isDark
      ? [dark]
      : cycling && !darkOwn.has(name)
        ? [light, dark]
        : [light];
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

/**
 * The lightness of the base-derived `--ring` in `:root` and `.dark`, read out of
 * theme.css. Hue and saturation come from the base, so only the lightness is a
 * fixed number there.
 */
function baseRingLightness(selector: string): number {
  const block = new RegExp(`^${selector}\\s*\\{([^}]*)\\}`, "m").exec(THEME);
  const found =
    /--ring:\s*var\(--base-hue\)\s+calc\(var\(--base-sat\)\s*\*\s*5%\)\s+([\d.]+)%/.exec(
      block?.[1] ?? "",
    );
  if (!found) throw new Error(`theme.css has no base --ring in ${selector}`);
  return +found[1] / 100;
}

const BASE_RING_L = {
  light: baseRingLightness(":root"),
  dark: baseRingLightness("\\.dark"),
};

/** `--ring`, falling back to the base-derived value where no accent sets one. */
const ringInk: Ink = (scheme, { hue, sat }, ring) =>
  ring ?? hsl(hue, (sat * 5) / 100, BASE_RING_L[scheme]);

/** `--foreground`: near-black tinted by the text knob in light, near-white in dark. */
const foregroundInk: Ink = (scheme, { hue, satText }) =>
  scheme === "light" ? hsl(hue, (satText * 10) / 100, 0.12) : hsl(0, 0, 0.95);

describe("the focus ring's colour", () => {
  for (const scheme of ["light", "dark"] as const) {
    it(`--ring clears 1.4.11 everywhere in the ${scheme} scheme`, () => {
      const measured = worst(scheme, ringInk);
      expect(measured.ratio, measured.where).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
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
