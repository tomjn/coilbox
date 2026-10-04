/**
 * The drag handle on the member list's left edge.
 *
 * Written for a vertical edge rather than taken from the unit builder's
 * `StripResizer`, which is a horizontal handle built on that drawer's own
 * height limits and measurement.
 *
 * It is a real separator: the arrow keys, Home and End move it, a double-click
 * resets it, and a screen reader reads the width out. It lies over the border
 * rather than in the layout, so it costs no width. The 10px band is the part
 * you can grab, and the line only shows once the pointer is on it.
 */

import { useRef } from "react";
import {
  clampWidth,
  MIN_WIDTH,
  maxWidth,
  resetWidth,
  stepWidth,
} from "./memberListWidth";

interface Props {
  /** The width the list is drawn at now, already inside the limits. */
  width: number;
  /** The space the limits are measured against. 0 until measured. */
  available: number;
  /**
   * A new width. `final` is false while a drag is in progress and true when it
   * ends, and for a key press or a double-click, so the caller can keep a
   * drag out of storage until it is done.
   */
  onChange: (width: number, final: boolean) => void;
  /** The id of the list this resizes, for `aria-controls`. */
  controls: string;
}

export function MemberListResizer({
  width,
  available,
  onChange,
  controls,
}: Props) {
  // Where the pointer went down and how wide the list was then, so a drag
  // tracks the pointer instead of accumulating rounding from each move.
  const start = useRef<{ x: number; width: number } | null>(null);
  const latest = useRef(width);

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> is void, so it can carry neither the grip nor the drag
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the member list"
      aria-controls={controls}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maxWidth(available)}
      tabIndex={0}
      className="group absolute inset-y-0 -left-1 z-10 flex w-2.5 cursor-col-resize justify-center focus-visible:outline-none"
      onPointerDown={(event) => {
        event.preventDefault();
        start.current = { x: event.clientX, width };
        latest.current = width;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        // The list is on the right, so moving left makes it wider.
        latest.current = clampWidth(
          start.current.width + (start.current.x - event.clientX),
          available,
        );
        onChange(latest.current, false);
      }}
      onPointerUp={(event) => {
        if (!start.current) return;
        start.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onChange(latest.current, true);
      }}
      onPointerCancel={() => {
        if (!start.current) return;
        start.current = null;
        onChange(latest.current, true);
      }}
      onDoubleClick={() => onChange(resetWidth(available), true)}
      onKeyDown={(event) => {
        const next = stepWidth(width, event.key, available);
        if (next === null) return;
        event.preventDefault();
        onChange(next, true);
      }}
    >
      {/* Nothing until the pointer is on it: the list's own border is already
        a line, and a second one over it reads as a seam. */}
      <span className="h-full w-0.5 bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring" />
    </div>
  );
}
