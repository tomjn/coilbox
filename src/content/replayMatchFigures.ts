import type { Metric, StatRecord } from "./bindings";
import { formatTotal } from "./matchStats";

/**
 * What the replay library shows and sorts by from the stats store.
 *
 * A library row is a whole match, but the store keeps totals per team. The rule
 * for turning teams into one figure depends on what the metric counts:
 *
 * - metal and energy are an economy, and the question is how big the best one
 *   got, so the row shows the best single team
 * - damage and unit counts describe the fight, so the row shows the sum of all
 *   teams
 *
 * The rule reads the metric's `unit` from the registry. No metric is named
 * here, and the metrics on offer are whatever the registry flags `roster`,
 * because those are the only totals the store keeps.
 */

export type SortDirection = "asc" | "desc";

const METRIC_SORT = "metric:";

/** The sort value for a metric, as stored in settings and given to the select. */
export function metricSortValue(key: string, dir: SortDirection): string {
  return `${METRIC_SORT}${key}:${dir}`;
}

/** The metric and direction in a sort value, or null if it is not a metric sort. */
export function parseMetricSort(
  value: string,
): { key: string; dir: SortDirection } | null {
  if (!value.startsWith(METRIC_SORT)) return null;
  const rest = value.slice(METRIC_SORT.length);
  const at = rest.lastIndexOf(":");
  const dir = rest.slice(at + 1);
  if (at < 1 || (dir !== "asc" && dir !== "desc")) return null;
  return { key: rest.slice(0, at), dir };
}

/** The metrics a library row can show: the ones the store keeps totals for. */
export function libraryMetrics(metrics: Metric[]): Metric[] {
  return metrics.filter((m) => m.roster && m.surfaced);
}

/** Whether a metric's row figure is the best team or the sum of all teams. */
export function figureBasis(metric: Metric): "best team" | "match total" {
  return metric.unit === "metal" || metric.unit === "energy"
    ? "best team"
    : "match total";
}

/**
 * One metric's figure for a whole match, or undefined when the match has none.
 * A record that measured nothing has no totals, and that is not the same as a
 * total of zero.
 */
export function matchFigure(
  record: StatRecord | undefined,
  metric: Metric,
): number | undefined {
  if (!record?.statsKnown) return undefined;
  const perTeam: number[] = [];
  for (const team of record.teamTotals) {
    const v = team.totals[metric.key];
    if (typeof v === "number") perTeam.push(v);
  }
  if (perTeam.length === 0) return undefined;
  return figureBasis(metric) === "best team"
    ? Math.max(...perTeam)
    : perTeam.reduce((a, b) => a + b, 0);
}

/** A figure as the row shows it. An unknown figure is empty, never a zero. */
export function formatFigure(value: number | undefined): string {
  return value == null ? "—" : formatTotal(value);
}

/**
 * Compare two figures in a direction, with an unknown figure after every known
 * one whichever way it runs. Returns 0 for two unknowns so a stable sort keeps
 * their existing order.
 */
export function compareFigures(
  a: number | undefined,
  b: number | undefined,
  dir: SortDirection,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "asc" ? a - b : b - a;
}

/**
 * The metrics to show beside a row: the registry's headline metrics, plus the
 * one being sorted by when it is not already among them.
 */
export function columnMetrics(
  metrics: Metric[],
  sortedKey: string | undefined,
): Metric[] {
  const available = libraryMetrics(metrics);
  return available.filter((m) => m.headline || m.key === sortedKey);
}

/** The minimum game lengths on offer, in seconds. 0 is no minimum. */
export const MIN_LENGTH_OPTIONS = [
  { value: "0", label: "Any length" },
  { value: "1800", label: "Over 30 minutes" },
  { value: "3600", label: "Over 1 hour" },
  { value: "7200", label: "Over 2 hours" },
];

/** Whether a replay is longer than the minimum. An unknown length never is. */
export function isOverMinimum(
  durationSec: number | undefined,
  minSec: number,
): boolean {
  if (minSec <= 0) return true;
  return durationSec != null && durationSec > minSec;
}
