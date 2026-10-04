/**
 * How wide the channel member list is, and the rules for changing it.
 *
 * Pure, so the limits can be tested without a layout engine. The component
 * that draws the drag handle only measures the space and passes it in.
 */

/** The width before anyone drags it: the `w-56` (14rem) the list was fixed at. */
export const DEFAULT_WIDTH = 224;

/** The narrowest the list goes. Today's width, so a drag can only add room. */
export const MIN_WIDTH = 224;

/** The most of the page the list may take. The rest stays with the sidebar and the conversation. */
const MAX_SHARE = 0.5;

/** How far one arrow press moves the handle, the same step as the unit builder's. */
export const KEY_STEP = 24;

/** The widest the list goes in `available` pixels of page. Never below the minimum. */
export function maxWidth(available: number): number {
  return Math.max(MIN_WIDTH, Math.floor(available * MAX_SHARE));
}

/**
 * Bring `width` inside the limits for the space there is now.
 *
 * Applied each time the list is drawn, never written back, so a width chosen
 * in a large window comes back when the window does. An `available` of 0 means
 * the page has not been measured yet, so only the minimum applies. A stored
 * value that is not a finite number gives the default.
 */
export function clampWidth(width: number, available: number): number {
  if (!Number.isFinite(width)) return clampWidth(DEFAULT_WIDTH, available);
  const floor = Math.max(width, MIN_WIDTH);
  return available > 0 ? Math.min(floor, maxWidth(available)) : floor;
}

/**
 * The width after a key press on the handle, or null for a key it does not use.
 *
 * The handle is on the list's left edge, so the left arrow moves it left and
 * widens the list.
 */
export function stepWidth(
  width: number,
  key: string,
  available: number,
): number | null {
  switch (key) {
    case "ArrowLeft":
      return clampWidth(width + KEY_STEP, available);
    case "ArrowRight":
      return clampWidth(width - KEY_STEP, available);
    case "Home":
      return MIN_WIDTH;
    case "End":
      return maxWidth(available);
    default:
      return null;
  }
}

/** The width a double-click returns to. */
export function resetWidth(available: number): number {
  return clampWidth(DEFAULT_WIDTH, available);
}
