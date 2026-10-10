import { useEffect, useRef } from "react";
import { HeatLegend } from "@/components/HeatLegend";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { drawHeatField } from "@/lib/heatCanvas";
import { HEAT_KIND_OF_LAYER } from "@/lib/heatRamp";
import { ANALYSIS_SECTION_ID } from "../../replayAnalysis";
import {
  deathLegend,
  EVENT_LAYER_NAMES,
  OUTDATED_NOTE,
} from "../../replayEventLayers";
import {
  CATEGORY_LABEL,
  CATEGORY_SHAPE,
  MARK_SHAPES,
  NEUTRAL_SHAPE,
  NEUTRAL_TEAM_COLOUR,
} from "../../replayMapLayers";
import { REPLAY_SOURCE_NOTES } from "../../replaySources";
import { UNIT_CATEGORIES } from "../../unitCategory";
import type { EventLayers } from "../../useReplayEventLayers";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";

/** How much of a mark shows when another player is the emphasised one. The
 *  order marks use the same. */
const DIMMED = 0.18;

/** How wide the finished marks are drawn, as the order marks are. */
const MARKS_WIDTH = 768;

/** An outline is drawn this much larger than a filled mark, so one round an
 *  order's mark shows as a ring and not as the same shape. */
const OUTLINE_SCALE = 1.45;

/** A finished mark's half width as a fraction of the map's width. */
const MARK_SIZE = 0.0075;

/**
 * The event layers on the minimap: the deaths density, and an outline for each
 * finished building. Put it inside the box that holds the minimap image.
 *
 * A finished building is an outline and an order is a fill, so both on at once
 * tell the two apart by more than colour: a fill with a ring round it is an
 * order that was carried out.
 */
