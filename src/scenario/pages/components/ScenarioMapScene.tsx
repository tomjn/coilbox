import { Button, cn, Input } from "@picoframe/frame";
import {
  Frame,
  Layers,
  List,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  MountainSnow,
  Redo2,
  RotateCw,
  Trash2,
  Undo2,
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
import * as THREE from "three";
import { useMissionMapAssets } from "@/campaign/pages/components/useMissionMapAssets";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  MapPreview3D,
  type MapScene3D,
} from "@/mapconv/pages/components/MapPreview3D";
import { usePreferredTarget } from "@/play/config";
import type { Point, Scenario, ScenarioZone } from "../../model";
import { ActorControls } from "./ActorControls";
import { ContentsList } from "./ContentsList";
import {
  type ContentEntry,
  contentsSelection,
  sceneContents,
} from "./contents";
import {
  canTurn,
  editActor,
  movePlacement,
  removePlacement,
  setActorState,
  turnPlacement,
} from "./editing";
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
import { modKeyLabel } from "./history";
import { EDITOR_MODES } from "./modes";
import {
  movePathWaypoint,
  pathLabel,
  removePathWaypoint,
  scenarioPaths,
} from "./orderPaths";
import { PrefabControls } from "./PrefabControls";
import { type Placement, placementKey } from "./placements";
import { editPrefab, removePrefab, setOrigin, setQueue } from "./prefabs";
import {
  authoringCamera,
  clampToPlane,
  FOCUS_ELMOS,
  focusCamera,
  mapSceneStatus,
  worldToScene,
} from "./scene";
import { startMarkers } from "./startPositions";
import { useGameUnits } from "./useGameUnits";
import { useMapEditing } from "./useMapEditing";
import { useScenarioPaths } from "./useScenarioPaths";
import { useScenarioStarts } from "./useScenarioStarts";
import { type ScenarioUnitsState, useScenarioUnits } from "./useScenarioUnits";
import { useScenarioZones } from "./useScenarioZones";
import {
  moveZone,
  parseZoneKey,
  removeZone,
  renameZone,
  zoneExtent,
} from "./zones";

/** What the surface says when there is no scene to show. */
function SurfaceMessage({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
      {icon}
      <div className="max-w-md text-balance">{children}</div>
    </div>
  );
}

/**
 * The scenario's map as the surface it is authored on.
 *
 * The terrain, water, sky and lighting are the content browser's 3D map preview
 * unchanged, resolved through unitsync exactly as a campaign mission's backdrop
 * is. What differs is the camera: authoring means moving over a map, not
 * orbiting an object, so the left button pans, the right rotates, the wheel
 * zooms toward the cursor, and the point being looked at is held over the
 * terrain so a pan cannot strand the view in empty space.
 *
 * The units the document places are drawn on top of it by
 * {@link useScenarioUnits}, and pointing at them is {@link useMapEditing}. The
 * zones, paths and pickers that follow take the same scene the same way.
 *
 * The surface owns which mode is current and what is selected, because both are
 * answers to something that happened on the map. The document is not owned here:
 * every edit goes out through `onChange` and comes back as a new `scenario`.
 */
