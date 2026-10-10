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
import type { Metric, StatRecord } from "../../bindings";
import { formatRate } from "../../matchStats";
import {
  formatRateValue,
  leftOutNote,
  playerRateGames,
  type RateSummary,
  rateRows,
  type TrendPoint,
  trendSeries,
} from "../../playerMatchFigures";

/**
 * A player's match figures as rates: the average per minute for each metric the
 * store keeps totals for, the same split by result, and a trend over time (#1166).
 *
 * Everything is the player's own team's total from the stats store. Nothing
 * opens a replay. Every figure shows the number of games it is drawn from and
 * none is hidden below a size, because the codebase has no rule for when a
 * sample is big enough.
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

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: TrendPoint }[];
}) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  const result =
    p.won === true ? "Win" : p.won === false ? "Loss" : "No result";
  return (
    <div className="rounded-md border border-border/60 bg-popover p-2 text-xs shadow-md">
      <p className="font-medium">{shortDate(p.startTimeMs)}</p>
      <p className="tabular-nums">{formatRate(p.value)} per minute</p>
      <p className="text-muted-foreground">{result}</p>
    </div>
  );
}

function Trend({ points, label }: { points: TrendPoint[]; label: string }) {
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
        One game so far: {formatRate(points[0].value)} per minute on{" "}
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
            content={<TrendTooltip />}
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
}: {
  records: StatRecord[];
  playerName: string;
  refightFilenames: ReadonlySet<string>;
  /** The metrics the store keeps totals for: the registry's roster set. */
  metrics: Metric[];
}) {
  const data = useMemo(
    () => playerRateGames(records, playerName, metrics, refightFilenames),
    [records, playerName, metrics, refightFilenames],
  );
  const rows = useMemo(() => rateRows(data.list, metrics), [data, metrics]);
  // The registry's headline metric opens the trend, and the reader can pick any
  // other. The registry decides which, so no metric is named here.
  const [picked, setPicked] = useState("");
  const trendMetric =
    metrics.find((m) => m.key === picked) ??
    metrics.find((m) => m.headline) ??
    metrics[0];
  const points = useMemo(
    () => (trendMetric ? trendSeries(data.list, trendMetric.key) : []),
    [data, trendMetric],
  );
  const note = leftOutNote(data);
  const basis = `${playerName}'s team`;

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <h2 className="mb-1 text-sm font-medium">Match figures per minute</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Each figure is {basis} total divided by the match's minutes, averaged
        over the games below. The average is the mean of each game's own rate,
        with the median beside it. Where a team has more than one player, every
        player on it has the whole total.
      </p>

      {data.counted === 0 || metrics.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {metrics.length === 0
            ? "Match figures are not available yet."
            : `None of ${playerName}'s ${games(data.games)} has team totals recorded, so there are no figures to show.`}
          {note && metrics.length > 0 ? ` ${note}` : ""}
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            Drawn from {data.counted} of {games(data.games)}.{" "}
            {note ? `${note} ` : ""}
            {data.sharedTeamGames > 0
              ? `In ${games(data.sharedTeamGames)} the team had other players.`
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
            </table>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            A game with no recorded result is in All only. The store holds
            end-of-match totals, so these figures cannot say how far ahead a
            player was at a given minute.
          </p>

          {trendMetric && (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Trend, {basis}, per minute
                </h3>
                <OptionSelect
                  size="sm"
                  className="w-48"
                  ariaLabel="Trend metric"
                  value={trendMetric.key}
                  onValueChange={setPicked}
                  options={metrics.map((m) => ({
                    value: m.key,
                    label: m.label,
                  }))}
                />
                <span className="text-xs text-muted-foreground">
                  {games(points.length)}, oldest to newest
                </span>
              </div>
              <Trend points={points} label={trendMetric.label} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
