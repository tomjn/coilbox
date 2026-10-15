import type { Metric, MetricRatio, StatRecord } from "./bindings";
import { formatRate } from "./matchStats";
import { matchFigure } from "./replayMatchFigures";
import { gamesFor, isGenuineMatch } from "./stats";

/**
 * A player's match figures as rates, for the dossier (#1166).
 *
 * The store keeps one end-of-match total per team and metric. A game's figure
 * for a player is the totals of the army they control (`matchFigure`), divided by the
 * match's minutes so that a player who plays long games does not look better at
 * economy. Nothing here names a metric: the metrics are whatever the caller
 * passes, which is the registry's roster set.
 *
 * Two rules the page depends on:
 *
 * - A game counts only when the store has that army's totals and a usable
 *   length. The rest are counted as left out, never silently dropped.
 * - The average is the mean of each game's own rate, with the median beside it.
 *   Total over total minutes would let one long game outweigh several short
 *   ones, which is the complaint the rates exist to answer.
 *
 * A ratio (`MetricRatio`, declared by the registry) is one metric over another
 * for the same army and game. It has no unit and does not depend on the
 * match's length. A game whose lower figure is zero has no ratio, which is not
 * infinity and not zero. It is left out of the ratio's average and counted
 * beside it (`RatioSummary.noDenominator`). The average is again the mean of
 * each game's own ratio with the median beside it, for consistency with the
 * rates. It is not the ratio of the totals: that would be one more figure that
 * reads like the others and is not, and a game with one kill and ten losses
 * pulls the mean up where it moves the median little, which is why the median
 * is shown.
 *
 * An army is not a side. Allies on one side each control their own army, so
 * their figures differ. Where players share control of one army, each of them
 * has its whole total, and the total is not divided between them.
 */

/** One counted game: the rate for each metric the store has a figure for. */
export interface RateGame {
  filename: string;
  startTimeMs: number;
  /** True or false when the game was decided, undefined when the result is unknown. */
  won?: boolean;
  minutes: number;
  /** Per minute rate by metric key. A metric the record has no total for is absent. */
  rates: Record<string, number>;
  /** Ratio by ratio key. Absent when the game has no figure for either half, and when the lower figure is zero. */
  ratios: Record<string, number>;
  /** Keys of the ratios the game has both figures for but no ratio, because the lower figure is zero. */
  noDenominator: string[];
}

export interface PlayerRateGames {
  /** Genuine games the player played. */
  games: number;
  /** Games in `list`: the army's totals are known and the length is usable. */
  counted: number;
  /** Games with no team id, no totals, or none of the asked-for metrics. */
  leftOutNoTotals: number;
  /** Games with totals but a zero, negative or missing length. */
  leftOutNoLength: number;
  /** Counted games where another player shared control of the army (the same engine team, not just the same side), so its total is theirs too. */
  sharedTeamGames: number;
  /** Counted games, oldest first. */
  list: RateGame[];
}

/** Whether another seat, not a watcher, controls the same engine team as `name`. Allies on separate engine teams do not count. */
function teamIsShared(record: StatRecord, name: string): boolean {
  const mine = record.players.find((p) => !p.spectator && p.name === name);
  if (mine?.team === undefined) return false;
  return record.players.some(
    (p) => !p.spectator && p.name !== name && p.team === mine.team,
  );
}

export function playerRateGames(
  records: StatRecord[],
  name: string,
  metrics: Metric[],
  refightFilenames: ReadonlySet<string> = new Set(),
  ratios: MetricRatio[] = [],
): PlayerRateGames {
  const genuine = records.filter((r) => isGenuineMatch(r, refightFilenames));
  const played = gamesFor(genuine, name);
  const out: PlayerRateGames = {
    games: played.length,
    counted: 0,
    leftOutNoTotals: 0,
    leftOutNoLength: 0,
    sharedTeamGames: 0,
    list: [],
  };
  for (const g of played) {
    const figures: [string, number][] = [];
    for (const m of metrics) {
      const v = matchFigure(g.record, m, name);
      if (v !== undefined && Number.isFinite(v)) figures.push([m.key, v]);
    }
    if (figures.length === 0) {
      out.leftOutNoTotals += 1;
      continue;
    }
    const minutes = g.record.durationSec / 60;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      out.leftOutNoLength += 1;
      continue;
    }
    out.counted += 1;
    if (teamIsShared(g.record, name)) out.sharedTeamGames += 1;
    const figure = new Map(figures);
    const gameRatios: Record<string, number> = {};
    const noDenominator: string[] = [];
    for (const r of ratios) {
      const top = figure.get(r.numerator);
      const bottom = figure.get(r.denominator);
      if (top === undefined || bottom === undefined) continue;
      if (bottom === 0) noDenominator.push(r.key);
      else gameRatios[r.key] = top / bottom;
    }
    out.list.push({
      filename: g.record.filename,
      startTimeMs: g.record.startTimeMs,
      won: g.won,
      minutes,
      rates: Object.fromEntries(figures.map(([k, v]) => [k, v / minutes])),
      ratios: gameRatios,
      noDenominator,
    });
  }
  return out;
}

