import { useCallback, useEffect, useRef, useState } from "react";
import type { StartRect } from "../bindings";
import { allyLetter, readableText } from "./config";
import {
  boxFromPoints,
  type Edge,
  finaliseBox,
  GRID,
  moveBox,
  normaliseBox,
  type Point,
  pxToGrid,
  resizeBox,
} from "./startBoxGeometry";

const pct = (v: number) => (v / GRID) * 100;

/** Resize handles: eight grips around the box edge, each moving one/two edges. */
const HANDLES: { edges: Edge[]; className: string; cursor: string }[] = [
  { edges: ["top", "left"], className: "left-0 top-0", cursor: "nwse-resize" },
  { edges: ["top"], className: "left-1/2 top-0", cursor: "ns-resize" },
  {
    edges: ["top", "right"],
    className: "right-0 top-0",
    cursor: "nesw-resize",
  },
  { edges: ["right"], className: "right-0 top-1/2", cursor: "ew-resize" },
  {
    edges: ["bottom", "right"],
    className: "bottom-0 right-0",
    cursor: "nwse-resize",
  },
  { edges: ["bottom"], className: "bottom-0 left-1/2", cursor: "ns-resize" },
  {
    edges: ["bottom", "left"],
    className: "bottom-0 left-0",
    cursor: "nesw-resize",
  },
  { edges: ["left"], className: "left-0 top-1/2", cursor: "ew-resize" },
];

type Drag =
  | { kind: "create"; ally: number; anchor: Point; cur: Point }
  | { kind: "move"; ally: number; orig: StartRect; anchor: Point; cur: Point }
  | {
      kind: "resize";
      ally: number;
      base: StartRect;
      edges: Edge[];
      cur: Point;
    };

/** The live box a drag currently describes (unordered; normalised at render/commit). */
function boxOf(d: Drag): StartRect {
  if (d.kind === "create") return boxFromPoints(d.anchor, d.cur);
  if (d.kind === "move")
    return moveBox(d.orig, d.cur.x - d.anchor.x, d.cur.y - d.anchor.y);
  return resizeBox(d.base, d.edges, d.cur);
}

/**
 * Interactive host variant of `StartBoxOverlay`: drag empty map to CREATE the
 * active ally's box, drag a box body to MOVE it, drag a handle to RESIZE. Freeform
 * (no grid snap), one box per ally, colour-matched to the roster. We hold no
 * committed state — the box the drag draws is shown live, then `onCommit` fires
 * once on pointer-up and the real rect arrives back via the snapshot. Pointer
 * events are stopped from the underlying map-picker button (the header keeps a
 * separate "Change map" control). Sits inside the aspect-correct minimap box.
 */
export function StartBoxEditor({
  rects,
  allyColors,
  activeAlly,
  onCommit,
}: {
  rects: Record<string, StartRect>;
  allyColors: Record<number, string>;
  /** Ally a new box (drag on empty map) is assigned to. */
  activeAlly: number;
  /** Commit one ally's box on release; `ally` is 0-based (protocol). */
  onCommit: (ally: number, rect: StartRect) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // Pointer client px → grid point, relative to the aspect-correct surface.
  const gridPoint = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const el = surfaceRef.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      return {
        x: pxToGrid(e.clientX - r.left, r.width),
        y: pxToGrid(e.clientY - r.top, r.height),
      };
    },
    [],
  );

  // A drag tracks the pointer on the window (so it survives leaving the box) and
  // commits once on release. Per-move updates are local only — we never flood the
  // server; the finalised rect is sent on pointer-up.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const cur = gridPoint(e);
      setDrag((d) => (d ? ({ ...d, cur } as Drag) : d));
    };
    const onUp = () => {
      setDrag((d) => {
        if (d) {
          const rect = finaliseBox(boxOf(d));
          if (rect) onCommit(d.ally, rect);
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, gridPoint, onCommit]);

  const startCreate = (e: React.PointerEvent) => {
    // Only left button; ignore if the active ally already has a box (edit it via
    // its body/handles instead of drawing a second one).
    if (e.button !== 0 || rects[String(activeAlly)]) return;
    const p = gridPoint(e);
    setDrag({ kind: "create", ally: activeAlly, anchor: p, cur: p });
  };

  const startMove = (e: React.PointerEvent, ally: number, orig: StartRect) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = gridPoint(e);
    setDrag({ kind: "move", ally, orig, anchor: p, cur: p });
  };

  const startResize = (
    e: React.PointerEvent,
    ally: number,
    base: StartRect,
    edges: Edge[],
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setDrag({ kind: "resize", ally, base, edges, cur: gridPoint(e) });
  };

  const dragAlly = drag?.ally ?? null;
  const preview = drag ? normaliseBox(boxOf(drag)) : null;

  const boxes: { ally: number; rect: StartRect }[] = [];
  for (const [ally, r] of Object.entries(rects)) {
    const i = Number(ally);
    if (i === dragAlly) continue; // shown as the live preview instead
    boxes.push({ ally: i, rect: r });
  }
  if (preview && dragAlly != null)
    boxes.push({ ally: dragAlly, rect: preview });

  return (
    <div
      ref={surfaceRef}
      className="absolute inset-0 cursor-crosshair"
      onPointerDown={startCreate}
    >
      {boxes.map(({ ally, rect }) => {
        const color = allyColors[ally] ?? "#e5e7eb";
        return (
          <div
            key={ally}
            className="absolute"
            style={{
              left: `${pct(rect.left)}%`,
              top: `${pct(rect.top)}%`,
              width: `${pct(rect.right - rect.left)}%`,
              height: `${pct(rect.bottom - rect.top)}%`,
            }}
          >
            {/* Border drawn on an inset overlay (not the box itself) so the resize
                handles below can anchor to the rect edge and stay centred on it. */}
            <div
              className="pointer-events-none absolute inset-0 border-2"
              style={{
                borderColor: color,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
              }}
            />
            <div
              className="absolute inset-0 cursor-move motion-safe:animate-pulse"
              style={{ background: `${color}33` }}
              onPointerDown={(e) => startMove(e, ally, rect)}
            />
            <span
              className="pointer-events-none absolute left-0 top-0 m-0.5 rounded px-1 text-[10px] font-bold leading-tight shadow"
              style={{ background: color, color: readableText(color) }}
            >
              {allyLetter(ally)}
            </span>
            {HANDLES.map((h) => (
              <div
                key={h.className}
                className={`absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/60 bg-white ${h.className}`}
                style={{ cursor: h.cursor }}
                onPointerDown={(e) => startResize(e, ally, rect, h.edges)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
