import { Button } from "@picoframe/frame";
import {
  Frame,
  Layers,
  Loader2,
  MountainSnow,
  RotateCw,
  Trash2,
  Unplug,
} from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { Link } from "react-router";
import * as THREE from "three";
import { useMissionMapAssets } from "@/campaign/pages/components/useMissionMapAssets";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  MapPreview3D,
  type MapScene3D,
} from "@/mapconv/pages/components/MapPreview3D";
import { usePreferredTarget } from "@/play/config";
import type { Scenario } from "../../model";
import {
  canTurn,
  movePlacement,
  removePlacement,
  turnPlacement,
} from "./editing";
import { EDITOR_MODES } from "./modes";
import type { Placement } from "./placements";
import { authoringCamera, clampToPlane, mapSceneStatus } from "./scene";
import { useMapEditing } from "./useMapEditing";
import { type ScenarioUnitsState, useScenarioUnits } from "./useScenarioUnits";

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
}: {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
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

  // Every mode is resolved on every render, in the order of a static list, so
  // each one may hold state of its own.
  const mode = EDITOR_MODES.find((m) => m.id === modeId) ?? EDITOR_MODES[0];
  const behaviours = EDITOR_MODES.map((m) =>
    m.use({ scenario, onChange, onSelect: setSelected }),
  );
  const behaviour = behaviours[EDITOR_MODES.indexOf(mode)];

  useMapEditing({
    handle,
    layer: units.layer,
    placements: units.placements,
    worldWidth: assets.worldWidth,
    worldHeight: assets.worldHeight,
    groundAt: units.groundAt,
    selected,
    drawing: units.drawing,
    onSelect: setSelected,
    onPlace: behaviour.place,
    onMove: (key, delta) => onChange(movePlacement(scenario, key, delta)),
  });

  const picked = units.placements.find((p) => p.key === selected) ?? null;

  const status = mapSceneStatus({
    mapName,
    hasEngine: !!assets.enginePath && !!assets.dataDir,
    enginesLoading,
    assetsLoading: assets.loading,
    ready: assets.ready,
  });

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
      // otherwise spends on a second pan.
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
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
      <Surface>
        <SurfaceMessage icon={<Layers className="size-6" />}>
          Pick a setup to choose the map this scenario is authored on.
        </SurfaceMessage>
      </Surface>
    );

  if (status === "loading")
    return (
      <Surface>
        <SurfaceMessage
          icon={<Loader2 className="size-6 animate-spin opacity-40" />}
        >
          Reading {mapName}…
        </SurfaceMessage>
      </Surface>
    );

  if (status === "no-engine")
    return (
      <Surface>
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
      <Surface>
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
    <Surface>
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

      <div className="absolute left-2 top-2 flex max-w-[calc(100%-9rem)] flex-col gap-1.5">
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
          />
        )}
      </div>

      <Button
        size="sm"
        variant="outline"
        className="absolute right-2 top-2 gap-1.5 bg-card/80 backdrop-blur"
        onClick={() => {
          if (sceneRef.current) frameMap(sceneRef.current);
        }}
      >
        <Frame className="size-3.5" /> Frame map
      </Button>
      <UnitsNote
        units={units}
        gameName={scenario.setup.gameName}
        drawing={units.drawing}
      />
      <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-card/70 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
        {mapName} · drag to pan · drag a unit to move it · right-drag to turn ·
        scroll to zoom
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
}: {
  placement: Placement;
  onTurn: () => void;
  onDelete: () => void;
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

/** The fixed working area the scene and its stand-ins share, so the page does
 * not jump as the map resolves. */
function Surface({ children }: { children: ReactNode }) {
  return (
    <section className="relative h-[30rem] overflow-hidden rounded-lg border border-border/50 bg-gradient-to-b from-muted/20 to-muted/40">
      {children}
    </section>
  );
}
