import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { OptionSelect } from "@/components/OptionSelect";
import type { Metric, MetricRatio, StatRecord } from "../../bindings";
import { formatRate } from "../../matchStats";
import {
  formatRateValue,
  leftOutNote,
  playerRateGames,
  type RateSummary,
  type RatioSummary,
  rateRows,
  ratioRows,
  type TrendPoint,
  trendSeries,
} from "../../playerMatchFigures";

/**
 * A player's match figures as rates: the average per minute for each metric the
 * store keeps totals for, the same split by result, and a trend over time (#1166).
 *
 * Everything is the totals of the army the player controlled, from the stats
 * store. That is the player's own, so two allies on one side ("Team 1" on the
 * replay page) have different figures. Nothing opens a replay. Every figure
 * shows the number of games it is drawn from and none is hidden below a size,
 * because the codebase has no rule for when a sample is big enough.
 */

const axisTick = { fontSize: 11, fill: "currentColor", opacity: 0.65 };

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });

function games(n: number): string {
  return `${n} ${n === 1 ? "game" : "games"}`;
}

function Cell({ s }: { s: RateSummary }) {
  return (
    <td className="px-2 py-1.5 text-right align-top">
      <div className="tabular-nums">{formatRateValue(s.mean)}</div>
      <div className="text-[11px] text-muted-foreground tabular-nums">
        {s.games > 0 ? `median ${formatRateValue(s.median)} · ` : ""}
        {games(s.games)}
      </div>
    </td>
  );
}

/** A ratio's cell: the mean, then the median, the games it is drawn from, and the games with no ratio. */
function RatioCell({
  s,
  lowerFigure,
}: {
  s: RatioSummary;
  lowerFigure: string;
}) {
  return (
    <td className="px-2 py-1.5 text-right align-top">
      <div className="tabular-nums">{formatRateValue(s.mean)}</div>
      <div className="text-[11px] text-muted-foreground tabular-nums">
        {s.games > 0 ? `median ${formatRateValue(s.median)} · ` : ""}
        {games(s.games)}
        {s.noDenominator > 0
          ? ` · ${s.noDenominator} with no ${lowerFigure}`
          : ""}
      </div>
    </td>
  );
}

function TrendTooltip({
  active,
  payload,
  describe,
}: {
  active?: boolean;
  payload?: { payload?: TrendPoint }[];
  describe: (value: number) => string;
}) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  const result =
    p.won === true ? "Win" : p.won === false ? "Loss" : "No result";
  return (
    <div className="rounded-md border border-border/60 bg-popover p-2 text-xs shadow-md">
      <p className="font-medium">{shortDate(p.startTimeMs)}</p>
      <p className="tabular-nums">{describe(p.value)}</p>
      <p className="text-muted-foreground">{result}</p>
    </div>
  );
}

