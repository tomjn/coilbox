/**
 * Step 3 of the card-art chain: illustrations Coilbox ships for a handful of
 * tools, drawn in code as SVG.
 *
 * These are not only the cold-start pictures. Issue #1036 promoted them to the
 * default: a tool card shows its drawing unless real content can say something
 * the drawing cannot. A fixed drawing says what the tool is, where a seeded
 * pattern only says which tool it is, and rendered as a group thirty drawings
 * read as one set while thirty patterns read as a page that has not loaded.
 *
 * Anything not in {@link DRAWINGS} still falls through to the procedural floor,
 * which always answers, so adding or dropping a tool here is a local change with
 * no chain consequences.
 *
 * ## The scheme contract
 *
 * A card takes the page's ramp, so its art has to as well: a dark field under
 * light marks on a dark card, and the reverse of that on a light one. Every
 * lightness in {@link Palette} is written as its dark value and converted by
 * {@link schemeLightness}, which mirrors the field and pushes the marks a little
 * past the mirror so they keep their presence on a pale card. It is the same
 * rule the procedural field uses, so the two sit beside each other in either
 * scheme without a seam.
 *
 * What the drawings themselves may do is unchanged and stated in dark terms:
 * marks are strokes and small shapes over the field, and nothing paints a flat
 * area big enough to sit under a word. `bundledArt.test.ts` measures that in
 * both schemes rather than trusting it, and measures the procedural art with the
 * same yardstick so the threshold is not tuned to this file.
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
import type { CardArtSource, CardScheme } from "./art";
import {
  FALLBACK_THEME_COLOR,
  parseColor,
  schemeLightness,
} from "./proceduralArt";

/** Canvas the drawings are authored against, matching the procedural floor. */
const WIDTH = 320;
const HEIGHT = 200;

/** Tints derived from the theme colour, shared by every drawing. */
interface Palette {
  /** Top of the field gradient. */
  fieldTop: string;
  /** Foot of the field gradient. */
  fieldFoot: string;
  /** The soft pools laid over the field: light on a dark card, shade on a light one. */
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

function paletteFor(themeColor: string, scheme: CardScheme): Palette {
  const theme = parseColor(themeColor) ?? FALLBACK_HSL;
  const neutral = theme.s < ACHROMATIC_SATURATION;
  const sat = neutral ? clamp(theme.s, 0, 6) : clamp(theme.s, 24, 58);
  // A neutral theme has no hue worth rotating, so every offset collapses to 0.
  const hue = (offset: number) => (neutral ? theme.h : theme.h + offset);
  // Lightnesses as they are on a dark card, put through the light ramp when the
  // card is light.
  const tone = (dark: number) => schemeLightness(scheme, dark);
  return {
    fieldTop: hsl(hue(14), sat, tone(17)),
    fieldFoot: hsl(hue(-10), sat * 0.65, tone(8)),
    glow: hsl(hue(22), Math.min(sat + 14, 70), tone(58)),
    faint: hsl(hue(0), Math.min(sat + 6, 62), tone(54)),
    line: hsl(hue(6), Math.min(sat + 18, 72), tone(70)),
    spark: hsl(hue(-16), neutral ? sat : Math.min(sat + 30, 82), tone(80)),
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
 * Slabs stacked back into the canvas, the front one lit.
 *
 * A save list is a stack of moments and the front of it is the one you would
 * load. Drawn as trapezoids so the stack has depth without needing a perspective
 * grid, which the scenario card already owns.
 */
const savegames: Drawing = {
  pools: [
    [160, 82, 128, 0.18],
    [252, 148, 86, 0.09],
  ],
  paint: (p) => {
    const slab = (i: number) => {
      const y = 112 - i * 22;
      const inset = i * 15;
      const front = i === 0;
      return (
        `<polygon points="${74 + inset},${y} ${246 - inset},${y} ${226 - inset},${y + 15} ${94 + inset},${y + 15}" ` +
        `fill="${front ? p.line : p.faint}" fill-opacity="${front ? 0.32 : 0.2 - i * 0.03}"/>`
      );
    };
    return (
      [3, 2, 1, 0].map(slab).join("") +
      `<g fill="none" stroke="${p.faint}" stroke-width="1" stroke-opacity="0.22">` +
      '<path d="M-10 138 L330 138"/>' +
      "</g>" +
      `<circle cx="204" cy="119" r="5" fill="${p.spark}" fill-opacity="0.85"/>`
    );
  },
};

/**
 * A lit gateway with an arrow going through it.
 *
 * Logging in is the one thing this card does, and a threshold says it without
 * drawing a form. Deliberately not a picture of who is online: a fixed drawing
 * cannot report live state, so it does not try to.
 */
const lobbyLogin: Drawing = {
  pools: [
    [172, 80, 106, 0.24],
    [172, 80, 200, 0.08],
  ],
  paint: (p) =>
    `<g fill="none" stroke="${p.faint}" stroke-width="2" stroke-opacity="0.3">` +
    '<path d="M124 138 L124 78 Q124 40 172 40 Q220 40 220 78 L220 138"/>' +
    "</g>" +
    `<g fill="none" stroke="${p.line}" stroke-width="1.5" stroke-opacity="0.42">` +
    '<path d="M142 138 L142 82 Q142 58 172 58 Q202 58 202 82 L202 138"/>' +
    "</g>" +
    `<rect x="108" y="138" width="128" height="4" rx="2" fill="${p.faint}" fill-opacity="0.3"/>` +
    `<g fill="none" stroke="${p.spark}" stroke-width="2" stroke-opacity="0.55" stroke-linecap="round" stroke-linejoin="round">` +
    '<path d="M44 100 L112 100"/>' +
    '<path d="M96 86 L112 100 L96 114"/>' +
    "</g>" +
    `<circle cx="172" cy="90" r="5" fill="${p.spark}" fill-opacity="0.85"/>`,
};

/** Three speech bubbles, the newest lit. A conversation, not a window. */
const chat: Drawing = {
  pools: [
    [110, 54, 116, 0.18],
    [222, 116, 96, 0.12],
  ],
  paint: (p) => {
    const dots = (x: number, y: number, colour: string, o: number) =>
      [0, 1, 2]
        .map(
          (i) =>
            `<circle cx="${x + i * 12}" cy="${y}" r="2.5" fill="${colour}" fill-opacity="${o}"/>`,
        )
        .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1.8" stroke-opacity="0.34">` +
      '<rect x="38" y="22" width="122" height="38" rx="10"/>' +
      '<polygon points="58,60 58,74 76,60"/>' +
      "</g>" +
      dots(70, 41, p.faint, 0.4) +
      `<g fill="none" stroke="${p.faint}" stroke-width="1.8" stroke-opacity="0.26">` +
      '<rect x="152" y="70" width="126" height="38" rx="10"/>' +
      '<polygon points="256,108 256,122 240,108"/>' +
      "</g>" +
      dots(188, 89, p.faint, 0.32) +
      `<g fill="none" stroke="${p.spark}" stroke-width="1.8" stroke-opacity="0.5">` +
      '<rect x="52" y="98" width="104" height="38" rx="10"/>' +
      '<polygon points="72,136 72,150 88,136"/>' +
      "</g>" +
      dots(86, 117, p.spark, 0.7)
    );
  },
};

/** Several rooms at once, one of them lit. The battle list, not a battle. */
const battles: Drawing = {
  pools: [
    [160, 80, 148, 0.16],
    [58, 40, 92, 0.1],
  ],
  paint: (p) => {
    const rooms: readonly (readonly [number, number, number])[] = [
      [62, 52, 27],
      [140, 34, 19],
      [214, 72, 33],
      [96, 116, 22],
      [180, 128, 16],
      [286, 26, 14],
    ];
    const rings = rooms
      .map(
        ([x, y, r]) =>
          `<circle cx="${x}" cy="${y}" r="${r}" stroke-opacity="0.34"/>`,
      )
      .join("");
    const crews = rooms
      .flatMap(([x, y, r]) => [
        `<circle cx="${round(x - r * 0.44)}" cy="${y}" r="3"/>`,
        `<circle cx="${round(x + r * 0.44)}" cy="${y}" r="3"/>`,
      ])
      .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1.8">${rings}</g>` +
      `<g fill="${p.line}" fill-opacity="0.45">${crews}</g>` +
      `<circle cx="214" cy="72" r="33" fill="none" stroke="${p.spark}" stroke-width="2" stroke-opacity="0.6"/>` +
      `<circle cx="214" cy="72" r="43" fill="none" stroke="${p.spark}" stroke-width="1" stroke-opacity="0.22"/>`
    );
  },
};

/** One room, its players ranged around it in two sides. */
const battleRoom: Drawing = {
  pools: [
    [160, 80, 74, 0.26],
    [160, 80, 158, 0.1],
  ],
  paint: (p) => {
    const seat = (angle: number, spark: boolean) => {
      const rad = (angle * Math.PI) / 180;
      const x = round(160 + Math.cos(rad) * 66);
      const y = round(80 + Math.sin(rad) * 46);
      return `<circle cx="${x}" cy="${y}" r="${spark ? 6 : 5}" fill="${spark ? p.spark : p.line}" fill-opacity="${spark ? 0.85 : 0.5}"/>`;
    };
    const left = [150, 180, 210].map((a) => seat(a, false)).join("");
    const right = [-30, 0, 30].map((a) => seat(a, a === 0)).join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.3">` +
      '<ellipse cx="160" cy="80" rx="66" ry="46"/>' +
      '<ellipse cx="160" cy="80" rx="94" ry="66"/>' +
      "</g>" +
      `<g fill="none" stroke="${p.line}" stroke-width="1.5" stroke-opacity="0.34" stroke-dasharray="5 7">` +
      '<path d="M160 22 L160 138"/>' +
      "</g>" +
      left +
      right +
      `<circle cx="160" cy="80" r="4" fill="${p.spark}" fill-opacity="0.6"/>`
    );
  },
};

