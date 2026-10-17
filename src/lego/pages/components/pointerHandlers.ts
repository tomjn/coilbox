import * as THREE from "three";
import { isEffectivelyHidden } from "../../model";
import type { Vec3 } from "../../snapping";
import { measurePoint, placeAnchor } from "./anchorsAndSnapping";
import {
  beginFaceDrag,
  endFaceDrag,
  highlightHandle,
  moveFaceDrag,
} from "./collisionHandles";
import { pickGround } from "./drivePlayback";
import { pieceIdOf } from "./gizmoCommit";
import { groundPoint } from "./measureLayer";
import {
  beginPackDrag,
  endPackDrag,
  highlightPlate,
  movePackDrag,
} from "./packHandles";
import { firstPieceHit, hoverPlaceFace, placeOnClick } from "./placeByFace";
import type { SceneState } from "./sceneState";
import { setHoveredAndNotify } from "./selectionAndHoverOutlines";
import { grabStandIn, letGoOfStandIn, moveStandIn } from "./standInDrag";

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
  const { renderer, root } = state;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const aimAt = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, state.camera);
  };

  // Sizing the volume by its faces. Registered before the selection
  // handlers below, so a press that grabbed a plate is already known by the
  // time they run. The orbit registered before all of them and has already
  // taken this press, which is why the drag switches it off rather than
  // asking it not to start: the same thing TransformControls does.
  const onFaceDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    aimAt(event);
    if (!beginFaceDrag(state, raycaster) && !beginPackDrag(state, raycaster))
      return;
    state.dragging = true;
    setHoveredAndNotify(state, null);
    renderer.domElement.setPointerCapture(event.pointerId);
    state.render();
  };
  const onFaceMove = (event: PointerEvent) => {
    if (!state.collisionDrag && !state.packDrag) return;
    aimAt(event);
    if (state.packDrag) movePackDrag(state, raycaster);
    else moveFaceDrag(state, raycaster);
  };
  const onFaceUp = (event: PointerEvent) => {
    if (!state.collisionDrag && !state.packDrag) return;
    if (state.packDrag) endPackDrag(state);
    else endFaceDrag(state);
    state.dragging = false;
    if (renderer.domElement.hasPointerCapture(event.pointerId))
      renderer.domElement.releasePointerCapture(event.pointerId);
  };
  renderer.domElement.addEventListener("pointerdown", onFaceDown);
  renderer.domElement.addEventListener("pointermove", onFaceMove);
  renderer.domElement.addEventListener("pointerup", onFaceUp);
  renderer.domElement.addEventListener("pointercancel", onFaceUp);

  // Dragging the stand-in a scenario aims at, the same way: the orbit is
  // switched off once the press is known to be on it.
  const onStandInDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    aimAt(event);
    if (!grabStandIn(state, raycaster)) return;
    state.dragging = true;
    setHoveredAndNotify(state, null);
    renderer.domElement.setPointerCapture(event.pointerId);
  };
  const onStandInMove = (event: PointerEvent) => {
    if (!state.standInDrag) return;
    aimAt(event);
    moveStandIn(state, raycaster);
  };
  const onStandInUp = (event: PointerEvent) => {
    if (!state.standInDrag) return;
    letGoOfStandIn(state);
    state.dragging = false;
    if (renderer.domElement.hasPointerCapture(event.pointerId))
      renderer.domElement.releasePointerCapture(event.pointerId);
  };
  renderer.domElement.addEventListener("pointerdown", onStandInDown);
  renderer.domElement.addEventListener("pointermove", onStandInMove);
  renderer.domElement.addEventListener("pointerup", onStandInUp);
  renderer.domElement.addEventListener("pointercancel", onStandInUp);

  // Where the pointer is for the measure tool: on the model where the ray hit
  // it, else on the ground, then snapped as a drag is.
  const measureAt = (hit: THREE.Intersection | undefined) => {
    const raw = hit
      ? ([hit.point.x, hit.point.y, hit.point.z] as Vec3)
      : groundPoint(state, raycaster);
    return raw ? measurePoint(state, raw) : null;
  };

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
      state.collisionDrag !== null ||
      state.packDrag !== null ||
      state.standInDrag !== null;
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
    raycaster.setFromCamera(pointer, state.camera);
    const hit = raycaster.intersectObject(root, true)[0];
    if (state.measure.active) {
      const at = measureAt(hit);
      if (at) state.measure.onPick?.(at);
      return;
    }
    const pickGuide = state.onPickGuideRef.current;
    if (pickGuide) {
      pickGuide(hit ? ([hit.point.x, hit.point.y, hit.point.z] as Vec3) : null);
      return;
    }
    if (state.placingAnchorRef.current) {
      placeAnchor(state, hit);
      return;
    }
    if (state.placingPartRef.current) {
      placeOnClick(state, firstPieceHit(state, raycaster));
      return;
    }
    // A click that misses the unit while the panel takes points for a path
    // puts one on the ground there. One on the unit still selects.
    const pick = state.onGroundPickRef.current;
    if (pick && !hit) {
      const at = pickGround(state, raycaster);
      if (at) pick(at);
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
    raycaster.setFromCamera(pointer, state.camera);
    if (state.measure.active) {
      state.measure.onHover?.(
        measureAt(raycaster.intersectObject(root, true)[0]),
      );
      return;
    }
    // Placing a part: the face under the pointer is what matters, not the piece.
    if (state.placingPartRef.current) {
      setHoveredAndNotify(state, null);
      hoverPlaceFace(state, firstPieceHit(state, raycaster));
      return;
    }
    // The plates sit over the model, so they answer first: a face about to
    // be grabbed is not a piece about to be picked.
    const plate = state.collisionHandles.visible
      ? raycaster.intersectObjects(state.collisionHandles.children, false)[0]
      : undefined;
    const packPlate = state.packHandles.visible
      ? raycaster.intersectObjects(state.packHandles.children, false)[0]
      : undefined;
    const lit = highlightHandle(state, plate?.object ?? null);
    if (highlightPlate(state, packPlate?.object ?? null) || lit) state.render();
    if (plate || packPlate) {
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
    if (state.measure.active) state.measure.onHover?.(null);
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
    renderer.domElement.removeEventListener("pointerdown", onStandInDown);
    renderer.domElement.removeEventListener("pointermove", onStandInMove);
    renderer.domElement.removeEventListener("pointerup", onStandInUp);
    renderer.domElement.removeEventListener("pointercancel", onStandInUp);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
  };
}
