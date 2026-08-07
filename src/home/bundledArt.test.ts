import { describe, expect, it } from "vitest";
import { resolveCardArt } from "./art";
import {
  BUNDLED_ART_TOOL_IDS,
  bundledCardArt,
  bundledCardArtSvg,
} from "./bundledArt";
import { proceduralCardArt, proceduralCardArtSvg } from "./proceduralArt";

const THEME = "hsl(221.2 83.2% 53.3%)";
/** picoframe's default zinc scheme, which resolves near-neutral. */
const GREY = "rgb(113, 113, 122)";
/**
 * A tool with no bundled illustration, so the chain falls past this step. One of
 * the external links, which are the only nav items left to the procedural field
 * now that issue #1036 covered every tool that opens a Coilbox screen.
 */
const UNCOVERED = "mapconv.mapping-wiki";

describe("bundledCardArtSvg", () => {
  it("draws every tool it claims to cover", () => {
    for (const toolId of BUNDLED_ART_TOOL_IDS) {
      const svg = bundledCardArtSvg(toolId, THEME);
      expect(svg, toolId).toMatch(/^<svg /);
      expect(svg, toolId).toContain('viewBox="0 0 320 200"');
    }
  });

  it("says nothing about a tool it does not cover", () => {
    expect(bundledCardArtSvg(UNCOVERED, THEME)).toBeUndefined();
    expect(bundledCardArtSvg("", THEME)).toBeUndefined();
  });

  it("does not answer for an inherited Object property name", () => {
    // The lookup is a plain object, so a tool id of "constructor" or "toString"
    // would otherwise resolve to a function and be drawn.
    expect(bundledCardArtSvg("constructor", THEME)).toBeUndefined();
    expect(bundledCardArtSvg("toString", THEME)).toBeUndefined();
  });

  it("gives the same markup for the same tool and theme", () => {
    for (const toolId of BUNDLED_ART_TOOL_IDS) {
      expect(bundledCardArtSvg(toolId, THEME)).toBe(
        bundledCardArtSvg(toolId, THEME),
      );
    }
  });

  it("draws a different picture for each tool it covers", () => {
    // Compared with the id namespace removed. Gradient ids carry the tool id,
    // so raw markup differs between two tools even when they share a drawing,
    // and comparing it would let a copy-paste slip through.
    const drawn = BUNDLED_ART_TOOL_IDS.map((id) =>
      anonymise(bundledCardArtSvg(id, THEME) ?? "", id),
    );
    expect(new Set(drawn).size).toBe(BUNDLED_ART_TOOL_IDS.length);
  });

  it("repaints itself in the theme colour", () => {
    const blue = bundledCardArtSvg("conquest.list", THEME);
    const red = bundledCardArtSvg("conquest.list", "hsl(8 78% 52%)");
    expect(blue).not.toBe(red);
    // Same drawing, so the geometry is untouched and only the colours moved.
    expect(strip(blue)).toBe(strip(red));
  });

  it("invents no hue for a neutral theme", () => {
    // A near-neutral accent gets graphite art. Rotating a hue off it would give
    // every card a colour the app never chose.
    for (const toolId of BUNDLED_ART_TOOL_IDS) {
      const svg = bundledCardArtSvg(toolId, GREY) ?? "";
      const hues = new Set(
        [...svg.matchAll(/hsl\(([\d.]+)/g)].map((m) => m[1]),
      );
      expect(hues.size, toolId).toBe(1);
    }
    // The same drawing under a real accent does spread its hues.
    const themed = new Set(
      [
        ...(bundledCardArtSvg("conquest.list", THEME) ?? "").matchAll(
          /hsl\(([\d.]+)/g,
        ),
      ].map((m) => m[1]),
    );
    expect(themed.size).toBeGreaterThan(1);
  });

  it("resolves every gradient it references", () => {
    // A typo in a gradient id is invisible to a snapshot and paints the shape
    // black, which is exactly the kind of defect a card would ship with.
    for (const toolId of BUNDLED_ART_TOOL_IDS) {
      const svg = bundledCardArtSvg(toolId, THEME) ?? "";
      const defined = new Set(
        [...svg.matchAll(/<(?:linear|radial)Gradient id="([^"]+)"/g)].map(
          (m) => m[1],
        ),
      );
      const used = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
      expect(used.length, toolId).toBeGreaterThan(0);
      for (const id of used)
        expect(defined, `${toolId} -> ${id}`).toContain(id);
    }
  });
});

describe("bundledCardArt", () => {
  it("hands the chain a data url for a covered tool", () => {
    const url = bundledCardArt({ toolId: "conquest.list", themeColor: THEME });
    expect(url).toBe(
      `data:image/svg+xml,${encodeURIComponent(bundledCardArtSvg("conquest.list", THEME) ?? "")}`,
    );
  });

  it("falls through for a tool it does not cover", () => {
    expect(
      bundledCardArt({ toolId: UNCOVERED, themeColor: THEME }),
    ).toBeUndefined();
  });
});

describe("the chain with bundled art registered", () => {
  it("prefers a bundled illustration to the procedural field", () => {
    // Importing `./art` runs its registration, so this is the shipping wiring
    // and not a fixture.
    expect(resolveCardArt("conquest.list", THEME)).toEqual({
      kind: "art",
      url: bundledCardArt({ toolId: "conquest.list", themeColor: THEME }),
      source: "bundled",
    });
  });

  it("still reaches procedural for a tool with no illustration", () => {
    expect(resolveCardArt(UNCOVERED, THEME)).toEqual({
      kind: "art",
      url: proceduralCardArt(UNCOVERED, THEME),
      source: "procedural",
    });
  });

  it("leaves no group of the grid entirely on the procedural field", () => {
    // Issue #1036: the field is meant to be the floor, not what most of the page
    // shows. Every group the sidebar draws must have a drawing in it, and the
    // two groups #990 skipped whole are the ones this is guarding.
    const covered = new Set(BUNDLED_ART_TOOL_IDS);
    for (const toolId of [
      "play.savegames",
      "multiplayer.lobby",
      "multiplayer.chat",
      "multiplayer.battles",
      "multiplayer.battle",
      "multiplayer.stats",
      "content.games",
      "content.archives",
      "content.setupPacks",
      "downloads.maps",
      "downloads.games",
      "campaign.builder",
      "scenario.builder",
      "lego.units",
      "lego.parts",
      "mapconv.projects",
      "mapconv.compile",
      "mapconv.decompile",
      "animation.bos2lua",
      "animation.cob",
      "uberstress.run",
      "uberstress.history",
    ]) {
      expect(covered, toolId).toContain(toolId);
    }
  });

  it("covers only tools the sidebar actually offers", () => {
    // Nav ids are `plugin.item`, and an item may carry a digit (`bos2lua`). A
    // typo here is silent: the tool just never gets its illustration and nobody
    // notices until a screenshot.
    for (const id of BUNDLED_ART_TOOL_IDS) {
      expect(id, id).toMatch(/^[a-z]+\.[a-zA-Z0-9]+$/);
    }
  });
});

/**
 * The dark contract, measured.
 *
 * Card text sits over this art and is light in both colour schemes, so the art
 * has to stay dark. `meanLightness` estimates what a card would average by
 * compositing every paint in document order over black, weighting each by the
 * canvas fraction it covers. It is an approximation, and it is deliberately
 * pessimistic where it cannot measure: an unmeasurable filled shape counts as
 * covering the whole canvas.
 *
 * The threshold is checked against the procedural floor as well, which already
 * holds the contract, so it is not a number tuned to make this file pass.
 */
describe("the dark contract", () => {
  const MAX_MEAN_LIGHTNESS = 30;
  /** A flat fill this light may not cover more of the canvas than this. */
  const BRIGHT = 45;
  const MAX_BRIGHT_COVERAGE = 0.05;

  it("keeps every illustration dark enough for light text", () => {
    for (const toolId of BUNDLED_ART_TOOL_IDS) {
      const svg = bundledCardArtSvg(toolId, THEME) ?? "";
      expect(meanLightness(svg), toolId).toBeLessThanOrEqual(
        MAX_MEAN_LIGHTNESS,
      );
    }
  });

  it("keeps them dark under a neutral theme too", () => {
    for (const toolId of BUNDLED_ART_TOOL_IDS) {
      const svg = bundledCardArtSvg(toolId, GREY) ?? "";
      expect(meanLightness(svg), toolId).toBeLessThanOrEqual(
        MAX_MEAN_LIGHTNESS,
      );
    }
  });

  it("holds the procedural floor to the same threshold", () => {
    // Same yardstick on art that already satisfies the contract. If this fails
    // the threshold is wrong, not the illustration.
    for (const toolId of ["warpath", "replays", "maps", "lobby", "cob"]) {
      for (const theme of [THEME, GREY, "hsl(140 62% 44%)"]) {
        const svg = proceduralCardArtSvg(toolId, theme);
        expect(meanLightness(svg), `${toolId} ${theme}`).toBeLessThanOrEqual(
          MAX_MEAN_LIGHTNESS,
        );
      }
    }
  });

  it("paints no pale panel big enough to sit under a word", () => {
    // The mean alone would let a small bright block through. Gradients are soft
    // by construction, so this looks only at flat fills.
    for (const toolId of BUNDLED_ART_TOOL_IDS) {
      const svg = bundledCardArtSvg(toolId, THEME) ?? "";
      const offenders = paintsOf(svg).filter(
        (paint) =>
          !paint.soft &&
          paint.lightness > BRIGHT &&
          paint.coverage > MAX_BRIGHT_COVERAGE,
      );
      expect(offenders, toolId).toEqual([]);
    }
  });

  it("draws filled art only with shapes the checker can measure", () => {
    // A filled <path> is unmeasurable, so the checker assumes the worst of it
    // and the numbers above stop meaning anything. Paths must be stroked.
    for (const toolId of BUNDLED_ART_TOOL_IDS) {
      const svg = bundledCardArtSvg(toolId, THEME) ?? "";
      const filled = paintsOf(svg).filter((paint) => paint.unmeasurable);
      expect(filled, toolId).toEqual([]);
    }
  });
});

/** Geometry the checker dropped, kept only so a failure names the shape. */
interface Paint {
  /** Fraction of the canvas this paint covers, its alpha included. */
  coverage: number;
  /** HSL lightness of the colour, 0 to 100. */
  lightness: number;
  /** True when the colour came from a gradient, so it fades rather than sits. */
  soft: boolean;
  /** True when the shape's area could not be computed and was assumed full. */
  unmeasurable: boolean;
}

const CANVAS = 320 * 200;

/**
 * Every paint in the drawing, in document order. Fills and strokes both count:
 * a stroke's area is its estimated length times its width, so a hairline grid
 * costs almost nothing while a fat bright sweep costs what it should.
 */
function paintsOf(svg: string): Paint[] {
  const gradients = readGradients(svg);
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/, "");
  const paints: Paint[] = [];
  // Attributes inherit down `<g>`, so carry a stack of the enclosing groups.
  const stack: Record<string, string>[] = [{}];

  for (const match of body.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, closing, name, rawAttrs, selfClosing] = match;
    if (closing) {
      if (name === "g") stack.pop();
      continue;
    }
    const attrs = { ...stack[stack.length - 1], ...readAttrs(rawAttrs) };
    if (name === "g") {
      if (!selfClosing) stack.push(attrs);
      continue;
    }
    const geometry = measure(name, attrs);
    if (!geometry) continue;

    const fill = paintFor(attrs.fill, attrs["fill-opacity"], gradients);
    if (fill) {
      const area = Math.min(geometry.area, fill.area ?? geometry.area);
      paints.push({
        coverage: Math.min(1, area / CANVAS) * fill.alpha,
        lightness: fill.lightness,
        soft: fill.soft,
        unmeasurable: geometry.unmeasurable,
      });
    }

    const stroke = paintFor(attrs.stroke, attrs["stroke-opacity"], gradients);
    if (stroke && geometry.length > 0) {
      const width = Number(attrs["stroke-width"] ?? 1);
      paints.push({
        coverage:
          Math.min(1, (geometry.length * width) / CANVAS) * stroke.alpha,
        lightness: stroke.lightness,
        soft: stroke.soft,
        // A stroke's ink is bounded by its length, so a path is measurable here
        // even though its interior is not.
        unmeasurable: false,
      });
    }
  }
  return paints;
}

