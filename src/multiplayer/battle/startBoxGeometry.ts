import type { StartRect } from "../bindings";

/**
 * Freeform start-box geometry on the lobby's 0..200 grid (200 = full map) — the
 * inverse of `StartBoxOverlay`'s `pct()`. Pure so the interactive editor's
 * pointer→grid math is unit-testable without a DOM. `StartRect` is the wire shape
 * (`left/top/right/bottom` ints); a `Point` is one grid coordinate.
 */
export const GRID = 200;

/**
 * Smallest allowed box edge on the grid. Guards against zero/paper-thin rects the
 * engine and SPADS's `!addbox` (left<=right, top<=bottom) dislike, and lets a
 * stray click (near-zero drag) be discarded rather than committed as a dot.
 */
export const MIN_BOX = 4;

export interface Point {
  x: number;
  y: number;
}

/** Which sides a resize gesture moves. */
export type Edge = "left" | "right" | "top" | "bottom";

/** Round + clamp a value onto the 0..GRID grid. */
export const clampGrid = (v: number): number =>
  Math.max(0, Math.min(GRID, Math.round(v)));

/**
 * Map a pointer offset within the minimap box to the 0..GRID grid. `offset` is
 * pointer-minus-rect-origin px and `size` the rect's px extent (the horizontal or
 * vertical pair). A zero-size box yields 0.
 */
export const pxToGrid = (offset: number, size: number): number =>
  size > 0 ? clampGrid((offset / size) * GRID) : 0;

/** Order a box's edges so left<=right and top<=bottom (inputs already clamped). */
export const normaliseBox = (b: StartRect): StartRect => ({
  left: Math.min(b.left, b.right),
  top: Math.min(b.top, b.bottom),
  right: Math.max(b.left, b.right),
  bottom: Math.max(b.top, b.bottom),
});

/** A box spanning two grid points (create/drag preview), edges unordered. */
export const boxFromPoints = (a: Point, b: Point): StartRect => ({
  left: a.x,
  top: a.y,
  right: b.x,
  bottom: b.y,
});

/**
 * Translate a box by a grid delta, clamping so it stays fully on the grid without
 * changing size (move gesture).
 */
export function moveBox(b: StartRect, dx: number, dy: number): StartRect {
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  const left = Math.max(0, Math.min(GRID - w, b.left + dx));
  const top = Math.max(0, Math.min(GRID - h, b.top + dy));
  return { left, top, right: left + w, bottom: top + h };
}

/** Move the given `edges` of a box to a grid point (resize gesture, unordered). */
export function resizeBox(b: StartRect, edges: Edge[], p: Point): StartRect {
  return {
    left: edges.includes("left") ? p.x : b.left,
    right: edges.includes("right") ? p.x : b.right,
    top: edges.includes("top") ? p.y : b.top,
    bottom: edges.includes("bottom") ? p.y : b.bottom,
  };
}

/**
 * Prepare a dragged box for commit: order its edges and reject it (null) if either
 * dimension is below MIN_BOX — so accidental clicks and collapsed resizes don't
 * send a degenerate rect.
 */
export function finaliseBox(b: StartRect): StartRect | null {
  const n = normaliseBox(b);
  if (n.right - n.left < MIN_BOX || n.bottom - n.top < MIN_BOX) return null;
  return n;
}
