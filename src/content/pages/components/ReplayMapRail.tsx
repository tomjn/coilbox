import { t as coreT, plural } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
} from "react";
import { createPortal } from "react-dom";
import { HeatLegend } from "@/components/HeatLegend";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatNumber } from "@/lib/format";
import { HEAT_KIND_OF_LAYER } from "@/lib/heatRamp";
import type { DemoInfo } from "../../bindings";
import { windowSubject } from "../../replayEventLayers";
import {
  EVENT_MAP_LAYERS,
  holdEventLayers,
  layersOn,
  type MapLayer,
  oneOfDeathsAndDamage,
} from "../../replayMapLayerToggles";
import type { ReplayMapLayers } from "../../useReplayMapLayers";
import { BaseCropsHelp } from "./ReplayBaseCrops";
import { EventLayerHelp } from "./ReplayEventLayers";
import { StartUnitHelp } from "./ReplayStartUnitLayer";
import { ReplayTimeWindowNote, TimeWindowHelp } from "./ReplayTimeWindowNote";
import { SectionHelp } from "./SectionHelp";

/**
 * The tallest a map may be: the height of the column the card is in, less the
 * card's own heading row and padding above the map. The page makes that column
 * a size container when it has two columns (#5304), so `cqh` is the column's
 * height and the map fits beside the panel and above the timeline dock. When
 * the page stacks there is no such container and `cqh` is the window's height.
 * Measured with the Units mode open, the heading row and the card's padding
 * come to 66 pixels, which is 4.1rem, so 4.5rem leaves a margin. The floor
 * keeps a map usable in a very short window, where the column scrolls.
 */
const MAP_VIEW_HEIGHT = "max(16rem, 100cqh - 4.5rem)";

/**
 * The map and the rail beside it, in every mode of the map card. The rail holds
 * what steers the map and what the map is read by, so a mode puts its switches
 * there and, under them, the legend for each thing that is on. Below a wide
 * window the rail drops under the map. What belongs to the whole card width,
 * like the base pictures, goes in `under`.
 */
export function ReplayMapLayout({
  shape,
  map,
  rail,
  under,
}: {
  /** The map's width and height, which give the box its shape. */
  shape: { width: number; height: number };
  map: ReactNode;
  rail: ReactNode;
  under?: ReactNode;
}) {
  return (
    // A container, so the rail goes beside the map when the card has the width
    // for it, which in the page's two columns is not a matter of the window's.
    <div className="@container flex flex-col gap-3">
      <div className="flex flex-col gap-4 @xl:flex-row @xl:items-start">
        <div
          data-map-column
          // All the width the card has, and no wider than lets the map keep its
          // shape inside the share of the window's height it may take, so a
          // tall map still fits on screen and the rail sits against it.
          style={{
            maxWidth: `calc(${MAP_VIEW_HEIGHT} * ${shape.width} / ${shape.height})`,
          }}
          className="min-w-0 @xl:flex-1"
        >
          {map}
        </div>
        <div
          data-map-rail
          className="flex min-w-0 flex-col gap-3 @xl:w-48 @xl:shrink-0"
        >
          {rail}
        </div>
      </div>
      {under}
    </div>
  );
}

/** Where the card's heading has room for the help entry of the mode it shows. */
export const HelpHost = createContext<HTMLElement | null>(null);

/**
 * The help entry of a mode. It sits beside the card's heading when the card has
 * a place for it there, and where it is rendered otherwise.
 */
export function MapHelp(props: ComponentProps<typeof SectionHelp>) {
  const host = useContext(HelpHost);
  const help = <SectionHelp {...props} />;
  return host ? createPortal(help, host) : help;
}

/** The layers the flat map draws. */
export const FLAT_LAYERS: readonly MapLayer[] = [
  "startBoxes",
  "starts",
  "buildings",
  "density",
  "orderDensity",
  "bases",
  "deaths",
  "damage",
  "finished",
  "startUnitDeaths",
  "startUnitPaths",
];

/** The layers that paint on the 3D terrain. */
export const SCENE_LAYERS: readonly MapLayer[] = [
  "density",
  "orderDensity",
  "deaths",
  "damage",
];

