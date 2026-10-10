import {
  HEAT_ALPHA_MAX,
  HEAT_ALPHA_MIN,
  HEAT_RAMPS,
  type HeatKind,
} from "@/lib/heatRamp";
import {
  type HeatLayerId,
  LAYER_LABEL,
  layerEvents,
  type MatchWindow,
  matchCount,
  NORMALISE_LABEL,
  type Normalise,
  windowLabel,
} from "./mapAggregate";
import type { MapExportInfo } from "./mapAggregateExport";

/**
 * The picture of a map as an image to post (#1165).
 *
 * Everything that can be worked out without a canvas is here as a function of
 * numbers and text: the size, the layout, the words, the wrapping. The drawing
 * is a short list of calls over that layout, and it is tested against a
 * recording context. Nothing in this file has been looked at as pixels by a
 * person, and `docs/replay-data-sources.md` says so.
 */

/**
 * The longest side of the map in the image, in pixels, when the minimap is
 * larger. A limit on the size of the file and of what crosses to the save
 * command as a list of numbers, not a measured limit of anything.
 */
export const MAX_MAP_SIDE = 2048;

/**
 * The narrowest the image is. A tall, thin map would otherwise leave a text
 * panel a few words wide, so the map is centred on a panel of at least this.
 */
export const MIN_IMAGE_WIDTH = 720;

/** The width the page draws the map's box at: `max-w-sm`, 24rem at 16px. The
 *  marks are sized for it and scaled up with the map. */
const PAGE_MAP_WIDTH = 384;

/** What the page does to the minimap: `brightness-[0.7]`. A black layer at
 *  alpha 0.3 gives the same colours without needing `ctx.filter`. */
export const MINIMAP_DIM_ALPHA = 0.3;

const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Colours that do not follow the app's theme, so a picture is the same
 *  whichever theme made it. `image.test.ts` measures their contrast. */
export const IMAGE_COLOURS = {
  panel: "#ffffff",
  title: "#111827",
  body: "#374151",
  small: "#4b5563",
  /** What the heat ramp's bar is drawn over, as the page's legend does. */
  rampBackdrop: "#737373",
  /** A start position's number: white on this. */
  markFill: "#1e3a8a",
  markText: "#ffffff",
  labelFill: "rgba(0, 0, 0, 0.7)",
  labelText: "#ffffff",
  dotFill: "rgba(255, 255, 255, 0.8)",
  dotEdge: "rgba(0, 0, 0, 0.8)",
  mapBackdrop: "#1f2937",
} as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The map's size in the image. Its longer side is the minimap's longer side, so
 * the minimap is never enlarged, and at most {@link MAX_MAP_SIDE}. The other
 * side follows the map's own shape, as the page's box does: a minimap is
 * square, and the page stretches it to the map.
 */
export function mapPixelSize(
  world: { worldWidth: number; worldHeight: number },
  minimap: { width: number; height: number },
): { width: number; height: number } {
  const longest = Math.min(
    Math.max(Math.floor(minimap.width), Math.floor(minimap.height), 1),
    MAX_MAP_SIDE,
  );
  const wide = world.worldWidth >= world.worldHeight;
  const ratio = wide
    ? world.worldHeight / world.worldWidth
    : world.worldWidth / world.worldHeight;
  const short = Math.max(
    1,
    Math.round(longest * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1)),
  );
  return wide
    ? { width: longest, height: short }
    : { width: short, height: longest };
}

/** Break `text` into lines no wider than `max` by `measure`. Words stay whole
 *  unless one alone is wider than a line, and then it is cut between letters. */
export function wrapText(
  text: string,
  max: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  let line = "";
  const push = () => {
    if (line) lines.push(line);
    line = "";
  };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= max) {
      line = next;
      continue;
    }
    push();
    if (measure(word) <= max) {
      line = word;
      continue;
    }
    // A word wider than the line: as many characters as fit, then on.
    let piece = "";
    for (const ch of Array.from(word)) {
      if (piece && measure(piece + ch) > max) {
        lines.push(piece);
        piece = "";
      }
      piece += ch;
    }
    line = piece;
  }
  push();
  return lines;
}

/** `text` cut to fit `max`, with an ellipsis when it was cut. */
export function fitText(
  text: string,
  max: number,
  measure: (text: string) => number,
): string {
  if (measure(text) <= max) return text;
  const chars = Array.from(text);
  while (chars.length > 0 && measure(`${chars.join("")}…`) > max) chars.pop();
  return `${chars.join("")}…`;
}

// ---- the words --------------------------------------------------------------

export type TextRole = "title" | "layer" | "body" | "small";

export interface TextBlock {
  role: TextRole;
  text: string;
}

