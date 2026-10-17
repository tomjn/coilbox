/**
 * Fitting a body plan to a unit that already has pieces (#3261).
 *
 * The game maker says which existing piece is each of the plan's bones. Each
 * picked piece takes the bone's id and its role, the plan's presets join the
 * unit's animations, and the proportions are measured off the picked joints.
 * Nothing is moved, resized or reparented, and a bone nobody picked is not
 * made.
 *
 * A picked piece's role is replaced, because picking it is the game maker
 * saying what it is. That is the opposite of `applyRoles`, which never
 * overwrites a role set by hand with one read off a script.
 */

import * as THREE from "three";

import {
  type AppliedPreset,
  countRoles,
  presetById,
  unmetRequirements,
} from "./animPresets";
import { type BodyPlan, type BodyPlanBone, planProportions } from "./bodyPlans";
import type { HeldPreset } from "./compounds";
import type { LegoPiece, LegoProject } from "./model";
import type { Vec3 } from "./planMeasure";
import { worldMatrix } from "./reparent";

/** Which piece is each bone, by bone id. A bone left out is unmatched. */
export type BonePicks = Record<string, string>;

/** A role a picked piece had that the fit replaces. */
export interface ReplacedRole {
  pieceId: string;
  from: string;
  to: string;
}

export interface PlanFit {
  project: LegoProject;
  replaced: ReplacedRole[];
  /** What the plan's presets came to, by the rules a module's presets follow
   *  (#3296): added, already on the unit, or held for a missing role. */
  presets: { added: string[]; present: string[]; held: HeldPreset[] };
  /** The plan's proportions the picks could not measure, by id. */
  unmeasured: string[];
}

/** The plan's bones for the counts given, such as how many axles. */
export function planBones(
  plan: BodyPlan,
  counts: Record<string, number>,
): BodyPlanBone[] {
  return plan.bones(planProportions(plan, counts));
}

const isLeg = (bone: BodyPlanBone) => bone.role?.startsWith("leg.") ?? false;

/**
 * A piece to offer for each bone, which the game maker confirms or not. The
 * root bone is offered the unit's root, and a bone a piece whose role is the
 * bone's and no other piece's, or a piece named as the bone is. A leg is never
 * offered by name, because a name does not say which leg it is. Each piece is
 * offered for one bone at most.
 */
export function suggestPicks(
  project: LegoProject,
  bones: BodyPlanBone[],
): BonePicks {
  const roles = countRoles(project.pieces);
  const used = new Set<string>();
  const picks: BonePicks = {};
  const free = (piece: LegoPiece | undefined) =>
    piece && !used.has(piece.id) ? piece : undefined;
  for (const bone of bones) {
    const byRole =
      bone.role && roles.get(bone.role) === 1
        ? free(project.pieces.find((p) => p.role === bone.role))
        : undefined;
    const byName = isLeg(bone)
      ? undefined
      : free(
          project.pieces.find(
            (p) => !used.has(p.id) && p.name.toLowerCase() === bone.name,
          ),
        );
    const byRoot =
      bone.parent === null
        ? free(project.pieces.find((p) => p.id === project.rootPieceId))
        : undefined;
    const piece = byRole ?? byName ?? byRoot;
    if (!piece) continue;
    picks[bone.id] = piece.id;
    used.add(piece.id);
  }
  return picks;
}

/** A measured length to its proportion's step, so float noise from a turned
 *  parent does not end up in the record. */
function toStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(6));
}

/**
 * The unit with the plan fitted to the picked pieces, and what that did.
 * `counts` are the plan's count proportions, chosen by the game maker since
 * they decide which bones there are. A pick naming a bone the plan lacks or a
 * piece the unit lacks is ignored, and a piece picked for two bones keeps the
 * first in the plan's order.
 *
 * Every `bone` the unit had before is cleared. Roles are set on picked pieces
 * only, and a bone with no role leaves the piece's own role alone.
 *
 * A measured proportion is kept even where it lies outside the plan's range,
 * because it is what the unit has and nothing places a fitted unit's bones.
 */
export function fitPlan(
  project: LegoProject,
  plan: BodyPlan,
  counts: Record<string, number>,
  picks: BonePicks,
): PlanFit {
  const values = planProportions(plan, counts);
  const bones = plan.bones(values);
  const exists = new Set(project.pieces.map((p) => p.id));
  const boneOf = new Map<string, BodyPlanBone>();
  for (const bone of bones) {
    const pieceId = picks[bone.id];
    if (pieceId && exists.has(pieceId) && !boneOf.has(pieceId)) {
      boneOf.set(pieceId, bone);
    }
  }

  const replaced: ReplacedRole[] = [];
  const pieces = project.pieces.map((piece): LegoPiece => {
    const { bone: _was, ...plain } = piece;
    const bone = boneOf.get(piece.id);
    if (!bone) return piece.bone === undefined ? piece : plain;
    if (bone.role && piece.role && piece.role !== bone.role) {
      replaced.push({ pieceId: piece.id, from: piece.role, to: bone.role });
    }
    return {
      ...plain,
      ...(bone.role ? { role: bone.role } : {}),
      bone: bone.id,
    };
  });

  const joints = new Map<string, Vec3>();
  for (const [pieceId, bone] of boneOf) {
    const at = new THREE.Vector3().setFromMatrixPosition(
      worldMatrix(project, pieceId),
    );
    joints.set(bone.id, [at.x, at.y, at.z]);
  }
  const measured = plan.measure?.(joints, values) ?? {};
  const proportions: Record<string, number> = {};
  for (const proportion of plan.proportions) {
    const value =
      proportion.unit === "count"
        ? values[proportion.id]
        : measured[proportion.id];
    if (value !== undefined && Number.isFinite(value)) {
      proportions[proportion.id] = toStep(value, proportion.step);
    }
  }
  const unmeasured = plan.proportions
    .map((p) => p.id)
    .filter((id) => !(id in proportions));

  const { animations, presets } = mergePlanPresets(
    project.animations ?? [],
    plan.presets,
    countRoles(pieces),
  );
  const { skeleton: _old, ...rest } = project;
  return {
    project: {
      ...rest,
      pieces,
      ...(animations.length > 0 ? { animations } : {}),
      skeleton: { plan: plan.id, proportions, fitted: true },
    },
    replaced,
    presets,
    unmeasured,
  };
}

/**
 * The plan's presets added to the unit's as a module's are (#3296): one the
 * unit already has keeps the unit's parameters, and one whose roles the unit
 * still lacks is held back rather than added half working.
 */
function mergePlanPresets(
  have: AppliedPreset[],
  planPresets: AppliedPreset[],
  roles: Map<string, number>,
) {
  const animations = [...have];
  const presets: PlanFit["presets"] = { added: [], present: [], held: [] };
  for (const entry of planPresets) {
    const preset = presetById(entry.presetId);
    if (!preset) continue;
    if (animations.some((a) => a.presetId === entry.presetId)) {
      presets.present.push(entry.presetId);
      continue;
    }
    const missing = unmetRequirements(preset, roles);
    if (missing.length > 0) {
      presets.held.push({ ...entry, params: { ...entry.params }, missing });
      continue;
    }
    animations.push({ presetId: entry.presetId, params: { ...entry.params } });
    presets.added.push(entry.presetId);
  }
  return { animations, presets };
}
