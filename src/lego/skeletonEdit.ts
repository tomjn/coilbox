/**
 * Changing a skeleton's proportions (issue #3253).
 *
 * One call turns the unit into the unit it would have been made as with the new
 * numbers, so the panel, a dragged handle and a typed value are all the same
 * edit. The bones are placed by the plan, so the left and right of a pair
 * cannot differ, and a plan puts its root on the ground and builds everything
 * up from it, so the feet stay at height zero without a shift.
 *
 * A bone is moved only when the change moves where the plan puts it. A bone
 * moved by hand is therefore reset by the next change that places it, and left
 * alone by one that does not.
 */

import {
  type BodyPlan,
  type BodyPlanBone,
  type BodyPlanProportion,
  planProportions,
} from "./bodyPlans";
import { withoutDanglingTwins } from "./mirror";
import {
  childrenOf,
  type LegoPiece,
  type LegoProject,
  uniquePieceName,
} from "./model";

type Vec3 = [number, number, number];

/** A value held to the proportion's range, and whether that changed it. A
 *  count is rounded first, which is not holding it. */
export function clampProportion(
  proportion: BodyPlanProportion,
  value: number,
): { value: number; held: boolean } {
  const rounded = proportion.unit === "count" ? Math.round(value) : value;
  const held = Math.min(proportion.max, Math.max(proportion.min, rounded));
  return { value: held, held: held !== rounded };
}

/** Each bone's place in the unit, from the pieces' own positions. */
export function boneWorldPositions(project: LegoProject): Map<string, Vec3> {
  const places = new Map<string, Vec3>();
  const walk = (piece: LegoPiece, from: Vec3) => {
    const at: Vec3 = [
      from[0] + piece.position[0],
      from[1] + piece.position[1],
      from[2] + piece.position[2],
    ];
    if (piece.bone !== undefined) places.set(piece.bone, at);
    for (const child of childrenOf(project, piece.id)) walk(child, at);
  };
  const root = project.pieces.find((p) => p.id === project.rootPieceId);
  if (root) walk(root, [0, 0, 0]);
  return places;
}

/** Each bone of the plan in the unit's space. */
function planPlaces(bones: BodyPlanBone[]): Map<string, Vec3> {
  const places = new Map<string, Vec3>();
  for (const bone of bones) {
    const from = bone.parent === null ? undefined : places.get(bone.parent);
    places.set(bone.id, [
      (from?.[0] ?? 0) + bone.position[0],
      (from?.[1] ?? 0) + bone.position[1],
      (from?.[2] ?? 0) + bone.position[2],
    ]);
  }
  return places;
}

const same = (a: Vec3, b: Vec3) => a.every((n, i) => n === b[i]);

/**
 * The unit with the given proportions set. Values the plan has no proportion
 * for are dropped and the rest are held to their range.
 *
 * Bones the plan keeps are moved if the plan now places them elsewhere. Bones
 * it no longer has are removed, and a piece that hung on one moves up to the
 * bone's parent without moving in the unit. Bones it newly has are added as
 * `projectFromPlan` makes them. Nothing that is not a bone is touched, and a
 * piece keeps its own size and rotation.
 *
 * A unit with no skeleton, or one from another plan, comes back as it was.
 */
