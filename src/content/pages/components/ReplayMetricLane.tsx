import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DemoInfo, Metric } from "../../bindings";
import {
  type ChartMode,
  defaultMetric,
  hasStatistics,
  modeRows,
  type SparkLine,
  secondsPerFrame,
  seriesTeams,
  sparkLines,
  TILE_BOX,
} from "../../matchStats";
import { labelOfMetric } from "../../metricLabels";
import { useChartSeries } from "../../useChartSeries";
import { useMatchStats } from "../../useMatchStats";
import { useChartChoice, useSeriesEmphasis } from "../../useSeriesEmphasis";
import { MetricSelectGroups } from "./MetricSelectGroups";

/**
 * The timeline dock's metric lane (#5308): the metric the statistics chart has
 * picked, drawn as a small line chart on the dock's axis, for the players or
 * teams the chart draws, in the chart's colours.
 *
 * The lane has two parts, because the dock puts a lane's name in one column and
 * its row in another. {@link useMetricLane} works out what both draw from, and
 * {@link MetricLaneLabel} and {@link MetricLanePlot} draw it.
 */

/** A line of the lane, and the engine teams it stands for. */
export interface MetricLaneLine extends SparkLine {
  teams: readonly number[];
}

export interface MetricLane {
  /** What the label's list offers. */
  metrics: Metric[];
  metric: Metric;
  mode: ChartMode;
  lines: MetricLaneLine[];
  pick: (key: string) => void;
}

/**
 * The lane's data, or null when there is no lane: the profile hides statistics,
 * the replay has none, or the chart has no line to draw.
 *
 * `spanSec` is what the dock's axis is long, so a line's time lines up with the
 * marks above it.
 */
export function useMetricLane(
  info: DemoInfo,
  replayPath: string | null,
  spanSec: number,
): MetricLane | null {
  const { data } = useMatchStats(replayPath);
  const trailer = data && hasStatistics(data.trailer) ? data.trailer : null;
  const { series, drawn } = useChartSeries(info, trailer);
  const { metric: key, mode, setMetric } = useChartChoice();
  const metrics = data?.metrics;
  const metric =
    metrics?.find((m) => m.key === key) ??
    (metrics ? defaultMetric(metrics) : undefined);

  const lines = useMemo(() => {
    if (!trailer || !metric) return [];
    const rows = modeRows(drawn, metric.key, secondsPerFrame(trailer), mode);
    return sparkLines(drawn, rows, spanSec).map((line, i) => ({
      ...line,
      teams: seriesTeams(drawn[i], info),
    }));
  }, [trailer, metric, drawn, mode, spanSec, info]);

  if (!metrics || !metric || series.length === 0) return null;
  return { metrics, metric, mode, lines, pick: setMetric };
}

/**
 * The lane's name, which is the metric, and the way to change it: pressing it
 * opens the chart's own list of metrics.
 */
export function MetricLaneLabel({
  lane,
  id,
}: {
  lane: MetricLane;
  id: string;
}) {
  const { t } = useLingui();
  const name = labelOfMetric(lane.metric);
  return (
    <Select value={lane.metric.key} onValueChange={lane.pick}>
      <SelectTrigger
        id={id}
        size="sm"
        // Holds the visible name and says what pressing it does.
        aria-label={t`Metric in the timeline: ${name}`}
        className="h-full w-full min-w-0 justify-start gap-1 border-0 bg-transparent px-0 py-0 text-left text-xs whitespace-normal text-muted-foreground shadow-none data-[size=sm]:h-full *:data-[slot=select-value]:line-clamp-2 dark:bg-transparent dark:hover:bg-transparent"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <MetricSelectGroups metrics={lane.metrics} />
      </SelectContent>
    </Select>
  );
}

/** Line widths, in pixels. A lit line is wider and the others fade, as on the chart. */
const LINE_WIDTH = 1.5;
const LIT_LINE_WIDTH = 2.5;
const DIM_OPACITY = 0.2;

/** The lane's lines, across the dock's axis. */
export function MetricLanePlot({ lane }: { lane: MetricLane }) {
  const { t } = useLingui();
  const emphasis = useSeriesEmphasis();
  const name = labelOfMetric(lane.metric);
  const values = lane.mode === "perMinute" ? t`per minute` : t`running total`;
  return (
    <svg
      role="img"
      aria-label={`${name}, ${values}`}
      data-testid="metric-lane-plot"
      viewBox={`0 0 ${TILE_BOX.width} ${TILE_BOX.height}`}
      // Stretched to the lane rather than fitted: the width is the match and the
      // height is the biggest reading, whatever the window.
      preserveAspectRatio="none"
      className="absolute inset-0 size-full"
      focusable="false"
    >
      {lane.lines.map((line) => {
        const lit = emphasis.isLit(line.teams);
        return (
          <path
            key={line.id}
            d={line.d}
            fill="none"
            stroke={line.color}
            strokeWidth={lit ? LIT_LINE_WIDTH : LINE_WIDTH}
            strokeOpacity={emphasis.dimming && !lit ? DIM_OPACITY : 1}
            strokeLinecap="round"
            strokeLinejoin="round"
            // The box is stretched, so without this the stroke is too.
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
