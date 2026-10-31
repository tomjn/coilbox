import { t } from "@lingui/core/macro";
import { formatDuration } from "@/lib/format";
import { readableTeamTextColor } from "@/lib/teamColor";
import type { DemoInfo, Metric } from "./bindings";
import { FONT_STACK, fitText, IMAGE_COLOURS, wrapText } from "./mapImage";
import {
  type ChartMode,
  type ChartRow,
  type ChartSeries,
  type ChartView,
  END_LABEL_MAX_SERIES,
  endPoints,
  formatChartValue,
  formatRate,
  spreadLabels,
} from "./matchStats";
import { slug, startedAt } from "./matchStatsCsv";

/**
 * The match statistics chart as a picture that says what it is of (#3836).
 *
 * The picture is an SVG string built here from the series and rows the chart
 * draws, with the caption written into it, so the file carries its own context
 * when it is posted somewhere with none. Everything is a function of the input
 * and a text measuring function, which keeps it testable in node. Turning the
 * SVG into a PNG is `matchStatsImageExport.ts`.
 *
 * It is a separate drawing and not a copy of the live chart's SVG. The live
 * chart draws wide transparent hit lines, a halo and dimmed lines for whatever
 * is hovered or selected, and takes its tick colours from `currentColor`. This
 * draws every line the same, with concrete colours, so a hover on screen never
 * reaches the file.
 *
 * The look is fixed, white with dark text and the lines coloured for a light
 * card, the way the map picture is, so it reads the same wherever it is posted
 * and whichever theme the app was in.
 */

export interface MatchStatsImageInput {
  info: DemoInfo;
  metric: Metric;
  mode: ChartMode;
  view: ChartView;
  /** The lines to draw, coloured for a light card. */
  series: ChartSeries[];
  /** {@link modeRows} over `series`, for the same metric and mode. */
  rows: ChartRow[];
}

/** Width of `text` in pixels when drawn with the CSS `font` shorthand. */
export type Measure = (text: string, font: string) => number;

export interface MatchStatsImage {
  svg: string;
  width: number;
  height: number;
}

export interface CaptionFact {
  label: string;
  value: string;
}

export interface MatchStatsCaption {
  /** The metric, which is what the chart is of. */
  title: string;
  /** Map, date, players, view, value mode and game id, in that order. A fact the
   * replay has no answer for is left out and not written as a blank. */
  facts: CaptionFact[];
}

const WIDTH = 1200;
const MARGIN = 24;
const PLOT_HEIGHT = 360;
const Y_AXIS_WIDTH = 56;
/** Room right of the plot for the end point labels. */
const END_LABEL_GUTTER = 120;
const FACT_GAP = 12;
const FACT_LINE = 18;
const LEGEND_ROW = 20;
const LEGEND_LABEL_MAX = 220;
const LEGEND_ENTRY_GAP = 20;
const END_LABEL_GAP = 14;
const LEADER_THRESHOLD = 2;
const LINE_WIDTH = 2;
const GRID = "#e5e7eb";

const font = (size: number, weight: 400 | 700 = 400) =>
  `${weight} ${size}px ${FONT_STACK}`;
const FACT_FONT = font(13);
const TICK_FONT = font(11);
const LEGEND_FONT = font(12);

/** The seats of each side, sides in ally team order, bots by their short name. */
function sideNames(info: DemoInfo): string[][] {
  const sides = new Map<string, { order: number; names: string[] }>();
  const add = (
    ally: number | undefined,
    team: number | undefined,
    name: string,
  ) => {
    // A seat with no side stands alone, as the chart's own lines do.
    const key = ally !== undefined ? `a${ally}` : `t${team ?? name}`;
    const side = sides.get(key) ?? {
      order: ally ?? Number.MAX_SAFE_INTEGER,
      names: [],
    };
    side.names.push(name);
    sides.set(key, side);
  };
  for (const p of info.players)
    if (!p.spectator) add(p.allyTeam, p.team, p.name);
  for (const a of info.ais)
    add(a.allyTeam, a.team, a.shortName || a.name || "AI");
  return [...sides.values()]
    .sort((a, b) => a.order - b.order)
    .map((s) => s.names);
}

/** `2026-10-31 14:03 UTC`, or "" when the replay has no start time. */
function startedText(info: DemoInfo): string {
  const iso = startedAt(info);
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "";
}

/**
 * What the picture says it is of. Sides are written `A, B vs C, D`, in the
 * players view as well, because the lines there are single seats and a reader
 * still wants to know who was on whose side.
 */
