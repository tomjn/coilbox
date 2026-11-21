/**
 * One three.js canvas, from renderer to disposal.
 *
 * Every 3D view wants the same four things: a renderer sized to the element it
 * sits in, a redraw when that element resizes or the UI zoom moves, a frame
 * drawn only when something changed, and everything freed on the way out. The
 * trap is held here
 * rather than found again by each view that comes along: `setSize(w, h, false)`
 * leaves the canvas element itself unsized, so it falls back to its intrinsic
 * size, which is the drawing buffer including the pixel ratio. That is larger
 * than its host, which grows the host, which grows the canvas. The CSS size has
 * to be set explicitly.
 *
 * What stays with the view: the scene, the camera, orbit controls, gizmos and
 * any animation loop. Those are interaction and content, not canvas lifetime.
 */

import {
  type DependencyList,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";
import * as THREE from "three";

import { registerCanvas3D } from "./renderStats";
import { onTextureArrived } from "./textureArrival";
import { drawingPixelRatio } from "./uiZoom";

/** The canvas the build is handed, and what it can ask of it afterwards. */
export interface Canvas3D {
  renderer: THREE.WebGLRenderer;
  /** The element the canvas fills and whose size it follows. */
  host: HTMLElement;
  /** Draw one frame now. */
  render: () => void;
  /** Take the host's size again, resize the buffer to it, and draw. */
  resize: () => void;
}

/** What a view builds on the canvas, and how the canvas drives it. */
export interface Canvas3DScene {
  /** Draw one frame. */
  render: () => void;
  /** The canvas has a new size in CSS pixels, and the buffer is already
   *  resized to it. `render` runs straight after. */
  resize: (width: number, height: number) => void;
  /** Free what the build allocated. The renderer and the canvas are not
   *  yours to free. */
  dispose: () => void;
}

/**
 * Free a renderer and give its WebGL context back to the browser.
 *
 * `dispose()` frees what three allocated but leaves the context alive until
 * the garbage collector reaches the canvas. A browser allows only a handful of
 * live contexts and drops the oldest past that, so a view that never gave its
 * context back blanked the main model view (issue #5344).
 */
export function release(renderer: THREE.WebGLRenderer): void {
  renderer.dispose();
  renderer.forceContextLoss();
  renderer.domElement.remove();
}

/**
 * A renderer that outlives the view that made it.
 *
 * A browser counts a context from the moment it is made until the garbage
 * collector reaches its canvas, which is not when `forceContextLoss` runs. A
 * view mounted and unmounted again and again, as the replay page's 3D mode is
 * by its switch, used the allowance up one context at a time and another view
 * went blank (issue #5348). So a view's renderer is parked when it goes and
 * the next view to mount takes it.
 */
interface Pooled {
  renderer: THREE.WebGLRenderer;
  /** Whether a view has it. Nothing is drawn on a parked one. */
  owned: boolean;
  /** Everything it has been asked to draw since the last scene went. */
  drawing: Set<object>;
  /** What it now refuses to draw. */
  letGo: WeakSet<object>;
}

/** Renderers no view has, most recently parked last. */
const parked: Pooled[] = [];

function makePooled(): Pooled {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  const pooled: Pooled = {
    renderer,
    owned: false,
    drawing: new Set(),
    letGo: new WeakSet(),
  };
  // A scene's own layers draw on it after it has been let go, from a passive
  // effect cleanup React runs once the next scene is built, and the renderer
  // may be another view's by then. Nothing they hold can tell, so the renderer
  // refuses a scene that has been let go, and anything at all while it is
  // parked: drawing a freed scene re-allocates storage for the textures that
  // went with it (issue #1740).
  const draw = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    if (!pooled.owned || pooled.letGo.has(scene)) return;
    pooled.drawing.add(scene);
    draw(scene, camera);
  };
  return pooled;
}

/** A renderer for a view, a parked one if a browser has not taken it back. */
function takeRenderer(): Pooled {
  for (let one = parked.pop(); one; one = parked.pop()) {
    if (!one.renderer.getContext().isContextLost()) {
      one.owned = true;
      // What the last view set, put back to what three starts with.
      one.renderer.localClippingEnabled = false;
      one.renderer.setClearColor(0x000000, 0);
      one.renderer.clear();
      return one;
    }
    release(one.renderer);
  }
  const fresh = makePooled();
  fresh.owned = true;
  return fresh;
}

/** Take a renderer off its view and its page, and keep it for the next one. */
function parkRenderer(one: Pooled): void {
  one.owned = false;
  one.drawing.clear();
  one.renderer.domElement.remove();
  parked.push(one);
}

/** Give every parked renderer's context back. For tests, which count them. */
export function releaseParkedRenderers(): void {
  for (const one of parked.splice(0)) release(one.renderer);
}

/** The canvas a view holds, and the scene on it while there is one. */
interface Live {
  pooled: Pooled;
  renderer: THREE.WebGLRenderer;
  host: HTMLElement;
  resize: () => void;
  scene?: Canvas3DScene;
  /** Let the scene go, if there is one. `clear` blanks what it drew. */
  dropScene?: (clear: boolean) => void;
}

