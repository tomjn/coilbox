/**
 * Wiring the scenario's units into the map scene: what the document says, what
 * the game's archives hold, and the three.js layer that puts one on the other.
 *
 * Kept out of the scene component because it is all resolution and lifecycle.
 * The layer is built once per scene and per terrain read, and redrawn whenever
 * the document's placements or its teams' colours change, so editing a
 * scenario's name does not re-read every model in it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Ground } from "@/blueprint/buildable";
import { buildGridSnap } from "@/blueprint/footprint";
import {
  loadUnitsyncUnitModel,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "@/content/config";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import { usePreferredTarget } from "@/play/config";
import type { Point, Scenario } from "@/scenario/model";
import { scenarioPlacements } from "@/scenario/pages/components/placements";
import { type Placement, teamColor } from "./placements";
import {
  cornerGround,
  flatGround,
  groundHeight,
  type HeightField,
  readHeightField,
} from "./terrain";
import { createUnitsLayer, type UnitsLayer } from "./unitsLayer";

/** The map inputs the layer needs, as `useMissionMapAssets` reports them. */
export interface MapExtent {
  heightSrc?: string;
  /**
   * The ground has no relief and there is no heightmap coming (issue #1416).
   *
   * The blueprint editor draws on flat ground rather than on a map, and without
   * this an absent `heightSrc` is a read still in flight, which is what it is
   * for every other caller. Said explicitly so a map whose heightmap failed to
   * resolve keeps drawing nothing rather than quietly flattening itself.
   */
  flat?: boolean;
  minHeight: number;
  maxHeight: number;
  worldWidth: number;
  worldHeight: number;
}

/** Ground with no relief: one sample, at nothing. Sampled through the same
 *  bilinear read the map is, which answers 0 everywhere for this. */
const FLAT_FIELD: HeightField = {
  width: 1,
  height: 1,
  samples: Float32Array.of(0),
};

/** What the editor's surface can say about what it just drew, and what editing
 *  it needs to reach. */
export interface ScenarioUnitsState {
  /** Units placed by the document, whether or not each one could be drawn. */
  placed: number;
  /** Unit def names the game has no model for, drawn as marker boxes. */
  missing: string[];
  /** A read is in flight. */
  drawing: boolean;
  /** The scenario names a game that is not in the scanned content. */
  gameMissing: boolean;
  /** The drawn objects, for picking one off a click. Null until there is a
   *  scene and a heightmap to draw on. */
  layer: UnitsLayer | null;
  /** The document flattened into the units on the map, which is what a hit on
   *  one of those objects resolves against. */
  placements: Placement[];
  /** The map's ground height in elmos at an engine position, or 0 while the
   *  heightmap is still being read. */
  groundAt: (pos: Point) => number;
  /**
   * The map's ground on the engine's own grid, for working out whether a
   * building will stand on it (issue #1315).
   *
   * Null while the heightmap is being read, and on a map whose heightmap came
   * back smaller than its own corner grid. Both are "do not ask", which is why
   * this is separate from {@link groundAt}: that one answers 0 rather than
   * nothing, because a model has to stand somewhere. A caller that wants a
   * verdict has to ask for the render at `CHECK_MAX_SIDE`, or the field it
   * hands over is a picture of the ground rather than the ground (issue #1483).
   *
   * Flat ground with no map is not null. That floor is level on purpose and is
   * known exactly, so a building on it gets a real verdict.
   */
  ground: Ground | null;
  /**
   * Whether the reads a verdict depends on have finished, one way or the other
   * (issue #1491).
   *
   * False means an absent verdict is a read still in flight rather than a real
   * absence, which is what stops an editor that has only just opened being a
   * wall of warnings that clears itself two seconds later.
   */
  settled: boolean;
}

/**
 * Draw a scenario's actors, groups and bases on a built map scene.
 *
 * Models come from the game named by the scenario's own setup, resolved through
 * the same unitsync scan the launcher uses, so a scenario written for one game
 * does not quietly borrow another's models.
 */