export function matchStatsCaption(
  input: Pick<MatchStatsImageInput, "info" | "metric" | "mode" | "view">,
): MatchStatsCaption {
  const { info, metric, mode, view } = input;
  const all: CaptionFact[] = [
    { label: t`Map`, value: info.mapName },
    { label: t`Date`, value: startedText(info) },
    {
      label: t`Players`,
      value: sideNames(info)
        .map((names) => names.join(", "))
        .join(" vs "),
    },
    { label: t`View`, value: view === "teams" ? t`Teams` : t`Players` },
    {
      label: t`Values`,
      value: mode === "perMinute" ? t`Per minute` : t`Cumulative`,
    },
    { label: t`Game id`, value: info.gameId ?? "" },
  ];
  return { title: metric.label, facts: all.filter((f) => f.value !== "") };
}

/** A default file name from the map, the date, the metric, the view and the mode. */
export function matchStatsImageFileName(
  info: DemoInfo,
  metric: Metric,
  view: ChartView,
  mode: ChartMode,
): string {
  const date = startedAt(info).slice(0, 10);
  const parts = [
    slug(info.mapName),
    date,
    slug(metric.label),
    view,
    mode === "perMinute" ? "per-minute" : "cumulative",
  ].filter(Boolean);
  return `${parts.join("-")}.png`;
}

/**
 * Round tick values from zero, at most about `target` of them, the last at or
 * above `max`. The chart's axis is anchored at zero, so this is too.
 */
export function niceTicks(max: number, target = 5): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0, 1];
  const raw = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude;
  const count = Math.ceil(max / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

/** Candidate gaps between time ticks, in seconds. */
const TIME_STEPS = [10, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200];
const MAX_TIME_TICKS = 8;

/** Match times to label on the x axis, from zero. */
export function timeTicks(endSec: number): number[] {
  const step =
    TIME_STEPS.find((s) => endSec / s <= MAX_TIME_TICKS) ??
    TIME_STEPS[TIME_STEPS.length - 1];
  return Array.from(
    { length: Math.floor(endSec / step) + 1 },
    (_, i) => i * step,
  );
}

/** XML text with the characters XML 1.0 forbids dropped, so a player's name can
 * never stop the browser decoding the picture. */
function esc(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const forbidden =
      (code < 0x20 && code !== 9 && code !== 10 && code !== 13) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff;
    if (forbidden) continue;
    out +=
      ch === "&"
        ? "&amp;"
        : ch === "<"
          ? "&lt;"
          : ch === ">"
            ? "&gt;"
            : ch === '"'
              ? "&quot;"
              : ch;
  }
  return out;
}

const num = (v: number) => String(Math.round(v * 10) / 10);

function textEl(
  x: number,
  y: number,
  content: string,
  o: {
    size: number;
    fill: string;
    weight?: 400 | 700;
    anchor?: "start" | "end" | "middle";
  },
): string {
  return `<text x="${num(x)}" y="${num(y)}" font-family="${esc(FONT_STACK)}" font-size="${o.size}" font-weight="${o.weight ?? 400}" text-anchor="${o.anchor ?? "start"}" fill="${o.fill}">${esc(content)}</text>`;
}

/** One line's path. A gap in its values lifts the pen, so a team that stopped
 * being recorded stops having a line. */
function linePath(
  rows: ChartRow[],
  id: string,
  x: (sec: number) => number,
  y: (value: number) => number,
): string {
  let d = "";
  let down = false;
  for (const row of rows) {
    const value = row[id];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      down = false;
      continue;
    }
    d += `${down ? "L" : "M"}${num(x(row.timeSec))} ${num(y(value))}`;
    down = true;
  }
  return d;
}

/** Legend entries flowed left to right and wrapped, below the plot. */
function legend(
  series: ChartSeries[],
  top: number,
  measure: Measure,
): { svg: string; height: number } {
  const maxX = WIDTH - MARGIN;
  let x = MARGIN;
  let row = 0;
  let svg = "";
  for (const s of series) {
    const label = fitText(s.label, LEGEND_LABEL_MAX, (text) =>
      measure(text, LEGEND_FONT),
    );
    const entryWidth = 12 + 6 + measure(label, LEGEND_FONT);
    if (x > MARGIN && x + entryWidth > maxX) {
      x = MARGIN;
      row++;
    }
    const y = top + row * LEGEND_ROW;
    svg += `<rect data-legend="${esc(s.id)}" x="${num(x)}" y="${num(y)}" width="12" height="12" rx="2" fill="${esc(s.color)}"/>`;
    svg += textEl(x + 18, y + 10, label, {
      size: 12,
      fill: IMAGE_COLOURS.body,
    });
    x += entryWidth + LEGEND_ENTRY_GAP;
  }
  return { svg, height: series.length > 0 ? (row + 1) * LEGEND_ROW : 0 };
}

