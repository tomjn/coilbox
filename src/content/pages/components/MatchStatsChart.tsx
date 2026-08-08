import { useMemo, useState } from "react";
import {
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DemoInfo, DemoTrailer, Metric } from "../../bindings";
import {
  type ChartRow,
  type ChartSeries,
  chartRows,
  defaultMetric,
  END_LABEL_MAX_SERIES,
  formatDuration,
  formatTotal,
  lastPointIndex,
  metricGroups,
  secondsPerFrame,
  teamSeries,
  tooltipRows,
} from "../../matchStats";

/**
 * The match's chart: one line per team over match time, and a control that picks
 * which of the registry's metrics it draws.
 *
 * Everything the chart derives is in `matchStats.ts`, because vitest runs in node
 * and can't render a component. This file is the recharts wiring and nothing else.
 *
 * Nothing here names a metric. The dropdown is built from the published registry,
 * and `metricRegistry.test.ts` fails if a key is ever spelled out in a component.
 */

// recharts renders SVG and can't read a CSS custom property, so series colours
// are concrete hex (from the teams themselves) and the axes and gridlines use
// currentColor at low opacity so they follow the theme.
const axisTick = { fontSize: 11, fill: "currentColor", opacity: 0.65 };

/** Long enough to tell two players apart, short enough to sit beside the plot. */
const END_LABEL_MAX_CHARS = 14;

/** Room on the right for the end-point labels, in pixels. */
const END_LABEL_GUTTER = 88;

const axisTime = (sec: number) => formatDuration(Math.round(sec));

function clip(label: string): string {
  return label.length > END_LABEL_MAX_CHARS
    ? `${label.slice(0, END_LABEL_MAX_CHARS - 1)}…`
    : label;
}

/** The metric chooser, grouped the way the registry groups its metrics. */
function MetricPicker({
  metrics,
  value,
  onChange,
}: {
  metrics: Metric[];
  value: string;
  onChange: (key: string) => void;
}) {
  const groups = useMemo(() => metricGroups(metrics), [metrics]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-56" aria-label="Charted metric">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.map((g) => (
          <SelectGroup key={g.group}>
            <SelectLabel>{g.label}</SelectLabel>
            {g.metrics.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                {m.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Every series at the sample under the crosshair, biggest first. recharts clones
 * this element with `active` and `payload`, and one payload entry carries the
 * whole row, so the sorting and the cap happen once over the row rather than
 * per series.
 */
function SeriesTooltip({
  series,
  active,
  payload,
}: {
  series: ChartSeries[];
  active?: boolean;
  payload?: { payload?: ChartRow }[];
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const { rows, hidden } = tooltipRows(series, row);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border border-border/60 bg-popover p-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{axisTime(row.timeSec)}</p>
      <ul className="flex flex-col gap-0.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: r.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums">
              {formatTotal(r.value)}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-1 text-muted-foreground">and {hidden} more</p>
      )}
    </div>
  );
}

/** A series' name, drawn once at the end of its own line. */
function endLabel(label: string, color: string, at: number) {
  return function EndLabel(props: {
    x?: number | string;
    y?: number | string;
    index?: number;
  }) {
    if (props.index !== at) return null;
    const x = Number(props.x);
    const y = Number(props.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return (
      <text x={x + 6} y={y} dy={4} fill={color} fontSize={11}>
        {clip(label)}
      </text>
    );
  };
}

export function MatchStatsChart({
  info,
  trailer,
  metrics,
}: {
  info: DemoInfo;
  trailer: DemoTrailer;
  metrics: Metric[];
}) {
  const opening = defaultMetric(metrics);
  const [key, setKey] = useState(opening?.key ?? "");
  const metric = metrics.find((m) => m.key === key) ?? opening;

  const series = useMemo(() => teamSeries(trailer, info), [trailer, info]);
  const rows = useMemo(
    () =>
      metric ? chartRows(series, metric.key, secondsPerFrame(trailer)) : [],
    [series, metric, trailer],
  );

  if (!metric || series.length === 0 || rows.length === 0) return null;

  // Four or fewer lines get their names at their end points, and the legend's
  // colour-matching job disappears with them.
  const labelled = series.length <= END_LABEL_MAX_SERIES;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3">
      {/* The control row. #1137 (cumulative or per minute), #1138 (players or
       * sides) and #1140 (the value table's own controls) land beside the
       * picker: the chart's inputs are all state in this component, and the two
       * that change what is plotted are arguments to `teamSeries` and
       * `chartRows` rather than anything the chart itself has to know. */}
      <div className="flex flex-wrap items-center gap-2">
        <MetricPicker metrics={metrics} value={metric.key} onChange={setKey} />
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={rows}
          margin={{
            top: 8,
            right: labelled ? END_LABEL_GUTTER : 8,
            bottom: 0,
            left: 0,
          }}
        >
          {/* Horizontal only. A vertical grid over a time axis adds lines
           * without adding a reading. */}
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            opacity={0.12}
            vertical={false}
          />
          <XAxis
            dataKey="timeSec"
            type="number"
            domain={[0, "dataMax"]}
            tickFormatter={axisTime}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            minTickGap={32}
          />
          {/* Anchored at zero. A chart of resources that starts at 40,000 tells
           * a lie about the first ten minutes. */}
          <YAxis
            domain={[0, "auto"]}
            tickFormatter={formatTotal}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={52}
          />
          <Tooltip
            content={<SeriesTooltip series={series} />}
            cursor={{ stroke: "currentColor", strokeOpacity: 0.35 }}
            isAnimationActive={false}
          />
          {!labelled && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s) => (
            <Line
              key={s.id}
              type="monotone"
              dataKey={s.id}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            >
              {labelled && (
                <LabelList
                  dataKey={s.id}
                  content={endLabel(
                    s.label,
                    s.color,
                    lastPointIndex(rows, s.id),
                  )}
                />
              )}
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* The value table (#1140) belongs under the chart, reading the same
       * `series` and `rows` this does. */}
    </div>
  );
}
