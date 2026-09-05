/**
 * What a click on the map is about to do, and what the ground under the
 * pointer says about it: the path being drawn, the base being moved, the
 * footprints every building stands on, and the turn a selected building would
 * make.
 *
 * Held apart from `ScenarioMapScene.tsx` the same way `useMapSelection.ts` is:
 * this hook owns state and derived reads and calls no `onChange`. `onPlace`
 * itself decides what a click writes to the document, and stays in the
 * component next to the `onChange` calls it makes, reading `drawingPath` and
 * `moving` back out of this hook the way it reads `selected` out of
 * `useMapSelection`.
 *
 * None of this holds an effect: `useLayoutPreview` and the two
 * `useScenarioFootprints` layers that read `checks`, `footprints` and
 * `turned` stay in the component too, at the same place in the render they
 * already held, so the order the map's scene layers are built in is
 * unchanged.
 */

import { useCallback, useMemo, useState } from "react";
import type { Ground } from "@/blueprint/buildable";
import type { FootprintMark, Rect, SnapBuilding } from "@/blueprint/footprint";
import type { UnitDatasetEntry } from "@/content/bindings";
import { scenarioPlacements } from "@/lib/scenarioEditing/placements";
import {
  baseFootprints,
  type Placement,
  sceneWaterless,
} from "@/placement/placements";
import {
  type PlaceKind,
  type PreviewChecks,
  placeKind,
  previewChecks,
  turnedMarks,
} from "@/placement/preview";
import type { Scenario, ScenarioGroup } from "../../model";
import { orderWaypoints } from "./groups";

/** One list for every "nothing to draw", so a layer with nothing on it is not
 *  cleared and redrawn on every render. */
const NOTHING: FootprintMark[] = [];

export interface MapPlacementPreviewDeps {
  scenario: Scenario;
  /** Every unit the document currently draws, for the footprints they stand
   *  on. */
  placements: Placement[];
  ground: Ground | null;
  /** Whether the reads a verdict depends on have finished (issue #1491). */
  settled: boolean;
  /** The scenario's game's own units, for the build grid every base building
   *  is dragged and turned onto. */
  gameUnits: UnitDatasetEntry[];
  snap: SnapBuilding;
  /** The group a path is being drawn into, when one is being drawn into a
   *  group's order. */
  pickedGroup: ScenarioGroup | null;
  /** A point a panel is waiting for, so a click on the map answers it instead
   *  of placing something new. Only whether this is truthy matters here. */
  picking: unknown;
  selected: string | null;
}

export interface MapPlacementPreviewApi {
  /** Which order the map is putting points into. Held loosely: it is only
   *  obeyed while its group is still the selection and its order is still one
   *  that has a path, so deleting either of them ends the drawing rather than
   *  stranding it. */
  drawing: { groupId: string; order: number } | null;
  setDrawing: (next: { groupId: string; order: number } | null) => void;
  drawingPath: { groupId: string; order: number } | null;
  /** Which base the map is waiting for a point for, held as loosely as a path
   *  being drawn: a base that has been deleted stops the map waiting for it. */
  moving: string | null;
  setMovingBase: (next: string | null) => void;
  /** What a click on the map would do: a path being drawn, a base's origin
   *  being moved, a point a panel asked for, or else whatever is armed
   *  (issue #2359). */
  placing: PlaceKind;
  /** Whether the map is waiting for a point, in which case its bar is the
   *  only thing the map says over the terrain (issue #2285). */
  answering: boolean;
  /** The ground every placed building stands on, and which of them are
   *  fighting over it (issue #1315). */
  footprints: FootprintMark[];
  /** The same two questions, asked of a document the keyboard has not drawn
   *  yet (issue #2315). */
  footprintsAt: (doc: Scenario) => FootprintMark[];
  /** The ground the selected building stands on, for the pointer to take hold
   *  of (issue #1716). */
  footprintAt: (key: string) => Rect | null;
  checks: PreviewChecks;
  /** A map with no sea, said once about the map rather than once per building
   *  (issue #1536). */
  waterless: number | null;
  turning: boolean;
  setTurning: (next: boolean) => void;
  /** Where a turn would stand the selected building, drawn while the Turn
   *  button is under the pointer or has the focus (issue #1541). */
  turned: FootprintMark[];
}

export function useMapPlacementPreview({
  scenario,
  placements,
  ground,
  settled,
  gameUnits,
  snap,
  pickedGroup,
  picking,
  selected,
}: MapPlacementPreviewDeps): MapPlacementPreviewApi {
  const [drawing, setDrawing] = useState<{
    groupId: string;
    order: number;
  } | null>(null);
  const drawingOrder =
    drawing && pickedGroup?.id === drawing.groupId
      ? pickedGroup.orders[drawing.order]
      : undefined;
  const drawingPath =
    drawing && drawingOrder && orderWaypoints(drawingOrder) ? drawing : null;

  const [movingBase, setMovingBase] = useState<string | null>(null);
  const moving = scenario.bases.some((b) => b.id === movingBase)
    ? movingBase
    : null;

  const placing = placeKind(drawingPath, moving, picking);
  const answering = placing.kind !== "arm";

  const footprints = useMemo(
    () => baseFootprints(placements, gameUnits, ground),
    [placements, gameUnits, ground],
  );
  const footprintsAt = useCallback(
    (doc: Scenario) =>
      baseFootprints(scenarioPlacements(doc, snap), gameUnits, ground),
    [snap, gameUnits, ground],
  );
  const checks = useMemo(
    () => previewChecks(gameUnits, ground),
    [gameUnits, ground],
  );
  const waterless = settled ? sceneWaterless(footprints, ground) : null;

  const footprintAt = useCallback(
    (key: string) => footprints.find((mark) => mark.key === key)?.rect ?? null,
    [footprints],
  );

  const [turning, setTurning] = useState(false);
  const turned = useMemo(
    () =>
      turning && selected
        ? turnedMarks(
            scenario,
            selected,
            checks.footprintOf,
            footprints,
            checks.standingOf,
          )
        : NOTHING,
    [turning, selected, scenario, checks, footprints],
  );

  return {
    drawing,
    setDrawing,
    drawingPath,
    moving,
    setMovingBase,
    placing,
    answering,
    footprints,
    footprintsAt,
    footprintAt,
    checks,
    waterless,
    turning,
    setTurning,
    turned,
  };
}