/** A layer switch that needs an analysis. When it cannot be used, the reason
 *  is its tooltip, on a wrapper because a disabled button takes no pointer. */
function EventToggle({
  value,
  reason,
  children,
}: {
  value: string;
  reason: string | null;
  children: ReactNode;
}) {
  if (!reason)
    return (
      <ToggleGroupItem value={value} className="@xl:justify-start">
        {children}
      </ToggleGroupItem>
    );
  return (
    <span title={reason} className="flex">
      <ToggleGroupItem
        value={value}
        disabled
        className="grow @xl:justify-start"
      >
        {children}
      </ToggleGroupItem>
    </span>
  );
}

/**
 * The switches for the layers in `only`, in a column down the rail. A layer the
 * reader left on that this view does not draw is kept as it was.
 */
export function LayerSwitches({
  layers,
  only,
}: {
  layers: ReplayMapLayers;
  only: readonly MapLayer[];
}) {
  const { t } = useLingui();
  const { stored, setLayers, ev } = layers;
  if (!layers.layersShown) return null;
  const has = (layer: MapLayer) => only.includes(layer);
  const event = (layer: MapLayer, label: string) =>
    has(layer) && (
      <EventToggle value={layer} reason={ev.block}>
        {label}
      </EventToggle>
    );
  const plain = (layer: MapLayer, label: string) =>
    has(layer) && (
      <ToggleGroupItem value={layer} className="@xl:justify-start">
        {label}
      </ToggleGroupItem>
    );
  return (
    <ToggleGroup
      type="multiple"
      variant="outline"
      size="sm"
      spacing={1}
      aria-label={t`Map layers`}
      className="w-full flex-wrap items-stretch @xl:flex-col @xl:flex-nowrap"
      value={layersOn(stored).filter(
        (l) => has(l) && (!ev.block || !EVENT_MAP_LAYERS.includes(l)),
      )}
      onValueChange={(picked) => {
        const kept = layersOn(stored).filter((l) => !has(l));
        const next = oneOfDeathsAndDamage([...kept, ...picked], stored);
        setLayers(ev.block ? holdEventLayers(next, stored) : next);
      }}
    >
      {plain("startBoxes", t`Start boxes`)}
      {plain("starts", t`Start positions`)}
      {plain("buildings", t`Buildings ordered`)}
      {plain("density", t`Building density`)}
      {plain("orderDensity", t`Order density`)}
      {plain("bases", t`Bases`)}
      {event("deaths", t`Deaths`)}
      {event("damage", t`Damage dealt`)}
      {event("finished", t`Buildings finished`)}
      {event("startUnitDeaths", t`Starting unit deaths`)}
      {event("startUnitPaths", t`Starting unit paths`)}
    </ToggleGroup>
  );
}

/** What the peak of an order heat field holds, in words. */
function orderPeak(
  field: { peakWithinRadius?: number; radius: number },
  inWindow: boolean,
): string {
  const count = Math.round(field.peakWithinRadius ?? 0);
  const radius = formatNumber(Math.round(field.radius));
  return inWindow
    ? plural(count, {
        one: `# order within ${radius} elmos of one spot in this window`,
        other: `# orders within ${radius} elmos of one spot in this window`,
      })
    : plural(count, {
        one: `# order within ${radius} elmos of one spot`,
        other: `# orders within ${radius} elmos of one spot`,
      });
}

/** How many orders the density layer holds, and how many widgets sent. */
function orderDensitySentence(
  counted: number,
  byWidgets: number,
  inWindow: boolean,
): string {
  const orders = formatNumber(counted);
  const widgets = formatNumber(byWidgets);
  if (inWindow) {
    return byWidgets > 0
      ? coreT`${orders} orders in this window are on it, from the player's own selection, widgets acting for them and AIs alike, and ${widgets} of them were sent by widgets.`
      : coreT`${orders} orders in this window are on it, from the player's own selection, widgets acting for them and AIs alike.`;
  }
  return byWidgets > 0
    ? coreT`${orders} orders are on it, from the player's own selection, widgets acting for them and AIs alike, and ${widgets} of them were sent by widgets.`
    : coreT`${orders} orders are on it, from the player's own selection, widgets acting for them and AIs alike.`;
}

