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
  loadUnitsyncUnitModels,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "@/content/config";
import { useReduceMotion } from "@/general/display";
import type { MapScene3D } from "@/lib/mapScene";
import { scenarioPlacements } from "@/lib/scenarioEditing/placements";
import { usePreferredTarget } from "@/play/config";
import type { Point, Scenario } from "@/scenario/model";
import { type Placement, teamColor } from "./placements";
import {
  cornerGround,
  FLAT_FIELD,
  fieldFromGrid,
  flatGround,
  groundHeight,
  type HeightGrid,
  standingField,
} from "./terrain";
import { createUnitsLayer, type UnitsLayer } from "./unitsLayer";

/** The map inputs the layer needs, as `useMissionMapAssets` reports them. */
export interface MapExtent {
  /**
   * The map's own 16 bit heights, which is what the models are stood on and
   * what a verdict is worked out on (issues #1490 and #1730).
   *
   * One reading for both. It used to be two, a picture read back through a
   * canvas for the standing and the engine's own words for the verdict, and a
   * canvas hands back eight bits whatever the picture holds. Left out by every
   * surface that only draws terrain rather than putting anything on it.
   */
  heightWords?: HeightGrid | null;
  /** Whether that read has settled, one way or the other. False means one is
   *  still in flight, so an absent grid is not yet an absent verdict. */
  heightFieldRead?: boolean;
  /**
   * The ground has no relief and there is no heightmap coming (issue #1416).
   *
   * The blueprint editor draws on flat ground rather than on a map, and without
   * this an absent grid is a read still in flight, which is what it is for
   * every other caller. Still said explicitly now that a map whose heights
   * would not read is flattened too (issue #1497): this floor is level on
   * purpose and is known exactly, so a building on it gets a real verdict, and
   * that one is a guess nothing may be judged against.
   */
  flat?: boolean;
  minHeight: number;
  maxHeight: number;
  worldWidth: number;
  worldHeight: number;
}

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
   * Null while the map's heights are being read, and on a map whose heights
   * would not read. Both are "do not ask", which is why this is separate from
   * {@link groundAt}: that one answers 0 rather than nothing, because a model
   * has to stand somewhere. Read off the map's own words at the engine's own 8
   * elmo spacing, so the verdict pays no tolerance (issue #1490).
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
  /**
   * The map's heights were asked for and would not read (issue #1497).
   *
   * The models are drawn on the flat rather than not at all, so this is what the
   * surface says to keep a level scene from reading as the truth. False for the
   * mapless editor, whose floor is level on purpose.
   */
  heightsUnread: boolean;
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

  // The engine's own heights, fetched upstream so one read serves both the
  // terrain the preview displaces and the ground a verdict is worked out on.
  const flat = map.flat === true;
  const grid = map.heightWords ?? null;
  // Whether that read has finished, which a null grid cannot say: a read in
  // flight and a read that failed both leave it null, and only one of those is
  // worth telling somebody about (issue #1491).
  const heightRead = flat || map.heightFieldRead !== false;
  // Held rather than recomputed: it is a float a sample, which on the largest
  // map is a 17 MB array, and the layer below is rebuilt whenever it moves.
  const field = useMemo(() => {
    if (flat) return FLAT_FIELD;
    return grid ? fieldFromGrid(grid) : null;
  }, [flat, grid]);

  // What the models stand on, which is the flat once the map's own heights have
  // been asked for and refused (issue #1497).
  const standing = standingField(field, heightRead);
  const heightsUnread = field === null && standing !== null;

  const { worldWidth, worldHeight, minHeight, maxHeight } = map;
  // Behind a ref like the lookups above: a preference changed while the editor
  // is open is a reason to stop moving, not a reason to rebuild the layer and
  // re-read every model in the document.
  const still = useRef(false);
  still.current = useReduceMotion();

  const [layer, setLayer] = useState<UnitsLayer | null>(null);
  useEffect(() => {
    if (!handle || !standing) return;
    const built = createUnitsLayer({
      handle,
      field: standing,
      worldWidth,
      worldHeight,
      minHeight,
      maxHeight,
      objectName: (def) => lookups.current.objectNames.get(def.toLowerCase()),
      loadModels: (objects) => {
        const gameArchive = lookups.current.resolve;
        if (!enginePath || !dataDir || !gameArchive) {
          return Promise.reject(new Error("no game to read models from"));
        }
        return loadUnitsyncUnitModels(
          enginePath,
          dataDir,
          gameArchive,
          objects,
        );
      },
      teamColor: (team) => teamColor(lookups.current.participants, team),
      motion: () => !still.current,
    });
    setLayer(built);
    return () => {
      built.dispose();
      setLayer(null);
      handle.render();
    };
  }, [
    handle,
    standing,
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
      standing
        ? groundHeight(
            standing,
            pos.x,
            pos.z,
            worldWidth,
            worldHeight,
            minHeight,
            maxHeight,
          )
        : 0,
    [standing, worldWidth, worldHeight, minHeight, maxHeight],
  );

  const ground = useMemo(() => {
    if (flat) return flatGround();
    return grid
      ? cornerGround(grid, worldWidth, worldHeight, minHeight, maxHeight)
      : null;
  }, [flat, grid, worldWidth, worldHeight, minHeight, maxHeight]);

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
    heightsUnread,
  };
}