export function EventLayerCanvases({
  ev,
  colours,
  worldWidth,
  worldHeight,
}: {
  ev: EventLayers;
  colours: ReadonlyMap<number, string>;
  worldWidth: number;
  worldHeight: number;
}) {
  const emphasis = useSeriesEmphasis();
  const heatRef = useRef<HTMLCanvasElement | null>(null);
  const marksRef = useRef<HTMLCanvasElement | null>(null);
  const { field, finishedMarks } = ev;

  useEffect(() => {
    const canvas = heatRef.current;
    if (canvas && field)
      drawHeatField(canvas, field, HEAT_KIND_OF_LAYER.deaths);
  }, [field]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the emphasis state stands for isLit and dimming
  useEffect(() => {
    const canvas = marksRef.current;
    if (!canvas || !finishedMarks) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const size = width * MARK_SIZE * OUTLINE_SCALE;
    const paths = new Map<string, Path2D>();
    const lit = (team: number | undefined) =>
      team !== undefined && emphasis.isLit([team]);
    const ordered = emphasis.dimming
      ? [...finishedMarks].sort(
          (a, b) => Number(lit(a.team)) - Number(lit(b.team)),
        )
      : finishedMarks;
    ctx.lineJoin = "round";
    for (const mark of ordered) {
      const shape = mark.category
        ? CATEGORY_SHAPE[mark.category]
        : NEUTRAL_SHAPE;
      let path = paths.get(shape);
      if (!path) {
        path = new Path2D(MARK_SHAPES[shape]);
        paths.set(shape, path);
      }
      ctx.setTransform(size, 0, 0, size, mark.left * width, mark.top * height);
      ctx.globalAlpha = emphasis.dimming && !lit(mark.team) ? DIMMED : 0.95;
      // A dark line under the colour, so the outline reads on pale ground.
      ctx.lineWidth = 0.42;
      ctx.strokeStyle = "rgba(9, 13, 22, 0.9)";
      ctx.stroke(path);
      ctx.lineWidth = 0.24;
      ctx.strokeStyle =
        (mark.team === undefined ? undefined : colours.get(mark.team)) ??
        NEUTRAL_TEAM_COLOUR;
      ctx.stroke(path);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }, [finishedMarks, colours, emphasis.state]);

  const marksH =
    worldWidth > 0
      ? Math.round((MARKS_WIDTH * worldHeight) / worldWidth)
      : MARKS_WIDTH;

  return (
    <>
      {field && field.peak > 0 && (
        <canvas
          ref={heatRef}
          data-layer="deaths"
          className="pointer-events-none absolute inset-0 size-full"
        />
      )}
      {finishedMarks && finishedMarks.length > 0 && (
        <canvas
          ref={marksRef}
          width={MARKS_WIDTH}
          height={marksH}
          data-layer="finished"
          className="pointer-events-none absolute inset-0 size-full"
        />
      )}
    </>
  );
}

export function goToAnalysis() {
  document
    .getElementById(ANALYSIS_SECTION_ID)
    ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The outline shapes the finished marks use, one for each kind of building. */
function OutlineKey({ ev }: { ev: EventLayers }) {
  const used = UNIT_CATEGORIES.filter((category) =>
    ev.finishedMarks?.some((m) => m.category === category),
  );
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {used.map((category) => (
        <li key={category} className="flex items-center gap-1">
          <svg
            viewBox="-1.3 -1.3 2.6 2.6"
            className="size-3 fill-none stroke-current"
            strokeWidth={0.28}
            aria-hidden="true"
          >
            <path d={MARK_SHAPES[CATEGORY_SHAPE[category]]} />
          </svg>
          {CATEGORY_LABEL[category]}
        </li>
      ))}
    </ul>
  );
}

/**
 * What the event layers say under the map: why they cannot be switched on,
 * how many there are, the warnings, and the legend. What each one means is in
 * {@link EventLayerHelp}. Mount it where the other layers' notes are.
 */
export function EventLayerNotes({ ev }: { ev: EventLayers }) {
  const { state, units } = ev;
  const reading =
    (ev.deathsOn && ev.deathRead.status === "loading") ||
    (ev.finishedOn && ev.finishedRead.status === "loading") ||
    ev.startRead.status === "loading";
  const failed =
    (ev.deathsOn && ev.deathRead.status === "failed") ||
    (ev.finishedOn && ev.finishedRead.status === "failed") ||
    ev.startRead.status === "failed";

  if (ev.block) {
    const canPoint =
      (state.kind === "notAnalysed" && state.canAnalyse) ||
      state.kind === "diverged";
    return (
      <p className="text-xs text-muted-foreground" data-testid="event-block">
        {ev.block}
        {canPoint && (
          <>
            {" "}
            <button
              type="button"
              className="rounded-sm underline hover:no-underline focus-visible:ring-1 focus-visible:ring-ring"
              onClick={goToAnalysis}
            >
              Go to the analysis section
            </button>
          </>
        )}
      </p>
    );
  }
  if (state.kind !== "ready" || !ev.active) return null;

  const differentBuild = units.source?.kind === "differentBuild";
  const unitsNote = (what: string) =>
    units.status === "loading" ? (
      <p className="text-xs text-muted-foreground">Reading unit names…</p>
    ) : units.source?.kind === "notInstalled" ? (
      <p className="text-xs text-muted-foreground">
        {units.recorded || "This replay's game"} is not installed, so nothing
        says {what}.
      </p>
    ) : (
      <p className="text-xs text-muted-foreground">
        The units of this replay's game could not be read, so nothing says{" "}
        {what}.
      </p>
    );

  const finished = ev.finishedAll;
  const deathLegendText = ev.field
    ? deathLegend(ev.field, ev.weighted, ev.windowed)
    : null;

  return (
    <>
      {state.outdated && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {OUTDATED_NOTE}
        </p>
      )}
      {reading && (
        <p className="text-xs text-muted-foreground">Reading events…</p>
      )}
      {failed && (
        <p className="text-xs text-destructive">
          The events could not be read from this replay's analysis.
        </p>
      )}

      {ev.deathsOn && ev.deathRead.status === "done" && (
        <>
          {ev.deaths.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No unit died in this analysis.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {plural(ev.deaths.length, "unit died", "units died")}.
            </p>
          )}
          {ev.canWeigh && (
            <div className="flex flex-col gap-1">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                aria-label="What the deaths are counted as"
                value={ev.weighted ? "cost" : "count"}
                onValueChange={(v) => {
                  if (v) ev.setCostMode(v === "cost");
                }}
              >
                <ToggleGroupItem value="count">Units lost</ToggleGroupItem>
                <ToggleGroupItem value="cost">Metal cost lost</ToggleGroupItem>
              </ToggleGroup>
              {ev.weighted &&
                differentBuild &&
                units.source?.kind === "differentBuild" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    This replay was played on {units.recorded}, which is not
                    installed. Costs come from {units.source.game.name}, a
                    different build, and may be wrong.
                  </p>
                )}
            </div>
          )}
        </>
      )}

      {ev.finishedOn && ev.finishedRead.status === "done" && !finished
        ? unitsNote(
            "which finished units are buildings, so this layer needs the game installed",
          )
        : null}
      {finished && (
        <>
          <p className="text-xs text-muted-foreground">
            {plural(finished.marks.length, "building", "buildings")} finished.
          </p>
          {finished.marks.length > 0 && <OutlineKey ev={ev} />}
          {differentBuild && units.source?.kind === "differentBuild" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              This replay was played on {units.recorded}, which is not
              installed. Shapes and the choice of buildings come from{" "}
              {units.source.game.name}, a different build, and may be wrong.
            </p>
          )}
        </>
      )}

      {deathLegendText && ev.field && ev.field.peak > 0 && (
        <HeatLegend {...deathLegendText} kind={HEAT_KIND_OF_LAYER.deaths} />
      )}
    </>
  );
}

