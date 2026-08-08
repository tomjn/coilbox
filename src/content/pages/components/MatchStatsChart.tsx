import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DemoInfo, DemoTrailer, Metric } from "../../bindings";
import {
  allySeries,
  type ChartDisplay,
  type ChartMode,
  type ChartRow,
  type ChartSeries,
  type ChartView,
  chartHeight,
  defaultChartView,
  defaultMetric,
  END_LABEL_MAX_SERIES,
  type EndPoint,
  endPoints,
  formatChartValue,
  formatDuration,
  formatRate,
  metricGroups,
  modeRows,
  secondsPerFrame,
  spreadLabels,
  teamSeries,
  tooltipRows,
  valueTable,
} from "../../matchStats";
import { MatchStatsTable } from "./MatchStatsTable";

/**
 * The match's chart: a line per seat or a line per side over match time, a
 * control that picks which of the registry's metrics it draws, one that picks
 * whether it draws the running totals the file recorded or the rate they were
 * rising at, one that picks which of those two sets of lines it draws, and one
 * that swaps the plot for the same figures printed as a table (#1140).
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
 * A pair of buttons rather than a second dropdown, because each of these is a
 * choice between two views of the same match and not a setting: both options
 * stay on screen, and which one is showing is the button that is lit.
 */
function Choice<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  label: string;
  onChange: (value: T) => void;
}) {
  const item =
    "rounded-md border border-border/60 px-3 py-1 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10";
  return (
    <ToggleGroup
      type="single"
      value={value}
      // Radix clears the value when the lit button is pressed again, and there
      // is no third option to fall back to, so an empty change is ignored.
      onValueChange={(v) => v && onChange(v as T)}
      className="gap-2"
      aria-label={label}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className={item}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const MODES: { value: ChartMode; label: string }[] = [
  { value: "cumulative", label: "Cumulative" },
  { value: "perMinute", label: "Per minute" },
];

const VIEWS: { value: ChartView; label: string }[] = [
  { value: "players", label: "Players" },
  { value: "teams", label: "Teams" },
];

const DISPLAYS: { value: ChartDisplay; label: string }[] = [
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
];

/**
 * Every series at the sample under the crosshair, biggest first. recharts clones
 * this element with `active` and `payload`, and one payload entry carries the
 * whole row, so the sorting and the cap happen once over the row rather than
 * per series.
 */
function SeriesTooltip({
  series,
  format,
  active,
  payload,
}: {
  series: ChartSeries[];
  format: (value: number) => string;
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
            <span className="shrink-0 tabular-nums">{format(r.value)}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-1 text-muted-foreground">and {hidden} more</p>
      )}
    </div>
  );
}

/** Vertical room one end-point label needs, in pixels. */
const END_LABEL_GAP = 14;

/** A label more than this far from its line gets a leader drawn to it. */
const LEADER_THRESHOLD = 2;

/**
 * Every series' name at the end of its own line, laid out together so two lines
 * that finish on nearly the same figure don't print one name over the other.
 * recharts' own `LabelList` places each series on its own, which is exactly the
 * case a duel produces, so this reads the axis scales instead.
 */
function EndLabels({ points }: { points: EndPoint[] }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (!xScale || !yScale || !plot) return null;

  const placed = points
    .map((p) => ({ ...p, x: xScale(p.timeSec), y: yScale(p.value) }))
    .filter(
      (p): p is EndPoint & { x: number; y: number } =>
        Number.isFinite(p.x) && Number.isFinite(p.y),
    );
  const spread = spreadLabels(
    placed,
    END_LABEL_GAP,
    plot.y,
    plot.y + plot.height,
  );
  // `y` is the label's own row after spreading, `line` is where its line ended.
  const lineY = new Map(placed.map((p) => [p.id, p.y]));

  return (
    <g>
      {spread.map((p) => {
        const from = lineY.get(p.id) ?? p.y;
        return (
          <g key={p.id}>
            {Math.abs(from - p.y) > LEADER_THRESHOLD && (
              <polyline
                points={`${p.x},${from} ${p.x + 4},${p.y}`}
                fill="none"
                stroke={p.color}
                strokeWidth={1}
                opacity={0.6}
              />
            )}
            <text x={p.x + 6} y={p.y} dy={4} fill={p.color} fontSize={11}>
              {clip(p.label)}
            </text>
          </g>
        );
      })}
    </g>
  );
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
  const [mode, setMode] = useState<ChartMode>("cumulative");
  // Null until the reader picks one, so the opening view follows the match's own
  // size without an effect that would overwrite what they chose.
  const [chosen, setChosen] = useState<ChartView | null>(null);
  const [display, setDisplay] = useState<ChartDisplay>("chart");
  const metric = metrics.find((m) => m.key === key) ?? opening;

  const players = useMemo(() => teamSeries(trailer, info), [trailer, info]);
  const sides = useMemo(() => allySeries(trailer, info), [trailer, info]);
  const view = chosen ?? defaultChartView(players, sides);
  const series = view === "teams" ? sides : players;

  const rows = useMemo(
    () =>
      metric
        ? modeRows(series, metric.key, secondsPerFrame(trailer), mode)
        : [],
    [series, metric, trailer, mode],
  );
  const formatValue = mode === "perMinute" ? formatRate : formatChartValue;
  // The same rows the plot draws, printed. Nothing is asked of the trailer a
  // second time, so the two can't answer different questions.
  const table = useMemo(
    () => (metric ? valueTable(series, rows, { metric, mode, view }) : null),
    [series, rows, metric, mode, view],
  );

  if (!metric || !table || series.length === 0 || rows.length === 0)
    return null;

  // Four or fewer lines get their names at their end points, and the legend's
  // colour-matching job disappears with them.
  const labelled = series.length <= END_LABEL_MAX_SERIES;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3">
      {/* The control row. Every one of these picks which pure function runs
       * over the trailer, and the last picks whether the answer is drawn or
       * printed, so the table needs nothing the plot didn't already have. */}
      <div className="flex flex-wrap items-center gap-2">
        <MetricPicker metrics={metrics} value={metric.key} onChange={setKey} />
        <Choice
          value={mode}
          options={MODES}
          label="Charted values"
          onChange={setMode}
        />
        <Choice
          value={view}
          options={VIEWS}
          label="Charted lines"
          onChange={setChosen}
        />
        <Choice
          value={display}
          options={DISPLAYS}
          label="Shown as"
          onChange={setDisplay}
        />
      </div>

      {display === "table" ? (
        <MatchStatsTable table={table} />
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight(series.length)}>
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
              tickFormatter={formatValue}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Tooltip
              content={<SeriesTooltip series={series} format={formatValue} />}
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
              />
            ))}
            {labelled && <EndLabels points={endPoints(series, rows)} />}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
