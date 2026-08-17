/**
 * Reading a pointer over the surface: what a press begins, what counts as a
 * click, and where on the ground a ray lands.
 *
 * Geometry on plain values, so the rules a gesture relies on can be tested
 * without a GPU. The three.js half, casting the ray and finding what it passed
 * through, lives in `useMapEditing.ts`. What an edit then does to the document
 * is the document's own business, and for a scenario it is in `editing.ts`.
 */

import type { Point } from "@/scenario/model";

/** How far a pointer may travel between press and release and still count as a
 *  click, in CSS pixels. Wide enough to survive a shaky hand, narrow enough that
 *  a deliberate nudge of a unit is not read as a click. */
export const CLICK_SLOP_PX = 4;

/** A point in the surface's own pixels. */
export interface PointerPos {
  x: number;
  y: number;
}

/** What the pointer is over, out of everything the ray passed through. */
export interface PointerTargets {
  /** The nearest thing with a key, which is what a click selects. */
  select: string | null;
  /**
   * The nearest thing a press can pick up, which is not always the nearest
   * thing. A zone's sheet lies over its own handles: it is what a click on the
   * zone selects, and the handle inside it is what a drag moves.
   */
  grab: string | null;
}

/**
 * What a ray found, read as a selection and a grab.
 *
 * `keys` is every drawn thing the ray passed through, nearest first. Anything a
 * press cannot pick up is passed over in the search for something it can, which
 * is what lets a handle be grabbed through the sheet lying over it. Nothing else
 * on the map is see-through, so nothing else is reached this way.
 */
export function pointerTargets(
  keys: string[],
  grabbable: (key: string) => boolean,
): PointerTargets {
  const grab = keys.find(grabbable) ?? null;
  return { select: keys[0] ?? null, grab };
}

/**
 * What a press on the map begins: picking something up, drawing on the ground,
 * or moving the camera.
 *
 * One button does all three, so what is under it decides. Only something a press
 * can pick up wins it: a zone's sheet is drawn over the ground and can cover the
 * whole view, so it is selected by a click and moved by its own handle, and a
 * drag that starts on one belongs to the camera or to the zone being drawn
 * inside it (#910, #837).
 */
export type PressGesture = "grab" | "draw" | "camera";

export function pressGesture(opts: {
  /** What the press can pick up, as {@link pointerTargets} read it. */
  grab: string | null;
  /** Whether the current mode draws a shape by dragging across the ground. */
  draws: boolean;
}): PressGesture {
  if (opts.grab) return "grab";
  return opts.draws ? "draw" : "camera";
}

/**
 * What the pointer looks like over something it can pick up (issue #1716).
 *
 * A selected building is dragged to move it, and nothing said so: the pointer
 * over it looked the same as the pointer over the ground beside it. So it takes
 * the hand the rest of the web uses for something draggable, open until the
 * press and closed after it.
 *
 * `ground` is what the mode makes of bare ground, which is what the pointer goes
 * back to the moment it leaves the thing.
 */
export function holdCursor(opts: {
  /** Whether a drag is under way. */
  dragging: boolean;
  /** Whether the pointer is over the thing it could pick up. */
  holding: boolean;
  ground: string;
}): string {
  if (opts.dragging) return "grabbing";
  return opts.holding ? "grab" : opts.ground;
}

/**
 * Whether a point on the map is on a patch of ground (issue #1716).
 *
 * How a press reaches the selected building's own square. The squares are drawn
 * by a layer nothing raycasts, on purpose: they lie under the buildings they
 * belong to and would swallow every click meant for one. Asking the arithmetic
 * instead costs nothing and only ever answers about the one building whose
 * square is being offered as a handle.
 *
 * The far edges count, unlike two footprints meeting, because this is one square
 * being pointed at rather than two of them competing for ground.
 */
export function onGround(
  pos: Point,
  rect: { minX: number; minZ: number; maxX: number; maxZ: number },
): boolean {
  return (
    pos.x >= rect.minX &&
    pos.x <= rect.maxX &&
    pos.z >= rect.minZ &&
    pos.z <= rect.maxZ
  );
}

/**
 * Whether a press and release were the same gesture.
 *
 * The camera pans on the left button, so a left press is not free: press and
 * release have to be compared to tell "I clicked here" from "I dragged the map".
 */
export function isClick(
  from: PointerPos,
  to: PointerPos,
  slop = CLICK_SLOP_PX,
): boolean {
  return Math.abs(to.x - from.x) <= slop && Math.abs(to.y - from.y) <= slop;
}

/** A pointer position in normalised device coordinates, which is what a
 *  raycaster takes: -1 to 1 across the canvas, y up. */
export function pointerNdc(
  client: PointerPos,
  rect: { left: number; top: number; width: number; height: number },
): PointerPos {
  return {
    x: rect.width > 0 ? ((client.x - rect.left) / rect.width) * 2 - 1 : 0,
    y: rect.height > 0 ? -(((client.y - rect.top) / rect.height) * 2 - 1) : 0,
  };
}

/** A point held on the map, so a ray that lands past the coastline still edits
 *  somewhere the engine can spawn a unit. */
export function clampToMap(
  pos: Point,
  worldWidth: number,
  worldHeight: number,
): Point {
  return {
    x: Math.min(worldWidth, Math.max(0, pos.x)),
    z: Math.min(worldHeight, Math.max(0, pos.z)),
  };
}
