import type { Metric, StatRecord } from "./bindings";
import { GAME_LENGTH_BOUNDARIES_SEC } from "./gameLength";
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
 *
 * The other basis is one player's own figures, for a library about "me": the
 * totals of the army that player controls and nothing else, whatever the
 * metric counts. Allies on one side have different figures. It needs the
 * team id the store records for each seat, so a replay the player
 * was not in, and a record ingested before the store kept team ids, have no
 * figure on this basis. Team 0 is a real team, so "unknown" is never 0.
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

/**
 * Whether a metric's row figure is the best team or the sum of all teams, or
 * the named player's own total when a player is given.
 */
export function figureBasis(metric: Metric, player?: string): string {
  if (player) return `${player}'s own total`;
  return metric.unit === "metal" || metric.unit === "energy"
    ? "best team"
    : "match total";
}

/**
 * The team a named player played for in a match, or undefined when the record
 * does not say: they were not in it, they only watched, or the record predates
 * team ids and has not been re-ingested.
 */
export function playerTeam(
  record: StatRecord | undefined,
  name: string,
): number | undefined {
  return record?.players.find((p) => !p.spectator && p.name === name)?.team;
}

/**
 * One metric's figure for a match, or undefined when the match has none. A
 * record that measured nothing has no totals, and that is not the same as a
 * total of zero.
 *
 * With `player`, the figure is the total of the army that player controls, and is
 * undefined when the player was not in the match or their team is unknown.
 * Without it, the figure is for the whole match.
 */
export function matchFigure(
  record: StatRecord | undefined,
  metric: Metric,
  player?: string,
): number | undefined {
  if (!record?.statsKnown) return undefined;
  if (player) {
    const team = playerTeam(record, player);
    if (team === undefined) return undefined;
    const v = record.teamTotals.find((t) => t.team === team)?.totals[
      metric.key
    ];
    return typeof v === "number" ? v : undefined;
  }
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

/** "30 minutes", "1 hour", "2 hours" for a boundary in seconds. */
function lengthLabel(sec: number): string {
  const hours = sec / 3600;
  if (Number.isInteger(hours))
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${sec / 60} minutes`;
}

/**
 * The minimum game lengths on offer, in seconds. 0 is no minimum. The rest are
 * the bands the matchup view groups by, read from the one list they share.
 */
export const MIN_LENGTH_OPTIONS = [
  { value: "0", label: "Any length" },
  ...GAME_LENGTH_BOUNDARIES_SEC.map((sec) => ({
    value: String(sec),
    label: `Over ${lengthLabel(sec)}`,
  })),
];

/** Whether a replay is longer than the minimum. An unknown length never is. */
export function isOverMinimum(
  durationSec: number | undefined,
  minSec: number,
): boolean {
  if (minSec <= 0) return true;
  return durationSec != null && durationSec > minSec;
}