/**
 * What the event layers mean, for the map's help entry: where the events come
 * from, what each count and mark stands for, and what was left out and how
 * many. The counts are the same ones the notes used to carry in place.
 */
export function EventLayerHelp({ ev }: { ev: EventLayers }) {
  const { state } = ev;
  const intro = <p>{EVENT_LAYER_NAMES} draw events from an analysis.</p>;
  if (ev.block || state.kind !== "ready" || !ev.active) return intro;

  const noAttacker = ev.deaths.filter((d) => !d.attacked).length;
  const finished = ev.finishedAll;
  const showDeaths = ev.deathsOn && ev.deathRead.status === "done";
  return (
    <>
      {intro}
      <p className="text-muted-foreground">{REPLAY_SOURCE_NOTES.log}</p>
      {showDeaths && ev.deaths.length > 0 && (
        <p>
          Every player's deaths are counted, whoever is highlighted.
          {noAttacker > 0 &&
            ` ${plural(noAttacker, "death has", "deaths have")} no attacker recorded, such as a cancelled build, and ${noAttacker === 1 ? "is" : "are"} counted like the rest.`}
          {ev.field &&
            ev.field.dropped > 0 &&
            ` ${plural(ev.field.dropped, "death was", "deaths were")} off the map and ${ev.field.dropped === 1 ? "is" : "are"} not drawn.`}
        </p>
      )}
      {showDeaths && ev.canWeigh && ev.weighted && (
        <p>
          Each death counts its unit's metal cost from the installed game, so
          this is where value was lost and not where units died.
          {ev.costed < ev.deaths.length &&
            ` ${(ev.deaths.length - ev.costed).toLocaleString()} ${ev.deaths.length - ev.costed === 1 ? "death is" : "deaths are"} of a unit with no stated cost and count nothing.`}
        </p>
      )}
      {finished && (
        <p>
          An outline is one finished building, in its player's colour. Beside
          Buildings ordered, a fill with an outline round it is an order that
          was carried out, a fill alone is an order with no building finished
          there, and an outline alone is a building no order in the window
          placed.
          {finished.mobile > 0 &&
            ` ${plural(finished.mobile, "finished unit that moves is", "finished units that move are")} not drawn, because only a building can be compared with an order.`}
          {finished.unknown > 0 &&
            ` ${plural(finished.unknown, "finished unit has", "finished units have")} no definition in the installed game and ${finished.unknown === 1 ? "is" : "are"} not drawn.`}
          {finished.offMap > 0 &&
            ` ${plural(finished.offMap, "building stands", "buildings stand")} off the map and ${finished.offMap === 1 ? "is" : "are"} not drawn.`}
        </p>
      )}
    </>
  );
}
