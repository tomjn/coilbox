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
 * The room the unit's chrome keeps along three edges of the canvas in the four
 * view layout (#5410), in CSS pixels: the toolbar and the unit card along the
 * top, the bottom bar along the bottom and the tool rail down the left. The
 * views share what is left, as they do in 3ds Max and Blender, so no control
 * sits over a view.
 */
export interface ViewBands {
  top: number;
  bottom: number;
  left: number;
}

export const NO_BANDS: ViewBands = { top: 0, bottom: 0, left: 0 };

/**
 * Where each quadrant sits on a canvas `width` by `height` CSS pixels, once
 * `bands` are taken off its edges. The four tile what is left with no gap and
 * no overlap. An odd size gives the extra pixel to the right column and the
 * bottom row. Bands too big for the canvas leave the views no room rather than
 * a negative size.
 */
export function quadrantRects(
  width: number,
  height: number,
  bands: ViewBands = NO_BANDS,
): Record<Quadrant, ViewRect> {
  const x = Math.min(bands.left, width);
  const y = Math.min(bands.top, height);
  const areaWidth = width - x;
  const areaHeight = Math.max(0, height - y - bands.bottom);
  const left = Math.floor(areaWidth / 2);
  const upper = Math.floor(areaHeight / 2);
  const right = areaWidth - left;
  const lower = areaHeight - upper;
  return {
    top: { x, y, width: left, height: upper },
    front: { x: x + left, y, width: right, height: upper },
    side: { x, y: y + upper, width: left, height: lower },
    perspective: { x: x + left, y: y + upper, width: right, height: lower },
  };
}

/** The part of a box on the page that `bandsFrom` reads. */
interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The bands the chrome takes, measured from where it is drawn: `canvas` is the
 * canvas, `views` the room the chrome leaves between the top and the bottom
 * band, and `rail` the tool rail on its left. All three are measured on the
 * page, as `getBoundingClientRect` gives them. Rounded to whole pixels, since
 * a view is drawn into whole pixels.
 */
export function bandsFrom(canvas: Edges, views: Edges, rail: Edges): ViewBands {
  return {
    top: Math.max(0, Math.round(views.top - canvas.top)),
    bottom: Math.max(0, Math.round(canvas.bottom - views.bottom)),
    left: Math.max(0, Math.round(rail.right - canvas.left)),
  };
}

/**
 * Whether the chrome fits over one view (#5414): the tool rail, which gets
 * what the top chrome and the bottom block leave, shows every tool without
 * scrolling. When it does not, the views lose too much to the controls laid
 * over them, and the chrome takes bands as it does in four views. Read from
 * the rail itself rather than from a window size, so it follows the side panel,
 * the Script drawer and the text size alike.
 */
export function chromeFits(rail: {
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  // A pixel of slack, since a zoomed page rounds the two differently.
  return rail.scrollHeight <= rail.clientHeight + 1;
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
