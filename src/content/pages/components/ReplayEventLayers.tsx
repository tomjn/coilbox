import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { HeatLegend } from "@/components/HeatLegend";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatNumber } from "@/lib/format";
import { drawHeatField } from "@/lib/heatCanvas";
import { HEAT_KIND_OF_LAYER } from "@/lib/heatRamp";
import { ANALYSIS_SECTION_ID } from "../../replayAnalysis";
import { damageLegend } from "../../replayDamage";
import {
  deathLegend,
  eventLayerNames,
  outdatedNote,
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
import { StoredListNote } from "./UnitListNotes";

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
  const damageRef = useRef<HTMLCanvasElement | null>(null);
  const { field, finishedMarks, damageField } = ev;

  useEffect(() => {
    const canvas = damageRef.current;
    if (canvas && damageField)
      drawHeatField(canvas, damageField, HEAT_KIND_OF_LAYER.damage);
  }, [damageField]);

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
      {damageField && damageField.peak > 0 && (
        <canvas
          ref={damageRef}
          data-layer="damage"
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
  const { t } = useLingui();
  const { state, units } = ev;
  const reading =
    (ev.deathsOn && ev.deathRead.status === "loading") ||
    (ev.finishedOn && ev.finishedRead.status === "loading") ||
    (ev.damageOn && ev.damageRead.status === "loading") ||
    ev.startRead.status === "loading";
  const failed =
    (ev.deathsOn && ev.deathRead.status === "failed") ||
    (ev.finishedOn && ev.finishedRead.status === "failed") ||
    (ev.damageOn && ev.damageRead.status === "failed") ||
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
              <Trans>Go to the analysis section</Trans>
            </button>
          </>
        )}
      </p>
    );
  }
  if (state.kind !== "ready" || !ev.active) return null;

  const differentBuild = units.source?.kind === "differentBuild";
  const recordedGame = units.recorded || t`This replay's game`;
  const unitsNote = () =>
    units.status === "loading" ? (
      <p className="text-xs text-muted-foreground">
        <Trans>Reading unit names…</Trans>
      </p>
    ) : units.source?.kind === "notInstalled" ? (
      <p className="text-xs text-muted-foreground">
        <Trans>
          {recordedGame} is not installed, so nothing says which finished units
          are buildings, so this layer needs the game installed.
        </Trans>
      </p>
    ) : (
      <p className="text-xs text-muted-foreground">
        <Trans>
          The units of this replay's game could not be read, so nothing says
          which finished units are buildings, so this layer needs the game
          installed.
        </Trans>
      </p>
    );
  const sourceGame =
    units.source?.kind === "differentBuild" ? units.source.game.name : "";
  const diedCount = ev.deaths.length;
  const finishedCount = ev.finishedAll?.marks.length ?? 0;

  const finished = ev.finishedAll;
  const deathLegendText = ev.field
    ? deathLegend(ev.field, ev.weighted, ev.windowed)
    : null;

  return (
    <>
      {state.outdated && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {outdatedNote()}
        </p>
      )}
      {reading && (
        <p className="text-xs text-muted-foreground">
          <Trans>Reading events…</Trans>
        </p>
      )}
      {failed && (
        <p className="text-xs text-destructive">
          <Trans>
            The events could not be read from this replay's analysis.
          </Trans>
        </p>
      )}

      {ev.deathsOn && ev.deathRead.status === "done" && (
        <>
          {ev.deaths.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              <Trans>No unit died in this analysis.</Trans>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              <Plural
                value={diedCount}
                one="# unit died."
                other="# units died."
              />
            </p>
          )}
          {ev.canWeigh && (
            <div className="flex flex-col gap-1">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                aria-label={t`What the deaths are counted as`}
                value={ev.weighted ? "cost" : "count"}
                onValueChange={(v) => {
                  if (v) ev.setCostMode(v === "cost");
                }}
              >
                <ToggleGroupItem value="count">{t`Units lost`}</ToggleGroupItem>
                <ToggleGroupItem value="cost">{t`Metal cost lost`}</ToggleGroupItem>
              </ToggleGroup>
              {ev.weighted && (
                <StoredListNote source={units.source} subject={t`Costs`} />
              )}
              {ev.weighted &&
                differentBuild &&
                units.source?.kind === "differentBuild" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    <Trans>
                      This replay was played on {units.recorded}, which is not
                      installed. Costs come from {sourceGame}, a different
                      build, and may be wrong.
                    </Trans>
                  </p>
                )}
            </div>
          )}
        </>
      )}

      {ev.damageOn && ev.damageRead.status === "done" && (
        <DamageNotes ev={ev} />
      )}

      {ev.finishedOn && ev.finishedRead.status === "done" && !finished
        ? unitsNote()
        : null}
      {finished && (
        <>
          <p className="text-xs text-muted-foreground">
            <Plural
              value={finishedCount}
              one="# building finished."
              other="# buildings finished."
            />
          </p>
          {finished.marks.length > 0 && <OutlineKey ev={ev} />}
          <StoredListNote
            source={units.source}
            subject={t`Shapes and the choice of buildings`}
          />
          {differentBuild && units.source?.kind === "differentBuild" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              <Trans>
                This replay was played on {units.recorded}, which is not
                installed. Shapes and the choice of buildings come from{" "}
                {sourceGame}, a different build, and may be wrong.
              </Trans>
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

/** What the damage layer says under the map: its mode, its warnings and its
 *  legend. What it counts is in {@link EventLayerHelp}. */
function DamageNotes({ ev }: { ev: EventLayers }) {
  const { t } = useLingui();
  if (!ev.damageRecorded)
    return (
      <p className="text-xs text-muted-foreground" data-testid="damage">
        <Trans>
          This analysis was recorded before coilbox logged damage, so there is
          nothing to draw. Analyse the replay again to record it.
        </Trans>{" "}
        <button
          type="button"
          className="rounded-sm underline hover:no-underline focus-visible:ring-1 focus-visible:ring-ring"
          onClick={goToAnalysis}
        >
          <Trans>Go to the analysis section</Trans>
        </button>
      </p>
    );
  if (ev.damageSums.landed === 0)
    return (
      <p className="text-xs text-muted-foreground" data-testid="damage">
        {ev.windowed
          ? t`No damage was recorded in this window.`
          : t`No damage was recorded.`}
      </p>
    );
  if (!ev.damageFits)
    return (
      <p
        className="text-xs text-amber-600 dark:text-amber-400"
        data-testid="damage"
      >
        <Trans>
          The damage was recorded on a map of another size than the one
          installed, so it cannot be placed.
        </Trans>
      </p>
    );
  return (
    <div className="flex flex-col gap-2" data-testid="damage">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label={t`Which end of the damage is drawn`}
        value={ev.damageMode}
        onValueChange={(v) => {
          if (v === "at" || v === "origin") ev.setDamageMode(v);
        }}
      >
        <ToggleGroupItem value="at">{t`Where it landed`}</ToggleGroupItem>
        <ToggleGroupItem value="origin">{t`Where it came from`}</ToggleGroupItem>
      </ToggleGroup>
      {ev.damageField && ev.damageField.peak > 0 ? (
        <HeatLegend
          {...damageLegend(ev.damageField, ev.damageMode, ev.windowed)}
          kind={HEAT_KIND_OF_LAYER.damage}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          <Trans>
            None of it has an attacker, so it came from nowhere on the map.
          </Trans>
        </p>
      )}
    </div>
  );
}

/**
 * What the event layers mean, for the map's help entry: where the events come
 * from, what each count and mark stands for, and what was left out and how
 * many. The counts are the same ones the notes used to carry in place.
 */
export function EventLayerHelp({ ev }: { ev: EventLayers }) {
  const { state } = ev;
  const layerNames = eventLayerNames();
  const intro = (
    <p>
      <Trans>{layerNames} draw events from an analysis.</Trans>
    </p>
  );
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
          <Trans>
            Every player's deaths are counted, whoever is highlighted.
          </Trans>
          {noAttacker > 0 && (
            <>
              {" "}
              <Plural
                value={noAttacker}
                one="# death has no attacker recorded, such as a cancelled build, and is counted like the rest."
                other="# deaths have no attacker recorded, such as a cancelled build, and are counted like the rest."
              />
            </>
          )}
          {ev.field && ev.field.dropped > 0 && (
            <>
              {" "}
              <Plural
                value={ev.field.dropped}
                one="# death was off the map and is not drawn."
                other="# deaths were off the map and are not drawn."
              />
            </>
          )}
        </p>
      )}
      {showDeaths && ev.canWeigh && ev.weighted && (
        <p>
          <Trans>
            Each death counts its unit's metal cost from the installed game, so
            this is where value was lost and not where units died.
          </Trans>
          {ev.costed < ev.deaths.length && (
            <>
              {" "}
              <Plural
                value={ev.deaths.length - ev.costed}
                one="# death is of a unit with no stated cost and counts nothing."
                other="# deaths are of a unit with no stated cost and count nothing."
              />
            </>
          )}
        </p>
      )}
      {ev.damageOn && ev.damageRead.status === "done" && ev.damageRecorded && (
        <DamageHelp ev={ev} />
      )}
      {finished && (
        <p>
          <Trans>
            An outline is one finished building, in its player's colour. Beside
            Buildings ordered, a fill with an outline round it is an order that
            was carried out, a fill alone is an order with no building finished
            there, and an outline alone is a building no order in the window
            placed.
          </Trans>
          {finished.mobile > 0 && (
            <>
              {" "}
              <Plural
                value={finished.mobile}
                one="# finished unit that moves is not drawn, because only a building can be compared with an order."
                other="# finished units that move are not drawn, because only a building can be compared with an order."
              />
            </>
          )}
          {finished.unknown > 0 && (
            <>
              {" "}
              <Plural
                value={finished.unknown}
                one="# finished unit has no definition in the installed game and is not drawn."
                other="# finished units have no definition in the installed game and are not drawn."
              />
            </>
          )}
          {finished.offMap > 0 && (
            <>
              {" "}
              <Plural
                value={finished.offMap}
                one="# building stands off the map and is not drawn."
                other="# buildings stand off the map and are not drawn."
              />
            </>
          )}
        </p>
      )}
    </>
  );
}

