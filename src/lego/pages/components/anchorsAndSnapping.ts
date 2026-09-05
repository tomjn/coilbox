import * as THREE from "three";
import type { LegoPiece, LegoProject } from "../../model";
import { descendantIds, pieceById } from "../../model";
import type { LoadedPack } from "../../pack";
import { pieceMesh, type RawGeometry } from "../../rawGeometry";
import {
  type Anchor,
  nearestSnap,
  pieceAnchors,
  screenPixelsToWorld,
  snapRotation,
  type Vec3,
} from "../../snapping";
import {
  CORNER_COLOUR,
  CUSTOM_COLOUR,
  FACE_COLOUR,
  pieceIdOf,
  points,
  ROTATION_STEP,
  type SceneState,
  SEAT_COLOUR,
} from "./ModelViewport";

/** A target anchor nothing is near. Warms towards `SEAT_COLOUR` on approach. */
const TARGET_COLD = 0x64748b;
/**
 * How close two anchors must be before a piece seats against another,
 * expressed as screen pixels rather than world units, so a snap reaches the
 * same distance on screen whatever the camera is doing.
 *
 * At the home camera position and a typical panel height, 0.45 world units
 * (the fixed figure this replaces) works out to about 23px, so 24px keeps
 * the default snap feeling much the same. It also sits in the 20-30px range
 * that feels natural for a snap radius in other 3D tools.
 */
const SNAP_PIXELS = 24;

/**
 * Every anchor of a piece, in the piece's own space.
 *
 * Anchors are in the part's own space, so the pivot comes off them exactly as
 * it comes off the geometry and they sit on the part however the origin moves.
 */
function localAnchorsOf(
  pack: LoadedPack,
  raw: RawGeometry | null,
  piece: LegoPiece,
): { anchor: Anchor; position: Vec3 }[] {
  // A part carries its box in the pack manifest and an imported mesh carries
  // its own, computed once on import, so both answer this the same way.
  const box =
    pieceMesh(raw, piece)?.bbox ??
    (piece.partId ? pack.byId.get(piece.partId)?.bbox : undefined);
  const pivot = piece.pivot ?? [0, 0, 0];
  return pieceAnchors(box ?? null, piece.customAnchors).map((anchor) => ({
    anchor,
    position: [
      anchor.position[0] - pivot[0],
      anchor.position[1] - pivot[1],
      anchor.position[2] - pivot[2],
    ],
  }));
}

/**
 * Every anchor of a piece, in world space.
 *
 * The piece's own transform carries them, so an anchor turns and scales with
 * the piece it is on rather than staying where the piece used to be.
 */
function worldAnchors(
  state: SceneState,
  pack: LoadedPack,
  piece: LegoPiece,
): Anchor[] {
  const group = state.groups.get(piece.id);
  if (!group) return [];
  group.updateWorldMatrix(true, false);

  const point = new THREE.Vector3();
  return localAnchorsOf(pack, state.rawRef.current, piece).map(
    ({ anchor, position }) => {
      point.set(...position).applyMatrix4(group.matrixWorld);
      return { ...anchor, position: [point.x, point.y, point.z] as Vec3 };
    },
  );
}

/**
 * Turn a click on the model into an anchor on the piece it landed on.
 *
 * The point is handed back in that piece's part space, which is the frame an
 * anchor is stored in, so it stays on the surface it was clicked on however the
 * piece is later moved, turned or scaled. A click that hit nothing means the
 * pointer was aimed at the background, which is how you change your mind.
 */
export function placeAnchor(
  state: SceneState,
  hit: THREE.Intersection | undefined,
) {
  const pieceId = hit ? pieceIdOf(hit.object) : null;
  const group = pieceId ? state.groups.get(pieceId) : undefined;
  const piece = pieceId
    ? pieceById(state.projectRef.current, pieceId)
    : undefined;
  if (!hit || !pieceId || !group || !piece) {
    state.onCancelAnchorRef.current?.();
    return;
  }

  group.updateWorldMatrix(true, false);
  const local = hit.point
    .clone()
    .applyMatrix4(new THREE.Matrix4().copy(group.matrixWorld).invert());
  const pivot = piece.pivot ?? [0, 0, 0];
  state.onPlaceAnchorRef.current?.(pieceId, [
    local.x + pivot[0],
    local.y + pivot[1],
    local.z + pivot[2],
  ]);
}

/**
 * Hold a piece's proportions while a scale handle is dragged.
 *
 * `TransformControls` scales one axis per handle. With the lock on, the axis
 * the pointer actually moved sets a ratio and all three follow it, so a part
 * keeps its shape and only its size changes.
 */
