/**
 * Step 3 of the card-art chain: illustrations Coilbox ships for a handful of
 * tools, drawn in code as SVG.
 *
 * These are the cold-start pictures. A fresh install has no maps, no replays and
 * no campaign progress, so step 2 has nothing to derive art from, and a fresh
 * install is exactly what the readme, the site and any first-run video show. For
 * the tools below a fixed drawing says what the tool is, where a seeded pattern
 * only says which tool it is.
 *
 * Coverage is deliberately partial. Anything not in {@link DRAWINGS} falls
 * through to the procedural floor, which always answers, so adding or dropping a
 * tool here is a local change with no chain consequences.
 *
 * ## The dark contract
 *
 * The procedural field is always dark so card text can be light in both colour
 * schemes. These sit in the same slot under the same text, so they hold the same
 * contract: a dark field, marks drawn as light strokes and small bright shapes,
 * and nothing that paints a pale area big enough to sit under a word.
 * `bundledArt.test.ts` measures that rather than trusting it, and measures the
 * procedural art with the same yardstick so the threshold is not tuned to this
 * file.
 *
 * The checker can only measure geometry it can compute, so filled art is drawn
 * with rects, circles, ellipses and polygons. A filled `<path>` is unmeasurable
 * and the checker assumes the worst of it, so paths here are stroked.
 *
 * ## Why they take the theme colour
 *
 * A distribution can repaint the app, and a fixed palette would leave these
 * cards as the one thing on the page that ignored it. Each drawing is a fixed
 * composition tinted from the current theme, so a bundled card and a procedural
 * card beside it read as the same family.
 */

import { mulberry32 } from "../conquest/rng";
import type { CardArtSource } from "./art";
import { FALLBACK_THEME_COLOR, parseColor } from "./proceduralArt";

/** Canvas the drawings are authored against, matching the procedural floor. */
const WIDTH = 320;
const HEIGHT = 200;

/** Tints derived from the theme colour, shared by every drawing. */
interface Palette {
  /** Top of the field gradient. */
  fieldTop: string;
  /** Foot of the field gradient. */
  fieldFoot: string;
  /** The soft light pools laid over the field. */
  glow: string;
  /** Background structure: terrain, grids, anything the eye should skim. */
  faint: string;
  /** The subject's own line weight. */
  line: string;
  /** The one or two marks the eye should land on. */
  spark: string;
}

/** A soft radial pool over the field: centre x, centre y, radius, peak opacity. */
type Pool = readonly [number, number, number, number];

/** One tool's illustration. */
interface Drawing {
  /**
   * Light pools, painted between the field and the subject. Declared rather than
   * drawn so a drawing never has to emit its own `<defs>`, and so the lighting
   * of a card can be read at a glance next to its subject.
   */
  pools: readonly Pool[];
  /** The subject, as markup painted over the field and pools. */
  paint(p: Palette): string;
}

/**
 * Below this saturation the theme reads as achromatic and gets graphite art
 * rather than an invented hue. Same rule, and same number, as the procedural
 * floor uses.
 */
const ACHROMATIC_SATURATION = 8;

/** The fallback theme pre-parsed, for a colour that will not parse. */
const FALLBACK_HSL = { h: 221.2, s: 83.2, l: 53.3 };

function paletteFor(themeColor: string): Palette {
  const theme = parseColor(themeColor) ?? FALLBACK_HSL;
  const neutral = theme.s < ACHROMATIC_SATURATION;
  const sat = neutral ? clamp(theme.s, 0, 6) : clamp(theme.s, 24, 58);
  // A neutral theme has no hue worth rotating, so every offset collapses to 0.
  const hue = (offset: number) => (neutral ? theme.h : theme.h + offset);
  return {
    fieldTop: hsl(hue(14), sat, 17),
    fieldFoot: hsl(hue(-10), sat * 0.65, 8),
    glow: hsl(hue(22), Math.min(sat + 14, 70), 58),
    faint: hsl(hue(0), Math.min(sat + 6, 62), 54),
    line: hsl(hue(6), Math.min(sat + 18, 72), 70),
    spark: hsl(hue(-16), neutral ? sat : Math.min(sat + 30, 82), 80),
  };
}

