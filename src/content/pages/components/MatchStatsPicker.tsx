import { Fragment, memo } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { MetricKey } from "../../bindings";
import {
  type MetricTileGroup,
  type SparkLine,
  TILE_BOX,
} from "../../matchStats";

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

export function MatchStatsPicker({
  groups,
  value,
  plotHeight,
  onChange,
}: {
  groups: MetricTileGroup[];
  value: MetricKey;
  /** How tall the plot beside it is, so the column ends where the plot does. */
  plotHeight: number;
  onChange: (key: MetricKey) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      value={value}
      // Radix clears the value when the lit tile is pressed again, and a chart
      // with no metric has nothing to draw, so an empty change is ignored.
      onValueChange={(v) => v && onChange(v as MetricKey)}
      aria-label="Charted metric, showing each metric's shape"
      style={{ "--plot-h": `${plotHeight}px` } as React.CSSProperties}
      // Beside the plot on a wide window and under it on a narrow one, where a
      // column would leave neither readable. Under it, the tiles run across
      // instead of down, so the same fifteen fit in a few rows.
      className="order-last grid max-h-56 w-full grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] items-stretch gap-1 overflow-y-auto lg:order-first lg:max-h-[var(--plot-h)] lg:w-44 lg:shrink-0 lg:grid-cols-1"
    >
      {groups.map((g) => (
        <Fragment key={g.group}>
          <p className="col-span-full px-1 pt-1 text-[11px] font-medium text-muted-foreground">
            {g.label}
          </p>
          {g.tiles.map((t) => (
            <ToggleGroupItem
              key={t.metric.key}
              value={t.metric.key}
              className="h-auto w-full flex-col items-start gap-0.5 rounded-md border border-border/60 px-2 py-1.5 data-[state=on]:border-primary data-[state=on]:bg-primary/10"
            >
              <span className="w-full truncate text-left text-xs">
                {t.metric.label}
              </span>
              <Spark lines={t.lines} />
            </ToggleGroupItem>
          ))}
        </Fragment>
      ))}
    </ToggleGroup>
  );
}
