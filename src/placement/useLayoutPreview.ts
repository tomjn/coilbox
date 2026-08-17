/**
 * Drawing the layout under the pointer, and paying for it once per frame
 * (issue #1464).
 *
 * It draws the building a drag is carrying too (issue #1512), which is the same
 * question about one building the document already has: where will this land,
 * and will the ground and the neighbours take it. One hook and one layer,
 * because a pointer only ever does one of the two at a time.
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
 * The counts are the one thing a hover puts into React, and only when they
 * change, which is when a building crosses into or out of trouble. That is
 * worth a render: it is what puts the answer in words rather than only in
 * colour. A drag adds one more, on its first move and on its last, because the
 * document's own square for the building has to come down while it is in the
 * air. Neither of them is per move.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { FootprintMark } from "@/blueprint/footprint";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { Point } from "@/scenario/model";
import { createFootprintsLayer, type FootprintsLayer } from "./footprintsLayer";
import type { Placement } from "./placements";
import {
  draggedBuilding,
  layoutPreview,
  type NudgeOffer,
  nudgedPreview,
  nudgeToFit,
  type PreviewBuilding,
  type PreviewChecks,
  type PreviewCount,
  previewCount,
  previewMovable,
  sameCount,
  sameNudge,
  samePlace,
  withoutBuilding,
} from "./preview";
import type { UnitDrag } from "./useMapEditing";

export interface LayoutPreviewDeps {
  handle: MapScene3D | null;
  worldWidth: number;
  worldHeight: number;
  groundAt: (pos: Point) => number;
  /** What a click at a point would put on the ground, from the current mode.
   *  Null in a mode that places nothing whole, and then nothing is drawn and a
   *  pointer move does no work at all. */
  ghost: ((pos: Point) => PreviewBuilding[]) | null;
  /**
   * What a drag of a drawn unit is carrying, when it is not the one building
   * under the pointer (issue #1558).
   *
   * The map check has one thing on it, so a drag of any of its buildings
   * carries the whole layout, and drawing only the building that was grabbed is
   * what made the base look as though it tore apart. Left out everywhere a drag
   * really does move one building.
   *
   * Null for a drag of something with no footprint, the same as the building
   * answer, and then the drag draws nothing and keeps its ring.
   */
  carried?: ((drag: UnitDrag) => PreviewBuilding[] | null) | null;
  checks: PreviewChecks;
  /** The ground the document's own buildings already stand on. */
  occupied: FootprintMark[];
  /** Every unit currently drawn, for finding the one a drag picked up. */
  placements: Placement[];
}

export interface LayoutPreviewState {
  /** Hand to `useMapEditing` as `onHover`. Null in a mode with nothing to
   *  show, which is what stops the pointer layer casting a ray per move. */
  onHover: ((pos: Point | null) => void) | null;
  /** Hand to `useMapEditing` as `onDragUnit`. Answers whether it is drawing
   *  the drag, which is what takes the selection plate off it. */
  onDragUnit: ((drag: UnitDrag | null) => boolean) | null;
  /** The key of the building being dragged, while one is. What is drawn for it
   *  is where it is going, so whoever draws the document's own footprints
   *  should leave this one's out: see {@link withoutBuilding}. A surface whose
   *  drag carries a whole layout leaves all of them out instead, because all of
   *  them are in the air (issue #1558). */
  dragging: string | null;
  /** What is drawn under the pointer right now, in words. Null when nothing
   *  is. */
  count: PreviewCount | null;
  /** Where the layout would fit instead, when what is under the pointer does
   *  not (issue #1482). Null when there is nothing to offer. */
  nudge: NudgeOffer;
  /**
   * The point to place at to take the offer, which is the pointer's own point
   * moved by the nudge, or null when there is nothing to take.
   *
   * Asked at the moment the offer is taken rather than handed over with it,
   * because the pointer goes on moving inside the square it is in and the
   * answer is about where it is now.
   */
  nudgeAt: () => Point | null;
}

/** What the pointer is showing: the layout a click would place, or the
 *  building a drag is carrying. */
type Showing =
  | { kind: "ghost"; pos: Point }
  | { kind: "drag"; drag: UnitDrag }
  | null;

