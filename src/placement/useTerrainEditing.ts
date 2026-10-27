/**
 * Drawing and reshaping terrain steps on the blueprint editor's ground (issue
 * #4793).
 *
 * The pointer gestures are `useMapEditing`'s, the same ones that place and
 * drag buildings. This hook answers them for the steps: a click while a tool
 * is in use adds a point, a drag of a step or one of its handles reshapes it,
 * and the drawing is `terrainLayer.ts`. The keys a gesture can only make on
 * the ground's own element, Enter, a double click and a right click, are
 * listened for here.
 *
 * Every change to the layout is one edit through `applyEdit`, so undo and
 * redo cover it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TerrainStep } from "@/blueprint/model";
import { type StepLimit, stepRefusal } from "@/blueprint/terraform";
import {
  edgeMiddle,
  enoughPoints,
  newStep,
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
  /** The layer, for `useMapEditing`'s overlays while steps can be picked. */
  overlay: TerrainLayer | null;
  /** A click on bare ground while a tool is in use. */
  onPlace: ((pos: Point) => void) | null;
  /** A drag across bare ground, for an area drawn as a rectangle. */
  onDragGround:
    | ((from: Point, to: Point, phase: GroundDragPhase) => void)
    | null;
  onHover: ((pos: Point | null) => void) | null;
  /** Whether a key is one of the steps', which the editor hands here. */
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
  const [tool, setToolState] = useState<TerrainTool | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [refused, setRefused] = useState<StepLimit | null>(null);

  useEffect(() => {
    if (!handle) return;
    const made = createTerrainLayer({
      handle,
      worldWidth,
      worldHeight,
      groundAt,
    });
    setLayer(made);
    return () => {
      made.dispose();
      setLayer(null);
    };
  }, [handle, worldWidth, worldHeight, groundAt]);

  const active = tools ? tool : null;
  const setTool = useCallback((next: TerrainTool | null) => {
    setToolState(next);
    setPoints([]);
    setHover(null);
    setRefused(null);
  }, []);

  /** A map position as an offset from the layout's origin. */
  const offset = useCallback(
    (pos: Point): Point =>
      snapPoint({ x: pos.x - origin.x, z: pos.z - origin.z }),
    [origin],
  );

  /** Make the step drawn so far, if the game would take it. */
  const finish = useCallback(
    (drawn: Point[]) => {
      if (!active || !enoughPoints(active, drawn.length)) return;
      const step = newStep(active, drawn);
      const limit = stepRefusal(step);
      setPoints([]);
      if (limit) {
        setRefused(limit);
        return;
      }
      setRefused(null);
      let index = -1;
      applyEdit((doc) => {
        const added = addStep(doc, BLUEPRINT_BASE_ID, step);
        index = added.index;
        return added.scenario;
      });
      if (index >= 0) onSelect(stepKey(index));
    },
    [active, applyEdit, onSelect],
  );

  // Read by the listeners below, which are attached once per scene.
  const latest = useRef({ points, finish, active });
  latest.current = { points, finish, active };

  const onPlace = useMemo(() => {
    if (!active) return null;
    return (pos: Point) => {
      const at = offset(pos);
      const drawn = latest.current.points;
      const last = drawn[drawn.length - 1];
      // The second click of a double click lands where the first did.
      if (last && last.x === at.x && last.z === at.z) return;
      // A click on the first corner closes an area.
      const closing =
        (active === "area" || active === "smooth") &&
        drawn.length >= 3 &&
        drawn[0].x === at.x &&
        drawn[0].z === at.z;
      if (closing) {
        finish(drawn);
        return;
      }
      const next = [...drawn, at];
      if (enoughPoints(active, next.length)) {
        const limit = stepRefusal(newStep(active, next));
        // A ramp shorter than the game allows is the second click being too
        // close, so the first stays and the second can be tried again.
        if (limit) {
          setRefused(limit);
          return;
        }
      }
      setRefused(null);
      if (active === "ramp" && next.length === 2) {
        finish(next);
        return;
      }
      setPoints(next);
    };
  }, [active, offset, finish]);

  const onDragGround = useMemo(() => {
    if (active !== "area" && active !== "smooth") return null;
    return (from: Point, to: Point, phase: GroundDragPhase) => {
      // Only as the first thing drawn. Once a corner has been clicked, the
      // outline is being drawn by clicking.
      if (latest.current.points.length > 0 && phase === "move") return;
      const corners = rectanglePoints(offset(from), offset(to));
      if (phase === "cancel" || !corners) {
        setPoints([]);
        return;
      }
      if (phase === "move") {
        setPoints(corners);
        setHover(null);
        return;
      }
      finish(corners);
    };
  }, [active, offset, finish]);

  const onHover = useMemo(() => {
    if (!active) return null;
    return (pos: Point | null) => setHover(pos ? offset(pos) : null);
  }, [active, offset]);

  // Enter finishes and Escape cancels. Escape with nothing drawn puts the tool
  // down, the way it puts down a building being placed.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        latest.current.finish(latest.current.points);
      } else if (event.key === "Escape") {
        if (latest.current.points.length > 0) {
          setPoints([]);
        } else {
          setTool(null);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, setTool]);

  // A double click finishes, and a right click on a corner of the selected
  // step removes it.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    if (!handle || !layer) return;
    const dom = handle.renderer.domElement;
    const onDouble = () => {
      if (latest.current.active) {
        latest.current.finish(latest.current.points);
      }
    };
    const onContext = (event: MouseEvent) => {
      if (latest.current.active) return;
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
  }, [handle, layer, applyEdit]);

  const pickable = tools && !active && !placing;
  useEffect(() => {
    layer?.draw({
      origin,
      steps: terrain,
      selected,
      hidden,
      pickable,
      draft: active ? { tool: active, points, hover } : null,
    });
  }, [
    layer,
    origin,
    terrain,
    selected,
    hidden,
    pickable,
    active,
    points,
    hover,
  ]);

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
    tool: active,
    setTool,
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
