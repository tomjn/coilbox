import { Layers, Loader2, MountainSnow, Unplug } from "lucide-react";
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
import { buildGridSnap } from "@/blueprint/footprint";
import { useGameSides } from "@/blueprint/useGameSides";
import { useMissionMapAssets } from "@/campaign/pages/components/useMissionMapAssets";
import { useGameUnits } from "@/content/useGameUnits";
import { useReduceMotion } from "@/general/display";
import { type LayoutEdit, setOrigin } from "@/lib/scenarioEditing/bases";
import {
  canTurn,
  duplicatePlacement,
  removePlacement,
  turnPlacement,
} from "@/lib/scenarioEditing/editing";
import { isTypingTarget } from "@/lib/scenarioEditing/history";
import type { LayoutChoice } from "@/lib/scenarioEditing/layoutPlacing";
import { PlacementSurface, SurfaceMessage } from "@/placement/PlacementSurface";
import { dragKeys, placementKey } from "@/placement/placements";
import {
  previewArmed,
  previewNote,
  withoutBuilding,
} from "@/placement/preview";
import { turnNoteText } from "@/placement/SurfaceBars";
import { mapSceneStatus } from "@/placement/scene";
import { useLayoutPreview } from "@/placement/useLayoutPreview";
import { useMapEditing } from "@/placement/useMapEditing";
import { useScenarioFootprints } from "@/placement/useScenarioFootprints";
import { useScenarioUnits } from "@/placement/useScenarioUnits";
import { usePreferredTarget } from "@/play/config";
import type { ExtensionTypes } from "../../extensions";
import type { Point, Scenario } from "../../model";
import type { MissionIssue } from "../../validate";
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
  pathLineKey,
  removeGroup,
  targetOptions,
} from "./groups";
import { type MapStep, type MapThings, moveOnMap } from "./mapKeyboard";
import { EDITOR_MODES, ZONES_MODE_ID } from "./modes";
import { pathLabel, removePathWaypoint, scenarioPaths } from "./orderPaths";
import type { RowFocus } from "./problemTargets";
import { turnSelectionAround } from "./rigidTurn";
import { PathBar, ZoneBar } from "./ScenarioMapBars";
import {
  ClickAnswerBars,
  ModeStatusBar,
  PlacementSelectionBar,
  ScenarioPlaybackBar,
  TallyBar,
} from "./ScenarioMapSceneBars";
import {
  MapFootnotes,
  ScenarioContentsPopover,
  ScenarioModeRail,
} from "./ScenarioMapSceneChrome";
import {
  addedWords,
  addKeys,
  countSelection,
  entryKeys,
  inSelection,
  moveSelection,
  NO_SELECTION,
  primaryKey,
  removedWords,
  removeSelection,
} from "./selection";
import { modeDigit } from "./shortcuts";
import { useBasePlayback } from "./useBasePlayback";
import { useCameraMovement, useMapCamera } from "./useMapCamera";
import { useMapKeyboard } from "./useMapKeyboard";
import { useMapOverlays } from "./useMapOverlays";
import { useMapPlacementPreview } from "./useMapPlacementPreview";
import { useMapSelection, useSelectionCleanup } from "./useMapSelection";
import { removeZone, renameZone } from "./zones";

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
  const { sceneRef, handle, onScene } = useMapCamera();

  // The base being watched go up, and what is not standing yet: held apart in
  // `useBasePlayback.ts`, the same way `useMapSelection` holds the selection
  // (issue #2515).
  const { playing, setPlayback, total, steps, undrawn } =
    useBasePlayback(scenario);

  const units = useScenarioUnits(handle, scenario, assets, undrawn);

  // An author who has asked for less motion gets the steps and not the film.
  const reduceMotion = useReduceMotion();
  const [modeId, setModeId] = useState(EDITOR_MODES[0].id);
  // Everything selected on the map, newest last (issue #2279), and the two
  // ways of changing it: a click's key, or a marquee's catch. Held apart in
  // `useMapSelection.ts`, which the selection bar's own reads below draw on
  // the same way the whole file draws on `useMapCamera`.
  const {
    selection,
    selectionRef,
    selected,
    setSelection,
    setSelected,
    select,
    selectMany,
    thingsRef,
    sayRef,
  } = useMapSelection(scenario);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectionRef is the stable ref useMapSelection returns, read through .current on purpose so this handle's identity does not change on every selection (issue #904). Biome cannot see the useRef behind the hook's own boundary to infer that on its own.
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

  const picked = units.placements.find((p) => p.key === selected) ?? null;

  // The zones sheet, the paths drawn over the ground and the start position
  // markers: the map's own decorations, and what is currently being worked on
  // among them, in `useMapOverlays.ts`. Nothing in it calls `onChange`:
  // renaming `pickedZone`, deleting a waypoint off `pathRef` and removing
  // `pickedGroup` all stay here, next to the `onChange` calls they make.
  const { draftZones } = behaviour;
  const {
    pickedZone,
    zonesLayer,
    pathRef,
    pickedGroup,
    selectedLine,
    pathsLayer,
  } = useMapOverlays({
    handle,
    scenario,
    map: assets,
    groundAt: units.groundAt,
    selected,
    draftZones,
    paths,
    startPositions: assets.startPositions,
    pickingPathId: picking?.pathId,
    picked,
  });

  // The game's own units, for the panels that pick one and for the build grid
  // every base building is dragged and turned onto.
  const gameUnits = useGameUnits(scenario.setup.gameName);
  const snap = useMemo(() => buildGridSnap(gameUnits.units), [gameUnits.units]);
  // What the game calls each side's units, which is all a base's conversion
  // needs beyond the units themselves (issue #1466).
  const gameSides = useGameSides(gameUnits.archive);

  // The path being drawn, the base being moved, what a click on the map would
  // do about either, and the footprints every placed building stands on
  // (issues #1315, #1464, #1541). Held apart in `useMapPlacementPreview.ts`,
  // which owns this state and these reads and calls no `onChange` the same way
  // `useMapSelection` does not: deciding what a click writes to the document
  // is `onPlace`'s, right below, reading `drawingPath` and `moving` back out.
  const {
    drawing,
    setDrawing,
    drawingPath,
    moving,
    setMovingBase,
    placing,
    answering,
    footprints,
    footprintsAt,
    footprintAt,
    checks,
    waterless,
    turning,
    setTurning,
    turned,
  } = useMapPlacementPreview({
    scenario,
    placements: units.placements,
    ground: units.ground,
    settled: units.settled,
    gameUnits: gameUnits.units,
    snap,
    pickedGroup,
    picking,
    selected,
  });

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

  // Where a turn would stand the selected building, drawn while the Turn
  // button is under the pointer or has the focus (issue #1541): `turned`,
  // from `useMapPlacementPreview` above.
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

  // Looking closely at a point on the map, the point the view is looking at,
  // and panning it: the three ways of moving the camera that are not a drag,
  // in `useMapCamera.ts` alongside the scene handle above, which they read
  // through the same `sceneRef`.
  const { focusOn, cursorAt, panBy } = useCameraMovement(
    sceneRef,
    { worldWidth: assets.worldWidth, worldHeight: assets.worldHeight },
    units.groundAt,
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectionRef and sayRef are the stable refs useMapSelection returns, read through .current on purpose so this callback's identity does not change on every selection. Biome cannot see the useRef behind the hook's own boundary to infer that on its own.
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

  // Keys pointing at things the document no longer holds, dropped, in
  // `useMapSelection.ts`. Called here rather than beside the state above so
  // this effect keeps the same place among the map's other effects: it needs
  // `units.placements` and `units.settled`, which only exist once the units
  // layer built from them further up this render has run.
  useSelectionCleanup(
    selectionRef,
    setSelection,
    units.placements,
    units.settled,
    scenario,
  );

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
        // The modes as a rail down the left rather than a row across the top,
        // with undo and redo above them and Turn and delete below, while
        // there is something to act on: in `ScenarioModeRail`, taken out
        // whole (issue #2515's third boundary), since it reads nothing here
        // beyond the mode, the tools already built and the history passed in.
        <ScenarioModeRail
          history={history}
          modeId={mode.id}
          onModeChange={setModeId}
          tools={tools}
        />
      }
      bars={
        <>
          {/* The mode's own controls, and only while the mode has some, plus
              the sentence over the terrain about the spot under the pointer:
              a mark is a colour, and a colour on its own is not a statement
              anybody can act on (issues #1188, #1464, #2285). */}
          <ModeStatusBar controls={behaviour.controls} spot={spot} />
          {picked && (
            <PlacementSelectionBar
              scenario={scenario}
              picked={picked}
              groupControls={groupControls}
              issues={issues}
              onChange={onChange}
              layoutEdit={layoutEdit}
              placements={units.placements}
              footprints={footprints}
              waterless={waterless}
              settled={units.settled}
              mapName={mapName}
              gameUnits={gameUnits}
              gameSides={gameSides}
              moving={moving}
              sharedBase={sharedBase}
              reduceMotion={reduceMotion}
              setPlayback={setPlayback}
              setSharedBase={setSharedBase}
              setMovingBase={setMovingBase}
              setSelected={setSelected}
            />
          )}
          {/* What the outlined square beside the selected building means while
              a turn is being considered (issue #1541) is `turnNote` on the
              rail's Turn now. It is only ever said while the pointer is on that
              button, which is where its tooltip already is, so it does not need
              a bar of its own across the view. */}
          <ClickAnswerBars
            drawingPath={drawingPath}
            pickedGroup={pickedGroup}
            groups={scenario.groups}
            onDrawingDone={() => setDrawing(null)}
            moving={moving}
            onMovingDone={() => setMovingBase(null)}
            picking={picking}
            onPlace={onPlace}
            worldWidth={assets.worldWidth}
            worldHeight={assets.worldHeight}
          />
          {playing && (
            <ScenarioPlaybackBar
              playing={playing}
              total={total}
              steps={steps}
              setPlayback={setPlayback}
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
            <TallyBar
              selection={selection}
              onClear={() => setSelection(NO_SELECTION)}
            />
          )}
        </>
      }
      chrome={
        <ScenarioContentsPopover
          open={contentsOpen}
          onOpenChange={setContentsOpen}
          entries={entries}
          layouts={layouts}
          selected={listed}
          participants={scenario.setup.participants}
          onPick={pickEntry}
          onToggle={toggleEntry}
          onChange={onChange}
          setLayoutChoice={setLayoutChoice}
          setModeId={setModeId}
        />
      }
      note={
        <MapFootnotes
          scenario={scenario}
          units={units}
          footprints={footprints}
          waterless={waterless}
        />
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
