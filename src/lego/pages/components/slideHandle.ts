import type * as THREE from "three";

import { slideFrame } from "../../connectors";
import type { LegoProject } from "../../model";
import type { SceneState } from "./sceneState";

/**
 * The handle of a joined piece (issue #4295).
 *
 * A joined piece can only slide along its face, so its move handle offers the
 * two directions along the face and leaves out the one through it. The gizmo
 * cannot be turned to a direction of our choosing while it holds the piece
 * itself, because it takes its axes from the piece's own turn. So it holds a
 * frame instead, a child of the piece's parent sitting where the piece sits,
 * turned to the face. Dragging the frame is dragging the piece: the piece
 * follows it and the frame follows what the snap made of that.
 */

/** Move handles on all three axes, for a piece that can go anywhere. */
export function showAllAxes(gizmo: SceneState["gizmo"]) {
  gizmo.showX = true;
  gizmo.showY = true;
  gizmo.showZ = true;
  gizmo.showXY = true;
  gizmo.showYZ = true;
  gizmo.showXZ = true;
}

/** The two directions along the frame's face and the plane between them. */
function showFaceAxes(gizmo: SceneState["gizmo"]) {
  gizmo.showX = true;
  gizmo.showY = true;
  gizmo.showZ = false;
  gizmo.showXY = true;
  gizmo.showYZ = false;
  gizmo.showXZ = false;
}

/**
 * Hand the gizmo one piece: the piece's own group, or when it is joined and
 * being moved with snapping on, the frame turned to the face it slides on.
 * Alt turns snapping off, which frees the piece, so it gets the piece's group
 * and all three axes.
 */
export function attachPiece(
  state: SceneState,
  project: LegoProject,
  pieceId: string,
  group: THREE.Object3D,
) {
  const frame = state.slideFrame;
  frame.removeFromParent();
  const turn =
    state.snapping && state.gizmo.getMode() === "translate" && group.parent
      ? slideFrame(project, state.packRef.current, pieceId)
      : null;
  if (!turn || !group.parent) {
    showAllAxes(state.gizmo);
    state.gizmo.attach(group);
    return;
  }
  group.parent.add(frame);
  frame.userData.pieceId = pieceId;
  frame.position.copy(group.position);
  frame.quaternion.copy(turn);
  frame.scale.set(1, 1, 1);
  frame.updateMatrixWorld(true);
  showFaceAxes(state.gizmo);
  state.gizmo.attach(frame);
}

/** The piece's own group, whether the gizmo holds it or its slide frame. */
export function draggedGroup(state: SceneState): THREE.Object3D | undefined {
  const held = state.gizmo.object;
  if (!held || held !== state.slideFrame) return held;
  const id = state.slideFrame.userData.pieceId;
  return typeof id === "string" ? state.groups.get(id) : undefined;
}

/** Carry a drag of the frame onto the piece, before the piece is snapped. */
export function followSlideFrame(state: SceneState) {
  if (state.gizmo.object !== state.slideFrame) return;
  draggedGroup(state)?.position.copy(state.slideFrame.position);
}

/** Put the frame where the snap left the piece, so the handle follows it. */
export function settleSlideFrame(state: SceneState) {
  if (state.gizmo.object !== state.slideFrame) return;
  const group = draggedGroup(state);
  if (group) state.slideFrame.position.copy(group.position);
}