export interface ImageWords {
  info: MapExportInfo;
  /** The layer being drawn. */
  layer: HeatLayerId;
  /** What the layer counts, as the legend names it: "Where buildings were
   *  ordered". */
  layerSentence: string;
  /** {@link layerLegend}'s sentence for the brightest spot. */
  legend: string;
  normalise: Normalise;
  window: MatchWindow;
  /** Matches with something on this layer in the window. */
  contributing: number;
  events: number;
  /** The app's version, or null when it could not be read. */
  appVersion: string | null;
  /** Whether start marks are drawn. */
  marks: boolean;
}

/** The filters in force as one sentence. */
export function filtersSentence(info: MapExportInfo): string {
  const f = info.filters;
  const parts = [f.players, f.sides, f.analysed];
  if (f.playedFrom) parts.push(`played from ${f.playedFrom}`);
  if (f.playedUntil) parts.push(`played until ${f.playedUntil}`);
  if (f.replaySet) parts.push(`replay set ${f.replaySet}`);
  parts.push(
    f.includesShort
      ? "matches under a minute included"
      : "matches under a minute left out",
  );
  return `${parts.join(", ")}.`;
}

/**
 * Everything the image says in words, in the order it is read. The text of the
 * legend's colour bar is drawn beside the bar and is not here.
 *
 * The date is the day of the export, because the picture is made from a library
 * that grows: the same filters give a different picture a month on, and the
 * date is what says which.
 */
export function imageBlocks(w: ImageWords): TextBlock[] {
  const { info } = w;
  const windowed = w.window.kind !== "whole";
  const inWindow = windowed ? ` in ${windowLabel(w.window)}` : "";
  const some = w.contributing === 1 ? "has" : "have";
  const blocks: TextBlock[] = [
    { role: "title", text: info.mapName },
    {
      role: "layer",
      text: `${LAYER_LABEL[w.layer]}. ${w.layerSentence}.`,
    },
    { role: "body", text: `Brightest spot: ${w.legend}.` },
    {
      role: "body",
      text: `Replays: ${matchCount(info.matches)} of this map. ${w.contributing.toLocaleString()} ${some} something on this layer, ${layerEvents(w.layer, w.events)}${inWindow}.`,
    },
    {
      role: "body",
      text: windowed
        ? `Time window: ${windowLabel(w.window)} of each match, by its own clock.`
        : "Time window: the whole match.",
    },
    { role: "body", text: `Scaling: ${NORMALISE_LABEL[w.normalise]}.` },
    {
      role: "body",
      text: `Map ${info.mapVersions.length === 1 ? "version" : "versions"}: ${info.mapVersions.join("; ")}.`,
    },
    {
      role: "body",
      text: `Game and ${info.gameVersions.length === 1 ? "version" : "versions"}: ${info.gameVersions.join("; ")}.`,
    },
    { role: "body", text: `Filters: ${filtersSentence(info)}` },
  ];
  if (w.marks)
    blocks.push({
      role: "small",
      text: "White dots are where one team's start was set before one match. Numbered circles are start positions the matches share.",
    });
  blocks.push({
    role: "small",
    text: `Colours compare places on this map with each other, not with another picture. Made with coilbox${w.appVersion ? ` ${w.appVersion}` : ""} on ${info.exportedUtc.slice(0, 10)}.`,
  });
  return blocks;
}

// ---- the layout -------------------------------------------------------------

export interface TextLine {
  text: string;
  font: string;
  colour: string;
  x: number;
  /** The baseline, from the top of the image. */
  y: number;
}

export interface ImageLayout {
  width: number;
  height: number;
  map: Rect;
  panel: Rect;
  /** The ramp's bar, in the panel. */
  bar: Rect;
  /** The words beside the bar and the lines under it. */
  lines: TextLine[];
  /** Pixels in the page's box per pixel here, for the size of the marks. */
  markScale: number;
}

const SIZE: Record<TextRole, number> = {
  title: 30,
  layer: 22,
  body: 19,
  small: 16,
};
const BOLD: Record<TextRole, boolean> = {
  title: true,
  layer: true,
  body: false,
  small: false,
};
const COLOUR: Record<TextRole, string> = {
  title: IMAGE_COLOURS.title,
  layer: IMAGE_COLOURS.title,
  body: IMAGE_COLOURS.body,
  small: IMAGE_COLOURS.small,
};
const LINE_HEIGHT = 1.35;

/** The ramp goes after the title and the layer's line, the first two blocks. */
const RAMP_AFTER = 2;

/** The font string for a role at an image `scale`, which is the image's width
 *  over 1024. */
export function fontFor(role: TextRole, scale: number): string {
  return `${BOLD[role] ? "bold " : ""}${Math.round(SIZE[role] * scale)}px ${FONT_STACK}`;
}

