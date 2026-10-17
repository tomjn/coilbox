import * as THREE from "three";
import { isEffectivelyHidden } from "../../model";
import { type LegoPartInfo, partUnit } from "../../pack";
import {
  type Axis,
  blockSizes,
  nearestSize,
  resizeReadout,
  type SizeChoice,
  sizeChoices,
} from "../../resizePackBlock";
import type { Vec3 } from "../../snapping";
import { handleBox, plateSize } from "./collisionHandles";
import type { SceneState } from "./sceneState";

/** Which face of the piece's box a plate is, carried on the plate itself. */
interface PackFace {
  axis: Axis;
  sign: 1 | -1;
}

/** The piece in the world: where its origin is, which way it faces and how big
 *  it is drawn, read off its group. */
interface Frame {
  origin: THREE.Vector3;
  turn: THREE.Quaternion;
  scale: THREE.Vector3;
}

/** A face of a pack block being dragged. */
export interface PackFaceDrag extends PackFace {
  pieceId: string;
  /** The pointer is followed on this plane. It holds the axis and faces the
   *  camera, so the face tracks the pointer from any angle. */
  plane: THREE.Plane;
  frame: Frame;
  pivot: Vec3;
  part: LegoPartInfo;
  choices: SizeChoice[];
  /** Where the pointer was on the axis, in the part's space, when it grabbed. */
  grabbedAt: number;
  /** The part's size along the axis when it was grabbed. */
  from: number;
  /** The size the pointer asks for now. */
  wanted: number;
}

/**
 * The piece the face plates are on, or null when there is none.
 *
 * Plates stand in for the scale gizmo on one pack block while the size tool is
 * active: a stretch and a swap to the part of the size dragged cannot both
 * answer the same handle. The uniform scale lock keeps the gizmo, since that is
 * a stretch of the whole piece.
 */
export function packSubject(state: SceneState): {
  id: string;
  part: LegoPartInfo;
  group: THREE.Group;
  pivot: Vec3;
} | null {
  if (!state.onPackResizeRef.current) return null;
  if (state.gizmo.getMode() !== "scale" || state.uniformScale) return null;
  if (handleBox(state) || state.editAim || state.placingAnchorRef.current) {
    return null;
  }
  const ids = state.selectedIdsRef.current;
  if (ids.length !== 1 || state.groupIds.length !== 1) return null;
  const project = state.projectRef.current;
  const piece = project.pieces.find((p) => p.id === ids[0]);
  if (!piece?.partId || piece.meshId || isEffectivelyHidden(project, piece.id))
    return null;
  const part = state.packRef.current.byId.get(piece.partId);
  const group = state.groups.get(piece.id);
  if (!part || !group) return null;
  return { id: piece.id, part, group, pivot: piece.pivot ?? [0, 0, 0] };
}

function frameOf(state: SceneState, group: THREE.Group): Frame {
  state.scene.updateMatrixWorld(true);
  const frame: Frame = {
    origin: new THREE.Vector3(),
    turn: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
  };
  group.matrixWorld.decompose(frame.origin, frame.turn, frame.scale);
  return frame;
}

/** A point of the part, in the frame at the piece's origin but not its turn. */
function inFrame(frame: Frame, pivot: Vec3, point: Vec3): THREE.Vector3 {
  return new THREE.Vector3(
    frame.scale.x * (point[0] - pivot[0]),
    frame.scale.y * (point[1] - pivot[1]),
    frame.scale.z * (point[2] - pivot[2]),
  );
}

function middle(part: LegoPartInfo): Vec3 {
  const { min, max } = part.bbox;
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/** The outline of the part a drag would swap to, built once with the scene.
 *  The plates themselves are `buildCollisionHandles`, so a face is grabbed the
 *  same way whichever box it is on. */
export function buildPackPreview(
  material: THREE.LineBasicMaterial,
): THREE.LineSegments {
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    material,
  );
  box.renderOrder = 5;
  box.visible = false;
  return box;
}

/**
 * Put the plates on the selected pack block's faces, or take them off screen.
 * The plates sit on the piece's own axes, so they follow its turn.
 */
export function showPackHandles(state: SceneState) {
  const subject = packSubject(state);
  state.packHandles.visible = subject !== null;
  if (!state.packDrag) {
    state.packPreview.visible = false;
    highlightPlate(state, null);
  }
  if (!subject) return;

  const frame = state.packDrag?.frame ?? frameOf(state, subject.group);
  state.packHandles.position.copy(frame.origin);
  state.packHandles.quaternion.copy(frame.turn);
  const sizes = blockSizes(subject.part).map(
    (size, k) => size * Math.abs(frame.scale.getComponent(k)),
  );
  for (const plate of state.packHandles.children) {
    const { axis, sign } = plate.userData as PackFace;
    const across = [0, 1, 2].filter((other) => other !== axis);
    // The face of the part, which a mirrored piece draws on the other side.
    const face = middle(subject.part);
    face[axis] = subject.part.bbox[sign > 0 ? "max" : "min"][axis];
    plate.position.copy(inFrame(frame, subject.pivot, face));
    const side = plateSize(sizes[across[0]], sizes[across[1]]);
    plate.scale.set(side, side, 1);
  }
}