/**
 * Two opposing forces across contoured ground, meeting at a front line.
 *
 * Singleplayer is the one screen where you place two sides on a map and press
 * start, and the chevron blocks facing each other say that faster than a unit
 * count or a map thumbnail would.
 */
const skirmish: Drawing = {
  pools: [
    [72, 108, 130, 0.16],
    [252, 92, 120, 0.14],
  ],
  paint: (p) => {
    const ridge = (d: string, o: number) =>
      `<path d="${d}" stroke-opacity="${o}"/>`;
    // An arrowhead wedge, one chevron at the tip and the ranks widening behind
    // it. A rectangular block of chevrons reads as ">>>" at card size, where a
    // wedge reads as a formation.
    const wedge = (tip: number, dir: 1 | -1) =>
      [[0], [-16, 16], [-32, 0, 32]]
        .flatMap((rank, col) =>
          rank.map((dy) => chevron(tip - dir * col * 18, 100 + dy, dir)),
        )
        .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1.5">` +
      ridge("M-10 58 Q 74 40 146 54 T 330 44", 0.24) +
      ridge("M-10 148 Q 66 130 128 146 T 250 138 T 330 150", 0.3) +
      ridge("M-10 178 Q 88 162 168 174 T 330 166", 0.2) +
      "</g>" +
      `<g fill="none" stroke="${p.line}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.42">` +
      wedge(118, 1) +
      wedge(202, -1) +
      "</g>" +
      `<g fill="none" stroke="${p.spark}" stroke-width="1.5" stroke-opacity="0.32" stroke-dasharray="7 9">` +
      '<path d="M160 40 L160 164"/>' +
      "</g>" +
      `<circle cx="160" cy="100" r="4" fill="${p.spark}" fill-opacity="0.7"/>`
    );
  },
};

/**
 * A match on a timeline: intensity over time, a scrub bar, a playhead.
 *
 * Step 2 will put the last replay's own map under this card, so what this needs
 * to say is "recorded match", not "some map". A timeline says it without
 * pretending to be a specific game.
 */
const replays: Drawing = {
  pools: [
    [196, 84, 128, 0.18],
    [42, 168, 96, 0.1],
  ],
  paint: (p) => {
    // A fixed intensity profile: a slow open, two skirmishes, a long fight.
    const heights = [
      8, 12, 10, 16, 14, 22, 19, 27, 24, 38, 31, 44, 36, 30, 26, 34, 41, 55, 48,
      62, 57, 70, 64, 52, 44, 33, 25, 18, 13, 9,
    ];
    // The scrub bar sits near the middle of the canvas rather than the foot: a
    // card crops to a band across the centre, and a timeline cropped off the
    // bottom is just a bar chart.
    const bars = heights
      .map((h, i) => {
        const x = 30 + i * 8.6;
        const past = x < 196;
        return `<rect x="${round(x)}" y="${round(116 - h)}" width="5" height="${h}" rx="1.5" fill="${past ? p.line : p.faint}" fill-opacity="${past ? 0.3 : 0.18}"/>`;
      })
      .join("");
    const ticks = [0, 1, 2, 3, 4, 5, 6]
      .map((i) => `<path d="M${30 + i * 43} 128 L${30 + i * 43} 136"/>`)
      .join("");
    return (
      bars +
      `<rect x="30" y="122" width="260" height="3" rx="1.5" fill="${p.faint}" fill-opacity="0.28"/>` +
      `<rect x="30" y="122" width="166" height="3" rx="1.5" fill="${p.line}" fill-opacity="0.45"/>` +
      `<g fill="none" stroke="${p.faint}" stroke-width="1" stroke-opacity="0.24">${ticks}</g>` +
      `<g fill="none" stroke="${p.spark}" stroke-width="1.5" stroke-opacity="0.42">` +
      '<path d="M196 30 L196 152"/>' +
      "</g>" +
      `<circle cx="196" cy="123.5" r="5" fill="${p.spark}" fill-opacity="0.8"/>`
    );
  },
};