export function useScenarioUnits(
  handle: MapScene3D | null,
  scenario: Scenario,
  map: MapExtent,
  /**
   * Placement keys to leave off the map, or null for the whole document.
   *
   * Only the drawing is held back. The placements are still reported, so what
   * is not drawn still counts, still has its ground marked out and is still
   * something the rest of the editor knows about. Watching a build order go up
   * is the one caller (issue #1418).
   */
  undrawn?: ReadonlySet<string> | null,
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

  // Where the engine will stand each of a base's buildings, so a model is drawn
  // on the same point as its own footprint square (#1421). Built from the same
  // dataset the footprints are, so the two agree even before it has been read,
  // when every unit is taken to stand on one square.
  const snap = useMemo(() => buildGridSnap(dataset?.units ?? []), [dataset]);

  const { actors, groups, bases, blueprints } = scenario;
  const placements = useMemo(
    // These registries are the whole input, so a change to anything else in the
    // document leaves the drawn scene alone.
    () => scenarioPlacements({ actors, groups, bases, blueprints }, snap),
    [actors, groups, bases, blueprints, snap],
  );

  const drawn = useMemo(
    () =>
      undrawn?.size
        ? placements.filter((placement) => !undrawn.has(placement.key))
        : placements,
    [placements, undrawn],
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
  // Whether the read above has finished, which a null field cannot say: a read
  // in flight and a read that failed both leave it null, and only one of those
  // is worth telling somebody about (issue #1491).
  const [heightRead, setHeightRead] = useState(false);
  const flat = map.flat === true;
  useEffect(() => {
    const src = map.heightSrc;
    if (flat) {
      setField(FLAT_FIELD);
      setHeightRead(true);
      return;
    }
    if (!src) {
      setField(null);
      setHeightRead(false);
      return;
    }
    setHeightRead(false);
    let cancelled = false;
    readHeightField(src)
      .then((read) => {
        if (cancelled) return;
        setField(read);
        setHeightRead(true);
      })
      .catch(() => {
        if (cancelled) return;
        setField(null);
        setHeightRead(true);
      });
    return () => {
      cancelled = true;
    };
  }, [map.heightSrc, flat]);

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
  // Nothing is drawn until the game's unit defs have settled one way or the
  // other. Drawing before that fills the map with marker boxes for units the
  // game does have, and says so in the caption.
  const defsReady = archive
    ? status === "ready" || status === "error" || status === "unsyncable"
    : !scan.loading;
  // biome-ignore lint/correctness/useExhaustiveDependencies: colorKey is what changed when a team's colour did, which the layer reads through its ref rather than its arguments
  useEffect(() => {
    if (!layer || !defsReady) return;
    let cancelled = false;
    setDrawing(true);
    layer
      .draw(drawn)
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
    // `objectNames` rather than the archive name: a dataset already in the
    // session cache resolves in the same render the archive does, so keying on
    // the archive alone would leave the first draw's markers on the map.
  }, [layer, drawn, colorKey, defsReady, objectNames]);

  const groundAt = useCallback(
    (pos: Point) =>
      field
        ? groundHeight(
            field,
            pos.x,
            pos.z,
            worldWidth,
            worldHeight,
            minHeight,
            maxHeight,
          )
        : 0,
    [field, worldWidth, worldHeight, minHeight, maxHeight],
  );

  const ground = useMemo(() => {
    if (flat) return flatGround();
    return field
      ? cornerGround(field, worldWidth, worldHeight, minHeight, maxHeight)
      : null;
  }, [flat, field, worldWidth, worldHeight, minHeight, maxHeight]);

  return {
    placed: placements.length,
    missing,
    drawing,
    gameMissing: !!gameName && !!scan.data && !game,
    layer,
    placements,
    groundAt,
    ground,
    settled: defsReady && heightRead,
  };
}
