/**
 * Renderers for views and one-off pictures that `useCanvas3D` does not serve.
 *
 * WebKit counts a WebGL context from the moment it is made until the garbage
 * collector reaches its canvas, which is not when `forceContextLoss` runs. A
 * browser allows only a few live contexts and takes the oldest back past that,
 * so anything that makes a renderer each time it runs turns another 3D view
 * blank in a long session (issues #5344, #5348 and #5351). A renderer is lent
 * out, and kept for the next borrower when it comes back.
 *
 * The pool is keyed by what the renderer was made with, because a context's
 * settings are fixed when it is made. Two borrowers at once each get their own,
 * so a picture that waits on a texture cannot draw on another's canvas.
 */

import type * as THREE from "three";

import { release } from "./useCanvas3D";

/** Renderers nobody has, by key, most recently returned last. */
const kept = new Map<string, THREE.WebGLRenderer[]>();

/**
 * A renderer for `key`, a kept one if the browser has not taken it back, else
 * one `make` builds. `make` must always build the same kind for the same key.
 */
export function borrowRenderer(
  key: string,
  make: () => THREE.WebGLRenderer,
): THREE.WebGLRenderer {
  const pool = kept.get(key);
  for (let one = pool?.pop(); one; one = pool?.pop()) {
    if (!one.getContext().isContextLost()) return one;
    release(one);
  }
  return make();
}

/** Take a renderer off its page and keep it for the next borrower of `key`. */
export function returnRenderer(
  key: string,
  renderer: THREE.WebGLRenderer,
): void {
  renderer.domElement.remove();
  const pool = kept.get(key);
  if (pool) pool.push(renderer);
  else kept.set(key, [renderer]);
}

/** Give every kept renderer's context back. For tests, which count them. */
export function releaseKeptRenderers(): void {
  for (const pool of kept.values()) {
    for (const one of pool.splice(0)) release(one);
  }
  kept.clear();
}
