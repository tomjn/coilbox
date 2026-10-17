import * as THREE from "three";
import { pieceConnectors, pieceOwnBox, slideJoin } from "../../connectors";
import { snapToGuides } from "../../guides";
import { snapMeasurePoint } from "../../measure";
import type { LegoPiece, LegoProject } from "../../model";
import { descendantIds, pieceById } from "../../model";
import { type LoadedPack, partUnit } from "../../pack";
import { pieceMesh, type RawGeometry } from "../../rawGeometry";
import type { Seat } from "../../seat";
import { isRoundShapeKind } from "../../shapes";
import {
  type Anchor,
  facesOppose,
  moveStep,
  nearestSnap,
  pieceAnchors,
  screenPixelsToWorld,
  screenPixelsToWorldOrtho,
  snapPosition,
  snapRotation,
  type Vec3,
} from "../../snapping";
import { cornerMark, faceMark, points } from "./dotsAndPoints";
import { pieceIdOf } from "./gizmoCommit";
import {
  CORNER_COLOUR,
  CUSTOM_COLOUR,
  FACE_COLOUR,
  ROTATION_STEP,
  SEAT_COLOUR,
} from "./ModelViewport";
import type { SceneState } from "./sceneState";

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
 *
 * A face or a custom anchor is a connector, and carries the id and facing a
 * join will use. Where the piece's connectors are not the box's, because a
 * part states its own, they stand in for the box's anchors, so every face
 * offered here is one a join can name. A corner and the middle stay position
 * only.
 */
function localAnchorsOf(
  pack: LoadedPack,
  raw: RawGeometry | null,
  piece: LegoPiece,
): { anchor: Anchor; position: Vec3 }[] {
  const pivot = piece.pivot ?? [0, 0, 0];
  const box = pieceBox(pack, raw, piece) ?? null;
  const connectors = pieceConnectors(pack, piece);
  const ids = new Map(connectors.map((c) => [c.id, c]));

  let anchors: Anchor[];
  if (piece.customAnchors && piece.customAnchors.length > 0) {
    anchors = pieceAnchors(box, piece.customAnchors).map((anchor, index) => {
      const own = piece.customAnchors?.[index];
      const connector = own ? ids.get(own.id) : undefined;
      return connector && own
        ? {
            ...anchor,
            connector: connector.id,
            facing: connector.facing,
          }
        : anchor;
    });
  } else if (piece.partId && pack.byId.get(piece.partId)?.connectors) {
    anchors = connectors.map((c) => ({
      position: c.position,
      kind: "face",
      out: c.facing,
      connector: c.id,
      facing: c.facing,
    }));
  } else {
    anchors = pieceAnchors(
      box,
      undefined,
      piece.shape !== undefined && isRoundShapeKind(piece.shape.kind),
    ).map((anchor) =>
      anchor.connector && ids.has(anchor.connector)
        ? anchor
        : stripConnector(anchor),
    );
  }

  return anchors.map((anchor) => ({
    anchor,
    position: [
      anchor.position[0] - pivot[0],
      anchor.position[1] - pivot[1],
      anchor.position[2] - pivot[2],
    ],
  }));
}

/** The same anchor with nothing to join by: a face of a piece that has no part
 *  to state connectors for it still snaps, it just saves no join. */
function stripConnector(anchor: Anchor): Anchor {
  const { connector: _id, facing: _facing, ...rest } = anchor;
  return rest;
}

/** A part carries its box in the pack manifest, a shape's is its size and an
 *  imported mesh carries its own, computed once on import, so all three answer
 *  this the same way. */
