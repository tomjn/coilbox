/**
 * Drawing the layout under the pointer, and paying for it once per frame
 * (issue #1464).
 *
 * The three.js and React half of `./preview.ts`. It exists as its own hook
 * rather than as more of the surface because of what it deliberately does not
 * do: a pointer move over the map does not set React state, does not re-render
 * the editor and does not redraw the document's own footprints. It works out
 * the marks and hands them to a layer of its own.
 *
 * Two things keep a move cheap:
 *
 * - Moves are coalesced onto an animation frame, so a burst of pointer events
 *   between two frames costs one preview rather than twenty.
 * - A frame whose layout would land exactly where the last one did is dropped.
 *   The origin is snapped to the build grid, so most moves land on the square
 *   the layout is already drawn on and there is nothing to redraw.
 *
 * The counts are the one thing that reaches React, and only when they change,
 * which is when a building crosses into or out of trouble. That is worth a
 * render: it is what puts the answer in words rather than only in colour.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { FootprintMark } from "@/blueprint/footprint";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { Point } from "@/scenario/model";
import { createFootprintsLayer, type FootprintsLayer } from "./footprintsLayer";
import {
  layoutPreview,
  type PreviewBuilding,
  type PreviewChecks,
  type PreviewCount,
  previewCount,
  sameCount,
  samePlace,
} from "./preview";

export interface LayoutPreviewDeps {
  handle: MapScene3D | null;
  worldWidth: number;
  worldHeight: number;
  groundAt: (pos: Point) => number;
  /** What a click at a point would put on the ground, from the current mode.
   *  Null in a mode that places nothing whole, and then nothing is drawn and a
   *  pointer move does no work at all. */
  ghost: ((pos: Point) => PreviewBuilding[]) | null;
  checks: PreviewChecks;
  /** The ground the document's own buildings already stand on. */
  occupied: FootprintMark[];
}

export interface LayoutPreviewState {
  /** Hand to `useMapEditing` as `onHover`. Null in a mode with nothing to
   *  show, which is what stops the pointer layer casting a ray per move. */
  onHover: ((pos: Point | null) => void) | null;
  /** What is drawn under the pointer right now, in words. Null when nothing
   *  is. */
  count: PreviewCount | null;
}

export function useLayoutPreview(deps: LayoutPreviewDeps): LayoutPreviewState {
  const { handle, worldWidth, worldHeight, ghost } = deps;
  // Read at pointer time rather than captured, so a new document or a new
  // choice of layout does not mean a new callback and a lost preview.
  const latest = useRef(deps);
  latest.current = deps;

  const [layer, setLayer] = useState<FootprintsLayer | null>(null);
  useEffect(() => {
    if (!handle) return;
    const built = createFootprintsLayer({
      handle,
      worldWidth,
      worldHeight,
      groundAt: (pos) => latest.current.groundAt(pos),
    });
    setLayer(built);
    return () => {
      built.dispose();
      setLayer(null);
      handle.render();
    };
  }, [handle, worldWidth, worldHeight]);

  const [count, setCount] = useState<PreviewCount | null>(null);
  /** Where the pointer last was, so the same spot can be redrawn when what is
   *  standing on the map under it changes. Null when it is off the map. */
  const at = useRef<Point | null>(null);
  /** Where the layout was last drawn, for dropping a frame that would draw it
   *  in exactly the same place. */
  const drawn = useRef<PreviewBuilding[] | null>(null);
  const frame = useRef<number | null>(null);

  const show = useCallback(
    (pos: Point | null) => {
      const { ghost: make, checks, occupied } = latest.current;
      if (!layer) return;
      if (!pos || !make) {
        drawn.current = null;
        layer.draw([]);
        setCount(null);
        return;
      }
      const buildings = make(pos);
      if (drawn.current && samePlace(drawn.current, buildings)) return;
      drawn.current = buildings;
      const marks = layoutPreview(
        buildings,
        checks.footprintOf,
        occupied,
        checks.standingOf,
      );
      layer.draw(marks);
      const next = previewCount(marks);
      setCount((was) => (sameCount(was, next) ? was : next));
    },
    [layer],
  );

  const onHover = useCallback(
    (pos: Point | null) => {
      at.current = pos;
      if (pos === null) {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
        show(null);
        return;
      }
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        show(at.current);
      });
    },
    [show],
  );

  // What is standing on the map has changed under the pointer, which is what a
  // click in this mode does: the base that was just placed is now something the
  // next one can clash with. Redrawn where the pointer already is rather than
  // waiting for it to move.
  const { occupied } = deps;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `occupied` and `ghost` are not read here, they are the signal that what is drawn is out of date
  useEffect(() => {
    drawn.current = null;
    show(at.current);
  }, [show, occupied, ghost]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  return { onHover: ghost && layer ? onHover : null, count };
}