/** What a card would average, compositing every paint in order over black. */
function meanLightness(svg: string): number {
  let mean = 0;
  for (const paint of paintsOf(svg)) {
    mean = mean * (1 - paint.coverage) + paint.lightness * paint.coverage;
  }
  return mean;
}

/** Area and outline length of one shape, or null when it paints nothing. */
function measure(
  name: string,
  attrs: Record<string, string>,
): { area: number; length: number; unmeasurable: boolean } | null {
  const n = (key: string, fallback = 0) => Number(attrs[key] ?? fallback);
  switch (name) {
    case "rect": {
      const [w, h] = [n("width"), n("height")];
      return { area: w * h, length: 2 * (w + h), unmeasurable: false };
    }
    case "circle": {
      const r = n("r");
      return {
        area: Math.PI * r * r,
        length: 2 * Math.PI * r,
        unmeasurable: false,
      };
    }
    case "ellipse": {
      const [a, b] = [n("rx"), n("ry")];
      // Ramanujan's approximation, well inside the tolerance of an ink budget.
      const length =
        Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
      return { area: Math.PI * a * b, length, unmeasurable: false };
    }
    case "polygon": {
      const points = pairs(attrs.points ?? "");
      return {
        area: shoelace(points),
        length: points.length ? chainLength([...points, points[0]]) : 0,
        unmeasurable: false,
      };
    }
    case "path": {
      const points = pairs(attrs.d ?? "");
      // The control polygon is at least as long as the curve it steers, so a
      // stroke's ink is over-counted rather than under-counted. The interior is
      // not computable at all, so a filled path is charged the whole canvas.
      return { area: CANVAS, length: chainLength(points), unmeasurable: true };
    }
    default:
      return null;
  }
}

