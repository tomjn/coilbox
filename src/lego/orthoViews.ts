/**
 * The front, side and top views: which way each camera looks and how much of
 * the scene an orthographic camera shows.
 *
 * Pure for the same reason as framing.ts. The viewport owns the cameras and
 * hands these functions numbers.
 *
 * An orthographic camera has no distance to zoom by. What it shows is set by
 * its visible height, so zoom here is `ORTHO_BASE_HEIGHT / visible height` and
 * framing a box is working out which height shows it.
 */

import { type Box3, FRAME_PADDING } from "./framing";
import type { Vec3 } from "./snapping";

export type StandardView = "front" | "side" | "top";

export interface ViewAxes {
  /** The direction from the orbit target to the camera. */
  toCamera: Vec3;
  /** Where the screen's right and up point in the world. */
  right: Vec3;
  up: Vec3;
}

/**
 * Straight down has no "up" for the camera to use, so the top view leans this
 * far (in the ratio of z to y) towards the front. That fixes which way is up on
 * screen. The lean is not visible: it is a hundredth of a degree.
 */
export const TOP_LEAN = 0.0001;

/**
 * The unit faces +z (docs/lego-builder.md, "Which way it faces"). The front
 * view looks from +z with +x to the right. The side view looks from the unit's
 * left, +x, so the front is on the left of the screen. The top view looks down
 * with the front at the bottom of the screen.
 */
export const STANDARD_VIEWS: Record<StandardView, ViewAxes> = {
  front: { toCamera: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  side: { toCamera: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  top: { toCamera: [0, 1, TOP_LEAN], right: [1, 0, 0], up: [0, 0, -1] },
};

/** The height an orthographic camera shows at zoom 1, in world units. */
export const ORTHO_BASE_HEIGHT = 100;

/** However small the box, a view shows at least this much height. */
const MIN_VIEW_HEIGHT = 1;

/** The height of world an orthographic camera shows at `zoom`. */
export function orthoVisibleHeight(zoom: number): number {
  return ORTHO_BASE_HEIGHT / Math.max(zoom, Number.EPSILON);
}

/**
 * The visible height that shows all of `box` as seen along `axes`, with the
 * same slack framing gives a perspective view. `aspect` is width over height,
 * since a wide box is limited by the width and a tall one by the height.
 */
export function orthoFitHeight(
  box: Box3,
  axes: ViewAxes,
  aspect: number,
): number {
  const size: Vec3 = [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ];
  const across = (axis: Vec3) =>
    Math.abs(axis[0]) * size[0] +
    Math.abs(axis[1]) * size[1] +
    Math.abs(axis[2]) * size[2];
  const height = Math.max(across(axes.up), across(axes.right) / aspect);
  return Math.max(height * FRAME_PADDING, MIN_VIEW_HEIGHT);
}

/**
 * The zoom range that matches a perspective camera's distance range: the same
 * closest and furthest view, expressed as a visible height.
 */
export function orthoZoomLimits(
  verticalFovRadians: number,
  minDistance: number,
  maxDistance: number,
): { minZoom: number; maxZoom: number } {
  const heightAt = (distance: number) =>
    2 * distance * Math.tan(verticalFovRadians / 2);
  return {
    minZoom: ORTHO_BASE_HEIGHT / heightAt(maxDistance),
    maxZoom: ORTHO_BASE_HEIGHT / heightAt(minDistance),
  };
}
