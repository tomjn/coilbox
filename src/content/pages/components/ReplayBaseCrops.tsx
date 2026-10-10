import { cn } from "@picoframe/frame";
import { useMemo } from "react";
import { formatDuration } from "@/lib/format";
import type { BuildOrder, DemoInfo, UnitDatasetEntry } from "../../bindings";
import {
  type BaseCrop,
  baseCrops,
  cropImageBox,
  cropSide,
} from "../../replayBaseCrops";
import {
  CATEGORY_LABEL,
  CATEGORY_SHAPE,
  MARK_SHAPES,
  type MapWorld,
  NEUTRAL_SHAPE,
  NEUTRAL_TEAM_COLOUR,
  type StartDot,
} from "../../replayMapLayers";
import { teamLabel } from "../../replaySideLabel";
import type { TimeWindow } from "../../replayTimeWindow";
import { UNIT_CATEGORIES } from "../../unitCategory";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";

/**
 * A mark's half width as a percentage of a crop's width. On a square map this
 * is the size a mark has on the whole map: that is 0.0075 of the map's width,
 * and a crop is a quarter of the map's shorter side, so 0.0075 / 0.25 is 3%.
 * It is the same size in elmos, so a shape reads the same here as there.
 */
const CROP_MARK_SIZE = 3;

/** One player's view: the minimap cut to the crop, their orders as marks, and
 *  where their start really is. A button, so it can be pointed at, tabbed to
 *  and pressed, and the rest of the page lights the same player. */