/** A rating climbing over a band of the field it is measured against. */
const stats: Drawing = {
  pools: [
    [220, 50, 122, 0.18],
    [50, 128, 92, 0.09],
  ],
  paint: (p) => {
    const points: readonly (readonly [number, number])[] = [
      [30, 128],
      [66, 116],
      [102, 122],
      [138, 98],
      [174, 104],
      [210, 76],
      [246, 60],
      [282, 38],
    ];
    const trace = points.map(([x, y]) => `${x} ${y}`).join(" L");
    const band = points
      .map(
        ([x, y]) =>
          `<rect x="${x - 3}" y="${y + 8}" width="6" height="24" rx="3"/>`,
      )
      .join("");
    const axis = [0, 1, 2, 3, 4]
      .map((i) => `<path d="M30 ${40 + i * 24} L290 ${40 + i * 24}"/>`)
      .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1" stroke-opacity="0.16">${axis}</g>` +
      `<g fill="${p.faint}" fill-opacity="0.2">${band}</g>` +
      `<path d="M${trace}" fill="none" stroke="${p.line}" stroke-width="2.5" stroke-opacity="0.5" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle cx="282" cy="38" r="5.5" fill="${p.spark}" fill-opacity="0.9"/>` +
      `<circle cx="138" cy="98" r="3.5" fill="${p.spark}" fill-opacity="0.45"/>`
    );
  },
};