export function forceUniformScale(state: SceneState) {
  if (!state.uniformScale || state.gizmo.getMode() !== "scale") return;
  const group = state.gizmo.object;
  const pieceId = group ? pieceIdOf(group) : null;
  if (!group || !pieceId) return;

  const piece = state.projectRef.current.pieces.find((p) => p.id === pieceId);
  if (!piece) return;

  // The axis furthest from unchanged is the one being dragged.
  let ratio = 1;
  for (let axis = 0; axis < 3; axis++) {
    const from = piece.scale[axis] || 1;
    const candidate = group.scale.getComponent(axis) / from;
    if (Math.abs(candidate - 1) > Math.abs(ratio - 1)) ratio = candidate;
  }
  group.scale.set(
    piece.scale[0] * ratio,
    piece.scale[1] * ratio,
    piece.scale[2] * ratio,
  );
}

/**
 * Seat the dragged piece against the nearest anchor of any other piece.
 *
 * Applied live rather than on release, so the piece visibly clicks into place
 * and there is no jump at the end of a drag. Rotation lands on 15 degree steps
 * for the same reason.
 */
export function applySnap(state: SceneState) {
  const group = state.gizmo.object;
  const pieceId = group ? pieceIdOf(group) : null;
  if (!group || !pieceId) return;

  const project = state.projectRef.current;
  const pack = state.packRef.current;
  const piece = project.pieces.find((p) => p.id === pieceId);
  if (!piece) return;

  if (!state.snapping) {
    state.onSnapChange(false);
    return;
  }

  if (state.gizmo.getMode() === "rotate") {
    const snappedRotation = snapRotation(
      [group.rotation.x, group.rotation.y, group.rotation.z],
      ROTATION_STEP,
    );
    group.rotation.set(...snappedRotation);
    state.onSnapChange(true);
    return;
  }
  if (state.gizmo.getMode() !== "translate") {
    state.onSnapChange(false);
    return;
  }

  const targets = snapTargets(state, pack, project, pieceId);
  const targetPoints = targets.map((target) => target.position);
  const mine = worldAnchors(state, pack, piece).map(
    (anchor) => anchor.position,
  );

  // Screen-scaled, so the snap reaches the same number of pixels whether the
  // camera is zoomed in tight or pulled right back. Measured to the dragged
  // piece itself, not the camera's orbit target, so seating a piece far from
  // the pivot does not get a threshold sized for somewhere else in the scene.
  const distance = state.camera.position.distanceTo(
    group.getWorldPosition(new THREE.Vector3()),
  );
  const viewportHeight = state.renderer.getSize(new THREE.Vector2()).y;
  const threshold = screenPixelsToWorld(
    THREE.MathUtils.degToRad(state.camera.fov),
    viewportHeight,
    distance,
    SNAP_PIXELS,
  );

  paintProximity(state, mine, targetPoints, threshold);

  const snap = nearestSnap(mine, targetPoints, threshold);
  const seated = snap ? targets[snap.targetIndex] : undefined;
  state.onSnapChange(snap !== null, seated?.name);
  showSeat(state, snap ? { at: snap.at, owner: seated?.owner } : null);
  if (!snap) return;

  // The delta is in world space and the group's position is relative to its
  // parent, so it has to be rotated into the parent's frame before it is added.
  const delta = new THREE.Vector3(...snap.delta);
  const parent = group.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    const inverse = new THREE.Matrix3()
      .setFromMatrix4(parent.matrixWorld)
      .invert();
    delta.applyMatrix3(inverse);
  }
  group.position.add(delta);
}

interface SnapTarget {
  position: Vec3;
  /** The piece whose anchor this is, so the seat can point at it. */
  owner: string;
  /** A custom anchor's name, so the seat can say which one it took. */
  name?: string;
}

/**
 * Every anchor a dragged piece could seat against, and whose each one is.
 *
 * A piece never snaps to itself or to anything hanging off it, or dragging a
 * parent would try to seat it against the children it is carrying.
 */
function snapTargets(
  state: SceneState,
  pack: LoadedPack,
  project: LegoProject,
  pieceId: string,
): SnapTarget[] {
  const own = new Set(descendantIds(project, pieceId));
  const targets: SnapTarget[] = [];
  for (const other of project.pieces) {
    if (own.has(other.id)) continue;
    for (const anchor of worldAnchors(state, pack, other)) {
      targets.push({
        position: anchor.position,
        owner: other.id,
        ...(anchor.name ? { name: anchor.name } : {}),
      });
    }
  }
  return targets;
}

/**
 * Show what a drag is seating against: a dot where the two anchors meet, and a
 * box round the piece whose anchor it is.
 *
 * Without this a snap is a piece jumping for no visible reason. There are
 * fifteen anchors on each piece and any pair within reach can win, so the only
 * useful answer to "what just happened" is to point at the pair that did.
 */
