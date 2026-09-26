/**
 * The pure half of the Reference page's scatter plot (issue #3115): which
 * point each unit plots to, and whether it gets a faint "game position" dot.
 *
 * Split out of `UnitScatterPlot.tsx` the same way `matchStats.ts` is split
 * out of `MatchStatsChart.tsx`: vitest runs in node and cannot render a
 * recharts chart, so the reasoning that a test can actually check - which
 * axis is the default, which rows get plotted, which get a ghost - lives
 * here, and the component is recharts wiring around it and nothing else.
 */
import {
  REFERENCE_COLUMNS,
  type ReferenceColumn,
  sameValue,
  type UnitReferenceRow,
} from "./unitReference";

/** Metal cost against DPS: the question a balance pass actually asks, on
 *  first paint (issue #3115's own example). */
export const DEFAULT_X_COLUMN = "metalCost";
export const DEFAULT_Y_COLUMN = "dps";

/** The only two columns that span the several orders of magnitude a log
 *  scale is for. A log toggle is offered only when the axis showing it is
 *  one of these two, rather than on every column, since a log scale over a
 *  small, even range like sight distance reads as noise rather than help. */
export function canLogColumn(columnId: string): boolean {
  return columnId === "metalCost" || columnId === "health";
}

export function referenceColumn(id: string): ReferenceColumn {
  return REFERENCE_COLUMNS.find((c) => c.id === id) ?? REFERENCE_COLUMNS[0];
}

/** One unit's plotted point: its current position, and its position before
 *  this project's edits when that position exists and differs (issue
 *  #3115's faint dot joined by a line). */
export interface ScatterPoint {
  key: string;
  x: number;
  y: number;
  ghost?: { x: number; y: number };
  row: UnitReferenceRow;
}

/**
 * `rows` (already filtered by the page's search query, faction filter and
 * collection) plotted against `xColumn`/`yColumn`.
 *
 * A row missing either axis's value is left off the plot rather than drawn
 * at zero, since zero on a derived column like DPS usually means "this unit
 * has no weapon" rather than "this unit does none". A log-scale axis leaves
 * off a non-positive value too, the same rule applied to the ghost's own
 * position so a unit that used to cost nothing does not draw a dangling
 * line to nowhere.
 *
 * `baselineOf` is the unit's game-unedited row (absent entirely on a page
 * with no project to compare against). A row gets a ghost only when the
 * baseline exists, plots on both axes, and differs from the current point:
 * a unit nobody touched, or a clone the game never had, gets one dot and no
 * line.
 */
export function computeScatterPoints(
  rows: UnitReferenceRow[],
  xColumn: ReferenceColumn,
  yColumn: ReferenceColumn,
  useLogX: boolean,
  useLogY: boolean,
  baselineOf?: (key: string) => UnitReferenceRow | undefined,
): ScatterPoint[] {
  return rows.flatMap((row): ScatterPoint[] => {
    const x = xColumn.value(row);
    const y = yColumn.value(row);
    if (x === undefined || y === undefined) return [];
    if ((useLogX && x <= 0) || (useLogY && y <= 0)) return [];

    const baseline = baselineOf?.(row.key);
    const bx = baseline ? xColumn.value(baseline) : undefined;
    const by = baseline ? yColumn.value(baseline) : undefined;
    const ghostValid =
      bx !== undefined &&
      by !== undefined &&
      (!useLogX || bx > 0) &&
      (!useLogY || by > 0) &&
      !(sameValue(x, bx) && sameValue(y, by));

    return [
      {
        key: row.key,
        x,
        y,
        ghost: ghostValid ? { x: bx as number, y: by as number } : undefined,
        row,
      },
    ];
  });
}
