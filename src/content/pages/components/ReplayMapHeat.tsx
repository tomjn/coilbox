import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "@picoframe/frame";
import { useEffect, useRef } from "react";
import { drawHeatField } from "@/lib/heatCanvas";
import { HEAT_KIND_OF_LAYER } from "@/lib/heatRamp";
import type { DemoInfo, StartBox } from "../../bindings";
import {
  type BuildMark,
  CATEGORY_LABEL,
  CATEGORY_SHAPE,
  MARK_SHAPES,
  type MarkShape,
  NEUTRAL_SHAPE,
  NEUTRAL_TEAM_COLOUR,
  type StartDot,
  startDotName,
} from "../../replayMapLayers";
import { teamLabel } from "../../replaySideLabel";
import { useReplayMapLayers } from "../../useReplayMapLayers";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";
import { ReplayBaseCrops } from "./ReplayBaseCrops";
import { EventLayerCanvases, EventLayerNotes } from "./ReplayEventLayers";
import {
  FLAT_LAYERS,
  HeatLegends,
  LayerSwitches,
  LayersHelp,
  MapHelp,
  MapTimeWindow,
  mapBoxWidth,
  ReadNotes,
  ReplayMapLayout,
} from "./ReplayMapRail";
import { swatch } from "./ReplayRoster";
import { StartUnitCanvas, StartUnitNotes } from "./ReplayStartUnitLayer";
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
  const { t } = useLingui();
  const name = startDotName(dot);
  const opening = dot.opening;
  const says = [
    name,
    dot.isMe ? t`you` : null,
    opening ? t`opened with ${opening}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      data-team={dot.team}
      data-x={dot.x}
      data-z={dot.z}
      aria-label={t`Start position of ${says}`}
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
            {dot.isMe ? t`${name} (you)` : name}
          </span>
          {dot.opening && (
            <span className="block">
              <Trans>Opened with {opening}</Trans>
            </span>
          )}
        </span>
      )}
    </button>
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
 * The Heat mode of the replay's map card: the flat map with its layers (#1152),
 * where each player really started, where buildings were ordered, and how
 * thickly. The start boxes were here before and are one more layer. Everything
 * but the start boxes is gated on the `analytics.spatialLayers` profile key.
 *
 * The switches are in the rail beside the map, and the legend for each layer
 * that is on under them. Mount it under a `SeriesEmphasisProvider`: a start dot
 * lights its player on the chart and the roster, and they light the dot.
 */
export function ReplayMapHeat({
  info,
  replayPath,
  mapName,
  minimapUrl,
  heightmap,
}: {
  info: DemoInfo;
  replayPath: string | undefined;
  mapName: string;
  minimapUrl: string;
  /** The heightmap's own size, which gives the map its shape and world size. */
  heightmap: { width?: number; height?: number } | null | undefined;
}) {
  const { t } = useLingui();
  const layers = useReplayMapLayers({
    info,
    replayPath,
    heightmap,
    shown: FLAT_LAYERS,
  });
  const {
    layersShown,
    on,
    ratio,
    aspect,
    world,
    colours,
    dots,
    ev,
    built,
    field,
    orderField,
    units,
    placed,
    categorised,
    usedCategories,
    inWindow,
    timeWindow,
  } = layers;

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

  const boxes = on.startBoxes ? info.allyTeams.filter((a) => a.startBox) : [];
  const hasBoxes = info.allyTeams.some((a) => a.startBox);
  const noStarts = on.starts && (info.startPositions?.length ?? 0) === 0;
  const [marksW, marksH] = [MARKS_WIDTH, Math.round(MARKS_WIDTH / ratio)];
  const recordedGame = units.recorded;
  const differentBuildName =
    units.source?.kind === "differentBuild" ? units.source.game.name : "";

  return (
    <ReplayMapLayout
      map={
        <div style={{ width: mapBoxWidth(ratio, 1) }} className="max-w-full">
          <div
            data-map-ground
            style={{ aspectRatio: aspect }}
            className="relative w-full overflow-hidden rounded-md border border-border/50"
          >
            <img
              src={minimapUrl}
              alt={t`Minimap of ${mapName}`}
              className="block size-full object-fill"
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
              const boxTeam = teamLabel(a.id);
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
                  title={t`${boxTeam} start box`}
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
      }
      rail={
        <>
          <MapHelp
            section={t`the map`}
            source="stream"
            detail={t`Start boxes come from the match setup.`}
          >
            <LayersHelp layers={layers} info={info} flat />
          </MapHelp>

          {!layersShown && boxes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <Trans>Start boxes per team.</Trans>
            </p>
          )}

          {layersShown && (
            <div data-map-controls className="flex flex-col gap-3">
              <LayerSwitches layers={layers} only={FLAT_LAYERS} />
              <div data-map-notes className="flex flex-col gap-2">
                <EventLayerNotes ev={ev} />
                <StartUnitNotes ev={ev} info={info} />

                {on.startBoxes && !hasBoxes && (
                  <p className="text-xs text-muted-foreground">
                    <Trans>This match set no start boxes.</Trans>
                  </p>
                )}

                {noStarts && (
                  <p className="text-xs text-muted-foreground">
                    <Trans>This replay recorded no start positions.</Trans>
                  </p>
                )}
                <ReadNotes layers={layers} />

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
                        <Trans>Reading unit names…</Trans>
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {units.source?.kind === "notInstalled"
                          ? units.recorded
                            ? t`${recordedGame} is not installed, so nothing says what each building is for and every mark is the same shape.`
                            : t`This replay's game is not installed, so nothing says what each building is for and every mark is the same shape.`
                          : t`The units of this replay's game could not be read, so every mark is the same shape.`}
                      </p>
                    )}
                    {categorised && (
                      <StoredListNote source={units.source} subject="Shapes" />
                    )}
                    {categorised && units.source?.kind === "differentBuild" && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        <Trans>
                          This replay was played on {recordedGame}, which is not
                          installed. Shapes come from {differentBuildName}, a
                          different build, and may be wrong.
                        </Trans>
                      </p>
                    )}
                  </>
                )}

                <HeatLegends layers={layers} />
              </div>
            </div>
          )}
        </>
      }
      under={
        layersShown && (
          <>
            <MapTimeWindow layers={layers} />
            {on.bases && (
              <ReplayBaseCrops
                info={info}
                dots={layers.dots}
                orders={inWindow}
                world={world}
                units={units.units}
                minimapUrl={minimapUrl}
                timeWindow={timeWindow}
              />
            )}
          </>
        )
      }
    />
  );
}
