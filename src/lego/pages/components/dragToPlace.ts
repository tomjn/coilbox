import { type LegoProject, pieceById } from "../../model";
import type { FaceTarget } from "../../placePart";
import { snapPosition, type Vec3 } from "../../snapping";

/**
 * How far a pointer travels, in CSS pixels, before a press on a catalogue tile
 * is a drag and not a click. It is the distance the viewport allows a click
 * before it calls a press an orbit. Chosen to match that, not measured.
 */
export const DRAG_TRAVEL = 4;

/** Whether the pointer has moved far enough from where it went down to drag. */
export function startsDrag(
  from: { x: number; y: number },
  now: { x: number; y: number },
): boolean {
  return Math.hypot(now.x - from.x, now.y - from.y) > DRAG_TRAVEL;
}

/**
 * Where a dropped tile would go. A face is a connector of a piece, which parts
 * and modules join. The ground and a surface are places under a parent piece,
 * given in that parent's axes: the ground is empty space, and a surface is a
 * point on a piece, which is where a shape (with no connector to join by) lands.
 */
export type DropTarget =
  | { kind: "face"; target: FaceTarget }
  | { kind: "ground"; parentId: string; position: Vec3 }
  | { kind: "surface"; parentId: string; position: Vec3 };

/** A place under a parent piece, in the parent's axes. */
export interface Spot {
  parentId: string;
  position: Vec3;
}

/**
 * What the pointer is over: the face of a piece, the ground, or nothing a tile
 * can go on. A piece hit with no face under the pointer is nothing, as it is
 * for a click, so the tile is never dropped on the ground behind the model.
 * A `surface` is given for a shape only, which lands on the point of a piece
 * the pointer is over and needs no face. Without a ground spot (a ray that
 * misses the ground) there is nothing to land on.
 */
export function chooseDropTarget(over: {
  hitPiece: boolean;
  face: FaceTarget | null;
  ground: Spot | null;
  surface?: Spot | null;
}): DropTarget | null {
  if (over.hitPiece) {
    if (over.surface) return { kind: "surface", ...over.surface };
    return over.face ? { kind: "face", target: over.face } : null;
  }
  return over.ground ? { kind: "ground", ...over.ground } : null;
}

/**
 * The piece a ground drop hangs off: the selected piece when there is one in
 * the unit, otherwise the root, which is where `addPart` and `addStripShape`
 * attach a click too.
 */
export function groundParentId(
  project: LegoProject,
  selectedId: string | null,
): string {
  return selectedId && pieceById(project, selectedId)
    ? selectedId
    : project.rootPieceId;
}

/**
 * Where a shape centred on its own origin goes to rest against a surface, in
 * the parent's axes: the shape's centre is put out along the surface's normal
 * by the distance from its centre to its box face in that direction, so it
 * touches the surface at the point and does not sink into it. The shape keeps
 * the parent's axes.
 */
export function surfaceSpot(point: Vec3, normal: Vec3, size: Vec3): Vec3 {
  const length = Math.hypot(...normal);
  if (length === 0) return point;
  const n = normal.map((v) => v / length);
  const reach =
    (Math.abs(n[0]) * size[0] +
      Math.abs(n[1]) * size[1] +
      Math.abs(n[2]) * size[2]) /
    2;
  return [
    point[0] + n[0] * reach,
    point[1] + n[1] * reach,
    point[2] + n[2] * reach,
  ];
}

/**
 * What the click placing mode becomes when a drag ends. A drop that placed
 * something ends placing, as a click does. A drag that was cancelled, released
 * outside the viewport or let go where nothing can go gives back the mode that
 * was active before the drag, if there was one.
 */
export function placingAfterDrag<T>(
  before: T | null,
  placed: boolean,
): T | null {
  return placed ? null : before;
}

/**
 * The position, in the parent's axes, a part dropped on the ground gets. The
 * two ground axes land on the step, or stay where the pointer is when the step
 * is null (snapping off). Height is the pointer's plus the lift that stands the
 * part on the ground rather than half in it.
 */
export function groundSpot(
  local: Vec3,
  step: number | null,
  lift: number,
): Vec3 {
  const [x, , z] =
    step === null ? local : snapPosition([local[0], 0, local[2]], step);
  return [x, local[1] + lift, z];
}
