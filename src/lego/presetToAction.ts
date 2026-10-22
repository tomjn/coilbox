/**
 * Converting an applied animation preset into actions (#4512).
 *
 * The preset comes off the unit and an action of fixed poses takes its place,
 * one per copy the preset is written for, so the motion can be edited key by
 * key on the timeline. The preset's own id and script are left exactly as they
 * are (#3360): this is a choice for one unit, and undo puts the preset back.
 *
 * The keys come from the preset itself (`AnimPreset.motions`), handed the same
 * pieces and params `buildLuaScript` hands its `emit`, so what the action plays
 * is what the preset's script plays.
 */

import { t } from "@lingui/core/macro";
import { freeActionName } from "./actions";
import { type PresetMotion, presetById } from "./animPresets";
import { localName, presetContexts } from "./luaScript";
import type { LegoAction, LegoPose, LegoProject } from "./model";

/** The preset's motions on this unit, or why it cannot be converted. */
export function presetMotions(
  project: LegoProject,
  presetId: string,
): PresetMotion[] | string {
  const preset = presetById(presetId);
  const entry = project.animations?.find((a) => a.presetId === presetId);
  if (!preset || !entry) return t`This unit does not have this preset.`;
  if (typeof preset.motions === "string") return preset.motions;
  if ((project.loadouts?.length ?? 0) > 1) {
    return t`Actions are shared by every loadout, and this preset belongs to one.`;
  }
  const { ctx } = presetContexts(project, new Set())(
    preset,
    entry.params,
    entry.instances,
  );
  const motions = preset
    .motions(ctx)
    .filter((motion) => motion.keys.length > 0);
  return motions.length > 0
    ? motions
    : t`This unit has none of the pieces it moves.`;
}

/** Why the preset cannot be converted on this unit, or null when it can. */
export function conversionProblem(
  project: LegoProject,
  presetId: string,
): string | null {
  const motions = presetMotions(project, presetId);
  return typeof motions === "string" ? motions : null;
}

/** The id the `n`th action made by a conversion gets, counted from 1. */
export function convertedActionId(base: string, n: number): string {
  return `${base}-action-${n}`;
}

/**
 * Replace a preset on the unit with actions that play the same motion. `base`
 * is a fresh id the new actions and poses are named from, so the edit gives
 * the same result each time it is run. A preset that cannot be converted
 * leaves the project as it was.
 */
export function convertPresetToAction(
  project: LegoProject,
  presetId: string,
  base: string,
): LegoProject {
  const motions = presetMotions(project, presetId);
  const preset = presetById(presetId);
  if (typeof motions === "string" || !preset) return project;

  const idByLocal = new Map(
    project.pieces.map((piece) => [localName(piece.name), piece.id]),
  );
  // An action made now eases in and out over the project's blend time unless
  // it says otherwise, which the preset never did.
  const still =
    (project.actionBlend ?? 0) > 0 ? { blendIn: 0, blendOut: 0 } : {};

  let next: LegoProject = {
    ...project,
    animations: (project.animations ?? []).filter(
      (a) => a.presetId !== presetId,
    ),
  };
  const poses: LegoPose[] = [];
  motions.forEach((motion, index) => {
    const name = freeActionName(
      next,
      motions.length > 1 ? `${preset.label} ${index + 1}` : preset.label,
    );
    const id = convertedActionId(base, index + 1);
    const keys = motion.keys.map((key, at) => {
      const pose: LegoPose = {
        id: `${id}-pose-${at + 1}`,
        name: `${name}, key ${at + 1}`,
        pieces: Object.fromEntries(
          [...key.pieces].flatMap(([local, offset]) => {
            const pieceId = idByLocal.get(local);
            if (!pieceId) return [];
            return [
              [
                pieceId,
                {
                  ...(offset.turn ? { turn: triple(offset.turn) } : {}),
                  ...(offset.move ? { move: triple(offset.move) } : {}),
                },
              ],
            ];
          }),
        ),
      };
      poses.push(pose);
      return { pose: pose.id, seconds: key.seconds };
    });
    const action: LegoAction = {
      id,
      name,
      trigger: motion.trigger,
      loop: motion.loop,
      keys,
      ...still,
    };
    next = { ...next, actions: [...(next.actions ?? []), action] };
  });
  return { ...next, poses: [...(project.poses ?? []), ...poses] };
}

function triple(values: number[]): [number, number, number] {
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}
