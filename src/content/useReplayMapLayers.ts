import { useEffect, useMemo } from "react";
import { buildHeatField } from "@/lib/heatField";
import { isProfileHidden } from "../profile/hidden";
import type { DemoInfo } from "./bindings";
import { FRAMES_PER_SECOND } from "./chatClock";
import { playerTeam } from "./matchStats";
import {
  buildingHeatPoints,
  buildMarks,
  openingsByTeam,
  startDots,
} from "./replayMapLayers";
import {
  MAP_LAYERS,
  type MapLayer,
  type MapLayerToggles,
  useStoredMapLayers,
} from "./replayMapLayerToggles";
import {
  orderHeatPoints,
  sourceCounts,
  useReplayOrderPoints,
} from "./replayOrderPoints";
import { timelineDomain } from "./replayTimeline";
import {
  activitySeries,
  countInRange,
  filterByFrame,
  matchEndSec,
  windowPoints,
  windowRange,
} from "./replayTimeWindow";
import { UNIT_CATEGORIES } from "./unitCategory";
import { useMatchStats } from "./useMatchStats";
import { usePrimaryPlayer } from "./usePrimaryPlayer";
import { useReplayBuildOrders } from "./useReplayBuildOrders";
import { useReplayEventLayers } from "./useReplayEventLayers";
import { useReplayTimeWindow } from "./useReplayTimeWindow";
import { useReplayUnits } from "./useReplayUnits";
import { useSpawnedStarts } from "./useSpawnedStarts";
import { useTeamColours } from "./useTeamColours";

/**
 * The layer switches the reader left, narrowed to the layers a view draws, and
 * what is on in it. The start boxes are drawn when the profile hides the
 * switches, as they always were. Both the flat map and the unit map read this,
 * so the one set of switches steers both.
 */
export function useMapLayerToggles(shown: readonly MapLayer[]) {
  const layersShown = !isProfileHidden("analytics.spatialLayers");
  const [stored, setLayers] = useStoredMapLayers();
  const mine = useMemo(() => {
    const out = { ...stored };
    for (const layer of MAP_LAYERS)
      if (!shown.includes(layer)) out[layer] = false;
    return out satisfies MapLayerToggles;
  }, [stored, shown]);
  const on = {
    startBoxes: layersShown ? mine.startBoxes : shown.includes("startBoxes"),
    starts: layersShown && mine.starts,
    buildings: layersShown && mine.buildings,
    density: layersShown && mine.density,
    orderDensity: layersShown && mine.orderDensity,
  };
  return { layersShown, stored, setLayers, mine, on };
}

/** What the replay page's flat map and 3D view both read (#1152): the layer
 *  switches, the build orders and order points behind them, the time window the
 *  timeline dock sets (#5309), and the fields and marks worked out from those.
 *  Nothing here draws. */