export function matchStatsImage(
  input: MatchStatsImageInput,
  measure: Measure,
): MatchStatsImage {
  const { series, rows, mode } = input;
  const format = mode === "perMinute" ? formatRate : formatChartValue;
  const caption = matchStatsCaption(input);
  const labelled = series.length <= END_LABEL_MAX_SERIES;
  let body = "";

  // Caption.
  let y = MARGIN + 22;
  body += textEl(MARGIN, y, caption.title, {
    size: 22,
    weight: 700,
    fill: IMAGE_COLOURS.title,
  });
  y += 14;
  const labelWidth = Math.max(
    0,
    ...caption.facts.map((f) => measure(f.label, FACT_FONT)),
  );
  const valueX = MARGIN + labelWidth + FACT_GAP;
  for (const fact of caption.facts) {
    const lines = wrapText(fact.value, WIDTH - MARGIN - valueX, (text) =>
      measure(text, FACT_FONT),
    );
    lines.forEach((line, i) => {
      if (i === 0)
        body += textEl(MARGIN, y + 13, fact.label, {
          size: 13,
          fill: IMAGE_COLOURS.small,
        });
      body += textEl(valueX, y + 13, line, {
        size: 13,
        fill: IMAGE_COLOURS.body,
      });
      y += FACT_LINE;
    });
  }

  // Plot.
  const top = y + 20;
  const bottom = top + PLOT_HEIGHT;
  const left = MARGIN + Y_AXIS_WIDTH;
  const right = WIDTH - MARGIN - (labelled ? END_LABEL_GUTTER : 0);
  const endSec = Math.max(rows[rows.length - 1]?.timeSec ?? 0, 1);
  let peak = 0;
  for (const row of rows)
    for (const s of series) {
      const v = row[s.id];
      if (typeof v === "number" && Number.isFinite(v)) peak = Math.max(peak, v);
    }
  const yTicks = niceTicks(peak);
  const domain = yTicks[yTicks.length - 1];
  const px = (sec: number) => left + (sec / endSec) * (right - left);
  const py = (value: number) => bottom - (value / domain) * PLOT_HEIGHT;

  for (const tick of yTicks) {
    const ty = py(tick);
    body += `<line x1="${left}" x2="${right}" y1="${num(ty)}" y2="${num(ty)}" stroke="${GRID}" stroke-width="1" stroke-dasharray="3 3"/>`;
    body += textEl(left - 8, ty + 4, format(tick), {
      size: 11,
      fill: IMAGE_COLOURS.small,
      anchor: "end",
    });
  }
  for (const tick of timeTicks(endSec)) {
    body += textEl(px(tick), bottom + 18, formatDuration(tick), {
      size: 11,
      fill: IMAGE_COLOURS.small,
      anchor: "middle",
    });
  }

  body += `<clipPath id="plot"><rect x="${left}" y="${top}" width="${right - left}" height="${PLOT_HEIGHT}"/></clipPath><g clip-path="url(#plot)">`;
  for (const s of series)
    body += `<path data-series="${esc(s.id)}" d="${linePath(rows, s.id, px, py)}" fill="none" stroke="${esc(s.color)}" stroke-width="${LINE_WIDTH}" stroke-linejoin="round" stroke-linecap="round"/>`;
  body += "</g>";

  let end = bottom + 18 + 14;
  if (labelled) {
    const placed = endPoints(series, rows).map((p) => ({
      ...p,
      x: px(p.timeSec),
      y: py(p.value),
    }));
    const lineY = new Map(placed.map((p) => [p.id, p.y]));
    for (const p of spreadLabels(placed, END_LABEL_GAP, top, bottom)) {
      const from = lineY.get(p.id) ?? p.y;
      if (Math.abs(from - p.y) > LEADER_THRESHOLD)
        body += `<polyline points="${num(p.x)},${num(from)} ${num(p.x + 4)},${num(p.y)}" fill="none" stroke="${esc(p.color)}" stroke-width="1"/>`;
      const label = fitText(p.label, END_LABEL_GUTTER - 14, (text) =>
        measure(text, TICK_FONT),
      );
      body += `<text data-end-label="${esc(p.id)}" x="${num(p.x + 6)}" y="${num(p.y + 4)}" font-family="${esc(FONT_STACK)}" font-size="11" fill="${readableTeamTextColor(p.color, "light", "card")}">${esc(label)}</text>`;
    }
  } else {
    const key = legend(series, end + 8, measure);
    body += key.svg;
    end += 8 + key.height;
  }

  const height = end + MARGIN;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">` +
    `<rect width="${WIDTH}" height="${height}" fill="${IMAGE_COLOURS.panel}"/>${body}</svg>`;
  return { svg, width: WIDTH, height };
}