/**
 * A route across terrain with mission markers, the early ones taken.
 *
 * A campaign is an ordered journey, so the drawing is a road rather than a
 * graph. The filled markers behind the current one are what tells you this is
 * progress and not a menu.
 */
const campaigns: Drawing = {
  pools: [
    [230, 62, 120, 0.17],
    [56, 156, 110, 0.11],
  ],
  paint: (p) => {
    // The route is kept inside a band across the middle of the canvas, because
    // that is the slice of the picture a card crops to.
    const route =
      "M 14 158 C 62 152 66 114 112 106 S 172 128 206 100 S 254 62 312 58";
    // Marker centres sampled off the route above, in play order.
    const stops: readonly (readonly [number, number])[] = [
      [14, 158],
      [80, 132],
      [136, 110],
      [206, 100],
      [268, 72],
      [312, 58],
    ];
    const taken = stops
      .slice(0, 3)
      .map(
        ([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="5.5" fill="${p.line}" fill-opacity="0.62"/>`,
      )
      .join("");
    const ahead = stops
      .slice(4)
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.5"/>`)
      .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.26">` +
      '<path d="M-10 186 Q 70 172 150 182 T 330 174"/>' +
      '<path d="M-10 42 Q 86 26 160 40 T 330 30"/>' +
      "</g>" +
      `<path d="${route}" fill="none" stroke="${p.faint}" stroke-width="2" stroke-opacity="0.28" stroke-dasharray="6 8"/>` +
      `<path d="M 14 158 C 62 152 66 114 112 106 S 172 128 206 100" fill="none" stroke="${p.line}" stroke-width="2.5" stroke-opacity="0.45" stroke-linecap="round"/>` +
      taken +
      `<g fill="none" stroke="${p.faint}" stroke-width="2" stroke-opacity="0.45">${ahead}</g>` +
      `<circle cx="206" cy="100" r="10" fill="none" stroke="${p.spark}" stroke-width="2" stroke-opacity="0.55"/>` +
      `<circle cx="206" cy="100" r="4.5" fill="${p.spark}" fill-opacity="0.85"/>`
    );
  },
};

/**
 * A reticle over receding ground.
 *
 * A scenario is one objective on one piece of ground, so the drawing is an aimed
 * shot rather than a list. The perspective grid keeps it a place and not an
 * abstract target.
 */
const scenarios: Drawing = {
  pools: [
    [198, 92, 118, 0.19],
    [30, 190, 130, 0.08],
  ],
  paint: (p) => {
    const horizon = 66;
    const lanes = [-70, 0, 70, 140, 210, 280, 350, 420]
      .map((x) => `<path d="M160 ${horizon} L${x} 210"/>`)
      .join("");
    const bands = [96, 118, 146, 182]
      .map((y) => `<path d="M-10 ${y} L330 ${y}"/>`)
      .join("");
    const ticks = [
      "M198 30 L198 48",
      "M198 136 L198 154",
      "M136 92 L154 92",
      "M242 92 L260 92",
    ]
      .map((d) => `<path d="${d}"/>`)
      .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1" stroke-opacity="0.22">` +
      lanes +
      bands +
      "</g>" +
      `<g fill="none" stroke="${p.line}" stroke-width="1.5" stroke-opacity="0.45">` +
      '<circle cx="198" cy="92" r="54"/>' +
      '<circle cx="198" cy="92" r="34"/>' +
      "</g>" +
      `<g fill="none" stroke="${p.spark}" stroke-width="2" stroke-opacity="0.6" stroke-linecap="round">` +
      ticks +
      "</g>" +
      `<circle cx="198" cy="92" r="5" fill="${p.spark}" fill-opacity="0.85"/>`
    );
  },
};

