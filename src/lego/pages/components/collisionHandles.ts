import * as THREE from "three";
import { aimPoint } from "../../aimPoint";
import {
  effectiveCollisionVolume,
  engineScales,
  MIN_COLLISION_SIZE,
  MIN_PIECE_COLLISION_SIZE,
  pieceCollisionVolumes,
  resizeCollisionFace,
} from "../../collisionVolume";
import type { LegoCollisionVolume } from "../../model";
import { bakedPieces, unitBounds } from "../../s3oBuild";
import type { SceneState } from "./ModelViewport";

/** Which face of the volume a grab plate is, carried on the plate itself so a
 *  raycast hit says what it dragged. */
interface CollisionFace {
  axis: 0 | 1 | 2;
  /** Which end of that axis: the high face or the low one. */
  sign: 1 | -1;
}

/** A face of the volume being dragged. */
export interface CollisionFaceDrag extends CollisionFace {
  /** The pointer is followed on this plane. It holds the axis and faces the
   *  camera, so the face tracks the pointer from any angle. */
  plane: THREE.Plane;
  /** The point the volume's offsets are measured from: the unit's aim point,
   *  or the piece's own place in the model. Fixed for the length of the drag,
   *  since the unit cannot change while it runs. */
  mid: [number, number, number];
  /** The volume when the face was grabbed. Every frame sizes this rather than
   *  the last frame's answer, so the opposite face cannot creep. */
  from: LegoCollisionVolume;
  /** What the wireframe is showing now, and what release writes. */
  volume: LegoCollisionVolume;
  /** The box being sized, so a drag keeps hold of the one it grabbed. */
  lines: THREE.Object3D;
  /** How thin the drag may make it, which differs between the unit's volume
   *  and a piece's: the engine clamps the two differently. */
  min: number;
  /** Where release writes the result. */
  commit: (volume: LegoCollisionVolume) => void;
}

/**
 * The box the handles are on, or null when nothing is being edited.
 *
 * A piece wins when the panel has named one. Two sets of plates on screen at
 * once would be two answers to "what does dragging this size".
 *
 * Split from `handleSubject` below because this one runs on every frame of a
 * drag and on every mode change, and the volumes behind it cost a walk over
 * every vertex in the unit to work out.
 */
export function handleBox(state: SceneState): THREE.Object3D | null {
  if (state.editPieceId) {
    const box = state.pieceCollisionBoxes.get(state.editPieceId);
    // A piece switched out of the hit test draws no box, because nothing is
    // what it will stop. The handles go back to the unit's volume rather than
    // to the piece's own transform, which is not what this panel is about.
    if (box) return box;
  }
  return state.editCollision ? state.collision : null;
}

/**
 * The box the handles are on, with everything needed to size and write it.
 *
 * One shape for the unit's own volume and for a piece's, because the plates and
 * the drag behave identically on both. What differs is only where the offsets
 * are measured from, how thin the engine lets it get, and where the answer
 * goes, so those three are what this returns alongside the object on screen.
 *
 * Read once when a drag starts, never during one: it re-measures the unit.
 */
export function handleSubject(state: SceneState): {
  lines: THREE.Object3D;
  volume: LegoCollisionVolume;
  mid: [number, number, number];
  min: number;
  commit: (volume: LegoCollisionVolume) => void;
} | null {
  const project = state.projectRef.current;

  // A piece with no box on screen falls through to the unit's volume below,
  // the same way `handleBox` does.
  if (state.editPieceId && state.pieceCollisionBoxes.has(state.editPieceId)) {
    const pieceId = state.editPieceId;
    const lines = state.pieceCollisionBoxes.get(pieceId);
    if (!lines) return null;
    const entry = pieceCollisionVolumes(
      project,
      bakedPieces(project, state.packRef.current, state.rawRef.current).pieces,
    ).find((candidate) => candidate.pieceId === pieceId);
    if (!entry) return null;
    return {
      lines,
      volume: entry.volume,
      mid: entry.origin,
      min: MIN_PIECE_COLLISION_SIZE,
      commit: (volume) =>
        state.onPieceVolumeChangeRef.current?.(pieceId, volume),
    };
  }

  if (!state.editCollision || !state.collision) return null;
  const bounds = unitBounds(
    project,
    state.packRef.current,
    state.rawRef.current,
  );
  const change = state.onCollisionChangeRef.current;
  return {
    lines: state.collision,
    volume: effectiveCollisionVolume(project, bounds),
    mid: aimPoint(project, bounds),
    min: MIN_COLLISION_SIZE,
    commit: (volume) => change?.(volume),
  };
}

