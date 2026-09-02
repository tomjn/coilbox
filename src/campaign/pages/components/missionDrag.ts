/**
 * Dragging a mission row to a new position in the campaign editor's list
 * (issue #2262).
 *
 * Moving mission 2 to position 9 was seven clicks on an arrow button, so this
 * adds the gesture everyone reaches for first. The arrow buttons are untouched:
 * they carry the aria-labels, they are in the tab order, and they are the only
 * reorder path that works without a pointer. A drag can never be that path, so
 * this is an addition to them and the handle is hidden from a screen reader.
 *
 * Pointer events rather than HTML5 drag and drop, for the reason the piece tree
 * gives (`src/lego/pages/components/PieceTree.tsx`): the app keeps Tauri's
 * native file drop switched on, because the COB and map pages take files that
 * way, and that stops HTML5 drag events reaching the webview on Windows.
 * Pointer events also cover a trackpad and a touch screen without a second
 * code path.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** How far the pointer moves before a press on a handle counts as a drag.
 *  The piece tree's figure, so the two gestures start alike. */
const DRAG_THRESHOLD = 4;

/** How close to the top or bottom of the scrolling page a drag has to get
 *  before the page starts following it, and how far it then scrolls per
 *  animation frame, both in CSS pixels. Chosen by dragging the real list and
 *  not by measuring anything: the zone has to be deep enough to fall into
 *  without aiming, and shallow enough that the middle of a mission card is
 *  never inside it. */
const EDGE_ZONE = 64;
const EDGE_SPEED = 14;

export interface MissionDrag {
  /** The row being carried. */
  from: number;
  /** Where it would land: the gap above row `gap`, or after the last row when
   *  `gap` is the number of rows. */
  gap: number;
}

/** The gap a pointer at `y` is nearest, given each row's box in viewport
 *  coordinates. Above a row's midpoint means the gap before it, so the whole
 *  list including the space between cards resolves to somewhere to land. */
export function gapAt(rows: DOMRect[], y: number): number {
  const i = rows.findIndex((row) => y < row.top + row.height / 2);
  return i === -1 ? rows.length : i;
}

/** The index the carried mission ends up at, once it has been lifted out of
 *  the list and the gaps below it have closed up by one. */
export function dropIndex(drag: MissionDrag): number {
  return drag.gap > drag.from ? drag.gap - 1 : drag.gap;
}

/**
 * Reordering by dragging a row's handle.
 *
 * The list this is spread onto is expected to give every mission row a
 * `data-mission-row` attribute holding its index, and to mark the one part of
 * a row that starts a drag with `data-drag-handle`. Anything else pressed is
 * left alone, which is what keeps a press on an arrow button or on Remove
 * from turning into a drag.
 *
 * `onDrop` is handed the row that moved and where it landed, and is expected
 * to be the same reorder the arrow buttons call, so there is one write path
 * and not two.
 */
export function useMissionDrag(onDrop: (from: number, to: number) => void) {
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<MissionDrag | null>(null);
  // Where the press started, and which row it started on. Held in a ref rather
  // than state because a press that never moves far enough is not a drag and
  // must not render anything.
  const pressed = useRef<{ from: number; x: number; y: number } | null>(null);
  // The last position reported, for the frames the auto-scroll runs on when
  // the pointer is held still inside the edge zone.
  const pointerY = useRef(0);

  const showDrag = useCallback((from: number, y: number) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll("[data-mission-row]") ?? [],
      (row) => row.getBoundingClientRect(),
    );
    setDrag({ from, gap: gapAt(rows, y) });
  }, []);

  const stop = useCallback(() => {
    pressed.current = null;
    setDrag(null);
  }, []);

  const dragging = drag !== null;

  // Escape puts the mission back, the way it does out of any other gesture
  // that has not committed yet.
  useEffect(() => {
    if (!dragging) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dragging, stop]);

  // A ten-mission campaign is taller than the window, which is the very case
  // the issue describes, so a drag that reaches the edge of the page scrolls
  // it. Without this the gesture stops working at exactly the distance that
  // made it worth having.
  useEffect(() => {
    if (!dragging) return;
    const scroller = listRef.current?.closest<HTMLElement>(
      "[data-slot='content-scroll']",
    );
    if (!scroller) return;
    let frame = requestAnimationFrame(function step() {
      frame = requestAnimationFrame(step);
      const start = pressed.current;
      if (!start) return;
      const box = scroller.getBoundingClientRect();
      const above = box.top + EDGE_ZONE - pointerY.current;
      const below = pointerY.current - (box.bottom - EDGE_ZONE);
      const into = above > 0 ? -above : below > 0 ? below : 0;
      if (into === 0) return;
      const speed =
        (Math.min(Math.abs(into), EDGE_ZONE) / EDGE_ZONE) * EDGE_SPEED;
      scroller.scrollBy(0, Math.sign(into) * speed);
      // The rows have moved under a pointer that has not, so where the mission
      // would land is not what it was a frame ago.
      showDrag(start.from, pointerY.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [dragging, showDrag]);

  function onPointerDown(event: React.PointerEvent) {
    if (!(event.target instanceof Element)) return;
    // Only the handle starts a drag. A press on an arrow button, on Edit, on
    // Remove, or on the mission's own title does what it always did.
    if (!event.target.closest("[data-drag-handle]")) return;
    const row = event.target.closest<HTMLElement>("[data-mission-row]");
    const from = Number(row?.dataset.missionRow);
    if (!Number.isInteger(from)) return;
    pressed.current = { from, x: event.clientX, y: event.clientY };
    pointerY.current = event.clientY;
  }

  function onPointerMove(event: React.PointerEvent) {
    const start = pressed.current;
    if (!start) return;
    pointerY.current = event.clientY;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (!drag && moved < DRAG_THRESHOLD) return;
    // Capture on the list, so the drag survives the pointer leaving a row and
    // keeps reporting over the gaps between them.
    listRef.current?.setPointerCapture(event.pointerId);
    showDrag(start.from, event.clientY);
  }

  function onPointerUp(event: React.PointerEvent) {
    const start = pressed.current;
    if (listRef.current?.hasPointerCapture(event.pointerId)) {
      listRef.current.releasePointerCapture(event.pointerId);
    }
    if (drag && start) onDrop(start.from, dropIndex(drag));
    stop();
  }

  return {
    drag,
    listProps: {
      ref: listRef,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      // A cancelled pointer is the system taking the gesture away rather than
      // the author finishing it, so nothing is written.
      onPointerCancel: stop,
    },
  };
}
