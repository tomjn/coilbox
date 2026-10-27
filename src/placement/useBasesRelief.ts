/**
 * The ground every base's terrain changes leave on a scenario's map (issue
 * #4799), drawn the way `useTerrainRelief` draws one blueprint's: the changed
 * ground on the scene, the see-through volume and wire grid over each step,
 * and a relief the models and the verdicts stand on.
 *
 * Bases are worked out in the order the mission runtime sets them: every base
 * there from the start in document order, then the bases a trigger places,
 * each on the ground the ones before it left. The game's Terrain changes
 * switch plays no part, because a mission sets the ground itself in every game.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { BaseBlueprint } from "@/blueprint/model";
import type { StepResult } from "@/blueprint/terraform";
import type { MapScene3D } from "@/lib/mapScene";
import type { ScenarioBase } from "@/scenario/model";
import { drawRelief, type HeightRange } from "./reliefSurface";
import {
  createTerrainLayer,
  type TerrainLayer,
  type TerrainMark,
  terrainMarks,
} from "./terrainLayer";
import {
  type CornerSource,
  Relief,
  type ReliefChange,
  type ReliefLayout,
} from "./terrainRelief";

/** Each base with steps, in the order the runtime sets their ground. */
export function baseLayouts(
  blueprints: readonly BaseBlueprint[],
  bases: readonly ScenarioBase[],
): ReliefLayout[] {
  const ordered = [
    ...bases.filter((base) => base.dormant !== true),
    ...bases.filter((base) => base.dormant === true),
  ];
  return ordered.flatMap((base) => {
    const steps = blueprints.find((b) => b.id === base.blueprint)?.terrain;
    if (!steps || steps.length === 0) return [];
    // Every step comes before every building (issue #4817), and the runtime
    // sets a base's ground before any of them stand, so none blocks a slope.
    return [
      { steps, placement: { at: base.origin, quarters: 0 }, footprints: [] },
    ];
  });
}

export interface BasesRelief {
  /** Null until the map's heights have been read. */
  relief: Relief | null;
  /** Changes whenever the heights did. */
  version: number;
}

export function useBasesRelief({
  handle,
  source,
  range,
  layouts,
}: {
  handle: MapScene3D | null;
  /** The map's ground, or null when it is not read yet or no base has steps. */
  source: CornerSource | null;
  range: HeightRange;
  layouts: readonly ReliefLayout[];
}): BasesRelief {
  const relief = useMemo(() => (source ? new Relief(source) : null), [source]);
  const [applied, setApplied] = useState<{
    relief: Relief;
    version: number;
    change: ReliefChange;
    results: StepResult[][];
  } | null>(null);

  // Compared by what they say, so a document rebuilt by an edit somewhere else
  // does not work every base's ground out again.
  const layoutsKey = JSON.stringify(layouts);
  const latest = useRef(layouts);
  latest.current = layouts;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the layouts, which are read through the ref
  useLayoutEffect(() => {
    if (!relief) return;
    const change = relief.updateLayouts(latest.current);
    setApplied({
      relief,
      version: relief.version,
      change,
      results: relief.layoutResults,
    });
  }, [relief, layoutsKey]);

  const current = applied && applied.relief === relief ? applied : null;

  // The ground itself, written into the scene's displacement texture. A scene
  // that has just been built has the map's own ground on it, so all of the
  // relief is written then.
  const drawnOn = useRef<MapScene3D | null>(null);
  useEffect(() => {
    if (!handle || !relief || !current) return;
    const fresh = drawnOn.current !== handle;
    drawnOn.current = handle;
    const change: ReliefChange = fresh
      ? {
          rect: { c0: 0, r0: 0, c1: relief.width - 1, r1: relief.height - 1 },
          before: null,
        }
      : current.change;
    drawRelief(handle, relief, change, range);
  }, [handle, relief, current, range]);

  // The volumes and grids over each step.
  const [layer, setLayer] = useState<TerrainLayer | null>(null);
  const reliefRef = useRef(relief);
  reliefRef.current = relief;
  const worldWidth = relief ? (relief.width - 1) * 8 : 0;
  const worldHeight = relief ? (relief.height - 1) * 8 : 0;
  useEffect(() => {
    if (!handle || worldWidth <= 0) return;
    const built = createTerrainLayer({
      handle,
      worldWidth,
      worldHeight,
      relief: () => reliefRef.current,
    });
    setLayer(built);
    return () => {
      built.dispose();
      setLayer(null);
      handle.render();
    };
  }, [handle, worldWidth, worldHeight]);

  const marks = useMemo(() => {
    if (!current) return [] as TerrainMark[];
    const ours = latest.current;
    let next = 0;
    // One list for every base. Each mark is numbered across all of them, so
    // no two share the index a selection would be read by.
    return ours.flatMap((layout, i) =>
      terrainMarks(
        layout.steps,
        layout.placement,
        current.results[i] ?? [],
      ).map((mark) => ({ ...mark, index: next++ })),
    );
  }, [current]);
  // Drawn after the ground it lies on, which is why `current` is a dependency.
  useEffect(() => {
    layer?.draw(marks, null);
  }, [layer, marks]);

  return { relief, version: current?.version ?? 0 };
}
