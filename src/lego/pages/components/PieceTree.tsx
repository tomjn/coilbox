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

import { Button } from "@picoframe/frame";
import { Eye, EyeOff } from "lucide-react";
import { useRef, useState } from "react";

import { roleLabel } from "../../animPresets";
import {
  childrenOf,
  isEffectivelyHidden,
  type LegoProject,
  pieceById,
} from "../../model";
import { canReparent } from "../../reparent";

/** How far the pointer moves before a press on a row counts as a drag. */
const DRAG_THRESHOLD = 4;

interface Props {
  project: LegoProject;
  selectedId: string | null;
  onSelect: (pieceId: string) => void;
  onReparent: (pieceId: string, parentId: string) => void;
  onToggleHidden: (pieceId: string) => void;
  /** The piece to highlight as hovered, e.g. because the pointer is over its
   *  mesh in the 3D view instead of over its row here. */
  hoveredId?: string | null;
  /** Told when the pointer starts or stops being over a row, so the 3D view
   *  can highlight the matching piece. */
  onHoverChange?: (pieceId: string | null) => void;
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
  onToggleHidden,
  hoveredId,
  onHoverChange,
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
        onToggleHidden={onToggleHidden}
        draggingId={drag?.pieceId ?? null}
        overId={drag?.over ?? null}
        hoveredId={hoveredId ?? null}
        onHoverChange={onHoverChange}
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
  onToggleHidden,
  draggingId,
  overId,
  hoveredId,
  onHoverChange,
  depth = 0,
}: {
  project: LegoProject;
  parentId: string | null;
  selectedId: string | null;
  onSelect: (pieceId: string) => void;
  onToggleHidden: (pieceId: string) => void;
  draggingId: string | null;
  overId: string | null;
  hoveredId: string | null;
  onHoverChange?: (pieceId: string | null) => void;
  depth?: number;
}) {
  const siblings = childrenOf(project, parentId);

  return (
    // The rails are drawn on the list, not per row, so they run unbroken behind
    // a whole branch. `last:before:h-3` stops the vertical rail at the elbow of
    // the final child rather than carrying on past it.
    <ul className={depth > 0 ? "relative" : ""}>
      {siblings.map((piece) => {
        // Only ancestors count towards the dimming: a piece's own toggle
        // always acts on its own flag, whatever an ancestor is doing.
        const dimmed = isEffectivelyHidden(project, piece.id);
        return (
          <li
            key={piece.id}
            className={
              depth > 0
                ? "relative before:absolute before:bottom-0 before:left-0 before:top-0 before:w-px before:bg-border last:before:h-3 after:absolute after:left-0 after:top-3 after:h-px after:w-2 after:bg-border"
                : ""
            }
            style={depth > 0 ? { marginLeft: 14 } : undefined}
          >
            {/* biome-ignore lint/a11y/noStaticElementInteractions: a visual hover cue for the 3D view, the row's own actions stay reachable through the nested button */}
            <div
              data-piece-id={piece.id}
              // Dragging a row over another already means something (a
              // reparent target), so a hover report from mid-drag is
              // suppressed rather than fighting that with a second highlight.
              onMouseEnter={() => !draggingId && onHoverChange?.(piece.id)}
              onMouseLeave={() => !draggingId && onHoverChange?.(null)}
              className={`group flex items-center pr-1 text-sm ${
                piece.id === overId
                  ? "bg-primary/25 ring-1 ring-inset ring-primary"
                  : piece.id === selectedId
                    ? "bg-primary/15 text-foreground"
                    : piece.id === hoveredId
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/50"
              } ${piece.id === draggingId ? "opacity-50" : ""}`}
            >
              <button
                type="button"
                onClick={() => onSelect(piece.id)}
                className={`flex min-w-0 flex-1 items-center gap-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  dimmed ? "text-muted-foreground" : ""
                }`}
                style={{ paddingLeft: 12 }}
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
              <Button
                size="icon"
                variant="ghost"
                className={`h-6 w-6 shrink-0 transition-opacity focus:opacity-100 group-hover:opacity-100 ${
                  piece.hidden ? "opacity-100" : "opacity-0"
                }`}
                onClick={() => onToggleHidden(piece.id)}
                aria-label={
                  piece.hidden ? `Show ${piece.name}` : `Hide ${piece.name}`
                }
                title={
                  piece.hidden ? "Show in the viewport" : "Hide in the viewport"
                }
              >
                {piece.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
            </div>
            <Rows
              project={project}
              parentId={piece.id}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggleHidden={onToggleHidden}
              draggingId={draggingId}
              overId={overId}
              hoveredId={hoveredId}
              onHoverChange={onHoverChange}
              depth={depth + 1}
            />
          </li>
        );
      })}
    </ul>
  );
}
