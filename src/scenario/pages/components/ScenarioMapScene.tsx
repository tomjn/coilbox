import { Button, Input } from "@picoframe/frame";
import {
  Layers,
  List,
  Loader2,
  MapPin,
  MountainSnow,
  Trash2,
  Unplug,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import {
  buildGridSnap,
  buildingFootprints,
  type FootprintMark,
} from "@/blueprint/footprint";
import { onBuildGrid } from "@/blueprint/offGrid";
import { useGameSides } from "@/blueprint/useGameSides";
import { useMissionMapAssets } from "@/campaign/pages/components/useMissionMapAssets";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useGameUnits } from "@/content/useGameUnits";
import { useReduceMotion } from "@/general/display";
import { useFieldText } from "@/lib/useFieldText";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import { UncheckedNote, WaterlessNote } from "@/placement/LayoutControls";
import { PlacementSurface, SurfaceMessage } from "@/placement/PlacementSurface";
import {
  absentIn,
  baseFootprints,
  noSlopeIn,
  overlappingIn,
  type Placement,
  placementKey,
  sceneUnchecked,
  sceneWaterless,
  tooDeepIn,
  tooShallowIn,
  unstableIn,
} from "@/placement/placements";
import { clampToMap } from "@/placement/pointer";
import {
  nudgeSentence,
  previewChecks,
  previewSentence,
  previewTrouble,
  turnedMarks,
  withoutBuilding,
} from "@/placement/preview";
import {
  HistoryControls,
  PlaybackBar,
  SelectionBar,
  TurnNote,
} from "@/placement/SurfaceBars";
import {
  focusCamera,
  focusDistance,
  mapSceneStatus,
  sceneToWorld,
  worldToScene,
} from "@/placement/scene";
import { useLayoutPreview } from "@/placement/useLayoutPreview";
import { useMapEditing } from "@/placement/useMapEditing";
import { useScenarioFootprints } from "@/placement/useScenarioFootprints";
import {
  type ScenarioUnitsState,
  useScenarioUnits,
} from "@/placement/useScenarioUnits";
import { usePreferredTarget } from "@/play/config";
import type { ExtensionTypes } from "../../extensions";
import {
  baseBuildings,
  type Point,
  type Scenario,
  type ScenarioZone,
} from "../../model";
import { ActorControls } from "./ActorControls";
import { BaseControls } from "./BaseControls";
import {
  editBase,
  editBaseLayout,
  type LayoutEdit,
  moveBuilding,
  removeBase,
  removeBlueprint,
  renameBlueprint,
  setBlueprintOrdered,
  setOrigin,
  setQueue,
  sharingLayout,
  substituteQueues,
} from "./bases";
import { ContentsList } from "./ContentsList";
import {
  type ContentEntry,
  contentsSelection,
  sceneContents,
  unplacedLayouts,
} from "./contents";
import {
  canTurn,
  editActor,
  removePlacement,
  setActorState,
  turnPlacement,
} from "./editing";
import type { ScenarioEdit } from "./edits";
import { GroupControls } from "./GroupControls";
import {
  addWaypoint,
  editGroup,
  groupLabel,
  orderWaypoints,
  parsePathKey,
  parsePathLineKey,
  pathLineKey,
  removeGroup,
  targetOptions,
} from "./groups";
import { isTypingTarget } from "./history";
import type { LayoutChoice } from "./layoutPlacing";
import { moveOnMap } from "./mapKeyboard";
import { EDITOR_MODES, LAYOUTS_MODE_ID } from "./modes";
import { pathLabel, removePathWaypoint, scenarioPaths } from "./orderPaths";
import type { RowFocus } from "./problemTargets";
import { startMarkers } from "./startPositions";
import { type MapCursor, useMapKeyboard } from "./useMapKeyboard";
import { useScenarioPaths } from "./useScenarioPaths";
import { useScenarioStarts } from "./useScenarioStarts";
import { useScenarioZones } from "./useScenarioZones";
import { parseZoneKey, removeZone, renameZone, zoneExtent } from "./zones";

/** How long one building of a build order stands on screen before the next one
 *  arrives. Slow enough to read the base going up, brisk enough that a
 *  twenty-building opening is not a coffee break. */
const PLAYBACK_STEP_MS = 700;

/** One list for every "nothing to draw", so a layer with nothing on it is not
 *  cleared and redrawn on every render. */
const NOTHING: FootprintMark[] = [];

/**
 * The scenario's map as the surface it is authored on.
 *
 * The working area, the camera and the ground under it are
 * {@link PlacementSurface}, which the blueprint editor stands on too (issue
 * #1416). What this file adds is everything about a mission: the modes, the
 * zones, the paths, the start positions, the contents list, and the bar for
 * whatever is selected.
 *
 * The terrain, water, sky and lighting are the content browser's 3D map preview
 * unchanged, resolved through unitsync exactly as a campaign mission's backdrop
 * is.
 *
 * The units the document places are drawn on top of it by
 * {@link useScenarioUnits}, and pointing at them is {@link useMapEditing}. The
 * zones, paths and pickers that follow take the same scene the same way.
 *
 * The surface owns which mode is current and what is selected, because both are
 * answers to something that happened on the map. The document is not owned here:
 * every edit goes out through `onChange` and comes back as a new `scenario`.
 *
 * An edit is therefore written as what to make of the document rather than as a
 * finished one: a click that places something, and the click after it, can both
 * be handled before React renders either of them, and the second one has to be
 * built on the first (issue #904). What is selected is read the same way, for
 * the same reason.
 */
