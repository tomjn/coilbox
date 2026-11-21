import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "@picoframe/frame";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { formatDuration, formatNumber } from "@/lib/format";
import type { DemoInfo } from "../../bindings";
import { useUnitsyncHeightmap, useUnitsyncMinimap } from "../../config";
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
} from "../../replayMapLayers";
import type { TimeWindow } from "../../replayTimeWindow";
import { UNIT_CATEGORIES } from "../../unitCategory";
import { useReplayMapLayers } from "../../useReplayMapLayers";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";
import { useSpawnedStarts } from "../../useSpawnedStarts";

/**
 * A mark's half width as a percentage of a crop's width. On a square map this
 * is the size a mark has on the whole map: that is 0.0075 of the map's width,
 * and a crop is a quarter of the map's shorter side, so 0.0075 / 0.25 is 3%.
 * It is the same size in elmos, so a shape reads the same here as there.
 */
const CROP_MARK_SIZE = 3;

/** What the base pictures are drawn from, once there is something to draw. */
interface BasePictures {
  /** One for each start, allies together. */
  crops: readonly BaseCrop[];
  world: MapWorld;
  minimapUrl: string;
  /** The window the dock's Heat window lane has set, or null for the whole match. */
  timeWindow: TimeWindow | null;
  domainSec: number;
  /** The replay's game is not installed or its units are unread, so every mark
   *  has one shape. */
  unitsMissing: boolean;
}

const BasePicturesContext = createContext<BasePictures | null>(null);

/** The base pictures, or null when there are none to draw: no minimap, no
 *  start positions, no orders read yet, or a profile that hides the layers. */
export function useBasePictures(): BasePictures | null {
  return useContext(BasePicturesContext);
}

/**
 * Works out each player's base picture (#1177) and hands it to the build orders
 * below, which put each beside its player's orders (#5318).
 *
 * A picture is the minimap cut to a square round the player's start, with the
 * orders they gave in the dock's Heat window drawn on it. It reads the build
 * orders the page has read, and asks for none itself. Mount it under a
 * `SeriesEmphasisProvider`.
 */
export function BasePicturesProvider({
  info,
  replayPath,
  enginePath,
  dataDir,
  children,
}: {
  info: DemoInfo;
  replayPath: string | undefined;
  enginePath: string | undefined;
  dataDir: string | undefined;
  children: ReactNode;
}) {
  const minimap = useUnitsyncMinimap(enginePath, dataDir, info.mapName);
  const heightmap = useUnitsyncHeightmap(enginePath, dataDir, info.mapName);
  // No layer takes part: the pictures read the build orders, the window and the
  // start positions, and nothing the map's switches steer.
  const layers = useReplayMapLayers({
    info,
    replayPath,
    heightmap: heightmap.data,
    shown: [],
  });
  const { layersShown, world, dots, inWindow, units, timeWindow, domainSec } =
    layers;
  // Where each starting unit appeared, when the replay has an analysis, since
  // a game can start a player somewhere other than the recorded start (#5339).
  const { spawns, loading: spawnsLoading } = useSpawnedStarts(
    info,
    layersShown,
  );
  const minimapUrl = minimap.url;
  const unitList = units.units;
  const value = useMemo(() => {
    if (!layersShown || !minimapUrl || !inWindow) return null;
    // Wait for the analysis rather than centre on the recorded start and jump.
    if (spawnsLoading) return null;
    const crops = baseCrops(dots, inWindow, world, unitList, info, spawns);
    if (crops.length === 0) return null;
    return {
      crops,
      world,
      minimapUrl,
      timeWindow,
      domainSec,
      unitsMissing: unitList === null,
    };
  }, [
    layersShown,
    minimapUrl,
    inWindow,
    spawnsLoading,
    dots,
    world,
    unitList,
    info,
    spawns,
    timeWindow,
    domainSec,
  ]);
  return (
    <BasePicturesContext.Provider value={value}>
      {children}
    </BasePicturesContext.Provider>
  );
}

/** One player's picture: the minimap cut to the crop, their orders as marks,
 *  and where their start really is. A button, so it can be pointed at, tabbed
 *  to and pressed, and the rest of the page lights the same player. */
