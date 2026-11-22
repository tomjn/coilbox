/**
 * The four view layout: where each view sits on the canvas, and which one is
 * under the pointer.
 *
 * Pure for the same reason as orthoViews.ts. The viewport owns the renderer and
 * the cameras and hands these functions sizes and pointer positions.
 *
 * The layout follows 3ds Max: top in the top left, front in the top right, side
 * in the bottom left and perspective in the bottom right.
 */

import type { StandardView } from "./orthoViews";

export type Quadrant = "top" | "front" | "side" | "perspective";

/** In reading order, which is also the order they are laid out in. */
export const QUADRANTS: readonly Quadrant[] = [
  "top",
  "front",
  "side",
  "perspective",
];

/** The standard view each orthographic quadrant shows. */
export const QUADRANT_VIEWS: Record<
  Exclude<Quadrant, "perspective">,
  StandardView
> = {
  top: "top",
  front: "front",
  side: "side",
};

/** A rectangle on the canvas in CSS pixels, measured from its top left. */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where each quadrant sits on a canvas `width` by `height` CSS pixels. The
 * four tile the canvas with no gap and no overlap. An odd size gives the extra
 * pixel to the right column and the bottom row.
 */
export function quadrantRects(
  width: number,
  height: number,
): Record<Quadrant, ViewRect> {
  const left = Math.floor(width / 2);
  const upper = Math.floor(height / 2);
  const right = width - left;
  const lower = height - upper;
  return {
    top: { x: 0, y: 0, width: left, height: upper },
    front: { x: left, y: 0, width: right, height: upper },
    side: { x: 0, y: upper, width: left, height: lower },
    perspective: { x: left, y: upper, width: right, height: lower },
  };
}

/** How far the unit's overlays sit from each edge of the canvas. */
export interface OverlayInset {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

/** The room kept round the overlays. */
const OVERLAY_GAP = "0.75rem";
/** The height of a quadrant's name, which the overlays leave clear. */
const NAME_ROW = "1rem";

/**
 * Where the unit's overlays (the info card, the toolbar, the tool rail, the
 * status text, the grid button, the compass and the bottom bar) are drawn. All
 * of the canvas with one view. With four, the perspective quadrant only, which
 * is its bottom right half in each direction, so the top, front and side views
 * stay uncovered. Below the quadrant's name, which stays where it is.
 */
export function overlayInset(fourViews: boolean): OverlayInset {
  if (!fourViews) {
    return {
      top: OVERLAY_GAP,
      right: OVERLAY_GAP,
      bottom: OVERLAY_GAP,
      left: OVERLAY_GAP,
    };
  }
  return {
    top: `calc(50% + ${NAME_ROW} + ${OVERLAY_GAP})`,
    right: OVERLAY_GAP,
    bottom: OVERLAY_GAP,
    left: `calc(50% + ${OVERLAY_GAP})`,
  };
}

/** Whether a point on the canvas, in CSS pixels from its top left, is in
 *  `rect`. The left and top edges are inside, the right and bottom are not,
 *  so a point on a shared edge belongs to one quadrant only. */
function inside(rect: ViewRect, x: number, y: number): boolean {
  return (
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

/** The quadrant under a point on the canvas, in CSS pixels from its top left,
 *  or null for a point off the canvas. */
export function quadrantAt(
  rects: Record<Quadrant, ViewRect>,
  x: number,
  y: number,
): Quadrant | null {
  return QUADRANTS.find((id) => inside(rects[id], x, y)) ?? null;
}

/** A point on the canvas as the camera drawing `rect` sees it: -1 to 1 across
 *  the rectangle either way, with +1 at the top. */
export function pointInView(
  rect: ViewRect,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: ((x - rect.x) / rect.width) * 2 - 1,
    y: -((y - rect.y) / rect.height) * 2 + 1,
  };
}

/** `rect` as WebGL wants a viewport: measured from the canvas's bottom left. */
export function fromBottomLeft(rect: ViewRect, canvasHeight: number): ViewRect {
  return { ...rect, y: canvasHeight - rect.y - rect.height };
}
