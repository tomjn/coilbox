/**
 * The ground a layout is drawn on when there is no map (issue #1416).
 *
 * A blueprint is not made for one map, so the editor that draws one must not
 * need a map to open. What it stands on instead is a plain square of flat
 * ground: no relief to read, no archive to scan, no engine to scan it with, and
 * nothing on screen that belongs to a place. Checking a layout against real
 * terrain is a separate, optional step and it is
 * https://github.com/tomjn/coilbox/issues/1315.
 *
 * Everything here is arithmetic on plain values, so it can be tested without a
 * GPU. The three.js half is `GridScene.tsx`.
 */

import { BUILD_SQUARE } from "@/blueprint/footprint";
import type { Point } from "@/scenario/model";

/**
 * How much ground the map-free surface offers, in elmos.
 *
 * A whole number of build squares, so the grid it is drawn with meets the edge
 * on a line rather than part way through a square. Four kilometres is more room
 * than any base needs and small enough that a layout dropped in the middle of
 * it is still findable.
 */
export const GRID_EXTENT = 4096;

/** Where a layout put down on that ground stands, which is the middle of it, so
 *  a base can grow in every direction from where it started. */
export const GRID_ORIGIN: Point = {
  x: GRID_EXTENT / 2,
  z: GRID_EXTENT / 2,
};

/** What a flat ground reports about itself, in the shape the drawing already
 *  asks a map for. `flat` is what says there is no heightmap to wait for. */
export interface FlatGround {
  flat: true;
  heightSrc?: undefined;
  minHeight: number;
  maxHeight: number;
  worldWidth: number;
  worldHeight: number;
}

export function gridGround(extent = GRID_EXTENT): FlatGround {
  return {
    flat: true,
    minHeight: 0,
    maxHeight: 0,
    worldWidth: extent,
    worldHeight: extent,
  };
}

/**
 * The smallest a layout is framed as, in elmos.
 *
 * A layout of one building has no extent, and a camera taken to its exact size
 * would arrive inside it. Ten build squares is a building with room around it,
 * which is what somebody who opened a one-building layout wants to see.
 */
export const MIN_FRAME_SPAN = BUILD_SQUARE * 10;

/**
 * Where the camera should look to see a whole layout, and how wide that is.
 *
 * The middle of the bounding box rather than the layout's origin, because a
 * layout drawn out in one direction has its origin at one end of itself and
 * arriving there puts half of it off screen.
 */
export function layoutFraming(
  points: Point[],
  fallback: Point,
): { centre: Point; span: number } {
  if (points.length === 0) return { centre: fallback, span: MIN_FRAME_SPAN };
  let minX = points[0].x;
  let maxX = points[0].x;
  let minZ = points[0].z;
  let maxZ = points[0].z;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return {
    centre: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    span: Math.max(MIN_FRAME_SPAN, maxX - minX, maxZ - minZ),
  };
}