export function showSeat(
  state: SceneState,
  seat: { at: Vec3; owner: string | undefined } | null,
) {
  if (!seat) {
    state.seatMark.visible = false;
    state.seatOutline.visible = false;
    return;
  }

  state.seatMark.position.set(...seat.at);
  state.seatMark.visible = true;

  const group = seat.owner ? state.groups.get(seat.owner) : undefined;
  if (group) {
    state.seatOutline.setFromObject(group);
    state.seatOutline.visible = true;
  } else {
    state.seatOutline.visible = false;
  }
}

/** Every other piece's anchors, so a drag can see what it is aiming at. */
export function showTargetAnchors(
  state: SceneState,
  pack: LoadedPack,
  project: LegoProject,
  pieceId: string | null,
) {
  state.targetAnchors?.geometry.dispose();
  state.targetAnchors?.removeFromParent();
  state.targetAnchors = null;
  if (!pieceId) return;

  const positions = snapTargets(state, pack, project, pieceId).map(
    (target) => target.position,
  );
  if (positions.length === 0) return;

  // Every point starts cold. `paintProximity` warms them as the drag closes in.
  const cold = new THREE.Color(TARGET_COLD);
  const colours = positions.flatMap(() => [cold.r, cold.g, cold.b]);

  const object = points(positions.flat(), colours, state.dots);
  state.scene.add(object);
  state.targetAnchors = object;
}

/**
 * Warm each target anchor as the dragged piece approaches it.
 *
 * A snap is otherwise a step function: nothing, nothing, then a jump. Colouring
 * by distance turns it into something you can aim with, and the point that goes
 * fully green is the one about to take the piece.
 */
function paintProximity(
  state: SceneState,
  moving: Vec3[],
  targets: Vec3[],
  threshold: number,
) {
  const object = state.targetAnchors;
  if (!object) return;
  const colours = object.geometry.getAttribute("color");
  if (!colours || colours.count !== targets.length) return;

  const cold = new THREE.Color(TARGET_COLD);
  const hot = new THREE.Color(SEAT_COLOUR);
  const shade = new THREE.Color();

  targets.forEach((target, index) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (const from of moving) {
      nearest = Math.min(
        nearest,
        Math.hypot(
          target[0] - from[0],
          target[1] - from[1],
          target[2] - from[2],
        ),
      );
    }
    // Warms from twice the snapping distance, so a point starts to glow before
    // it can actually take the piece.
    const closeness = 1 - Math.min(nearest / (threshold * 2), 1);
    shade.copy(cold).lerp(hot, closeness * closeness);
    colours.setXYZ(index, shade.r, shade.g, shade.b);
  });
  colours.needsUpdate = true;
}

/**
 * Draw the selected piece's origin and its snap anchors.
 *
 * The dots are a child of the piece's group, so they follow it without being
 * repositioned, and they sit in part space alongside the mesh, which is why
 * the pivot comes off them exactly as it comes off the geometry.
 *
 * `depthTest` is off: the origin is usually inside the part, and a marker you
 * cannot see is no marker at all.
 */
export function showAnchors(
  state: SceneState,
  pack: LoadedPack,
  project: LegoProject,
  pieceId: string | null,
) {
  clearAnchors(state);
  if (!pieceId) return;

  const piece = project.pieces.find((p) => p.id === pieceId);
  const group = state.groups.get(pieceId);
  if (!piece || !group) return;

  const marks = new THREE.Group();

  // The origin is its own object, drawn larger. There is one of it, and it is
  // the one you go looking for.
  marks.add(points([0, 0, 0], null, state.originDot));

  const positions: number[] = [];
  const colours: number[] = [];
  for (const { anchor, position } of localAnchorsOf(
    pack,
    state.rawRef.current,
    piece,
  )) {
    if (anchor.kind !== "custom" && position.every((v) => Math.abs(v) < 1e-6)) {
      // The middle and the origin coincide, and two dots in one place read
      // as one dot of the wrong colour. A custom anchor still draws there: it
      // is a point someone put down, and it has to be visible to be moved.
      continue;
    }
    positions.push(...position);
    const colour = new THREE.Color(anchorColour(anchor.kind));
    colours.push(colour.r, colour.g, colour.b);
  }
  if (positions.length > 0) marks.add(points(positions, colours, state.dots));

  group.add(marks);
  state.anchors = marks;
}

function anchorColour(kind: Anchor["kind"]): number {
  if (kind === "custom") return CUSTOM_COLOUR;
  return kind === "corner" ? CORNER_COLOUR : FACE_COLOUR;
}

export function clearAnchors(state: SceneState) {
  state.anchors?.traverse((object) => {
    if (object instanceof THREE.Points) object.geometry.dispose();
  });
  state.anchors?.removeFromParent();
  state.anchors = null;
}