export function useLayoutPreview(deps: LayoutPreviewDeps): LayoutPreviewState {
  const { handle, worldWidth, worldHeight, ghost } = deps;
  // Read at pointer time rather than captured, so a new document or a new
  // choice of layout does not mean a new callback and a lost preview.
  const latest = useRef(deps);
  latest.current = deps;

  /** What the pointer is holding, and the spot being offered beside it. Two
   *  layers rather than one, because both are on screen at once and each is
   *  redrawn on its own (issue #1543). */
  const [layer, setLayer] = useState<FootprintsLayer | null>(null);
  const offerLayer = useRef<FootprintsLayer | null>(null);
  useEffect(() => {
    if (!handle) return;
    const deps = {
      handle,
      worldWidth,
      worldHeight,
      groundAt: (pos: Point) => latest.current.groundAt(pos),
    };
    const built = createFootprintsLayer(deps);
    offerLayer.current = createFootprintsLayer(deps);
    setLayer(built);
    return () => {
      built.dispose();
      offerLayer.current?.dispose();
      offerLayer.current = null;
      setLayer(null);
      handle.render();
    };
  }, [handle, worldWidth, worldHeight]);

  const [count, setCount] = useState<PreviewCount | null>(null);
  const [nudge, setNudge] = useState<NudgeOffer>(null);
  const nudgeAt = useRef<Point | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /** What the pointer was last doing, so the same thing can be redrawn when
   *  what is standing on the map under it changes. Null when it is doing
   *  nothing worth drawing. */
  const showing = useRef<Showing>(null);
  /** What was last drawn, for dropping a frame that would draw it in exactly
   *  the same place. */
  const drawn = useRef<{ buildings: PreviewBuilding[]; held: boolean } | null>(
    null,
  );
  const frame = useRef<number | null>(null);

  /** Whether the offer layer has anything on it, so clearing an offer that was
   *  never drawn costs no draw and no render. */
  const drawnOffer = useRef(false);

  /**
   * Hold an offer, where taking it would put the layout, and the spot itself,
   * without a render while it says the same thing.
   *
   * The words and the squares are set together because they are one offer. A
   * sentence naming a spot nothing is drawn on, or an outline nothing explains,
   * would each be half of it.
   */
  const offer = useCallback(
    (next: NudgeOffer, at: Point | null, marks: FootprintMark[] = []) => {
      nudgeAt.current = at;
      if (marks.length > 0 || drawnOffer.current) {
        offerLayer.current?.draw(marks, "offered");
        drawnOffer.current = marks.length > 0;
      }
      setNudge((was) => (sameNudge(was, next) ? was : next));
    },
    [],
  );

  /** What a drag is holding, which is the one building it took hold of unless
   *  the surface says a drag there carries a whole layout (issue #1558). */
  const heldBy = useCallback((drag: UnitDrag): PreviewBuilding[] | null => {
    const { carried, placements } = latest.current;
    if (carried) {
      const layout = carried(drag);
      return layout && layout.length > 0 ? layout : null;
    }
    const one = draggedBuilding(placements, drag.key, drag.delta);
    return one && [one];
  }, []);

  const show = useCallback(
    (what: Showing) => {
      const { ghost: make, checks, occupied } = latest.current;
      if (!layer) return;
      // A drag is what the document already holds rather than a layout that is
      // not in it yet, and the ground it came from is not ground it can clash
      // with.
      const held = what?.kind === "drag";
      const buildings =
        what?.kind === "drag"
          ? heldBy(what.drag)
          : what && make
            ? make(what.pos)
            : null;
      if (!buildings) {
        drawn.current = null;
        layer.draw([]);
        setCount(null);
        offer(null, null);
        return;
      }
      if (
        drawn.current &&
        drawn.current.held === held &&
        samePlace(drawn.current.buildings, buildings)
      )
        return;
      drawn.current = { buildings, held };
      const marks = layoutPreview(
        buildings,
        checks.footprintOf,
        held ? withoutBuilding(occupied, what.drag.key) : occupied,
        checks.standingOf,
      );
      layer.draw(marks, held ? "held" : "standing");
      const next = previewCount(marks);
      setCount((was) => (sameCount(was, next) ? was : next));
      // Only for a layout a click would place, and only when moving it could
      // fix something. A drag is one building the author is already carrying by
      // hand, so it needs no help finding a spot, and a search run over a spot
      // that is fine is a search that can only answer "where it is".
      if (held || what?.kind !== "ghost" || !previewMovable(next)) {
        offer(null, null);
        return;
      }
      const found = nudgeToFit(
        buildings,
        checks.footprintOf,
        occupied,
        checks.standingOf,
      );
      if (!found) return offer("nowhere", null);
      if (found.squares.x === 0 && found.squares.z === 0)
        return offer(null, null);
      offer(
        found,
        { x: what.pos.x + found.delta.x, z: what.pos.z + found.delta.z },
        // Drawn as well as named, so the offer is a shape rather than a compass
        // bearing (issue #1543). The layout stays under the pointer, because
        // the pointer is where the click goes.
        nudgedPreview(
          buildings,
          found,
          checks.footprintOf,
          occupied,
          checks.standingOf,
        ),
      );
    },
    [layer, offer, heldBy],
  );

  /** Draw this on the next frame, so a burst of pointer events between two
   *  frames costs one preview rather than twenty. */
  const queue = useCallback(
    (what: Showing) => {
      showing.current = what;
      if (what === null) {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
        show(null);
        return;
      }
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        show(showing.current);
      });
    },
    [show],
  );

  const onHover = useCallback(
    (pos: Point | null) => queue(pos ? { kind: "ghost", pos } : null),
    [queue],
  );

  const onDragUnit = useCallback(
    (drag: UnitDrag | null) => {
      if (!drag) {
        queue(null);
        setDragging(null);
        return false;
      }
      // Whether this is a building at all, answered now rather than on the
      // frame that draws it, because the pointer layer needs it to decide what
      // to do with the ring.
      const carrying = heldBy(drag) !== null;
      queue(carrying ? { kind: "drag", drag } : null);
      // A render on the first move of a drag and none after it: the key is the
      // same one for the rest of the gesture.
      setDragging(carrying ? drag.key : null);
      return carrying;
    },
    [queue, heldBy],
  );

  // What is standing on the map has changed under the pointer, which is what a
  // click in this mode does: the base that was just placed is now something the
  // next one can clash with. Redrawn where the pointer already is rather than
  // waiting for it to move.
  const { occupied } = deps;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `occupied` and `ghost` are not read here, they are the signal that what is drawn is out of date
  useEffect(() => {
    drawn.current = null;
    show(showing.current);
  }, [show, occupied, ghost]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  const takeNudge = useCallback(() => nudgeAt.current, []);

  return {
    nudge,
    nudgeAt: takeNudge,
    onHover: ghost && layer ? onHover : null,
    // Offered whether or not the mode places anything, because dragging a
    // building is not placing one: it is on in every mode that can pick one up.
    onDragUnit: layer ? onDragUnit : null,
    dragging,
    count,
  };
}