/**
 * Where everything goes. `measure` returns the width of text in a CSS font
 * string, so the same function can be a canvas's `measureText` or a fake.
 *
 * The map is at the top, centred when the image is wider than the map. The
 * panel is under it, the full width of the image, so no text is ever over the
 * map. The text wraps to the panel's width less its padding, and the image is
 * as tall as the text needs.
 */
export function layoutImage(
  map: { width: number; height: number },
  blocks: readonly TextBlock[],
  measure: (text: string, font: string) => number,
): ImageLayout {
  const width = Math.max(map.width, MIN_IMAGE_WIDTH);
  const scale = width / 1024;
  const pad = Math.round(24 * scale);
  const inner = width - pad * 2;
  const mapRect: Rect = {
    x: Math.round((width - map.width) / 2),
    y: 0,
    w: map.width,
    h: map.height,
  };

  const lines: TextLine[] = [];
  let y = map.height + pad;

  // The ramp: "Least", the bar, "Most", on one row.
  const small = fontFor("small", scale);
  const smallPx = Math.round(SIZE.small * scale);
  const barH = Math.round(18 * scale);
  const gap = Math.round(10 * scale);
  const least = measure("Least", small);
  const most = measure("Most", small);
  const barW = Math.min(
    Math.round(260 * scale),
    inner - least - most - gap * 2,
  );
  const rowH = Math.max(barH, smallPx);
  let bar: Rect = { x: pad, y: 0, w: 0, h: barH };
  const placeRamp = () => {
    bar = {
      x: pad + least + gap,
      y: y + Math.round((rowH - barH) / 2),
      w: Math.max(0, barW),
      h: barH,
    };
    const baseline = y + Math.round((rowH + smallPx * 0.7) / 2);
    const word = (text: string, x: number): TextLine => ({
      text,
      font: small,
      colour: IMAGE_COLOURS.small,
      x,
      y: baseline,
    });
    lines.push(word("Least", pad), word("Most", bar.x + bar.w + gap));
    y += rowH + Math.round(SIZE.small * scale * 0.35);
  };

  blocks.forEach((block, i) => {
    if (i === RAMP_AFTER) placeRamp();
    const font = fontFor(block.role, scale);
    const px = Math.round(SIZE[block.role] * scale);
    const step = Math.round(px * LINE_HEIGHT);
    for (const text of wrapText(block.text, inner, (t) => measure(t, font))) {
      lines.push({
        text,
        font,
        colour: COLOUR[block.role],
        x: pad,
        y: y + px,
      });
      y += step;
    }
    y += Math.round(px * 0.35);
  });
  if (blocks.length < RAMP_AFTER) placeRamp();

  const height = Math.max(Math.ceil(y + pad), map.height + pad * 2);
  return {
    width,
    height,
    map: mapRect,
    panel: { x: 0, y: map.height, w: width, h: height - map.height },
    bar,
    lines,
    markScale: map.width / PAGE_MAP_WIDTH,
  };
}

// ---- the drawing ------------------------------------------------------------

/** A start mark's place on the map, 0 to 1 from the left and from the top. */
export interface MarkPlace {
  left: number;
  top: number;
  n?: number;
  name?: string | null;
}

export interface ImageParts {
  /** The minimap, or null to draw the map's area plain. Must come from bytes
   *  the page owns: see {@link loadMinimap}. */
  minimap: CanvasImageSource | null;
  /** The heat field, painted one pixel a cell. */
  field: CanvasImageSource;
  /** The layer's ramp, which the colour bar is drawn in. */
  kind: HeatKind;
  dots: readonly MarkPlace[];
  places: readonly MarkPlace[];
}

/** The part of a 2D context the drawing uses, so a test can record it. */
export type Draw2D = Pick<
  CanvasRenderingContext2D,
  | "fillRect"
  | "drawImage"
  | "fillText"
  | "beginPath"
  | "arc"
  | "fill"
  | "stroke"
  | "measureText"
  | "createLinearGradient"
> &
  Pick<
    CanvasRenderingContext2D,
    | "fillStyle"
    | "strokeStyle"
    | "lineWidth"
    | "font"
    | "textAlign"
    | "textBaseline"
    | "imageSmoothingEnabled"
    | "imageSmoothingQuality"
  >;

/** The ramp as a gradient on `ctx`, least at the bar's left, with the page's
 *  opacity rising along it. */
function rampGradient(ctx: Draw2D, bar: Rect, kind: HeatKind): CanvasGradient {
  const gradient = ctx.createLinearGradient(bar.x, 0, bar.x + bar.w, 0);
  const ramp = HEAT_RAMPS[kind];
  const stops = ramp.length - 1;
  ramp.forEach((hex, i) => {
    const t = i / stops;
    const alpha = HEAT_ALPHA_MIN + (HEAT_ALPHA_MAX - HEAT_ALPHA_MIN) * t;
    const n = Number.parseInt(hex.slice(1), 16);
    gradient.addColorStop(
      t,
      `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha.toFixed(2)})`,
    );
  });
  return gradient;
}