/** A shelf of games, one pulled forward. What you have, not what you could get. */
const games: Drawing = {
  pools: [
    [160, 74, 134, 0.17],
    [44, 138, 84, 0.09],
  ],
  paint: (p) => {
    const cases = [0, 1, 2, 3, 4]
      .map((i) => {
        const x = 46 + i * 40;
        const h = 82 + (i % 3) * 8;
        return (
          `<rect x="${x}" y="${round(128 - h)}" width="30" height="${h}" rx="3" fill="${p.line}" fill-opacity="0.16"/>` +
          `<rect x="${x}" y="${round(128 - h)}" width="30" height="${h}" rx="3" fill="none" stroke="${p.faint}" stroke-width="1.2" stroke-opacity="0.34"/>`
        );
      })
      .join("");
    return (
      cases +
      `<rect x="222" y="36" width="34" height="94" rx="4" fill="${p.line}" fill-opacity="0.24"/>` +
      `<rect x="222" y="36" width="34" height="94" rx="4" fill="none" stroke="${p.spark}" stroke-width="1.8" stroke-opacity="0.55"/>` +
      `<rect x="228" y="48" width="22" height="3" rx="1.5" fill="${p.spark}" fill-opacity="0.6"/>` +
      `<rect x="228" y="56" width="14" height="3" rx="1.5" fill="${p.spark}" fill-opacity="0.4"/>` +
      `<rect x="30" y="128" width="260" height="4" rx="2" fill="${p.faint}" fill-opacity="0.32"/>`
    );
  },
};

/** Sealed drums stacked on a pallet. An archive is a container, not a screen. */
const archives: Drawing = {
  pools: [
    [160, 70, 118, 0.18],
    [268, 132, 84, 0.09],
  ],
  paint: (p) => {
    const drum = (cx: number, cy: number, rx: number, ry: number, o: number) =>
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke-opacity="${o}"/>` +
      `<path d="M${cx - rx} ${cy} L${cx - rx} ${cy + 28}"/>` +
      `<path d="M${cx + rx} ${cy} L${cx + rx} ${cy + 28}"/>` +
      `<ellipse cx="${cx}" cy="${cy + 28}" rx="${rx}" ry="${ry}" stroke-opacity="${round(o * 0.6)}"/>`;
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1.8">` +
      drum(160, 26, 52, 15, 0.34) +
      drum(160, 62, 52, 15, 0.4) +
      "</g>" +
      `<g fill="none" stroke="${p.line}" stroke-width="2">` +
      drum(160, 98, 52, 15, 0.5) +
      "</g>" +
      `<rect x="90" y="140" width="140" height="5" rx="2.5" fill="${p.faint}" fill-opacity="0.34"/>` +
      `<circle cx="160" cy="98" r="5" fill="${p.spark}" fill-opacity="0.8"/>` +
      `<g fill="none" stroke="${p.spark}" stroke-width="1.5" stroke-opacity="0.35">` +
      '<path d="M132 126 L188 126"/>' +
      "</g>"
    );
  },
};

/** One shell holding several different things. A setup pack is a bundle. */
const setupPacks: Drawing = {
  pools: [
    [160, 78, 104, 0.22],
    [160, 78, 190, 0.08],
  ],
  paint: (p) =>
    `<g fill="none" stroke="${p.faint}" stroke-width="2" stroke-opacity="0.34">` +
    '<polygon points="160,12 246,58 246,122 160,168 74,122 74,58"/>' +
    "</g>" +
    `<g fill="none" stroke="${p.line}" stroke-width="1.5" stroke-opacity="0.3">` +
    '<polygon points="160,36 224,70 224,118 160,152 96,118 96,70"/>' +
    "</g>" +
    `<circle cx="132" cy="76" r="11" fill="${p.line}" fill-opacity="0.3"/>` +
    `<rect x="176" y="64" width="24" height="24" rx="4" fill="${p.line}" fill-opacity="0.26"/>` +
    `<g fill="${p.spark}" fill-opacity="0.7">${diamond(160, 118, 12)}</g>`,
};

/**
 * A base laid out on a build grid, threaded in the order it goes up, with the
 * plot the order has not reached yet still an empty outline.
 *
 * What separates this from the maps card two along is that a blueprint is a
 * plan and not a place. The maps grid runs off the canvas on every side because
 * it is ground. This one stops short of the edges with a square of clear ground
 * round the layout, because it is a sheet, and what stands on it is footprints
 * rather than terrain. Footprint size is the one thing about a building a
 * blueprint really carries, so the squares come in three sizes rather than one
 * repeated.
 *
 * The order thread runs one way across the layout and touches three of the nine
 * buildings on its way to the empty plot. A line through every one of them
 * doubles back on itself and reads as a scribble over the thing it is meant to
 * explain.
 */