/**
 * Run `build` against a canvas inside `hostRef`, and again on the same canvas
 * when `deps` change. The scene is freed when the view unmounts, and the
 * renderer is parked for the next view.
 *
 * The renderer, and with it the WebGL context, is kept. WebKit still counts a
 * context after `forceContextLoss`, so a canvas remade on every change, or on
 * every mount, runs the browser out of contexts and another view goes blank
 * (issues #5344 and #5348). A change to `deps` disposes the scene `build`
 * returned and builds the next one on the same renderer. `deps` are the
 * caller's own, as `useMemo` takes them.
 *
 * `build` returning nothing means there is nothing to draw yet. The canvas is
 * blanked and kept, because the view is usually between two builds, as a map
 * preview is while its sources load.
 *
 * Both effects are layout effects rather than plain ones: the size a view is
 * first drawn at, and anything it publishes from that size, has to be settled
 * before the frame is painted.
 *
 * `ready` is whether the view has anything to build yet. A view whose inputs
 * are still arriving says false, and no renderer is made until it says true.
 * Going back to false gives the renderer up.
 */
export function useCanvas3D(
  hostRef: RefObject<HTMLElement | null>,
  build: (canvas: Canvas3D) => Canvas3DScene | undefined,
  deps: DependencyList,
  ready = true,
): void {
  const liveRef = useRef<Live | null>(null);

  // The canvas. Declared before the scene effect, so on a mount it exists by
  // the time the scene is built.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a ref is read when the effect runs, and `ready` is what says the host exists
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !ready) return;

    const pooled = takeRenderer();
    const { renderer } = pooled;
    host.appendChild(renderer.domElement);

    const live: Live = { pooled, renderer, host, resize: () => {} };

    // The pixel ratio the buffer was last sized at, so a window resize that did
    // not move it costs nothing.
    let ratio = 0;
    const render = () => live.scene?.render();
    const resize = () => {
      const { clientWidth, clientHeight } = host;
      if (clientWidth === 0 || clientHeight === 0) return;
      // Read the ratio every time rather than once at build: UI zoom changes it
      // (see `./uiZoom`), and a buffer left at the old one is the blurry model.
      ratio = drawingPixelRatio();
      renderer.setPixelRatio(ratio);
      renderer.setSize(clientWidth, clientHeight, false);
      live.scene?.resize(clientWidth, clientHeight);
      render();
    };
    live.resize = resize;
    liveRef.current = live;

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    // A zoom change moves the pixel ratio, and only sometimes the host's size:
    // a host sized by layout shrinks in CSS pixels and the observer reports it,
    // but one with a fixed CSS size keeps every number the observer watches and
    // is left drawing at the wrong ratio. The window resize event fires on a
    // zoom change either way (measured in the app's own webview), so it is the
    // signal, and the ratio check keeps a plain window resize from doing the
    // work twice.
    const onWindowResize = () => {
      if (drawingPixelRatio() !== ratio) resize();
    };
    window.addEventListener("resize", onWindowResize);
    // A texture the view is already drawing with is a change like any other,
    // and the only one three does not report to whoever is drawing.
    const stopWatchingTextures = onTextureArrived(render);
    // A browser that is over its limit of live contexts takes one back from the
    // oldest view. three reinitialises on restore, but nothing draws until
    // something asks, so a restored canvas would stay blank. Registered after
    // three's own listener, so the renderer is ready by the time this runs.
    renderer.domElement.addEventListener("webglcontextrestored", render);
    resize();

    return () => {
      liveRef.current = null;
      live.dropScene?.(false);
      stopWatchingTextures();
      window.removeEventListener("resize", onWindowResize);
      renderer.domElement.removeEventListener("webglcontextrestored", render);
      observer.disconnect();
      parkRenderer(pooled);
    };
  }, [ready]);

  // The scene, on whatever canvas the effect above made.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller passes what its own build reads, the way useMemo takes a list
  useLayoutEffect(() => {
    const live = liveRef.current;
    if (!live) return;
    const { renderer, host } = live;

    const scene = build({
      renderer,
      host,
      render: () => live.scene?.render(),
      resize: live.resize,
    });
    live.scene = scene;
    if (!scene) return;

    // Every 3D view passes through here, so this is the one place that can say
    // what any of them cost to draw (issue #2292).
    const unregisterStats = registerCanvas3D({
      renderer,
      render: () => scene.render(),
      host,
    });
    live.dropScene = (clear) => {
      live.dropScene = undefined;
      live.scene = undefined;
      unregisterStats();
      // Before the scene's own dispose, which may ask for a frame as it goes.
      for (const drawn of live.pooled.drawing) live.pooled.letGo.add(drawn);
      live.pooled.drawing.clear();
      scene.dispose();
      // The canvas stays, so what the scene drew would stay with it.
      if (clear) renderer.clear();
    };
    live.resize();

    return () => live.dropScene?.(true);
    // Spread rather than passed straight through, because the lint rule wants
    // to see an array literal here. The contents are still the caller's.
  }, [ready, ...deps]);
}
