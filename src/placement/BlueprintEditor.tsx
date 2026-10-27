/**
 * A blueprint edited on its own, with no map anywhere near it (issue #1416).
 *
 * This is the scenario editor's placement surface with the mission taken off it.
 * Not a second editor: the ground, the camera, the unit models, the footprint
 * squares, the selection plate, the drag, the turn, the delete, the build order
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

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Blocks } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countLine } from "@/blueprint/countLine";
import {
  buildGridSnap,
  buildingFootprints,
  type FootprintMark,
} from "@/blueprint/footprint";
import type { BaseBlueprint } from "@/blueprint/model";
import { offGridBuildings, onBuildGrid } from "@/blueprint/offGrid";
import { buildingColors } from "@/blueprint/role";
import { type BuildEntry, buildSequence } from "@/blueprint/terrainEdit";
import { useTerrainChanges } from "@/blueprint/terrainSwitch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  UnitGameProvider,
  UnitPickerButton,
} from "@/content/pages/components/UnitPicker";
import { useGameUnits } from "@/content/useGameUnits";
import { useReduceMotion } from "@/general/display";
import type { MapScene3D } from "@/lib/mapScene";
import {
  addBuilding,
  buildingUnits,
  editBaseLayout,
  moveBuilding,
  renameBlueprint,
  setBlueprintOrdered,
  strayDefs,
} from "@/lib/scenarioEditing/bases";
import {
  movePlacement,
  removePlacement,
  turnPlacement,
} from "@/lib/scenarioEditing/editing";
import { isTypingTarget } from "@/lib/scenarioEditing/history";
import {
  moveInBuildOrder,
  removeStep,
  setStep,
} from "@/lib/scenarioEditing/terrain";
import { baseBuildings, type Point } from "@/scenario/model";
import { BLUEPRINT_BASE_ID, blueprintDocument } from "./blueprintDocument";
import { useLayoutHistory } from "./blueprintHistory";
import { finishedGround } from "./finishedGround";
import { GRID_EXTENT, GRID_ORIGIN, gridGround, layoutFraming } from "./ground";
import {
  BuildOrderPopover,
  LayoutNameField,
  LayoutNotes,
  layoutTriggerLabel,
  UncheckedNote,
} from "./LayoutControls";
import { PlacementSurface } from "./PlacementSurface";
import {
  absentIn,
  baseFootprints,
  noSlopeIn,
  overlappingIn,
  placementKey,
  sceneUnchecked,
} from "./placements";
import { previewChecks, turnedMarks, withoutBuilding } from "./preview";
import {
  HistoryControls,
  PlaybackBar,
  SelectionBar,
  TurnNote,
} from "./SurfaceBars";
import { focusCamera, focusDistance, worldToScene } from "./scene";
import {
  limitText,
  stepName,
  TerrainDraftBar,
  TerrainStepBar,
  TerrainToolsButton,
} from "./TerrainControls";
import { parseTerrainKey, stepKey } from "./terrainLayer";
import { useLayoutPreview } from "./useLayoutPreview";
import { useMapEditing } from "./useMapEditing";
import { useScenarioFootprints } from "./useScenarioFootprints";
import { type MapExtent, useScenarioUnits } from "./useScenarioUnits";
import { useTerrainEditing } from "./useTerrainEditing";

/** How long one building of a build order stands on screen before the next one
 *  arrives, the same pace the scenario editor watches a base go up at. */
const PLAYBACK_STEP_MS = 700;

/** The ground every blueprint is drawn on: flat, gridded and the same size
 *  every time, so a layout looks the same wherever it is opened. */
const GROUND = gridGround();

/** That ground's height everywhere, before any terrain step. */
const BASE_GROUND = () => 0;

/** One list for every "nothing to draw", so a layer with nothing on it is not
 *  cleared and redrawn on every render. */
const NOTHING: FootprintMark[] = [];
const NO_STEPS: NonNullable<BaseBlueprint["terrain"]> = [];

/** The step a selection names, or null when it names anything else or a step
 *  the layout no longer has. */