/**
 * A galaxy: a lit core, orbital sweeps, a starfield.
 *
 * Conquest is the one tool whose whole subject is a picture of a galaxy, so a
 * pattern here is a missed opportunity. The star positions come from a fixed
 * seed, which keeps the source short while the drawing stays one fixed picture
 * rather than a per-tool pattern.
 */
const conquest: Drawing = {
  pools: [
    [206, 88, 62, 0.3],
    [206, 88, 150, 0.12],
  ],
  paint: (p) => {
    const rand = mulberry32(0x5ca1ab1e);
    const stars = Array.from({ length: 46 }, () => {
      const x = round(rand() * WIDTH);
      const y = round(rand() * HEIGHT);
      const r = round(0.6 + rand() * 1.3);
      const o = round(0.2 + rand() * 0.45);
      return `<circle cx="${x}" cy="${y}" r="${r}" fill-opacity="${o}"/>`;
    }).join("");
    const arms = [
      [128, 46],
      [96, 34],
      [62, 22],
    ]
      .map(
        ([rx, ry], i) =>
          `<ellipse cx="206" cy="88" rx="${rx}" ry="${ry}" transform="rotate(-19 206 88)" stroke-opacity="${0.16 + i * 0.09}"/>`,
      )
      .join("");
    const flare = [
      "M206 66 L206 110",
      "M184 88 L228 88",
      "M190 72 L222 104",
      "M222 72 L190 104",
    ]
      .map((d) => `<path d="${d}"/>`)
      .join("");
    return (
      `<g fill="${p.line}">${stars}</g>` +
      `<g fill="none" stroke="${p.line}" stroke-width="1.5">${arms}</g>` +
      `<g fill="none" stroke="${p.spark}" stroke-width="1" stroke-opacity="0.3">${flare}</g>` +
      `<circle cx="206" cy="88" r="7" fill="${p.spark}" fill-opacity="0.9"/>` +
      `<circle cx="86" cy="150" r="3.5" fill="${p.spark}" fill-opacity="0.55"/>` +
      `<circle cx="46" cy="62" r="2.5" fill="${p.spark}" fill-opacity="0.45"/>`
    );
  },
};

/**
 * A run laid out as tiers of nodes with branching routes, climbing to one lit
 * node at the top.
 *
 * Warpath is a roguelite: you pick a route up through encounters and the shape
 * of the choice is the mode. Drawn as a graph so it cannot be mistaken for the
 * campaign card's single road.
 */
const warpath: Drawing = {
  pools: [
    [160, 74, 96, 0.22],
    [160, 200, 150, 0.1],
  ],
  paint: (p) => {
    const tiers: readonly (readonly number[])[] = [
      [160],
      [92, 160, 228],
      [66, 124, 196, 254],
      [160],
    ];
    // Four ranks rather than five, and the lit node lands at y 74 rather than
    // near the top edge, so the payoff survives the crop a card applies.
    const y = (t: number) => 170 - t * 32;
    const edges = tiers
      .slice(0, -1)
      .flatMap((row, t) =>
        row.flatMap((x) =>
          tiers[t + 1]
            .filter((nx) => Math.abs(nx - x) < 78)
            .map(
              (nx) => `<path d="M${x} ${y(t) - 7} L${nx} ${y(t + 1) + 7}"/>`,
            ),
        ),
      )
      .join("");
    const nodes = tiers
      .slice(0, -1)
      .flatMap((row, t) => row.map((x) => diamond(x, y(t), 6)))
      .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.3">` +
      edges +
      "</g>" +
      `<g fill="${p.line}" fill-opacity="0.42">${nodes}</g>` +
      `<g fill="none" stroke="${p.spark}" stroke-width="1.5" stroke-opacity="0.4">` +
      `${diamond(160, 74, 17)}` +
      "</g>" +
      `<g fill="${p.spark}" fill-opacity="0.85">${diamond(160, 74, 9)}</g>`
    );
  },
};

