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
 * A figure on the cumulative chart: on an axis tick or in the tooltip.
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

/**
 * A figure on the per-minute chart.
 *
 * A rate is a different magnitude from the running total it came from: a team
 * that killed twenty units in eight minutes is plotted in single digits, and
 * recharts then picks fractional gridlines. {@link formatChartValue} rounds, so
 * an axis of 0, 1.2, 2.4, 3.6 reads there as 0, 1, 2, 4. Under a hundred this
 * keeps enough decimals to tell those ticks apart. Above it, a rate is big
 * enough that the cumulative formatter reads correctly and the two agree.
 */
export function formatRate(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100 || value === 0) return formatChartValue(value);
  // `toFixed` always leaves a point, so trimming zeros can't eat a whole number.
  return value.toFixed(abs < 10 ? 2 : 1).replace(/\.?0+$/, "");
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
 *   2. which series are plotted  -> `teamSeries` or `allySeries`, which return
 *      the same shape, so everything downstream is written once
 *   3. what recharts receives    -> `chartRows`, and `perMinuteRows` over its
 *      result for the rate view
 *
 * So the chart component composes three functions, and the value table (#1140)
 * reads step 3's output for whichever view is showing rather than deriving
 * anything of its own.
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

/** The `dataKey` for one engine team's line. */
const teamId = (team: number) => `team${team}`;

/**
 * One line per team the engine actually measured. A team with no samples is left
 * out rather than drawn flat at zero, which would claim a reading the file
 * doesn't have.
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
        id: teamId(t.team),
        label: first ? `${first.name}${extra}` : `Team ${t.team}`,
        color: seriesColor(first?.rgbColor, t.team),
        samples: t.samples,
      };
    });
}

/**
 * Which side each team played for, from the seats that held it. A bot holds a
 * team and is on a side like anybody else. A team no seat is recorded for isn't
 * in here at all, and {@link allySeries} leaves it as a line of its own rather
 * than guessing which side its figures belong to.
 */
function allyByTeam(info: DemoInfo): Map<number, number> {
  const ally = new Map<number, number>();
  const add = (team?: number, allyTeam?: number) => {
    if (team !== undefined && allyTeam !== undefined) ally.set(team, allyTeam);
  };
  for (const p of info.players) if (!p.spectator) add(p.team, p.allyTeam);
  for (const a of info.ais) add(a.team, a.allyTeam);
  return ally;
}

/**
 * Several teams' samples as one series: the union of their frames, with each
 * value added across the teams recorded at that frame.
 *
 * A team that stopped being recorded goes on contributing its last figure rather
 * than dropping out, because every field is a running total. A side whose total
 * fell when a member stopped would read as a side that un-spent its metal.
 */
function mergeSamples(parts: TeamStatSample[][]): TeamStatSample[] {
  const frames = [...new Set(parts.flatMap((p) => p.map((s) => s.frame)))].sort(
    (a, b) => a - b,
  );
  // One cursor per team, advanced with the frames, as `chartRows` does.
  const cursors = parts.map(() => 0);
  return frames.map((frame) => {
    const present: TeamStatSample[] = [];
    parts.forEach((p, i) => {
      while (cursors[i] + 1 < p.length && p[cursors[i] + 1].frame <= frame)
        cursors[i]++;
      const current = p[cursors[i]];
      // Nothing before a team's first sample: it has no running total yet.
      if (current.frame <= frame) present.push(current);
    });
    // Never empty: every frame here is one some team sampled at.
    const total: TeamStatSample = { ...present[0], frame };
    for (const s of present.slice(1))
      for (const k of Object.keys(total) as (keyof TeamStatSample)[])
        if (k !== "frame") total[k] += s[k];
    return total;
  });
}

/**
 * What a side is called, with how it did. "Team 1" rather than "Ally team 0"
 * because that is how a match is talked about and `[allyteam0]` is an index in a
 * file, and the result is part of the name because the chart is read to find out
 * how the match went.
 */
function sideLabel(ally: number, info: DemoInfo): string {
  const won = info.winnersKnown && info.winningAllyTeams.includes(ally);
  return `Team ${ally + 1}${won ? " (won)" : ""}`;
}

/**
 * How far apart two `#rrggbb` colours are, added up over the channels. Crude on
 * purpose: it is here to catch two sides drawn in the same green, not to model
 * how colour is seen.
 */
function colorGap(a: string, b: string): number {
  let gap = 0;
  for (let i = 1; i < 7; i += 2)
    gap += Math.abs(
      Number.parseInt(a.slice(i, i + 2), 16) -
        Number.parseInt(b.slice(i, i + 2), 16),
    );
  return gap;
}

/** Closer than this and two lines read as one colour. 765 is the whole range. */
const MIN_SIDE_COLOR_GAP = 150;

/**
 * Picks each side a colour, taking one of its own members' where it can.
 *
 * A side keeping a member's colour means a line doesn't change colour when the
 * toggle changes what it is made of. But which member that is comes down to team
 * numbering, and two sides whose lowest-numbered players both chose green draw
 * this chart as one line twice: the whole case for the view is that two lines
 * are two things you can point at. So a side too close to one already given out
 * takes a palette colour instead.
 */
function sideColors(wanted: string[]): string[] {
  const taken: string[] = [];
  return wanted.map((want, i) => {
    const clear = (c: string) =>
      taken.every((t) => colorGap(c, t) >= MIN_SIDE_COLOR_GAP);
    const color = clear(want)
      ? want
      : (FALLBACK_COLORS.find(clear) ??
        FALLBACK_COLORS[i % FALLBACK_COLORS.length]);
    taken.push(color);
    return color;
  });
}

/**
 * One line per ally side, its teams' samples added together.
 *
 * Adding them is valid because every field is a running total and no team is on
 * two sides, so a side's figure at a moment is its members' figures at that
 * moment added up. Adding here, before {@link perMinuteRows}, is what lets the
 * two views compose: summing then differencing and differencing then summing
 * give the same answer, and `matchStats.test.ts` holds them equal.
 *
 * Sides in ally-team order, then any team the file gives no side for, which
 * keeps the line, the name and the colour {@link teamSeries} gave it.
 */
export function allySeries(
  trailer: DemoTrailer,
  info: DemoInfo,
): ChartSeries[] {
  const side = allyByTeam(info);
  const lines = new Map(teamSeries(trailer, info).map((s) => [s.id, s]));
  const sides = new Map<number, ChartSeries[]>();
  const loose: ChartSeries[] = [];
  for (const t of trailer.teams) {
    // Absent for a team the engine measured nothing for, which stays left out.
    const line = lines.get(teamId(t.team));
    if (!line) continue;
    const ally = side.get(t.team);
    if (ally === undefined) {
      loose.push(line);
      continue;
    }
    const held = sides.get(ally);
    if (held) held.push(line);
    else sides.set(ally, [line]);
  }
  const ordered = [...sides.entries()].sort(([a], [b]) => a - b);
  const colors = sideColors(ordered.map(([, members]) => members[0].color));
  const merged = ordered.map(([ally, members], i) => ({
    id: `ally${ally}`,
    label: sideLabel(ally, info),
    color: colors[i],
    samples: mergeSamples(members.map((m) => m.samples)),
  }));
  return [...merged, ...loose];
}

/** Whether the chart draws a line per seat or a line per side. */
export type ChartView = "players" | "teams";

/**
 * More lines than this and the chart opens on Teams. At or below it a match is
 * small enough to read line by line, and a duel must not open on a view that
 * hides both players behind a side of one.
 */
export const PLAYERS_VIEW_MAX_SERIES = 4;

/**
 * Which view the chart opens on. Teams once there are more lines than anyone can
 * tell apart by colour, but only when it actually merges something: a 16-player
 * free-for-all is sixteen sides of one, and drawing it as sixteen lines called
 * "Team 1" to "Team 16" is the same smear with the names taken off.
 */
export function defaultChartView(
  players: ChartSeries[],
  sides: ChartSeries[],
): ChartView {
  return players.length > PLAYERS_VIEW_MAX_SERIES &&
    sides.length < players.length
    ? "teams"
    : "players";
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
 * Every value here is a running total, which is what the file recorded.
 * {@link perMinuteRows} turns that into a rate.
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

/**
 * Which question the chart answers: how much in total, or how much a minute.
 * Not a display option. A cumulative line only ever goes up, so the minute a
 * player was crippled is a change of slope nobody can see, and the same figures
 * as a rate are the shape of the match.
 */
export type ChartMode = "cumulative" | "perMinute";

const SEC_PER_MINUTE = 60;

/** Every series a set of rows carries: their keys, minus the x axis. */
function seriesIds(rows: ChartRow[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r)))].filter(
    (k) => k !== "timeSec",
  );
}

