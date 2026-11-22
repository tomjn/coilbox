/**
 * Where the axis compass puts the ends of the three axes, for a camera.
 *
 * Pure, so the nudging that keeps the ends clear of the middle button is
 * testable without a page. Positions are in pixels from the compass's top left.
 */

import type { StandardView } from "../../orthoViews";

export const COMPASS_SIZE = 112;
export const COMPASS_MID = COMPASS_SIZE / 2;
/** How far from the middle an axis end sits when the axis lies in the screen. */
const ARM = 42;
/** The nearest an end may sit to the middle, so it clears the reset button. */
const MIN_RADIUS = 24;
/** An axis pointing this close to the camera, in pixels, has no direction on
 *  screen worth following. */
const ALIGNED = 2;

export const AXES = ["x", "y", "z"] as const;
export type Axis = (typeof AXES)[number];

export interface CompassEnd {
  id: `${Axis}${"+" | "-"}`;
  axis: Axis;
  sign: 1 | -1;
  /** The standard view that looks from this end. */
  view: StandardView;
}

/** The six ends in tab order: each axis's positive end, then its negative. */
export const COMPASS_ENDS: CompassEnd[] = [
  { id: "x+", axis: "x", sign: 1, view: "side" },
  { id: "x-", axis: "x", sign: -1, view: "otherSide" },
  { id: "y+", axis: "y", sign: 1, view: "top" },
  { id: "y-", axis: "y", sign: -1, view: "bottom" },
  { id: "z+", axis: "z", sign: 1, view: "front" },
  { id: "z-", axis: "z", sign: -1, view: "back" },
];

export interface PlacedEnd {
  id: CompassEnd["id"];
  x: number;
  y: number;
  /** 0 for an end pointing away from the camera, 1 for one pointing at it. */
  towards: number;
}

/**
 * Place every end. `seen` is each world axis in camera space: x to the right,
 * y up, z towards the camera.
 *
 * An axis that points at or away from the camera lands on the middle, where it
 * would sit under the reset button and, with its opposite end, under each
 * other. Such an end is moved out to the minimum radius, along the diagonal
 * for a positive end and the other way for a negative one, which no other axis
 * lies on in a standard view.
 */
export function compassEnds(
  seen: Record<Axis, [number, number, number]>,
): PlacedEnd[] {
  return COMPASS_ENDS.map(({ id, axis, sign }) => {
    const [cx, cy, cz] = seen[axis];
    // Screen y grows downward, so the camera-space y is negated.
    let x = sign * cx * ARM;
    let y = -sign * cy * ARM;
    const length = Math.hypot(x, y);
    if (length < MIN_RADIUS) {
      const [dx, dy] =
        length < ALIGNED
          ? [sign * Math.SQRT1_2, sign * Math.SQRT1_2]
          : [x / length, y / length];
      x = dx * MIN_RADIUS;
      y = dy * MIN_RADIUS;
    }
    return {
      id,
      x: COMPASS_MID + x,
      y: COMPASS_MID + y,
      towards: (sign * cz + 1) / 2,
    };
  });
}