/** The middle value, or the mean of the middle two. Null for no values. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The mean of each game's rate, with the median and the games it is drawn from. */
export interface RateSummary {
  games: number;
  mean: number | null;
  median: number | null;
}

export function summariseRate(
  games: RateGame[],
  metricKey: string,
): RateSummary {
  const rates = games
    .map((g) => g.rates[metricKey])
    .filter((v): v is number => v !== undefined);
  return {
    games: rates.length,
    mean: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    median: median(rates),
  };
}

/** One metric's rate over all counted games, and split by the result. */
export interface RateRow {
  metric: Metric;
  all: RateSummary;
  /** Games won. A game with no recorded result is in neither this nor `losses`. */
  wins: RateSummary;
  losses: RateSummary;
}

export function rateRows(games: RateGame[], metrics: Metric[]): RateRow[] {
  const won = games.filter((g) => g.won === true);
  const lost = games.filter((g) => g.won === false);
  return metrics.map((metric) => ({
    metric,
    all: summariseRate(games, metric.key),
    wins: summariseRate(won, metric.key),
    losses: summariseRate(lost, metric.key),
  }));
}

/** The mean of each game's own ratio, with the median and the games it is drawn from. */
export interface RatioSummary extends RateSummary {
  /** Games with both figures where the lower one is zero. They have no ratio and are not in `games`. */
  noDenominator: number;
}

export function summariseRatio(
  games: RateGame[],
  ratioKey: string,
): RatioSummary {
  return {
    ...summariseRate(
      games.map((g) => ({ ...g, rates: g.ratios })),
      ratioKey,
    ),
    noDenominator: games.filter((g) => g.noDenominator.includes(ratioKey))
      .length,
  };
}

/** One ratio over all counted games, and split by the result. */
export interface RatioRow {
  ratio: MetricRatio;
  all: RatioSummary;
  wins: RatioSummary;
  losses: RatioSummary;
}

export function ratioRows(
  games: RateGame[],
  ratios: MetricRatio[],
): RatioRow[] {
  const won = games.filter((g) => g.won === true);
  const lost = games.filter((g) => g.won === false);
  return ratios.map((ratio) => ({
    ratio,
    all: summariseRatio(games, ratio.key),
    wins: summariseRatio(won, ratio.key),
    losses: summariseRatio(lost, ratio.key),
  }));
}

/** One game on the trend line. */
export interface TrendPoint {
  filename: string;
  startTimeMs: number;
  value: number;
  won?: boolean;
}

/**
 * One metric's per game rate, or one ratio's per game value, in date order.
 * Metric keys and ratio keys never collide. Games without that figure are left
 * out.
 */
export function trendSeries(games: RateGame[], key: string): TrendPoint[] {
  const figureOf = (g: RateGame): number | undefined =>
    g.rates[key] ?? g.ratios[key];
  return games
    .flatMap((g) => {
      const value = figureOf(g);
      return value === undefined ? [] : [{ g, value }];
    })
    .map(({ g, value }) => ({
      filename: g.filename,
      startTimeMs: g.startTimeMs,
      value,
      won: g.won,
    }))
    .sort((a, b) => a.startTimeMs - b.startTimeMs);
}

/** A rate as the page shows it. Unknown is a dash, never a zero or NaN. */
export function formatRateValue(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : formatRate(value);
}

/** The sentence saying how many games were left out, or null when none were. */
export function leftOutNote(r: PlayerRateGames): string | null {
  const parts: string[] = [];
  if (r.leftOutNoTotals > 0)
    parts.push(
      `${r.leftOutNoTotals} with no figures recorded (older or unmeasured replays)`,
    );
  if (r.leftOutNoLength > 0)
    parts.push(`${r.leftOutNoLength} with no usable length`);
  if (parts.length === 0) return null;
  return `Left out: ${parts.join(" and ")}.`;
}