/**
 * The rate a series' first point is drawn at: its second point's. It has no
 * predecessor of its own, and a zero at the first point reads as a stall in
 * exactly the chart this view exists to expose. Null for a series with a single
 * point, which has no rate at all to show.
 */
function openingRate(
  rates: ChartRow[],
  id: string,
  first: number,
): number | null {
  for (let i = first + 1; i < rates.length; i++) {
    const rate = rates[i][id];
    if (typeof rate === "number") return rate;
  }
  return null;
}

/**
 * The same rows as a rate: each value is its rise since the row before, over the
 * minutes between the two. The interval comes from the rows' own times, which
 * {@link chartRows} took from the trailer's recorded period, so nothing here
 * assumes how often the engine sampled.
 *
 * A pure function over rows on purpose. The value table (#1140) shows these
 * figures rather than re-deriving them, and the ally-side view (#1138) sums
 * running totals before this runs: summing then differencing and differencing
 * then summing give the same answer, but only while this stays out of the chart.
 */
export function perMinuteRows(rows: ChartRow[]): ChartRow[] {
  const rates: ChartRow[] = rows.map((r) => ({ timeSec: r.timeSec }));
  for (const id of seriesIds(rows)) {
    let previous: { timeSec: number; value: number } | null = null;
    let first = -1;
    for (let i = 0; i < rows.length; i++) {
      const value = rows[i][id];
      // Null before a series starts and after it stops, and it stays null: a
      // team that is no longer recorded has no rate either.
      if (typeof value !== "number") {
        rates[i][id] = null;
        continue;
      }
      if (previous === null) {
        first = i;
        rates[i][id] = null;
      } else {
        const minutes = (rows[i].timeSec - previous.timeSec) / SEC_PER_MINUTE;
        rates[i][id] = minutes > 0 ? (value - previous.value) / minutes : 0;
      }
      previous = { timeSec: rows[i].timeSec, value };
    }
    if (first >= 0) rates[first][id] = openingRate(rates, id, first);
  }
  return rates;
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

/** The shortest chart, which is what a small match gets. */
const CHART_MIN_HEIGHT = 280;

/** One tooltip row: 12px text on a 16px line, plus the list's gap. */
const TOOLTIP_ROW_PX = 18;

/** The tooltip's heading, its "and N more" line, its padding and its border. */
const TOOLTIP_CHROME_PX = 56;

/** One row of legend entries under the plot. */
const LEGEND_ROW_PX = 22;

/**
 * Legend entries assumed to fit across the plot before the row wraps. A name and
 * its swatch is about 70px, so a 1,260px chart fits far more than this: the
 * figure is deliberately low, because over-reserving costs a little empty plot
 * and under-reserving puts the tooltip back over the legend.
 */
const LEGEND_ROW_ENTRIES = 4;

/** Space between the bottom of the tooltip and the bottom of the plot. */
const TOOLTIP_CLEARANCE = 16;

/**
 * How tall the chart is drawn, in pixels.
 *
 * 280 reads a duel or a 3v3 without eating the page, but the tooltip is as tall
 * as the number of lines it lists: on a sixteen-seat match twelve rows and a
 * heading come to more than a 280px plot, so the tooltip ran past the bottom of
 * it and printed over the legend, which is the one thing a reader with sixteen
 * lines still needs (#1204). A chart with that many lines is given the room its
 * own tooltip and its own legend take.
 */
export function chartHeight(seriesCount: number): number {
  const tooltip =
    Math.min(seriesCount, TOOLTIP_ROW_LIMIT) * TOOLTIP_ROW_PX +
    TOOLTIP_CHROME_PX;
  const legend =
    seriesCount > END_LABEL_MAX_SERIES
      ? Math.ceil(seriesCount / LEGEND_ROW_ENTRIES) * LEGEND_ROW_PX
      : 0;
  return Math.max(CHART_MIN_HEIGHT, tooltip + legend + TOOLTIP_CLEARANCE);
}

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
