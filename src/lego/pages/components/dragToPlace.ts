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

/** Where a dropped part would go. */
export type DropTarget =
  | { kind: "face"; target: FaceTarget }
  | { kind: "ground"; position: Vec3 };

/**
 * What the pointer is over: the face of a piece, the ground, or nothing a part
 * can go on. A piece hit with no face under the pointer is nothing, as it is
 * for a click, so the part is never dropped on the ground behind the model.
 * Without a ground point (a module, or a ray that misses the ground) there is
 * nothing to land on.
 */
export function chooseDropTarget(over: {
  hitPiece: boolean;
  face: FaceTarget | null;
  ground: Vec3 | null;
}): DropTarget | null {
  if (over.hitPiece)
    return over.face ? { kind: "face", target: over.face } : null;
  return over.ground ? { kind: "ground", position: over.ground } : null;
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
