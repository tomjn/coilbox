/**
 * The map's own decorations: the zones sheet, the paths drawn over it, and the
 * markers a participant would come down on.
 *
 * Held apart from `ScenarioMapScene.tsx` the same way `useMapSelection.ts` and
 * `useMapPlacementPreview.ts` are: this hook owns the reads that decide what
 * each layer draws and calls no `onChange`. Renaming a zone, deleting a path's
 * waypoint and removing a group all read `pickedZone`, `pathRef` and the rest
 * back out of this hook and stay in the component, next to the `onChange`
 * calls they make.
 *
 * `useScenarioZones`, `useScenarioStarts` and `useScenarioPaths` are called
 * here in the same order they were declared in before this hook existed, so
 * moving them does not reorder their effects relative to each other or to the
 * map's other scene layers, which are still built directly in the component
 * right after this hook returns.
 */

import { useMemo } from "react";
import type { MapScene3D } from "@/lib/mapScene";
import type { Placement } from "@/placement/placements";
import type { Point, Scenario, ScenarioGroup, ScenarioZone } from "../../model";
import { type PathRef, parsePathKey, parsePathLineKey } from "./groups";
import type { PathSource } from "./orderPaths";
import type { PathsLayer } from "./pathsLayer";
import { startMarkers } from "./startPositions";
import { useScenarioPaths } from "./useScenarioPaths";
import { useScenarioStarts } from "./useScenarioStarts";
import { useScenarioZones } from "./useScenarioZones";
import { parseZoneKey } from "./zones";
import type { ZonesLayer } from "./zonesLayer";

export interface MapOverlaysDeps {
  handle: MapScene3D | null;
  scenario: Scenario;
  map: { worldWidth: number; worldHeight: number };
  groundAt: (pos: Point) => number;
  selected: string | null;
  /** Zones a mode is drawing or dragging, so the sheet shows the one being made
   *  alongside the document's own (issue #2313). */
  draftZones: ScenarioZone[] | undefined;
  paths: PathSource[];
  /** The map's own start positions, straight off the map through unitsync. */
  startPositions: Point[];
  /** The path a panel elsewhere is putting points into, so the map draws that
   *  one with knobs while it is being drawn (#847). */
  pickingPathId: string | undefined;
  /** What is currently selected on the map, so a group reached through one of
   *  its own units gets its waypoints drawn too. */
  picked: Placement | null;
}

export interface MapOverlaysApi {
  pickedZone: ScenarioZone | null;
  zonesLayer: ZonesLayer | null;
  pathRef: PathRef | null;
  pickedGroup: ScenarioGroup | null;
  selectedLine: string | null;
  pathsLayer: PathsLayer | null;
}

export function useMapOverlays({
  handle,
  scenario,
  map,
  groundAt,
  selected,
  draftZones,
  paths,
  startPositions,
  pickingPathId,
  picked,
}: MapOverlaysDeps): MapOverlaysApi {
  // A zone key names either the zone or one of its resize handles, and both
  // mean the same zone is what is selected.
  const zoneRef = selected ? parseZoneKey(selected) : null;
  const pickedZone =
    scenario.zones.find((zone) => zone.id === zoneRef?.id) ?? null;

  const zones = useMemo(
    () => (draftZones ? [...scenario.zones, ...draftZones] : scenario.zones),
    [scenario.zones, draftZones],
  );
  const zonesLayer = useScenarioZones(
    handle,
    zones,
    map,
    groundAt,
    pickedZone?.id ?? null,
  );

  // The map's own start positions, which is what an author orients against and
  // the only way to see where a participant would come down.
  const { setup } = scenario;
  const starts = useMemo(
    () => startMarkers(startPositions, setup),
    [startPositions, setup],
  );
  useScenarioStarts(handle, starts, map, groundAt);

  // A group is what is being worked on whether one of its units or one of its
  // waypoints was clicked, so both answer the same question.
  const pathRef = selected ? parsePathKey(selected) : null;
  const pickedGroup =
    scenario.groups.find(
      (group) =>
        group.id ===
        (pathRef?.groupId ?? (picked?.kind === "group" ? picked.id : null)),
    ) ?? null;

  const selectedLine = selected ? parsePathLineKey(selected) : null;
  // Which of them is being worked on, and so gets knobs on its points: the one a
  // panel is putting points into, failing that the one a point or a line of is
  // selected, failing that the selected group's own.
  const activePath =
    pickingPathId ??
    pathRef?.groupId ??
    selectedLine ??
    pickedGroup?.id ??
    null;
  const pathsLayer = useScenarioPaths(
    handle,
    paths,
    map,
    groundAt,
    activePath,
    pathRef ? selected : null,
  );

  return {
    pickedZone,
    zonesLayer,
    pathRef,
    pickedGroup,
    selectedLine,
    pathsLayer,
  };
}
