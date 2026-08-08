import { isBlackHex } from "@/lib/teamColor";
import { PALETTE, rgbToHex } from "@/play/participants";
import type {
  DemoInfo,
  DemoTrailer,
  Metric,
  MetricGroup,
  MetricKey,
  TeamStatSample,
} from "./bindings";

/**
 * What the match statistics section on replay detail shows, worked out here so
 * the component only has to render it.
 *
 * Two rules run through all of it:
 *
 * - No metric is named. Which figures are headlines is a flag in the registry
 *   (`crates/tauri-plugin-coilbox-content/src/metrics.rs`), read at runtime, so
 *   this file has no list to keep in step with it.
 * - Every sample field is a running total for the match so far, so a match total
 *   is the last sample of each team's series added up, never a sum over samples.
 */

/** Seconds to `mm:ss` (or `h:mm:ss`). */
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Human-readable result line from the winning ally teams. */
export function resultLabel(info: DemoInfo): string {
  // False either because the recording never reached a game over, or because
  // its trailer is in a format coilbox doesn't read and there was no demotool
  // fallback to ask, so this doesn't name a specific reason.
  if (!info.winnersKnown) return "Unknown";
  if (info.winningAllyTeams.length === 0) return "Nobody won";
  const ids = info.winningAllyTeams.map((a) => `Ally ${a}`).join(", ");
  return `${ids} won`;
}

/** How many seats played: humans who weren't spectating, plus every bot. */
export function seatCount(info: DemoInfo): number {
  const seated = info.players.filter((p) => !p.spectator).length;
  return seated + (info.ais?.length ?? 0);
}

/**
 * Whether this replay measured anything. A recording that was aborted, or one
 * the engine never wrote statistics for, still carries a trailer: it says so by
 * giving every team an empty series.
 */
export function hasStatistics(trailer: DemoTrailer): boolean {
  return trailer.teams.some((t) => t.samples.length > 0);
}

/**
 * A team's figure for the whole match: its last sample, since every field is a
 * running total. Zero for a team the engine recorded nothing for.
 */
export function teamTotal(samples: TeamStatSample[], key: MetricKey): number {
  const last = samples.at(-1);
  return last ? last[key] : 0;
}

/** One metric summed across every team, which is what a headline tile shows. */
export function matchTotal(trailer: DemoTrailer, key: MetricKey): number {
  return trailer.teams.reduce((sum, t) => sum + teamTotal(t.samples, key), 0);
}

/** `1234567` becomes `1.2M`. A figure this size is read at a glance, not counted. */
export function formatTotal(value: number): string {
  const v = Math.round(value);
  const abs = Math.abs(v);
  const short = (divisor: number, suffix: string) => {
    const n = v / divisor;
    // One decimal, and no bare `.0`, so it reads as `12M` rather than `12.0M`.
    const text =
      Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, "");
    return `${text}${suffix}`;
  };
  if (abs >= 1_000_000) return short(1_000_000, "M");
  if (abs >= 10_000) return short(1_000, "k");
  return v.toLocaleString();
}

/**
 * A figure on the chart: on an axis tick or in the tooltip.
 *
 * Two decimals rather than {@link formatTotal}'s one, because a tick at
 * 1,050,000 labelled `1.1M` makes evenly spaced gridlines read as uneven ones.
 * Shortened from a thousand rather than ten thousand, so one axis doesn't run
 * `8,000, 16k, 24k`.
 */
export function formatChartValue(value: number): string {
  const v = Math.round(value);
  const abs = Math.abs(v);
  if (abs < 1_000) return v.toLocaleString();
  const million = abs >= 1_000_000;
  const n = v / (million ? 1_000_000 : 1_000);
  // `toFixed` always leaves a point, so trimming zeros can't eat a whole number.
  const text = n.toFixed(2).replace(/\.?0+$/, "");
  return `${text}${million ? "M" : "k"}`;
}

/** A headline tile: one registry metric, totalled across the match. */
export interface HeadlineTotal {
  metric: Metric;
  /** The raw total, for anything that wants to compare it rather than read it. */
  value: number;
  text: string;
}

/**
 * The tiles the registry asks for, in registry order. `headline` is the flag
 * that decides, so a metric promoted in `metrics.rs` appears here with no
 * frontend change at all.
 */
export function headlineTotals(
  trailer: DemoTrailer,
  metrics: Metric[],
): HeadlineTotal[] {
  return metrics
    .filter((m) => m.headline && m.surfaced)
    .map((metric) => {
      const value = matchTotal(trailer, metric.key);
      return { metric, value, text: formatTotal(value) };
    });
}

/* ---------------------------------------------------------------------------
 * The chart.
 *
 * Three steps, deliberately separate, because two of them are about to change:
 *
 *   1. which metric is plotted   -> `metricGroups` / `defaultMetric`
 *   2. which series are plotted  -> `teamSeries`, which #1138 gives an ally-side
 *      sibling: a merged series is just another `ChartSeries`
 *   3. what recharts receives    -> `chartRows`, which #1137 gives a per-minute
 *      mode: the same rows, differenced
 *
 * So the chart component composes three functions, and neither of those issues
 * has to take it apart.
 * ------------------------------------------------------------------------- */