/**
 * Draw the image: the panel, the map, its dimming, the field, the marks, the
 * ramp and the words, in that order. Nothing is drawn over the map after the
 * marks, and no text over it but the marks' own labels.
 */
export function drawMapImage(
  ctx: Draw2D,
  layout: ImageLayout,
  parts: ImageParts,
) {
  const { map } = layout;
  ctx.fillStyle = IMAGE_COLOURS.panel;
  ctx.fillRect(0, 0, layout.width, layout.height);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (parts.minimap) {
    ctx.drawImage(parts.minimap, map.x, map.y, map.w, map.h);
    ctx.fillStyle = `rgba(0, 0, 0, ${MINIMAP_DIM_ALPHA})`;
    ctx.fillRect(map.x, map.y, map.w, map.h);
  } else {
    ctx.fillStyle = IMAGE_COLOURS.mapBackdrop;
    ctx.fillRect(map.x, map.y, map.w, map.h);
  }
  ctx.drawImage(parts.field, map.x, map.y, map.w, map.h);

  const s = layout.markScale;
  for (const dot of parts.dots) {
    ctx.beginPath();
    ctx.arc(
      map.x + dot.left * map.w,
      map.y + dot.top * map.h,
      4 * s,
      0,
      2 * Math.PI,
    );
    ctx.fillStyle = IMAGE_COLOURS.dotFill;
    ctx.fill();
    ctx.strokeStyle = IMAGE_COLOURS.dotEdge;
    ctx.lineWidth = Math.max(1, s);
    ctx.stroke();
  }
  for (const place of parts.places) drawPlace(ctx, layout, place);

  ctx.fillStyle = IMAGE_COLOURS.rampBackdrop;
  ctx.fillRect(layout.bar.x, layout.bar.y, layout.bar.w, layout.bar.h);
  ctx.fillStyle = rampGradient(ctx, layout.bar, parts.kind);
  ctx.fillRect(layout.bar.x, layout.bar.y, layout.bar.w, layout.bar.h);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const line of layout.lines) {
    ctx.font = line.font;
    ctx.fillStyle = line.colour;
    ctx.fillText(line.text, line.x, line.y);
  }
}

/** A numbered circle, and its name beside it when the player gave one. The
 *  name goes to the left of the circle when the right would leave the map. */
function drawPlace(ctx: Draw2D, layout: ImageLayout, place: MarkPlace) {
  const { map } = layout;
  const s = layout.markScale;
  const cx = map.x + place.left * map.w;
  const cy = map.y + place.top * map.h;
  const r = 10 * s;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = IMAGE_COLOURS.markFill;
  ctx.fill();
  ctx.strokeStyle = IMAGE_COLOURS.markText;
  ctx.lineWidth = Math.max(1, s);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(10 * s)}px ${FONT_STACK}`;
  ctx.fillStyle = IMAGE_COLOURS.markText;
  ctx.fillText(String(place.n ?? ""), cx, cy);

  if (!place.name) return;
  const size = Math.round(10 * s);
  ctx.font = `${size}px ${FONT_STACK}`;
  const room = 96 * s;
  const text = fitText(place.name, room, (t) => ctx.measureText(t).width);
  const w = ctx.measureText(text).width + 8 * s;
  const h = size * 1.5;
  const right = cx + r + 4 * s;
  const x = right + w <= map.x + map.w ? right : cx - r - 4 * s - w;
  ctx.fillStyle = IMAGE_COLOURS.labelFill;
  ctx.fillRect(x, cy - h / 2, w, h);
  ctx.fillStyle = IMAGE_COLOURS.labelText;
  ctx.textAlign = "left";
  ctx.fillText(text, x + 4 * s, cy);
}

// ---- making the file --------------------------------------------------------

/**
 * The minimap as an image a canvas can be saved with.
 *
 * The page shows the minimap from a `coilbox://` URL. An `<img>` of that URL
 * draws, but it taints any canvas it is drawn on, and a tainted canvas throws
 * from `toBlob`. The scheme answers with `Access-Control-Allow-Origin: *`
 * (`src-tauri/src/asset_protocol.rs`), so `fetch` can read the bytes, and a
 * bitmap made from a Blob is the page's own and taints nothing. A `data:` URL,
 * which the app falls back to when the render did not reach disk, takes the
 * same route.
 */
export async function loadMinimap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      `The minimap could not be read: ${response.status} ${response.statusText}`.trim(),
    );
  return createImageBitmap(await response.blob());
}

/** A canvas as PNG bytes. */
export function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The picture could not be encoded as a PNG."));
        return;
      }
      blob
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, "image/png");
  });
}
