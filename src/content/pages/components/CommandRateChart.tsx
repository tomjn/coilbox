import { Button } from "@picoframe/frame";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDuration } from "@/lib/format";
import type { DemoInfo, OrderSource } from "../../bindings";
import {
  commandRows,
  SENDER_LABEL,
  SENDER_NOTE,
  sendersPresent,
} from "../../commandRates";
import { type ChartSeries, formatRate, seriesTeams } from "../../matchStats";
import { useReplayCommandRates } from "../../useReplayCommandRates";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";

/**
 * Commands per minute, as its own small chart under the match chart (#1149).
 *
 * It is not a metric in the registry. The registry is the trailer's decoded
 * fields and the chart's series are running totals of them, sampled by the
 * engine. These counts come from walking the order stream, are rates from the
 * start, and have no cumulative form, so they do not fit the picker, the small
 * multiples or the cumulative toggle. This chart takes the match chart's own
 * lines, so colours, names, the Players and Teams view and the roster's
 * unchecked seats carry over, and its time axis ends where the match chart's
 * does.
 *
 * The stream is walked when the reader asks for this chart, and not before.
 */

const axisTick = { fontSize: 11, fill: "currentColor", opacity: 0.65 };
const axisTime = (sec: number) => formatDuration(Math.round(sec));

// Line widths and dimming, as the match chart draws them.
const LINE_WIDTH = 2;
const LIT_LINE_WIDTH = 3.5;
const DIM_OPACITY = 0.2;

export function CommandRateChart({
  info,
  replayPath,
  series,
  endSec,
}: {
  info: DemoInfo;
  replayPath: string;
  /** The lines the match chart is drawing, already coloured. */
  series: ChartSeries[];
  /** Where the match chart's time axis ends, in seconds. */
  endSec: number;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<OrderSource>("selection");
  const read = useReplayCommandRates(replayPath);
  const emphasis = useSeriesEmphasis();
  const rates = read.result;

  const present = useMemo(() => (rates ? sendersPresent(rates) : []), [rates]);
  // The reader's pick, unless this replay has none of that sender's orders.
  const source = present.includes(chosen) ? chosen : (present[0] ?? chosen);
  const lines = useMemo(
    () => series.map((s) => ({ id: s.id, teams: seriesTeams(s, info) })),
    [series, info],
  );
  const built = useMemo(
    () => (rates ? commandRows(rates, lines, source) : null),
    [rates, lines, source],
  );
  const shown = series.filter((s) => built?.ids.includes(s.id));

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            setOpen(true);
            read.load();
          }}
        >
          Show commands per minute
        </Button>
      </div>
    );
  }

  const body = () => {
    if (read.loading || read.status === "idle")
      return <p className="text-xs text-muted-foreground">Reading orders…</p>;
    if (read.failed || !rates)
      return (
        <p className="text-xs text-destructive">
          The orders could not be read from this replay.
        </p>
      );
    if (present.length === 0)
      return (
        <p className="text-xs text-muted-foreground">
          This replay's order stream holds no orders to count.
        </p>
      );
    if (rates.buckets === 0)
      return (
        <p className="text-xs text-muted-foreground">
          This replay is shorter than one {rates.periodSec} second period, so
          there is no rate to draw.
        </p>
      );
    return (
      <>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={source}
          onValueChange={(v) => v && setChosen(v as OrderSource)}
          aria-label="Orders sent by"
          className="self-start"
        >
          {present.map((s) => (
            <ToggleGroupItem key={s} value={s} className="px-3 text-xs">
              {SENDER_LABEL[s]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">{SENDER_NOTE[source]}</p>
        {shown.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None of the lines on the chart above gave orders of this kind.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart
              data={built?.rows}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="currentColor"
                opacity={0.12}
                vertical={false}
              />
              <XAxis
                dataKey="timeSec"
                type="number"
                domain={[0, Math.max(endSec, rates.buckets * rates.periodSec)]}
                tickFormatter={axisTime}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
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
                formatter={(v) => `${formatRate(Number(v))} a minute`}
                labelFormatter={(t) => axisTime(Number(t))}
                isAnimationActive={false}
              />
              {shown.map((s) => {
                const lit = emphasis.isLit(seriesTeams(s, info));
                return (
                  <Line
                    key={s.id}
                    type="monotone"
                    dataKey={s.id}
                    name={s.label}
                    stroke={s.color}
                    strokeWidth={lit ? LIT_LINE_WIDTH : LINE_WIDTH}
                    strokeOpacity={emphasis.dimming && !lit ? DIM_OPACITY : 1}
                    dot={false}
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
        <p className="text-xs text-muted-foreground">
          Orders given in each {rates.periodSec} second stretch, shown as a rate
          per minute.
          {rates.periodIsDefault &&
            " The replay named no period, so the engine's default is used."}{" "}
          One order is one command. This is not the same count as the trailer's,
          so neither checks the other.
          {rates.trailing > 0 &&
            ` ${rates.trailing.toLocaleString()} orders in the last part-period are left out.`}
          {rates.pregame > 0 &&
            ` ${rates.pregame.toLocaleString()} orders before the game started are left out.`}
          {rates.unattributed > 0 &&
            ` ${rates.unattributed.toLocaleString()} orders from players with no team are left out.`}
          {rates.incomplete &&
            " This replay could not be read to the end, so later orders may be missing."}
        </p>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border/50 pt-3">
      <h3 className="text-sm font-medium">Commands per minute</h3>
      {body()}
    </div>
  );
}
