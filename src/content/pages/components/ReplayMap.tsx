import { cn, useTheme } from "@picoframe/frame";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { HeatLegend } from "@/components/HeatLegend";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { drawHeatField } from "@/lib/heatCanvas";
import { buildHeatField } from "@/lib/heatField";
import { HEAT_KIND_OF_LAYER } from "@/lib/heatRamp";
import type { MapScene3D } from "@/lib/mapScene";
import { useHeatmapLayer } from "@/lib/useHeatmapLayer";
import { MapPreview3D } from "../../../mapconv/pages/components/MapPreview3D";
import { isProfileHidden } from "../../../profile/hidden";
import type { DemoInfo, StartBox } from "../../bindings";
import { useStoredColorMode } from "../../chartColorMode";
import { FRAMES_PER_SECOND } from "../../chatClock";
import { playerTeam } from "../../matchStats";
import { windowSubject } from "../../replayEventLayers";
import {
  type BuildMark,
  buildingHeatPoints,
  buildMarks,
  CATEGORY_LABEL,
  CATEGORY_SHAPE,
  MARK_SHAPES,
  type MarkShape,
  NEUTRAL_SHAPE,
  NEUTRAL_TEAM_COLOUR,
  openingsByTeam,
  type StartDot,
  startDotName,
  startDots,
  teamColours,
} from "../../replayMapLayers";
import {
  EVENT_MAP_LAYERS,
  holdEventLayers,
  layersOn,
  oneOfDeathsAndDamage,
  useStoredMapLayers,
} from "../../replayMapLayerToggles";
import {
  orderHeatPoints,
  sourceCounts,
  useReplayOrderPoints,
} from "../../replayOrderPoints";
import { teamLabel } from "../../replaySideLabel";
import { timelineDomain } from "../../replayTimeline";
import {
  activitySeries,
  countInRange,
  filterByFrame,
  windowPoints,
  windowRange,
} from "../../replayTimeWindow";
import { UNIT_CATEGORIES } from "../../unitCategory";
import { useMatchStats } from "../../useMatchStats";
import { usePrimaryPlayer } from "../../usePrimaryPlayer";
import { useReplayBuildOrders } from "../../useReplayBuildOrders";
import { useReplayEventLayers } from "../../useReplayEventLayers";
import { useReplayTimeWindow } from "../../useReplayTimeWindow";
import { useReplayUnits } from "../../useReplayUnits";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";
import { BaseCropsHelp, ReplayBaseCrops } from "./ReplayBaseCrops";
import {
  EventLayerCanvases,
  EventLayerHelp,
  EventLayerNotes,
} from "./ReplayEventLayers";
import { swatch } from "./ReplayRoster";
import {
  StartUnitCanvas,
  StartUnitHelp,
  StartUnitNotes,
} from "./ReplayStartUnitLayer";
import {
  ReplayTimeWindowControl,
  TimeWindowHelp,
} from "./ReplayTimeWindowControl";
import { SectionHelp } from "./SectionHelp";
import { StoredListNote } from "./UnitListNotes";

/** How many pixels wide the marks are drawn at, before the page scales the
 *  canvas to the map's box. Twice the box's widest, so marks stay sharp on a
 *  high density screen. */
const MARKS_WIDTH = 768;

/** A mark's half width as a fraction of the map's width. A display choice:
 *  big enough to tell a square from a triangle, small enough that a base's
 *  buildings do not merge into one blot. */
const MARK_SIZE = 0.0075;

/** How much of a mark shows when another player is the emphasised one. */
const DIMMED = 0.18;

