import * as THREE from "three";
import { isEffectivelyHidden } from "../../model";
import { placeAnchor } from "./anchorsAndSnapping";
import {
  beginFaceDrag,
  endFaceDrag,
  highlightHandle,
  moveFaceDrag,
} from "./collisionHandles";
import { pieceIdOf } from "./gizmoCommit";
import type { SceneState } from "./sceneState";
import { setHoveredAndNotify } from "./selectionAndHoverOutlines";

/**
 * Wire up the canvas's own pointer handling: sizing a collision face,
 * clicking to select or to place an anchor, and hovering a piece.
 *
 * Split out of the mount effect that builds the scene, camera and gizmo,
 * because those are lifetime-managed together while this is just DOM
 * listeners on the finished canvas. The gizmo's own `mouseDown`/`mouseUp`
 * listeners stay behind in that effect: they read and write `state.dragging`
 * for the same reason this file's handlers do, so splitting them here as well
 * would only move the sharing problem rather than remove it.
 *
 * Returns a function that removes every listener this attaches, including
 * the face-drag ones: an earlier version of this dispose, both before and
 * straight after the split, mirrored the caller's own `dispose` and missed
 * those four. See #2544.
 */
export function attachPointerHandlers(state: SceneState): () => void {
  const { renderer, camera, root } = state;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const aimAt = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  };

  // Sizing the volume by its faces. Registered before the selection
  // handlers below, so a press that grabbed a plate is already known by the
  // time they run. The orbit registered before all of them and has already
  // taken this press, which is why the drag switches it off rather than
  // asking it not to start: the same thing TransformControls does.
  const onFaceDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    aimAt(event);
    if (!beginFaceDrag(state, raycaster)) return;
    state.dragging = true;
    setHoveredAndNotify(state, null);
    renderer.domElement.setPointerCapture(event.pointerId);
    state.render();
  };
  const onFaceMove = (event: PointerEvent) => {
    if (!state.collisionDrag) return;
    aimAt(event);
    moveFaceDrag(state, raycaster);
  };
  const onFaceUp = (event: PointerEvent) => {
    if (!state.collisionDrag) return;
    endFaceDrag(state);
    state.dragging = false;
    if (renderer.domElement.hasPointerCapture(event.pointerId))
      renderer.domElement.releasePointerCapture(event.pointerId);
  };
  renderer.domElement.addEventListener("pointerdown", onFaceDown);
  renderer.domElement.addEventListener("pointermove", onFaceMove);
  renderer.domElement.addEventListener("pointerup", onFaceUp);
  renderer.domElement.addEventListener("pointercancel", onFaceUp);

  // Selection happens on release, not on press, and only when the pointer
  // barely moved. Selecting on press meant a click that missed a gizmo handle
  // by a pixel cleared the selection and detached the gizmo before the drag
  // could start, and dragging empty space to orbit cleared it too.
  let pressedAt: { x: number; y: number } | null = null;
  let pressedOnGizmo = false;

  const onPointerDown = (event: PointerEvent) => {
    pressedAt = { x: event.clientX, y: event.clientY };
    // Whether a handle was grabbed has to be read now rather than on release.
    // TransformControls registered its listeners on this canvas first, so its
    // pointerdown has already set these, and its pointerup clears them again
    // before this handler's pointerup would ever see them.
    pressedOnGizmo =
      state.gizmo.dragging ||
      state.gizmo.axis !== null ||
      state.collisionDrag !== null;
  };
  const onPointerUp = (event: PointerEvent) => {
    const from = pressedAt;
    const onGizmo = pressedOnGizmo;
    pressedAt = null;
    pressedOnGizmo = false;
    if (!from || onGizmo) return;
    // Anything past a few pixels was an orbit or a drag, not a click.
    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > 4) return;

    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(root, true)[0];
    if (state.placingAnchorRef.current) {
      placeAnchor(state, hit);
      return;
    }
    state.onSelectRef.current(
      pieceIdOf(hit?.object ?? null),
      event.shiftKey || event.metaKey || event.ctrlKey,
    );
  };
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);

  // Raycasting on every `pointermove` would run it far more often than the
  // screen can show a result, so a move only records where the pointer is
  // and asks for a frame. The frame itself does the one raycast that
  // frame gets, and only re-renders if the hovered piece actually changed.
  let hoverFrame = 0;
  let hoverAt: { x: number; y: number } | null = null;

  const checkHover = () => {
    hoverFrame = 0;
    if (!hoverAt || state.dragging) return;
    pointer.x = hoverAt.x;
    pointer.y = hoverAt.y;
    raycaster.setFromCamera(pointer, camera);
    // The plates sit over the model, so they answer first: a face about to
    // be grabbed is not a piece about to be picked.
    const plate = state.collisionHandles.visible
      ? raycaster.intersectObjects(state.collisionHandles.children, false)[0]
      : undefined;
    if (highlightHandle(state, plate?.object ?? null)) state.render();
    if (plate) {
      setHoveredAndNotify(state, null);
      return;
    }
    let found: string | null = null;
    for (const hit of raycaster.intersectObject(root, true)) {
      const id = pieceIdOf(hit.object);
      if (id && !isEffectivelyHidden(state.projectRef.current, id)) {
        found = id;
        break;
      }
    }
    setHoveredAndNotify(state, found);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (state.dragging) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    hoverAt = {
      x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      y: -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    };
    if (!hoverFrame) hoverFrame = requestAnimationFrame(checkHover);
  };
  const onPointerLeave = () => {
    hoverAt = null;
    if (!state.dragging) setHoveredAndNotify(state, null);
  };
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);

  return () => {
    cancelAnimationFrame(hoverFrame);
    renderer.domElement.removeEventListener("pointerdown", onFaceDown);
    renderer.domElement.removeEventListener("pointermove", onFaceMove);
    renderer.domElement.removeEventListener("pointerup", onFaceUp);
    renderer.domElement.removeEventListener("pointercancel", onFaceUp);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
  };
}
