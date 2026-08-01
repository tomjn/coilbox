/**
 * Wiring the scenario's units into the map scene: what the document says, what
 * the game's archives hold, and the three.js layer that puts one on the other.
 *
 * Kept out of the scene component because it is all resolution and lifecycle.
 * The layer is built once per scene and per terrain read, and redrawn whenever
 * the document's placements or its teams' colours change, so editing a
 * scenario's name does not re-read every model in it.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  loadUnitsyncUnitModel,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "@/content/config";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import { usePreferredTarget } from "@/play/config";
import type { Scenario } from "../../model";
import { scenarioPlacements, teamColor } from "./placements";
import { type HeightField, readHeightField } from "./terrain";
import { createUnitsLayer, type UnitsLayer } from "./unitsLayer";

/** The map inputs the layer needs, as `useMissionMapAssets` reports them. */
export interface MapExtent {
  heightSrc?: string;
  minHeight: number;
  maxHeight: number;
  worldWidth: number;
  worldHeight: number;
}

/** What the editor's surface can say about what it just drew. */
export interface ScenarioUnitsState {
  /** Units placed by the document, whether or not each one could be drawn. */
  placed: number;
  /** Unit def names the game has no model for, drawn as marker boxes. */
  missing: string[];
  /** A read is in flight. */
  drawing: boolean;
  /** The scenario names a game that is not in the scanned content. */
  gameMissing: boolean;
}

/**
 * Draw a scenario's actors, groups and prefabs on a built map scene.
 *
 * Models come from the game named by the scenario's own setup, resolved through
 * the same unitsync scan the launcher uses, so a scenario written for one game
 * does not quietly borrow another's models.
 */
export function useScenarioUnits(
  handle: MapScene3D | null,
  scenario: Scenario,
  map: MapExtent,
): ScenarioUnitsState {
  const { target } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;

  const scan = useUnitsyncScan(enginePath, dataDir);
  const gameName = scenario.setup.gameName;
  const game = scan.data?.games.find((g) => g.name === gameName);
  const archive = game?.primaryArchive.name;
  const { dataset, status } = useUnitsyncUnitDataset(
    enginePath,
    dataDir,
    archive,
  );

  // Keyed by lowercased name, because a document holds whatever the author
  // typed and the dataset is already lowercased.
  const objectNames = useMemo(() => {
    const out = new Map<string, string>();
    for (const unit of dataset?.units ?? []) {
      const object = unit.objectName?.trim();
      if (object) out.set(unit.name.toLowerCase(), object);
    }
    return out;
  }, [dataset]);

  const { actors, groups, prefabs } = scenario;
  const placements = useMemo(
    // The three registries are the whole input, so a change to anything else in
    // the document leaves the drawn scene alone.
    () => scenarioPlacements({ actors, groups, prefabs }),
    [actors, groups, prefabs],
  );

  const participants = scenario.setup.participants;
  const colorKey = useMemo(
    () => participants.map((p) => `${p.id}:${p.color.join(",")}`).join("|"),
    [participants],
  );

  // Everything the layer calls back into, behind a ref: the layer outlives a
  // render, and rebuilding it whenever a closure changed identity would throw
  // away every model it has read.
  const lookups = useRef({ objectNames, participants, resolve: archive });
  lookups.current = { objectNames, participants, resolve: archive };

  const [field, setField] = useState<HeightField | null>(null);
  useEffect(() => {
    const src = map.heightSrc;
    if (!src) {
      setField(null);
      return;
    }
    let cancelled = false;
    readHeightField(src)
      .then((read) => {
        if (!cancelled) setField(read);
      })
      .catch(() => {
        if (!cancelled) setField(null);
      });
    return () => {
      cancelled = true;
    };
  }, [map.heightSrc]);

  const { worldWidth, worldHeight, minHeight, maxHeight } = map;
  const [layer, setLayer] = useState<UnitsLayer | null>(null);
  useEffect(() => {
    if (!handle || !field) return;
    const built = createUnitsLayer({
      handle,
      field,
      worldWidth,
      worldHeight,
      minHeight,
      maxHeight,
      objectName: (def) => lookups.current.objectNames.get(def.toLowerCase()),
      loadModel: (object) => {
        const gameArchive = lookups.current.resolve;
        if (!enginePath || !dataDir || !gameArchive) {
          return Promise.reject(new Error("no game to read models from"));
        }
        return loadUnitsyncUnitModel(enginePath, dataDir, gameArchive, object);
      },
      teamColor: (team) => teamColor(lookups.current.participants, team),
    });
    setLayer(built);
    return () => {
      built.dispose();
      setLayer(null);
      handle.render();
    };
  }, [
    handle,
    field,
    worldWidth,
    worldHeight,
    minHeight,
    maxHeight,
    enginePath,
    dataDir,
  ]);

  const [missing, setMissing] = useState<string[]>([]);
  const [drawing, setDrawing] = useState(false);
  // Nothing is drawn while the unit defs are still loading: drawing first would
  // fill the map with marker boxes and then replace every one of them.
  const defsReady = status !== "loading";
  // biome-ignore lint/correctness/useExhaustiveDependencies: colorKey and archive are what changed when a colour or the game did, both of which the layer reads through its ref rather than its arguments
  useEffect(() => {
    if (!layer || !defsReady) return;
    let cancelled = false;
    setDrawing(true);
    layer
      .draw(placements)
      .then((result) => {
        if (cancelled) return;
        setMissing(result.missing);
        setDrawing(false);
      })
      .catch(() => {
        if (!cancelled) setDrawing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [layer, placements, colorKey, defsReady, archive]);

  return {
    placed: placements.length,
    missing,
    drawing,
    gameMissing: !!gameName && !!scan.data && !game,
  };
}
