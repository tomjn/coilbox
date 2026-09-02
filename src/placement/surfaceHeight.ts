/**
 * How tall the working area is (issue #2320): the drag handle's numbers, kept
 * pure and DOM-free so the bounds and the step are unit-testable.
 *
 * The card was a flat `h-[30rem]`, fine on an ordinary window and a letterbox
 * slot on a wide one, because width comes from the page and nothing here can
 * pick one ratio that suits both a laptop and an ultrawide. A drag handle on
 * the bottom edge answers that instead, and these are the numbers it moves
 * within.
 */

/** Settings-store key the height is remembered under (see `useSetting` in
 *  `PlacementSurface.tsx`). One key for every surface - the scenario map, the
 *  blueprint editor, the blueprint-on-map preview - because how tall someone
 *  likes to work is a preference about the person, not one per document. */
export const SURFACE_HEIGHT_KEY = "placement.surfaceHeight";

/** Unchanged from the card's old fixed height, so nobody's view moves until
 *  they touch the handle. */
export const DEFAULT_SURFACE_HEIGHT = 480;

/** Short enough that the corner controls - the bars top-left, the view
 *  controls and note bottom-right - still sit apart without touching, tall
 *  enough to leave a strip of ground between them worth calling a map. */
export const MIN_SURFACE_HEIGHT = 240;

/** Generous enough to show most of a 1080p window's content area, and finite
 *  enough that the panels stacked under the map on the scenario page stay a
 *  scroll away rather than being pushed off the bottom of a much shorter
 *  window. */
export const MAX_SURFACE_HEIGHT = 960;

/** One arrow-key press's worth of height: a visible jump, about one toolbar
 *  row, without overshooting a precise target, and about 23 steps end to end
 *  across the full range. */
export const SURFACE_HEIGHT_STEP = 32;

/** Keep a height on the range the handle and the keyboard both move within,
 *  rounded to a whole pixel. Applied on every read as well as every write, so
 *  a value stored before the bounds changed is still safe to render. */
export function clampSurfaceHeight(height: number): number {
  return Math.min(
    MAX_SURFACE_HEIGHT,
    Math.max(MIN_SURFACE_HEIGHT, Math.round(height)),
  );
}

/** The height `SURFACE_HEIGHT_STEP` further in `direction` - +1 down/taller,
 *  -1 up/shorter - bounded the same way a drag is. */
export function stepSurfaceHeight(height: number, direction: 1 | -1): number {
  return clampSurfaceHeight(height + direction * SURFACE_HEIGHT_STEP);
}
