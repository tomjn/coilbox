import { cn } from "@picoframe/frame";
import { useEffect, useMemo, useRef } from "react";
import { formatDuration } from "@/lib/format";
import type { DemoInfo } from "../../bindings";
import { FRAMES_PER_SECOND } from "../../chatClock";
import { playerLabels, teamLabel } from "../../replayAnalysisEvents";
import { type MapWorld, NEUTRAL_TEAM_COLOUR } from "../../replayMapLayers";
import {
  placeTrack,
  type StartUnitEnd,
  trackLength,
} from "../../replayStartUnits";
import type { EventLayers } from "../../useReplayEventLayers";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";
import { goToAnalysis } from "./ReplayEventLayers";

/** How wide the layer is drawn, as the other marks are. */
const CANVAS_WIDTH = 768;

/** How much of a line shows when another player is the emphasised one. The
 *  order marks use the same. */
const DIMMED = 0.18;

/** An end mark's half width as a fraction of the map's width. Larger than a
 *  building's mark, because there are a handful and each is one to find. */
const END_SIZE = 0.016;

const EDGE = "rgba(9, 13, 22, 0.9)";

/** The two end marks, in a box from -1 to 1. A cross and a ring, so the two
 *  are told apart by shape and not by colour. */
const CROSS = "M-1 -1 L1 1 M1 -1 L-1 1";
const RING = "M0.8 0 A0.8 0.8 0 1 1 -0.8 0 A0.8 0.8 0 1 1 0.8 0";

function EndIcon({ cause }: { cause: StartUnitEnd["cause"] }) {
  return (
    <svg
      viewBox="-1.4 -1.4 2.8 2.8"
      className="inline size-3 fill-none stroke-current align-[-1px]"
      strokeWidth={0.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d={cause === "destroyed" ? CROSS : RING} />
    </svg>
  );
}

/**
 * The two starting unit layers on the minimap: a line for where each one went,
 * with its player's name where the line ends, and a mark for where each one
 * ended. Put it inside the box that holds the minimap image.
 */
export function StartUnitCanvas({
  ev,
  info,
  colours,
  world,
}: {
  ev: EventLayers;
  info: DemoInfo;
  colours: ReadonlyMap<number, string>;
  world: MapWorld;
}) {
  const emphasis = useSeriesEmphasis();
  const ref = useRef<HTMLCanvasElement | null>(null);
  const names = useMemo(() => playerLabels(info), [info]);
  const { startPaths, startEnds } = ev;

  const lines = useMemo(
    () =>
      startPaths
        .map((path) => ({
          team: path.track.team,
          unit: path.track.unit,
          placed: placeTrack(path.points, world),
        }))
        .filter((line) => line.placed.length > 0),
    [startPaths, world],
  );
  const ends = useMemo(
    () =>
      startEnds.flatMap((end) => {
        const at = placeTrack([end], world)[0];
        return at ? [{ ...end, ...at }] : [];
      }),
    [startEnds, world],
  );
  const height =
    world.worldWidth > 0
      ? Math.round((CANVAS_WIDTH * world.worldHeight) / world.worldWidth)
      : CANVAS_WIDTH;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the emphasis state stands for isLit and dimming
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width: w, height: h } = canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const lit = (team: number) => emphasis.isLit([team]);
    const alpha = (team: number) =>
      emphasis.dimming && !lit(team) ? DIMMED : 0.95;
    const colour = (team: number) => colours.get(team) ?? NEUTRAL_TEAM_COLOUR;
    // The emphasised player's line goes on last, so it is never under another.
    const byLit = <T extends { team: number }>(items: T[]) =>
      emphasis.dimming
        ? [...items].sort((a, b) => Number(lit(a.team)) - Number(lit(b.team)))
        : items;

    for (const line of byLit(lines)) {
      ctx.globalAlpha = alpha(line.team);
      const trace = () => {
        ctx.beginPath();
        line.placed.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.left * w, p.top * h);
          else ctx.lineTo(p.left * w, p.top * h);
        });
      };
      // A dark line under the colour, so a path reads on pale ground and on a
      // player colour close to the map's own.
      trace();
      ctx.lineWidth = 5;
      ctx.strokeStyle = EDGE;
      ctx.stroke();
      trace();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = colour(line.team);
      ctx.stroke();
      // Where the path begins, so its direction can be read.
      const first = line.placed[0];
      ctx.beginPath();
      ctx.arc(first.left * w, first.top * h, 4, 0, Math.PI * 2);
      ctx.fillStyle = colour(line.team);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = EDGE;
      ctx.stroke();
    }

    const size = w * END_SIZE;
    for (const end of byLit(ends)) {
      const path = new Path2D(end.cause === "destroyed" ? CROSS : RING);
      ctx.setTransform(size, 0, 0, size, end.left * w, end.top * h);
      ctx.globalAlpha = alpha(end.team);
      ctx.lineWidth = 0.62;
      ctx.strokeStyle = EDGE;
      ctx.stroke(path);
      ctx.lineWidth = 0.34;
      ctx.strokeStyle = colour(end.team);
      ctx.stroke(path);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.globalAlpha = 1;
  }, [lines, ends, colours, emphasis.state]);

  if (lines.length === 0 && ends.length === 0) return null;
  return (
    <>
      <canvas
        ref={ref}
        width={CANVAS_WIDTH}
        height={height}
        data-layer="startUnits"
        className="pointer-events-none absolute inset-0 size-full"
      />
      {lines.map((line) => {
        const last = line.placed[line.placed.length - 1];
        const lit = emphasis.isLit([line.team]);
        return (
          <span
            key={line.unit}
            data-start-unit-label={line.team}
            className={cn(
              "pointer-events-none absolute ml-1.5 max-w-24 -translate-y-1/2 truncate rounded bg-black/80 px-1 py-0.5 text-[10px] leading-tight text-white",
              lit ? "z-20" : "z-10",
              emphasis.dimming && !lit && "opacity-40",
            )}
            style={{ left: `${last.left * 100}%`, top: `${last.top * 100}%` }}
          >
            {teamLabel(line.team, names)}
          </span>
        );
      })}
    </>
  );
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

