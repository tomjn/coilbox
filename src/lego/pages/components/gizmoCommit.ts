import * as THREE from "three";

import {
  groupPivot,
  groupTransform,
  transformRoots,
} from "../../groupTransform";
import { isEffectivelyHidden, type LegoProject } from "../../model";
import { snapRotation, type Vec3 } from "../../snapping";
import { handleBox } from "./collisionHandles";
import { type GizmoMode, ROTATION_STEP } from "./ModelViewport";
import type { SceneState } from "./sceneState";

/**
 * Which handles the gizmo shows, given what is being edited.
 *
 * A volume is measured along the model's own axes, so it has no rotation to
 * drag and rotate falls back to move. The aim point is one point, so it has no
 * size either and every mode falls back to move.
 */
export function gizmoMode(
  mode: GizmoMode,
  editingVolume: boolean,
  editingAim: boolean,
): GizmoMode {
  if (editingAim) return "translate";
  return editingVolume && mode === "rotate" ? "translate" : mode;
}

/**
 * Point the gizmo at whatever the selection means: one piece's own group, or
 * an object at the midpoint of a set.
 *
 * Nothing gets handles while an anchor is being placed, because they would sit
 * over the middle of the very piece the click has to reach, and nothing gets
 * them for a selection with nothing movable in it: the root is the unit, and a
 * hidden piece is not on screen to drag.
 */
export function attachGizmo(
  state: SceneState,
  project: LegoProject,
  selectedIds: string[],
  placingAnchor: boolean,
) {
  // Editing a volume takes the handles off the pieces entirely. One set of
  // handles cannot mean two things, and a volume is a property of the unit or
  // of one named piece rather than of whichever piece is selected behind it.
  const box = handleBox(state);
  if (box) {
    state.groupIds = [];
    state.groupChanges = new Map();
    // The face plates are the volume's size control, so the gizmo stands down
    // in scale mode rather than offering a second, worse one.
    if (state.gizmo.getMode() === "scale") state.gizmo.detach();
    else state.gizmo.attach(box);
    return;
  }

  // The aim point is one point, so it only ever moves. There is no size to
  // grab and nothing to turn, which is why it gets the gizmo and no plates.
  if (state.editAim && state.aimMark.visible && state.onAimChangeRef.current) {
    state.groupIds = [];
    state.groupChanges = new Map();
    state.gizmo.attach(state.aimMark);
    return;
  }

  const roots = transformRoots(project, selectedIds).filter(
    (id) => !isEffectivelyHidden(project, id) && state.groups.has(id),
  );
  state.groupIds = roots;
  state.groupChanges = new Map();

  if (placingAnchor || roots.length === 0) {
    state.gizmo.detach();
    return;
  }
  if (roots.length === 1) {
    const group = state.groups.get(roots[0]);
    if (group) state.gizmo.attach(group);
    else state.gizmo.detach();
    return;
  }

  const pivot = groupPivot(project, roots);
  state.groupPivotAt = pivot;
  state.groupPivot.position.set(...pivot);
  state.groupPivot.rotation.set(0, 0, 0);
  state.groupPivot.scale.set(1, 1, 1);
  state.gizmo.attach(state.groupPivot);
}

/**
 * Turn a drag of the group pivot into a transform for each piece in the set.
 *
 * The gesture is read off the pivot once and handed to `groupTransform`, which
 * works out where each piece lands. The answer is put straight onto the scene
 * so the drag is visible, and kept for the commit, so what was drawn is
 * exactly what gets saved.
 */
export function dragGroup(state: SceneState) {
  const pivot = state.groupPivot;
  const at = state.groupPivotAt;
  const rotating = state.gizmo.getMode() === "rotate";

  // One number, not three. A non-uniform scale about a shared point shears
  // any piece turned relative to it, and a shear is not something a piece's
  // position, rotation and scale can hold.
  const scale = draggedScale(pivot);
  pivot.scale.setScalar(scale);

  const euler = new THREE.Euler().setFromQuaternion(pivot.quaternion);
  let rotation: Vec3 = [euler.x, euler.y, euler.z];
  // The same 15 degree steps a single piece lands on, applied to the pivot
  // itself so the handles show where the set has actually gone.
  if (rotating && state.snapping) {
    rotation = snapRotation(rotation, ROTATION_STEP);
    pivot.rotation.set(...rotation);
  }

  const changes = groupTransform(state.projectRef.current, state.groupIds, at, {
    position: [
      pivot.position.x - at[0],
      pivot.position.y - at[1],
      pivot.position.z - at[2],
    ],
    rotation,
    scale,
  });
  state.groupChanges = changes;

  for (const [pieceId, transform] of changes) {
    const group = state.groups.get(pieceId);
    if (!group) continue;
    group.position.set(...transform.position);
    group.rotation.set(...transform.rotation);
    group.scale.set(...transform.scale);
  }

  // A set seats against nothing: there is no one anchor on it to seat with.
  // Its turn still lands on the same 15 degree steps a single piece's does.
  state.onSnapChange(rotating && state.snapping);
}

/** The scale a drag has put on the pivot, read off the axis that moved. */
function draggedScale(pivot: THREE.Object3D): number {
  let ratio = 1;
  for (let axis = 0; axis < 3; axis++) {
    const candidate = pivot.scale.getComponent(axis);
    if (Math.abs(candidate - 1) > Math.abs(ratio - 1)) ratio = candidate;
  }
  return ratio;
}

/** Write a finished group drag back to the document, as one edit. */
export function commitGroup(state: SceneState) {
  const changes = state.groupChanges;
  state.groupChanges = new Map();
  state.onSnapChange(false);
  if (changes.size > 0) state.onTransformManyRef.current(changes);
}

/**
 * Write a moved aim point back to the document.
 *
 * Straight off the marker's position, because the aim point is measured from
 * the unit's own origin and the marker is drawn at exactly that point. What has
 * to move with it, the collision volume's offsets and a stale imported radius,
 * is the caller's business: the same handler the aim panel's fields use.
 */
export function commitAim(state: SceneState) {
  const { position } = state.aimMark;
  state.onAimChangeRef.current?.([position.x, position.y, position.z]);
}

/** Write the dragged transform back to the document, once the drag is over. */
export function commitGizmo(state: SceneState) {
  const group = state.gizmo.object;
  const pieceId = group ? pieceIdOf(group) : null;
  if (!group || !pieceId) return;

  state.onTransformRef.current(pieceId, {
    position: [group.position.x, group.position.y, group.position.z],
    rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
    scale: [group.scale.x, group.scale.y, group.scale.z],
  });
  state.onSnapChange(false);
}

/** Walk up until something claims a piece, since a hit lands on the mesh. */
export function pieceIdOf(object: THREE.Object3D | null): string | null {
  let at: THREE.Object3D | null = object;
  while (at) {
    const id = at.userData.pieceId;
    if (typeof id === "string") return id;
    at = at.parent;
  }
  return null;
}