/** Colour and alpha of one paint attribute, or null when nothing is painted. */
function paintFor(
  value: string | undefined,
  opacity: string | undefined,
  gradients: Map<string, Gradient>,
): { lightness: number; alpha: number; soft: boolean; area?: number } | null {
  if (!value || value === "none") return null;
  const ref = /^url\(#(.+)\)$/.exec(value);
  if (ref) {
    const gradient = gradients.get(ref[1]);
    if (!gradient) return null;
    return { ...gradient, soft: true };
  }
  const lightness = lightnessOf(value);
  if (lightness == null) return null;
  return {
    lightness,
    alpha: opacity == null ? 1 : Number(opacity),
    soft: false,
  };
}

interface Gradient {
  lightness: number;
  alpha: number;
  /** Bound on the area a radial gradient can paint. Linear ones fill the shape. */
  area?: number;
}

/**
 * Gradients keyed by id.
 *
 * A radial gradient falling from a peak at the centre to nothing at its radius
 * averages a third of that peak over the disc it covers, and paints nothing
 * outside it, so it is charged for a disc rather than for the rect carrying it.
 * A linear gradient is uniform across the shape and is charged for all of it.
 */
function readGradients(svg: string): Map<string, Gradient> {
  const out = new Map<string, Gradient>();
  const pattern =
    /<(linear|radial)Gradient id="([^"]+)"([^>]*)>([\s\S]*?)<\/\1Gradient>/g;
  for (const [, kind, id, attrs, stops] of svg.matchAll(pattern)) {
    const parsed = [...stops.matchAll(/<stop([^>]*)\/>/g)].map((m) => {
      const stop = readAttrs(m[1]);
      return {
        lightness: lightnessOf(stop["stop-color"] ?? "") ?? 0,
        alpha: stop["stop-opacity"] == null ? 1 : Number(stop["stop-opacity"]),
      };
    });
    if (parsed.length === 0) continue;
    const total = parsed.reduce((sum, s) => sum + s.alpha, 0);
    const lightness =
      total > 0
        ? parsed.reduce((sum, s) => sum + s.lightness * s.alpha, 0) / total
        : parsed[0].lightness;
    if (kind === "radial") {
      const r = Number(readAttrs(attrs).r ?? 0);
      const peak = Math.max(...parsed.map((s) => s.alpha));
      out.set(id, { lightness, alpha: peak / 3, area: Math.PI * r * r });
    } else {
      out.set(id, { lightness, alpha: total / parsed.length });
    }
  }
  return out;
}

/** The lightness of an `hsl(h s% l%)` colour, or null for anything else. */
function lightnessOf(colour: string): number | null {
  const match = /^hsl\([\d.-]+ [\d.]+% ([\d.]+)%\)$/.exec(colour.trim());
  return match ? Number(match[1]) : null;
}

function readAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, key, value] of raw.matchAll(/([\w-]+)="([^"]*)"/g)) {
    out[key] = value;
  }
  return out;
}

/** Coordinate pairs in the order they appear, ignoring path command letters. */
function pairs(source: string): [number, number][] {
  const numbers = [...source.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    out.push([numbers[i], numbers[i + 1]]);
  }
  return out;
}

function chainLength(points: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    );
  }
  return total;
}

function shoelace(points: [number, number][]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

/** The markup with every colour removed, so two themes can be compared. */
function strip(svg: string | undefined): string {
  return (svg ?? "").replace(/hsl\([^)]*\)/g, "colour");
}

/** The markup with its gradient id namespace removed, so two tools compare. */
function anonymise(svg: string, toolId: string): string {
  return svg.split(toolId.replace(/[^a-z0-9]+/gi, "-")).join("NS");
}