function Trend({
  points,
  label,
  describe,
}: {
  points: TrendPoint[];
  label: string;
  /** A value with its unit, "2.5 per minute" or "1.2 units lost per unit killed". */
  describe: (value: number) => string;
}) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No counted game has a figure for {label}.
      </p>
    );
  }
  if (points.length === 1) {
    return (
      <p className="text-sm text-muted-foreground">
        One game so far: {describe(points[0].value)} on{" "}
        {shortDate(points[0].startTimeMs)}. A line needs at least two games.
      </p>
    );
  }
  return (
    <div className="h-40 text-primary">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            opacity={0.12}
            vertical={false}
          />
          <XAxis
            dataKey="startTimeMs"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={shortDate}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
          />
          <YAxis
            domain={[0, "auto"]}
            tickFormatter={formatRate}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={52}
          />
          <Tooltip
            content={<TrendTooltip describe={describe} />}
            cursor={{ stroke: "currentColor", strokeOpacity: 0.35 }}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="value"
            stroke="currentColor"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PlayerMatchFigures({
  records,
  playerName,
  refightFilenames,
  metrics,
  ratios = [],
}: {
  records: StatRecord[];
  playerName: string;
  refightFilenames: ReadonlySet<string>;
  /** The metrics the store keeps totals for: the registry's roster set. */
  metrics: Metric[];
  /** The registry's ratios. One whose halves are not in `metrics` is not shown. */
  ratios?: MetricRatio[];
}) {
  const shownRatios = useMemo(
    () =>
      ratios.filter(
        (r) =>
          metrics.some((m) => m.key === r.numerator) &&
          metrics.some((m) => m.key === r.denominator),
      ),
    [ratios, metrics],
  );
  const labelOf = (key: string) =>
    metrics.find((m) => m.key === key)?.label.toLowerCase() ?? "";
  const data = useMemo(
    () =>
      playerRateGames(
        records,
        playerName,
        metrics,
        refightFilenames,
        shownRatios,
      ),
    [records, playerName, metrics, refightFilenames, shownRatios],
  );
  const rows = useMemo(() => rateRows(data.list, metrics), [data, metrics]);
  const ratioTable = useMemo(
    () => ratioRows(data.list, shownRatios),
    [data, shownRatios],
  );
  // The registry's headline metric opens the trend, and the reader can pick any
  // other. The registry decides which, so no metric is named here.
  const [picked, setPicked] = useState("");
  const trendMetric =
    metrics.find((m) => m.key === picked) ??
    shownRatios.find((r) => r.key === picked) ??
    metrics.find((m) => m.headline) ??
    metrics[0];
  const trendIsRatio = shownRatios.some((r) => r.key === trendMetric?.key);
  const describeTrend = (value: number) =>
    trendIsRatio
      ? `${formatRate(value)} ${trendMetric?.label.toLowerCase()}`
      : `${formatRate(value)} per minute`;
  const points = useMemo(
    () => (trendMetric ? trendSeries(data.list, trendMetric.key) : []),
    [data, trendMetric],
  );
  const note = leftOutNote(data);
  const basis = `${playerName}'s own figures`;

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <h2 className="mb-1 text-sm font-medium">Match figures</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Each figure is the total for the army {playerName} controlled, divided
        by the match's minutes, averaged over the games below. The average is
        the mean of each game's own rate, with the median beside it. Allies on
        one side each have their own figures. Only players who share control of
        one army have the same figures.
      </p>

      {data.counted === 0 || metrics.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {metrics.length === 0
            ? "Match figures are not available yet."
            : `None of ${playerName}'s ${games(data.games)} has figures recorded, so there are no figures to show.`}
          {note && metrics.length > 0 ? ` ${note}` : ""}
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            Drawn from {data.counted} of {games(data.games)}.{" "}
            {note ? `${note} ` : ""}
            {data.sharedTeamGames > 0
              ? `In ${games(data.sharedTeamGames)} another player shared control of ${playerName}'s army.`
              : ""}
          </p>
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="px-2 py-1 text-left font-medium">
                    {basis}, per minute
                  </th>
                  <th className="px-2 py-1 text-right font-medium">All</th>
                  <th className="px-2 py-1 text-right font-medium">Wins</th>
                  <th className="px-2 py-1 text-right font-medium">Losses</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rows.map((r) => (
                  <tr key={r.metric.key}>
                    <th
                      scope="row"
                      className="px-2 py-1.5 text-left align-top font-normal"
                    >
                      {r.metric.label}
                    </th>
                    <Cell s={r.all} />
                    <Cell s={r.wins} />
                    <Cell s={r.losses} />
                  </tr>
                ))}
              </tbody>
              {ratioTable.length > 0 && (
                <tbody className="divide-y divide-border/40">
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={4}
                      className="px-2 pt-3 pb-1 text-left text-xs font-medium text-muted-foreground"
                    >
                      {basis}, ratios with no unit
                    </th>
                  </tr>
                  {ratioTable.map((r) => {
                    const lower = labelOf(r.ratio.denominator);
                    return (
                      <tr key={r.ratio.key}>
                        <th
                          scope="row"
                          className="px-2 py-1.5 text-left align-top font-normal"
                        >
                          {r.ratio.label}
                        </th>
                        <RatioCell s={r.all} lowerFigure={lower} />
                        <RatioCell s={r.wins} lowerFigure={lower} />
                        <RatioCell s={r.losses} lowerFigure={lower} />
                      </tr>
                    );
                  })}
                </tbody>
              )}
            </table>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            A game with no recorded result is in All only. The store holds
            end-of-match totals, so these figures cannot say how far ahead a
            player was at a given minute.
            {ratioTable.length > 0
              ? " A ratio is one figure over another for the same army, and is not per minute. A game where the lower figure is zero has no ratio, so it is left out of the average and counted beside it. The average is the mean of each game's own ratio with the median beside it, so a game with very little in the lower figure can pull the mean up."
              : ""}
          </p>

          {trendMetric && (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Trend, {basis},{" "}
                  {trendIsRatio ? "ratio with no unit" : "per minute"}
                </h3>
                <OptionSelect
                  size="sm"
                  className="w-48"
                  ariaLabel="Trend metric"
                  value={trendMetric.key}
                  onValueChange={setPicked}
                  options={[
                    ...metrics.map((m) => ({ value: m.key, label: m.label })),
                    ...shownRatios.map((r) => ({
                      value: r.key,
                      label: r.label,
                    })),
                  ]}
                />
                <span className="text-xs text-muted-foreground">
                  {games(points.length)}, oldest to newest
                </span>
              </div>
              <Trend
                points={points}
                label={trendMetric.label}
                describe={describeTrend}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
