/**
 * The floor of the card-art resolution chain: a pattern generated from the tool
 * id and the app's theme colour, so a card is never artless while the sources
 * above it (a distribution override, content from the install, a bundled
 * illustration) are missing or still loading.
 *
 * Two properties matter and both are tested:
 *
 * - Deterministic. The same tool id always produces the same composition, so a
 *   card does not shuffle on every render and React can treat the URL as a
 *   stable prop.
 * - Free on first paint. The result is an SVG data URL, so there is no fetch, no
 *   large raster to decode, and nothing to cache.
 *
 * The composition is seeded from the tool id alone, and the theme colour only
 * tints it. Seeding from both looked harmless and was not: any wobble in the
 * probed colour, down to a rounded digit, reshuffled the whole pattern, so the
 * cards visibly rearranged themselves between launches (issue #1047). A theme
 * change should repaint a card, not redraw it, which is also how `bundledArt.ts`
 * already works.
 *
 * The motif is a coil: concentric rings over a tinted field, lit by a couple of
 * soft pools. It borrows the brand's hexagonal-coil logo rather than inventing a
 * new visual language, and it is built from circles and gradients only, so there
 * is no tiling seam to get wrong.
 *
 * The theme colour is baked in rather than referenced. A data URL is its own
 * document, so the `currentColor` trick `src/factions/fallback.ts` uses for
 * inline logos is not available here, and the chain's contract is a URL.
 *
 * Legibility contract: the field agrees with the card it fills. On a dark card
 * it is a dark field lit by low-opacity light marks, and on a light card it is
 * the same composition with every lightness mirrored, so the marks are dark on a
 * pale field. `cardShell.ts` owns the card, and `bundledArt.ts` mirrors by the
 * same rule so a bundled card and a procedural one beside it still match.
 */

import { hashString, mulberry32, pick, type Rng } from "../conquest/rng";
import type { CardScheme } from "./art";

/** Canvas the pattern is authored against. Cards crop it with `object-fit`. */
const WIDTH = 320;
const HEIGHT = 200;

/**
 * Theme colour used when none can be read: picoframe's blue accent. Only reached
 * with no DOM (tests, or any non-browser caller), because in the app the probe in
 * `art.ts` always resolves something.
 */
export const FALLBACK_THEME_COLOR = "hsl(221.2 83.2% 53.3%)";

/** A colour in the HSL space the theme tokens are themselves expressed in. */
export interface Hsl {
  /** Degrees, 0 to 360. */
  h: number;
  /** Percent, 0 to 100. */
  s: number;
  /** Percent, 0 to 100. */
  l: number;
}

/**
 * Below this saturation the theme reads as achromatic: picoframe's default zinc
 * scheme resolves `--primary` to a near-neutral grey. Inventing a hue for it
 * would give every card a colour the app never chose, so a neutral theme gets
 * graphite art instead.
 */
const ACHROMATIC_SATURATION = 8;

/**
 * The lightness a mark takes in `scheme`, given the value it has on a dark card.
 *
 * The light scheme is the dark one mirrored in lightness and in nothing else.
 * Hue and saturation are untouched, so a drawing keeps its theme tint and keeps
 * its internal order (the marks that stood out still stand out) while the field
 * under them flips from near-black to near-white. One composition with two
 * ramps, rather than two sets of art that would drift apart.
 *
 * Exported because `bundledArt.ts` mirrors by the same rule, which is what keeps
 * a bundled card and a procedural card beside it reading as one family in both
 * schemes.
 */
export function schemeLightness(scheme: CardScheme, dark: number): number {
  return scheme === "dark" ? dark : 100 - dark;
}

/** The four field directions. Never flat, so it reads as art not as a panel. */
const DIRECTIONS = [
  ["0", "0", "1", "1"],
  ["1", "0", "0", "1"],
  ["0", "1", "1", "0"],
  ["1", "1", "0", "0"],
] as const;

/**
 * The pattern as raw SVG markup. Exported alongside the data URL so tests can
 * assert on markup rather than on an encoded blob.
 */
