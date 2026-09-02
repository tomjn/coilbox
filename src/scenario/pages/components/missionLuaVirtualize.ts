/**
 * The line-windowing math for the mission Lua code view (issue #2282): a
 * mission can be thousands of lines, and mounting a DOM row per line for all
 * of them is the thing the issue calls out as possibly slow, so only the
 * lines actually in view (plus a buffer either side, for smooth scrolling)
 * are rendered. Kept free of React and the DOM so the arithmetic is testable
 * on its own, without a real layout to measure against.
 */

/** A half-open range of line indices to render: `[start, end)`. */
export interface LineWindow {
  start: number;
  end: number;
}

/**
 * The lines to render for a container scrolled to `scrollTop`, `viewportHeight`
 * tall, given every line is exactly `lineHeight` pixels. `overscan` extra
 * lines are included above and below so a fast scroll or a jump to a find
 * match does not show a blank flash while the next frame catches up.
 *
 * A `viewportHeight` of 0 means the container has not been measured yet - the
 * first paint, or an environment (a test) with no real layout - and in that
 * case every line is returned rather than none, since "not yet measured" is
 * not the same claim as "the viewport is zero pixels tall".
 */
export function visibleLineWindow(
  scrollTop: number,
  viewportHeight: number,
  lineCount: number,
  lineHeight: number,
  overscan: number,
): LineWindow {
  if (viewportHeight <= 0) return { start: 0, end: lineCount };
  const start = Math.max(0, Math.floor(scrollTop / lineHeight) - overscan);
  const end = Math.min(
    lineCount,
    Math.ceil((scrollTop + viewportHeight) / lineHeight) + overscan,
  );
  return { start, end: Math.max(start, end) };
}

/** The `scrollTop` that puts `line` in the middle of the viewport, clamped so
 *  it never scrolls past either end of the content. */
export function scrollTopForLine(
  line: number,
  lineCount: number,
  viewportHeight: number,
  lineHeight: number,
): number {
  const target = line * lineHeight - viewportHeight / 2 + lineHeight / 2;
  const max = Math.max(0, lineCount * lineHeight - viewportHeight);
  return Math.min(max, Math.max(0, target));
}
