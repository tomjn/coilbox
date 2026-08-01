import { Button } from "@picoframe/frame";
import { Frame, Layers, Loader2, MountainSnow, Unplug } from "lucide-react";
import { type ReactNode, useCallback, useRef } from "react";
import { Link } from "react-router";
import * as THREE from "three";
import { useMissionMapAssets } from "@/campaign/pages/components/useMissionMapAssets";
import {
  MapPreview3D,
  type MapScene3D,
} from "@/mapconv/pages/components/MapPreview3D";
import { usePreferredTarget } from "@/play/config";
import { authoringCamera, clampToPlane, mapSceneStatus } from "./scene";

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
 * Everything a scenario contains is drawn into this same scene by the modes that
 * follow (issues #757 onwards), which take the scene through `onScene`.
 */
export function ScenarioMapScene({ mapName }: { mapName: string }) {
  const assets = useMissionMapAssets(mapName);
  const { loading: enginesLoading } = usePreferredTarget();
  const sceneRef = useRef<MapScene3D | null>(null);

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
      <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-card/70 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
        {mapName} · drag to pan · right-drag to turn · scroll to zoom
      </p>
    </Surface>
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