/**
 * Contour lines around a landmass, with a grid and a scale mark.
 *
 * Maps is the clearest cold-start case in the milestone: step 2 puts a real
 * minimap here the moment the install has one, so this is the picture of a map
 * you have not downloaded yet. Contours rather than a filled shape, so it reads
 * as a survey and not as a claim about a specific map.
 */
const maps: Drawing = {
  pools: [
    [176, 96, 132, 0.16],
    [286, 178, 90, 0.09],
  ],
  paint: (p) => {
    const blob =
      "M170 40 C205 40 232 56 240 80 C250 110 236 140 208 152 C180 164 142 160 122 140 C100 118 100 82 120 62 C134 48 152 40 170 40 Z";
    const grid =
      [40, 80, 120, 160, 200, 240, 280]
        .map((x) => `<path d="M${x} 0 L${x} ${HEIGHT}"/>`)
        .join("") +
      [40, 80, 120, 160]
        .map((y) => `<path d="M0 ${y} L${WIDTH} ${y}"/>`)
        .join("");
    const contours = [1.06, 0.86, 0.66, 0.46, 0.27]
      .map(
        (s, i) =>
          `<path d="${blob}" transform="translate(${round(170 - 170 * s)} ${round(100 - 100 * s)}) scale(${s})" stroke-opacity="${round(0.2 + i * 0.09)}"/>`,
      )
      .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1" stroke-opacity="0.14">` +
      grid +
      "</g>" +
      `<g fill="none" stroke="${p.line}" stroke-width="1.5">${contours}</g>` +
      `<g fill="none" stroke="${p.spark}" stroke-width="1.5" stroke-opacity="0.5" stroke-linecap="round">` +
      '<path d="M22 178 L74 178"/>' +
      '<path d="M22 173 L22 183"/>' +
      '<path d="M48 175 L48 181"/>' +
      '<path d="M74 173 L74 183"/>' +
      "</g>" +
      `<circle cx="170" cy="100" r="3.5" fill="${p.spark}" fill-opacity="0.8"/>`
    );
  },
};

/**
 * A package falling through a stack of chevrons into a tray that already holds
 * two.
 *
 * The download screens are the first thing a fresh install has to use, and the
 * one place where a card can honestly show what the tool does while the install
 * is still empty. The first draft was a list of progress bars, which at card
 * size read as an interface rather than a picture and fought the label sitting
 * over it. This is one object doing one thing.
 */
const downloads: Drawing = {
  pools: [
    [160, 44, 118, 0.18],
    [160, 168, 104, 0.11],
  ],
  paint: (p) => {
    const arrows = [40, 62, 84]
      .map(
        (y, i) =>
          `<path d="M124 ${y} L160 ${y + 22} L196 ${y}" stroke-opacity="${round(0.1 + i * 0.07)}"/>`,
      )
      .join("");
    const landed = [
      [126, 148],
      [154, 148],
    ]
      .map(
        ([x, y]) =>
          `<rect x="${x}" y="${y}" width="22" height="18" rx="3" fill="${p.line}" fill-opacity="0.2"/>`,
      )
      .join("");
    return (
      `<g fill="none" stroke="${p.line}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">` +
      arrows +
      "</g>" +
      `<rect x="146" y="98" width="28" height="24" rx="4" fill="${p.line}" fill-opacity="0.26"/>` +
      `<rect x="146" y="98" width="28" height="24" rx="4" fill="none" stroke="${p.spark}" stroke-width="1.5" stroke-opacity="0.42"/>` +
      landed +
      `<g fill="none" stroke="${p.faint}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.3">` +
      '<path d="M104 140 L104 172 L216 172 L216 140"/>' +
      "</g>" +
      `<circle cx="160" cy="110" r="3" fill="${p.spark}" fill-opacity="0.85"/>`
    );
  },
};

