/**
 * Drawing and reshaping terrain steps on the blueprint editor's ground (issue
 * #4793).
 *
 * The pointer gestures are `useMapEditing`'s, the same ones that place and
 * drag buildings. This hook answers them for the steps: a click while a tool
 * is in use adds a point, and a drag of a step or one of its handles reshapes
 * it. What each of Enter, Escape, a double click, a right click, Done and
 * Cancel does to a step being drawn is `draftReduce` in
 * `@/blueprint/terrainDraft.ts`. The keys are listened for on the window, so
 * they work whatever has the focus.
 *
 * Two layers draw: `terrainVolumes.ts`, what the steps look like, and
 * `terrainLayer.ts`, what the pointer works with. The pointer's position is
 * kept out of React, so moving it redraws those two and nothing else.
 *
 * Every change to the layout is one edit through `applyEdit`, so undo and
 * redo cover it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TerrainStep } from "@/blueprint/model";
import { type StepLimit, stepRefusal } from "@/blueprint/terraform";
import {
  type DraftInput,
  type DraftSettings,
  type DraftState,
  draftReduce,
  draftStep,
  NO_DRAFT,
} from "@/blueprint/terrainDraft";
import {
  edgeMiddle,
  enoughPoints,
  rectanglePoints,
  snapPoint,
  type TerrainTool,
} from "@/blueprint/terrainEdit";
import type { MapScene3D } from "@/lib/mapScene";
import { isTypingTarget } from "@/lib/scenarioEditing/history";
import {
  addStep,
  addStepCorner,
  moveStep,
  moveStepCorner,
  removeStepCorner,
} from "@/lib/scenarioEditing/terrain";
import type { Point, Scenario } from "@/scenario/model";
import { BLUEPRINT_BASE_ID } from "./blueprintDocument";
import {
  createTerrainLayer,
  draggedStep,
  parseTerrainKey,
  stepKey,
  type TerrainLayer,
} from "./terrainLayer";
import { createTerrainVolumes, type TerrainVolumes } from "./terrainVolumes";
import type { GroundDragPhase } from "./useMapEditing";

export interface TerrainEditingDeps {
  handle: MapScene3D | null;
  worldWidth: number;
  worldHeight: number;
  groundAt: (pos: Point) => number;
  /** Where the layout's offsets are measured from, in map elmos. */
  origin: Point;
  terrain: readonly TerrainStep[];
  /** Whether the tools are offered. Off, the steps are drawn and nothing
   *  more. */
  tools: boolean;
  /** The selected step, or null when the selection is anything else. */
  selected: number | null;
  onSelect: (key: string | null) => void;
  /** Whether a building is being placed. A click on a step then puts the
   *  building on it rather than taking hold of the step. */
  placing: boolean;
  /** Steps a playback has not reached yet. */
  hidden?: ReadonlySet<number>;
  applyEdit: (edit: (doc: Scenario) => Scenario) => void;
}

export interface TerrainEditing {
  tool: TerrainTool | null;
  setTool: (tool: TerrainTool | null) => void;
  /** What the step being drawn will be made with. */
  settings: DraftSettings;
  setSettings: (settings: Partial<DraftSettings>) => void;
  /** Whether a step is part drawn. */
  drawing: boolean;
  /** Make the step drawn so far, or put the tool down. */
  finish: () => void;
  /** Throw away the step drawn so far and put the tool down. */
  cancel: () => void;
  /** The layer, for `useMapEditing`'s overlays while steps can be picked. */
  overlay: TerrainLayer | null;
  /** A click on bare ground while a tool is in use. */
  onPlace: ((pos: Point) => void) | null;
  /** A drag across bare ground, for an area drawn as a rectangle. */
  onDragGround:
    | ((from: Point, to: Point, phase: GroundDragPhase) => void)
    | null;
  /** Where the pointer is, for the guide of a step being drawn. */
  onHover: (pos: Point | null) => void;
  /** Whether a key is one of the steps'. */
  owns: (key: string) => boolean;
  /** A press that took hold of a step's part: select the step. */
  select: (key: string) => void;
  /** A drag of a step's part that was let go. */
  move: (key: string, delta: Point) => void;
  /** A click on a step's side, which adds a corner there. */
  tap: (key: string) => void;
  /** The limit the last attempt stopped at, said until the next one. */
  refused: StepLimit | null;
}

