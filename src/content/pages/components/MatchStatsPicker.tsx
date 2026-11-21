import { i18n } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import { Fragment, memo } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type MetricTileGroup,
  type SparkLine,
  TILE_BOX,
} from "../../matchStats";
import { labelOfMetric } from "../../metricLabels";
import {
  labelOfEntry,
  REPLAY_ENTRIES,
  REPLAY_ENTRIES_HEADING,
} from "../../replayEntries";

/**
 * Which metric the chart draws, picked by looking at all of them (#1141).
 *
 * A dropdown names fifteen metrics and shows none, so the one that explains a
 * match is only found by opening all fifteen. Here every metric is its own
 * shape, and the odd one out is visible without reading a word: metal excess,
 * flat for everybody and then vertical for one player, is somebody dying and
 * dumping their resources, and nobody would have thought to look for it.
 *
 * The shapes arrive already drawn, from `sparklineTiles` in `matchStats.ts`,
 * which is the same derivation the plot uses. This file places them and nothing
 * else. Nothing here names a metric: the groups are the registry's own.
 *
 * A tile has no axis, no gridline, no tooltip and no legend. It is a shape. The
 * plot beside it is where a figure is read and the table is where it is read
 * exactly.
 */

/** How tall a tile's line is drawn, in pixels. */
const SPARK_HEIGHT = 26;

/**
 * One tile's lines.
 *
 * Held apart from the tile so that picking a different metric re-renders the
 * lit tile and the one that went out, and leaves the other thirteen alone:
 * `lines` comes from the cache, so it is the same array it was last render and
 * this bails out.
 */
const Spark = memo(function Spark({ lines }: { lines: SparkLine[] }) {
  return (
    <svg
      viewBox={`0 0 ${TILE_BOX.width} ${TILE_BOX.height}`}
      // Stretched to the tile rather than fitted, because a sparkline's job is
      // the shape over the whole match and not the aspect it was drawn at.
      preserveAspectRatio="none"
      // Sized here rather than by a class: the toggle's own variants size every
      // svg inside an item to 16px, which is right for an icon and not for this.
      style={{ width: "100%", height: SPARK_HEIGHT }}
      aria-hidden="true"
      focusable="false"
    >
      {lines.map((l) => (
        <path
          key={l.id}
          d={l.d}
          fill="none"
          stroke={l.color}
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          // The box is stretched, so without this the stroke is stretched too
          // and a wide tile draws hairlines horizontally and bars vertically.
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
});

/**
 * The preview of an entry whose data is read only when it is picked (#5321): a
 * dashed baseline in the space a shape would take, so its tile lines up with
 * its neighbours and says no shape is drawn yet.
 */
function Unread() {
  return (
    <svg
      viewBox={`0 0 ${TILE_BOX.width} ${TILE_BOX.height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: SPARK_HEIGHT }}
      aria-hidden="true"
      focusable="false"
    >
      <line
        x1={0}
        x2={TILE_BOX.width}
        y1={TILE_BOX.height - 1}
        y2={TILE_BOX.height - 1}
        stroke="currentColor"
        strokeOpacity={0.35}
        strokeWidth={1.25}
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Tile({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return (
    <ToggleGroupItem
      value={value}
      // `justify-between` keeps the sparklines on one line of the grid
      // level with each other when a neighbour's label takes two lines.
      // Without it the tiles stretch to the tallest in the row and each
      // shape sits wherever its own label left it.
      //
      // The label is wrapped, not truncated. Six across at 810px leaves 95px
      // for one and "Damage received" needs 100px, and a metric whose name you
      // can't read is a tile nobody clicks. `whitespace-normal` is not spare:
      // the toggle item sets `whitespace-nowrap` on itself and the span
      // inherits it, so dropping `truncate` alone would spill the label out of
      // the tile instead of wrapping it.
      className="h-auto w-full flex-col items-start justify-between gap-0.5 rounded-md border border-border/60 px-2 py-1.5 data-[state=on]:border-primary data-[state=on]:bg-primary/10"
    >
      {children}
    </ToggleGroupItem>
  );
}

export function MatchStatsPicker({
  groups,
  value,
  plotHeight,
  onChange,
}: {
  groups: MetricTileGroup[];
  /** A metric's key, or one of the replay entries'. */
  value: string;
  /** How tall the plot beside it is, so the column ends where the plot does. */
  plotHeight: number;
  onChange: (key: string) => void;
}) {
  const { t } = useLingui();
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      value={value}
      // Radix clears the value when the lit tile is pressed again, and a chart
      // with no metric has nothing to draw, so an empty change is ignored.
      onValueChange={(v) => v && onChange(v)}
      aria-label={t`Charted metric, showing each metric's shape`}
      style={{ "--plot-h": `${plotHeight}px` } as React.CSSProperties}
      // Beside the plot on a wide window and under it on a narrow one, where a
      // column would leave neither readable. Under it, the tiles run across
      // instead of down, so the same fifteen fit in a few rows.
      //
      // The cap and the scroll belong to the column only (#1216). Beside the
      // plot the column is far taller than the plot it sits next to, so it ends
      // where the plot ends and scrolls. Under it, three rows fit on the page,
      // and a scrolling box inside a scrolling page hides the group headings
      // and the very thing the picker is for: seeing all fifteen at once.
      className="order-last grid w-full grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] items-stretch gap-1 lg:order-first lg:max-h-[var(--plot-h)] lg:w-44 lg:shrink-0 lg:grid-cols-1 lg:overflow-y-auto"
    >
      {groups.map((g) => (
        <Fragment key={g.group}>
          <p className="col-span-full px-1 pt-1 text-[11px] font-medium text-muted-foreground">
            {g.label}
          </p>
          {g.tiles.map((t) => (
            <Tile key={t.metric.key} value={t.metric.key}>
              <span className="w-full text-left text-xs whitespace-normal">
                {labelOfMetric(t.metric)}
              </span>
              <Spark lines={t.lines} />
            </Tile>
          ))}
        </Fragment>
      ))}
      <p className="col-span-full px-1 pt-1 text-[11px] font-medium text-muted-foreground">
        {i18n._(REPLAY_ENTRIES_HEADING)}
      </p>
      {REPLAY_ENTRIES.map((e) => (
        <Tile key={e.key} value={e.key}>
          <span className="w-full text-left text-xs whitespace-normal">
            {labelOfEntry(e)}
          </span>
          <Unread />
        </Tile>
      ))}
    </ToggleGroup>
  );
}