/**
 * Put the grab plates on the volume's faces, or take them off screen.
 *
 * They are the volume's size control, and they replace the gizmo rather than
 * joining it: a face plate and a scale handle would be two answers to the same
 * question, and only one of them sizes the thing you are pointing at.
 *
 * Drag one and its own face follows the pointer while the opposite face stays,
 * which is how a box is sized anywhere else. The gizmo's squares could not do
 * that. They multiply the volume by the ratio of two distances from its middle,
 * measured from wherever the handle happens to sit on screen, so the same drag
 * means different sizes at different zooms and dragging through the middle
 * turns the size negative.
 */
export function showCollisionHandles(state: SceneState) {
  const lines = handleBox(state);
  const shown = lines !== null && state.gizmo.getMode() === "scale";
  state.collisionHandles.visible = shown;
  if (!lines || !shown) return;

  // Whichever box they are on, in that box's colour, so a piece's plates are
  // never mistaken for the unit volume's. Not mid-drag: this runs on every
  // frame of one, and clearing the highlight would put the grabbed plate back
  // to cold the moment the pointer moved.
  if (!state.collisionDrag) highlightHandle(state, null);

  const size = [lines.scale.x, lines.scale.y, lines.scale.z];
  state.collisionHandles.position.copy(lines.position);
  for (const plate of state.collisionHandles.children) {
    const { axis, sign } = plate.userData as CollisionFace;
    const across = [0, 1, 2].filter((other) => other !== axis);
    plate.position.setComponent(axis, (sign * size[axis]) / 2);
    const side = plateSize(size[across[0]], size[across[1]]);
    plate.scale.set(side, side, 1);
  }
}

/** How big a grab plate is, given the face it sits on. A quarter of the face's
 *  shorter side, but never so small that a thin volume cannot be grabbed nor so
 *  large that a volume is hidden under its own handles. */
function plateSize(acrossA: number, acrossB: number): number {
  return Math.min(1.5, Math.max(0.4, 0.25 * Math.min(acrossA, acrossB)));
}

/** The six plates, built once with the scene. Squares rather than the gizmo's
 *  arrows: a face is a flat thing and the handle sits on it. */
export function buildCollisionHandles(
  material: THREE.MeshBasicMaterial,
): THREE.Group {
  const group = new THREE.Group();
  const square = new THREE.PlaneGeometry(1, 1);
  for (const axis of [0, 1, 2] as const) {
    for (const sign of [1, -1] as const) {
      const plate = new THREE.Mesh(square, material);
      // Turned to lie in the face it sits on, which is also what makes the
      // plate's own z the axis it drags along.
      if (axis === 0) plate.rotation.y = (sign * Math.PI) / 2;
      if (axis === 1) plate.rotation.x = (-sign * Math.PI) / 2;
      if (axis === 2 && sign === -1) plate.rotation.y = Math.PI;
      plate.userData = { axis, sign } satisfies CollisionFace;
      plate.renderOrder = 5;
      group.add(plate);
    }
  }
  group.visible = false;
  return group;
}

/**
 * Start sizing the volume, if the pointer landed on one of the plates.
 *
 * The face is tracked on a plane that holds its axis and faces the camera, so
 * it follows the pointer from any angle. Looking straight down the axis there
 * is no such plane and no drag to be had, which is the one case this refuses.
 */
export function beginFaceDrag(
  state: SceneState,
  raycaster: THREE.Raycaster,
): boolean {
  if (!state.collisionHandles.visible) return false;
  const hit = raycaster.intersectObjects(
    state.collisionHandles.children,
    false,
  )[0];
  if (!hit) return false;

  const { axis, sign } = hit.object.userData as CollisionFace;
  const along = new THREE.Vector3().setComponent(axis, 1);
  const eye = state.camera.position.clone().sub(hit.point);
  const normal = eye.sub(along.clone().multiplyScalar(eye.dot(along)));
  if (normal.lengthSq() < 1e-6) return false;

  const subject = handleSubject(state);
  if (!subject) return false;
  state.collisionDrag = {
    axis,
    sign,
    plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal.normalize(),
      hit.point,
    ),
    mid: subject.mid,
    from: subject.volume,
    volume: subject.volume,
    lines: subject.lines,
    min: subject.min,
    commit: subject.commit,
  };
  highlightHandle(state, hit.object);
  state.controls.enabled = false;
  return true;
}

