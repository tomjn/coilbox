/**
 * A blueprint edited on its own, with no map anywhere near it (issue #1416).
 *
 * This is the scenario editor's placement surface with the mission taken off it.
 * Not a second editor: the ground, the camera, the unit models, the footprint
 * squares, the selection ring, the drag, the turn, the delete, the build order
 * and the playback are all the same code the scenario editor runs, and every
 * edit goes through the same tested rules in `bases.ts` and `editing.ts`. What is
 * gone is everything that belongs to a base rather than to a layout: the team
 * picker, the origin, the trigger addressable id, and the factory queue.
 *
 * The layout is held as a document with one base placed from it, which is what
 * lets all of that be shared rather than reimplemented. See
 * `blueprintDocument.ts`.
 *
 * Nothing here reads a map, and nothing here should. A blueprint is not made for
 * one map, so requiring a map to look at one would be backwards, and map loading
 * is the slowest thing in coilbox. Checking a layout against real terrain is a
 * separate, optional step, and it is
 * https://github.com/tomjn/coilbox/issues/1315.
 */

import { Button } from "@picoframe/frame";
import { Blocks } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildGridSnap, buildingFootprints } from "@/blueprint/footprint";
import type { BaseBlueprint } from "@/blueprint/model";
import { offGridBuildings, onBuildGrid } from "@/blueprint/offGrid";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UnitDefSelect } from "@/content/pages/components/UnitDefSelect";
import { useGameUnits } from "@/content/useGameUnits";
import { useReduceMotion } from "@/general/display";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import { baseBuildings, type Point } from "@/scenario/model";
import {
  addBuilding,
  buildingUnits,
  editBaseLayout,
  moveBuilding,
  renameBlueprint,
  setBlueprintOrdered,
  strayDefs,
} from "@/scenario/pages/components/bases";
import {
  movePlacement,
  removePlacement,
  turnPlacement,
} from "@/scenario/pages/components/editing";
import { BLUEPRINT_BASE_ID, blueprintDocument } from "./blueprintDocument";
import { useLayoutHistory } from "./blueprintHistory";
import { GRID_EXTENT, GRID_ORIGIN, gridGround, layoutFraming } from "./ground";
import {
  BuildOrderPopover,
  LayoutNameField,
  LayoutNotes,
  UncheckedNote,
} from "./LayoutControls";
import { PlacementSurface } from "./PlacementSurface";
import {
  absentIn,
  baseFootprints,
  overlappingIn,
  placementKey,
  sceneUnchecked,
  unjudgedIn,
} from "./placements";
import { previewChecks, withoutBuilding } from "./preview";
import { HistoryControls, PlaybackBar, SelectionBar } from "./SurfaceBars";
import { focusCamera, focusDistance, worldToScene } from "./scene";
import { useLayoutPreview } from "./useLayoutPreview";
import { useMapEditing } from "./useMapEditing";
import { useScenarioFootprints } from "./useScenarioFootprints";
import { useScenarioUnits } from "./useScenarioUnits";

/** How long one building of a build order stands on screen before the next one
 *  arrives, the same pace the scenario editor watches a base go up at. */
const PLAYBACK_STEP_MS = 700;

/** The ground every blueprint is drawn on: flat, gridded and the same size
 *  every time, so a layout looks the same wherever it is opened. */
const GROUND = gridGround();

