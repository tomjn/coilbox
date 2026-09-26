/**
 * A cost-against-effectiveness scatter for the Reference page (issue #3115):
 * one dot per unit, so a unit far off the trend line is something a reader
 * spots rather than something they find by reading every row of the table.
 *
 * The axes are two of `REFERENCE_COLUMNS`, the same numeric columns the
 * table sorts by, defaulting to metal cost against DPS. `rows` is already
 * filtered by the search query and faction filter the table itself shows,
 * read the same way from `UnitReferenceView` so the plot never disagrees
 * with the table about which units are on screen. Neither page has a
 * collection filter on this table yet, so there is none for the plot to
 * share either.
 *
 * `baselineOf` answers the game's own row for a unit, unedited: absent
 * entirely on the game's own reference page (`UnitReferencePage.tsx`), which
 * has no project to compare against, so that page draws only the current
 * dot. Inside a project (`ReferencePage.tsx`), a unit the project changed
 * gets a second, faint dot at the game's position, joined to the current one
 * by a line, the same "before this edit" comparison the change ledger shows
 * elsewhere in the workshop.
 *
 * Which point each unit plots to and which gets a ghost is `unitScatter.ts`,
 * not here: vitest can check that reasoning directly, and this file is the
 * recharts wiring around it, the same split `MatchStatsChart.tsx` makes
 * against `matchStats.ts`.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis,
} from "recharts";
import { CheckField } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import type { UnitDisplay } from "@/content/bindings";
import { UnitIcon } from "@/content/pages/components/UnitIcon";
import {
  formatReferenceValue,
  REFERENCE_COLUMNS,
  type UnitReferenceRow,
} from "../../unitReference";
import {
  canLogColumn,
  computeScatterPoints,
  DEFAULT_X_COLUMN,
  DEFAULT_Y_COLUMN,
  type ScatterPoint as PlotPoint,
  referenceColumn,
} from "../../unitScatter";

const axisTick = { fontSize: 11, fill: "currentColor", opacity: 0.65 };

/** The faint dot at a changed unit's game position, and the line from it to
 *  where the project's edits moved it. A plain SVG overlay rather than a
 *  second `Scatter`, because only this layer needs both ends of the pair at
 *  once: `Scatter`'s own points know their own value, not their unit's other
 *  dot. Reads the chart's live axis scales the way `MatchStatsChart.tsx`'s
 *  `EndLabels` does, so it must render as a child of the chart itself. */
function GhostLayer({ points }: { points: PlotPoint[] }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!xScale || !yScale) return null;

  return (
    <g>
      {points.flatMap((p) => {
        if (!p.ghost) return [];
        const cx = xScale(p.x);
        const cy = yScale(p.y);
        const gx = xScale(p.ghost.x);
        const gy = yScale(p.ghost.y);
        if (![cx, cy, gx, gy].every((n) => Number.isFinite(n))) return [];
        return [
          <g key={p.key}>
            <line
              x1={gx}
              y1={gy}
              x2={cx}
              y2={cy}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeWidth={1}
            />
            <circle
              cx={gx}
              cy={gy}
              r={4}
              fill="currentColor"
              fillOpacity={0.3}
            />
          </g>,
        ];
      })}
    </g>
  );
}

function PointTooltip({
  active,
  payload,
  xLabel,
  yLabel,
  picOf,
  picsPending,
}: {
  active?: boolean;
  payload?: { payload: PlotPoint }[];
  xLabel: string;
  yLabel: string;
  picOf?: (key: string) => UnitDisplay | undefined;
  picsPending?: boolean;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-popover px-2 py-1.5 text-xs shadow-md">
      {picOf && (
        <UnitIcon display={picOf(point.row.key)} pending={picsPending} />
      )}
      <div className="flex flex-col">
        <span className="font-medium">{point.row.name}</span>
        <span className="text-muted-foreground">
          {xLabel} {formatReferenceValue(point.x)} · {yLabel}{" "}
          {formatReferenceValue(point.y)}
        </span>
      </div>
    </div>
  );
}