function CropCard({
  crop,
  world,
  minimapUrl,
  windowed,
}: {
  crop: BaseCrop;
  world: MapWorld;
  minimapUrl: string;
  windowed: boolean;
}) {
  const { isLit, dimming, pointTo, focusOn, toggleSelected } =
    useSeriesEmphasis();
  const teams = [crop.team];
  const lit = isLit(teams);
  const image = cropImageBox(crop.window, world);
  const name = crop.names.length > 0 ? crop.names.join(", ") : "Unnamed player";
  const faded = dimming && !lit;
  return (
    <button
      type="button"
      data-crop-team={crop.team}
      aria-pressed={lit}
      onClick={() => toggleSelected(teams)}
      {...pointTo(teams)}
      {...focusOn(teams)}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-md p-0.5 text-left transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        lit && "ring-2 ring-white",
        faded && "opacity-40",
      )}
    >
      <span
        data-crop-view
        className="relative block aspect-square w-full overflow-hidden rounded border border-border/50 bg-card"
      >
        <img
          src={minimapUrl}
          alt=""
          data-crop-image
          className="absolute max-w-none object-fill"
          style={{
            width: `${image.width}%`,
            height: `${image.height}%`,
            left: `${image.left}%`,
            top: `${image.top}%`,
          }}
        />
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 size-full"
          aria-hidden="true"
        >
          {crop.marks.map((mark, i) => {
            const shape = mark.category
              ? CATEGORY_SHAPE[mark.category]
              : NEUTRAL_SHAPE;
            const x = mark.left * 100;
            const y = mark.top * 100;
            return (
              <path
                // Two orders can sit on one spot, so the position is no key.
                // biome-ignore lint/suspicious/noArrayIndexKey: a mark has no identity beyond its place in the list
                key={i}
                data-crop-mark
                data-left={x.toFixed(3)}
                data-top={y.toFixed(3)}
                d={MARK_SHAPES[shape]}
                transform={`translate(${x} ${y}) scale(${CROP_MARK_SIZE})`}
                fill={crop.colour || NEUTRAL_TEAM_COLOUR}
                fillRule="evenodd"
                fillOpacity={0.95}
                // The same dark edge the whole map gives a mark, in shape units.
                stroke="rgba(9, 13, 22, 0.9)"
                strokeWidth={0.5}
              />
            );
          })}
        </svg>
        <span
          data-crop-start
          className={cn(
            "absolute block size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(9,13,22,0.9)]",
            crop.isMe && "outline-2 outline-offset-2 outline-white",
          )}
          style={{
            left: `${crop.start.left * 100}%`,
            top: `${crop.start.top * 100}%`,
            backgroundColor: crop.colour,
          }}
        />
        {/* What the bar measures is said once, above the views. */}
        <span
          data-crop-scale-bar
          className="pointer-events-none absolute bottom-1 left-1 block h-1 border-x-2 border-b-2 border-white shadow-[0_0_2px_rgba(9,13,22,1)]"
          style={{ width: "25%" }}
        />
      </span>
      <span className="flex flex-col text-xs leading-tight">
        <span className="font-medium">
          {name}
          {crop.isMe ? " (you)" : ""}
        </span>
        {crop.opening && (
          <span className="text-muted-foreground">
            Opened with {crop.opening}
          </span>
        )}
        <span className="text-muted-foreground">
          {crop.ordered === 0
            ? windowed
              ? "None ordered in this window"
              : "None ordered"
            : `${crop.ordered.toLocaleString()} ordered`}
          {crop.outside > 0 && (
            <span data-crop-outside>
              , {crop.outside.toLocaleString()} outside this view
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/** The shapes the marks are drawn in, and what each stands for. */
function ShapeKey({ crops }: { crops: readonly BaseCrop[] }) {
  const used = UNIT_CATEGORIES.filter((category) =>
    crops.some((c) => c.marks.some((m) => m.category === category)),
  );
  if (used.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {used.map((category) => (
        <li key={category} className="flex items-center gap-1">
          <svg
            viewBox="-1.3 -1.3 2.6 2.6"
            className="size-3 fill-current"
            aria-hidden="true"
          >
            <path
              d={MARK_SHAPES[CATEGORY_SHAPE[category]]}
              fillRule="evenodd"
            />
          </svg>
          {CATEGORY_LABEL[category]}
        </li>
      ))}
    </ul>
  );
}

/**
 * What the base views mean, for the map's help entry. It says once what every
 * view shares, so a view's own caption is its player, their opening and two
 * counts. Mount it only when the views are shown.
 */
export function BaseCropsHelp({
  world,
  timeWindow,
  domainSec,
}: {
  world: MapWorld;
  timeWindow: TimeWindow | null;
  domainSec: number;
}) {
  const windowText = timeWindow
    ? `Showing orders given from ${formatDuration(timeWindow.startSec)} to ${formatDuration(Math.min(timeWindow.endSec, domainSec))}.`
    : "Showing orders given across the whole match.";
  const side = Math.round(cropSide(world));
  return (
    <p>
      Each base view shows the buildings a player ordered, not the buildings
      that were built. {windowText} Every view is {side.toLocaleString()} elmos
      across, the same for every player, and is centred on that player's start
      unless the start is near the edge of the map. The bar at the bottom left
      of a view is {Math.round(side / 4).toLocaleString()} elmos. A mark is one
      order to place a building, in its player's colour, and the dot with a
      white edge is the player's start. An order that was cancelled or never
      carried out is drawn like any other. Under each view is how many buildings
      that player ordered, and how many of those fall outside the view.
    </p>
  );
}

/**
 * A crop of the map round each player's start, side by side, so openings
 * compare as pictures of a base (#1177): who walled, who spread, who put a
 * factory somewhere odd.
 *
 * `orders` are the build orders inside the map's time window, already
 * filtered, and the crops draw the ones with a position. Every crop is the same
 * size in elmos, on the same minimap image the map above uses, with marks
 * drawn from the same shapes and colours. Allies sit together. It takes the
 * width it is given and wraps, so mount it across the section and not in the
 * minimap's column. Mount it under a
 * `SeriesEmphasisProvider`: a crop lights its player on the chart, the roster
 * and the map, and they light the crop.
 */
export function ReplayBaseCrops({
  info,
  dots,
  orders,
  world,
  units,
  minimapUrl,
  timeWindow,
}: {
  info: DemoInfo;
  dots: readonly StartDot[];
  /** Null until the build orders have been read. */
  orders: readonly BuildOrder[] | null;
  world: MapWorld;
  /** Null when the replay's game is not installed or its units are unread. */
  units: UnitDatasetEntry[] | null;
  minimapUrl: string;
  timeWindow: TimeWindow | null;
}) {
  const crops = useMemo(
    () => (orders ? baseCrops(dots, orders, world, units, info) : []),
    [dots, orders, world, units, info],
  );
  const groups = useMemo(() => {
    const out: { ally: number | undefined; crops: BaseCrop[] }[] = [];
    for (const crop of crops) {
      const last = out[out.length - 1];
      if (last && last.ally === crop.allyTeam) last.crops.push(crop);
      else out.push({ ally: crop.allyTeam, crops: [crop] });
    }
    return out;
  }, [crops]);

  if (dots.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        There are no base views, because this replay holds no start position to
        centre one on.
      </p>
    );
  if (!orders) return null;

  return (
    <section
      aria-label="Bases"
      data-testid="base-crops"
      className="flex flex-col gap-2"
    >
      {units === null && (
        <p className="text-xs text-muted-foreground">
          This replay's game is not installed, so every mark is the same shape.
        </p>
      )}
      <ShapeKey crops={crops} />
      {groups.map((group) => (
        <div key={group.ally ?? "none"} className="flex flex-col gap-1">
          {groups.length > 1 && (
            <h4 className="text-xs font-medium text-muted-foreground">
              {group.ally === undefined
                ? "Side not described"
                : teamLabel(group.ally)}
            </h4>
          )}
          <div
            data-crop-group={group.ally ?? "none"}
            className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2"
          >
            {group.crops.map((crop) => (
              <CropCard
                key={crop.team}
                crop={crop}
                world={world}
                minimapUrl={minimapUrl}
                windowed={timeWindow !== null}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