/** What to call a group of metrics. The registry decides which groups exist. */
const GROUP_LABEL: Record<MetricGroup, string> = {
  economy: "Economy",
  military: "Military",
  units: "Units",
};

/** One heading in the metric chooser, and the metrics under it. */
export interface MetricGroupOptions {
  group: MetricGroup;
  label: string;
  metrics: Metric[];
}

/**
 * The metrics a chooser offers, grouped. Groups appear in the order the registry
 * first mentions them and metrics keep their registry order inside a group, so
 * the list is the registry's own ordering rather than a second opinion about it.
 */
export function metricGroups(metrics: Metric[]): MetricGroupOptions[] {
  const groups: MetricGroupOptions[] = [];
  for (const m of metrics) {
    if (!m.surfaced) continue;
    let group = groups.find((g) => g.group === m.group);
    if (!group) {
      group = { group: m.group, label: GROUP_LABEL[m.group], metrics: [] };
      groups.push(group);
    }
    group.metrics.push(m);
  }
  return groups;
}

/**
 * Which metric the chart opens on: the first headline the registry publishes,
 * because that is already the figure the tiles above the chart lead with.
 * Undefined only when the registry offers nothing at all.
 */
export function defaultMetric(metrics: Metric[]): Metric | undefined {
  const offered = metrics.filter((m) => m.surfaced);
  return offered.find((m) => m.headline) ?? offered[0];
}

/** One line on the chart: who it is, what colour, and its samples. */
export interface ChartSeries {
  /** The recharts `dataKey`, unique within one chart. */
  id: string;
  /** What the legend, the end-point label and the tooltip call it. */
  label: string;
  /** `#rrggbb`. recharts renders SVG and can't read a CSS custom property. */
  color: string;
  samples: TeamStatSample[];
}

/** The palette a team with no recorded colour falls back to, as hex. */
const FALLBACK_COLORS = PALETTE.map(rgbToHex);

/**
 * A seat's colour as recharts needs it. The replay carries play's float RGB, so
 * this goes through the shared converter rather than reading the channels here.
 * A team recorded as black gets a palette colour instead, because black is the
 * protocol's "nobody chose" default and an invisible line reads nothing.
 */
function seriesColor(rgb: [number, number, number] | undefined, team: number) {
  const hex = rgb ? rgbToHex(rgb) : null;
  return hex && !isBlackHex(hex)
    ? hex
    : FALLBACK_COLORS[team % FALLBACK_COLORS.length];
}

/** Every seat that played, by the team it held: people first, then the bots. */
function seatsByTeam(info: DemoInfo) {
  const seats = new Map<
    number,
    { name: string; rgbColor?: [number, number, number] }[]
  >();
  const add = (
    team: number | undefined,
    name: string,
    rgbColor?: [number, number, number],
  ) => {
    if (team === undefined) return;
    const held = seats.get(team);
    if (held) held.push({ name, rgbColor });
    else seats.set(team, [{ name, rgbColor }]);
  };
  for (const p of info.players)
    if (!p.spectator) add(p.team, p.name, p.rgbColor);
  // A bot is named by its `shortName`. The recorded `name` is usually a slot
  // number, and two unrelated matches both have an "AI 1".
  for (const a of info.ais)
    add(a.team, a.shortName || a.name || "AI", a.rgbColor);
  return seats;
}

/**
 * One line per team the engine actually measured. A team with no samples is left
 * out rather than drawn flat at zero, which would claim a reading the file
 * doesn't have.
 *
 * When #1138 lands, its ally-side view is a second function shaped like this
 * one: the sides' samples added together, since every field is a running total.
 */
export function teamSeries(
  trailer: DemoTrailer,
  info: DemoInfo,
): ChartSeries[] {
  const seats = seatsByTeam(info);
  return trailer.teams
    .filter((t) => t.samples.length > 0)
    .map((t) => {
      const held = seats.get(t.team) ?? [];
      const first = held[0];
      // Shared control puts several seats on one team, and one line covers them
      // all, so the label says whose line it also is rather than dropping them.
      const extra = held.length > 1 ? ` +${held.length - 1}` : "";
      return {
        id: `team${t.team}`,
        label: first ? `${first.name}${extra}` : `Team ${t.team}`,
        color: seriesColor(first?.rgbColor, t.team),
        samples: t.samples,
      };
    });
}

/** The engine's simulation rate, used only when the trailer can't be measured. */
const SIM_HZ = 30;

/**
 * How many seconds one sim frame is, worked out from the trailer rather than
 * assumed: consecutive samples are `teamStatPeriodSec` apart, so the frames
 * between them give the rate. Falls back to the engine's fixed 30 Hz for a
 * trailer with a single sample or no period recorded.
 */