export function useReplayMapLayers({
  info,
  replayPath,
  heightmap,
  shown,
}: {
  info: DemoInfo;
  replayPath: string | undefined;
  /** The heightmap's own size, which gives the map its shape and world size. */
  heightmap: { width?: number; height?: number } | null | undefined;
  /** The layers the view draws. A layer the reader left on that this view does
   *  not draw reads nothing and takes no part in the time window. */
  shown: readonly MapLayer[];
}) {
  const { layersShown, stored, setLayers, mine, on } =
    useMapLayerToggles(shown);

  // The engine's heightmap has one sample more than it has squares, and a
  // square is 8 elmos, which is how the 3D preview has always sized this map.
  const world = useMemo(
    () => ({
      worldWidth: heightmap?.width ? (heightmap.width - 1) * 8 : 0,
      worldHeight: heightmap?.height ? (heightmap.height - 1) * 8 : 0,
    }),
    [heightmap?.width, heightmap?.height],
  );
  const sized = world.worldWidth > 0 && world.worldHeight > 0;
  // The map's shape, for the box it is drawn in, as a ratio and as the CSS
  // `aspect-ratio` that says it.
  const ratio =
    heightmap?.width && heightmap?.height
      ? heightmap.width / heightmap.height
      : 1;
  const aspect =
    heightmap?.width && heightmap?.height
      ? `${heightmap.width} / ${heightmap.height}`
      : "1 / 1";

  // Build orders are read once for the page. A layer that draws them asks for
  // them when it is switched on, including one left on from the last visit.
  const orders = useReplayBuildOrders(replayPath ?? "");
  const wantOrders = !!replayPath && (on.buildings || on.density);
  const { status: ordersStatus, load: loadOrders } = orders;
  useEffect(() => {
    if (wantOrders && ordersStatus === "idle") loadOrders();
  }, [wantOrders, ordersStatus, loadOrders]);
  const result = orders.result;

  // Every positioned order is a second read of the stream, asked for the same
  // way: when the layer that draws it is on, including one left on last visit.
  const orderPoints = useReplayOrderPoints(replayPath ?? "");
  const wantPoints = !!replayPath && on.orderDensity;
  const { status: pointsStatus, load: loadPoints } = orderPoints;
  useEffect(() => {
    if (wantPoints && pointsStatus === "idle") loadPoints();
  }, [wantPoints, pointsStatus, loadPoints]);
  const allOrders = orderPoints.result;

  const units = useReplayUnits(
    info,
    layersShown && result !== null && result.orders.length > 0,
  );

  // The chart's colours, asked the way the chart asks them.
  const statsShown = layersShown && !isProfileHidden("analytics.matchStats");
  const stats = useMatchStats(statsShown && replayPath ? replayPath : null);
  const colours = useTeamColours(info, stats.data?.trailer ?? null);

  const primary = usePrimaryPlayer();
  const meTeam = primary ? playerTeam(info, primary) : undefined;
  const openings = useMemo(
    () => openingsByTeam(result?.orders ?? [], units.units),
    [result, units.units],
  );
  // A dot sits where the player's starting unit appeared, when the replay has
  // an analysis (#5346). It waits for that read rather than draw the recorded
  // start and then jump.
  const { spawns, loading: spawnsLoading } = useSpawnedStarts(info, on.starts);
  const dots = useMemo(
    () =>
      sized && !spawnsLoading
        ? startDots(info, world, colours, meTeam, openings, spawns)
        : [],
    [sized, spawnsLoading, info, world, colours, meTeam, openings, spawns],
  );

  // The time window (#1153). The layers that have a time to filter by are read
  // through it, and the ones that are set before the game are not.
  const buildLayer = on.buildings || on.density;
  const windowed = buildLayer || on.orderDensity;
  const domainSec = Math.ceil(
    timelineDomain(
      [
        { second: result ? result.lastFrame / FRAMES_PER_SECOND : null },
        { second: allOrders ? allOrders.lastFrame / FRAMES_PER_SECOND : null },
      ],
      info.durationSec,
      (result?.incomplete ?? false) || (allOrders?.incomplete ?? false),
    ),
  );
  // Where the match ended, for the captions that say what a window covers.
  const endOfMatchSec = matchEndSec(domainSec, info.durationSec);
  const timeWindow = useReplayTimeWindow(domainSec);
  const inWindow = useMemo(
    () =>
      result
        ? filterByFrame(result.orders, windowRange(timeWindow, domainSec))
        : null,
    [result, timeWindow, domainSec],
  );
  const placedCount = useMemo(
    () => ({
      inside: inWindow?.filter((o) => o.position).length ?? 0,
      total: result?.orders.filter((o) => o.position).length ?? 0,
    }),
    [inWindow, result],
  );
  // The layers drawn from the analysis's events (#1160), read through the same
  // window. They read nothing until one is on.
  const ev = useReplayEventLayers({
    info,
    layersShown,
    toggles: mine,
    world,
    sized,
    timeWindow,
    domainSec,
  });
  const activity = useMemo(
    () =>
      activitySeries(
        stats.data?.trailer ?? null,
        info,
        stats.data?.metrics ?? [],
      ),
    [stats.data, info],
  );

  const built = useMemo(
    () => (inWindow && sized ? buildMarks(inWindow, world, units.units) : null),
    [inWindow, sized, world, units.units],
  );
  const field = useMemo(
    () =>
      inWindow && sized && on.density
        ? buildHeatField(buildingHeatPoints(inWindow), world)
        : null,
    [inWindow, sized, world, on.density],
  );

  // The same window, as the frames it covers, for the layer that has a frame
  // beside every point.
  const range = useMemo(
    () => windowRange(timeWindow, domainSec),
    [timeWindow, domainSec],
  );
  const orderField = useMemo(
    () =>
      allOrders && sized && on.orderDensity
        ? buildHeatField(
            windowPoints(orderHeatPoints(allOrders), allOrders.frame, range),
            world,
          )
        : null,
    [allOrders, sized, world, on.orderDensity, range],
  );
  const bySender = useMemo(
    () => (allOrders ? sourceCounts(allOrders, range) : null),
    [allOrders, range],
  );
  const orderCount = useMemo(
    () =>
      allOrders
        ? {
            inside: countInRange(allOrders.frame, range),
            total: allOrders.count,
          }
        : null,
    [allOrders, range],
  );

  const placed = built?.marks.length ?? 0;
  const categorised = built?.marks.some((m) => m.category !== null) ?? false;
  const usedCategories = UNIT_CATEGORIES.filter((category) =>
    built?.marks.some((m) => m.category === category),
  );

  return {
    layersShown,
    stored,
    setLayers,
    on,
    world,
    sized,
    ratio,
    aspect,
    orders,
    wantOrders,
    result,
    orderPoints,
    wantPoints,
    allOrders,
    units,
    colours,
    dots,
    buildLayer,
    windowed,
    domainSec,
    endOfMatchSec,
    timeWindow,
    inWindow,
    placedCount,
    ev,
    activity,
    built,
    field,
    orderField,
    bySender,
    orderCount,
    placed,
    categorised,
    usedCategories,
  };
}

/** What {@link useReplayMapLayers} hands the flat map and the 3D view. */
export type ReplayMapLayers = ReturnType<typeof useReplayMapLayers>;