export function useTerrainEditing(deps: TerrainEditingDeps): TerrainEditing {
  const {
    handle,
    worldWidth,
    worldHeight,
    groundAt,
    origin,
    terrain,
    tools,
    selected,
    onSelect,
    hidden,
    applyEdit,
    placing,
  } = deps;
  const [layer, setLayer] = useState<TerrainLayer | null>(null);
  const [volumes, setVolumes] = useState<TerrainVolumes | null>(null);
  const [draft, setDraft] = useState<DraftState>(NO_DRAFT);
  const [refused, setRefused] = useState<StepLimit | null>(null);

  useEffect(() => {
    if (!handle) return;
    const made = {
      volumes: createTerrainVolumes({
        handle,
        worldWidth,
        worldHeight,
        groundAt,
      }),
      layer: createTerrainLayer({ handle, worldWidth, worldHeight, groundAt }),
    };
    setVolumes(made.volumes);
    setLayer(made.layer);
    return () => {
      made.layer.dispose();
      made.volumes.dispose();
      setLayer(null);
      setVolumes(null);
    };
  }, [handle, worldWidth, worldHeight, groundAt]);

  // Read at the moment of an input, so two inputs before a render build on
  // each other.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const dispatch = useCallback(
    (input: DraftInput) => {
      const result = draftReduce(draftRef.current, input);
      draftRef.current = result.state;
      setDraft(result.state);
      setRefused(result.refused);
      const step = result.step;
      if (!step) return;
      let index = -1;
      applyEdit((doc) => {
        const added = addStep(doc, BLUEPRINT_BASE_ID, step);
        index = added.index;
        return added.scenario;
      });
      if (index >= 0) onSelect(stepKey(index));
    },
    [applyEdit, onSelect],
  );

  const tool = tools ? draft.tool : null;
  const pickable = tools && !tool && !placing;

  /** A map position as an offset from the layout's origin. */
  const offset = useCallback(
    (pos: Point): Point =>
      snapPoint({ x: pos.x - origin.x, z: pos.z - origin.z }),
    [origin],
  );

  // The pointer, and a rectangle being dragged out, kept out of React.
  const hover = useRef<Point | null>(null);
  const band = useRef<Point[] | null>(null);

  const redraw = useRef(() => {});
  redraw.current = () => {
    const at = hover.current;
    // The step as it would be made now: the rectangle being dragged, or the
    // points clicked so far and the one under the pointer.
    const run = band.current ?? (at ? [...draft.points, at] : draft.points);
    const preview =
      tool && enoughPoints(tool, run.length)
        ? draftStep(tool, run, draft.settings)
        : null;
    volumes?.draw(origin, terrain, hidden, preview);
    layer?.draw({
      origin,
      steps: terrain,
      selected,
      hidden,
      pickable,
      guide: tool
        ? {
            points: band.current ?? draft.points,
            hover: band.current ? null : at,
            closed: tool === "area" || tool === "smooth",
          }
        : null,
    });
  };
  useEffect(() => {
    redraw.current();
  });

  const onHover = useCallback(
    (pos: Point | null) => {
      hover.current = pos ? offset(pos) : null;
      // Only a step being drawn follows the pointer.
      if (toolRef.current) redraw.current();
    },
    [offset],
  );

  const onPlace = useMemo(() => {
    if (!tool) return null;
    return (pos: Point) => dispatch({ type: "click", at: offset(pos) });
  }, [tool, offset, dispatch]);

  const onDragGround = useMemo(() => {
    if (tool !== "area" && tool !== "smooth") return null;
    return (from: Point, to: Point, phase: GroundDragPhase) => {
      if (draftRef.current.points.length > 0) return;
      const corners = rectanglePoints(offset(from), offset(to));
      if (phase === "move") {
        band.current = corners;
        redraw.current();
        return;
      }
      band.current = null;
      if (phase === "end" && corners) {
        dispatch({ type: "rectangle", corners });
      } else {
        redraw.current();
      }
    };
  }, [tool, offset, dispatch]);

  const finish = useCallback(() => dispatch({ type: "finish" }), [dispatch]);
  const cancel = useCallback(() => dispatch({ type: "cancel" }), [dispatch]);
  const setTool = useCallback(
    (next: TerrainTool | null) => dispatch({ type: "pick", tool: next }),
    [dispatch],
  );
  const setSettings = useCallback(
    (settings: Partial<DraftSettings>) =>
      dispatch({ type: "settings", settings }),
    [dispatch],
  );

  // Enter finishes and Escape cancels, whatever has the focus. Escape is
  // taken even in a field, so the tool bar's own Height box does not trap it.
  // Enter in a field is that field's, which commits what was typed.
  useEffect(() => {
    if (!tool) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "escape" });
      } else if (
        event.key === "Enter" &&
        !isTypingTarget(event.target as HTMLElement | null)
      ) {
        event.preventDefault();
        dispatch({ type: "finish" });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [tool, dispatch]);

  // A double click or a right click finishes. With no tool, a right click on a
  // corner of the selected step removes it.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  useEffect(() => {
    if (!handle || !layer) return;
    const dom = handle.renderer.domElement;
    const onDouble = () => {
      if (toolRef.current) dispatch({ type: "finish" });
    };
    const onContext = (event: MouseEvent) => {
      if (toolRef.current) {
        event.preventDefault();
        dispatch({ type: "finish" });
        return;
      }
      const ref = layer.cornerAt(event.clientX, event.clientY);
      if (ref?.part !== "corner" || ref.index !== selectedRef.current) return;
      event.preventDefault();
      applyEdit((doc) =>
        removeStepCorner(doc, BLUEPRINT_BASE_ID, ref.index, ref.at),
      );
    };
    dom.addEventListener("dblclick", onDouble);
    dom.addEventListener("contextmenu", onContext);
    return () => {
      dom.removeEventListener("dblclick", onDouble);
      dom.removeEventListener("contextmenu", onContext);
    };
  }, [handle, layer, applyEdit, dispatch]);

  /** A change to one step, kept to itself when the game would refuse it. */
  const reshape = useCallback(
    (key: string, delta: Point, edit: (doc: Scenario) => Scenario) => {
      const ref = parseTerrainKey(key);
      const step = ref ? terrain[ref.index] : undefined;
      if (!ref || !step) return;
      const limit = stepRefusal(draggedStep(step, ref, delta));
      setRefused(limit);
      // Drawn back as it was, since the document will not change.
      if (limit) layer?.drag(key, { x: 0, z: 0 });
      else applyEdit(edit);
    },
    [terrain, layer, applyEdit],
  );

  return {
    tool,
    setTool,
    settings: draft.settings,
    setSettings,
    drawing: draft.points.length > 0,
    finish,
    cancel,
    overlay: pickable ? layer : null,
    onPlace,
    onDragGround,
    onHover,
    owns: (key) => parseTerrainKey(key) !== null,
    select: (key) => {
      const ref = parseTerrainKey(key);
      if (ref) onSelect(stepKey(ref.index));
    },
    move: (key, delta) => {
      const ref = parseTerrainKey(key);
      if (!ref) return;
      reshape(key, delta, (doc) => {
        if (ref.part === "step") {
          return moveStep(doc, BLUEPRINT_BASE_ID, ref.index, delta);
        }
        if (ref.part === "corner") {
          return moveStepCorner(
            doc,
            BLUEPRINT_BASE_ID,
            ref.index,
            ref.at,
            delta,
          );
        }
        const middle = edgeMiddle(terrain[ref.index], ref.at);
        return addStepCorner(doc, BLUEPRINT_BASE_ID, ref.index, ref.at, {
          x: middle.x + delta.x,
          z: middle.z + delta.z,
        });
      });
    },
    tap: (key) => {
      const ref = parseTerrainKey(key);
      if (ref?.part !== "edge") return;
      reshape(key, { x: 0, z: 0 }, (doc) =>
        addStepCorner(
          doc,
          BLUEPRINT_BASE_ID,
          ref.index,
          ref.at,
          edgeMiddle(terrain[ref.index], ref.at),
        ),
      );
    },
    refused,
  };
}
