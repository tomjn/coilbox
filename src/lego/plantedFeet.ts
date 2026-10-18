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
 */

import {
  type Gait,
  legPhase,
  parseLegRole,
  presetById,
  WALK_THIGH,
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

/**
 * The marks for `frames` frames of a run fired by `events`, or null when no
 * walk the unit plays is solved or the unit never moves. Only the generated
 * script plays the presets, so a unit with a script of its own, or a game's
 * compiled one, gets none.
 */
export function plantedFeet(
  project: LegoProject,
  events: ScriptEvent[],
  frames: number,
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
      const params = shownParams(project, entry, group.id || null);
      if (!(params[WALK_THIGH] > 0)) continue;
      const lap = Math.round(params.period * ENGINE_FPS);
      const down = Math.round((params.duty / 100) * lap);
      const half = walkSweep(params) / 2;
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
        for (const [start, end] of spans) {
          for (
            let frame = start + lap;
            frame < Math.min(end, frames);
            frame++
          ) {
            const turn = (((frame - start - offset) % lap) + lap) % lap;
            if (turn > down) continue;
            marks[frame].set(piece.id, [x, z + half * (1 - (2 * turn) / down)]);
          }
        }
      }
    }
  }
  return any ? marks : null;
}