function pickedStepOf(selected: string | null, steps: number): number | null {
  const ref = parseTerrainKey(selected);
  return ref?.part === "step" && ref.index < steps ? ref.index : null;
}

export function BlueprintEditor({
  blueprint,
  gameName,
  onChange,
  history = "own",
  terrainTools = false,
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
  /**
   * Whether the terrain tools are offered (issue #4793), when the game can
   * make terrain changes. Off in the scenario editor, whose missions cannot
   * apply a step yet (issue #4799). Steps are drawn either way.
   */
  terrainTools?: boolean;
}) {
  const { t } = useLingui();
  const [handle, setHandle] = useState<MapScene3D | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [unitDef, setUnitDef] = useState("");
  /** Whether the terrain toolbar is showing. Off until the Terrain button is
   *  pressed, and with no tool picked when it is. */
  const [terrainOpen, setTerrainOpen] = useState(false);
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

  const { units, loading: unitsLoading, archive } = useGameUnits(gameName);
  const terrainChanges = useTerrainChanges(archive, units);
  const showTerrain = terrainTools && terrainChanges.showTools;
  // The steps as shown and stood on. With the game's switch off the layout is
  // a flat one (issue #4814), and the steps stay in the layout untouched.
  const terrain =
    terrainChanges.enabled === false
      ? NO_STEPS
      : (blueprint.terrain ?? NO_STEPS);
  const buildings = useMemo(() => buildingUnits(units), [units]);
  const snap = useMemo(() => buildGridSnap(units), [units]);
  // What each building does, coloured the way the in-game widget colours it.
  const colorOf = useMemo(() => buildingColors(units), [units]);

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
  // The build order, steps among the buildings (issue #4793), which is what
  // Watch it go up plays.
  const sequence = useMemo(
    () =>
      blueprint.ordered
        ? buildSequence(blueprint.buildings.length, terrain)
        : ([] as BuildEntry[]),
    [blueprint.ordered, blueprint.buildings.length, terrain],
  );
  const steps = sequence;
  const playing = playback && steps.length > 0 ? playback : null;

  const { undrawn, unbuilt } = useMemo(() => {
    if (!playing) return { undrawn: null, unbuilt: undefined };
    const buildings = new Set<string>();
    const ground = new Set<number>();
    for (let at = playing.step; at < steps.length; at++) {
      const entry = steps[at];
      if (entry.kind === "step") ground.add(entry.index);
      else buildings.add(placementKey("base", BLUEPRINT_BASE_ID, entry.index));
    }
    return { undrawn: buildings, unbuilt: ground };
  }, [playing, steps]);

  const total = steps.length;
  /** What one place in the build order is called on the playback bar. */
  const entryLabel = (entry: BuildEntry | undefined): string => {
    if (!entry) return "";
    if (entry.kind === "building") {
      return blueprint.buildings[entry.index]?.def ?? "";
    }
    const step = terrain[entry.index];
    return step ? stepName(step) : "";
  };
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

  // The ground the buildings stand on: flat, with the terrain steps built on
  // it (issue #4793), so a building on a raised pad stands on top of it.
  const builtOn = useMemo(() => finishedGround({ terrain }), [terrain]);
  const standOn = useMemo<MapExtent>(
    () =>
      builtOn
        ? {
            ...GROUND,
            heightWords: builtOn.grid,
            minHeight: builtOn.minHeight,
            maxHeight: builtOn.maxHeight,
          }
        : GROUND,
    [builtOn],
  );
  const drawn = useScenarioUnits(handle, doc, standOn, undrawn);
  // The ground here is flat on purpose rather than unread, so every building
  // gets a real verdict and the squares are not a screen full of dashes saying
  // nothing is known (issue #1491).
  const footprints = useMemo(
    () => baseFootprints(drawn.placements, units, drawn.ground),
    [drawn.placements, units, drawn.ground],
  );

  // Where a building being dragged will land, drawn while it is in the air
  // (issue #1512), and where the one being placed would land, drawn under the
  // pointer before the click (issue #1716).
  const checks = useMemo(
    () => previewChecks(units, drawn.ground),
    [units, drawn.ground],
  );
  // A building does not go where it is dropped, so the square under the pointer
  // is not the square the click will use. Held steady between renders, because
  // the preview redraws whenever this changes identity.
  const ghost = useMemo(
    () =>
      unitDef
        ? (pos: Point) => [
            { def: unitDef, pos: snap(pos, unitDef, 0), facing: 0 as const },
          ]
        : null,
    [unitDef, snap],
  );
  const preview = useLayoutPreview({
    handle,
    worldWidth: GROUND.worldWidth,
    worldHeight: GROUND.worldHeight,
    groundAt: drawn.groundAt,
    ghost,
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
  useScenarioFootprints(
    handle,
    standing,
    GROUND,
    drawn.groundAt,
    "standing",
    selected,
    colorOf,
  );

  // The ground the selected building stands on: what says it is selected, and
  // what the pointer can take hold of to move it (issue #1716).
  const footprintAt = useCallback(
    (key: string) => footprints.find((mark) => mark.key === key)?.rect ?? null,
    [footprints],
  );

  // Where a turn would stand the selected building, drawn while the Turn button
  // is under the pointer or has the focus (issue #1541). A turn is the one edit
  // with nothing under the pointer to hang a preview on, so the button is the
  // hover. Empty for a square footprint, which does not move at all.
  const [turning, setTurning] = useState(false);
  const turned = useMemo(
    () =>
      turning && selected
        ? turnedMarks(
            doc,
            selected,
            checks.footprintOf,
            footprints,
            checks.standingOf,
          )
        : NOTHING,
    [turning, selected, doc, checks, footprints],
  );
  useScenarioFootprints(handle, turned, GROUND, drawn.groundAt, "offered");

  // Escape puts the building down, the way it puts down anything else being
  // held (issue #1716). Only while one is picked, so Escape keeps whatever it
  // means everywhere else, and only outside a field, so it can still leave one.
  useEffect(() => {
    if (!unitDef) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      setUnitDef("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [unitDef]);

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

  const terrainEditing = useTerrainEditing({
    handle,
    worldWidth: GROUND.worldWidth,
    worldHeight: GROUND.worldHeight,
    // The steps are drawn up from the ground they start on, not the ground they
    // leave, which is the flat.
    groundAt: BASE_GROUND,
    origin: GRID_ORIGIN,
    terrain,
    tools: showTerrain,
    selected: pickedStepOf(selected, terrain.length),
    onSelect: setSelected,
    hidden: unbuilt,
    applyEdit,
    placing: unitDef !== "",
  });
  const { tool: terrainTool, setTool: setTerrainTool } = terrainEditing;

  // A building being placed and a step being drawn are both what a click on
  // the ground does, so taking up one puts the other down.
  const pickUnit = (def: string) => {
    setUnitDef(def);
    if (def) setTerrainTool(null);
  };

  useMapEditing({
    handle,
    layer: drawn.layer,
    placements: drawn.placements,
    worldWidth: GROUND.worldWidth,
    worldHeight: GROUND.worldHeight,
    groundAt: drawn.groundAt,
    selected,
    footprintAt,
    onSelect: (key) =>
      key && terrainEditing.owns(key)
        ? terrainEditing.select(key)
        : setSelected(key),
    onPlace: terrainEditing.onPlace ?? place,
    onHover: (pos) => {
      terrainEditing.onHover(pos);
      preview.onHover?.(pos);
    },
    onDragUnit: preview.onDragUnit,
    onDragGround: terrainEditing.onDragGround,
    overlays: [terrainEditing.overlay],
    onMove: (key, delta) =>
      terrainEditing.owns(key)
        ? terrainEditing.move(key, delta)
        : applyEdit((current) => movePlacement(current, key, delta, snap)),
    onTap: terrainEditing.tap,
  });

  const picked = drawn.placements.find((p) => p.key === selected) ?? null;
  const pickedStep = pickedStepOf(selected, terrain.length);

  /**
   * Frame the layout rather than the ground it stands on.
   *
   * The ground is four kilometres square and a layout is a few hundred elmos
   * across, so framing the ground would open on a speck. Read through a ref
   * because the button is pressed long after this was built.
   */
  const framing = useRef({ points: [] as Point[] });
  framing.current = {
    points: [
      ...drawn.placements.map((p) => p.pos),
      // A layout of steps alone is framed on its steps (issue #4793).
      ...terrain.flatMap((step) =>
        step.points.map((p) => ({
          x: GRID_ORIGIN.x + p.x,
          z: GRID_ORIGIN.z + p.z,
        })),
      ),
    ],
  };
  const frame = useCallback((scene: MapScene3D) => {
    const { camera, controls, render, scale } = scene;
    const { centre, span } = layoutFraming(framing.current.points, {
      x: GROUND.worldWidth / 2,
      z: GROUND.worldHeight / 2,
    });
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
  const noSlope = drawn.settled
    ? noSlopeIn(drawn.placements, footprints, BLUEPRINT_BASE_ID)
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
    // The unit field in the toolbar picks from this blueprint's game, so it can
    // show build pics and faction blocks like every other one.
    <UnitGameProvider gameName={gameName}>
      <PlacementSurface
        ground={{ kind: "grid", extent: GRID_EXTENT }}
        onScene={setHandle}
        frame={frame}
        frameLabel={t`Frame blueprint`}
        chrome={undoRedo && <HistoryControls {...undoRedo} />}
        bars={
          <>
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-card/80 p-1 backdrop-blur">
              <UnitPickerButton
                units={buildings}
                value={unitDef}
                onValueChange={pickUnit}
                onClear={() => setUnitDef("")}
                loading={unitsLoading}
                size="sm"
                className="w-48"
              />

              {showTerrain && (
                <TerrainToolsButton
                  open={terrainOpen}
                  onOpen={(open) => {
                    setTerrainOpen(open);
                    if (!open) setTerrainTool(null);
                  }}
                />
              )}

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 max-w-52 gap-1.5 px-2 text-xs"
                  >
                    <Blocks className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {layoutTriggerLabel(
                        blueprint.name,
                        blueprint.buildings.length,
                      )}
                    </span>
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
                    <Trans>
                      A blueprint is a shape rather than a place, so there is no
                      map here and no team. Every building sits at an offset
                      from the blueprint's own middle, and the squares under
                      them are the ground the engine will give them.
                    </Trans>
                  </p>
                  <LayoutNotes
                    overlaps={overlaps}
                    noSlope={noSlope}
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
                // Steps are listed among the buildings wherever there are any,
                // so a layout's order is never shown without them.
                terrain={
                  showTerrain || terrain.length > 0 ? terrain : undefined
                }
                selectedStep={pickedStep ?? -1}
                onMoveEntry={(entry, delta) => {
                  let moved = -1;
                  applyEdit((current) => {
                    const out = moveInBuildOrder(
                      current,
                      BLUEPRINT_BASE_ID,
                      entry,
                      delta,
                    );
                    moved = out.step;
                    return out.scenario;
                  });
                  // A selected step keeps its selection as it moves in
                  // `terrain`. A building's moves with it the way it always
                  // did, which is not at all.
                  if (entry.kind === "step" && entry.index === pickedStep) {
                    if (moved >= 0) setSelected(stepKey(moved));
                  }
                }}
              />
            </div>

            {showTerrain && terrainOpen && (
              <TerrainDraftBar
                tool={terrainTool}
                onTool={(tool) => {
                  setTerrainTool(tool);
                  if (tool) setUnitDef("");
                }}
                settings={terrainEditing.settings}
                onSettings={terrainEditing.setSettings}
                drawing={terrainEditing.drawing}
                onDone={terrainEditing.finish}
                onCancel={terrainEditing.cancel}
                enabled={terrainChanges.enabled === true}
                onEnabled={terrainChanges.setEnabled}
              />
            )}
            {!terrainTool && (
              <p className="w-fit rounded bg-card/70 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
                {unitDef
                  ? t`Click the ground to put one down. Escape stops placing. Drag a building to move it within the blueprint.`
                  : pickedStep !== null && showTerrain
                    ? t`Drag the change to move it, or a corner to reshape it. Click a side to add a corner, right click a corner to remove it.`
                    : t`Pick a building to start placing. Drag one to move it, click bare ground to deselect.`}
              </p>
            )}

            {terrainEditing.refused && (
              <p className="w-fit rounded bg-amber-950/70 px-2 py-1 text-[11px] text-amber-200 backdrop-blur">
                {limitText(terrainEditing.refused)}
              </p>
            )}

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
                what={t`building ${{ number: picked.index + 1 }}`}
                turnable
                onTurn={() =>
                  applyEdit((current) => turnPlacement(current, picked.key, 1))
                }
                onTurnPreview={setTurning}
                onDelete={() => {
                  applyEdit((current) => removePlacement(current, picked.key));
                  setSelected(null);
                }}
              />
            )}

            {/* Below the bar rather than above it (issue #1716). The note
              appears while the pointer is on the Turn button, and a note above
              the bar pushes that button out from under the pointer, which takes
              the note away, which puts the button back. */}
            <TurnNote moves={turning && picked ? turned.length > 0 : null} />

            {pickedStep !== null && showTerrain && (
              <TerrainStepBar
                step={terrain[pickedStep]}
                number={
                  buildSequence(blueprint.buildings.length, terrain).findIndex(
                    (entry) =>
                      entry.kind === "step" && entry.index === pickedStep,
                  ) + 1
                }
                onChange={(patch) =>
                  applyEdit((current) =>
                    setStep(current, BLUEPRINT_BASE_ID, pickedStep, patch),
                  )
                }
                onDelete={() => {
                  applyEdit((current) =>
                    removeStep(current, BLUEPRINT_BASE_ID, pickedStep),
                  );
                  setSelected(null);
                }}
              />
            )}

            {playing && (
              <PlaybackBar
                step={playing.step}
                total={total}
                def={entryLabel(steps[playing.step - 1])}
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
            terrain={terrain.length}
          />
        }
        // What the ground is and how to move the camera over it. What a click
        // does is the line above the layout, which is about the mode rather than
        // about the surface, and saying it twice made the two look like
        // different statements (issue #1716).
        footer={
          <Trans>
            no map · a build grid, {GRID_EXTENT} elmos square · drag or
            middle-drag to pan · right-drag to turn the view · scroll to zoom
          </Trans>
        }
      />
    </UnitGameProvider>
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
  terrain,
}: {
  gameName: string;
  gameMissing: boolean;
  missing: string[];
  drawing: boolean;
  placed: number;
  /** How many terrain steps the layout has, said after the buildings. */
  terrain: number;
}) {
  const { t } = useLingui();
  if (placed === 0 && terrain === 0) return null;
  const missingList = missing.join(", ");
  const missingCount = missing.length;
  const problem = gameMissing
    ? gameName
      ? t`${gameName} is not installed, so nothing can be drawn with its models.`
      : t`This blueprint's game is not installed, so nothing can be drawn with its models.`
    : missing.length > 0
      ? plural(missingCount, {
          one: `# unit type not in ${gameName}, drawn as boxes: ${missingList}`,
          other: `# unit types not in ${gameName}, drawn as boxes: ${missingList}`,
        })
      : null;

  return (
    // The corner is the surface's, which stacks this above the view controls.
    <>
      {problem && (
        <p className="rounded bg-amber-950/70 px-2 py-1 text-[11px] text-amber-200 backdrop-blur">
          {problem}
        </p>
      )}
      <p className="rounded bg-card/70 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
        {drawing
          ? plural(placed, {
              one: "drawing # building",
              other: "drawing # buildings",
            })
          : countLine(placed, terrain)}
      </p>
    </>
  );
}
