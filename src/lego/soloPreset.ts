/**
 * Playing one applied preset on its own.
 *
 * The solo run is a preview. It runs the script of a copy of the project that
 * carries only that preset, so the project itself is never edited.
 */

import { presetById } from "./animPresets";
import { presetRoles } from "./luaScript";
import type { LegoProject } from "./model";

/**
 * The scenario that exercises each preset, by the call-ins the preset fills in
 * `emit()`. Hover and bob hangs off `Create`, which every scenario fires, so it
 * takes the plainest one.
 */
export const SOLO_SCENARIOS: Record<string, string> = {
  "walk.biped": "moving",
  "walk.quad": "moving",
  "walk.legs": "moving",
  "turret.track": "firing",
  // Follows the unit's speed, which only the driving scenario changes.
  "wheels.roll": "driving",
  // Steers with the heading and rocks with the acceleration, both of which
  // only a drive changes.
  "wheels.steer": "driving",
  "body.rock": "driving",
  // Reads the heading, which only the driving scenario changes.
  "rudder.follow": "driving",
  // Emits the reverse wake when told the unit backs up, which only a drive says.
  "wake.moving": "driving",
  // Stows on take off and lowers on landing, which only this scenario sends.
  "gear.stow": "take-off-landing",
  buildarm: "building",
  "build.aim": "building",
  "build.factory": "building-factory",
  "build.nano": "building",
  "open.close": "active",
  "hover.bob": "idle",
  "aim.track": "firing",
  recoil: "firing",
  "idle.sway": "starting-stopping",
  "idle.look": "idle",
  "body.settle": "firing",
  "wreck.pose": "destroyed",
  "wreck.breakApart": "destroyed",
};

/** Presets that change no piece, so a solo run only shows where something comes
 *  from. The row says so. */
export const SOLO_MOVES_NOTHING: Record<string, string> = {
  "build.nano": "Moves nothing. The run shows where the spray comes from.",
  "wake.moving": "Moves nothing. The run shows where the wake comes from.",
};

export function soloScenario(presetId: string): string | undefined {
  return SOLO_SCENARIOS[presetId];
}

/**
 * The project as the solo run sees it: the same unit with one preset applied.
 *
 * With `instance`, only that copy of the module animates. The other copies'
 * pieces lose the roles the preset uses in the solo copy of the unit, so the
 * script has nothing to write for them, and the unit itself is untouched.
 */
export function soloProject(
  project: LegoProject,
  presetId: string,
  instance: string | null = null,
): LegoProject {
  const preset = presetById(presetId);
  const roles = new Set(preset ? presetRoles(preset, project.pieces) : []);
  return {
    ...project,
    animations: (project.animations ?? []).filter(
      (entry) => entry.presetId === presetId,
    ),
    ...(instance !== null
      ? {
          pieces: project.pieces.map((piece) => {
            if (!piece.role || !roles.has(piece.role)) return piece;
            if ((piece.module?.instance ?? "") === instance) return piece;
            const { role: _role, ...rest } = piece;
            return rest;
          }),
        }
      : {}),
  };
}
