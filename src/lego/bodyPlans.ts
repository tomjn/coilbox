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
  type LegoPiece,
  type LegoProject,
  newProject,
  uniquePieceName,
} from "./model";

/**
 * A number the skeleton is shaped by, such as leg length. The same shape as a
 * preset's parameter, except that every proportion is a length in elmos, the
 * unit a piece's position is in.
 */
export interface BodyPlanProportion extends Omit<PresetParam, "unit"> {
  unit: "elmo";
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

/*
 * The legged plans' numbers are Splinter Faction's, the default game, read off
 * the .s3o of every two legged walker a unit def names: 23 models. Each default
 * is the median, and each range covers every model, rounded out to 5 elmos.
 *
 * - Leg length is hip joint to ankle joint, the thigh to the foot piece: 18.8.
 *   The models run 8.0 to 36.7.
 * - Stance is the distance between the two hip joints: 29.8, from 10.0 to 59.5.
 * - Body height is the turret joint above the hip joint, where every one of
 *   them carries its upper body: 5.4, from 2.3 to 23.9.
 * - The thigh is 0.395 of the leg, the median of thigh over thigh plus shin.
 *
 * No unit def names a four legged model, so the four legs use the same legs.
 * Their body length, the gap between the front and rear hips, is the median
 * gap over stance of the ten different four legged models in the archive
 * (chickens and Zaal, from 0.71 to 0.94), 0.930, times the stance: 27.7. The
 * gaps themselves run 9.7 to 66.7.
 */

/** How much of a leg's length is thigh. The shin is the rest. */
const THIGH_SHARE = 0.395;

function elmos(
  id: string,
  label: string,
  min: number,
  max: number,
  fallback: number,
): BodyPlanProportion {
  return { id, label, unit: "elmo", min, max, step: 0.1, fallback };
}

const LEG_LENGTH = elmos("legLength", "Leg length", 5, 40, 18.8);
const STANCE = elmos("stance", "Stance width", 10, 60, 29.8);
const BODY_HEIGHT = elmos("bodyHeight", "Body height", 0, 25, 5.4);
const BODY_LENGTH = elmos("bodyLength", "Body length", 5, 70, 27.7);

/**
 * One leg pair's bones, hanging from `parent`: a thigh at each hip joint, a
 * shin at the knee and a foot at the ankle, with the ankle on the ground. Each
 * bone's origin is its joint, which is what the engine turns a piece about, so
 * no pivot is set. The left leg is on +x, the unit's left.
 */
function legPair(
  parent: string,
  pair: 1 | 2,
  { legLength, stance }: Record<string, number>,
  z: number,
  suffix: string,
): BodyPlanBone[] {
  const leg = legLength as number;
  const thigh = leg * THIGH_SHARE;
  return (["l", "r"] as const).flatMap((side) => {
    const other = side === "l" ? "r" : "l";
    const x = side === "l" ? (stance as number) / 2 : -(stance as number) / 2;
    const bone = (segment: string, s: string) => `${segment}.${s}${pair}`;
    return [
      {
        id: bone("thigh", side),
        name: `${side}thigh${suffix}`,
        parent,
        position: [x, 0, z],
        role: `leg.${side}${pair}.thigh`,
        twin: bone("thigh", other),
      },
      {
        id: bone("shin", side),
        name: `${side}shin${suffix}`,
        parent: bone("thigh", side),
        position: [0, -thigh, 0],
        role: `leg.${side}${pair}.shin`,
        twin: bone("shin", other),
      },
      {
        id: bone("foot", side),
        name: `${side}foot${suffix}`,
        parent: bone("shin", side),
        // The rest of the leg, so the ankle lands on the ground exactly.
        position: [0, -(leg - thigh), 0],
        role: `leg.${side}${pair}.foot`,
        twin: bone("foot", other),
      },
    ];
  });
}

/** The root on the ground, the body bone at hip height, and the torso above. */
function trunk(
  body: string,
  { legLength, bodyHeight }: Record<string, number>,
): BodyPlanBone[] {
  return [
    { id: "base", name: "base", parent: null, position: [0, 0, 0] },
    {
      id: body,
      name: body,
      parent: "base",
      position: [0, legLength as number, 0],
      role: "base",
    },
    {
      id: "torso",
      name: "torso",
      parent: body,
      position: [0, bodyHeight as number, 0],
    },
  ];
}

export const BIPED: BodyPlan = {
  id: "biped",
  label: "Two legs",
  description: "A hip on two legs, walking.",
  proportions: [LEG_LENGTH, STANCE, BODY_HEIGHT],
  bones(proportions) {
    return [
      ...trunk("hip", proportions),
      ...legPair("hip", 1, proportions, 0, ""),
    ];
  },
  presets: [{ presetId: "walk.biped", params: {} }],
};

export const QUADRUPED: BodyPlan = {
  id: "quadruped",
  label: "Four legs",
  description: "A body on four legs, trotting.",
  proportions: [LEG_LENGTH, STANCE, BODY_HEIGHT, BODY_LENGTH],
  bones(proportions) {
    const half = (proportions.bodyLength as number) / 2;
    return [
      ...trunk("body", proportions),
      ...legPair("body", 1, proportions, half, "f"),
      ...legPair("body", 2, proportions, -half, "b"),
    ];
  },
  presets: [{ presetId: "walk.quad", params: {} }],
};

/** Every plan a unit can start from. More come with #3250 and #3251. */
export const BODY_PLANS: BodyPlan[] = [BIPED, QUADRUPED];

export function bodyPlanById(id: string): BodyPlan | undefined {
  return BODY_PLANS.find((plan) => plan.id === id);
}

/**
 * A value for each of the plan's proportions: the one given, held to the
 * proportion's range, or its default. Values the plan has no proportion for
 * are dropped.
 */
export function planProportions(
  plan: BodyPlan,
  given: Record<string, number> = {},
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const { id, min, max, fallback } of plan.proportions) {
    const value = given[id];
    values[id] =
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
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
