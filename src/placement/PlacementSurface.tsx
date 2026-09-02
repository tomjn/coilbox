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

import { cn } from "@picoframe/frame";
import { Crosshair, Maximize2, Minimize2 } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import {
  GridToggle,
  ResetViewButton,
  ViewControls,
  ViewToggle,
} from "@/components/ViewControls";
import type { MapAppearance } from "@/mapconv/bindings";
import {
  type HeightWords,
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
      heightRange?: { min: number; max: number };
      heightWords?: HeightWords | null;
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

/**
 * What makes the working area answer the keyboard (issue #2269).
 *
 * Handed in rather than owned here, because what a key means is about the thing
 * being edited and this file knows nothing about that. What the surface owns is
 * the part that is true of any 3D working area: it can be reached with Tab, it
 * says so while it has the focus, it has somewhere to speak from, and it draws a
 * marker at the point the keys act on.
 *
 * Left out entirely by a surface with no keyboard interface yet, and then
 * nothing about it changes.
 */
export interface SurfaceKeyboard {
  /** What the working area is called, for whoever tabbed into it. */
  label: string;
  /** What the keys do. Read out when the area takes the focus. */
  help: string;
  /** The last thing the keys did, announced politely. The token is what makes
   *  the same sentence twice running two announcements rather than one. */
  said: { text: string; token: number };
  /** Where the keys are acting, in words, written beside the marker at the
   *  middle of the view. Null before there is a scene to have a middle. */
  cursor: string | null;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
}

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
  keyboard,
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
  /** Buttons along the top right: undo and redo, a contents list, whatever acts
   *  on the document. What acts on the view instead goes in the bar of view
   *  controls in the bottom right, which this owns. */
  chrome?: ReactNode;
  /** Said above the view controls, for what was drawn and what could not be. */
  note?: ReactNode;
  /** The strip under the view, for what the mouse does here. */
  footer?: ReactNode;
  /** What the keys do here, for a surface that answers them (issue #2269). */
  keyboard?: SurfaceKeyboard;
}) {
  const sceneRef = useRef<MapScene3D | null>(null);
  const [expanded, setExpanded] = useExpanded();
  // Only ever asked about by a build grid ground. Held for as long as the
  // surface is open and no longer, the way the unit builder holds its own.
  const [grid, setGrid] = useState(true);
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
            <KeyboardGround keyboard={keyboard}>
              <GroundView ground={ground} grid={grid} onScene={takeScene} />
            </KeyboardGround>

            {bars && (
              <div className="absolute left-2 top-2 flex max-w-[calc(100%-21rem)] flex-col gap-1.5">
                {bars}
              </div>
            )}

            {chrome && (
              <div className="absolute right-2 top-2 flex items-center gap-1.5">
                {chrome}
              </div>
            )}

            {/* Clear of the view controls below it, so a long warning about
                units that could not be drawn does not sit on top of them. */}
            {note && (
              <div className="pointer-events-none absolute bottom-14 right-3 flex max-w-[60%] flex-col items-end gap-1 text-right">
                {note}
              </div>
            )}

            {/* The same bar in the same corner as the unit builder's, so a
                person who has learned one editor's view controls has learned
                this one's (issue #1870). What is here is what a surface with a
                camera over ground has: put the view back, and take the window
                over. A grid only where there is one to hide - a map has no
                grid on it, and the build grid the blueprint editor stands on
                is the ground itself. */}
            <ViewControls>
              {ground.kind === "grid" && (
                <GridToggle
                  on={grid}
                  onChange={setGrid}
                  showTitle="Show the build grid the layout stands on"
                />
              )}
              <ResetViewButton
                title={frameLabel}
                onClick={() => {
                  if (sceneRef.current) frameRef.current(sceneRef.current);
                }}
              />
              <ViewToggle
                icon={Maximize2}
                onIcon={Minimize2}
                on={expanded}
                onChange={setExpanded}
                hideTitle="Back to the page (Esc)"
                showTitle="Fill the window"
              />
            </ViewControls>
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

/**
 * The ground, wrapped in the thing that takes the keyboard (issue #2269).
 *
 * The wrapper is around the scene only, not around the whole surface. Everything
 * else here is ordinary web content: a mode strip, a selection bar, a contents
 * list. Only the scene is a working area where the arrows have to mean north and
 * south rather than "scroll", which is what `role="application"` says and what
 * makes it worth saying about as little of the page as possible.
 *
 * The ring shows whenever the area has the focus rather than only on
 * `:focus-visible`. It is not saying "you tabbed here", it is saying "the keys
 * go here now", which is as true after a click as after a Tab, and is the one
 * thing a person who has just clicked the map has no other way of knowing. It is
 * also drawn as an element over the scene rather than as a ring on the wrapper,
 * because the canvas fills the wrapper exactly and would cover it.
 */
function KeyboardGround({
  keyboard,
  children,
}: {
  keyboard?: SurfaceKeyboard;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const helpId = useId();
  const [focused, setFocused] = useState(false);
  // A pointer over the map means the pointer is what is being aimed with, and
  // the preview under it says where a click would land. Two cursors saying two
  // different things is worse than one, so the keyboard's marker stands down
  // until a key brings it back.
  const [pointing, setPointing] = useState(false);

  if (!keyboard) return <>{children}</>;

  const marker = focused && !pointing;

  return (
    <div
      ref={ref}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a working area where the arrow keys mean north and south rather than scrolling is what role="application" is for, and it has to be reachable with Tab to be worth having (issue #2269).
      tabIndex={0}
      role="application"
      aria-label={keyboard.label}
      aria-describedby={helpId}
      className="relative h-full w-full outline-none"
      onKeyDown={(event) => {
        setPointing(false);
        keyboard.onKeyDown(event);
      }}
      onFocus={() => {
        setFocused(true);
        keyboard.onFocus();
      }}
      onBlur={() => setFocused(false)}
      // The canvas swallows the press that would otherwise focus this: three's
      // orbit controls call preventDefault on it to stop the browser starting a
      // drag of its own. So the focus is taken here instead, and clicking the
      // map is a way into the keys as well as a way to select something.
      onPointerDown={() => ref.current?.focus({ preventScroll: true })}
      onPointerMove={() => {
        if (!pointing) setPointing(true);
      }}
    >
      {children}

      {marker && (
        <span className="pointer-events-none absolute inset-0 z-10 ring-2 ring-inset ring-primary" />
      )}

      {marker && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1">
          <Crosshair className="size-7 text-primary drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]" />
          {keyboard.cursor && (
            <span className="rounded bg-card/80 px-1.5 py-0.5 font-mono text-[11px] backdrop-blur">
              {keyboard.cursor}
            </span>
          )}
        </div>
      )}

      <p id={helpId} className="sr-only">
        {keyboard.help}
      </p>
      {/* Remounted on every token, so the same sentence said twice is a change
          inside the region and is therefore said twice. */}
      <div aria-live="polite" className="sr-only">
        <p key={keyboard.said.token}>{keyboard.said.text}</p>
      </div>
    </div>
  );
}

/** The ground itself, whichever kind it is. */
function GroundView({
  ground,
  grid,
  onScene,
}: {
  ground: SurfaceGround;
  /** Whether the build grid is ruled on the ground. Nothing to a map. */
  grid: boolean;
  onScene: (handle: MapScene3D | null) => void;
}) {
  if (ground.kind === "grid") {
    return (
      <GridScene
        extent={ground.extent}
        grid={grid}
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
      // Every surface this component draws is one somebody is editing on, so
      // none of them wants to spend a fifth of every frame rippling the sea
      // (issue #2292).
      stillWater
      heightSrc={ground.heightSrc}
      heightRange={ground.heightRange}
      heightWords={ground.heightWords}
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