export function proceduralCardArtSvg(
  toolId: string,
  themeColor: string,
  scheme: CardScheme,
): string {
  const seed = hashString(toolId);
  const rand = mulberry32(seed);
  const theme = parseColor(themeColor) ?? FALLBACK_HSL;
  /** Lightness on a dark card, mirrored when the card is light. */
  const tone = (dark: number) => schemeLightness(scheme, dark);

  // Ids are namespaced by the seed so two of these can share a document without
  // one card's gradient resolving to another card's. As data URLs they are
  // separate documents anyway, but that is the caller's choice to change.
  const ns = seed.toString(36);

  const neutral = theme.s < ACHROMATIC_SATURATION;
  const sat = neutral ? clamp(theme.s, 0, 6) : clamp(theme.s, 22, 55);
  // Hue jitter keeps the cards a family rather than a rainbow: a tool is
  // recognisable by its own shade while the page still reads as one theme. A
  // neutral theme has no hue worth rotating.
  const hue = (offset: number) => (neutral ? theme.h : theme.h + offset);

  const fieldTop = hsl(hue(jitter(rand, 22)), sat, tone(16 + rand() * 6));
  const fieldFoot = hsl(hue(jitter(rand, 22)), sat * 0.7, tone(8 + rand() * 4));
  const [x1, y1, x2, y2] = pick(rand, DIRECTIONS);

  const glows = [0, 1].map((i) => {
    const cx = round(rand() * WIDTH);
    const cy = round(rand() * HEIGHT);
    const r = round(90 + rand() * 70);
    const colour = hsl(hue(jitter(rand, 26)), Math.min(sat + 12, 70), tone(58));
    return (
      `<radialGradient id="g${ns}${i}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="${colour}" stop-opacity="0.22"/>` +
      `<stop offset="1" stop-color="${colour}" stop-opacity="0"/>` +
      "</radialGradient>"
    );
  });

  // The coil. Its centre sits anywhere on the canvas, so most cards show arcs
  // running off an edge rather than a bullseye parked in the middle.
  const cx = round(20 + rand() * (WIDTH - 40));
  const cy = round(10 + rand() * (HEIGHT - 20));
  const first = 14 + rand() * 14;
  const gap = 16 + rand() * 12;
  const ringCount = 5 + Math.floor(rand() * 4);
  const rings = Array.from(
    { length: ringCount },
    (_, i) => `<circle cx="${cx}" cy="${cy}" r="${round(first + i * gap)}"/>`,
  ).join("");
  const ringColour = hsl(
    hue(jitter(rand, 18)),
    Math.min(sat + 15, 70),
    tone(64),
  );
  const ringWidth = round(1 + rand());

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">` +
    "<defs>" +
    `<linearGradient id="f${ns}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
    `<stop offset="0" stop-color="${fieldTop}"/>` +
    `<stop offset="1" stop-color="${fieldFoot}"/>` +
    "</linearGradient>" +
    glows.join("") +
    "</defs>" +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#f${ns})"/>` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g${ns}0)"/>` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g${ns}1)"/>` +
    `<g fill="none" stroke="${ringColour}" stroke-opacity="0.13" stroke-width="${ringWidth}">` +
    rings +
    "</g>" +
    "</svg>"
  );
}

/**
 * The pattern as a URL a card can use as an image source. Percent-encoded rather
 * than base64: it is shorter, and it keeps the markup readable in devtools.
 */
export function proceduralCardArt(
  toolId: string,
  themeColor: string,
  scheme: CardScheme,
): string {
  const svg = proceduralCardArtSvg(toolId, themeColor, scheme);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A signed offset within `spread` degrees, drawn from the stream. */
function jitter(rand: Rng, spread: number): number {
  return round((rand() * 2 - 1) * spread);
}

/** Two decimal places, so the markup stays short and comparisons stay exact. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** An `hsl()` colour, with every component rounded and wrapped into range. */
function hsl(h: number, s: number, l: number): string {
  // Rounded after the wrap, not before: wrapping a rounded value reintroduces
  // the float noise that makes the markup twice as long as it needs to be.
  const hue = round(((h % 360) + 360) % 360);
  return `hsl(${hue} ${round(clamp(s, 0, 100))}% ${round(clamp(l, 0, 100))}%)`;
}

/**
 * Parse a theme colour to HSL, covering every form it can arrive in: the bare
 * `H S% L%` triple picoframe stores in `--primary`, a wrapped `hsl(...)`, the
 * `rgb(...)` a computed style hands back, and hex. Returns null for anything
 * else so the caller falls back rather than rendering nonsense.
 */
export function parseColor(input: string): Hsl | null {
  const text = input.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    const wide = digits.length === 6;
    const at = (i: number) =>
      Number.parseInt(
        wide ? digits.slice(i * 2, i * 2 + 2) : digits[i].repeat(2),
        16,
      );
    return rgbToHsl(at(0), at(1), at(2));
  }

  const rgb = /^rgba?\(([^)]*)\)$/.exec(text);
  if (rgb) {
    const parts = numbers(rgb[1]);
    return parts.length < 3 ? null : rgbToHsl(parts[0], parts[1], parts[2]);
  }

  const body = /^hsla?\(([^)]*)\)$/.exec(text)?.[1] ?? text;
  const parts = numbers(body);
  return parts.length < 3 ? null : { h: parts[0], s: parts[1], l: parts[2] };
}

/**
 * The numeric components of a colour body, ignoring units, commas and slashes.
 * A body holding anything non-numeric (an unevaluated `calc()`, say) yields an
 * empty list, which the callers above read as a parse failure.
 */
function numbers(body: string): number[] {
  const tokens = body.split(/[\s,/]+/).filter(Boolean);
  const parsed = tokens.map((token) =>
    /^-?[\d.]+(%|deg|turn|rad)?$/.test(token)
      ? Number.parseFloat(token)
      : Number.NaN,
  );
  return parsed.some((n) => !Number.isFinite(n)) ? [] : parsed;
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const span = max - min;
  if (span === 0) return { h: 0, s: 0, l: l * 100 };
  const s = span / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / span) % 6;
  else if (max === gn) h = (bn - rn) / span + 2;
  else h = (rn - gn) / span + 4;
  return { h: (((h * 60) % 360) + 360) % 360, s: s * 100, l: l * 100 };
}

/** The fallback colour pre-parsed, so a parse failure has somewhere to land. */
const FALLBACK_HSL: Hsl = { h: 221.2, s: 83.2, l: 53.3 };