export function secondsPerFrame(trailer: DemoTrailer): number {
  const measured = trailer.teams.find((t) => t.samples.length > 1);
  const step = measured
    ? measured.samples[1].frame - measured.samples[0].frame
    : 0;
  const period = trailer.teamStatPeriodSec;
  return step > 0 && period > 0 ? period / step : 1 / SIM_HZ;
}

/** One x position on the chart: a match time, and every series' value there. */
export interface ChartRow {
  /** Match time in seconds. */
  timeSec: number;
  /** Null before a series' first sample and after its last, so a team that
   * stopped being recorded stops having a line instead of running on flat. */
  [seriesId: string]: number | null;
}

/**
 * What recharts plots: the union of every series' sample frames, each carrying
 * one value per series.
 *
 * This is the step #1137 changes. A per-minute view is these rows with each
 * value replaced by its rise since the row before, over the minutes between
 * them, so it belongs here and not in a component.
 */
export function chartRows(
  series: ChartSeries[],
  key: MetricKey,
  secPerFrame: number,
): ChartRow[] {
  const frames = [
    ...new Set(series.flatMap((s) => s.samples.map((x) => x.frame))),
  ].sort((a, b) => a - b);
  // One cursor per series, advanced with the frames, so this stays linear over a
  // 40-minute team game rather than searching every series at every frame.
  const cursors = series.map(() => 0);
  return frames.map((frame) => {
    const row: ChartRow = { timeSec: frame * secPerFrame };
    series.forEach((s, i) => {
      while (
        cursors[i] + 1 < s.samples.length &&
        s.samples[cursors[i] + 1].frame <= frame
      )
        cursors[i]++;
      const current = s.samples[cursors[i]];
      const last = s.samples[s.samples.length - 1];
      const started = current.frame <= frame;
      row[s.id] = started && frame <= last.frame ? current[key] : null;
    });
    return row;
  });
}

/** One line of the tooltip. */
export interface TooltipRow {
  id: string;
  label: string;
  color: string;
  value: number;
}

/**
 * The most rows a tooltip shows. A 16-player FFA otherwise produces a tooltip
 * taller than the window, and the bottom of a sorted list is not the part
 * anybody is reading.
 */
export const TOOLTIP_ROW_LIMIT = 12;

/**
 * Every series at one moment, biggest first, so "who is winning this metric
 * right now" is answered by reading down the list. A series with no value at
 * that moment is left out, and `hidden` counts what the cap dropped.
 */
export function tooltipRows(
  series: ChartSeries[],
  row: ChartRow,
  limit = TOOLTIP_ROW_LIMIT,
): { rows: TooltipRow[]; hidden: number } {
  const present = series
    .map((s) => ({
      id: s.id,
      label: s.label,
      color: s.color,
      value: row[s.id],
    }))
    .filter((r): r is TooltipRow => typeof r.value === "number")
    .sort((a, b) => b.value - a.value);
  return {
    rows: present.slice(0, limit),
    hidden: Math.max(0, present.length - limit),
  };
}

/**
 * At or below this many lines, each one is labelled at its end point and the
 * legend is dropped. That is the duel and the small team game, and it is the
 * difference between a chart you read and one you decode against a key.
 */
export const END_LABEL_MAX_SERIES = 4;

/**
 * The last row a series has a value at, so an end-point label lands on the end
 * of its own line rather than the end of the chart. -1 for a series that is null
 * throughout.
 */
export function lastPointIndex(rows: ChartRow[], id: string): number {
  for (let i = rows.length - 1; i >= 0; i--)
    if (typeof rows[i][id] === "number") return i;
  return -1;
}

/** Where a series' label goes: the last point it was drawn at. */
export interface EndPoint {
  id: string;
  label: string;
  color: string;
  timeSec: number;
  value: number;
}

/** One end point per series that was drawn at all, in series order. */
export function endPoints(series: ChartSeries[], rows: ChartRow[]): EndPoint[] {
  const points: EndPoint[] = [];
  for (const s of series) {
    const i = lastPointIndex(rows, s.id);
    if (i < 0) continue;
    const value = rows[i][s.id];
    if (typeof value !== "number") continue;
    points.push({
      id: s.id,
      label: s.label,
      color: s.color,
      timeSec: rows[i].timeSec,
      value,
    });
  }
  return points;
}

/**
 * Push labels apart down the page so two lines that finish on nearly the same
 * figure keep two readable labels. Without this a duel, which is the case the
 * end-point labels exist for, prints one name on top of another.
 *
 * Labels come back top to bottom. Each keeps its own `y` where it can, is pushed
 * down to clear the one above, and the whole stack is pulled back up if that
 * took it past `bottom`.
 */
export function spreadLabels<T extends { y: number }>(
  labels: T[],
  gap: number,
  top: number,
  bottom: number,
): T[] {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  let above = top - gap;
  const down = sorted.map((l) => {
    const y = Math.max(l.y, above + gap);
    above = y;
    return { ...l, y };
  });
  let below = bottom + gap;
  for (let i = down.length - 1; i >= 0; i--) {
    down[i] = { ...down[i], y: Math.min(down[i].y, below - gap) };
    below = down[i].y;
  }
  return down;
}