const blueprints: Drawing = {
  pools: [
    [112, 68, 126, 0.18],
    [232, 130, 84, 0.1],
  ],
  paint: (p) => {
    /**
     * The sheet: one build square in canvas units, its top left corner, and how
     * many squares it runs. Eleven by seven leaves a square of clear ground on
     * every side of the layout below, which is what makes it a sheet rather
     * than ground that happens to stop.
     */
    const pitch = 20;
    const [left, top] = [50, 20];
    const [cols, rows] = [11, 7];
    /**
     * Ground left clear round each building. Buildings in a real base stand
     * shoulder to shoulder, and squares drawn true to size would touch and read
     * as one shape. Taken off each building rather than added between them, so
     * the layout stays on the grid.
     */
    const gap = 2;
    /** Where one building stands: column, row, squares wide, squares deep. */
    type Plot = readonly [number, number, number, number];
    /** A factory, a lab, a store, a turret, a row of solars and a second store. */
    const built: readonly Plot[] = [
      [1, 1, 3, 3],
      [5, 1, 2, 2],
      [8, 1, 2, 2],
      [7, 3, 1, 1],
      [1, 4, 1, 1],
      [2, 4, 1, 1],
      [3, 4, 1, 1],
      [4, 4, 1, 1],
      [5, 4, 2, 2],
    ];
    /** The plot the order has not reached. A plan covers ground nobody has built on. */
    const next: Plot = [8, 4, 2, 2];
    /** Which buildings the order thread passes through, as indices into `built`. */
    const order = [0, 1, 8];
    const box = ([col, row, wide, deep]: Plot) =>
      `x="${left + col * pitch + gap}" y="${top + row * pitch + gap}" ` +
      `width="${wide * pitch - gap * 2}" height="${deep * pitch - gap * 2}" rx="2"`;
    const middle = ([col, row, wide, deep]: Plot): readonly [
      number,
      number,
    ] => [left + (col + wide / 2) * pitch, top + (row + deep / 2) * pitch];
    const sheet =
      Array.from(
        { length: cols + 1 },
        (_, i) =>
          `<path d="M${left + i * pitch} ${top} L${left + i * pitch} ${top + rows * pitch}"/>`,
      ).join("") +
      Array.from(
        { length: rows + 1 },
        (_, i) =>
          `<path d="M${left} ${top + i * pitch} L${left + cols * pitch} ${top + i * pitch}"/>`,
      ).join("");
    const stops = [...order.map((i) => built[i]), next].map(middle);
    const passed = stops
      .slice(1, -1)
      .map(
        ([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="2.5" fill="${p.spark}" fill-opacity="0.6"/>`,
      )
      .join("");
    const [startX, startY] = stops[0];
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1" stroke-opacity="0.24">` +
      sheet +
      "</g>" +
      `<g fill="${p.line}" fill-opacity="0.26" stroke="${p.line}" stroke-width="1.2" stroke-opacity="0.5">` +
      built.map((plot) => `<rect ${box(plot)}/>`).join("") +
      "</g>" +
      `<rect ${box(next)} fill="none" stroke="${p.spark}" stroke-width="1.5" stroke-opacity="0.5" stroke-dasharray="5 5"/>` +
      `<g fill="none" stroke="${p.spark}" stroke-width="1.5" stroke-opacity="0.45" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 7">` +
      `<path d="M${stops.map(([x, y]) => `${x} ${y}`).join(" L")}"/>` +
      "</g>" +
      passed +
      `<circle cx="${startX}" cy="${startY}" r="4.5" fill="${p.spark}" fill-opacity="0.85"/>`
    );
  },
};

/** A map sheet coming down off the network. */
const downloadMaps: Drawing = {
  pools: [
    [160, 58, 122, 0.18],
    [160, 138, 96, 0.1],
  ],
  paint: (p) => {
    const sheet =
      '<polygon points="76,26 140,44 204,26 268,44 268,102 204,84 140,102 76,84"/>';
    const folds =
      '<path d="M140 44 L140 102"/><path d="M204 26 L204 84"/>' +
      '<path d="M76 56 L268 56"/><path d="M76 72 L268 72"/>';
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1" stroke-opacity="0.18">${folds}</g>` +
      `<g fill="none" stroke="${p.line}" stroke-width="1.8" stroke-opacity="0.42">${sheet}</g>` +
      `<g fill="none" stroke="${p.spark}" stroke-width="2.5" stroke-opacity="0.55" stroke-linecap="round" stroke-linejoin="round">` +
      '<path d="M160 104 L160 142"/>' +
      '<path d="M144 126 L160 142 L176 126"/>' +
      "</g>" +
      `<circle cx="160" cy="64" r="4" fill="${p.spark}" fill-opacity="0.8"/>`
    );
  },
};

/** A game case coming down off the network. */
const downloadGames: Drawing = {
  pools: [
    [160, 56, 118, 0.18],
    [160, 138, 92, 0.1],
  ],
  paint: (p) =>
    `<rect x="112" y="18" width="96" height="76" rx="6" fill="${p.line}" fill-opacity="0.22"/>` +
    `<rect x="112" y="18" width="96" height="76" rx="6" fill="none" stroke="${p.line}" stroke-width="1.8" stroke-opacity="0.45"/>` +
    `<path d="M126 18 L126 94" fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.4"/>` +
    `<rect x="140" y="34" width="52" height="4" rx="2" fill="${p.faint}" fill-opacity="0.38"/>` +
    `<rect x="140" y="46" width="34" height="4" rx="2" fill="${p.faint}" fill-opacity="0.26"/>` +
    `<circle cx="176" cy="72" r="9" fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.34"/>` +
    `<g fill="none" stroke="${p.spark}" stroke-width="2.5" stroke-opacity="0.55" stroke-linecap="round" stroke-linejoin="round">` +
    '<path d="M160 104 L160 142"/>' +
    '<path d="M144 126 L160 142 L176 126"/>' +
    "</g>" +
    `<rect x="96" y="150" width="128" height="4" rx="2" fill="${p.faint}" fill-opacity="0.3"/>`,
};

/**
 * A row of other people's things above a line, and one of them crossing it onto
 * a shelf that already holds two.
 *
 * What the hub hands you is other players' presets, challenges, setup packs and
 * scenarios, so the assortment is the subject: five different shapes rather than
 * five of one. The line is what says which side of it you are standing on, and
 * the shape crossing it is what makes this an arrival rather than a catalogue.
 *
 * The globe it replaces said "the internet", which is true of every screen in
 * Coilbox that fetches anything. Not the coil mark either: the nav item beside
 * the label already is one, and a card repeating its own icon says nothing the
 * icon has not.
 */
const hub: Drawing = {
  pools: [
    [160, 34, 152, 0.16],
    [160, 108, 92, 0.13],
  ],
  paint: (p) => {
    // Shared out there. The hexagon is the shape the setup-pack card is drawn
    // from, so the two read as the same object in two places.
    const shared =
      '<polygon points="46,32 60,40 60,56 46,64 32,56 32,40"/>' +
      '<rect x="92" y="20" width="34" height="26" rx="4"/>' +
      '<circle cx="166" cy="46" r="16"/>' +
      diamond(222, 30, 16) +
      '<rect x="262" y="30" width="28" height="28" rx="4"/>';
    // Already yours, so the arriving one is joining a shelf rather than landing
    // on an empty card.
    const held =
      '<rect x="96" y="98" width="28" height="24" rx="3"/>' +
      '<circle cx="212" cy="110" r="12"/>';
    return (
      `<g fill="${p.line}" fill-opacity="0.24" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.4">${shared}</g>` +
      `<g fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.3" stroke-dasharray="6 9">` +
      '<path d="M-10 78 L330 78"/>' +
      "</g>" +
      `<g fill="${p.line}" fill-opacity="0.28" stroke="${p.faint}" stroke-width="1.2" stroke-opacity="0.4">${held}</g>` +
      `<g fill="none" stroke="${p.spark}" stroke-width="2" stroke-opacity="0.5" stroke-linecap="round" stroke-linejoin="round">` +
      '<path d="M222 50 Q216 82 176 94"/>' +
      '<path d="M188 84 L176 94 L191 96"/>' +
      "</g>" +
      `<g fill="${p.spark}" fill-opacity="0.8">${diamond(160, 107, 15)}</g>` +
      `<rect x="84" y="126" width="152" height="4" rx="2" fill="${p.faint}" fill-opacity="0.32"/>`
    );
  },
};

/** A mission graph with edit handles on it. Building the journey, not walking it. */
const campaignBuilder: Drawing = {
  pools: [
    [160, 96, 132, 0.17],
    [286, 52, 82, 0.09],
  ],
  paint: (p) => {
    const nodes: readonly (readonly [number, number])[] = [
      [46, 128],
      [116, 92],
      [116, 160],
      [190, 126],
      [262, 78],
      [262, 152],
    ];
    const links: readonly (readonly [number, number])[] = [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
      [3, 4],
      [3, 5],
    ];
    const edges = links
      .map(
        ([a, b]) =>
          `<path d="M${nodes[a][0]} ${nodes[a][1]} L${nodes[b][0]} ${nodes[b][1]}"/>`,
      )
      .join("");
    const handles = nodes
      .map(
        ([x, y]) =>
          `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="2" fill="${p.line}" fill-opacity="0.34"/>`,
      )
      .join("");
    const grips = [
      [190 - 14, 126 - 14],
      [190 + 14, 126 - 14],
      [190 - 14, 126 + 14],
      [190 + 14, 126 + 14],
    ]
      .map(
        ([x, y]) =>
          `<rect x="${x - 2.5}" y="${y - 2.5}" width="5" height="5" fill="${p.spark}" fill-opacity="0.8"/>`,
      )
      .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.32">${edges}</g>` +
      handles +
      `<rect x="176" y="112" width="28" height="28" rx="2" fill="none" stroke="${p.spark}" stroke-width="1.5" stroke-opacity="0.5" stroke-dasharray="4 4"/>` +
      grips
    );
  },
};

