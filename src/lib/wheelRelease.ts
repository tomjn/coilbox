/**
 * Let the page scroll past a 3D view whose wheel would otherwise zoom it
 * (issue #2328).
 *
 * OrbitControls listens for `wheel` on the canvas itself and always calls
 * `preventDefault`, so the only way to hand the event to the page is to stop it
 * before it gets there. A capture-phase listener on the canvas's parent runs
 * first however the controls registered theirs.
 *
 * `isOver` is the view's own cheap stand-in for "is the pointer over content",
 * given the ray under the pointer. It runs on every wheel tick, so it must not
 * traverse the scene or test triangles (issue #2326 measured that at 341ms per
 * event on a map). `groundHit` and `boxHit` in `wheelGate.ts` are the usual
 * choices. `releaseWheel` there makes the decision.
 *
 * The raycaster, pointer and ray are made once, so a tick allocates nothing.
 */

import * as THREE from "three";

import { releaseWheel } from "@/mapconv/pages/components/wheelGate";

/**
 * @param host The element the canvas sits in.
 * @param canvas The element the pointer position is measured against.
 * @param camera The camera to cast from, read per event so a view that swaps
 *   cameras (a perspective and an orthographic one) is always asked right.
 * @returns Takes the listener off again.
 */
export function attachWheelRelease(
  host: HTMLElement,
  canvas: HTMLElement,
  camera: () => THREE.Camera,
  isOver: (ray: THREE.Ray) => boolean,
): () => void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const onWheel = (event: WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera());
    if (releaseWheel(isOver(raycaster.ray))) event.stopPropagation();
  };
  host.addEventListener("wheel", onWheel, { capture: true, passive: true });
  return () => host.removeEventListener("wheel", onWheel, { capture: true });
}