function drawMarks(
  canvas: HTMLCanvasElement,
  marks: readonly BuildMark[],
  colours: ReadonlyMap<number, string>,
  lit: (team: number | undefined) => boolean,
  dimming: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const size = width * MARK_SIZE;
  const paths = new Map<MarkShape, Path2D>();
  // The emphasised player's marks go on last, so they are never under
  // somebody else's.
  const ordered = dimming
    ? [...marks].sort((a, b) => Number(lit(a.team)) - Number(lit(b.team)))
    : marks;
  for (const mark of ordered) {
    const shape = mark.category ? CATEGORY_SHAPE[mark.category] : NEUTRAL_SHAPE;
    let path = paths.get(shape);
    if (!path) {
      path = new Path2D(MARK_SHAPES[shape]);
      paths.set(shape, path);
    }
    ctx.setTransform(size, 0, 0, size, mark.left * width, mark.top * height);
    ctx.globalAlpha = dimming && !lit(mark.team) ? DIMMED : 0.95;
    // A dark edge under the colour, so a mark reads on pale ground and on a
    // player colour close to the map's own.
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "rgba(9, 13, 22, 0.9)";
    ctx.stroke(path);
    ctx.fillStyle =
      (mark.team === undefined ? undefined : colours.get(mark.team)) ??
      NEUTRAL_TEAM_COLOUR;
    ctx.fill(path, "evenodd");
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}

/** One real start position. A button, so it can be pointed at, tabbed to and
 *  pressed, and the rest of the page lights the same player. */
function StartDotButton({ dot }: { dot: StartDot }) {
  const { isLit, dimming, pointTo, focusOn, toggleSelected } =
    useSeriesEmphasis();
  const teams = [dot.team];
  const lit = isLit(teams);
  const name = startDotName(dot);
  const says = [
    name,
    dot.isMe ? "you" : null,
    dot.opening ? `opened with ${dot.opening}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      data-team={dot.team}
      data-x={dot.x}
      data-z={dot.z}
      aria-label={`Start position of ${says}`}
      aria-pressed={lit}
      onClick={() => toggleSelected(teams)}
      {...pointTo(teams)}
      {...focusOn(teams)}
      className={cn(
        "group absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-none",
        lit ? "z-20" : "z-10",
      )}
      style={{ left: `${dot.left * 100}%`, top: `${dot.top * 100}%` }}
    >
      <span
        className={cn(
          "block size-3 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(9,13,22,0.9)] transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-ring",
          // Emphasis is a ring and a fade, never a change of colour.
          lit && "ring-2 ring-white ring-offset-2 ring-offset-black/80",
          dot.isMe && !lit && "outline-2 outline-offset-2 outline-white",
          dimming && !lit && "opacity-40",
        )}
        style={{ backgroundColor: dot.colour }}
      />
      {lit && (
        <span className="pointer-events-none absolute bottom-full left-1/2 mb-0.5 w-max max-w-40 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-left text-[10px] leading-tight text-white">
          <span className="block font-medium">
            {name}
            {dot.isMe ? " (you)" : ""}
          </span>
          {dot.opening && (
            <span className="block">Opened with {dot.opening}</span>
          )}
        </span>
      )}
    </button>
  );
}

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
    return <ToggleGroupItem value={value}>{children}</ToggleGroupItem>;
  return (
    <span title={reason}>
      <ToggleGroupItem value={value} disabled>
        {children}
      </ToggleGroupItem>
    </span>
  );
}

/** The shapes the marks are drawn in, and what each stands for. */
function ShapeKey({ shapes }: { shapes: [MarkShape, string][] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {shapes.map(([shape, label]) => (
        <li key={label} className="flex items-center gap-1">
          <svg
            viewBox="-1.3 -1.3 2.6 2.6"
            className="size-3 fill-current"
            aria-hidden="true"
          >
            <path d={MARK_SHAPES[shape]} fillRule="evenodd" />
          </svg>
          {label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The replay's map: the minimap with its layers, and the 3D preview beside it.
 *
 * The layers are the spatial half of the match (#1152): where each player
 * really started, where buildings were ordered, and how thickly. The start
 * boxes were here before and are one more layer. Everything but the start
 * boxes is gated on the `analytics.spatialLayers` profile key.
 *
 * Mount it under a `SeriesEmphasisProvider`: a start dot lights its player on
 * the chart and the roster, and they light the dot.
 */
export function ReplayMap({
  info,
  replayPath,
  mapName,
  minimapUrl,
  heightmap,
  preview,
  heading,
}: {
  info: DemoInfo;
  replayPath: string | undefined;
  mapName: string;
  minimapUrl: string;
  /** The heightmap's own size, which gives the map its shape and world size. */
  heightmap: { width?: number; height?: number } | null | undefined;
  /** What `MapPreview3D` needs besides the scene hook, or null for no 3D. */
  preview: Omit<
    React.ComponentProps<typeof MapPreview3D>,
    "onScene" | "worldWidth" | "worldHeight" | "className"
  > | null;
  /** The section's heading, which the help entry sits beside. */
  heading?: ReactNode;
}) {
  const layersShown = !isProfileHidden("analytics.spatialLayers");
  const [stored, setLayers] = useStoredMapLayers();
  const on = {
    startBoxes: layersShown ? stored.startBoxes : true,
    starts: layersShown && stored.starts,
    buildings: layersShown && stored.buildings,
    density: layersShown && stored.density,
    orderDensity: layersShown && stored.orderDensity,
    bases: layersShown && stored.bases,
  };

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
  const aspect =
    heightmap?.width && heightmap?.height
      ? `${heightmap.width} / ${heightmap.height}`
      : "1 / 1";

  // Build orders are read once for the page. A layer that draws them asks for
  // them when it is switched on, including one left on from the last visit.
  const orders = useReplayBuildOrders(replayPath ?? "");
  const wantOrders = !!replayPath && (on.buildings || on.density || on.bases);
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
  const [colourMode] = useStoredColorMode();
  const { resolved: theme } = useTheme();
  const trailer = stats.data?.trailer ?? null;
  const colours = useMemo(
    () => teamColours(info, trailer, colourMode, theme, swatch),
    [info, trailer, colourMode, theme],
  );

  const primary = usePrimaryPlayer();
  const meTeam = primary ? playerTeam(info, primary) : undefined;
  const openings = useMemo(
    () => openingsByTeam(result?.orders ?? [], units.units),
    [result, units.units],
  );
  const dots = useMemo(
    () => (sized ? startDots(info, world, colours, meTeam, openings) : []),
    [sized, info, world, colours, meTeam, openings],
  );

  // The time window (#1153). The layers that have a time to filter by are read
  // through it, and the ones that are set before the game are not.
  const buildLayer = on.buildings || on.density || on.bases;
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
  const [timeWindow, setTimeWindow] = useReplayTimeWindow(
    replayPath ?? "",
    domainSec,
  );
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
    toggles: stored,
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

  const emphasis = useSeriesEmphasis();
  const marksRef = useRef<HTMLCanvasElement | null>(null);
  const heatRef = useRef<HTMLCanvasElement | null>(null);
  const orderHeatRef = useRef<HTMLCanvasElement | null>(null);
  const marks = on.buildings ? (built?.marks ?? null) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the emphasis state stands for isLit and dimming
  useEffect(() => {
    const canvas = marksRef.current;
    if (!canvas || !marks) return;
    drawMarks(
      canvas,
      marks,
      colours,
      (team) => team !== undefined && emphasis.isLit([team]),
      emphasis.dimming,
    );
  }, [marks, colours, emphasis.state]);
  useEffect(() => {
    const canvas = heatRef.current;
    if (canvas && field)
      drawHeatField(canvas, field, HEAT_KIND_OF_LAYER.density);
  }, [field]);
  useEffect(() => {
    const canvas = orderHeatRef.current;
    if (canvas && orderField)
      drawHeatField(canvas, orderField, HEAT_KIND_OF_LAYER.orderDensity);
  }, [orderField]);

  const [handle, setHandle] = useState<MapScene3D | null>(null);
  // One 3D layer for each density, so two on at once are both on the terrain,
  // each in its own ramp. Layers at one depth are drawn in the order they were
  // made, so orders go first and the sparser buildings sit on top of them.
  useHeatmapLayer(handle, orderField, HEAT_KIND_OF_LAYER.orderDensity);
  useHeatmapLayer(handle, field, HEAT_KIND_OF_LAYER.density);
  useHeatmapLayer(handle, ev.field, HEAT_KIND_OF_LAYER.deaths);
  useHeatmapLayer(handle, ev.damageField, HEAT_KIND_OF_LAYER.damage);

  const boxes = on.startBoxes ? info.allyTeams.filter((a) => a.startBox) : [];
  const hasBoxes = info.allyTeams.some((a) => a.startBox);
  const noStarts = on.starts && (info.startPositions?.length ?? 0) === 0;
  const placed = built?.marks.length ?? 0;
  const categorised = built?.marks.some((m) => m.category !== null) ?? false;
  const usedCategories = UNIT_CATEGORIES.filter((category) =>
    built?.marks.some((m) => m.category === category),
  );
  const [marksW, marksH] = [
    MARKS_WIDTH,
    sized
      ? Math.round((MARKS_WIDTH * world.worldHeight) / world.worldWidth)
      : MARKS_WIDTH,
  ];

  // The minimap and the 3D preview sit side by side. Everything said about the
  // layers goes under both, across the section, so a wide page is used and the
  // base views have room to sit in a row.
  const showColourNote =
    (orderField?.peak ?? 0) > 0 ||
    (field?.peak ?? 0) > 0 ||
    (ev.field?.peak ?? 0) > 0 ||
    (ev.damageField?.peak ?? 0) > 0;
  const basesShown = on.bases && dots.length > 0 && !!inWindow;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        {heading}
        <SectionHelp
          section="the map"
          source="stream"
          detail="Start boxes come from the match setup."
        >
          {layersShown && (windowed || ev.active) && (
            <TimeWindowHelp
              activity={activity}
              subject={windowSubject(windowed, ev.active)}
            />
          )}
          {on.startBoxes && hasBoxes && (
            <p>A start box is where a team was allowed to start.</p>
          )}
          {on.starts && !noStarts && (
            <p>
              A dot is where a player's start was set before the game. The
              engine can move a start into its start box, so the commander may
              have appeared a short way off. Point at a dot to see whose it is.
            </p>
          )}
          {wantOrders && built && placed > 0 && (
            <p>
              Buildings ordered shows the orders each player gave, not what was
              built. An order that was cancelled or never carried out is drawn
              like any other.
              {built.unplaced > 0 &&
                ` ${built.unplaced.toLocaleString()} factory queue ${built.unplaced === 1 ? "order has" : "orders have"} no position and ${built.unplaced === 1 ? "is" : "are"} not drawn.`}
              {built.offMap > 0 &&
                ` ${built.offMap.toLocaleString()} ${built.offMap === 1 ? "order was" : "orders were"} placed off the map and ${built.offMap === 1 ? "is" : "are"} not drawn.`}
              {on.buildings && " A mark is one order, in its player's colour."}
            </p>
          )}
          {wantPoints && allOrders && allOrders.count > 0 && bySender && (
            <>
              <p>
                Order density shows where orders were aimed, which is roughly
                where attention went.{" "}
                {(orderField?.counted ?? 0).toLocaleString()} orders
                {timeWindow ? " in this window" : ""} are on it, from the
                player's own selection, widgets acting for them and AIs alike
                {bySender.lua > 0 &&
                  `, and ${bySender.lua.toLocaleString()} of them were sent by widgets`}
                .
              </p>
              <p>
                Orders aimed at a unit are not on it, as the replay holds the
                unit and not its position.{" "}
                {allOrders.unitAimed.toLocaleString()}{" "}
                {allOrders.unitAimed === 1 ? "order was" : "orders were"} aimed
                at a unit
                {timeWindow
                  ? " in the whole match, which the window cannot narrow"
                  : ""}
                .
                {allOrders.custom > 0 &&
                  ` ${allOrders.custom.toLocaleString()} ${allOrders.custom === 1 ? "order was" : "orders were"} a command the engine does not define, which a game or a widget made up and which says nothing about where it points, and ${allOrders.custom === 1 ? "is" : "are"} left out.`}
                {(orderField?.dropped ?? 0) > 0 &&
                  ` ${(orderField?.dropped ?? 0).toLocaleString()} ${orderField?.dropped === 1 ? "order was" : "orders were"} aimed off the map and ${orderField?.dropped === 1 ? "is" : "are"} not drawn.`}
              </p>
            </>
          )}
          {showColourNote && (
            <p>
              Colours compare places on this map with each other, not with
              another picture.
            </p>
          )}
          {layersShown && <EventLayerHelp ev={ev} />}
          {layersShown && <StartUnitHelp ev={ev} />}
          {basesShown && (
            <BaseCropsHelp
              world={world}
              timeWindow={timeWindow}
              domainSec={domainSec}
            />
          )}
        </SectionHelp>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div
          data-map-column
          className="relative flex w-full max-w-sm shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-card"
        >
          <div className="relative inline-flex max-h-full max-w-full">
            <img
              src={minimapUrl}
              alt={`Minimap of ${mapName}`}
              style={{ aspectRatio: aspect }}
              className="block max-h-full max-w-full object-fill"
            />
            {/* Orders cover most of a map and buildings a few patches of it,
                so the sparser layer goes on top where it can still be seen. */}
            {orderField && orderField.peak > 0 && (
              <canvas
                ref={orderHeatRef}
                data-layer="orderDensity"
                className="pointer-events-none absolute inset-0 size-full"
              />
            )}
            {field && field.peak > 0 && (
              <canvas
                ref={heatRef}
                data-layer="density"
                className="pointer-events-none absolute inset-0 size-full"
              />
            )}
            {boxes.map((a) => {
              const b = a.startBox as StartBox;
              const c = swatch(a.color) ?? NEUTRAL_TEAM_COLOUR;
              return (
                <span
                  key={a.id}
                  data-layer="startBox"
                  className="absolute flex items-start justify-start"
                  style={{
                    left: `${b.left * 100}%`,
                    top: `${b.top * 100}%`,
                    width: `${(b.right - b.left) * 100}%`,
                    height: `${(b.bottom - b.top) * 100}%`,
                    border: `1.5px solid ${c}`,
                    backgroundColor: c
                      .replace("rgb", "rgba")
                      .replace(")", ", 0.22)"),
                  }}
                  title={`${teamLabel(a.id)} start box`}
                >
                  <span
                    className="m-0.5 rounded px-1 text-[10px] font-medium leading-tight text-white"
                    style={{
                      backgroundColor: c
                        .replace("rgb", "rgba")
                        .replace(")", ", 0.85)"),
                    }}
                  >
                    {a.id + 1}
                  </span>
                </span>
              );
            })}
            {marks && marks.length > 0 && (
              <canvas
                ref={marksRef}
                width={marksW}
                height={marksH}
                data-layer="buildings"
                className="pointer-events-none absolute inset-0 size-full"
              />
            )}
            <EventLayerCanvases
              ev={ev}
              colours={colours}
              worldWidth={world.worldWidth}
              worldHeight={world.worldHeight}
            />
            <StartUnitCanvas
              ev={ev}
              info={info}
              colours={colours}
              world={world}
            />
            {on.starts &&
              dots.map((dot) => <StartDotButton key={dot.team} dot={dot} />)}
          </div>
        </div>
        {preview && (
          <MapPreview3D
            {...preview}
            className="w-full min-w-0 lg:flex-1"
            worldWidth={world.worldWidth || 1}
            worldHeight={world.worldHeight || 1}
            onScene={setHandle}
          />
        )}
      </div>

      {!layersShown && boxes.length > 0 && (
        <p className="text-xs text-muted-foreground">Start boxes per team.</p>
      )}

      {layersShown && (
        <div data-map-controls className="flex flex-col gap-2">
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            spacing={1}
            aria-label="Map layers"
            className="w-full flex-wrap"
            value={layersOn(stored).filter(
              (l) => !ev.block || !EVENT_MAP_LAYERS.includes(l),
            )}
            onValueChange={(picked) => {
              const next = oneOfDeathsAndDamage(picked, stored);
              setLayers(ev.block ? holdEventLayers(next, stored) : next);
            }}
          >
            <ToggleGroupItem value="startBoxes">Start boxes</ToggleGroupItem>
            <ToggleGroupItem value="starts">Start positions</ToggleGroupItem>
            <ToggleGroupItem value="buildings">
              Buildings ordered
            </ToggleGroupItem>
            <ToggleGroupItem value="density">Building density</ToggleGroupItem>
            <ToggleGroupItem value="orderDensity">
              Order density
            </ToggleGroupItem>
            <ToggleGroupItem value="bases">Bases</ToggleGroupItem>
            <EventToggle value="deaths" reason={ev.block}>
              Deaths
            </EventToggle>
            <EventToggle value="damage" reason={ev.block}>
              Damage dealt
            </EventToggle>
            <EventToggle value="finished" reason={ev.block}>
              Buildings finished
            </EventToggle>
            <EventToggle value="startUnitDeaths" reason={ev.block}>
              Starting unit deaths
            </EventToggle>
            <EventToggle value="startUnitPaths" reason={ev.block}>
              Starting unit paths
            </EventToggle>
          </ToggleGroup>

          {(windowed || ev.active) && (
            // Straight under the maps it filters, and wide enough to drag.
            <div data-map-window className="w-full max-w-3xl">
              <ReplayTimeWindowControl
                domainSec={domainSec}
                window={timeWindow}
                onChange={setTimeWindow}
                activity={activity}
                // With the order layer on as well there are two kinds of point
                // to count, and each is counted under its own name.
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
                      ? "building orders"
                      : "orders on the map"
                    : undefined
                }
                also={
                  on.orderDensity && buildLayer
                    ? {
                        count: orderCount,
                        noun: "orders on the map",
                      }
                    : undefined
                }
                events={ev.counts}
                subject={windowSubject(windowed, ev.active)}
              />
            </div>
          )}
          {/* Prose is held to a width that reads. The base views below are not. */}
          <div data-map-notes className="flex max-w-prose flex-col gap-2">
            <EventLayerNotes ev={ev} />
            <StartUnitNotes ev={ev} info={info} />

            {on.startBoxes && !hasBoxes && (
              <p className="text-xs text-muted-foreground">
                This match set no start boxes.
              </p>
            )}

            {noStarts && (
              <p className="text-xs text-muted-foreground">
                This replay recorded no start positions.
              </p>
            )}
            {wantOrders && orders.loading && (
              <p className="text-xs text-muted-foreground">
                Reading build orders…
              </p>
            )}
            {wantOrders && orders.failed && (
              <p className="text-xs text-destructive">
                The build orders could not be read from this replay.
              </p>
            )}
            {wantOrders && built && placedCount.total === 0 && (
              <p className="text-xs text-muted-foreground">
                No buildings were ordered in this replay.
              </p>
            )}
            {wantOrders && result?.incomplete && (
              <p className="text-xs text-muted-foreground">
                This replay could not be read to the end, so later build orders
                may be missing.
              </p>
            )}

            {wantPoints && orderPoints.loading && (
              <p className="text-xs text-muted-foreground">Reading orders…</p>
            )}
            {wantPoints && orderPoints.failed && (
              <p className="text-xs text-destructive">
                The orders could not be read from this replay.
              </p>
            )}
            {wantPoints && allOrders && allOrders.count === 0 && (
              <p className="text-xs text-muted-foreground">
                No orders with a place on the map were given in this replay.
              </p>
            )}
            {wantPoints && allOrders?.incomplete && (
              <p className="text-xs text-muted-foreground">
                This replay could not be read to the end, so later orders may be
                missing.
              </p>
            )}

            {on.buildings && placed > 0 && (
              <>
                {categorised ? (
                  <ShapeKey
                    shapes={usedCategories.map((category) => [
                      CATEGORY_SHAPE[category],
                      CATEGORY_LABEL[category],
                    ])}
                  />
                ) : units.status === "loading" ? (
                  <p className="text-xs text-muted-foreground">
                    Reading unit names…
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {units.source?.kind === "notInstalled"
                      ? `${units.recorded || "This replay's game"} is not installed, so nothing says what each building is for and every mark is the same shape.`
                      : "The units of this replay's game could not be read, so every mark is the same shape."}
                  </p>
                )}
                {categorised && (
                  <StoredListNote source={units.source} subject="Shapes" />
                )}
                {categorised && units.source?.kind === "differentBuild" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    This replay was played on {units.recorded}, which is not
                    installed. Shapes come from {units.source.game.name}, a
                    different build, and may be wrong.
                  </p>
                )}
              </>
            )}

            {orderField && orderField.peak > 0 && (
              <HeatLegend
                label="Where orders were aimed"
                peak={`${Math.round(orderField.peakWithinRadius ?? 0).toLocaleString()} ${Math.round(orderField.peakWithinRadius ?? 0) === 1 ? "order" : "orders"} within ${Math.round(orderField.radius).toLocaleString()} elmos of one spot${timeWindow ? " in this window" : ""}`}
                kind={HEAT_KIND_OF_LAYER.orderDensity}
              />
            )}
            {field && field.peak > 0 && (
              <HeatLegend
                label="Where buildings were ordered"
                peak={`${Math.round(field.peakWithinRadius ?? 0).toLocaleString()} ${Math.round(field.peakWithinRadius ?? 0) === 1 ? "order" : "orders"} within ${Math.round(field.radius).toLocaleString()} elmos of one spot${timeWindow ? " in this window" : ""}`}
                kind={HEAT_KIND_OF_LAYER.density}
              />
            )}
          </div>
          {on.bases && (
            <ReplayBaseCrops
              info={info}
              dots={dots}
              orders={inWindow}
              world={world}
              units={units.units}
              minimapUrl={minimapUrl}
              timeWindow={timeWindow}
            />
          )}
        </div>
      )}
    </div>
  );
}