/**
 * Tool id to illustration. Everything absent falls through to procedural, which
 * is the deliberate answer for the rest: multiplayer cards are about live state
 * (who is online, which battle you are in) that a fixed picture would misreport,
 * and the builder and modding tools sit behind advanced mode, so they are not
 * part of the fresh-install screenshot this issue is about.
 */
const DRAWINGS: Record<string, Drawing> = {
  "play.skirmish": skirmish,
  "play.replays": replays,
  "campaign.list": campaigns,
  "scenario.list": scenarios,
  "conquest.list": conquest,
  "runlite.list": warpath,
  "content.maps": maps,
  "downloads.browse": downloads,
};

/** Tool ids with a bundled illustration, for tests and for the preview page. */
export const BUNDLED_ART_TOOL_IDS: readonly string[] = Object.keys(DRAWINGS);

/**
 * The illustration for a tool as raw SVG markup, or `undefined` when none is
 * bundled. Exported alongside the data URL so tests and the preview harness can
 * work on markup rather than on an encoded blob.
 */
export function bundledCardArtSvg(
  toolId: string,
  themeColor: string,
): string | undefined {
  // `hasOwn` rather than a truthiness check: a tool id of "constructor" would
  // otherwise find a function on Object's prototype and be drawn.
  if (!Object.hasOwn(DRAWINGS, toolId)) return undefined;
  const drawing = DRAWINGS[toolId];
  const p = paletteFor(themeColor);
  const ns = toolId.replace(/[^a-z0-9]+/gi, "-");
  const pools = drawing.pools.map(
    ([cx, cy, r, o], i) =>
      `<radialGradient id="p${ns}${i}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="${p.glow}" stop-opacity="${o}"/>` +
      `<stop offset="1" stop-color="${p.glow}" stop-opacity="0"/>` +
      "</radialGradient>",
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">` +
    "<defs>" +
    `<linearGradient id="f${ns}" x1="0" y1="0" x2="0.4" y2="1">` +
    `<stop offset="0" stop-color="${p.fieldTop}"/>` +
    `<stop offset="1" stop-color="${p.fieldFoot}"/>` +
    "</linearGradient>" +
    pools.join("") +
    "</defs>" +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#f${ns})"/>` +
    pools
      .map(
        (_, i) =>
          `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#p${ns}${i})"/>`,
      )
      .join("") +
    drawing.paint(p) +
    "</svg>"
  );
}

/**
 * The chain source. Percent-encoded rather than base64, matching the procedural
 * floor: shorter, and readable in devtools.
 */
export const bundledCardArt: CardArtSource = ({ toolId, themeColor }) => {
  const svg = bundledCardArtSvg(toolId, themeColor);
  if (!svg) return undefined;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

/** A chevron pointing right (`dir` 1) or left (`dir` -1), as path data. */
function chevron(x: number, y: number, dir: 1 | -1): string {
  return `<path d="M${x - dir * 4} ${y - 5} L${x + dir * 4} ${y} L${x - dir * 4} ${y + 5}"/>`;
}

/** A diamond as a polygon, so the legibility checker can measure its area. */
function diamond(x: number, y: number, r: number): string {
  return `<polygon points="${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}"/>`;
}

/** Two decimal places, so the markup stays short. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** An `hsl()` colour, with every component rounded and wrapped into range. */
function hsl(h: number, s: number, l: number): string {
  const hue = round(((h % 360) + 360) % 360);
  return `hsl(${hue} ${round(clamp(s, 0, 100))}% ${round(clamp(l, 0, 100))}%)`;
}

/** Re-exported so the preview harness can render against the shipping default. */
export { FALLBACK_THEME_COLOR };
