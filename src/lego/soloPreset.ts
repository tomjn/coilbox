/**
 * Playing one applied preset on its own.
 *
 * The solo run is a preview. It runs the script of a copy of the project that
 * carries only that preset, so the project itself is never edited.
 */

import type { LegoProject } from "./model";

/**
 * The scenario that exercises each preset, by the call-ins the preset fills in
 * `emit()`. Hover and bob hangs off `Create`, which every scenario fires, so it
 * takes the plainest one.
 */
export const SOLO_SCENARIOS: Record<string, string> = {
  "walk.biped": "moving",
  "walk.quad": "moving",
  "turret.track": "firing",
  "wheels.roll": "moving",
  buildarm: "building",
  "build.aim": "building",
  "build.factory": "building-factory",
  "build.nano": "building",
  "open.close": "active",
  "hover.bob": "idle",
  "aim.track": "firing",
  recoil: "firing",
  "idle.sway": "starting-stopping",
  "wreck.pose": "destroyed",
};

/** Presets that change no piece, so a solo run only shows where something comes
 *  from. The row says so. */
export const SOLO_MOVES_NOTHING: Record<string, string> = {
  "build.nano": "Moves nothing. The run shows where the spray comes from.",
};

export function soloScenario(presetId: string): string | undefined {
  return SOLO_SCENARIOS[presetId];
}

/** The project as the solo run sees it: the same unit with one preset applied. */
export function soloProject(
  project: LegoProject,
  presetId: string,
): LegoProject {
  return {
    ...project,
    animations: (project.animations ?? []).filter(
      (entry) => entry.presetId === presetId,
    ),
  };
}