/** A plan view with placements dropped on it and one selected. */
const scenarioBuilder: Drawing = {
  pools: [
    [188, 84, 118, 0.18],
    [52, 40, 88, 0.09],
  ],
  paint: (p) => {
    const grid =
      [40, 80, 120, 160, 200, 240, 280]
        .map((x) => `<path d="M${x} 14 L${x} 156"/>`)
        .join("") +
      [30, 66, 102, 138].map((y) => `<path d="M24 ${y} L296 ${y}"/>`).join("");
    const pins = [
      [80, 60],
      [124, 118],
      [208, 54],
      [252, 122],
      [166, 92],
    ]
      .map(
        ([x, y]) =>
          `<polygon points="${x},${y - 12} ${x + 8},${y} ${x},${y + 6} ${x - 8},${y}" fill="${p.line}" fill-opacity="0.5"/>`,
      )
      .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1" stroke-opacity="0.2">${grid}</g>` +
      pins +
      `<rect x="146" y="70" width="40" height="40" rx="2" fill="none" stroke="${p.spark}" stroke-width="1.5" stroke-opacity="0.55" stroke-dasharray="5 4"/>` +
      `<circle cx="166" cy="92" r="4" fill="${p.spark}" fill-opacity="0.85"/>`
    );
  },
};

/** A finished machine, assembled from blocks. */
const legoUnits: Drawing = {
  pools: [
    [160, 70, 116, 0.2],
    [160, 150, 108, 0.08],
  ],
  paint: (p) => {
    const block = (x: number, y: number, w: number, h: number, o: number) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${p.line}" fill-opacity="${o}"/>` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="none" stroke="${p.faint}" stroke-width="1.2" stroke-opacity="0.4"/>`;
    return (
      block(126, 24, 68, 30, 0.3) +
      block(112, 58, 96, 42, 0.24) +
      block(78, 64, 30, 26, 0.2) +
      block(212, 64, 30, 26, 0.2) +
      block(122, 104, 26, 34, 0.22) +
      block(172, 104, 26, 34, 0.22) +
      `<rect x="60" y="142" width="200" height="4" rx="2" fill="${p.faint}" fill-opacity="0.3"/>` +
      `<circle cx="146" cy="38" r="4.5" fill="${p.spark}" fill-opacity="0.85"/>` +
      `<circle cx="174" cy="38" r="4.5" fill="${p.spark}" fill-opacity="0.6"/>`
    );
  },
};

/** The same blocks laid out as a parts tray, before anything is built. */
const legoParts: Drawing = {
  pools: [
    [160, 78, 142, 0.16],
    [252, 34, 78, 0.09],
  ],
  paint: (p) => {
    const shapes = [
      `<rect x="44" y="30" width="42" height="22" rx="3"/>`,
      `<rect x="104" y="26" width="24" height="34" rx="3"/>`,
      `<polygon points="168,24 194,38 168,52 142,38"/>`,
      `<circle cx="230" cy="38" r="14"/>`,
      `<rect x="264" y="24" width="22" height="30" rx="3"/>`,
      `<polygon points="58,124 84,124 84,98 58,98"/>`,
      `<circle cx="126" cy="112" r="16"/>`,
      `<rect x="158" y="98" width="46" height="18" rx="3"/>`,
      `<polygon points="238,94 262,112 238,130 214,112"/>`,
      `<rect x="272" y="96" width="18" height="34" rx="3"/>`,
    ];
    const cells = [80, 160, 240]
      .map((x) => `<path d="M${x} 12 L${x} 146"/>`)
      .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1" stroke-opacity="0.14">` +
      cells +
      '<path d="M24 74 L296 74"/>' +
      "</g>" +
      `<g fill="${p.line}" fill-opacity="0.28">${shapes.join("")}</g>` +
      `<g fill="none" stroke="${p.spark}" stroke-width="1.5" stroke-opacity="0.45">` +
      '<circle cx="126" cy="112" r="22"/>' +
      "</g>"
    );
  },
};

