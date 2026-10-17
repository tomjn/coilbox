/**
 * Body plans (milestone 63): the skeletons a unit can start from.
 *
 * A skeleton is two things. The body plan is code, a table in this file: its
 * named proportions, a function from those to bones, and the presets that
 * drive them. The unit stores only which plan it came from and the value of
 * each proportion (`LegoProject.skeleton`), and each piece the plan made says
 * which bone it is (`LegoPiece.bone`).
 *
 * The bones are written as ordinary empty pieces with their roles set, and the
 * presets go into `LegoProject.animations`, so export, the generated script
 * and the `.s3o` writer see nothing new. A compound is not used, because it
 * cannot say that a joint's place comes from a number such as leg length.
 * Modules stay separate: a body plan is for a whole unit, a module for a part
 * of one.
 */

import type { AppliedPreset, PresetParam } from "./animPresets";
import {
  childrenOf,
  type LegoPiece,
  type LegoProject,
  newProject,
  uniquePieceName,
} from "./model";
import { TRACKED, WHEELED } from "./vehiclePlans";

/**
 * A number the skeleton is shaped by, such as leg length. The same shape as a
 * preset's parameter, except that a proportion is either a length in elmos,
 * the unit a piece's position is in, or a count of something the plan repeats,
 * such as axles, which is always a whole number.
 */
export interface BodyPlanProportion extends Omit<PresetParam, "unit"> {
  unit: "elmo" | "count";
}

/** One joint of a skeleton, which becomes one empty piece. */
export interface BodyPlanBone {
  /** Stable for the plan's life, because a unit stores it in `LegoPiece.bone`. */
  id: string;
  /** The piece's name: lower case and safe as a Lua local. */
  name: string;
  /** The parent bone's id, null for the one root bone, which comes first. */
  parent: string | null;
  /** Relative to the parent bone. */
  position: [number, number, number];
  role?: string;
  /** Copied to `LegoPiece.pivot`, for the part a bone is later given. */
  pivot?: [number, number, number];
  /** The bone across the centre line, written as a symmetry twin (#3315).
   *  Both bones of a pair name each other. */
  twin?: string;
}

export interface BodyPlan {
  id: string;
  label: string;
  /** One line saying what the plan is for. */
  description: string;
  proportions: BodyPlanProportion[];
  /** Every bone, parents before children, for the proportions given. Called
   *  only with the values `planProportions` returns, so every one is set. */
  bones(proportions: Record<string, number>): BodyPlanBone[];
  /** Applied to the unit as they are written here. */
  presets: AppliedPreset[];
}

/** Every plan a unit can start from. The plans themselves come with #3249,
 *  #3250 and #3251. */
export const BODY_PLANS: BodyPlan[] = [WHEELED, TRACKED];

export function bodyPlanById(id: string): BodyPlan | undefined {
  return BODY_PLANS.find((plan) => plan.id === id);
}

/**
 * A value for each of the plan's proportions: the one given, held to the
 * proportion's range, or its default. A count is rounded to a whole number
 * first. Values the plan has no proportion for are dropped.
 */
export function planProportions(
  plan: BodyPlan,
  given: Record<string, number> = {},
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const { id, unit, min, max, fallback } of plan.proportions) {
    const value = given[id];
    values[id] =
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(
            max,
            Math.max(min, unit === "count" ? Math.round(value) : value),
          )
        : fallback;
  }
  return values;
}

/**
 * A new unit holding the plan's skeleton: one empty piece per bone with its
 * role, its bone id and its twin, the plan's presets, and the skeleton record.
 * The root bone takes `rootPieceId`. Everything else is what `newProject`
 * makes.
 */
export function projectFromPlan(
  plan: BodyPlan,
  options: Parameters<typeof newProject>[0] & {
    newId: () => string;
    /** Left off for the plan's defaults. */
    proportions?: Record<string, number>;
  },
): LegoProject {
  const { newId, proportions: given, ...unit } = options;
  const proportions = planProportions(plan, given);
  const bones = plan.bones(proportions);
  const ids = new Map(
    bones.map((bone) => [
      bone.id,
      bone.parent === null ? unit.rootPieceId : newId(),
    ]),
  );
  const taken: string[] = [];
  const pieces = bones.map((bone): LegoPiece => {
    const name = uniquePieceName(bone.name, taken);
    taken.push(name);
    const twin = bone.twin === undefined ? undefined : ids.get(bone.twin);
    return {
      id: ids.get(bone.id) as string,
      name,
      parentId: bone.parent === null ? null : (ids.get(bone.parent) ?? null),
      partId: null,
      position: [...bone.position],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      ...(bone.pivot ? { pivot: [...bone.pivot] } : {}),
      ...(bone.role ? { role: bone.role } : {}),
      ...(twin ? { twin } : {}),
      bone: bone.id,
    };
  });
  return {
    ...newProject(unit),
    pieces,
    ...(plan.presets.length > 0
      ? {
          animations: plan.presets.map((preset) => ({
            presetId: preset.presetId,
            params: { ...preset.params },
          })),
        }
      : {}),
    skeleton: { plan: plan.id, proportions },
  };
}

/**
 * The bone pieces that new proportions would delete, because the plan no
 * longer has their bone, and that hold more than a bare joint: a part, a mesh,
 * or a piece hung on them that is not itself going. Fewer axles on a wheeled
 * unit is the usual case. Whatever applies the change says so before it
 * deletes these.
 */
export function bonesLostWithParts(
  project: LegoProject,
  plan: BodyPlan,
  proportions: Record<string, number>,
): LegoPiece[] {
  const kept = new Set(
    plan.bones(planProportions(plan, proportions)).map((bone) => bone.id),
  );
  const lost = project.pieces.filter(
    (piece) => piece.bone !== undefined && !kept.has(piece.bone),
  );
  const lostIds = new Set(lost.map((piece) => piece.id));
  return lost.filter(
    (piece) =>
      piece.partId !== null ||
      piece.meshId !== undefined ||
      childrenOf(project, piece.id).some((child) => !lostIds.has(child.id)),
  );
}

/** The unit with its skeleton let go: no record and no bones, so every piece
 *  is a plain piece where it already is. Roles and presets stay. */
export function releaseSkeleton(project: LegoProject): LegoProject {
  if (!project.skeleton && project.pieces.every((p) => p.bone === undefined)) {
    return project;
  }
  const { skeleton: _released, ...rest } = project;
  return {
    ...rest,
    pieces: project.pieces.map((piece) => {
      if (piece.bone === undefined) return piece;
      const { bone: _freed, ...plain } = piece;
      return plain;
    }),
  };
}