export function ScenarioMapScene({
  scenario,
  onChange,
  extensions,
  picking,
  history,
  focus,
}: {
  scenario: Scenario;
  onChange: (edit: ScenarioEdit) => void;
  /** The condition and action types the scenario's game declares for itself, so
   *  an action a game declared carrying orders draws its path too (issue #957).
   *  Read once by the page and handed to every panel that needs it. */
  extensions?: ExtensionTypes;
  /** The editor's undo history. Owned by the page, because it covers the panels
   *  too, and shown here because this is where the author's hands are. */
  history?: {
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;
  };
  /**
   * A point a panel under the map has asked the author to click, or null when
   * nothing is waiting. It joins the same queue a path being drawn and a base
   * being moved are in, so however the question was asked there is one bar
   * saying the map is waiting and one click that answers it.
   */
  picking?: {
    message: ReactNode;
    onPick: (pos: Point) => void;
    onDone: () => void;
    /** The path the points are going into, when they are going into one, so it
     *  is the path drawn with knobs while the author draws it (#847). */
    pathId?: string;
  } | null;
  /**
   * An entry a mission problem's row points at (issue #2271): a placement off
   * the map, a zone with nothing in it. `id` is the same selection key
   * `sceneContents` hands `ContentsList`, so landing on it is exactly what
   * picking the matching row out of Contents already does.
   */
  focus?: RowFocus | null;
}) {
  const mapName = scenario.setup.mapName;
  // The map's own 16 bit heights as well as the picture of them, because the
  // buildings placed here are checked against the ground they stand on and the
  // engine's rule is arithmetic over those exact numbers (issue #1490).
  const assets = useMissionMapAssets(mapName, true);
  const { loading: enginesLoading } = usePreferredTarget();
  const sceneRef = useRef<MapScene3D | null>(null);
  // Also held in state, because the units layer is built from it and a ref
  // does not re-render the hook that owns that layer.
  const [handle, setHandle] = useState<MapScene3D | null>(null);

  /**
   * The base being watched go up, and how much of it is standing (issue #1418).
   *
   * `step` is how many of the layout's buildings have been built, so 0 is bare
   * ground and the last step is the base as the document holds it. Held as
   * loosely as a base waiting to be moved: a base that has been deleted, or a
   * layout that is no longer a build order, stops the playback rather than
   * stranding it.
   */
  const [playback, setPlayback] = useState<{
    base: string;
    step: number;
    playing: boolean;
  } | null>(null);
  const watched = playback
    ? scenario.bases.find((b) => b.id === playback.base)
    : undefined;
  const watchedLayout = watched
    ? scenario.blueprints.find((b) => b.id === watched.blueprint)
    : undefined;
  const steps = watchedLayout?.ordered ? watchedLayout.buildings : [];
  const playing = playback && steps.length > 0 ? playback : null;

  // What is not standing yet, which is everything the playback has not reached.
  // Only the drawing is held back: the document is untouched, so the footprints
  // still show the whole plan the base is being built into.
  const undrawn = useMemo(() => {
    if (!playing) return null;
    const out = new Set<string>();
    for (let at = playing.step; at < steps.length; at++) {
      out.add(placementKey("base", playing.base, at));
    }
    return out;
  }, [playing, steps.length]);

  const units = useScenarioUnits(handle, scenario, assets, undrawn);

  // Playing it means one step at a time on its own until the base is up. It
  // stops there rather than looping, because the end of a build order is the
  // base, and a base that keeps vanishing and rebuilding itself is a thing to
  // watch rather than a thing to read.
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
  // An author who has asked for less motion gets the steps and not the film.
  const reduceMotion = useReduceMotion();
  const [modeId, setModeId] = useState(EDITOR_MODES[0].id);
  const [selected, showSelected] = useState<string | null>(null);
  // Also held in a ref, because a click that selects something and the click
  // that acts on that selection can both land before React renders: placing a
  // building adds it to the base the click before it selected (issue #904).
  const selectedRef = useRef<string | null>(null);
  const setSelected = useCallback((key: string | null) => {
    selectedRef.current = key;
    showSelected(key);
  }, []);
  // Which base the author asked to edit the shared layout of (issue #1414).
  // Held against the base rather than as a mode of the editor, so working on
  // another base is back to the answer that loses nobody's work: a copy.
  const [sharedBase, setSharedBase] = useState<string | null>(null);
  const layoutEdit = (id: string | null | undefined): LayoutEdit =>
    id && id === sharedBase ? "shared" : "own";
  // What the Layouts mode is about to place, and whether the contents list is
  // open. Both are here because one press in that list sets the first, switches
  // the mode and shuts the second (issue #1450).
  const [layoutChoice, setLayoutChoice] = useState<LayoutChoice | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);

  // Every mode is resolved on every render, in the order of a static list, so
  // each one may hold state of its own.
  const mode = EDITOR_MODES.find((m) => m.id === modeId) ?? EDITOR_MODES[0];
  const behaviours = EDITOR_MODES.map((m) =>
    m.use({
      scenario,
      onChange,
      selected,
      selectedNow: () => selectedRef.current,
      onSelect: setSelected,
      layoutEdit,
      layout: layoutChoice,
      onLayout: setLayoutChoice,
    }),
  );
  const behaviour = behaviours[EDITOR_MODES.indexOf(mode)];

  // A zone key names either the zone or one of its resize handles, and both
  // mean the same zone is what is selected.
  const zoneRef = selected ? parseZoneKey(selected) : null;
  const pickedZone =
    scenario.zones.find((zone) => zone.id === zoneRef?.id) ?? null;

  const { draftZones } = behaviour;
  const zones = useMemo(
    () => (draftZones ? [...scenario.zones, ...draftZones] : scenario.zones),
    [scenario.zones, draftZones],
  );
  const zonesLayer = useScenarioZones(
    handle,
    zones,
    assets,
    units.groundAt,
    pickedZone?.id ?? null,
  );

  // The map's own start positions, which is what an author orients against and
  // the only way to see where a participant would come down.
  const { startPositions } = assets;
  const { setup } = scenario;
  const starts = useMemo(
    () => startMarkers(startPositions, setup),
    [startPositions, setup],
  );
  useScenarioStarts(handle, starts, assets, units.groundAt);

  const groups = scenario.groups;
  /**
   * What a click on the map selects.
   *
   * A drawn path line stands for the orders that drew it: the line is the
   * easiest thing on a big map to hit and the orders are what an author who hit
   * it wants (#842). A group's line means the group, because a group has units
   * to select and controls to open. A trigger's line means itself, because it
   * has neither, and selecting it is what puts knobs on its points.
   */
  const select = useCallback(
    (key: string | null) => {
      const line = key ? parsePathLineKey(key) : null;
      if (!line) return setSelected(key);
      const group = groups.some((one) => one.id === line);
      setSelected(group ? placementKey("group", line, 0) : key);
    },
    [groups, setSelected],
  );

  const picked = units.placements.find((p) => p.key === selected) ?? null;
  // A group is what is being worked on whether one of its units or one of its
  // waypoints was clicked, so both answer the same question.
  const pathRef = selected ? parsePathKey(selected) : null;
  const pickedGroup =
    groups.find(
      (group) =>
        group.id ===
        (pathRef?.groupId ?? (picked?.kind === "group" ? picked.id : null)),
    ) ?? null;

  // Every path the document draws, a group's own and the ones its triggers hand
  // out, so an author drawing either can see what they are drawing (#847).
  const paths = useMemo(
    () => scenarioPaths(scenario, extensions),
    [scenario, extensions],
  );
  const selectedLine = selected ? parsePathLineKey(selected) : null;
  // Which of them is being worked on, and so gets knobs on its points: the one a
  // panel is putting points into, failing that the one a point or a line of is
  // selected, failing that the selected group's own.
  const activePath =
    picking?.pathId ??
    pathRef?.groupId ??
    selectedLine ??
    pickedGroup?.id ??
    null;
  const pathsLayer = useScenarioPaths(
    handle,
    paths,
    assets,
    units.groundAt,
    activePath,
    pathRef ? selected : null,
  );

  // Which order the map is putting points into. Held loosely: it is only obeyed
  // while its group is still the selection and its order is still one that has a
  // path, so deleting either of them ends the drawing rather than stranding it.
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

  // Which base the map is waiting for a point for, held as loosely as a path
  // being drawn: a base that has been deleted stops the map waiting for it.
  const [movingBase, setMovingBase] = useState<string | null>(null);
  const moving = scenario.bases.some((b) => b.id === movingBase)
    ? movingBase
    : null;

  // Answering a question the author asked is what a click means while one is
  // outstanding, in whatever mode: a point on a path being drawn, or the place
  // a base is being moved to, rather than something new being placed.
  const onPlace = drawingPath
    ? (pos: Point) =>
        onChange((doc) =>
          addWaypoint(doc, drawingPath.groupId, drawingPath.order, pos),
        )
    : moving
      ? (pos: Point) => {
          onChange((doc) => setOrigin(doc, moving, pos));
          setMovingBase(null);
        }
      : (picking?.onPick ?? behaviour.place);

  // The game's own units, for the panels that pick one and for the build grid
  // every base building is dragged and turned onto.
  const gameUnits = useGameUnits(scenario.setup.gameName);
  const snap = useMemo(() => buildGridSnap(gameUnits.units), [gameUnits.units]);
  // What the game calls each side's units, which is all a base's conversion
  // needs beyond the units themselves (issue #1466).
  const gameSides = useGameSides(gameUnits.archive);

  // The ground each of those buildings stands on, and which of them are fighting
  // over it. Drawn for the whole document rather than for the selected base, so
  // a layout that cannot be built says so without being clicked on first.
  // Which of them the map's terrain will not take goes in the same pass (issue
  // #1315): a base whose half floats is a mission that ships broken, and this
  // is where the layout is sitting on the real ground it will be played on.
  const footprints = useMemo(
    () => baseFootprints(units.placements, gameUnits.units, units.ground),
    [units.placements, gameUnits.units, units.ground],
  );
  // The same two questions asked about a layout the pointer is carrying rather
  // than about one the document holds, so an author placing a whole base sees
  // where it lands before they land it (issue #1464). Built once per game and
  // map, because a pointer move must not cost a scan of the unit dataset.
  const checks = useMemo(
    () => previewChecks(gameUnits.units, units.ground),
    [gameUnits.units, units.ground],
  );
  // A map with no sea refuses every naval building on it wherever it is put, so
  // that is said once about the map instead of once per building (issue #1536).
  // Held back until the reads have settled, like the unchecked note beside it.
  const waterless = units.settled
    ? sceneWaterless(footprints, units.ground)
    : null;
  const preview = useLayoutPreview({
    handle,
    worldWidth: assets.worldWidth,
    worldHeight: assets.worldHeight,
    groundAt: units.groundAt,
    ghost: behaviour.ghost ?? null,
    checks,
    occupied: footprints,
    placements: units.placements,
  });

  // Taking the offer of a spot the layout fits (issue #1482). A key rather than
  // a button, because the offer is about where the pointer is and the pointer
  // reaching a button in the panel is the pointer off the map, which puts the
  // preview and the offer with it away. It does exactly what a click at the
  // offered point would do, so nothing about the placement is special.
  const offered = preview.nudge;
  const takeNudge = preview.nudgeAt;
  useEffect(() => {
    if (!offered || offered === "nowhere" || !onPlace) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "n") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      const at = takeNudge();
      if (!at) return;
      event.preventDefault();
      onPlace(at);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offered, takeNudge, onPlace]);

  // A building being dragged is drawn by the preview, on the squares it will
  // land on, so its own square stays out of the document's until it lands
  // (issue #1512).
  const standing = useMemo(
    () => withoutBuilding(footprints, preview.dragging),
    [footprints, preview.dragging],
  );
  useScenarioFootprints(
    handle,
    standing,
    assets,
    units.groundAt,
    "standing",
    selected,
  );

  // The ground the selected building stands on: what says it is selected, and
  // what the pointer can take hold of to move it (issue #1716). Null for
  // everything else the map can select, which is everything with no footprint.
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
            scenario,
            selected,
            checks.footprintOf,
            footprints,
            checks.standingOf,
          )
        : NOTHING,
    [turning, selected, scenario, checks, footprints],
  );
  useScenarioFootprints(handle, turned, assets, units.groundAt, "offered");

  useMapEditing({
    handle,
    layer: units.layer,
    placements: units.placements,
    worldWidth: assets.worldWidth,
    worldHeight: assets.worldHeight,
    groundAt: units.groundAt,
    selected,
    footprintAt,
    // A zone is a sheet lying over the ground, so it steps aside for a mode
    // that puts things on the ground: otherwise a zone covering a corner of the
    // map would be a corner of the map nothing could be placed on. A waypoint
    // is a knob rather than a sheet, so it covers nothing and stays pickable.
    overlays: [onPlace ? null : zonesLayer, pathsLayer],
    onSelect: select,
    onPlace,
    onHover: preview.onHover,
    onDragUnit: preview.onDragUnit,
    onDragGround: behaviour.draw ?? null,
    // The same edit the arrow keys make, through the same function, so a drag
    // and a nudge cannot drift apart (issue #2269).
    onMove: (key, delta) =>
      onChange((doc) => moveOnMap(doc, key, delta, snap, layoutEdit)),
  });

  // A drawn unit is described by the entry it belongs to, and each of the three
  // kinds has a panel of its own.
  const pickedActor =
    (picked?.kind === "actor" &&
      scenario.actors.find((a) => a.id === picked.id)) ||
    null;
  const pickedBase =
    (picked?.kind === "base" &&
      scenario.bases.find((b) => b.id === picked.id)) ||
    null;
  // The layout it is placed from, which is what its name, its build order and
  // its sharing are all about.
  const pickedLayout = pickedBase
    ? scenario.blueprints.find((b) => b.id === pickedBase.blueprint)
    : undefined;

  /**
   * A group's own controls, wherever the group was reached from.
   *
   * Built once here rather than inside the bar for a selected unit, because a
   * waypoint is as much a way of working on a group as one of its units is, and
   * an author who picked a point off a path should not have to find a unit
   * again to change the order that point belongs to (#842).
   */
  const groupControls = pickedGroup ? (
    <GroupControls
      key={pickedGroup.id}
      group={pickedGroup}
      participants={scenario.setup.participants}
      units={gameUnits.units}
      unitsLoading={gameUnits.loading}
      targets={targetOptions(scenario, pickedGroup.id)}
      onEdit={(patch) => {
        onChange((doc) => editGroup(doc, pickedGroup.id, patch));
        if (patch.units?.length === 0) setSelected(null);
      }}
      onDelete={() => {
        onChange((doc) => removeGroup(doc, pickedGroup.id));
        setSelected(null);
      }}
      drawing={drawing?.groupId === pickedGroup.id ? drawing.order : null}
      onDraw={(order) =>
        setDrawing(order === null ? null : { groupId: pickedGroup.id, order })
      }
    />
  ) : null;

  const status = mapSceneStatus({
    mapName,
    hasEngine: !!assets.enginePath && !!assets.dataDir,
    enginesLoading,
    assetsLoading: assets.loading,
    ready: assets.ready,
  });

  // What the document has put on the map, for the list that finds it again.
  const entries = useMemo(() => sceneContents(scenario), [scenario]);
  const listed = contentsSelection(entries, selected);
  // And what it holds without placing, which the map cannot show at all.
  const layouts = useMemo(() => unplacedLayouts(scenario), [scenario]);

  /**
   * Look closely at a point on the map.
   *
   * The camera is put where it would be if the author had zoomed in on the
   * place themselves, rather than moved along a path: what matters is arriving,
   * and a scene this heavy is not one to animate a flight across.
   */
  const focusOn = useCallback(
    (pos: Point, span: number) => {
      const handle = sceneRef.current;
      if (!handle) return;
      const { camera, controls, render, scale } = handle;
      const at = worldToScene(
        pos,
        assets.worldWidth,
        assets.worldHeight,
        scale,
      );
      const distance = Math.min(
        controls.maxDistance,
        Math.max(controls.minDistance, focusDistance(span) * scale),
      );
      // Looked at where it stands rather than at sea level, or a thing on a
      // ridge would arrive at the top of the view and one in a valley below it.
      const height = units.groundAt(pos) * scale;
      const stand = focusCamera(at, distance);
      controls.target.set(at.x, height, at.z);
      camera.position.set(stand.x, height + stand.y, stand.z);
      controls.update();
      render();
    },
    [assets.worldWidth, assets.worldHeight, units.groundAt],
  );

  /** Picking something out of the list is the same two things a click that
   *  lands on it would be: it is selected, and it is on screen. */
  const pickEntry = useCallback(
    (entry: ContentEntry) => {
      setSelected(entry.key);
      focusOn(entry.pos, entry.span);
    },
    [focusOn, setSelected],
  );

  const onScene = useCallback((handle: MapScene3D | null) => {
    sceneRef.current = handle;
    setHandle(handle);
  }, []);

  /**
   * The point the view is looking at, which is what the keyboard aims with
   * (issue #2269).
   *
   * The camera's own target rather than a cursor of its own: it is already on
   * screen, already held over the map by the surface, and already the thing the
   * Frame button and the contents list move. One cursor, moved by everything
   * that moves the view.
   */
  const cursorAt = useCallback((): MapCursor | null => {
    const handle = sceneRef.current;
    if (!handle) return null;
    const { target } = handle.controls;
    const pos = clampToMap(
      sceneToWorld(
        { x: target.x, z: target.z },
        assets.worldWidth,
        assets.worldHeight,
        handle.scale,
      ),
      assets.worldWidth,
      assets.worldHeight,
    );
    return { pos, height: units.groundAt(pos) };
  }, [assets.worldWidth, assets.worldHeight, units.groundAt]);

  /** Move that point, camera and all, and draw the one frame it needs. The
   *  surface's own clamp catches the edges of the map, off the change the
   *  controls fire. */
  const panBy = useCallback((delta: Point) => {
    const handle = sceneRef.current;
    if (!handle) return;
    const { camera, controls, render, scale } = handle;
    const step = { x: delta.x * scale, z: delta.z * scale };
    controls.target.x += step.x;
    controls.target.z += step.z;
    camera.position.x += step.x;
    camera.position.z += step.z;
    controls.update();
    render();
  }, []);

  const keys = useMapKeyboard({
    things: { scenario, entries, placements: units.placements, paths },
    onChange,
    selected,
    onSelect: setSelected,
    onEntry: pickEntry,
    onPlace,
    snap,
    layoutEdit,
    cursorAt,
    panBy,
  });

  // Mirrored in refs so a mission problem's row can land on whatever the map
  // currently holds without retriggering every time an unrelated edit gives
  // `entries` a new array identity. The effect below only has to run again
  // when the row asked for changes (issue #2271).
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const pickEntryRef = useRef(pickEntry);
  pickEntryRef.current = pickEntry;
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus.id and focus.token are the trigger, not the object identity. `entries` and `pickEntry` are read through the refs above on purpose, so an unrelated edit that gives them a new identity does not retrigger this and snap the camera back.
  useEffect(() => {
    if (!focus) return;
    const entry = entriesRef.current.find((e) => e.key === focus.id);
    if (entry) pickEntryRef.current(entry);
  }, [focus?.id, focus?.token]);

  /** What is shown instead of the map when there is no map to show. */
  const stand =
    status === "no-map" ? (
      <SurfaceMessage icon={<Layers className="size-6" />}>
        Pick a setup to choose the map this scenario is authored on.
      </SurfaceMessage>
    ) : status === "loading" ? (
      <SurfaceMessage
        icon={<Loader2 className="size-6 animate-spin opacity-40" />}
      >
        Reading {mapName}…
      </SurfaceMessage>
    ) : status === "no-engine" ? (
      <SurfaceMessage icon={<Unplug className="size-6" />}>
        <p>
          Coilbox reads maps through an engine, and there is no engine installed
          to read {mapName} with.
        </p>
        <Link
          to="/settings/engines"
          className="mt-1 inline-block underline underline-offset-2 hover:text-foreground"
        >
          Install an engine
        </Link>
      </SurfaceMessage>
    ) : status === "error" ? (
      <SurfaceMessage icon={<MountainSnow className="size-6" />}>
        <p>
          {mapName} could not be read. It is most likely not installed for the
          engine coilbox is using.
        </p>
        {assets.error && (
          <p className="mt-1 font-mono text-xs opacity-70">{assets.error}</p>
        )}
        <Link
          to="/content/maps"
          className="mt-1 inline-block underline underline-offset-2 hover:text-foreground"
        >
          Manage maps
        </Link>
      </SurfaceMessage>
    ) : null;

  return (
    <PlacementSurface
      ground={{
        kind: "map",
        heightSrc: assets.heightSrc,
        heightRange: assets.heightRange,
        heightWords: assets.heightWords,
        textureSrc: assets.textureSrc,
        skyboxSrc: assets.skyboxSrc,
        appearance: assets.appearance,
        minHeight: assets.minHeight,
        maxHeight: assets.maxHeight,
        worldWidth: assets.worldWidth,
        worldHeight: assets.worldHeight,
      }}
      onScene={onScene}
      frameLabel="Frame map"
      stand={stand}
      keyboard={{
        label: mapName ? `Scenario map, ${mapName}` : "Scenario map",
        help: keys.help,
        said: keys.said,
        cursor: keys.cursor,
        onKeyDown: keys.onKeyDown,
        onFocus: keys.onFocus,
      }}
      bars={
        <>
          {/* The whole row shares one backdrop rather than each control finding
            its own: a mode's `controls` are arbitrary (selects, a count field,
            a button), so painting the panel once is what makes every one of
            them opaque over the map, present ones and any added later, rather
            than a fix repeated per control. Same fill and blur as the mode
            strip itself carried before this row grew one, so the toolbar
            reads as one panel rather than a solid strip beside naked
            controls (issue #1188). */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-card/80 p-1 backdrop-blur">
            <ToggleGroup
              type="single"
              variant="outline"
              value={mode.id}
              onValueChange={(next) => next && setModeId(next)}
              aria-label="Placement mode"
            >
              {EDITOR_MODES.map((m) => (
                <ToggleGroupItem
                  key={m.id}
                  value={m.id}
                  className="h-8 gap-1.5"
                >
                  <m.icon className="size-3.5" /> {m.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {behaviour.controls}
          </div>
          <p className="w-fit rounded bg-card/70 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
            {mode.hint}
          </p>
          {/* What the squares under the pointer are saying, said in words as
              well: a mark is a colour, and a colour on its own is not a
              statement anybody can act on (issue #1464). */}
          {preview.count && (
            <p
              className={`w-fit rounded px-2 py-1 text-[11px] backdrop-blur ${
                previewTrouble(preview.count)
                  ? "bg-amber-950/80 text-amber-200"
                  : "bg-card/70 text-muted-foreground"
              }`}
            >
              {previewSentence(preview.count)}
            </p>
          )}
          {/* Where it would fit instead, offered rather than done: the engine
              builds one of a pair of overlapping buildings, and a ruined base
              with buildings inside each other is a real thing an author might
              mean, so nothing moves until somebody asks (issue #1482). */}
          {preview.nudge && (
            <p className="w-fit rounded bg-card/70 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
              {nudgeSentence(preview.nudge)}
            </p>
          )}
          {/* What is true of the whole map at once, said once here rather than
              per base in a popover two clicks away (issue #1496). Held back
              until the reads have settled, so an editor opening does not greet
              anybody with a warning that clears itself. */}
          <UncheckedNote
            unchecked={units.settled ? sceneUnchecked(footprints) : null}
            flattened={units.heightsUnread}
          />
          <WaterlessNote floor={waterless} />
          {picked && (
            <ScenarioSelectionBar
              placement={picked}
              onTurnPreview={setTurning}
              onTurn={() =>
                onChange((doc) =>
                  turnPlacement(doc, picked.key, 1, layoutEdit(picked.id)),
                )
              }
              onDelete={() => {
                onChange((doc) =>
                  removePlacement(doc, picked.key, layoutEdit(picked.id)),
                );
                setSelected(null);
              }}
            >
              {pickedActor && (
                <ActorControls
                  key={pickedActor.id}
                  actor={pickedActor}
                  participants={scenario.setup.participants}
                  onEdit={(patch) =>
                    onChange((doc) => editActor(doc, pickedActor.id, patch))
                  }
                  onState={(state) =>
                    onChange((doc) => setActorState(doc, pickedActor.id, state))
                  }
                />
              )}
              {picked.kind === "group" && groupControls}
              {picked.kind === "base" && pickedBase && (
                <BaseControls
                  key={`${pickedBase.id}#${picked.index}`}
                  base={pickedBase}
                  buildings={baseBuildings(scenario.blueprints, pickedBase)}
                  index={picked.index}
                  layout={pickedLayout}
                  layoutName={pickedLayout?.name ?? ""}
                  ordered={pickedLayout?.ordered === true}
                  sharedWith={sharingLayout(scenario, pickedBase.id).length}
                  sharedEdit={sharedBase === pickedBase.id}
                  overlaps={overlappingIn(
                    units.placements,
                    footprints,
                    pickedBase.id,
                  )}
                  unstable={unstableIn(
                    units.placements,
                    footprints,
                    pickedBase.id,
                  )}
                  tooDeep={tooDeepIn(
                    units.placements,
                    footprints,
                    pickedBase.id,
                  )}
                  // Nothing on a map with no water, where every one of these is
                  // refused for the same reason and the surface says that
                  // reason once (issue #1536). Naming them here as well would
                  // be the wall of cyan written out in words. Only this half:
                  // a map with no sea is why a building wants water it cannot
                  // find, and never why one is under too much (issue #1552).
                  tooShallow={
                    waterless === null
                      ? tooShallowIn(
                          units.placements,
                          footprints,
                          pickedBase.id,
                        )
                      : []
                  }
                  // Only once the reads are in. Before that everything is
                  // unjudged for a moment, and a panel opening on a wall of
                  // warnings that clears itself teaches an author to ignore it
                  // (issue #1491).
                  noSlope={
                    units.settled
                      ? noSlopeIn(units.placements, footprints, pickedBase.id)
                      : undefined
                  }
                  absent={absentIn(units.placements, footprints, pickedBase.id)}
                  designedFor={pickedLayout?.designedFor}
                  onMap={mapName}
                  participants={scenario.setup.participants}
                  units={gameUnits.units}
                  unitsLoading={gameUnits.loading}
                  sides={gameSides}
                  gameArchive={gameUnits.archive}
                  moving={moving === pickedBase.id}
                  onEdit={(patch) =>
                    onChange((doc) => editBase(doc, pickedBase.id, patch))
                  }
                  onRename={(name) =>
                    onChange((doc) =>
                      renameBlueprint(
                        doc,
                        pickedBase.id,
                        name,
                        layoutEdit(pickedBase.id),
                      ),
                    )
                  }
                  onOrdered={(on) =>
                    onChange((doc) =>
                      setBlueprintOrdered(
                        doc,
                        pickedBase.id,
                        on,
                        layoutEdit(pickedBase.id),
                      ),
                    )
                  }
                  // The selection stays where it is rather than following the
                  // building that moved, because what is selected here is a place
                  // in the base: the bar above calls it "base building 3".
                  onMoveBuilding={(at, delta) =>
                    onChange((doc) =>
                      moveBuilding(
                        doc,
                        pickedBase.id,
                        at,
                        delta,
                        layoutEdit(pickedBase.id),
                      ),
                    )
                  }
                  onPlay={() =>
                    setPlayback({
                      base: pickedBase.id,
                      step: 0,
                      playing: !reduceMotion,
                    })
                  }
                  onSharedEdit={(on) =>
                    setSharedBase(on ? pickedBase.id : null)
                  }
                  onQueue={(queue, repeat) =>
                    onChange((doc) =>
                      setQueue(doc, pickedBase.id, picked.index, queue, repeat),
                    )
                  }
                  onMove={(on) => setMovingBase(on ? pickedBase.id : null)}
                  // A layout edit, so it copies a shared layout rather than
                  // moving every base placed from it, and the history holds it
                  // like any other (#1427).
                  onSnapToGrid={() =>
                    onChange((doc) =>
                      editBaseLayout(
                        doc,
                        pickedBase.id,
                        layoutEdit(pickedBase.id),
                        (buildings) =>
                          onBuildGrid(
                            buildings,
                            buildingFootprints(gameUnits.units),
                            pickedBase.origin,
                          ),
                      ),
                    )
                  }
                  // A layout edit like the snap above, so converting one of two
                  // bases placed from a layout converts one of them (#1466).
                  // The queues are the base's rather than the layout's, so they
                  // go through the plan first, while the bases sharing the
                  // layout are still the bases sharing it (#1493).
                  onSubstitute={(next, plan) =>
                    onChange((doc) => {
                      const how = layoutEdit(pickedBase.id);
                      return editBaseLayout(
                        substituteQueues(doc, pickedBase.id, plan, how),
                        pickedBase.id,
                        how,
                        () => next.buildings,
                      );
                    })
                  }
                  onDelete={() => {
                    onChange((doc) => removeBase(doc, pickedBase.id));
                    setSelected(null);
                  }}
                />
              )}
            </ScenarioSelectionBar>
          )}
          {/* What the outlined square beside the selected building is, while a
              turn is being considered (issue #1541). Nothing for an actor,
              which stands on no build squares at all.

              Below the bar rather than above it (issue #1716): the note appears
              while the pointer is on the Turn button, and a note above the bar
              pushes that button out from under the pointer, which takes the
              note away, which puts the button back. */}
          <TurnNote
            moves={
              turning && picked?.kind === "base" ? turned.length > 0 : null
            }
          />
          {drawingPath && pickedGroup && (
            <ClickMapBar
              message={
                <>
                  Click the map to add points to{" "}
                  <span className="font-mono">
                    {groupLabel(scenario.groups, pickedGroup.id)} ·{" "}
                    {pickedGroup.orders[drawingPath.order].kind}
                  </span>
                </>
              }
              onDone={() => setDrawing(null)}
              onAt={onPlace}
              worldWidth={assets.worldWidth}
              worldHeight={assets.worldHeight}
            />
          )}
          {moving && (
            <ClickMapBar
              message="Click the map to put this base's origin there, buildings and all"
              onDone={() => setMovingBase(null)}
              onAt={onPlace}
              worldWidth={assets.worldWidth}
              worldHeight={assets.worldHeight}
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
                      // Playing from the end starts again, so the button is never
                      // one that does nothing.
                      step: on && at.step >= total ? 0 : at.step,
                    },
                )
              }
              onDone={() => setPlayback(null)}
            />
          )}
          {picking && !drawingPath && !moving && (
            <ClickMapBar
              message={picking.message}
              onDone={picking.onDone}
              onAt={onPlace}
              worldWidth={assets.worldWidth}
              worldHeight={assets.worldHeight}
            />
          )}
          {pathRef && selected && (
            <PathBar
              what={`${pathLabel(paths, pathRef.groupId)} · point ${
                pathRef.waypoint + 1
              }`}
              hint="drag it to move it"
              // Back to the path the point belonged to rather than to nothing, so
              // its other points keep their knobs and a path being drawn is still
              // being drawn.
              onDelete={() => {
                onChange((doc) => removePathWaypoint(doc, selected));
                setSelected(
                  pickedGroup
                    ? placementKey("group", pathRef.groupId, 0)
                    : pathLineKey(pathRef.groupId),
                );
              }}
            >
              {groupControls}
            </PathBar>
          )}
          {selectedLine && (
            <PathBar
              what={pathLabel(paths, selectedLine)}
              hint="drag one of its points to move it"
            />
          )}
          {pickedZone && (
            <ZoneBar
              key={pickedZone.id}
              zone={pickedZone}
              onRename={(name) =>
                onChange((doc) => renameZone(doc, pickedZone.id, name))
              }
              onDelete={() => {
                onChange((doc) => removeZone(doc, pickedZone.id));
                setSelected(null);
              }}
            />
          )}
        </>
      }
      chrome={
        <>
          {history && <HistoryControls {...history} />}
          <Popover open={contentsOpen} onOpenChange={setContentsOpen}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 bg-card/80 backdrop-blur"
                title="Everything this scenario holds, placed or not"
              >
                <List className="size-3.5" /> Contents
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-1">
              <ContentsList
                entries={entries}
                layouts={layouts}
                selected={listed}
                participants={scenario.setup.participants}
                onPick={pickEntry}
                // Armed rather than placed. Where a base stands is the reason
                // the author deleted it, so the next click on the map is the
                // placement and this only gets them ready to make it (#1450).
                onPlaceLayout={(layout) => {
                  setLayoutChoice({ from: "scenario", id: layout.id });
                  setModeId(LAYOUTS_MODE_ID);
                  setContentsOpen(false);
                }}
                onDeleteLayout={(layout) =>
                  onChange((doc) => removeBlueprint(doc, layout.id))
                }
              />
            </PopoverContent>
          </Popover>
        </>
      }
      note={
        <UnitsNote
          units={units}
          gameName={scenario.setup.gameName}
          drawing={units.drawing}
        />
      }
      footer={
        <>
          {mapName} · drag or middle-drag to pan · drag a unit to move it · drag
          a zone's middle handle to move it · right-drag to turn the view ·
          scroll to zoom
        </>
      }
    />
  );
}

/**
 * What is selected, said the way this document names it.
 *
 * The bar itself is shared with the blueprint editor. What is not shared is what
 * a placement is called here: an actor, one of a group's units, or one of a
 * base's buildings.
 */
function ScenarioSelectionBar({
  placement,
  onTurn,
  onTurnPreview,
  onDelete,
  children,
}: {
  placement: Placement;
  onTurn: () => void;
  /** Whether a turn is being considered, which draws where it would go. */
  onTurnPreview: (on: boolean) => void;
  onDelete: () => void;
  /** Controls for what kind of thing this is: an actor's team and its
   *  overrides, and whatever a group or a base grows later. */
  children?: ReactNode;
}) {
  return (
    <SelectionBar
      def={placement.def}
      what={
        placement.kind === "actor"
          ? "actor"
          : placement.kind === "group"
            ? `group unit ${placement.index + 1}`
            : `base building ${placement.index + 1}`
      }
      turnable={canTurn(placement.key)}
      turnHint="A group's units all face south"
      onTurn={onTurn}
      onTurnPreview={onTurnPreview}
      onDelete={onDelete}
    >
      {children}
    </SelectionBar>
  );
}

/**
 * The selected zone: its name, its size, and the way to delete it.
 *
 * The name is what triggers pick a zone by, so it is the one thing about a zone
 * that cannot be set by dragging and the only field here. It is committed when
 * the box is left rather than on every keystroke, because every change to the
 * document is written to disk.
 *
 * Mounted per zone by its id, so moving the selection reseeds the box. A zone's
 * id is not its name, so renaming one does not reseed it, and the box has to
 * follow the name when the name changes on its own. That is what an undo does
 * (issue #2185): before this, the box carried on showing the name from before
 * the step back, and the next keystroke wrote it over the restored one.
 */
export function ZoneBar({
  zone,
  onRename,
  onDelete,
}: {
  zone: ScenarioZone;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useFieldText(zone.name);
  const { halfX, halfZ } = zoneExtent(zone);
  const size =
    zone.shape === "circle"
      ? `circle · radius ${zone.radius}`
      : `box · ${Math.round(halfX * 2)} × ${Math.round(halfZ * 2)}`;

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed) onRename(trimmed);
    else setName(zone.name);
  };

  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-card/85 p-1 pl-2 backdrop-blur">
      <Input
        aria-label="Zone name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-7 w-40 text-xs"
      />
      <span className="font-mono text-[11px] text-muted-foreground">
        {size}
      </span>
      <span className="text-[11px] text-muted-foreground">
        drag the orange handle to move it, a white one to resize it
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" /> Delete
      </Button>
    </div>
  );
}

