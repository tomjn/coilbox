/**
 * Where a fitted walk holds each foot on the ground, frame by frame, for the
 * preview to mark (#3350).
 *
 * The marks come from the walk's own solve, not from where the script left the
 * foot, so a foot that slides off its mark is one the script does not hold
 * where the solve says: a stride past the legs' reach, or a slope the baked
 * walk does not know about. The unit's own frame, x and z in elmos, which is
 * the space the viewport's ground overlays are drawn in, so a drive carries
 * the marks along with the unit.
 *
 * A walk thread starts on `StartMoving` and is told to stop on `StopMoving`.
 * Its first lap comes in from rest rather than from the cycle's first pose,
 * so it is not marked.
 *
 * During a drive the walk goes at the share of top speed the unit is moving at
 * (#4486), so the marks follow the thread's own steps, each as long as
 * `walkPaceStep` says it sleeps for the drive's speed on the frame it starts.
 */

import {
  type AnimPreset,
  COBSCALE,
  cycleSteps,
  type Gait,
  legPhase,
  legRoleIds,
  parseLegRole,
  presetById,
  WALK_DROP,
  WALK_PAIRS,
  WALK_THIGH,
  walkPaceStep,
  walkSweep,
} from "./animPresets";
import { presetRoles, roleInstanceGroups } from "./luaScript";
import type { LegoProject } from "./model";
import type { ScriptEvent } from "./scriptPlayback";
import { jointOf, shownParams } from "./walkFit";

/** Sim frames per second, the engine's `GAME_SPEED`. */
const ENGINE_FPS = 30;

/** Per frame, each held foot's mark keyed by its thigh piece's id. */
export type PlantedFeet = Map<string, [number, number]>[];

/** The frames the unit is moving on, each from its `StartMoving` up to but
 *  not including its `StopMoving`. */
function movingSpans(events: ScriptEvent[]): [number, number][] {
  const spans: [number, number][] = [];
  let start: number | null = null;
  for (const event of [...events].sort((a, b) => a.frame - b.frame)) {
    if (event.callin === "StartMoving" && start === null) start = event.frame;
    if (event.callin === "StopMoving" && start !== null) {
      spans.push([start, event.frame]);
      start = null;
    }
  }
  if (start !== null) spans.push([start, Number.POSITIVE_INFINITY]);
  return spans;
}

/** What a drive tells the script about the unit's speed, in elmos a frame,
 *  as `scriptDrive` in `drive.ts` takes it. */
export interface PlantedDrive {
  frames: { speed: number }[];
  maxSpeed: number;
}

/**
 * Where a walk thread started on `start` is in its cycle on each frame up to
 * `end`, in frames of the cycle at top speed, as `cycleThread` writes it: each
 * step of `steps` frames sleeps what `walkPaceStep` says for the speed the
 * drive reads on the frame it starts, and the pieces move evenly through it.
 * With no drive the unit reads its top speed and the clock is the frames since
 * `start`.
 */
function walkClock(
  steps: number[],
  start: number,
  end: number,
  drive: PlantedDrive | undefined,
): Map<number, number> {
  const clock = new Map<number, number>();
  const top = drive ? Math.trunc(drive.maxSpeed * COBSCALE) : 1;
  let at = start;
  let cycle = 0;
  let due = 0;
  for (let step = 0; at < end; step = (step + 1) % steps.length) {
    const frames = steps[step];
    const speed = drive?.frames[at]?.speed ?? drive?.maxSpeed ?? 0;
    const current = drive ? Math.trunc(speed * COBSCALE) : 1;
    const paced = walkPaceStep(frames, due, current, top);
    due = paced.due;
    for (let frame = 0; frame < paced.wait && at + frame < end; frame++) {
      clock.set(at + frame, cycle + (frames * frame) / paced.wait);
    }
    at += paced.wait;
    cycle += frames;
  }
  return clock;
}

/** The frames each step of a walk's thread takes at top speed, as
 *  `walkEmit` writes it for one set of legs. */
function stepFrames(
  preset: AnimPreset,
  params: Record<string, number>,
): number[] {
  const roles =
    preset.id === "walk.legs"
      ? legRoleIds(Math.round(params[WALK_PAIRS] ?? 1))
      : preset.animates;
  const bounds = cycleSteps(
    preset,
    params,
    Math.max(params.period, 0.05),
    roles,
  );
  return bounds.slice(1).map((frame, index) => frame - bounds[index]);
}

/**
 * The marks for `frames` frames of a run fired by `events`, or null when no
 * walk the unit plays is solved or the unit never moves. Only the generated
 * script plays the presets, so a unit with a script of its own, or a game's
 * compiled one, gets none. `drive` is the drive the run plays, if any.
 */
export function plantedFeet(
  project: LegoProject,
  events: ScriptEvent[],
  frames: number,
  drive?: PlantedDrive,
): PlantedFeet | null {
  if (project.script !== undefined || project.compiledScript) return null;
  const spans = movingSpans(events);
  if (spans.length === 0) return null;

  const marks: PlantedFeet = Array.from({ length: frames }, () => new Map());
  let any = false;
  for (const entry of project.animations ?? []) {
    const preset = presetById(entry.presetId);
    if (!preset?.id.startsWith("walk.")) continue;
    const gait: Gait =
      preset.id === "walk.quad"
        ? "quad"
        : preset.id === "walk.legs"
          ? "wave"
          : "biped";
    for (const group of roleInstanceGroups(
      project.pieces,
      presetRoles(preset, project.pieces),
    )) {
      // Every set of legs is solved to the ground the shared walk lowers the
      // body to, as `walkDrop` writes it.
      const params: Record<string, number> = {
        ...shownParams(project, entry, group.id || null),
        [WALK_DROP]: shownParams(project, entry, null)[WALK_DROP],
      };
      if (!(params[WALK_THIGH] > 0)) continue;
      const lap = Math.round(params.period * ENGINE_FPS);
      const down = Math.round((params.duty / 100) * lap);
      const half = walkSweep(params) / 2;
      const steps = stepFrames(preset, params);
      const clocks = spans.map(([start, end]) =>
        walkClock(steps, start, Math.min(end, frames), drive),
      );
      for (const piece of group.pieces) {
        const leg = parseLegRole(piece.role ?? "");
        if (leg?.segment !== "thigh") continue;
        if (gait === "biped" && leg.pair !== 1) continue;
        if (gait === "quad" && leg.pair > 2) continue;
        // The frame of the cycle the leg's foot comes down on, which is the
        // phase `walkTrack` puts it at, counted the other way round.
        const phase = legPhase(leg, gait, params.duty / 100, lap);
        const offset = Math.round((1 - phase / (2 * Math.PI)) * lap) % lap;
        const [x, , z] = jointOf(project, piece);
        any = true;
        for (const clock of clocks) {
          for (const [frame, cycle] of clock) {
            if (cycle < lap) continue;
            const turn = (((cycle - offset) % lap) + lap) % lap;
            if (turn > down) continue;
            marks[frame].set(piece.id, [x, z + half * (1 - (2 * turn) / down)]);
          }
        }
      }
    }
  }
  return any ? marks : null;
}