/** The legend for each density that is on. */
export function HeatLegends({ layers }: { layers: ReplayMapLayers }) {
  const { t } = useLingui();
  const { orderField, field, timeWindow } = layers;
  return (
    <>
      {orderField && orderField.peak > 0 && (
        <HeatLegend
          label={t`Where orders were aimed`}
          peak={orderPeak(orderField, Boolean(timeWindow))}
          kind={HEAT_KIND_OF_LAYER.orderDensity}
        />
      )}
      {field && field.peak > 0 && (
        <HeatLegend
          label={t`Where buildings were ordered`}
          peak={orderPeak(field, Boolean(timeWindow))}
          kind={HEAT_KIND_OF_LAYER.density}
        />
      )}
    </>
  );
}

/** What the window covers, and how much of each layer falls inside it, straight
 *  under the map it filters. The window is set on the timeline dock's Heat
 *  window lane (#5309). It is shown while a layer that has a time is on. */
export function MapTimeWindow({ layers }: { layers: ReplayMapLayers }) {
  const { t } = useLingui();
  const {
    on,
    buildLayer,
    windowed,
    ev,
    domainSec,
    timeWindow,
    orderCount,
    result,
    placedCount,
  } = layers;
  if (!layers.layersShown || !(windowed || ev.active)) return null;
  return (
    <div data-map-window className="w-full max-w-3xl">
      <ReplayTimeWindowNote
        domainSec={domainSec}
        window={timeWindow}
        // With the order layer on as well there are two kinds of point to
        // count, and each is counted under its own name.
        count={
          !windowed
            ? null
            : on.orderDensity && !buildLayer
              ? orderCount
              : result
                ? placedCount
                : null
        }
        noun={
          on.orderDensity
            ? buildLayer
              ? t`building orders`
              : t`orders on the map`
            : undefined
        }
        also={
          on.orderDensity && buildLayer
            ? {
                count: orderCount,
                noun: t`orders on the map`,
              }
            : undefined
        }
        events={ev.counts}
        subject={windowSubject(windowed, ev.active)}
      />
    </div>
  );
}

/** What is still being read, what could not be, and what came back empty, for
 *  the layers that read build orders and every order. */
export function ReadNotes({ layers }: { layers: ReplayMapLayers }) {
  const {
    orders,
    orderPoints,
    wantOrders,
    wantPoints,
    result,
    built,
    placedCount,
    allOrders,
  } = layers;
  return (
    <>
      {wantOrders && orders.loading && (
        <p className="text-xs text-muted-foreground">
          <Trans>Reading build orders…</Trans>
        </p>
      )}
      {wantOrders && orders.failed && (
        <p className="text-xs text-destructive">
          <Trans>The build orders could not be read from this replay.</Trans>
        </p>
      )}
      {wantOrders && built && placedCount.total === 0 && (
        <p className="text-xs text-muted-foreground">
          <Trans>No buildings were ordered in this replay.</Trans>
        </p>
      )}
      {wantOrders && result?.incomplete && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            This replay could not be read to the end, so later build orders may
            be missing.
          </Trans>
        </p>
      )}

      {wantPoints && orderPoints.loading && (
        <p className="text-xs text-muted-foreground">
          <Trans>Reading orders…</Trans>
        </p>
      )}
      {wantPoints && orderPoints.failed && (
        <p className="text-xs text-destructive">
          <Trans>The orders could not be read from this replay.</Trans>
        </p>
      )}
      {wantPoints && allOrders && allOrders.count === 0 && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            No orders with a place on the map were given in this replay.
          </Trans>
        </p>
      )}
      {wantPoints && allOrders?.incomplete && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            This replay could not be read to the end, so later orders may be
            missing.
          </Trans>
        </p>
      )}
    </>
  );
}

/**
 * The explanation of the layers, for the section's help entry. `flat` says the
 * view is the flat map, which has the layers that 3D has no place for.
 */