/**
 * A question the map is waiting for an answer to: a path being drawn, a base
 * being moved, or a point a trigger asked for.
 *
 * Its own bar rather than a line in the panel that asked, because while one of
 * these is outstanding the click that answers it is also the click that would
 * otherwise place something, and that is worth saying where it cannot be missed.
 *
 * It also carries the answer that needs no map at all: two numbers typed in
 * (issue #2269). A trigger's point is often one an author already knows, copied
 * off another trigger or read out of a start position, and aiming a 3D view at a
 * number you already have is work nobody should have to do. It is also the one
 * way of answering that asks nothing of eyesight or of a steady hand.
 */
function ClickMapBar({
  message,
  onDone,
  onAt,
  worldWidth,
  worldHeight,
}: {
  message: ReactNode;
  onDone: () => void;
  /** Answer with a point, exactly as a click on the map would. Left out when
   *  the map has nothing to answer with, which is a question whose asker has
   *  gone. */
  onAt?: ((pos: Point) => void) | null;
  worldWidth: number;
  worldHeight: number;
}) {
  return (
    <div className="flex w-fit flex-wrap items-center gap-1.5 rounded-md border border-lime-400/60 bg-card/85 p-1 pl-2 backdrop-blur">
      <MapPin className="size-3.5 text-lime-300" />
      <span className="text-[11px]">{message}</span>
      {onAt && (
        <PointFields
          onAt={onAt}
          worldWidth={worldWidth}
          worldHeight={worldHeight}
        />
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={onDone}
      >
        Done
      </Button>
    </div>
  );
}

/**
 * Two numbers and a button, as the answer to a point the map is waiting for.
 *
 * Held to the map, because a point off it is a point the mission cannot use, and
 * cleared after each answer so a question that takes several points is several
 * pairs of numbers rather than an editing job.
 */
function PointFields({
  onAt,
  worldWidth,
  worldHeight,
}: {
  onAt: (pos: Point) => void;
  worldWidth: number;
  worldHeight: number;
}) {
  const [x, setX] = useState("");
  const [z, setZ] = useState("");
  const at = pointFrom(x, z, worldWidth, worldHeight);

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (!at) return;
        onAt(at);
        setX("");
        setZ("");
      }}
    >
      <Input
        aria-label="X in elmos"
        inputMode="numeric"
        placeholder="x"
        value={x}
        onChange={(event) => setX(event.target.value)}
        className="h-7 w-16 text-xs"
      />
      <Input
        aria-label="Z in elmos"
        inputMode="numeric"
        placeholder="z"
        value={z}
        onChange={(event) => setZ(event.target.value)}
        className="h-7 w-16 text-xs"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={!at}
        className="h-7 px-2 text-xs"
      >
        Use
      </Button>
    </form>
  );
}