function pieceBox(pack: LoadedPack, raw: RawGeometry | null, piece: LegoPiece) {
  return pieceMesh(raw, piece)?.bbox ?? pieceOwnBox(pack, piece);
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
  // A facing is a direction out of a surface, so it turns with the normal
  // matrix: a mirrored piece's face points the other way.
  const normal = new THREE.Matrix3().getNormalMatrix(group.matrixWorld);
  return localAnchorsOf(pack, state.rawRef.current, piece).map(
    ({ anchor, position }) => {
      point.set(...position).applyMatrix4(group.matrixWorld);
      const world: Anchor = {
        ...anchor,
        position: [point.x, point.y, point.z] as Vec3,
      };
      if (anchor.facing) {
        const f = new THREE.Vector3(...anchor.facing)
          .applyMatrix3(normal)
          .normalize();
        world.facing = [f.x, f.y, f.z];
      }
      return world;
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
  const inPart = hitInPart(state, hit);
  if (!inPart) {
    state.onCancelAnchorRef.current?.();
    return;
  }
  state.onPlaceAnchorRef.current?.(
    inPart.pieceId,
    inPart.position,
    inPart.facing,
  );
}

/**
 * Where a hit on the model is in the piece it landed on: the point and the way
 * the surface faces, both in that piece's part space, which is the frame
 * anchors and connectors are written in. Null for a miss.
 */
export function hitInPart(
  state: SceneState,
  hit: THREE.Intersection | undefined,
): { pieceId: string; position: Vec3; facing?: Vec3 } | null {
  const pieceId = hit ? pieceIdOf(hit.object) : null;
  const group = pieceId ? state.groups.get(pieceId) : undefined;
  const piece = pieceId
    ? pieceById(state.projectRef.current, pieceId)
    : undefined;
  if (!hit || !pieceId || !group || !piece) return null;

  group.updateWorldMatrix(true, false);
  const local = hit.point
    .clone()
    .applyMatrix4(new THREE.Matrix4().copy(group.matrixWorld).invert());
  const pivot = piece.pivot ?? [0, 0, 0];
  return {
    pieceId,
    position: [local.x + pivot[0], local.y + pivot[1], local.z + pivot[2]],
    facing: clickedFacing(hit, group),
  };
}

/**
 * Which way the surface that was clicked points, in the piece's part space, so
 * a connector placed there faces out of the model rather than into it. A hit on
 * something with no face, such as a point, gives no facing and the connector
 * takes the one its nearest box face gives.
 */
function clickedFacing(
  hit: THREE.Intersection,
  group: THREE.Object3D,
): Vec3 | undefined {
  if (!hit.face) return undefined;
  const world = hit.face.normal
    .clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
    .normalize();
  // Back from the world into the part: a normal goes through the transpose of
  // the matrix that took the part into the world.
  const local = world
    .applyMatrix3(
      new THREE.Matrix3().setFromMatrix4(group.matrixWorld).transpose(),
    )
    .normalize();
  if (!Number.isFinite(local.x + local.y + local.z) || local.lengthSq() === 0) {
    return undefined;
  }
  return [local.x, local.y, local.z];
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
 * How far, in world units, a snap reaches at `at`: `SNAP_PIXELS` on screen. A
 * perspective camera covers more world per pixel the further `at` is from it.
 * An orthographic one covers the same everywhere, set by how much it shows.
 */
export function snapReach(state: SceneState, at: THREE.Vector3): number {
  const viewportHeight = state.renderer.getSize(new THREE.Vector2()).y;
  const { camera } = state;
  if (camera instanceof THREE.OrthographicCamera) {
    return screenPixelsToWorldOrtho(
      (camera.top - camera.bottom) / camera.zoom,
      viewportHeight,
      SNAP_PIXELS,
    );
  }
  return screenPixelsToWorld(
    THREE.MathUtils.degToRad(camera.fov),
    viewportHeight,
    camera.position.distanceTo(at),
    SNAP_PIXELS,
  );
}

/**
 * Where a click or the pointer lands when measuring: on the nearest anchor of
 * any piece, else on a guide, else where the ray met the model or the ground.
 * Alt held, as in a drag, places it freely.
 *
 * The reach is the drag's own, in screen pixels, so a point snaps from as far
 * away on screen as a piece does.
 */
export function measurePoint(state: SceneState, at: Vec3): Vec3 {
  if (!state.snapping) return at;
  const project = state.projectRef.current;
  const pack = state.packRef.current;
  const anchors = project.pieces.flatMap((piece) =>
    worldAnchors(state, pack, piece).map((anchor) => anchor.position),
  );
  const threshold = snapReach(state, new THREE.Vector3(...at));
  return snapMeasurePoint(
    at,
    anchors,
    state.guidePlanes,
    state.guideLines,
    threshold,
  ).point;
}

/**
 * Seat the dragged piece against the nearest anchor of any other piece.
 *
 * Applied live rather than on release, so the piece visibly clicks into place
 * and there is no jump at the end of a drag. Rotation lands on 15 degree steps
 * for the same reason.
 *
 * A move snaps in this order: another piece's anchor, which fixes all three
 * coordinates, then a guide line, which fixes the two across it, and guide
 * planes for what a line leaves, then the move step for whatever is left. See `guides.ts`.
 */
export function applySnap(state: SceneState) {
  const group = state.gizmo.object;
  const pieceId = group ? pieceIdOf(group) : null;
  if (!group || !pieceId) return;

  // Whatever the last move of this drag seated is stale once it moves again.
  state.seat = null;
  state.slide = null;

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

  // A joined piece slides along its face, which replaces the anchor snap.
  if (piece.connection) {
    const step = partUnit(pack);
    const slid = slideJoin(
      project,
      pack,
      pieceId,
      group.position.toArray() as Vec3,
      step,
    );
    if (slid) {
      showSeat(state, null);
      group.position.set(...slid.position);
      state.slide = slid.offset;
      state.onSnapChange(false, undefined, step, slid.offset);
      return;
    }
  }

  const targets = snapTargets(state, pack, project, pieceId);
  const targetPoints = targets.map((target) => target.position);
  const own = worldAnchors(state, pack, piece);
  const mine = own.map((anchor) => anchor.position);

  // Screen-scaled, so the snap reaches the same number of pixels whether the
  // camera is zoomed in tight or pulled right back. Measured to the dragged
  // piece itself, not the camera's orbit target, so seating a piece far from
  // the pivot does not get a threshold sized for somewhere else in the scene.
  const threshold = snapReach(
    state,
    group.getWorldPosition(new THREE.Vector3()),
  );

  paintProximity(state, mine, targetPoints, threshold);

  const snap = nearestSnap(mine, targetPoints, threshold);
  const seated = snap ? targets[snap.targetIndex] : undefined;
  showSeat(state, snap ? { at: snap.at, owner: seated?.owner } : null);
  if (!snap) {
    // No anchor in range, so a free piece steps in part units instead. The
    // position is the one stored, in the parent's axes, which for a piece on
    // the root are the world's.
    const step = moveStep([piece], partUnit(pack));
    if (step !== null) {
      group.position.set(...snapPosition(group.position.toArray(), step));
    }
    // A guide line then settles the two coordinates across it and a guide plane
    // the one it stands across, over the step. They are measured from where the
    // step left the piece, so any coordinate they leave keeps its step.
    const guides = snapToGuides(
      worldAnchors(state, pack, piece).map((anchor) => anchor.position),
      state.guidePlanes,
      threshold,
      state.guideLines,
    );
    if (guides.guides.length > 0) moveByWorldDelta(group, guides.delta);
    state.onSnapChange(
      guides.guides.length > 0,
      guides.guides.length > 0
        ? guides.guides.map((guide) => guide.name).join(", ")
        : undefined,
      step ?? undefined,
    );
    return;
  }
  state.onSnapChange(true, seated?.name);

  // Two faces that point at each other are a join. Faces that do not, a corner
  // and the middle are a position only: the piece is moved, as it always was,
  // and nothing is saved. Turning the piece to make the faces meet would change
  // what a drag does to its rotation, which a snap has never done.
  const moving = own[snap.movingIndex];
  state.seat =
    seated?.connector &&
    seated.facing &&
    moving?.connector &&
    moving.facing &&
    facesOppose(moving.facing, seated.facing)
      ? {
          parentId: seated.owner,
          connector: moving.connector,
          to: seated.connector,
        }
      : null;

  moveByWorldDelta(group, snap.delta);
}

/**
 * Move a group by a distance measured in the world.
 *
 * The group's position is relative to its parent, so the delta has to be
 * rotated into the parent's frame before it is added.
 */
function moveByWorldDelta(group: THREE.Object3D, worldDelta: Vec3) {
  const delta = new THREE.Vector3(...worldDelta);
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
  /** The connector at this anchor and which way it points in the world, for a
   *  face or a custom anchor. */
  connector?: string;
  facing?: Vec3;
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
        ...(anchor.connector && anchor.facing
          ? { connector: anchor.connector, facing: anchor.facing }
          : {}),
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
    // A face gets a square in its own plane and a corner a cube meeting it,
    // so each says which surface it is about rather than only where it is.
    if (anchor.out && (anchor.kind === "face" || anchor.kind === "corner")) {
      const at = { x: position[0], y: position[1], z: position[2] };
      const out = { x: anchor.out[0], y: anchor.out[1], z: anchor.out[2] };
      const colour = anchorColour(anchor.kind);
      marks.add(
        anchor.kind === "face"
          ? faceMark(at, out, colour)
          : cornerMark(at, out, colour),
      );
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