/** A tray of map projects, one open. */
const mapconvProjects: Drawing = {
  pools: [
    [160, 96, 138, 0.17],
    [56, 166, 82, 0.09],
  ],
  paint: (p) => {
    const tile = (x: number, y: number, spark: boolean) =>
      `<rect x="${x}" y="${y}" width="72" height="52" rx="4" fill="${p.line}" fill-opacity="${spark ? 0.24 : 0.14}"/>` +
      `<rect x="${x}" y="${y}" width="72" height="52" rx="4" fill="none" stroke="${spark ? p.spark : p.faint}" stroke-width="${spark ? 1.8 : 1.2}" stroke-opacity="${spark ? 0.55 : 0.32}"/>` +
      `<path d="M${x + 12} ${y + 36} Q${x + 26} ${y + 14} ${x + 42} ${y + 26} T${x + 62} ${y + 18}" fill="none" stroke="${spark ? p.spark : p.faint}" stroke-width="1.2" stroke-opacity="0.42"/>`;
    return (
      tile(30, 44, false) +
      tile(124, 44, true) +
      tile(218, 44, false) +
      tile(30, 116, false) +
      tile(124, 116, false) +
      tile(218, 116, false) +
      `<circle cx="160" cy="70" r="4" fill="${p.spark}" fill-opacity="0.85"/>`
    );
  },
};

/** Separate layers pressed into one archive. */
const mapconvCompile: Drawing = {
  pools: [
    [96, 100, 118, 0.18],
    [244, 100, 92, 0.12],
  ],
  paint: (p) => {
    const layer = (y: number, o: number) =>
      `<polygon points="34,${y} 106,${y - 18} 154,${y + 4} 82,${y + 22}" fill="${p.line}" fill-opacity="${o}"/>` +
      `<polygon points="34,${y} 106,${y - 18} 154,${y + 4} 82,${y + 22}" fill="none" stroke="${p.faint}" stroke-width="1.2" stroke-opacity="0.36"/>`;
    return (
      layer(150, 0.14) +
      layer(118, 0.18) +
      layer(86, 0.22) +
      `<g fill="none" stroke="${p.spark}" stroke-width="2" stroke-opacity="0.55" stroke-linecap="round" stroke-linejoin="round">` +
      '<path d="M168 108 L214 108"/>' +
      '<path d="M200 96 L214 108 L200 120"/>' +
      "</g>" +
      `<rect x="230" y="80" width="60" height="56" rx="6" fill="${p.line}" fill-opacity="0.26"/>` +
      `<rect x="230" y="80" width="60" height="56" rx="6" fill="none" stroke="${p.spark}" stroke-width="1.8" stroke-opacity="0.5"/>` +
      `<circle cx="260" cy="108" r="4" fill="${p.spark}" fill-opacity="0.85"/>`
    );
  },
};

/** One archive opened back out into its layers. */
const mapconvDecompile: Drawing = {
  pools: [
    [78, 100, 92, 0.14],
    [220, 100, 122, 0.18],
  ],
  paint: (p) => {
    const layer = (y: number, o: number) =>
      `<polygon points="176,${y} 248,${y - 18} 296,${y + 4} 224,${y + 22}" fill="${p.line}" fill-opacity="${o}"/>` +
      `<polygon points="176,${y} 248,${y - 18} 296,${y + 4} 224,${y + 22}" fill="none" stroke="${p.faint}" stroke-width="1.2" stroke-opacity="0.36"/>`;
    return (
      `<rect x="30" y="80" width="60" height="56" rx="6" fill="${p.line}" fill-opacity="0.2"/>` +
      `<rect x="30" y="80" width="60" height="56" rx="6" fill="none" stroke="${p.faint}" stroke-width="1.8" stroke-opacity="0.4"/>` +
      `<g fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.4">` +
      '<path d="M42 92 L78 92"/>' +
      "</g>" +
      `<g fill="none" stroke="${p.spark}" stroke-width="2" stroke-opacity="0.55" stroke-linecap="round" stroke-linejoin="round">` +
      '<path d="M106 108 L152 108"/>' +
      '<path d="M138 96 L152 108 L138 120"/>' +
      "</g>" +
      layer(158, 0.22) +
      layer(118, 0.18) +
      layer(78, 0.14) +
      `<circle cx="236" cy="118" r="4" fill="${p.spark}" fill-opacity="0.85"/>`
    );
  },
};

/** One script turning into another. Two columns, an arrow between them. */
const bos2lua: Drawing = {
  pools: [
    [88, 96, 108, 0.16],
    [236, 104, 108, 0.16],
  ],
  paint: (p) => {
    const column = (x: number, colour: string, o: number, widths: number[]) =>
      widths
        .map(
          (w, i) =>
            `<rect x="${x + (i % 3) * 7}" y="${52 + i * 14}" width="${w}" height="4" rx="2" fill="${colour}" fill-opacity="${o}"/>`,
        )
        .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1.2" stroke-opacity="0.28">` +
      '<rect x="26" y="38" width="106" height="126" rx="6"/>' +
      '<rect x="188" y="38" width="106" height="126" rx="6"/>' +
      "</g>" +
      column(40, p.faint, 0.3, [56, 44, 62, 38, 50, 34, 58, 42]) +
      column(202, p.line, 0.4, [48, 60, 36, 54, 44, 62, 40, 56]) +
      `<g fill="none" stroke="${p.spark}" stroke-width="2" stroke-opacity="0.6" stroke-linecap="round" stroke-linejoin="round">` +
      '<path d="M142 100 L178 100"/>' +
      '<path d="M166 88 L178 100 L166 112"/>' +
      "</g>"
    );
  },
};

