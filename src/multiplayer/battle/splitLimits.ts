/**
 * How tall the battle room's members table is, and the rules for changing it.
 *
 * Pure, so the limits can be tested without a layout engine. The component
 * that draws the drag handle only measures the space and passes it in.
 *
 * The split is the table's height in pixels. The chat takes the rest of the
 * column, so a stored height from a tall window is clamped at render time and
 * comes back when the window does.
 */

/** The table's floor: the `min-h-24` (6rem) it has always had, a header and two rows. */
export const TABLE_MIN = 96;

/** The chat's floor when its real one cannot be read: `min-h-[22rem]` at a 16px root. */
export const CHAT_MIN_FALLBACK = 352;

/** The gap between the table and the chat, the column's `gap-4`. */
export const GAP = 16;

/** How far one arrow press moves the handle. */
export const KEY_STEP = 24;

/**
 * The tallest the table goes in a column with `available` pixels of content
 * height, leaving the chat its `chatMin`. Never below the table's minimum.
 */
export function maxHeight(available: number, chatMin: number): number {
  return Math.max(TABLE_MIN, Math.floor(available - GAP - chatMin));
}

/**
 * Bring `height` inside the limits for the space there is now.
 *
 * An `available` of 0 means the column has not been measured, so only the
 * minimum applies. A value that is not a finite number gives the minimum.
 */
export function clampHeight(
  height: number,
  available: number,
  chatMin: number,
): number {
  if (!Number.isFinite(height)) return TABLE_MIN;
  const floor = Math.max(height, TABLE_MIN);
  return available > 0 ? Math.min(floor, maxHeight(available, chatMin)) : floor;
}

/**
 * The height after a key press on the handle, or null for a key it does not use.
 *
 * The handle sits under the table, so the up arrow moves it up and shortens
 * the table.
 */
export function stepHeight(
  height: number,
  key: string,
  available: number,
  chatMin: number,
): number | null {
  switch (key) {
    case "ArrowUp":
      return clampHeight(height - KEY_STEP, available, chatMin);
    case "ArrowDown":
      return clampHeight(height + KEY_STEP, available, chatMin);
    case "Home":
      return TABLE_MIN;
    case "End":
      return maxHeight(available, chatMin);
    default:
      return null;
  }
}