/** Light up one plate, so it reads as something to grab. */
export function highlightPlate(
  state: SceneState,
  plate: THREE.Object3D | null,
): boolean {
  let changed = false;
  for (const other of state.packHandles.children) {
    if (!(other instanceof THREE.Mesh)) continue;
    const material =
      other === plate ? state.packHandleHotMaterial : state.packHandleMaterial;
    if (other.material === material) continue;
    other.material = material;
    changed = true;
  }
  return changed;
}

/** The part-space coordinate on the dragged axis that a world point is at. */
function coordinateAt(drag: PackFaceDrag, point: THREE.Vector3): number {
  const local = point
    .clone()
    .sub(drag.frame.origin)
    .applyQuaternion(drag.frame.turn.clone().invert());
  const scale = drag.frame.scale.getComponent(drag.axis);
  return drag.pivot[drag.axis] + local.getComponent(drag.axis) / scale;
}

/**
 * Start sizing the block, if the pointer landed on one of the plates.
 *
 * The face is tracked on a plane that holds the piece's axis and faces the
 * camera. Looking straight down the axis there is no such plane and no drag to
 * be had, which is the one case this refuses.
 */
export function beginPackDrag(
  state: SceneState,
  raycaster: THREE.Raycaster,
): boolean {
  if (!state.packHandles.visible) return false;
  const hit = raycaster.intersectObjects(state.packHandles.children, false)[0];
  if (!hit) return false;
  const subject = packSubject(state);
  if (!subject) return false;

  const { axis, sign } = hit.object.userData as PackFace;
  const frame = frameOf(state, subject.group);
  const scale = frame.scale.getComponent(axis);
  if (Math.abs(scale) < 1e-9) return false;

  const along = new THREE.Vector3()
    .setComponent(axis, 1)
    .applyQuaternion(frame.turn);
  const eye =
    state.camera instanceof THREE.OrthographicCamera
      ? state.camera.getWorldDirection(new THREE.Vector3()).negate()
      : state.camera.position.clone().sub(hit.point);
  const normal = eye.sub(along.clone().multiplyScalar(eye.dot(along)));
  if (normal.lengthSq() < 1e-6) return false;

  const from = blockSizes(subject.part)[axis];
  const drag: PackFaceDrag = {
    axis,
    sign,
    pieceId: subject.id,
    plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal.normalize(),
      hit.point,
    ),
    frame,
    pivot: subject.pivot,
    part: subject.part,
    choices: sizeChoices(state.packRef.current, subject.part, axis),
    grabbedAt: 0,
    from,
    wanted: from,
  };
  drag.grabbedAt = coordinateAt(drag, hit.point);
  state.packDrag = drag;
  highlightPlate(state, hit.object);
  state.controls.enabled = false;
  showPreview(state, drag);
  state.onPackReadoutRef.current?.(
    resizeReadout(drag.choices, from, partUnit(state.packRef.current)),
  );
  return true;
}

/** Follow the pointer: the box the block would have, and what it is. */
export function movePackDrag(state: SceneState, raycaster: THREE.Raycaster) {
  const drag = state.packDrag;
  if (!drag) return;
  const at = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
  if (!at) return;

  drag.wanted =
    drag.from + drag.sign * (coordinateAt(drag, at) - drag.grabbedAt);
  showPreview(state, drag);
  state.onPackReadoutRef.current?.(
    resizeReadout(drag.choices, drag.wanted, partUnit(state.packRef.current)),
  );
  state.render();
}

/** Draw the outline of the part the drag has landed on, its fixed face where
 *  the block's was. */
function showPreview(state: SceneState, drag: PackFaceDrag) {
  const chosen = nearestSize(drag.choices, drag.wanted);
  const size = chosen?.size ?? drag.from;
  const { min, max } = drag.part.bbox;
  const lo: Vec3 = [...min];
  const hi: Vec3 = [...max];
  if (drag.sign > 0) hi[drag.axis] = lo[drag.axis] + size;
  else lo[drag.axis] = hi[drag.axis] - size;

  const centre = inFrame(drag.frame, drag.pivot, [
    (lo[0] + hi[0]) / 2,
    (lo[1] + hi[1]) / 2,
    (lo[2] + hi[2]) / 2,
  ]).applyQuaternion(drag.frame.turn);
  const preview = state.packPreview;
  preview.position.copy(drag.frame.origin).add(centre);
  preview.quaternion.copy(drag.frame.turn);
  preview.scale.set(
    Math.abs(drag.frame.scale.x) * (hi[0] - lo[0]),
    Math.abs(drag.frame.scale.y) * (hi[1] - lo[1]),
    Math.abs(drag.frame.scale.z) * (hi[2] - lo[2]),
  );
  preview.visible = true;
}

/** Hand the size the drag landed on to the document, if it is a new one. A press
 *  that went nowhere is not an edit and does not belong in the undo history. */
export function endPackDrag(state: SceneState) {
  const drag = state.packDrag;
  state.packDrag = null;
  state.controls.enabled = true;
  state.packPreview.visible = false;
  highlightPlate(state, null);
  state.onPackReadoutRef.current?.(null);
  if (!drag) return;
  const chosen = nearestSize(drag.choices, drag.wanted);
  if (chosen && chosen.part.id !== drag.part.id) {
    state.onPackResizeRef.current?.(
      drag.pieceId,
      drag.axis,
      drag.sign,
      chosen.size,
    );
  } else {
    state.render();
  }
}
