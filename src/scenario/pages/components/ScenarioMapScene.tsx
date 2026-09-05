import { Button, Input } from "@picoframe/frame";
import {
  Layers,
  List,
  Loader2,
  MapPin,
  MountainSnow,
  Unplug,
} from "lucide-react";
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
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
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGameUnits } from "@/content/useGameUnits";
import { useReduceMotion } from "@/general/display";
import type { MapScene3D } from "@/lib/mapScene";
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
} from "@/lib/scenarioEditing/bases";
import {
  canTurn,
  duplicatePlacement,
  editActor,
  removePlacement,
  setActorState,
  turnPlacement,
} from "@/lib/scenarioEditing/editing";
import { isTypingTarget } from "@/lib/scenarioEditing/history";
import type { LayoutChoice } from "@/lib/scenarioEditing/layoutPlacing";
import { scenarioPlacements } from "@/lib/scenarioEditing/placements";
import { useFieldText } from "@/lib/useFieldText";
import { UncheckedNote, WaterlessNote } from "@/placement/LayoutControls";
import { PlacementSurface, SurfaceMessage } from "@/placement/PlacementSurface";
import {
  absentIn,
  baseFootprints,
  dragKeys,
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
  placeKind,
  previewArmed,
  previewChecks,
  previewNote,
  turnedMarks,
  withoutBuilding,
} from "@/placement/preview";
import {
  HistoryControls,
  PlaybackBar,
  SelectionBar,
  SelectionTools,
  turnNoteText,
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
import type { MissionIssue } from "../../validate";
import { ActorControls } from "./ActorControls";
import { BaseControls } from "./BaseControls";
import { ContentsList } from "./ContentsList";
import {
  type ContentEntry,
  contentsSelection,
  sceneContents,
  unplacedLayouts,
} from "./contents";
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
import {
  type MapStep,
  type MapThings,
  moveOnMap,
  pointFrom,
  thingWords,
} from "./mapKeyboard";
import { EDITOR_MODES, LAYOUTS_MODE_ID, ZONES_MODE_ID } from "./modes";
import { pathLabel, removePathWaypoint, scenarioPaths } from "./orderPaths";
import type { RowFocus } from "./problemTargets";
import { turnSelectionAround } from "./rigidTurn";
import {
  addedWords,
  addKeys,
  countSelection,
  countWords,
  entryKeys,
  inSelection,
  type MapSelection,
  marqueeWords,
  moveSelection,
  NO_SELECTION,
  primaryKey,
  removedWords,
  removeSelection,
  selectOne,
  stillThere,
  toggleKey,
} from "./selection";
import { modeDigit } from "./shortcuts";
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
/** What a caller outside the map can ask it to do, reached through a ref
 *  (issue #2277): duplicate whichever placement is currently selected. */
export interface ScenarioMapSceneHandle {
  /** Duplicate the selected placement, one build square east and south of it,
   *  selected in its own place. False, and nothing done, when nothing that
   *  Cmd+D duplicates is selected: no placement at all, or a zone or a path
   *  point, which are not placements `duplicatePlacement` reaches. */
  duplicateSelected: () => boolean;
}

export const ScenarioMapScene = forwardRef<
  ScenarioMapSceneHandle,
  {
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
    /** What the validator has found wrong with the mission, so the selection
     *  bar's own fields can say what it is rather than leaving that to the
     *  problems drawer alone (issue #2307, extending #2287's pattern from the
     *  Triggers panel). */
    issues?: MissionIssue[];
  }
>(function ScenarioMapScene(
  { scenario, onChange, extensions, picking, history, focus, issues = [] },
  ref,
) {
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
  /**
   * Everything selected on the map, newest last (issue #2279).
   *
   * `selected` below is the last of them, and it is what every bar, panel and
   * layer that only ever handled one thing goes on reading. That is what makes a
   * multi-selection an addition to this file rather than a rewrite of it: the
   * only things that read the whole list are the ones that act on all of it.
   */
  const [selection, showSelection] = useState<MapSelection>(NO_SELECTION);
  // Also held in a ref, because a click that selects something and the click
  // that acts on that selection can both land before React renders: placing a
  // building adds it to the base the click before it selected (issue #904).
  const selectionRef = useRef<MapSelection>(NO_SELECTION);
  const setSelection = useCallback((next: MapSelection) => {
    selectionRef.current = next;
    showSelection(next);
  }, []);
  const selected = primaryKey(selection);
  /** What a click does to the selection: this instead of what was selected, or
   *  with Shift held, this as well, or out again if it was already in. */
  const setSelected = useCallback(
    (key: string | null, add = false) => {
      setSelection(add ? toggleKey(selectionRef.current, key) : selectOne(key));
    },
    [setSelection],
  );
  // Said through the map's own live region, which `useMapKeyboard` owns. Held in
  // a ref because that hook is resolved further down this render and the
  // callbacks above are built before it.
  const sayRef = useRef<(text: string) => void>(() => {});
  // What the announcements name things by, filled in below once the document has
  // been flattened into the three lists that name them. A ref for the same
  // reason: a click reads it when the click happens, not when the handler was
  // built.
  const thingsRef = useRef<MapThings>({
    scenario,
    entries: [],
    placements: [],
    paths: [],
  });

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
    (key: string | null, add = false) => {
      const line = key ? parsePathLineKey(key) : null;
      const meant = line
        ? groups.some((one) => one.id === line)
          ? placementKey("group", line, 0)
          : key
        : key;
      setSelected(meant, add);
      // Only a Shift-click says anything. A plain click replaces the selection,
      // and the bar that opens for it is the account of that. Six Shift-clicks
      // would otherwise be six sentences nobody asked for (issue #2279).
      if (!add || !meant) return;
      const named = thingWords(thingsRef.current, meant);
      const after = selectionRef.current;
      sayRef.current(
        inSelection(after, meant)
          ? addedWords(named, after)
          : removedWords(named, after),
      );
    },
    [groups, setSelected],
  );

  /** What a marquee selects: everything inside the box, instead of what was
   *  selected or as well as it (issue #2279). */
  const selectMany = useCallback(
    (keys: string[], add: boolean) => {
      const after = add ? addKeys(selectionRef.current, keys) : keys;
      setSelection(after);
      sayRef.current(marqueeWords(keys.length, after));
    },
    [setSelection],
  );

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

  // Every path the document draws, a group's own and the ones its triggers
  // hand out, so an author drawing either can see what they are drawing
  // (#847). Read here, ahead of where it is otherwise needed, because the
  // marquee also reads it, to catch the waypoints standing inside its box
  // (issue #2355).
  const paths = useMemo(
    () => scenarioPaths(scenario, extensions),
    [scenario, extensions],
  );

  // Every mode is resolved on every render, in the order of a static list, so
  // each one may hold state of its own.
  const mode = EDITOR_MODES.find((m) => m.id === modeId) ?? EDITOR_MODES[0];
  const behaviours = EDITOR_MODES.map((m) =>
    m.use({
      scenario,
      onChange,
      selected,
      selectedNow: () => primaryKey(selectionRef.current),
      onSelect: setSelected,
      placements: units.placements,
      paths,
      onSelectMany: selectMany,
      layoutEdit,
      layout: layoutChoice,
      onLayout: setLayoutChoice,
    }),
  );
  const behaviour = behaviours[EDITOR_MODES.indexOf(mode)];

  // 1 to 6 switch mode, outside a text field (issue #2277). A window listener
  // rather than the map's own `onKeyDown`, because the strip these pick from
  // sits above the map and a mode switch is as much for an author who has not
  // touched the map yet as for one who has. The map's own key table in
  // `mapKeys.ts` never claims a bare digit, so this reaches the author
  // whether or not the map itself holds the focus - which is also the moment
  // switching mode is asked for most.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      const at = modeDigit(event);
      if (at === null || at >= EDITOR_MODES.length) return;
      event.preventDefault();
      setModeId(EDITOR_MODES[at].id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // What `ScenarioEditPage`'s routed Cmd+D calls (issue #2277). Read through
  // `selectionRef` rather than the `selected` this closure was rendered with,
  // the same reason a click reads it that way: the selection can have changed
  // in a tick this render has not caught up with yet.
  useImperativeHandle(
    ref,
    () => ({
      duplicateSelected: () => {
        const key = primaryKey(selectionRef.current);
        if (!key) return false;
        // A mutable box rather than a reassigned `let`, the same shape
        // `modes.tsx`'s Bases placement uses to read out of `onChange`'s
        // callback: TypeScript cannot see that the callback runs
        // synchronously, so it will not narrow a plain reassignment back out
        // of `T | null` after the call.
        const outcome: { made: { scenario: Scenario; key: string } | null } = {
          made: null,
        };
        onChange((doc) => {
          outcome.made = duplicatePlacement(doc, key);
          return outcome.made ? outcome.made.scenario : doc;
        });
        if (!outcome.made) return false;
        setSelected(outcome.made.key);
        return true;
      },
    }),
    [onChange, setSelected],
  );

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

  // What a click on the map would do, from the same three conditions
  // `previewArmed`'s `answering` and `previewNote`'s stand down for: a path
  // being drawn, a base's origin being moved, a point a panel asked for, or
  // else whatever is armed. Computed once so the ghost, the sentence over the
  // terrain and the keyboard's own announcement (issue #2359) all name the
  // same click.
  const placing = placeKind(drawingPath, moving, picking);

  // Whether the map is waiting for a point: a path being drawn, a base being
  // moved, or a point a panel asked for. While one of those is outstanding its
  // bar is the only thing the map says over the terrain (issue #2285).
  const answering = placing.kind !== "arm";

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
  // The same two questions, asked of a document the keyboard has not drawn yet
  // (issue #2315): a move or a turn has to hear the verdict the document will
  // carry once the edit lands, not the one `footprints` above still holds from
  // before the key was pressed. Flattened the same way `units.placements` is,
  // through the same snap, so the two never disagree about where a building
  // will actually stand.
  const footprintsAt = useCallback(
    (doc: Scenario) =>
      baseFootprints(
        scenarioPlacements(doc, snap),
        gameUnits.units,
        units.ground,
      ),
    [snap, gameUnits.units, units.ground],
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
    // Nothing armed while the map is waiting for a point (issue #2349): the
    // coming click answers that question rather than placing what is armed,
    // so a ghost still under the pointer would be showing a placement the
    // click will not make. `answering` is the same flag the sentence over the
    // terrain stands down for, below.
    ghost: previewArmed(behaviour.ghost ?? null, answering),
    checks,
    occupied: footprints,
    placements: units.placements,
  });
  // The one thing said over the terrain about where the pointer is: what the
  // squares under it mean and where the whole thing would fit instead, in one
  // sentence, and nothing at all while a question is waiting for a click
  // (issue #2285).
  const spot = previewNote(preview.count, preview.nudge, answering);

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
    selectedKeys: selection,
    footprintAt,
    // A zone is a sheet lying over the ground, so it steps aside for a mode
    // that puts things on the ground: otherwise a zone covering a corner of the
    // map would be a corner of the map nothing could be placed on. Zones mode
    // itself is the exception, because it places zones (issue #2313): its own
    // handles have to stay pickable by pointer so a click still selects a
    // zone or grabs its handle rather than falling through to a new one
    // dropped on top of it. A waypoint is a knob rather than a sheet, so it
    // covers nothing and stays pickable regardless.
    overlays: [
      mode.id === ZONES_MODE_ID || !onPlace ? zonesLayer : null,
      pathsLayer,
    ],
    onSelect: select,
    onPlace,
    onHover: preview.onHover,
    onDragUnit: preview.onDragUnit,
    onDragGround: behaviour.draw ?? null,
    // A drag of something in the selection carries the whole selection with it,
    // so a marquee round a cluster of bases is one drag rather than one per base
    // (issue #2279). A group's units come along together whichever way it was
    // reached, which is what `dragKeys` already answers.
    carries: (key) => {
      const held = selectionRef.current;
      const carried = inSelection(held, key) ? held : [key];
      return carried.flatMap((one) => dragKeys(units.placements, one));
    },
    // The same edit the arrow keys make, through the same function, so a drag
    // and a nudge cannot drift apart (issue #2269). One `onChange` for the whole
    // selection, because one call is one step of the history (`history.ts`).
    onMove: (key, delta) => {
      const held = selectionRef.current;
      if (!inSelection(held, key)) {
        onChange((doc) => moveOnMap(doc, key, delta, snap, layoutEdit));
        return;
      }
      onChange((doc) => moveSelection(doc, held, delta, snap, layoutEdit));
    },
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
      issues={issues}
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
  /** Which rows the list lights up: every entry anything selected belongs to,
   *  so a marquee round three bases lights three rows (issue #2279). */
  const listed = useMemo(() => {
    const out = new Set<string>();
    for (const key of selection) {
      const entry = contentsSelection(entries, key);
      if (entry) out.add(entry);
    }
    return out;
  }, [entries, selection]);
  // And what it holds without placing, which the map cannot show at all.
  const layouts = useMemo(() => unplacedLayouts(scenario), [scenario]);

  // The document, and the three lists the map draws it as, kept where a click
  // handler built earlier in this render can reach them to name what it just
  // added to the selection.
  const things = useMemo<MapThings>(
    () => ({ scenario, entries, placements: units.placements, paths }),
    [scenario, entries, units.placements, paths],
  );
  thingsRef.current = things;

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
   *  lands on it would be: it is selected, and it is on screen. A step of the
   *  keyboard's cycle (issue #2314) is picked the same way: only the key,
   *  position and span a `ContentEntry` also carries are read.
   *
   *  `add` is the map's own way of growing a selection from the keyboard
   *  (issue #2354): the keyboard's cycle-and-add keys pass it through so the
   *  stop is toggled into the selection rather than replacing it, the same
   *  toggle a Shift-click makes. Nothing else that picks an entry does. */
  const pickEntry = useCallback(
    (entry: MapStep, add = false) => {
      setSelected(entry.key, add);
      focusOn(entry.pos, entry.span);
    },
    [focusOn, setSelected],
  );

  /**
   * A row put into the selection, or taken back out of it (issue #2279).
   *
   * The whole of what the row stands for goes in: every one of a base's
   * buildings, every one of a group's units. A row is one thing an author can
   * name, so adding one adds that thing rather than the first slice of it, and
   * a selection built here behaves exactly like a marquee drawn round the same
   * thing.
   *
   * The camera stays where it is, unlike a plain pick. Somebody choosing six
   * rows is building a selection, not asking to be flown to each of them in
   * turn.
   */
  const toggleEntry = useCallback(
    (entry: ContentEntry) => {
      const keys = entryKeys(scenario, entry);
      const held = selectionRef.current;
      const had = keys.some((key) => inSelection(held, key));
      const after = had
        ? held.filter((key) => !keys.includes(key))
        : addKeys(held, keys);
      setSelection(after);
      sayRef.current(
        had ? removedWords(entry.label, after) : addedWords(entry.label, after),
      );
    },
    [scenario, setSelection],
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
    things,
    onChange,
    selection,
    onSelect: setSelected,
    onEntry: pickEntry,
    onPlace,
    placing,
    snap,
    layoutEdit,
    cursorAt,
    panBy,
    footprintsAt,
  });
  // The one live region the map speaks through, lent to the pointer so a
  // Shift-click and an arrow key are announced in the same voice (issue #2279).
  sayRef.current = keys.say;

  /**
   * Keys pointing at things the document no longer holds, dropped.
   *
   * An undo, a delete taken from a panel, or an edit that emptied a group can
   * all leave a selection naming units nobody is drawing any more, and the next
   * Delete would then work through keys that mean nothing. Off the drawn list
   * rather than the document, because that is the list the keys address.
   */
  useEffect(() => {
    const held = selectionRef.current;
    if (held.length === 0 || !units.settled) return;
    const kept = stillThere(held, units.placements, scenario);
    if (kept.length !== held.length) setSelection(kept);
  }, [units.placements, units.settled, scenario, setSelection]);

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

  /**
   * How many things Turn and Delete will act on, when it is more than one.
   * Undefined for a selection of one, and then both read as they always did.
   */
  const actingOn =
    selection.length > 1 ? countSelection(selection).total : undefined;

  /**
   * What the rail's bottom group acts on, or null when nothing is selected.
   *
   * One set of tools for three kinds of selection, because "delete what is
   * selected" is one thought however many kinds of thing can be selected. Only
   * a placement turns: a zone is a footprint with no facing, and a point on a
   * path is a point.
   *
   * Read in the order the surface reads a selection: a placement first, then a
   * zone, then a point on a path. Exactly one of the three can be true at once,
   * because all three are read off the same selected key.
   */
  const tools = picked
    ? {
        count: actingOn,
        // A selection of several always has a Turn to offer, because "turn what
        // turns" is a thing to do even when this one is a group. On its own,
        // one that cannot turn is offered no turn at all: a group's units all
        // face south, and a tool that cannot be used is one more thing to read
        // past.
        ...(actingOn !== undefined || canTurn(picked.key)
          ? {
              onTurnPreview: setTurning,
              // What the outlined squares beside the building mean, said in the
              // turn's own tooltip. It is only ever true while the pointer is on
              // that button, which is where the tooltip already is.
              turnNote:
                picked.kind === "base"
                  ? turnNoteText(turning ? turned.length > 0 : null)
                  : null,
              // Several things swing about the selection's own middle, which is
              // the job the count bar's own Turn together button used to do.
              // One button rather than two: an author who picked a cluster and
              // pressed turn meant the cluster. Turning each where it stands is
              // still R, and the strip under the map says so.
              onTurn: () =>
                onChange((doc) =>
                  selection.length > 1
                    ? turnSelectionAround(doc, selection, 1, layoutEdit)
                    : turnPlacement(doc, picked.key, 1, layoutEdit(picked.id)),
                ),
            }
          : {}),
        onDelete: () => {
          onChange((doc) =>
            selection.length > 1
              ? removeSelection(doc, selection, layoutEdit)
              : removePlacement(doc, picked.key, layoutEdit(picked.id)),
          );
          setSelected(null);
        },
      }
    : pickedZone
      ? {
          onDelete: () => {
            onChange((doc) => removeZone(doc, pickedZone.id));
            setSelected(null);
          },
        }
      : pathRef && selected
        ? {
            deleteLabel: "Delete point",
            onDelete: () => {
              onChange((doc) => removePathWaypoint(doc, selected));
              // Back to the path the point belonged to rather than to nothing,
              // so its other points keep their knobs and a path being drawn is
              // still being drawn.
              setSelected(
                pickedGroup
                  ? placementKey("group", pathRef.groupId, 0)
                  : pathLineKey(pathRef.groupId),
              );
            },
          }
        : null;

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
      rail={
        /* The modes as a rail down the left rather than a row across the top.
           A row of six labelled buttons ran most of the way across the map and
           pushed the mode's own controls onto a second line, so the toolbar took
           two bands of the view before an author had placed anything.

           One segmented group, the way the unit builder's viewport draws its
           handles, and opaque: a translucent button on terrain takes whatever is
           under it, so the same control reads differently over grass and over
           snow. The tooltip is where each mode says its name, what it makes and
           the key that reaches it. The strip had no room for the first two and
           never showed the third anywhere else.

           Undo and redo ride at the top of the same rail, one gap clear of the
           modes: both act on the document, and a pair in the far corner was the
           only thing over the map that did. Turn and delete ride at the bottom
           the same way, and only while there is something to act on. Three
           groups: what you did, what you are doing, and what you are doing it
           to, which is how the unit builder's viewport stacks its own. */
        <TooltipProvider>
          <div className="flex flex-col gap-2">
            {history && <HistoryControls {...history} vertical />}
            <ButtonGroup orientation="vertical">
              {EDITOR_MODES.map((m, i) => (
                <Tooltip key={m.id}>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      // The pair the unit builder's viewport uses for the
                      // handle it is on. `bg-card` only on the ones that are
                      // off: an outline button has no fill of its own, and a
                      // see-through control on terrain takes whatever is under
                      // it.
                      variant={mode.id === m.id ? "default" : "outline"}
                      className={mode.id === m.id ? undefined : "bg-card"}
                      onClick={() => setModeId(m.id)}
                      // The name is in the tooltip, which a pointer reaches and
                      // a screen reader does not, so the button carries it as
                      // its accessible name as well.
                      aria-label={m.label}
                      aria-pressed={mode.id === m.id}
                    >
                      <m.icon className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-56">
                    <p className="font-medium">{m.label}</p>
                    <p className="opacity-80">{m.what}</p>
                    <p className="opacity-60">Key {i + 1}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </ButtonGroup>
            {tools && <SelectionTools {...tools} />}
          </div>
        </TooltipProvider>
      }
      bars={
        <>
          {/* The mode's own controls, and only while the mode has some. Select
              has none, so its bar is not drawn at all rather than drawn empty.
              The row shares one backdrop rather than each control finding its
              own: a mode's `controls` are arbitrary (selects, a count field, a
              button), so painting the panel once is what makes every one of
              them opaque over the map, present ones and any added later, rather
              than a fix repeated per control (issue #1188). */}
          {behaviour.controls && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-card p-1">
              {behaviour.controls}
            </div>
          )}
          {/* What the squares under the pointer are saying, said in words as
              well: a mark is a colour, and a colour on its own is not a
              statement anybody can act on (issue #1464). It carries the offer
              of a spot the whole thing fits (issue #1482) in the same breath,
              because the offer only exists where the spot is trouble, and two
              chips for one thought was two rows of the wall this column had
              become (issue #2285). */}
          {spot && (
            <p
              className={`w-fit rounded px-2 py-1 text-[11px] backdrop-blur ${
                spot.trouble
                  ? "bg-amber-950/80 text-amber-200"
                  : "bg-card/70 text-muted-foreground"
              }`}
            >
              {spot.text}
            </p>
          )}
          {picked && (
            // Turning and deleting are the rail's now. What is left here is
            // what the bar was always for: naming what is selected, and the
            // controls for whatever kind of thing it turned out to be.
            <ScenarioSelectionBar placement={picked}>
              {pickedActor && (
                <ActorControls
                  key={pickedActor.id}
                  actor={pickedActor}
                  participants={scenario.setup.participants}
                  issues={issues}
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
                  issues={issues}
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
          {/* What the outlined square beside the selected building means while
              a turn is being considered (issue #1541) is `turnNote` on the
              rail's Turn now. It is only ever said while the pointer is on that
              button, which is where its tooltip already is, so it does not need
              a bar of its own across the view. */}
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
            />
          )}
          {/* How much is in hand, and the way to put it all down. Last in the
              column, under every bar that names the primary, because which of
              those is drawn depends on what the primary turned out to be: a
              placement, a point on a path or a zone. Sitting above any one of
              them put the tally over the bar for a zone and under the bar for a
              unit, which is one bar moving for no reason an author could state.

              Its own bar rather than a note in the corner, because the corner is
              for what is true of the whole scene (issue #2350). */}
          {selection.length > 1 && (
            <SelectionCountBar
              what={countWords(selection)}
              onClear={() => setSelection(NO_SELECTION)}
            />
          )}
        </>
      }
      chrome={
        <Popover open={contentsOpen} onOpenChange={setContentsOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 bg-card"
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
              onToggle={toggleEntry}
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
      }
      note={
        <>
          {/* What is true of the whole map at once, said once rather than per
              base in a popover two clicks away (issue #1496). Held back until
              the reads have settled, so an editor opening does not greet
              anybody with a warning that clears itself.

              Down here with the count of what was drawn rather than over the
              ground the author is working on (issue #2285): all three are
              statements about how far the whole scene can be trusted, none of
              them changes while anybody works, and none is answered by doing
              anything to the spot under the pointer. Left-aligned inside a
              corner that otherwise right-aligns, because these are sentences
              rather than the tally under them. */}
          <div className="flex max-w-full flex-col items-end gap-1 text-left">
            <UncheckedNote
              unchecked={units.settled ? sceneUnchecked(footprints) : null}
              flattened={units.heightsUnread}
            />
            <WaterlessNote floor={waterless} />
          </div>
          <UnitsNote
            units={units}
            gameName={scenario.setup.gameName}
            drawing={units.drawing}
          />
        </>
      }
      // What the hands do here, which is the mode's own line as much as it is
      // the camera's (issue #2285). What the left button does on bare ground is
      // the mode's to say now: it pans in every mode but the two that took it,
      // Zones to draw one and Select to drag a marquee (issue #2279), so the
      // shared half only claims the middle button.
      footer={
        <>
          {mapName} · {mode.hint} · middle-drag to pan · drag a unit to move it
          · drag a zone's middle handle to move it · right-drag to turn the view
        </>
      }
    />
  );
});

/**
 * What is selected, said the way this document names it.
 *
 * The bar itself is shared with the blueprint editor. What is not shared is what
 * a placement is called here: an actor, one of a group's units, or one of a
 * base's buildings.
 */
function ScenarioSelectionBar({
  placement,
  children,
}: {
  placement: Placement;
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
    >
      {children}
    </SelectionBar>
  );
}

/**
 * How much is selected, and the way to put it all down (issue #2279).
 *
 * Its own bar under the one for the primary, because the two say different
 * things: that one names one thing and opens its panel, this one is the account
 * of what the rail's Turn and Delete are about to act on. Without it the only
 * sign that Delete is about to remove six things is that six plates are lit
 * somewhere on the map, which is not something an author reads before pressing
 * a button.
 *
 * Turning is not here. It was a Turn together button, which swung the whole
 * selection about its own middle where the primary's Turn turned each thing
 * where it stood, and two turns in two places for one selection is a choice
 * nobody asked to be given: an author who picked a cluster and pressed turn
 * meant the cluster. So the rail's Turn does that job for a selection of
 * several, and turning each where it stands is R (issue #2353's other half is
 * still on its own key).
 */
function SelectionCountBar({
  what,
  onClear,
}: {
  /** The tally, as `countWords` reads it: "4 actors, 1 group and 2 base
   *  buildings". */
  what: string;
  onClear: () => void;
}) {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-primary/60 bg-card p-1 pl-2">
      <span className="text-[11px]">{what} selected</span>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={onClear}
        title="Let go of all of it (Esc)"
      >
        Clear
      </Button>
    </div>
  );
}

/**
 * The selected zone: its name and its size.
 *
 * The name is what triggers pick a zone by, so it is the one thing about a zone
 * that cannot be set by dragging and the only field here. It is committed when
 * the box is left rather than on every keystroke, because every change to the
 * document is written to disk.
 *
 * What the handles do is not said. The zone is on screen with its handles drawn
 * on it in two colours, and a sentence spelling that out was the widest thing in
 * this bar: it pushed the size off the end of a narrow window to explain a drag
 * an author works out by doing it once.
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
}: {
  zone: ScenarioZone;
  onRename: (name: string) => void;
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
  children,
}: {
  what: string;
  hint: string;
  /** The group's controls: its team, its units and its orders. */
  children?: ReactNode;
}) {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-card p-1 pl-2">
      <span className="font-mono text-[11px]">{what}</span>
      {children}
      <span className="text-[11px] text-muted-foreground">{hint}</span>
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
