/**
 * The surface a layout is placed on, whatever it is standing on (issue #1416).
 *
 * This is the scenario editor's map view with the map taken out of it. What is
 * left is everything that is true of placing things in three dimensions and
 * nothing that is true of one mission: a working area that can fill the window,
 * a camera tuned for looking down at ground you are working on rather than
 * orbiting an object, a way to frame what you are looking at again, and slots
 * for whoever is using it to hang their own controls in.
 *
 * The ground underneath is either a map or a plain build grid, and nothing above
 * this line can tell which. Both hand over the same {@link MapScene3D}, so the
 * unit models, the footprint squares, the selection plate and the pointer
 * arithmetic are one implementation used twice rather than two that will drift.
 *
 * The scene is not owned here either: it is handed out through `onScene` and
 * withdrawn with a null, and whoever took it puts their own layers on it.
 */

import { Button, cn } from "@picoframe/frame";
import { Frame, Maximize2, Minimize2 } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import type { MapAppearance } from "@/mapconv/bindings";
import {
  MapPreview3D,
  type MapScene3D,
} from "@/mapconv/pages/components/MapPreview3D";
import { GridScene } from "./GridScene";
import { authoringCamera, clampToPlane } from "./scene";

/** What the surface is standing on. */
export type SurfaceGround =
  /** A real map, read through unitsync, exactly as the terrain preview takes
   *  it. Everything but `kind` is what `useMissionMapAssets` reports. */
  | {
      kind: "map";
      heightSrc?: string;
      textureSrc?: string;
      skyboxSrc?: string | null;
      appearance?: MapAppearance | null;
      minHeight: number;
      maxHeight: number;
      worldWidth: number;
      worldHeight: number;
    }
  /** Flat ground with a build grid on it, `extent` elmos across. */
  | { kind: "grid"; extent: number };

/** What the surface says when there is no scene to show. */
export function SurfaceMessage({
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

/** Frame the whole of the ground, looking down at its centre. What the surface
 *  opens on, and what the Frame button does unless the caller has a better
 *  answer, such as framing the layout rather than the field it sits in. */
export function frameGround(handle: MapScene3D): void {
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
}

export function PlacementSurface({
  ground,
  onScene,
  frame = frameGround,
  frameLabel = "Frame",
  stand,
  bars,
  chrome,
  note,
  footer,
}: {
  ground: SurfaceGround;
  /** Handed the built scene, and null when it goes. */
  onScene: (handle: MapScene3D | null) => void;
  /** Put the camera back where the whole of what matters is on screen. The
   *  ground itself by default. Called once when the scene arrives, and again
   *  whenever the button is pressed. */
  frame?: (handle: MapScene3D) => void;
  frameLabel?: string;
  /** Shown instead of the scene, for a ground that cannot be drawn: no map
   *  chosen, still loading, no engine to read it with. Everything else is
   *  hidden with it, because none of it has anything to act on. */
  stand?: ReactNode;
  /** The column down the top left: mode strip, selection bar, whatever is
   *  waiting for a click. */
  bars?: ReactNode;
  /** Buttons along the top right, before Frame and Expand. */
  chrome?: ReactNode;
  /** The bottom right corner, for what was drawn and what could not be. */
  note?: ReactNode;
  /** The strip under the view, for what the mouse does here. */
  footer?: ReactNode;
}) {
  const sceneRef = useRef<MapScene3D | null>(null);
  const [expanded, setExpanded] = useExpanded();
  // Read when the scene arrives rather than captured, so a caller passing an
  // inline framing function does not have to memoise it to avoid a rebuild.
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const onSceneRef = useRef(onScene);
  onSceneRef.current = onScene;

  const takeScene = useCallback((handle: MapScene3D | null) => {
    sceneRef.current = handle;
    onSceneRef.current(handle);
    if (!handle) return;
    const { camera, controls, planeWidth, planeDepth, render } = handle;

    // Pan on the left button, because it is the gesture used most and the one a
    // mouse always has. Rotate moves to the right button, which the preview
    // otherwise spends on a second pan. The middle button pans too, because a
    // mode that draws takes the left button for the whole gesture and the wheel
    // already does the dollying the middle button would otherwise.
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    // Pan across the ground rather than across the screen, so dragging moves the
    // ground under the cursor however far the camera is tilted.
    controls.screenSpacePanning = false;

    // Hold the look-at point over the ground. Applied after the fact rather than
    // as a limit because OrbitControls has none: the target is moved by both
    // panning and zoom-to-cursor, and the camera has to follow the correction or
    // the view would swing.
    let correcting = false;
    const holdOver = () => {
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
    controls.addEventListener("change", holdOver);

    frameRef.current(handle);
  }, []);

  return (
    <Surface expanded={expanded}>
      {stand ?? (
        <>
          <div className="relative min-h-0 flex-1">
            <GroundView ground={ground} onScene={takeScene} />

            {bars && (
              <div className="absolute left-2 top-2 flex max-w-[calc(100%-21rem)] flex-col gap-1.5">
                {bars}
              </div>
            )}

            <div className="absolute right-2 top-2 flex items-center gap-1.5">
              {chrome}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 bg-card/80 backdrop-blur"
                onClick={() => {
                  if (sceneRef.current) frameRef.current(sceneRef.current);
                }}
              >
                <Frame className="size-3.5" /> {frameLabel}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 bg-card/80 backdrop-blur"
                onClick={() => setExpanded(!expanded)}
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
            {note}
          </div>
          {footer && (
            <p className="shrink-0 border-t border-border/50 bg-card/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {footer}
            </p>
          )}
        </>
      )}
    </Surface>
  );
}

/** The ground itself, whichever kind it is. */
function GroundView({
  ground,
  onScene,
}: {
  ground: SurfaceGround;
  onScene: (handle: MapScene3D | null) => void;
}) {
  if (ground.kind === "grid") {
    return (
      <GridScene
        extent={ground.extent}
        className="h-full w-full"
        onScene={onScene}
      />
    );
  }
  return (
    <MapPreview3D
      className="h-full w-full"
      framed={false}
      chrome={false}
      showSky
      showClouds={false}
      heightSrc={ground.heightSrc}
      textureSrc={ground.textureSrc}
      skyboxSrc={ground.skyboxSrc}
      appearance={ground.appearance}
      minHeight={ground.minHeight}
      maxHeight={ground.maxHeight}
      worldWidth={ground.worldWidth}
      worldHeight={ground.worldHeight}
      onScene={onScene}
    />
  );
}

/** Filling the window, and Escape as the way back out of it, because that is the
 *  way out of anything that has taken the window over. */
function useExpanded(): [boolean, (on: boolean) => void] {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);
  return [expanded, setExpanded];
}

/**
 * The working area the scene and its stand-ins share, so the page does not jump
 * as the ground resolves.
 *
 * Expanded it is the whole window. Not a dialog and not a second scene: the same
 * element grows, so the canvas resizes in place, the camera keeps the view it
 * had, and every bar comes along because they were always children of this.
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
        "flex flex-col overflow-hidden bg-gradient-to-b from-muted/20 to-muted/40",
        expanded
          ? "fixed inset-0 z-50 border-0"
          : "relative h-[30rem] rounded-lg border border-border/50",
      )}
    >
      {children}
    </section>
  );
}
