/**
 * The ground a blueprint's terrain steps leave, on the scene and for everything
 * that stands on it (issue #4794).
 *
 * One hook for both grounds the editor draws on. It owns a {@link Relief},
 * works it out again when the steps, the place or the buildings change, draws
 * the changed corners on the scene's ground, draws each step's outline and
 * slope edge, and hands back what the models and the verdicts read: pass
 * `relief` and `version` to `useScenarioUnits` in the ground's description.
 *
 * Switched off (the game's terrain switch, issue #4792) the ground is left as
 * it is and the steps are drawn faintly as the author drew them.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  buildingFootprints,
  footprintMarks,
  type Rect,
} from "@/blueprint/footprint";
import type { BlueprintBuilding, TerrainStep } from "@/blueprint/model";
import type { LayoutPlacement, StepResult } from "@/blueprint/terraform";
import type { MapScene3D } from "@/lib/mapScene";
import type { Point } from "@/scenario/model";
import { drawRelief, easeRelief, type HeightRange } from "./reliefSurface";
import { groundHeight } from "./terrain";
import {
  createTerrainLayer,
  type TerrainLayer,
  terrainMarks,
} from "./terrainLayer";
import { type CornerSource, Relief, type ReliefChange } from "./terrainRelief";

/** Where each building of a layout stands on the map, in order, which is what a
 *  step needs to know which buildings it stops at. */
export function layoutRects(
  buildings: readonly BlueprintBuilding[],
  at: Point,
  units: Parameters<typeof buildingFootprints>[0],
): Rect[] {
  const placed = buildings.map((building, index) => ({
    key: String(index),
    def: building.def,
    facing: building.facing,
    pos: { x: at.x + building.offset.x, z: at.z + building.offset.z },
  }));
  return footprintMarks(placed, buildingFootprints(units)).map(
    (mark) => mark.rect,
  );
}

/** What the hook gives back. */
export interface TerrainRelief {
  /** Null until there is ground to work on. */
  relief: Relief | null;
  /** Changes whenever the heights did, so a reader of them knows. */
  version: number;
  /** What each step did, by its index in the blueprint's `terrain`. Empty when
   *  switched off. */
  results: StepResult[];
  /** The estimate for every step, empty when switched off. */
  metal: number;
}

const NONE: StepResult[] = [];

export function useTerrainRelief({
  handle,
  source,
  range,
  steps,
  placement,
  footprints,
  enabled,
  selected,
  playbackStep = null,
  reduceMotion = false,
}: {
  handle: MapScene3D | null;
  /** The ground before any step, or null when it is not read yet. */
  source: CornerSource | null;
  /** The heights the ground's displacement texture stands for. */
  range: HeightRange;
  steps: readonly TerrainStep[];
  placement: LayoutPlacement;
  /** `layoutRects`, held steady between renders. */
  footprints: readonly Rect[];
  /** The game's terrain switch. False draws the steps and leaves the ground. */
  enabled: boolean;
  /** The step to highlight, by its index in `steps`. */
  selected: number | null;
  /**
   * How many buildings are standing while a build order is being watched, or
   * null. Only the steps up to that point are on the ground, and one that has
   * just come into reach rises over a short time (issue #4794).
   */
  playbackStep?: number | null;
  reduceMotion?: boolean;
}): TerrainRelief {
  const relief = useMemo(() => (source ? new Relief(source) : null), [source]);

  const [applied, setApplied] = useState<{
    relief: Relief;
    version: number;
    change: ReliefChange;
    results: StepResult[];
    metal: number;
    animate: boolean;
  } | null>(null);

  // Which of the steps are on the ground, remembered by where each is in
  // `steps`, so a result can be put back under the index the editor knows it by.
  const live = useMemo(() => {
    const kept: number[] = [];
    if (enabled) {
      steps.forEach((step, index) => {
        if (playbackStep === null || step.before <= playbackStep) {
          kept.push(index);
        }
      });
    }
    return kept;
  }, [steps, enabled, playbackStep]);

  const wasWatching = useRef(false);
  // A layout effect, so the heights are worked out before the frame is painted
  // and nothing reads ground a step behind the one on screen.
  useLayoutEffect(() => {
    if (!relief) return;
    const change = relief.update(
      live.map((index) => steps[index]),
      placement,
      footprints,
    );
    setApplied({
      relief,
      version: relief.version,
      change,
      results: relief.results.map((r) => ({ ...r, index: live[r.index] })),
      metal: relief.metal,
      // Eased only once a build order is already being watched, so starting to
      // watch is not a slow fall back to bare ground.
      animate: playbackStep !== null && wasWatching.current && !reduceMotion,
    });
    wasWatching.current = playbackStep !== null;
  }, [relief, live, steps, placement, footprints, playbackStep, reduceMotion]);

  const current = applied && applied.relief === relief ? applied : null;

  // The ground itself, written into the scene's displacement texture.
  const drawnOn = useRef<MapScene3D | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!handle || !relief || !current) return;
    stop.current?.();
    stop.current = null;
    // A scene that has just been built has the map's own ground on it, so all of
    // the relief is written, not what the last step changed.
    const fresh = drawnOn.current !== handle;
    drawnOn.current = handle;
    const change: ReliefChange = fresh
      ? {
          rect: { c0: 0, r0: 0, c1: relief.width - 1, r1: relief.height - 1 },
          before: null,
        }
      : current.change;
    if (current.animate && !fresh) {
      stop.current = easeRelief(handle, relief, change, range);
    } else {
      drawRelief(handle, relief, change, range);
    }
  }, [handle, relief, current, range]);
  useEffect(
    () => () => {
      stop.current?.();
      stop.current = null;
    },
    [],
  );

  // The outlines and slope edges.
  const [layer, setLayer] = useState<TerrainLayer | null>(null);
  const reliefRef = useRef(relief);
  reliefRef.current = relief;
  const world = relief
    ? {
        width: (relief.width - 1) * 8,
        height: (relief.height - 1) * 8,
      }
    : null;
  const worldWidth = world?.width ?? 0;
  const worldHeight = world?.height ?? 0;
  useEffect(() => {
    if (!handle || worldWidth <= 0) return;
    const built = createTerrainLayer({
      handle,
      worldWidth,
      worldHeight,
      groundAt: () => (pos) => {
        const now = reliefRef.current;
        return now
          ? groundHeight(now.field, pos.x, pos.z, worldWidth, worldHeight, 0, 1)
          : 0;
      },
    });
    setLayer(built);
    return () => {
      built.dispose();
      setLayer(null);
      handle.render();
    };
  }, [handle, worldWidth, worldHeight]);

  const marks = useMemo(
    () =>
      terrainMarks(
        steps,
        placement,
        enabled ? (current?.results ?? NONE) : null,
      ),
    [steps, placement, enabled, current],
  );
  // Drawn after the ground it lies on, which is why `current` is a dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `current` is the signal that the ground under the lines moved
  useEffect(() => {
    layer?.draw(marks, selected, !enabled);
  }, [layer, marks, selected, enabled, current]);

  return {
    relief,
    version: current?.version ?? 0,
    results: enabled ? (current?.results ?? NONE) : NONE,
    metal: enabled ? (current?.metal ?? 0) : 0,
  };
}
