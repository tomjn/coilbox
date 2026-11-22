/**
 * The handle between two panels, dragged to trade space between them. Used
 * for the drawer under the model view, for the side panel's width and for the
 * split between the piece tree and the details under it.
 *
 * It measures the column or row the two share rather than the window, so the
 * clamp holds while panels open and close and while the window resizes. A
 * stored size from a larger window is brought in by the same measurement on
 * the first frame.
 *
 * It is a real separator, not a div with a cursor: arrows move it, Home and
 * End take it to its ends, and a screen reader reads the size out. Horizontal
 * is the line above a panel, moved by the up and down arrows. Vertical is the
 * line beside one, moved by the left and right arrows. Either way the panel
 * grows as the handle moves away from it.
 *
 * It lies along the panel's whole edge, over the border rather than in the
 * row below it, which is where a resizable pane puts its divider and where
 * the pointer goes looking for one. Out of the layout entirely, so it costs
 * no space and does not move when the tabs change what is in the row. The
 * 10px band is the part you can grab, and the line only shows once the
 * pointer is on it. The panel it sits on must be `relative`.
 */

import { t } from "@lingui/core/macro";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  clampPanelHeight,
  MIN_PANEL_HEIGHT,
  maxPanelHeight,
  visibleWidth,
} from "../../panels";

/** How far one arrow press moves the handle. */
const STEP = 24;

interface Props {
  /** The panel's height, or its width for a vertical handle. */
  height: number;
  onHeight: (height: number) => void;
  /** The column the panel and what it trades with share, or the row for a
   *  vertical handle. */
  columnRef: RefObject<HTMLDivElement | null>;
  /** The id of the panel this resizes, for `aria-controls`. */
  controls: string;
  /** Horizontal by default: the line above a panel. */
  orientation?: "horizontal" | "vertical";
  /** What a screen reader calls the handle. */
  label?: string;
  /** The smallest size, the largest for the space shared, and the clamp that
   *  holds a size between them. The drawer's own by default. */
  min?: number;
  max?: (available: number) => number;
  clamp?: (size: number, available: number) => number;
}

export function StripResizer({
  height,
  onHeight,
  columnRef,
  controls,
  orientation = "horizontal",
  label = t`Resize this panel`,
  min = MIN_PANEL_HEIGHT,
  max = maxPanelHeight,
  clamp = clampPanelHeight,
}: Props) {
  const vertical = orientation === "vertical";
  const [available, setAvailable] = useState(0);

  // Read through a ref: the measurement runs on a resize rather than on a
  // render, so it must not close over the render that set it up.
  const latest = useRef({ height, onHeight });
  latest.current = { height, onHeight };

  useEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    // Not `fit`: Biome reads a call to that as a focused test.
    const measure = () => {
      const space = vertical
        ? visibleWidth(
            column.clientWidth,
            column.getBoundingClientRect().left,
            window.innerWidth,
          )
        : column.clientHeight;
      setAvailable(space);
      if (space === 0) return;
      // A height stored in a taller window, or left behind by this one being
      // dragged smaller, brought back inside what can be shown.
      const inside = clamp(latest.current.height, space);
      if (inside !== latest.current.height) latest.current.onHeight(inside);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    measure();
    return () => observer.disconnect();
  }, [columnRef, vertical, clamp]);

  // Where the pointer went down and how tall the drawer was then, so a drag
  // tracks the pointer instead of accumulating rounding from each move.
  const start = useRef<{ at: number; height: number } | null>(null);

  const most = max(available);

  // Nothing to clamp against until the column has been measured, which is the
  // first render only.
  function move(to: number) {
    if (available > 0) onHeight(clamp(to, available));
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> is void, so it can carry neither the grip nor the drag
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={height}
      aria-valuemin={min}
      aria-valuemax={most}
      tabIndex={0}
      className={
        vertical
          ? "group absolute inset-y-0 left-0 z-10 flex w-2.5 cursor-col-resize justify-start focus-visible:outline-none"
          : "group absolute inset-x-0 -top-1 z-10 flex h-2.5 cursor-row-resize items-center focus-visible:outline-none"
      }
      onPointerDown={(event) => {
        event.preventDefault();
        start.current = {
          at: vertical ? event.clientX : event.clientY,
          height,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        move(
          start.current.height +
            (start.current.at - (vertical ? event.clientX : event.clientY)),
        );
      }}
      onPointerUp={(event) => {
        start.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onKeyDown={(event) => {
        const grow = vertical ? "ArrowLeft" : "ArrowUp";
        const shrink = vertical ? "ArrowRight" : "ArrowDown";
        if (event.key === grow) move(height + STEP);
        else if (event.key === shrink) move(height - STEP);
        else if (event.key === "Home") move(min);
        else if (event.key === "End") move(most);
        else return;
        event.preventDefault();
      }}
    >
      {/* Nothing until the pointer is on it: the drawer's own top border is
        already a line, and a second one over it reads as a seam. */}
      <span
        className={
          vertical
            ? "h-full w-0.5 bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring"
            : "h-0.5 w-full bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring"
        }
      />
    </div>
  );
}