/** The point two typed fields name, or null when they do not name one on this
 *  map. Whole elmos, which is what a scenario stores. */
export function pointFrom(
  x: string,
  z: string,
  worldWidth: number,
  worldHeight: number,
): Point | null {
  const east = Number(x.trim());
  const south = Number(z.trim());
  if (!x.trim() || !z.trim()) return null;
  if (!Number.isFinite(east) || !Number.isFinite(south)) return null;
  if (east < 0 || east > worldWidth) return null;
  if (south < 0 || south > worldHeight) return null;
  return { x: Math.round(east), z: Math.round(south) };
}

/**
 * The selected waypoint: which order's path it belongs to, the group's own
 * controls, and the way to take the point out. Dragging it is what moves it, so
 * there is nothing else here.
 *
 * The group's controls are here because a point on a path is one of the two ways
 * of working on a group, and the other one used to be the only one that reached
 * them (#842).
 */
function PathBar({
  what,
  hint,
  onDelete,
  children,
}: {
  what: string;
  hint: string;
  /** Left out when a whole path is what is selected rather than one of its
   *  points, because a path is deleted by deleting the order that holds it. */
  onDelete?: () => void;
  /** The group's controls: its team, its units and its orders. */
  children?: ReactNode;
}) {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-card/85 p-1 pl-2 backdrop-blur">
      <span className="font-mono text-[11px]">{what}</span>
      {children}
      <span className="text-[11px] text-muted-foreground">{hint}</span>
      {onDelete && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" /> Delete point
        </Button>
      )}
    </div>
  );
}

/**
 * What was drawn, and what could not be.
 *
 * A scenario can name a unit its game does not have, either because it was
 * written for a different game or because the def was renamed. Those are drawn
 * as marker boxes, which look deliberate enough to be mistaken for a feature, so
 * the count says plainly that they are not units.
 */
function UnitsNote({
  units,
  gameName,
  drawing,
}: {
  units: ScenarioUnitsState;
  gameName: string;
  drawing: boolean;
}) {
  if (units.placed === 0) return null;

  const problem = units.gameMissing
    ? `${gameName || "The scenario's game"} is not installed, so nothing can be drawn with its models.`
    : units.missing.length > 0
      ? `${units.missing.length} unit type${units.missing.length === 1 ? "" : "s"} not in ${gameName}, drawn as boxes: ${units.missing.join(", ")}`
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
        {drawing ? "drawing " : ""}
        {units.placed} unit{units.placed === 1 ? "" : "s"}
      </p>
    </>
  );
}
