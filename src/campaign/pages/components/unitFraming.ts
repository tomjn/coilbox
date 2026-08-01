/**
 * Putting a unit model in frame, whatever shape the slot it is drawn in turns
 * out to be.
 *
 * A briefing draws the same model in two very different boxes: the panorama is
 * the whole window, wide and short, and the side graphic is a tall column beside
 * the briefing card. A camera distance worked out from the vertical field of
 * view alone fits the first and clips the second, because a perspective camera's
 * horizontal field of view narrows with the aspect ratio. So the distance is
 * taken from whichever of the two is tighter, and it is recomputed on resize
 * rather than once at build time.
 *
 * Kept out of the component because it is the part that can be wrong without
 * looking wrong until someone resizes the window.
 */

/** Leaves a little air around the model rather than fitting it exactly. */
const PADDING = 1.15;

/** The camera's direction from the model's centre, as a unit-ish vector.
 *
 * These models face +z and their left is +x, so this looks at the unit's front
 * quarter from slightly above: the angle a briefing screen would pose it at,
 * rather than head-on or from behind. */
export const UNIT_VIEW_DIRECTION: [number, number, number] = [0.55, 0.42, 1];

/**
 * How far from the model's centre a camera must sit for a model of this radius
 * to fit, at this vertical field of view and viewport aspect ratio.
 *
 * A degenerate viewport (zero width or height, which is what a hidden panel
 * reports) has no aspect to work from, so it falls back to the vertical fit.
 */
export function unitFitDistance(
  radius: number,
  verticalFovRadians: number,
  aspect: number,
): number {
  const half = verticalFovRadians / 2;
  const horizontal =
    Number.isFinite(aspect) && aspect > 0
      ? Math.atan(Math.tan(half) * aspect)
      : half;
  return (
    (PADDING * Math.max(radius, 0.001)) / Math.sin(Math.min(half, horizontal))
  );
}
