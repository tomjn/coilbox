/**
 * The windowing math for a long, uniform-height list: which rows a scrolled
 * container needs to have in the DOM, and where to scroll to put one of them
 * on screen.
 *
 * Written for the mission Lua code view (issue #2282), where a mission can be
 * thousands of lines and a DOM row per line is the cost that issue calls out.
 * The workshop's unit list has the same shape and the same problem (issue
 * #2709): Beyond All Reason has 564 units and every row carries a build
 * picture, so it was capped at 500 and 64 units could not be reached at all.
 *
 * Kept free of React and the DOM so the arithmetic is testable on its own,
 * without a real layout to measure against. Both callers pin their row height
 * with an inline style off the same constant they pass in here, so the maths
 * and the layout can never disagree about it.
 */

/** A half-open range of row indices to render: `[start, end)`. */
export interface RowWindow {
  start: number;
  end: number;
}

/**
 * The rows to render for a container scrolled to `scrollTop`, `viewportHeight`
 * tall, given every row is exactly `rowHeight` pixels. `overscan` extra rows
 * are included above and below so a fast scroll, or a jump to a row off
 * screen, does not show a blank flash while the next frame catches up.
 *
 * A `viewportHeight` of 0 means the container has not been measured yet - the
 * first paint, or an environment (a test) with no real layout - and in that
 * case every row is returned rather than none, since "not yet measured" is
 * not the same claim as "the viewport is zero pixels tall".
 */
export function visibleRowWindow(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  rowHeight: number,
  overscan: number,
): RowWindow {
  if (viewportHeight <= 0) return { start: 0, end: rowCount };
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(
    rowCount,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );
  return { start, end: Math.max(start, end) };
}

/** The `scrollTop` that puts `row` in the middle of the viewport, clamped so
 *  it never scrolls past either end of the content. */
export function scrollTopForRow(
  row: number,
  rowCount: number,
  viewportHeight: number,
  rowHeight: number,
): number {
  const target = row * rowHeight - viewportHeight / 2 + rowHeight / 2;
  const max = Math.max(0, rowCount * rowHeight - viewportHeight);
  return Math.min(max, Math.max(0, target));
}
