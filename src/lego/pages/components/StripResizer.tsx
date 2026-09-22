/**
 * The handle between the model view and the drawer under it, dragged to trade
 * one for the other.
 *
 * It measures the column the two share rather than the window, so the clamp
 * holds while the side panel opens and closes and while the window resizes.
 * A stored height from a taller window is brought in by the same measurement
 * on the first frame.
 *
 * It is a real separator, not a div with a cursor: arrows move it, Home and
 * End take it to its ends, and a screen reader reads the height out.
 *
 * It lies along the drawer's whole top edge, over the border rather than in
 * the row below it, which is where a resizable pane puts its divider and
 * where the pointer goes looking for one. Out of the layout entirely, so it
 * costs no height and does not move when the tabs change what is in the row.
 * The 10px band is the part you can grab, and the line only shows once the
 * pointer is on it.
 */

import { type RefObject, useEffect, useRef, useState } from "react";
import {
  clampPanelHeight,
  MIN_PANEL_HEIGHT,
  maxPanelHeight,
} from "../../panels";

/** How far one arrow press moves the handle. */
const STEP = 24;

interface Props {
  height: number;
  onHeight: (height: number) => void;
  /** The column the drawer and the model view share. */
  columnRef: RefObject<HTMLDivElement | null>;
  /** The id of the drawer this resizes, for `aria-controls`. */
  controls: string;
}

export function StripResizer({ height, onHeight, columnRef, controls }: Props) {
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
      const space = column.clientHeight;
      setAvailable(space);
      if (space === 0) return;
      // A height stored in a taller window, or left behind by this one being
      // dragged smaller, brought back inside what can be shown.
      const inside = clampPanelHeight(latest.current.height, space);
      if (inside !== latest.current.height) latest.current.onHeight(inside);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    measure();
    return () => observer.disconnect();
  }, [columnRef]);

  // Where the pointer went down and how tall the drawer was then, so a drag
  // tracks the pointer instead of accumulating rounding from each move.
  const start = useRef<{ y: number; height: number } | null>(null);

  const most = maxPanelHeight(available);

  // Nothing to clamp against until the column has been measured, which is the
  // first render only.
  function move(to: number) {
    if (available > 0) onHeight(clampPanelHeight(to, available));
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> is void, so it can carry neither the grip nor the drag
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize this panel"
      aria-controls={controls}
      aria-valuenow={height}
      aria-valuemin={MIN_PANEL_HEIGHT}
      aria-valuemax={most}
      tabIndex={0}
      className="group absolute inset-x-0 -top-1 z-10 flex h-2.5 cursor-row-resize items-center focus-visible:outline-none"
      onPointerDown={(event) => {
        event.preventDefault();
        start.current = { y: event.clientY, height };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        move(start.current.height + (start.current.y - event.clientY));
      }}
      onPointerUp={(event) => {
        start.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") move(height + STEP);
        else if (event.key === "ArrowDown") move(height - STEP);
        else if (event.key === "Home") move(MIN_PANEL_HEIGHT);
        else if (event.key === "End") move(most);
        else return;
        event.preventDefault();
      }}
    >
      {/* Nothing until the pointer is on it: the drawer's own top border is
        already a line, and a second one over it reads as a seam. */}
      <span className="h-0.5 w-full bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring" />
    </div>
  );
}