export function ScenarioMapScene({
  scenario,
  onChange,
  picking,
  history,
}: {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
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
}) {
  const mapName = scenario.setup.mapName;
  const assets = useMissionMapAssets(mapName);
  const { loading: enginesLoading } = usePreferredTarget();
  const sceneRef = useRef<MapScene3D | null>(null);
  // Also held in state, because the units layer is built from it and a ref
  // does not re-render the hook that owns that layer.
  const [handle, setHandle] = useState<MapScene3D | null>(null);
  const units = useScenarioUnits(handle, scenario, assets);
  const [modeId, setModeId] = useState(EDITOR_MODES[0].id);
  const [selected, setSelected] = useState<string | null>(null);
  // A fixed panel is too small to author a 12km map on (#886). Expanding takes
  // the whole window rather than opening a second view, so the scene, its
  // camera and everything the modes hold carry straight over.
  const [expanded, setExpanded] = useState(false);

  // Escape is the way out of anything that has taken over the window, so it is
  // the way out of this too.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Every mode is resolved on every render, in the order of a static list, so
  // each one may hold state of its own.
  const mode = EDITOR_MODES.find((m) => m.id === modeId) ?? EDITOR_MODES[0];
  const behaviours = EDITOR_MODES.map((m) =>
    m.use({ scenario, onChange, selected, onSelect: setSelected }),
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
    [groups],
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
  const paths = useMemo(() => scenarioPaths(scenario), [scenario]);
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
  const moving = scenario.prefabs.some((p) => p.id === movingBase)
    ? movingBase
    : null;

  // Answering a question the author asked is what a click means while one is
  // outstanding, in whatever mode: a point on a path being drawn, or the place
  // a base is being moved to, rather than something new being placed.
  const onPlace = drawingPath
    ? (pos: Point) =>
        onChange(
          addWaypoint(scenario, drawingPath.groupId, drawingPath.order, pos),
        )
    : moving
      ? (pos: Point) => {
          onChange(setOrigin(scenario, moving, pos));
          setMovingBase(null);
        }
      : (picking?.onPick ?? behaviour.place);

  useMapEditing({
    handle,
    layer: units.layer,
    placements: units.placements,
    worldWidth: assets.worldWidth,
    worldHeight: assets.worldHeight,
    groundAt: units.groundAt,
    selected,
    drawing: units.drawing,
    // A zone is a sheet lying over the ground, so it steps aside for a mode
    // that puts things on the ground: otherwise a zone covering a corner of the
    // map would be a corner of the map nothing could be placed on. A waypoint
    // is a knob rather than a sheet, so it covers nothing and stays pickable.
    overlays: [onPlace ? null : zonesLayer, pathsLayer],
    onSelect: select,
    onPlace,
    onDragGround: behaviour.draw ?? null,
    onMove: (key, delta) => {
      if (parseZoneKey(key)) return onChange(moveZone(scenario, key, delta));
      if (parsePathKey(key))
        return onChange(movePathWaypoint(scenario, key, delta));
      onChange(movePlacement(scenario, key, delta));
    },
  });

  // A drawn unit is described by the entry it belongs to, and each of the three
  // kinds has a panel of its own.
  const pickedActor =
    (picked?.kind === "actor" &&
      scenario.actors.find((a) => a.id === picked.id)) ||
    null;
  const pickedPrefab =
    (picked?.kind === "prefab" &&
      scenario.prefabs.find((p) => p.id === picked.id)) ||
    null;
  const gameUnits = useGameUnits(scenario.setup.gameName);

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
        onChange(editGroup(scenario, pickedGroup.id, patch));
        if (patch.units?.length === 0) setSelected(null);
      }}
      onDelete={() => {
        onChange(removeGroup(scenario, pickedGroup.id));
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

  /**
   * Look closely at a point on the map.
   *
   * The camera is put where it would be if the author had zoomed in on the
   * place themselves, rather than moved along a path: what matters is arriving,
   * and a scene this heavy is not one to animate a flight across.
   */
  const focusOn = useCallback(
    (pos: Point) => {
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
        Math.max(controls.minDistance, FOCUS_ELMOS * scale),
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
      focusOn(entry.pos);
    },
    [focusOn],
  );

  /** Frame the whole map, looking down at its centre. Also the starting view. */
  const frameMap = useCallback((handle: MapScene3D) => {
    const { camera, controls, planeWidth, planeDepth, render } = handle;
    const at = authoringCamera(
      planeWidth,
      planeDepth,
      camera.aspect,
      camera.fov,
      controls.maxDistance,
    );
    controls.target.set(0, 0, 0);
    camera.position.set(at.x, at.y, at.z);
    controls.update();
    render();
  }, []);

  const onScene = useCallback(
    (handle: MapScene3D | null) => {
      sceneRef.current = handle;
      setHandle(handle);
      if (!handle) return;
      const { camera, controls, planeWidth, planeDepth, render } = handle;

      // Pan on the left button, because it is the gesture used most and the one
      // a mouse always has. Rotate moves to the right button, which the preview
      // otherwise spends on a second pan. The middle button pans too, because a
      // mode that draws takes the left button for the whole gesture and the
      // wheel already does the dollying the middle button would otherwise.
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      // Pan across the ground rather than across the screen, so dragging moves
      // the map under the cursor however far the camera is tilted.
      controls.screenSpacePanning = false;

      // Hold the look-at point over the terrain. Applied after the fact rather
      // than as a limit because OrbitControls has none: the target is moved by
      // both panning and zoom-to-cursor, and the camera has to follow the
      // correction or the view would swing.
      let correcting = false;
      const holdOverMap = () => {
        if (correcting) return;
        const target = controls.target;
        const held = clampToPlane(target, planeWidth, planeDepth);
        if (held.x === target.x && held.z === target.z) return;
        correcting = true;
        camera.position.x += held.x - target.x;
        camera.position.z += held.z - target.z;
        target.x = held.x;
        target.z = held.z;
        correcting = false;
        render();
      };
      controls.addEventListener("change", holdOverMap);

      frameMap(handle);
    },
    [frameMap],
  );

  if (status === "no-map")
    return (
      <Surface expanded={expanded}>
        <SurfaceMessage icon={<Layers className="size-6" />}>
          Pick a setup to choose the map this scenario is authored on.
        </SurfaceMessage>
      </Surface>
    );

  if (status === "loading")
    return (
      <Surface expanded={expanded}>
        <SurfaceMessage
          icon={<Loader2 className="size-6 animate-spin opacity-40" />}
        >
          Reading {mapName}…
        </SurfaceMessage>
      </Surface>
    );

  if (status === "no-engine")
    return (
      <Surface expanded={expanded}>
        <SurfaceMessage icon={<Unplug className="size-6" />}>
          <p>
            Coilbox reads maps through an engine, and there is no engine
            installed to read {mapName} with.
          </p>
          <Link
            to="/settings/engines"
            className="mt-1 inline-block underline underline-offset-2 hover:text-foreground"
          >
            Install an engine
          </Link>
        </SurfaceMessage>
      </Surface>
    );

  if (status === "error")
    return (
      <Surface expanded={expanded}>
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
      </Surface>
    );

  return (
    <Surface expanded={expanded}>
      <MapPreview3D
        className="h-full w-full"
        framed={false}
        chrome={false}
        showSky
        showClouds={false}
        heightSrc={assets.heightSrc}
        textureSrc={assets.textureSrc}
        skyboxSrc={assets.skyboxSrc}
        appearance={assets.appearance}
        minHeight={assets.minHeight}
        maxHeight={assets.maxHeight}
        worldWidth={assets.worldWidth}
        worldHeight={assets.worldHeight}
        onScene={onScene}
      />

      <div className="absolute left-2 top-2 flex max-w-[calc(100%-21rem)] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <ToggleGroup
            type="single"
            variant="outline"
            value={mode.id}
            onValueChange={(next) => next && setModeId(next)}
            className="bg-card/80 backdrop-blur"
            aria-label="Placement mode"
          >
            {EDITOR_MODES.map((m) => (
              <ToggleGroupItem key={m.id} value={m.id} className="h-8 gap-1.5">
                <m.icon className="size-3.5" /> {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {behaviour.controls}
        </div>
        <p className="w-fit rounded bg-card/70 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
          {mode.hint}
        </p>
        {picked && (
          <SelectionBar
            placement={picked}
            onTurn={() => onChange(turnPlacement(scenario, picked.key))}
            onDelete={() => {
              onChange(removePlacement(scenario, picked.key));
              setSelected(null);
            }}
          >
            {pickedActor && (
              <ActorControls
                key={pickedActor.id}
                actor={pickedActor}
                participants={scenario.setup.participants}
                onEdit={(patch) =>
                  onChange(editActor(scenario, pickedActor.id, patch))
                }
                onState={(state) =>
                  onChange(setActorState(scenario, pickedActor.id, state))
                }
              />
            )}
            {picked.kind === "group" && groupControls}
            {picked.kind === "prefab" && pickedPrefab && (
              <PrefabControls
                key={`${pickedPrefab.id}#${picked.index}`}
                prefab={pickedPrefab}
                index={picked.index}
                participants={scenario.setup.participants}
                units={gameUnits.units}
                unitsLoading={gameUnits.loading}
                moving={moving === pickedPrefab.id}
                onEdit={(patch) =>
                  onChange(editPrefab(scenario, pickedPrefab.id, patch))
                }
                onQueue={(queue, repeat) =>
                  onChange(
                    setQueue(
                      scenario,
                      pickedPrefab.id,
                      picked.index,
                      queue,
                      repeat,
                    ),
                  )
                }
                onMove={(on) => setMovingBase(on ? pickedPrefab.id : null)}
                onDelete={() => {
                  onChange(removePrefab(scenario, pickedPrefab.id));
                  setSelected(null);
                }}
              />
            )}
          </SelectionBar>
        )}
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
          />
        )}
        {moving && (
          <ClickMapBar
            message="Click the map to put this base's origin there, buildings and all"
            onDone={() => setMovingBase(null)}
          />
        )}
        {picking && !drawingPath && !moving && (
          <ClickMapBar message={picking.message} onDone={picking.onDone} />
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
              onChange(removePathWaypoint(scenario, selected));
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
              onChange(renameZone(scenario, pickedZone.id, name))
            }
            onDelete={() => {
              onChange(removeZone(scenario, pickedZone.id));
              setSelected(null);
            }}
          />
        )}
      </div>

      <div className="absolute right-2 top-2 flex items-center gap-1.5">
        {history && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="bg-card/80 px-2 backdrop-blur"
              onClick={history.undo}
              disabled={!history.canUndo}
              aria-label="Undo"
              title={`Undo (${modKeyLabel()} Z)`}
            >
              <Undo2 className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-card/80 px-2 backdrop-blur"
              onClick={history.redo}
              disabled={!history.canRedo}
              aria-label="Redo"
              title={`Redo (${modKeyLabel()} Shift Z)`}
            >
              <Redo2 className="size-3.5" />
            </Button>
          </>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 bg-card/80 backdrop-blur"
              title="Everything this scenario has put on the map"
            >
              <List className="size-3.5" /> Contents
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-1">
            <ContentsList
              entries={entries}
              selected={listed}
              participants={scenario.setup.participants}
              onPick={pickEntry}
            />
          </PopoverContent>
        </Popover>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 bg-card/80 backdrop-blur"
          onClick={() => {
            if (sceneRef.current) frameMap(sceneRef.current);
          }}
        >
          <Frame className="size-3.5" /> Frame map
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 bg-card/80 backdrop-blur"
          onClick={() => setExpanded((on) => !on)}
          title={expanded ? "Back to the page (Esc)" : "Fill the window"}
        >
          {expanded ? (
            <>
              <Minimize2 className="size-3.5" /> Collapse
            </>
          ) : (
            <>
              <Maximize2 className="size-3.5" /> Expand
            </>
          )}
        </Button>
      </div>
      <UnitsNote
        units={units}
        gameName={scenario.setup.gameName}
        drawing={units.drawing}
      />
      <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-card/70 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
        {mapName} · drag or middle-drag to pan · drag a unit to move it · drag a
        zone's middle handle to move it · right-drag to turn · scroll to zoom
      </p>
    </Surface>
  );
}

/**
 * What is selected, and the two things that can be done to it that a drag
 * cannot: turn it a quarter turn, and delete it.
 *
 * A group's units are spawned facing south together, so there is nothing to turn
 * on one, and the button says so rather than disappearing.
 */
function SelectionBar({
  placement,
  onTurn,
  onDelete,
  children,
}: {
  placement: Placement;
  onTurn: () => void;
  onDelete: () => void;
  /** Controls for what kind of thing this is: an actor's team and its
   *  overrides, and whatever a group or a prefab grows later. */
  children?: ReactNode;
}) {
  const turnable = canTurn(placement.key);
  const what =
    placement.kind === "actor"
      ? "actor"
      : placement.kind === "group"
        ? `group unit ${placement.index + 1}`
        : `base building ${placement.index + 1}`;

  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-card/85 p-1 pl-2 backdrop-blur">
      <span className="font-mono text-[11px]">
        {placement.def}
        <span className="ml-1.5 text-muted-foreground">{what}</span>
      </span>
      {children}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={onTurn}
        disabled={!turnable}
        title={
          turnable ? "Turn a quarter turn" : "A group's units all face south"
        }
      >
        <RotateCw className="size-3.5" /> Turn
      </Button>
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
 * The selected zone: its name, its size, and the way to delete it.
 *
 * The name is what triggers pick a zone by, so it is the one thing about a zone
 * that cannot be set by dragging and the only field here. It is committed when
 * the box is left rather than on every keystroke, because every change to the
 * document is written to disk.
 *
 * Mounted per zone by its id, so moving the selection reseeds the box.
 */
function ZoneBar({
  zone,
  onRename,
  onDelete,
}: {
  zone: ScenarioZone;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(zone.name);
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
 * A question the map is waiting for an answer to: a path being drawn, or a base
 * being moved.
 *
 * Its own bar rather than a line in the panel that asked, because while one of
 * these is outstanding the click that answers it is also the click that would
 * otherwise place something, and that is worth saying where it cannot be missed.
 */
function ClickMapBar({
  message,
  onDone,
}: {
  message: ReactNode;
  onDone: () => void;
}) {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-lime-400/60 bg-card/85 p-1 pl-2 backdrop-blur">
      <MapPin className="size-3.5 text-lime-300" />
      <span className="text-[11px]">{message}</span>
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
    <div className="pointer-events-none absolute bottom-2 right-2 flex max-w-[60%] flex-col items-end gap-1 text-right">
      {problem && (
        <p className="rounded bg-amber-950/70 px-2 py-1 text-[11px] text-amber-200 backdrop-blur">
          {problem}
        </p>
      )}
      <p className="rounded bg-card/70 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
        {drawing ? "drawing " : ""}
        {units.placed} unit{units.placed === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/**
 * The working area the scene and its stand-ins share, so the page does not jump
 * as the map resolves.
 *
 * Expanded it is the whole window. Not a dialog and not a second scene: the same
 * element grows, so the canvas resizes in place, the camera keeps the view it
 * had, and the mode strip, the selection bar and the click bar come along
 * because they were always children of this.
 */
function Surface({
  expanded,
  children,
}: {
  expanded: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden bg-gradient-to-b from-muted/20 to-muted/40",
        expanded
          ? "fixed inset-0 z-50 border-0"
          : "relative h-[30rem] rounded-lg border border-border/50",
      )}
    >
      {children}
    </section>
  );
}
