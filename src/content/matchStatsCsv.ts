import type { DemoInfo, Metric } from "./bindings";
import type { ChartMode, ChartRow, ChartSeries, ChartView } from "./matchStats";

/**
 * The match statistics chart as CSV (#1172).
 *
 * This formats rows it is handed and works out no figure of its own. `rows` is
 * what {@link modeRows} returned for the series, the same array the plot draws
 * and the value table prints, so the file and the screen cannot answer
 * different questions. The table rounds to two decimals for reading. The file
 * keeps every digit, because it exists for people who want to calculate with it.
 *
 * Layout: one row per sample. The first column is match time in seconds, then
 * one column per line the view draws (every line, not only a highlighted one),
 * then the provenance columns, repeated on every row. Repeating them rather
 * than writing a header block keeps the file loadable by every tool with
 * nothing to skip, and lets two files be concatenated without losing which
 * match a row came from.
 */

/** Record separator RFC 4180 asks for. */
const EOL = "\r\n";

/**
 * A text cell opens with one of these and a spreadsheet reads it as a formula.
 * Tab and carriage return are in OWASP's list too.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One text cell, quoted per RFC 4180 where it needs it, and neutralised if a
 * spreadsheet would run it. A leading single quote makes Excel, Sheets and
 * LibreOffice show the text as typed. Only for text: a number's leading minus
 * is the number, so numbers go through {@link csvNumber}.
 */
export function csvText(text: string): string {
  const safe = FORMULA_LEAD.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * A figure with a dot decimal, no separators and no unit, whatever the app's
 * locale does on screen. `String` gives the shortest text that parses back to
 * the same number. A reading the file does not have is an empty cell, never a
 * zero.
 */
export function csvNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  // -0 prints as "0" already, but say so: a "-0" cell would read as a loss.
  return value === 0 ? "0" : String(value);
}

/** The battle's start as an ISO 8601 UTC timestamp, or "" when the file has none. */
function startedAt(info: DemoInfo): string {
  const ms = info.startTimeMs;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : "";
}

export interface MatchStatsCsvInput {
  info: DemoInfo;
  metric: Metric;
  mode: ChartMode;
  view: ChartView;
  /** The view's lines, in the order the chart draws them. */
  series: ChartSeries[];
  /** {@link modeRows} over `series`, for the same metric and mode. */
  rows: ChartRow[];
}

/** The provenance columns, in order: header and the value each row carries. */
function provenance({ info, metric, mode, view }: MatchStatsCsvInput) {
  return [
    ["game_id", info.gameId ?? ""],
    ["map", info.mapName],
    ["started_utc", startedAt(info)],
    ["metric", metric.label],
    ["unit", metric.unit],
    ["view", view],
    ["values", mode === "perMinute" ? "per minute" : "cumulative"],
  ] as const;
}

export function matchStatsCsv(input: MatchStatsCsvInput): string {
  const { series, rows } = input;
  const extra = provenance(input);
  const header = [
    "match_time_sec",
    ...series.map((s) => csvText(s.label)),
    ...extra.map(([name]) => name),
  ];
  const tail = extra.map(([, value]) => csvText(value));
  const lines = rows.map((row) =>
    [
      csvNumber(row.timeSec),
      ...series.map((s) => csvNumber(row[s.id])),
      ...tail,
    ].join(","),
  );
  return [header.join(","), ...lines].join(EOL) + EOL;
}

/** Lower case letters and digits, and single hyphens between them. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A default file name from the map, the date and the metric. Slugged the way the
 * app's other exports are, which leaves nothing Windows, macOS or Linux refuses
 * in a name. A part that slugs to nothing, such as a map named in another
 * script, is dropped rather than leaving a doubled hyphen.
 */
export function matchStatsCsvFileName(info: DemoInfo, metric: Metric): string {
  const date = startedAt(info).slice(0, 10);
  const parts = [slug(info.mapName), date, slug(metric.label)].filter(Boolean);
  return `${parts.length > 0 ? parts.join("-") : "match-statistics"}.csv`;
}