/**
 * A jointed limb turning about a pivot, with the pose it came from left behind.
 *
 * The protractor round the middle joint is doing the work. A rig without one is
 * a line with dots on it, which is what the player-stats card already is, and at
 * card size the two were hard to tell apart.
 */
const cobTools: Drawing = {
  pools: [
    [154, 74, 116, 0.22],
    [250, 130, 78, 0.09],
  ],
  paint: (p) => {
    const pivot = [154, 74] as const;
    const dial = Array.from({ length: 9 }, (_, i) => {
      const rad = ((-96 + i * 24) * Math.PI) / 180;
      return `<path d="M${round(pivot[0] + Math.cos(rad) * 30)} ${round(pivot[1] + Math.sin(rad) * 30)} L${round(pivot[0] + Math.cos(rad) * 37)} ${round(pivot[1] + Math.sin(rad) * 37)}"/>`;
    }).join("");
    const joints = [
      [56, 124],
      [154, 74],
      [252, 40],
    ]
      .map(
        ([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${p.line}" stroke-width="2" stroke-opacity="0.55"/>`,
      )
      .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="4" stroke-opacity="0.2" stroke-linecap="round">` +
      '<path d="M154 74 L246 128"/>' +
      "</g>" +
      `<g fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.3">` +
      `<circle cx="154" cy="74" r="30"/>` +
      "</g>" +
      `<g fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.34">${dial}</g>` +
      `<g fill="none" stroke="${p.line}" stroke-width="5" stroke-opacity="0.42" stroke-linecap="round">` +
      '<path d="M56 124 L154 74"/>' +
      '<path d="M154 74 L252 40"/>' +
      "</g>" +
      joints +
      `<g fill="none" stroke="${p.spark}" stroke-width="1.5" stroke-opacity="0.45" stroke-dasharray="4 5">` +
      '<path d="M252 40 Q286 84 246 128"/>' +
      "</g>" +
      `<circle cx="154" cy="74" r="4" fill="${p.spark}" fill-opacity="0.9"/>`
    );
  },
};

/** A field packed with identical units, densest where it is about to break. */
const uberstressRun: Drawing = {
  pools: [
    [232, 104, 108, 0.24],
    [70, 96, 120, 0.1],
  ],
  paint: (p) => {
    const rand = mulberry32(0xc0ffee);
    const marks = Array.from({ length: 150 }, () => {
      // Biased right: the load ramps across the field rather than filling it.
      const x = round(20 + rand() ** 0.6 * 280);
      const y = round(40 + rand() * 130);
      const r = round(2 + rand() * 1.6);
      const o = round(0.14 + (x / 320) * 0.3);
      return `<polygon points="${x},${round(y - r)} ${round(x + r)},${y} ${x},${round(y + r)} ${round(x - r)},${y}" fill-opacity="${o}"/>`;
    }).join("");
    return (
      `<g fill="${p.line}">${marks}</g>` +
      `<g fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.26" stroke-dasharray="6 7">` +
      '<path d="M232 24 L232 180"/>' +
      "</g>" +
      `<g fill="none" stroke="${p.spark}" stroke-width="2" stroke-opacity="0.4">` +
      '<circle cx="262" cy="104" r="22"/>' +
      "</g>" +
      `<circle cx="262" cy="104" r="6" fill="${p.spark}" fill-opacity="0.9"/>`
    );
  },
};

/** A dial with every previous reading still faintly on it. */
const uberstressHistory: Drawing = {
  pools: [
    [160, 112, 108, 0.22],
    [160, 112, 190, 0.08],
  ],
  paint: (p) => {
    const needle = (angle: number, colour: string, o: number, w: number) => {
      const rad = (angle * Math.PI) / 180;
      const x = round(160 + Math.cos(rad) * 78);
      const y = round(112 + Math.sin(rad) * 78);
      return `<path d="M160 112 L${x} ${y}" stroke="${colour}" stroke-width="${w}" stroke-opacity="${o}"/>`;
    };
    const dial = [180, 157, 134, 111, 88]
      .map((a) => {
        const rad = (a * Math.PI) / 180;
        return `<path d="M${round(160 + Math.cos(rad) * 84)} ${round(112 + Math.sin(rad) * 84)} L${round(160 + Math.cos(rad) * 94)} ${round(112 + Math.sin(rad) * 94)}"/>`;
      })
      .join("");
    const ghosts = [174, 166, 152, 141, 126, 118]
      .map((a, i) => needle(-a, p.faint, round(0.12 + i * 0.03), 1.5))
      .join("");
    return (
      `<g fill="none" stroke="${p.faint}" stroke-width="1.5" stroke-opacity="0.28">` +
      '<path d="M76 112 Q160 10 244 112"/>' +
      "</g>" +
      `<g fill="none" stroke="${p.faint}" stroke-width="2" stroke-opacity="0.34">${dial}</g>` +
      `<g fill="none" stroke-linecap="round">${ghosts}</g>` +
      `<g fill="none" stroke-linecap="round">${needle(-104, p.spark, 0.7, 2.5)}</g>` +
      `<circle cx="160" cy="112" r="6" fill="${p.spark}" fill-opacity="0.85"/>` +
      `<rect x="96" y="140" width="128" height="4" rx="2" fill="${p.faint}" fill-opacity="0.28"/>`
    );
  },
};

/**
 * Tool id to illustration.
 *
 * Coverage is now every tool that opens a Coilbox screen. The six items left out
 * are the ones that open a web page in your browser (the mapping wiki, the
 * Blender tools, the parts-pack format, the Skeletor guides, the Lua animation
 * reference). They are the one case where the procedural field says the right
 * thing: it marks them as not being a screen this app draws.
 *
 * The multiplayer and advanced-mode tools were left to the field by #990, on the
 * grounds that a fixed picture would misreport live state and that the builders
 * are not in a fresh-install screenshot. Both were revisited for issue #1036 and
 * both gave way. A card is a door, not a status display, so a drawing of a
 * doorway does not claim anyone is online. And the people who turn advanced mode
 * on look at the same grid as everyone else.
 */
const DRAWINGS: Record<string, Drawing> = {
  "play.skirmish": skirmish,
  "play.replays": replays,
  "play.savegames": savegames,
  "campaign.list": campaigns,
  "campaign.builder": campaignBuilder,
  "scenario.list": scenarios,
  "scenario.builder": scenarioBuilder,
  "conquest.list": conquest,
  "runlite.list": warpath,
  "multiplayer.lobby": lobbyLogin,
  "multiplayer.chat": chat,
  "multiplayer.battles": battles,
  "multiplayer.battle": battleRoom,
  "multiplayer.stats": stats,
  "content.maps": maps,
  "content.games": games,
  "content.blueprints": blueprints,
  "content.archives": archives,
  "content.setupPacks": setupPacks,
  "downloads.browse": downloads,
  "downloads.maps": downloadMaps,
  "downloads.games": downloadGames,
  "hub.browse": hub,
  "lego.units": legoUnits,
  "lego.parts": legoParts,
  "mapconv.projects": mapconvProjects,
  "mapconv.compile": mapconvCompile,
  "mapconv.decompile": mapconvDecompile,
  "animation.bos2lua": bos2lua,
  "animation.cob": cobTools,
  "uberstress.run": uberstressRun,
  "uberstress.history": uberstressHistory,
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
  scheme: CardScheme,
): string | undefined {
  // `hasOwn` rather than a truthiness check: a tool id of "constructor" would
  // otherwise find a function on Object's prototype and be drawn.
  if (!Object.hasOwn(DRAWINGS, toolId)) return undefined;
  const drawing = DRAWINGS[toolId];
  const p = paletteFor(themeColor, scheme);
  const ns = idFor(toolId);
  const pools = poolLayer(drawing, p, `p${ns}`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">` +
    "<defs>" +
    `<linearGradient id="f${ns}" x1="0" y1="0" x2="0.4" y2="1">` +
    `<stop offset="0" stop-color="${p.fieldTop}"/>` +
    `<stop offset="1" stop-color="${p.fieldFoot}"/>` +
    "</linearGradient>" +
    pools.defs +
    "</defs>" +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#f${ns})"/>` +
    pools.rects +
    drawing.paint(p) +
    "</svg>"
  );
}

/**
 * The illustration for a tool as a full-bleed backdrop behind a page, or
 * `undefined` when none is bundled. Written for the VitePress docs site, which
 * imports this module directly rather than copying the drawings, so the site
 * and the app never drift.
 *
 * Three things separate it from {@link bundledCardArtSvg}, each a consequence
 * of painting behind a page rather than inside a card:
 *
 * - No field wash. `fieldTop`/`fieldFoot` is a card's own background, and a
 *   page already has one of those.
 * - It covers rather than letterboxes. No fixed width or height, and
 *   `xMidYMax slice` scales up until both dimensions are filled, keeping the
 *   crop centred horizontally and the drawing's foot on the bottom edge.
 * - `strength` scales the subject down. Every drawing is tuned for a card in a
 *   grid of muted chrome beside its own label, which is too strong full width
 *   behind running text. Applied as one group opacity rather than per shape,
 *   so no `paint` above needs editing. The pools are left alone: their
 *   opacities are declared separately and read as lighting, not as subject.
 *
 * `viewHeight` crops the canvas to a drawing's own content. Each one leaves
 * room at the foot of the 320x200 canvas for the label band a card needs and a
 * backdrop does not, so cropping it keeps the subject in frame. The pool rects
 * still fill the full canvas, so a pool centred below the crop goes on glowing
 * into it.
 */
export function bundledBackdropSvg(
  toolId: string,
  themeColor: string,
  scheme: CardScheme,
  options: { viewHeight?: number; strength?: number } = {},
): string | undefined {
  if (!Object.hasOwn(DRAWINGS, toolId)) return undefined;
  const { viewHeight = HEIGHT, strength = 1 } = options;
  const drawing = DRAWINGS[toolId];
  const p = paletteFor(themeColor, scheme);
  const pools = poolLayer(drawing, p, `b${idFor(toolId)}`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${viewHeight}" preserveAspectRatio="xMidYMax slice">` +
    `<defs>${pools.defs}</defs>` +
    pools.rects +
    `<g opacity="${round(clamp(strength, 0, 1))}">${drawing.paint(p)}</g>` +
    "</svg>"
  );
}

/** A tool id reduced to something safe to build a gradient id out of. */
function idFor(toolId: string): string {
  return toolId.replace(/[^a-z0-9]+/gi, "-");
}

/**
 * A drawing's pools as gradient defs plus the rects that paint them. `ns`
 * namespaces the ids, so more than one drawing can render on a page without
 * colliding. The rects always span the full canvas rather than a cropped
 * viewBox, so a pool centred outside the crop still lights what is inside it.
 */
function poolLayer(
  drawing: Drawing,
  p: Palette,
  ns: string,
): { defs: string; rects: string } {
  return {
    defs: drawing.pools
      .map(
        ([cx, cy, r, o], i) =>
          `<radialGradient id="${ns}${i}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse">` +
          `<stop offset="0" stop-color="${p.glow}" stop-opacity="${o}"/>` +
          `<stop offset="1" stop-color="${p.glow}" stop-opacity="0"/>` +
          "</radialGradient>",
      )
      .join(""),
    rects: drawing.pools
      .map(
        (_, i) =>
          `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#${ns}${i})"/>`,
      )
      .join(""),
  };
}

/**
 * The chain source. Percent-encoded rather than base64, matching the procedural
 * floor: shorter, and readable in devtools.
 */
export const bundledCardArt: CardArtSource = ({
  toolId,
  themeColor,
  scheme,
}) => {
  const svg = bundledCardArtSvg(toolId, themeColor, scheme);
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
