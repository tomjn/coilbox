/**
 * The windowing math for a long list whose rows differ in height, which
 * `rowVirtualize.ts` cannot do: it assumes every row is the same. A replay row
 * grows with a game type line or tags (issue #3828).
 *
 * Kept free of React and the DOM, like `rowVirtualize.ts`, so the arithmetic is
 * testable without a real layout to measure against.
 */
import type { RowWindow } from "./rowVirtualize";

/**
 * Where each row starts, measured from the top of the list. Entry `i` is the
 * top of row `i`, and the extra last entry is where one more row would start. A
 * row not measured yet counts as `estimate` tall.
 */
export function rowOffsets(
  keys: readonly string[],
  heights: ReadonlyMap<string, number>,
  estimate: number,
  gap: number,
): Float64Array {
  const offsets = new Float64Array(keys.length + 1);
  keys.forEach((key, i) => {
    offsets[i + 1] = (offsets[i] ?? 0) + (heights.get(key) ?? estimate) + gap;
  });
  return offsets;
}

/** The index of the last entry at or before `y`, 0 if there is none. */
function lastOffsetAtOrBefore(offsets: Float64Array, y: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((offsets[mid] ?? 0) <= y) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * The rows to render when the top of the viewport is `viewTop` pixels past the
 * top of the list, which is negative while the list starts below the top of the
 * viewport. `overscan` is in pixels and applies above and below.
 *
 * `viewTop` is clamped to the end of the list, because a filter that shortens
 * the list leaves the scroll position past its end until the browser catches up,
 * and a window past the end is an empty list.
 */
export function measuredRowWindow(
  offsets: Float64Array,
  viewTop: number,
  viewHeight: number,
  overscan: number,
): RowWindow {
  const rowCount = offsets.length - 1;
  if (rowCount <= 0) return { start: 0, end: 0 };
  const listEnd = offsets[rowCount] ?? 0;
  const top = Math.min(viewTop, Math.max(0, listEnd - viewHeight));
  const start = Math.min(
    rowCount - 1,
    lastOffsetAtOrBefore(offsets, top - overscan),
  );
  const end = lastOffsetAtOrBefore(offsets, top + viewHeight + overscan) + 1;
  return { start, end: Math.min(rowCount, end) };
}

/**
 * How far to move the scroll position so the rows on screen stay where they are
 * after measuring. It is the growth of every newly measured row that ended above
 * the viewport, since only those push the visible rows down.
 */
export function scrollCorrection(
  offsets: Float64Array,
  gap: number,
  viewTop: number,
  measured: readonly { index: number; growth: number }[],
): number {
  let correction = 0;
  for (const { index, growth } of measured) {
    const rowBottom = (offsets[index + 1] ?? 0) - gap;
    if (rowBottom <= viewTop) correction += growth;
  }
  return correction;
}
