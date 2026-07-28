/**
 * The piece hierarchy, and dragging a piece onto a different parent.
 *
 * Pointer events rather than HTML5 drag and drop. The app keeps Tauri's native
 * file drop switched on, because the COB and map pages take files that way, and
 * that stops HTML5 drag events reaching the webview on Windows. Pointer events
 * behave the same everywhere.
 *
 * Dragging is a pointer gesture whatever it is built on, so the parent picker
 * in the panel below the tree does the same move from the keyboard.
 */

import { useRef, useState } from "react";

import { roleLabel } from "../../animPresets";
import { childrenOf, type LegoProject, pieceById } from "../../model";
import { canReparent } from "../../reparent";

/** How far the pointer moves before a press on a row counts as a drag. */
const DRAG_THRESHOLD = 4;

interface Props {
  project: LegoProject;
  selectedId: string | null;
  onSelect: (pieceId: string) => void;
  onReparent: (pieceId: string, parentId: string) => void;
}

interface Drag {
  pieceId: string;
  /** The row under the pointer, when it can take the piece. */
  over: string | null;
  x: number;
  y: number;
}

export function PieceTree({
  project,
  selectedId,
  onSelect,
  onReparent,
}: Props) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const pressed = useRef<{ pieceId: string; x: number; y: number } | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);

  function rowAt(x: number, y: number): string | null {
    const row = document.elementFromPoint(x, y)?.closest("[data-piece-id]");
    return row instanceof HTMLElement ? (row.dataset.pieceId ?? null) : null;
  }

  function onPointerDown(event: React.PointerEvent) {
    const pieceId =
      event.target instanceof Element
        ? rowIdOf(event.target.closest("[data-piece-id]"))
        : null;
    // The root is the unit, so it has nowhere to move to. It still takes drops.
    if (!pieceId || pieceId === project.rootPieceId) return;
    pressed.current = { pieceId, x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event: React.PointerEvent) {
    const start = pressed.current;
    if (!start) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (!drag && moved < DRAG_THRESHOLD) return;

    // Capture on the container, so the drag survives the pointer leaving a row
    // and still reports moves over the gaps between them.
    containerRef.current?.setPointerCapture(event.pointerId);
    const under = rowAt(event.clientX, event.clientY);
    setDrag({
      pieceId: start.pieceId,
      over: under && canReparent(project, start.pieceId, under) ? under : null,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function onPointerEnd(event: React.PointerEvent) {
    if (drag?.over) onReparent(drag.pieceId, drag.over);
    pressed.current = null;
    if (containerRef.current?.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
    setDrag(null);
  }

  const carried = drag ? pieceById(project, drag.pieceId) : undefined;
  const onto = drag?.over ? pieceById(project, drag.over) : undefined;

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <Rows
        project={project}
        parentId={null}
        selectedId={selectedId}
        onSelect={onSelect}
        draggingId={drag?.pieceId ?? null}
        overId={drag?.over ?? null}
      />

      {drag && carried ? (
        <span
          className="pointer-events-none fixed z-50 rounded border border-border bg-popover px-2 py-1 text-xs shadow-md"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {onto ? `${carried.name} onto ${onto.name}` : carried.name}
        </span>
      ) : null}
    </div>
  );
}

function rowIdOf(element: Element | null): string | null {
  return element instanceof HTMLElement
    ? (element.dataset.pieceId ?? null)
    : null;
}

function Rows({
  project,
  parentId,
  selectedId,
  onSelect,
  draggingId,
  overId,
  depth = 0,
}: {
  project: LegoProject;
  parentId: string | null;
  selectedId: string | null;
  onSelect: (pieceId: string) => void;
  draggingId: string | null;
  overId: string | null;
  depth?: number;
}) {
  return (
    <ul>
      {childrenOf(project, parentId).map((piece) => (
        <li key={piece.id}>
          <button
            type="button"
            data-piece-id={piece.id}
            onClick={() => onSelect(piece.id)}
            className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              piece.id === overId
                ? "bg-primary/25 ring-1 ring-inset ring-primary"
                : piece.id === selectedId
                  ? "bg-primary/15 text-foreground"
                  : "hover:bg-muted/50"
            } ${piece.id === draggingId ? "opacity-50" : ""}`}
            style={{ paddingLeft: 12 + depth * 14 }}
          >
            <span className="truncate">{piece.name}</span>
            {piece.role ? (
              <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {roleLabel(piece.role)}
              </span>
            ) : piece.partId ? null : (
              <span className="ml-auto text-xs text-muted-foreground">
                empty
              </span>
            )}
          </button>
          <Rows
            project={project}
            parentId={piece.id}
            selectedId={selectedId}
            onSelect={onSelect}
            draggingId={draggingId}
            overId={overId}
            depth={depth + 1}
          />
        </li>
      ))}
    </ul>
  );
}