export function BasePicture({
  crop,
  name,
  pictures,
}: {
  crop: BaseCrop;
  /** The player the entry is for, which is what names the button. */
  name: string;
  pictures: BasePictures;
}) {
  const { t } = useLingui();
  const { isLit, dimming, pointTo, focusOn, toggleSelected } =
    useSeriesEmphasis();
  const teams = [crop.team];
  const lit = isLit(teams);
  const image = cropImageBox(crop.window, pictures.world);
  const ordered = formatNumber(crop.ordered);
  const outside = formatNumber(crop.outside);
  const faded = dimming && !lit;
  const windowed = pictures.timeWindow !== null;
  return (
    <button
      type="button"
      data-crop-team={crop.team}
      aria-label={t`Base of ${name}`}
      aria-pressed={lit}
      onClick={() => toggleSelected(teams)}
      {...pointTo(teams)}
      {...focusOn(teams)}
      className={cn(
        "flex w-full min-w-0 max-w-48 flex-col gap-1 self-start rounded-md p-0.5 text-left transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @min-[22rem]:w-32 @min-[22rem]:shrink-0",
        lit && "ring-2 ring-white",
        faded && "opacity-40",
      )}
    >
      <span
        data-crop-view
        className="relative block aspect-square w-full overflow-hidden rounded border border-border/50 bg-card"
      >
        <img
          src={pictures.minimapUrl}
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
        {/* What the bar measures is said once, in the section's help. */}
        <span
          data-crop-scale-bar
          className="pointer-events-none absolute bottom-1 left-1 block h-1 border-x-2 border-b-2 border-white shadow-[0_0_2px_rgba(9,13,22,1)]"
          style={{ width: "25%" }}
        />
      </span>
      <span className="text-xs leading-tight text-muted-foreground">
        {crop.ordered === 0
          ? windowed
            ? t`None ordered in this window`
            : t`None ordered`
          : t`${ordered} ordered`}
        {crop.outside > 0 && (
          <span data-crop-outside>
            {", "}
            <Trans>{outside} outside this view</Trans>
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * What every picture shares, once, above the entries: the window they follow
 * when the reader has set one, a note when no game says what a building is, and
 * what each mark shape stands for.
 */
export function BasePictureKey() {
  const { t } = useLingui();
  const pictures = useBasePictures();
  if (!pictures) return null;
  const { crops, timeWindow, domainSec, unitsMissing } = pictures;
  const from = timeWindow ? formatDuration(timeWindow.startSec) : "";
  const to = timeWindow
    ? formatDuration(Math.min(timeWindow.endSec, domainSec))
    : "";
  const used = UNIT_CATEGORIES.filter((category) =>
    crops.some((c) => c.marks.some((m) => m.category === category)),
  );
  return (
    <div data-testid="base-picture-key" className="flex flex-col gap-1">
      {timeWindow && (
        <p className="text-xs text-muted-foreground">
          {t`Pictures show orders given from ${from} to ${to}.`}
        </p>
      )}
      {unitsMissing && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            This replay's game is not installed, so every mark is the same
            shape.
          </Trans>
        </p>
      )}
      {used.length > 0 && (
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
      )}
    </div>
  );
}

/**
 * What the base pictures mean, for the build orders' help entry. It says once
 * what every picture shares, so a picture's own caption is two counts. Mount it
 * only when there are pictures.
 */
export function BaseCropsHelp() {
  const { t } = useLingui();
  const pictures = useBasePictures();
  if (!pictures) return null;
  const { world, timeWindow, domainSec } = pictures;
  const from = timeWindow ? formatDuration(timeWindow.startSec) : "";
  const to = timeWindow
    ? formatDuration(Math.min(timeWindow.endSec, domainSec))
    : "";
  const windowText = timeWindow
    ? t`Showing orders given from ${from} to ${to}.`
    : t`Showing orders given across the whole match.`;
  const side = Math.round(cropSide(world));
  const sideText = formatNumber(side);
  const barText = formatNumber(Math.round(side / 4));
  return (
    <p>
      <Trans>
        Each base view shows the buildings a player ordered, not the buildings
        that were built.
      </Trans>{" "}
      {windowText}{" "}
      <Trans>
        Every view is {sideText} elmos across, the same for every player, and is
        centred on that player's start unless the start is near the edge of the
        map. The bar at the bottom left of a view is {barText} elmos. A mark is
        one order to place a building, in its player's colour, and the dot with
        a white edge is the player's start. An order that was cancelled or never
        carried out is drawn like any other. Under each view is how many
        buildings that player ordered, and how many of those fall outside the
        view.
      </Trans>
    </p>
  );
}