export function UnitScatterPlot({
  rows,
  baselineOf,
  unitHref,
  picOf,
  picsPending,
}: {
  /** Already filtered by `UnitReferenceView`, the same set the table shows. */
  rows: UnitReferenceRow[];
  /** The unit's row before this project's edits (issue #3115), absent on the
   *  game's own reference page where there is no project to compare
   *  against. */
  baselineOf?: (key: string) => UnitReferenceRow | undefined;
  /** Where a dot's click lands: the unit's own editor or encyclopedia page,
   *  whichever the caller's page offers. */
  unitHref: (row: UnitReferenceRow) => string;
  picOf?: (key: string) => UnitDisplay | undefined;
  picsPending?: boolean;
}) {
  const navigate = useNavigate();
  const [xId, setXId] = useState(DEFAULT_X_COLUMN);
  const [yId, setYId] = useState(DEFAULT_Y_COLUMN);
  const [logX, setLogX] = useState(false);
  const [logY, setLogY] = useState(false);

  const xColumn = referenceColumn(xId);
  const yColumn = referenceColumn(yId);
  const useLogX = canLogColumn(xId) && logX;
  const useLogY = canLogColumn(yId) && logY;

  const points = useMemo(
    () =>
      computeScatterPoints(
        rows,
        xColumn,
        yColumn,
        useLogX,
        useLogY,
        baselineOf,
      ),
    [rows, xColumn, yColumn, useLogX, useLogY, baselineOf],
  );

  const columnOptions = REFERENCE_COLUMNS.map((c) => ({
    value: c.id,
    label: c.label,
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            X axis
          </span>
          <div className="flex items-center gap-2">
            <OptionSelect
              value={xId}
              onValueChange={setXId}
              ariaLabel="X axis"
              className="h-9 w-48"
              options={columnOptions}
            />
            {canLogColumn(xId) && (
              <CheckField label="Log scale" checked={logX} onChange={setLogX} />
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Y axis
          </span>
          <div className="flex items-center gap-2">
            <OptionSelect
              value={yId}
              onValueChange={setYId}
              ariaLabel="Y axis"
              className="h-9 w-48"
              options={columnOptions}
            />
            {canLogColumn(yId) && (
              <CheckField label="Log scale" checked={logY} onChange={setLogY} />
            )}
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={360}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            opacity={0.12}
          />
          <XAxis
            type="number"
            dataKey="x"
            name={xColumn.label}
            scale={useLogX ? "log" : "auto"}
            domain={useLogX ? ["auto", "auto"] : [0, "auto"]}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatReferenceValue(v as number)}
            label={{
              value: xColumn.label,
              position: "insideBottom",
              offset: -4,
              fontSize: 11,
              fill: "currentColor",
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yColumn.label}
            scale={useLogY ? "log" : "auto"}
            domain={useLogY ? ["auto", "auto"] : [0, "auto"]}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v) => formatReferenceValue(v as number)}
            label={{
              value: yColumn.label,
              angle: -90,
              position: "insideLeft",
              fontSize: 11,
              fill: "currentColor",
            }}
          />
          <Tooltip
            content={
              <PointTooltip
                xLabel={xColumn.label}
                yLabel={yColumn.label}
                picOf={picOf}
                picsPending={picsPending}
              />
            }
            cursor={{ strokeDasharray: "3 3", opacity: 0.35 }}
            isAnimationActive={false}
          />
          <GhostLayer points={points} />
          <Scatter
            data={points}
            fill="var(--color-primary)"
            cursor="pointer"
            isAnimationActive={false}
            onClick={(point) => {
              const p = (point as { payload?: PlotPoint } | undefined)?.payload;
              if (p) navigate(unitHref(p.row));
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