export function applyProportions(
  project: LegoProject,
  plan: BodyPlan,
  given: Record<string, number>,
  newId: () => string,
): { project: LegoProject } {
  const skeleton = project.skeleton;
  if (!skeleton || skeleton.plan !== plan.id) return { project };

  const before = planProportions(plan, skeleton.proportions);
  const after = planProportions(plan, { ...before, ...given });
  const wasBones = new Map(plan.bones(before).map((b) => [b.id, b]));
  const bones = plan.bones(after);
  const keptIds = new Set(bones.map((b) => b.id));

  const pieceIds = new Map<string, string>();
  for (const piece of project.pieces) {
    if (piece.bone !== undefined) pieceIds.set(piece.bone, piece.id);
  }

  // Pieces that go, and where each one's children land.
  const removed = new Map(
    project.pieces
      .filter((p) => p.bone !== undefined && !keptIds.has(p.bone))
      .map((p) => [p.id, p]),
  );
  const survivors = project.pieces
    .filter((p) => !removed.has(p.id))
    .map((piece): LegoPiece => {
      if (piece.bone !== undefined) {
        const planned = bones.find((b) => b.id === piece.bone);
        const was = wasBones.get(piece.bone);
        if (planned && (!was || !same(planned.position, was.position))) {
          return { ...piece, position: [...planned.position] };
        }
        return piece;
      }
      // Walk up past removed bones, adding each one's place, so the piece
      // stays where it is in the unit.
      let parentId = piece.parentId;
      let position = piece.position;
      let moved = false;
      while (parentId !== null && removed.has(parentId)) {
        const gone = removed.get(parentId) as LegoPiece;
        position = [
          position[0] + gone.position[0],
          position[1] + gone.position[1],
          position[2] + gone.position[2],
        ];
        parentId = gone.parentId;
        moved = true;
      }
      return moved ? { ...piece, parentId, position } : piece;
    });

  // A bone's own children that are bones are removed with it or kept by the
  // plan under another parent, so only non-bones needed the walk above.
  const taken = survivors.map((p) => p.name);
  const added: LegoPiece[] = [];
  for (const bone of bones) {
    if (pieceIds.has(bone.id)) continue;
    const id = newId();
    pieceIds.set(bone.id, id);
    const name = uniquePieceName(bone.name, taken);
    taken.push(name);
    added.push({
      id,
      name,
      parentId:
        bone.parent === null ? null : (pieceIds.get(bone.parent) ?? null),
      partId: null,
      position: [...bone.position],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      ...(bone.pivot ? { pivot: [...bone.pivot] as Vec3 } : {}),
      ...(bone.role ? { role: bone.role } : {}),
      bone: bone.id,
    });
  }
  const twins = new Map(bones.map((b) => [b.id, b.twin]));
  const withTwins = [...survivors, ...added].map((piece) => {
    if (!added.includes(piece) || piece.bone === undefined) return piece;
    const twin = twins.get(piece.bone);
    const twinId = twin === undefined ? undefined : pieceIds.get(twin);
    return twinId ? { ...piece, twin: twinId } : piece;
  });

  return {
    project: withoutDanglingTwins({
      ...project,
      pieces: withTwins,
      skeleton: { ...skeleton, proportions: after },
    }),
  };
}

/** A drag handle on a skeleton. */
export interface ProportionHandle {
  id: string;
  label: string;
  /** Where the handle sits in the unit. */
  at: Vec3;
  /** The axis it moves along. */
  axis: 0 | 1 | 2;
  /** How far the handle moves along `axis` for one elmo more of the value.
   *  Dragging it by `d` sets the value to `value + d / gain`. */
  gain: number;
  /** The proportion's value now. */
  value: number;
}

/**
 * A handle for each length of the plan, on the joint the plan names for it. The
 * gain is measured by asking the plan for the joint with the value a step
 * higher, so a handle follows the pointer however the plan spreads a length
 * over its bones. A length whose joint is missing, or does not move, has none.
 */
export function proportionHandles(
  project: LegoProject,
  plan: BodyPlan,
): ProportionHandle[] {
  const skeleton = project.skeleton;
  if (!skeleton || skeleton.plan !== plan.id) return [];
  const values = planProportions(plan, skeleton.proportions);
  const places = boneWorldPositions(project);
  const handles: ProportionHandle[] = [];
  for (const proportion of plan.proportions) {
    const spec = proportion.handle;
    const at = spec ? places.get(spec.bone) : undefined;
    if (!spec || !at) continue;
    // Room above or below, whichever the range leaves.
    const step = values[proportion.id] + 1 <= proportion.max ? 1 : -1;
    const nudged = planPlaces(
      plan.bones({ ...values, [proportion.id]: values[proportion.id] + step }),
    ).get(spec.bone);
    const base = planPlaces(plan.bones(values)).get(spec.bone);
    if (!nudged || !base) continue;
    const gain = (nudged[spec.axis] - base[spec.axis]) / step;
    if (gain === 0) continue;
    handles.push({
      id: proportion.id,
      label: proportion.label,
      at,
      axis: spec.axis,
      gain,
      value: values[proportion.id],
    });
  }
  return handles;
}