export function BlueprintEditor({
  blueprint,
  gameName,
  onChange,
  history = "own",
}: {
  blueprint: BaseBlueprint;
  /** The game whose units this layout is built from, which is what its models
   *  and its build grid come out of. */
  gameName: string;
  /** The layout after an edit. Called once per edit, with the whole layout,
   *  because a blueprint is small and whoever owns it decides where it goes. */
  onChange: (blueprint: BaseBlueprint) => void;
  /**
   * Who holds the way back from an edit (issue #1442).
   *
   * Its own by default, so a layout opened anywhere can be undone. `"caller"`
   * for an editor mounted inside one that already records these edits: the
   * scenario editor's history covers everything `onChange` reaches, and two
   * histories listening for the same key press would take two steps back on
   * one press.
   */
  history?: "own" | "caller";
}) {
  const [handle, setHandle] = useState<MapScene3D | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [unitDef, setUnitDef] = useState("");
  const reduceMotion = useReduceMotion();

  const doc = useMemo(
    () => blueprintDocument(blueprint, gameName),
    [blueprint, gameName],
  );

  /** Every edit to the layout, and the way back from one. See
   *  `blueprintHistory.ts`. */
  const { apply: applyEdit, controls: undoRedo } = useLayoutHistory({
    blueprint,
    gameName,
    owned: history === "own",
    onChange,
  });

  const { units, loading: unitsLoading } = useGameUnits(gameName);
  const buildings = useMemo(() => buildingUnits(units), [units]);
  const snap = useMemo(() => buildGridSnap(units), [units]);

  /**
   * The layout being watched go up, and how much of it is standing.
   *
   * `step` is how many buildings have been built, so 0 is bare ground. Held
   * loosely: a layout that is no longer a build order stops the playback rather
   * than stranding it.
   */
  const [playback, setPlayback] = useState<{
    step: number;
    playing: boolean;
  } | null>(null);
  const steps = blueprint.ordered ? blueprint.buildings : [];
  const playing = playback && steps.length > 0 ? playback : null;

  const undrawn = useMemo(() => {
    if (!playing) return null;
    const out = new Set<string>();
    for (let at = playing.step; at < steps.length; at++) {
      out.add(placementKey("base", BLUEPRINT_BASE_ID, at));
    }
    return out;
  }, [playing, steps.length]);

  const total = steps.length;
  const advancing = playing?.playing === true;
  useEffect(() => {
    if (!advancing) return;
    const timer = setInterval(() => {
      setPlayback((at) => {
        if (!at) return at;
        return at.step >= total
          ? { ...at, playing: false }
          : { ...at, step: at.step + 1 };
      });
    }, PLAYBACK_STEP_MS);
    return () => clearInterval(timer);
  }, [advancing, total]);

  const drawn = useScenarioUnits(handle, doc, GROUND, undrawn);
  // The ground here is flat on purpose rather than unread, so every building
  // gets a real verdict and the squares are not a screen full of dashes saying
  // nothing is known (issue #1491).
  const footprints = useMemo(
    () => baseFootprints(drawn.placements, units, drawn.ground),
    [drawn.placements, units, drawn.ground],
  );

  // Where a building being dragged will land, drawn while it is in the air
  // (issue #1512). Nothing is ever shown under the pointer here, because a
  // click puts down one building rather than a layout, so `ghost` is null and
  // this costs nothing until something is picked up.
  const checks = useMemo(
    () => previewChecks(units, drawn.ground),
    [units, drawn.ground],
  );
  const preview = useLayoutPreview({
    handle,
    worldWidth: GROUND.worldWidth,
    worldHeight: GROUND.worldHeight,
    groundAt: drawn.groundAt,
    ghost: null,
    checks,
    occupied: footprints,
    placements: drawn.placements,
  });

  // The building in the air is drawn on the squares it will land on, so its own
  // square stays out of the layout's until it lands.
  const standing = useMemo(
    () => withoutBuilding(footprints, preview.dragging),
    [footprints, preview.dragging],
  );
  useScenarioFootprints(handle, standing, GROUND, drawn.groundAt);

  const place = unitDef
    ? (pos: Point) => {
        // Where the engine will stand it rather than where the pointer was, so
        // what the author sees is what they will get.
        const stand = snap(pos, unitDef, 0);
        let key = "";
        applyEdit((current) => {
          const base = current.bases.find((b) => b.id === BLUEPRINT_BASE_ID);
          if (!base) return current;
          key = placementKey(
            "base",
            BLUEPRINT_BASE_ID,
            baseBuildings(current.blueprints, base).length,
          );
          return addBuilding(current, BLUEPRINT_BASE_ID, {
            def: unitDef,
            offset: {
              x: stand.x - base.origin.x,
              z: stand.z - base.origin.z,
            },
            facing: 0,
          });
        });
        if (key) setSelected(key);
      }
    : null;

  useMapEditing({
    handle,
    layer: drawn.layer,
    placements: drawn.placements,
    worldWidth: GROUND.worldWidth,
    worldHeight: GROUND.worldHeight,
    groundAt: drawn.groundAt,
    selected,
    onSelect: setSelected,
    onPlace: place,
    onDragUnit: preview.onDragUnit,
    onDragGround: null,
    onMove: (key, delta) =>
      applyEdit((current) => movePlacement(current, key, delta, snap)),
  });

  const picked = drawn.placements.find((p) => p.key === selected) ?? null;

  /**
   * Frame the layout rather than the ground it stands on.
   *
   * The ground is four kilometres square and a layout is a few hundred elmos
   * across, so framing the ground would open on a speck. Read through a ref
   * because the button is pressed long after this was built.
   */
  const framing = useRef({ placements: drawn.placements, at: drawn.groundAt });
  framing.current = { placements: drawn.placements, at: drawn.groundAt };
  const frame = useCallback((scene: MapScene3D) => {
    const { camera, controls, render, scale } = scene;
    const { centre, span } = layoutFraming(
      framing.current.placements.map((p) => p.pos),
      { x: GROUND.worldWidth / 2, z: GROUND.worldHeight / 2 },
    );
    const at = worldToScene(
      centre,
      GROUND.worldWidth,
      GROUND.worldHeight,
      scale,
    );
    const distance = Math.min(
      controls.maxDistance,
      Math.max(controls.minDistance, focusDistance(span) * scale),
    );
    const stand = focusCamera(at, distance);
    controls.target.set(at.x, 0, at.z);
    camera.position.set(stand.x, stand.y, stand.z);
    controls.update();
    render();
  }, []);

  const overlaps = overlappingIn(
    drawn.placements,
    footprints,
    BLUEPRINT_BASE_ID,
  );
  // Only once the reads have settled, so opening the editor is not a wall of
  // warnings that clears itself two seconds later (issue #1491).
  const unjudged = drawn.settled
    ? unjudgedIn(drawn.placements, footprints, BLUEPRINT_BASE_ID)
    : undefined;
  const absent = absentIn(drawn.placements, footprints, BLUEPRINT_BASE_ID);
  const strays = strayDefs(units, blueprint.buildings);
  // Which of them the engine will not build where the layout says (issue
  // #1479). The same question a base on a map asks, asked here because a layout
  // arriving from a game file or a pack is most likely to be opened here.
  // Only once the game's units have been read: without them every building
  // looks like one square, and half of a layout that is fine would be accused.
  const offGrid =
    units.length > 0
      ? offGridBuildings(
          blueprint.buildings,
          buildingFootprints(units),
          GRID_ORIGIN,
        )
      : [];

  return (
    <PlacementSurface
      ground={{ kind: "grid", extent: GRID_EXTENT }}
      onScene={setHandle}
      frame={frame}
      frameLabel="Frame layout"
      chrome={undoRedo && <HistoryControls {...undoRedo} />}
      bars={
        <>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-card/80 p-1 backdrop-blur">
            <UnitDefSelect
              units={buildings}
              value={unitDef}
              onValueChange={setUnitDef}
              loading={unitsLoading}
              size="sm"
              className="w-48"
            />

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 px-2 text-xs"
                >
                  <Blocks className="size-3.5" /> {blueprint.buildings.length}{" "}
                  building
                  {blueprint.buildings.length === 1 ? "" : "s"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-3">
                <LayoutNameField
                  id="blueprint-layout-name"
                  name={blueprint.name}
                  onRename={(name) =>
                    applyEdit((current) =>
                      renameBlueprint(current, BLUEPRINT_BASE_ID, name),
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  A layout is a shape rather than a place, so there is no map
                  here and no team. Every building sits at an offset from the
                  layout's own middle, and the squares under them are the ground
                  the engine will give them.
                </p>
                <LayoutNotes
                  overlaps={overlaps}
                  unjudged={unjudged}
                  absent={absent}
                  buildings={blueprint.buildings.length}
                  strays={strays}
                  offGrid={offGrid}
                  // A layout edit like a drag, so the history holds it and the
                  // library writes it a moment later like any other change.
                  onSnapToGrid={() =>
                    applyEdit((current) =>
                      editBaseLayout(
                        current,
                        BLUEPRINT_BASE_ID,
                        "own",
                        (buildings) =>
                          onBuildGrid(
                            buildings,
                            buildingFootprints(units),
                            GRID_ORIGIN,
                          ),
                      ),
                    )
                  }
                />
              </PopoverContent>
            </Popover>

            <BuildOrderPopover
              buildings={blueprint.buildings}
              index={picked?.index ?? -1}
              ordered={blueprint.ordered === true}
              onOrdered={(on) =>
                applyEdit((current) =>
                  setBlueprintOrdered(current, BLUEPRINT_BASE_ID, on),
                )
              }
              onMoveBuilding={(at, delta) =>
                applyEdit((current) =>
                  moveBuilding(current, BLUEPRINT_BASE_ID, at, delta),
                )
              }
              onPlay={() => setPlayback({ step: 0, playing: !reduceMotion })}
            />
          </div>

          <p className="w-fit rounded bg-card/70 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
            {unitDef
              ? "Click the ground to put one down. Drag a building to move it within the layout."
              : "Pick a building to start placing. Drag one to move it, click bare ground to deselect."}
          </p>

          {/* Nothing here has been checked, said once in the open rather than
              per layout in a popover (issue #1496). The ground is flat on
              purpose, so the only reason that can be true here is a game whose
              units have not been read. */}
          <UncheckedNote
            unchecked={drawn.settled ? sceneUnchecked(footprints) : null}
          />

          {picked && (
            <SelectionBar
              def={picked.def}
              what={`building ${picked.index + 1}`}
              turnable
              onTurn={() =>
                applyEdit((current) => turnPlacement(current, picked.key, 1))
              }
              onDelete={() => {
                applyEdit((current) => removePlacement(current, picked.key));
                setSelected(null);
              }}
            />
          )}

          {playing && (
            <PlaybackBar
              step={playing.step}
              total={total}
              def={steps[playing.step - 1]?.def ?? ""}
              playing={playing.playing}
              onStep={(step) =>
                setPlayback((at) => at && { ...at, step, playing: false })
              }
              onPlaying={(on) =>
                setPlayback(
                  (at) =>
                    at && {
                      ...at,
                      playing: on,
                      // Playing from the end starts again, so the button is
                      // never one that does nothing.
                      step: on && at.step >= total ? 0 : at.step,
                    },
                )
              }
              onDone={() => setPlayback(null)}
            />
          )}
        </>
      }
      note={
        <DrawnNote
          gameName={gameName}
          gameMissing={drawn.gameMissing}
          missing={drawn.missing}
          drawing={drawn.drawing}
          placed={drawn.placed}
        />
      }
      footer={
        <>
          no map · a build grid, {GRID_EXTENT} elmos square · drag or
          middle-drag to pan · drag a building to move it · right-drag to turn ·
          scroll to zoom
        </>
      }
    />
  );
}

/**
 * What was drawn, and what could not be.
 *
 * A layout names units by their internal name, so it binds to a game. Opened
 * against a game that does not have one of them, that building is drawn as a
 * marker box, which looks deliberate enough to be mistaken for a feature. The
 * count says plainly that it is not.
 */
function DrawnNote({
  gameName,
  gameMissing,
  missing,
  drawing,
  placed,
}: {
  gameName: string;
  gameMissing: boolean;
  missing: string[];
  drawing: boolean;
  placed: number;
}) {
  if (placed === 0) return null;
  const problem = gameMissing
    ? `${gameName || "This layout's game"} is not installed, so nothing can be drawn with its models.`
    : missing.length > 0
      ? `${missing.length} unit type${missing.length === 1 ? "" : "s"} not in ${gameName}, drawn as boxes: ${missing.join(", ")}`
      : null;

  return (
    <div className="pointer-events-none absolute bottom-2 right-2 flex max-w-[60%] flex-col items-end gap-1 text-right">
      {problem && (
        <p className="rounded bg-amber-950/70 px-2 py-1 text-[11px] text-amber-200 backdrop-blur">
          {problem}
        </p>
      )}
      <p className="rounded bg-card/70 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
        {drawing ? "drawing " : ""}
        {placed} building{placed === 1 ? "" : "s"}
      </p>
    </div>
  );
}
