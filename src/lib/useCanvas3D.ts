/**
 * One three.js canvas, from renderer to disposal.
 *
 * Every 3D view wants the same four things: a renderer sized to the element it
 * sits in, a redraw when that element resizes, a frame drawn only when
 * something changed, and everything freed on the way out. The trap is held here
 * rather than found again by each view that comes along: `setSize(w, h, false)`
 * leaves the canvas element itself unsized, so it falls back to its intrinsic
 * size, which is the drawing buffer including the pixel ratio. That is larger
 * than its host, which grows the host, which grows the canvas. The CSS size has
 * to be set explicitly.
 *
 * What stays with the view: the scene, the camera, orbit controls, gizmos and
 * any animation loop. Those are interaction and content, not canvas lifetime.
 */

import { type DependencyList, type RefObject, useLayoutEffect } from "react";
import * as THREE from "three";

import { onTextureArrived } from "./textureArrival";

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
 * Run `build` against a fresh canvas inside `hostRef`, and tear it all down
 * when `deps` change or the view unmounts.
 *
 * `build` returning nothing means there is nothing to draw yet, and no canvas
 * is left behind. `deps` are the caller's own, as `useMemo` takes them.
 *
 * A layout effect rather than a plain one: the size a view is first drawn at,
 * and anything it publishes from that size, has to be settled before the frame
 * is painted.
 */
export function useCanvas3D(
  hostRef: RefObject<HTMLElement | null>,
  build: (canvas: Canvas3D) => Canvas3DScene | undefined,
  deps: DependencyList,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller passes what its own build reads, the way useMemo takes a list
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    let scene: Canvas3DScene | undefined;
    const render = () => scene?.render();
    const resize = () => {
      const { clientWidth, clientHeight } = host;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight, false);
      scene?.resize(clientWidth, clientHeight);
      render();
    };

    scene = build({ renderer, host, render, resize });

    if (!scene) {
      renderer.dispose();
      renderer.domElement.remove();
      return;
    }

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    // A texture the view is already drawing with is a change like any other,
    // and the only one three does not report to whoever is drawing.
    const stopWatchingTextures = onTextureArrived(render);
    resize();

    return () => {
      stopWatchingTextures();
      observer.disconnect();
      scene?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // Spread rather than passed straight through, because the lint rule wants
    // to see an array literal here. The contents are still the caller's.
  }, [...deps]);
}