/** Follow the pointer with the dragged face. Shown live rather than on release,
 *  so the size being set is the size on screen the whole way through. */
export function moveFaceDrag(state: SceneState, raycaster: THREE.Raycaster) {
  const drag = state.collisionDrag;
  if (!drag) return;

  const at = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
  if (!at) return;

  drag.volume = resizeCollisionFace(
    drag.from,
    drag.axis,
    drag.sign,
    at.getComponent(drag.axis) - drag.mid[drag.axis],
    drag.min,
  );
  drag.lines.scale.set(...engineScales(drag.volume));
  drag.lines.position.set(
    drag.mid[0] + drag.volume.offsets[0],
    drag.mid[1] + drag.volume.offsets[1],
    drag.mid[2] + drag.volume.offsets[2],
  );
  showCollisionHandles(state);
  state.render();
}

/** Write the sized volume back to the document, if the drag changed it. A press
 *  that went nowhere is not an edit and does not belong in the undo history. */
export function endFaceDrag(state: SceneState) {
  const drag = state.collisionDrag;
  state.collisionDrag = null;
  state.controls.enabled = true;
  highlightHandle(state, null);
  if (!drag) return;
  const moved =
    drag.volume.scales.some((size, i) => size !== drag.from.scales[i]) ||
    drag.volume.offsets.some((offset, i) => offset !== drag.from.offsets[i]);
  if (moved) drag.commit(drag.volume);
  else state.render();
}

/** Light up the plate under the pointer, so it reads as something to grab. The
 *  pair is the colour of whichever box the plates are currently on. */
export function highlightHandle(
  state: SceneState,
  plate: THREE.Object3D | null,
) {
  // Whether they really landed on a piece, not just whether one is selected: a
  // piece with no box hands them back to the unit's volume, and they have to
  // take that volume's colour with them.
  const onPiece =
    state.editPieceId !== null &&
    state.pieceCollisionBoxes.has(state.editPieceId);
  const cold = onPiece
    ? state.pieceHandleMaterial
    : state.collisionHandleMaterial;
  const hot = onPiece
    ? state.pieceHandleHotMaterial
    : state.collisionHandleHotMaterial;
  let changed = false;
  for (const other of state.collisionHandles.children) {
    if (!(other instanceof THREE.Mesh)) continue;
    const material = other === plate ? hot : cold;
    if (other.material === material) continue;
    other.material = material;
    changed = true;
  }
  return changed;
}

/**
 * Write a moved collision volume back to the document.
 *
 * Only the offsets: the gizmo moves the volume, and the face handles are what
 * size it. The wireframe's position is the volume's own numbers, since the
 * offsets run from the unit's aim point, which is where the wireframe was put.
 * Its scale is not, because a round shape is drawn at the size the engine will
 * build rather than the size typed in, so reading it back would quietly round
 * off a cylinder nobody asked to change.
 */
export function commitCollision(state: SceneState) {
  const lines = state.collision;
  const change = state.onCollisionChangeRef.current;
  if (!lines || !change) return;

  const project = state.projectRef.current;
  const bounds = unitBounds(
    project,
    state.packRef.current,
    state.rawRef.current,
  );
  const volume = effectiveCollisionVolume(project, bounds);
  const aim = aimPoint(project, bounds);
  change({
    ...volume,
    offsets: [
      lines.position.x - aim[0],
      lines.position.y - aim[1],
      lines.position.z - aim[2],
    ],
  });
}

/**
 * Write a moved piece box back to the document.
 *
 * The same rule as the unit volume above and for the same reasons: only the
 * offsets, and read off the wireframe's position rather than its scale.
 *
 * A piece's offsets are measured from the piece's own place in the model rather
 * than from the unit's aim point, so the point they are taken against is the
 * one `pieceCollisionVolumes` reports for it. The engine translates by them on
 * top of the piece's model-space matrix, which is what makes them move and turn
 * with the piece in a game.
 */
export function commitPieceCollision(state: SceneState) {
  const subject = handleSubject(state);
  if (!subject) return;
  const { lines, volume, mid, commit } = subject;
  commit({
    ...volume,
    offsets: [
      lines.position.x - mid[0],
      lines.position.y - mid[1],
      lines.position.z - mid[2],
    ],
  });
}