function endInWords(
  end: StartUnitEnd,
  names: ReadonlyMap<number, string>,
): string {
  const who = teamLabel(end.team, names);
  const when = formatDuration(Math.max(0, end.frame / FRAMES_PER_SECOND));
  if (end.cause === "removed")
    return `${who}: removed by the game's own script at ${when}`;
  if (end.attackerTeam === undefined)
    return `${who}: destroyed at ${when}, with no attacker recorded`;
  return end.attackerTeam === end.team
    ? `${who}: destroyed at ${when} by their own units`
    : `${who}: destroyed at ${when} by ${teamLabel(end.attackerTeam, names)}`;
}

/**
 * What the two starting unit layers say under the map: what a starting unit
 * is, what was found, and each one that was lost. Mount it after
 * `EventLayerNotes`, which says where the events come from.
 */
export function StartUnitNotes({
  ev,
  info,
}: {
  ev: EventLayers;
  info: DemoInfo;
}) {
  const names = useMemo(() => playerLabels(info), [info]);
  if (ev.state.kind !== "ready" || !(ev.startDeathsOn || ev.startPathsOn))
    return null;
  if (ev.startRead.status !== "done") return null;

  if (!ev.startUnitsRecorded)
    return (
      <p className="text-xs text-muted-foreground" data-testid="start-units">
        This analysis was recorded before coilbox logged starting units, so
        there is nothing to draw. Analyse the replay again to record them.{" "}
        <button
          type="button"
          className="rounded-sm underline hover:no-underline focus-visible:ring-1 focus-visible:ring-ring"
          onClick={goToAnalysis}
        >
          Go to the analysis section
        </button>
      </p>
    );

  const { tracks, startEnds, startPaths } = ev;
  if (tracks.length === 0)
    return (
      <p className="text-xs text-muted-foreground" data-testid="start-units">
        This analysis recorded no starting unit. A player's first unit has to be
        made for them at the start, not given to them, to count as one.
      </p>
    );

  const changed = tracks.filter((t) => t.changedTeam).length;
  const still = startPaths.filter((p) => trackLength(p.points) === 0).length;
  const removed = startEnds.filter((e) => e.cause === "removed").length;
  const inWindow = ev.windowed ? " in this window" : "";

  return (
    <div className="flex flex-col gap-2" data-testid="start-units">
      <p className="text-xs text-muted-foreground">
        {plural(tracks.length, "starting unit", "starting units")} recorded. A
        starting unit is one a player had on the frame their first unit
        appeared, made by no builder. In most games that is the commander, but
        the engine does not say which unit is a commander, so none is called one
        here.
        {changed > 0 &&
          ` ${plural(changed, "changed hands and keeps", "changed hands and keep")} the colour of the player who started with ${changed === 1 ? "it" : "them"}.`}
      </p>

      {ev.startPathsOn && (
        <p className="text-xs text-muted-foreground">
          {startPaths.length === 0
            ? `No starting unit was alive${inWindow}.`
            : `A line is where one starting unit went${inWindow}, in its player's colour. The dot is where the line begins and the name is where it ends.`}
          {still > 0 &&
            startPaths.length > 0 &&
            ` ${still.toLocaleString()} did not move${inWindow} and ${still === 1 ? "shows" : "show"} as a dot alone.`}
        </p>
      )}

      {ev.startDeathsOn && (
        <>
          <p className="text-xs text-muted-foreground">
            {startEnds.length === 0
              ? `No starting unit was lost${inWindow}.`
              : `${plural(startEnds.length, "starting unit was", "starting units were")} lost${inWindow}.`}{" "}
            <EndIcon cause="destroyed" /> is one that was destroyed.
            {removed > 0 && (
              <>
                {" "}
                <EndIcon cause="removed" /> is one the game's own script took
                away, which is how a game swaps a unit for its upgrade. The log
                cannot follow it into the unit that replaced it.
              </>
            )}
          </p>
          {startEnds.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs">
              {startEnds.map((end) => (
                <li key={`${end.unit}-${end.frame}`}>
                  <EndIcon cause={end.cause} /> {endInWords(end, names)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