export function LayersHelp({
  layers,
  info,
  flat,
}: {
  layers: ReplayMapLayers;
  info: DemoInfo;
  flat: boolean;
}) {
  const {
    layersShown,
    windowed,
    ev,
    activity,
    on,
    world,
    timeWindow,
    domainSec,
    wantOrders,
    wantPoints,
    built,
    placed,
    allOrders,
    bySender,
    orderField,
    field,
    dots,
    inWindow,
  } = layers;
  const hasBoxes = info.allyTeams.some((a) => a.startBox);
  const noStarts = on.starts && (info.startPositions?.length ?? 0) === 0;
  const showColourNote =
    (orderField?.peak ?? 0) > 0 ||
    (field?.peak ?? 0) > 0 ||
    (ev.field?.peak ?? 0) > 0 ||
    (ev.damageField?.peak ?? 0) > 0;
  const basesShown = on.bases && dots.length > 0 && !!inWindow;
  const orderDensityCount = orderDensitySentence(
    orderField?.counted ?? 0,
    bySender?.lua ?? 0,
    Boolean(timeWindow),
  );
  return (
    <>
      {layersShown && (windowed || ev.active) && (
        <TimeWindowHelp
          activity={activity}
          subject={windowSubject(windowed, ev.active)}
        />
      )}
      {flat && on.startBoxes && hasBoxes && (
        <p>
          <Trans>A start box is where a team was allowed to start.</Trans>
        </p>
      )}
      {flat && on.starts && !noStarts && (
        <p>
          <Trans>
            A dot is where a player's start was set before the game. The engine
            can move a start into its start box, so the commander may have
            appeared a short way off. Point at a dot to see whose it is.
          </Trans>
        </p>
      )}
      {flat && wantOrders && built && placed > 0 && (
        <p>
          <Trans>
            Buildings ordered shows the orders each player gave, not what was
            built. An order that was cancelled or never carried out is drawn
            like any other.
          </Trans>
          {built.unplaced > 0 && (
            <>
              {" "}
              <Plural
                value={built.unplaced}
                one="# factory queue order has no position and is not drawn."
                other="# factory queue orders have no position and are not drawn."
              />
            </>
          )}
          {built.offMap > 0 && (
            <>
              {" "}
              <Plural
                value={built.offMap}
                one="# order was placed off the map and is not drawn."
                other="# orders were placed off the map and are not drawn."
              />
            </>
          )}
          {on.buildings && (
            <>
              {" "}
              <Trans>A mark is one order, in its player's colour.</Trans>
            </>
          )}
        </p>
      )}
      {wantPoints && allOrders && allOrders.count > 0 && bySender && (
        <>
          <p>
            <Trans>
              Order density shows where orders were aimed, which is roughly
              where attention went.
            </Trans>{" "}
            {orderDensityCount}
          </p>
          <p>
            <Trans>
              Orders aimed at a unit are not on it, as the replay holds the unit
              and not its position.
            </Trans>{" "}
            {timeWindow ? (
              <Plural
                value={allOrders.unitAimed}
                one="# order was aimed at a unit in the whole match, which the window cannot narrow."
                other="# orders were aimed at a unit in the whole match, which the window cannot narrow."
              />
            ) : (
              <Plural
                value={allOrders.unitAimed}
                one="# order was aimed at a unit."
                other="# orders were aimed at a unit."
              />
            )}
            {allOrders.custom > 0 && (
              <>
                {" "}
                <Plural
                  value={allOrders.custom}
                  one="# order was a command the engine does not define, which a game or a widget made up and which says nothing about where it points, and is left out."
                  other="# orders were a command the engine does not define, which a game or a widget made up and which says nothing about where it points, and are left out."
                />
              </>
            )}
            {(orderField?.dropped ?? 0) > 0 && (
              <>
                {" "}
                <Plural
                  value={orderField?.dropped ?? 0}
                  one="# order was aimed off the map and is not drawn."
                  other="# orders were aimed off the map and are not drawn."
                />
              </>
            )}
          </p>
        </>
      )}
      {showColourNote && (
        <p>
          <Trans>
            Colours compare places on this map with each other, not with another
            picture.
          </Trans>
        </p>
      )}
      {layersShown && <EventLayerHelp ev={ev} />}
      {flat && layersShown && <StartUnitHelp ev={ev} />}
      {flat && basesShown && (
        <BaseCropsHelp
          world={world}
          timeWindow={timeWindow}
          domainSec={domainSec}
        />
      )}
    </>
  );
}
