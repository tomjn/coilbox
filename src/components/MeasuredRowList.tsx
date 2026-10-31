import type { ReactNode } from "react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  measuredRowWindow,
  rowOffsets,
  scrollCorrection,
} from "@/lib/measuredRows";
import type { RowWindow } from "@/lib/rowVirtualize";

const CONTENT_SCROLL = "[data-slot='content-scroll']";

/** How far the top of the viewport is past the top of the list, in pixels. */
const viewTopOf = (list: Element, scroller: Element) =>
  scroller.getBoundingClientRect().top +
  scroller.clientTop -
  list.getBoundingClientRect().top;

/**
 * Keeps only the rows in or near the viewport in the page, for a list that
 * scrolls with the page in the app shell's content area and whose rows differ in
 * height (issue #3828). Rows are measured once they mount, and stay in normal
 * flow with the skipped rows held open by margins, so two rows can never overlap.
 *
 * One viewport of rows is kept above and below, since a wheel notch or Page Down
 * moves at most that far and the next rows are then ready before the scroll event.
 *
 * The row holding focus stays mounted when it leaves the window, along with its
 * neighbours, so a popover opened from it stays open and Tab reaches the next row.
 */
export function MeasuredRowList<T>({
  items,
  rowKey,
  renderRow,
  estimatedRowHeight,
  gap,
  className,
  rowClassName,
}: {
  items: readonly T[];
  rowKey: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  /** The height of a row before it has been measured, in pixels. */
  estimatedRowHeight: number;
  /** The gap `className` sets between rows, in pixels. */
  gap: number;
  className?: string;
  rowClassName?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const heights = useRef(new Map<string, number>());
  const pendingScroll = useRef(0);
  const focusFromRow = useRef(false);
  // Bumped when a measurement changes, as `heights` is a ref to spare a copy.
  const [measureCount, setMeasureCount] = useState(0);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const keys = useMemo(() => items.map(rowKey), [items, rowKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measureCount says `heights` changed
  const offsets = useMemo(
    () => rowOffsets(keys, heights.current, estimatedRowHeight, gap),
    [keys, measureCount, estimatedRowHeight, gap],
  );

  // The scroller cannot be read until the list is in the page, so the first
  // render assumes the window's height, which keeps a cold mount of thousands of
  // rows from building them all. The layout effect corrects it before paint.
  const [range, setRange] = useState<RowWindow>(() =>
    measuredRowWindow(offsets, 0, window.innerHeight, window.innerHeight),
  );

  const updateRange = () => {
    const list = listRef.current;
    const scroller = list?.closest(CONTENT_SCROLL);
    if (!list || !scroller) {
      // Nothing scrolls this list, so no row could ever be brought into view.
      setRange((r) =>
        r.start === 0 && r.end === keys.length
          ? r
          : { start: 0, end: keys.length },
      );
      return;
    }
    const viewHeight = scroller.clientHeight;
    // Zero means hidden or not laid out, which says nothing about the window.
    if (viewHeight <= 0) return;
    const next = measuredRowWindow(
      offsets,
      viewTopOf(list, scroller),
      viewHeight,
      viewHeight,
    );
    setRange((r) => (r.start === next.start && r.end === next.end ? r : next));
  };

  const measure = () => {
    const list = listRef.current;
    if (!list) return;
    const measured: { index: number; growth: number }[] = [];
    for (const row of list.children) {
      const index = Number((row as HTMLElement).dataset.rowIndex);
      const key = keys[index];
      if (key === undefined) continue;
      const height = row.getBoundingClientRect().height;
      const known = heights.current.get(key);
      // Zero means hidden or not laid out, which is not the row's height.
      if (height <= 0 || height === known) continue;
      heights.current.set(key, height);
      measured.push({
        index,
        growth: height - (known ?? estimatedRowHeight),
      });
    }
    if (measured.length === 0) return;
    const scroller = list.closest(CONTENT_SCROLL);
    if (scroller) {
      pendingScroll.current += scrollCorrection(
        offsets,
        gap,
        viewTopOf(list, scroller),
        measured,
      );
    }
    setMeasureCount((n) => n + 1);
  };

  // The listeners outlive any one render, so they call the latest closures.
  const latest = useRef({ measure, updateRange });

  // Runs after every render, because a new list, a new window or a filter bar
  // that wrapped onto another line can each move the rows.
  useLayoutEffect(() => {
    latest.current = { measure, updateRange };
    const list = listRef.current;
    const scroller = list?.closest(CONTENT_SCROLL);
    // Waits for the render that applied the new heights, so the browser does not
    // clamp this against a page that is still its old height.
    if (scroller && pendingScroll.current !== 0) {
      scroller.scrollTop += pendingScroll.current;
      pendingScroll.current = 0;
    }
    measure();
    updateRange();
  });

  useEffect(() => {
    const list = listRef.current;
    const scroller = list?.closest(CONTENT_SCROLL);
    if (!list || !scroller) return;
    const onScroll = () => latest.current.updateRange();
    const observer = new ResizeObserver(() => {
      latest.current.measure();
      latest.current.updateRange();
    });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(scroller);
    observer.observe(list);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  // React sends focus inside a popover's portal through the row that opened it,
  // and that runs before this listener. So focus that did not come through a row
  // has left the list, and no row needs holding on to.
  useEffect(() => {
    const onFocusIn = () => {
      if (!focusFromRow.current) setFocusedKey(null);
      focusFromRow.current = false;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  const onRowFocus = useCallback((key: string) => {
    focusFromRow.current = true;
    setFocusedKey(key);
  }, []);

  const rendered = useMemo(() => {
    // A filter can leave fewer rows than the old window started at. The last row
    // keeps the list at its full height until the window catches up, because an
    // empty list would let the browser reset the scroll position.
    const start = Math.min(range.start, Math.max(0, keys.length - 1));
    const end = Math.min(Math.max(range.end, start + 1), keys.length);
    const indices = new Set<number>();
    for (let i = start; i < end; i++) indices.add(i);
    const focused = focusedKey === null ? -1 : keys.indexOf(focusedKey);
    if (focused >= 0) {
      for (let i = focused - 1; i <= focused + 1; i++) {
        if (i >= 0 && i < keys.length) indices.add(i);
      }
    }
    return [...indices].sort((a, b) => a - b);
  }, [range, keys, focusedKey]);

  const last = rendered[rendered.length - 1];
  return (
    <ul
      ref={listRef}
      className={className}
      // We correct the scroll position ourselves, and WebKit has no anchoring,
      // so a webview that does would otherwise move it twice.
      style={{
        overflowAnchor: "none",
        paddingBottom:
          last === undefined
            ? 0
            : (offsets[keys.length] ?? 0) - (offsets[last + 1] ?? 0),
      }}
    >
      {rendered.map((index, i) => {
        const before = rendered[i - 1];
        const flowTop = before === undefined ? 0 : (offsets[before + 1] ?? 0);
        return (
          <MemoRow
            key={keys[index]}
            item={items[index] as T}
            itemKey={keys[index] as string}
            index={index}
            count={keys.length}
            marginTop={(offsets[index] ?? 0) - flowTop}
            className={rowClassName}
            renderRow={renderRow}
            onFocusRow={onRowFocus}
          />
        );
      })}
    </ul>
  );
}

function Row<T>({
  item,
  itemKey,
  index,
  count,
  marginTop,
  className,
  renderRow,
  onFocusRow,
}: {
  item: T;
  itemKey: string;
  index: number;
  count: number;
  marginTop: number;
  className?: string;
  renderRow: (item: T) => ReactNode;
  onFocusRow: (key: string) => void;
}) {
  return (
    <li
      data-row-index={index}
      aria-posinset={index + 1}
      aria-setsize={count}
      className={className}
      style={marginTop === 0 ? undefined : { marginTop }}
      onFocus={() => onFocusRow(itemKey)}
    >
      {renderRow(item)}
    </li>
  );
}

// Scrolling re-renders the list and not the page, so `renderRow` is the same
// function and the rows already on screen skip their work.
const MemoRow = memo(Row) as typeof Row;