/** What the damage layer counts and leaves out, for the map's help entry. */
function DamageHelp({ ev }: { ev: EventLayers }) {
  const sums = ev.damageSums;
  const whole = (n: number) => formatNumber(Math.round(n));
  const seconds = Math.round(ev.damageFrames / 30);
  const landed = whole(sums.landed);
  const unattacked = whole(sums.unattacked);
  const own = whole(sums.own);
  const offMap = whole(sums.offMap);
  return (
    <>
      <p>
        <Trans>
          Damage dealt is every hit on a unit that took health off it, added up
          where the unit stood, or where its attacker stood. A hit larger than
          the health its target had left counts for what was left. Paralysis and
          healing are not counted. Every player's damage is on it, whoever is
          highlighted, and it is drawn in the deaths layer's colours, so only
          one of the two shows at a time.
        </Trans>
      </p>
      <p>
        <Trans>
          The analysis adds damage up as the match plays and keeps totals for
          each {seconds} seconds and each square of the map's grid, not a line
          for each hit. So the time window keeps or drops whole stretches of{" "}
          {seconds} seconds, by when each begins.
        </Trans>{" "}
        {ev.windowed ? (
          <Trans>{landed} damage landed in this window.</Trans>
        ) : (
          <Trans>{landed} damage landed.</Trans>
        )}
        {sums.unattacked > 0 && (
          <>
            {" "}
            <Trans>
              {unattacked} of it had no attacker, such as a fall or a script,
              and has no place to come from.
            </Trans>
          </>
        )}
        {sums.own > 0 && (
          <>
            {" "}
            <Trans>{own} of it a player did to their own units.</Trans>
          </>
        )}
        {sums.offMap > 0 && (
          <>
            {" "}
            <Trans>
              {offMap} of it landed on a unit off the map and is not drawn.
            </Trans>
          </>
        )}
      </p>
      <p>
        <Trans>
          These sums differ from the damage figures in the match chart. The
          engine's own total counts each hit as the health its target was
          already missing, up to the size of the hit, so the first hit on an
          undamaged unit adds nothing to it.
        </Trans>
      </p>
    </>
  );
}
