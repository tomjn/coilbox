import { type RefObject, useEffect, useRef } from "react";
import * as THREE from "three";
import type { ProportionHandle } from "../../skeletonEdit";
import { dotMaterial } from "./dotsAndPoints";
import {
  alongAxis,
  HANDLE_COLOUR,
  handleUnderPointer,
  valueAfterDrag,
} from "./proportionHandles";
import type { SceneState } from "./sceneState";

/** The handle dot's width on screen, in pixels. */
const HANDLE_DOT = 14;

interface Drag {
  handle: ProportionHandle;
  /** Where along the axis the press landed, so grabbing off centre does not
   *  make the handle jump. */
  from: number;
  value: number;
}

/**
 * Draw a dot for each handle and let it be dragged along its axis.
 *
 * `onDrag` runs for every move so the unit and the number field follow, and
 * `onDragEnd` once on release with the final value. A press that goes nowhere
 * ends without either, so it is not an edit.
 */
export function useProportionHandles(
  sceneRef: RefObject<SceneState | null>,
  {
    handles,
    show,
    onDrag,
    onDragEnd,
  }: {
    handles: ProportionHandle[];
    show: boolean;
    onDrag: (id: string, value: number) => void;
    onDragEnd: (id: string, value: number) => void;
  },
): void {
  const latest = useRef({ handles, onDrag, onDragEnd });
  latest.current = { handles, onDrag, onDragEnd };

  // The dots.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state || !show || handles.length === 0) return;
    const dots = new THREE.Points(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          handles.flatMap((handle) => handle.at),
          3,
        ),
      ),
      dotMaterial(
        HANDLE_DOT,
        state.renderer.getPixelRatio(),
        false,
        HANDLE_COLOUR,
      ),
    );
    dots.renderOrder = 6;
    dots.raycast = () => {};
    state.overlay.add(dots);
    state.render();
    return () => {
      dots.removeFromParent();
      dots.geometry.dispose();
      (dots.material as THREE.Material).dispose();
      state.render();
    };
  }, [sceneRef, handles, show]);

  // The drag.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state || !show) return;
    const canvas = state.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    let drag: Drag | null = null;

    const rayAt = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        state.camera,
      );
    };
    const along = (handle: ProportionHandle) =>
      alongAxis(raycaster.ray, new THREE.Vector3(...handle.at), handle.axis);

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const handle = handleUnderPointer(
        latest.current.handles,
        state.camera,
        rect,
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
      );
      if (!handle) return;
      rayAt(event);
      const from = along(handle);
      if (from === null) return;
      drag = { handle, from, value: handle.value };
      // The orbit has already taken this press, so it is switched off rather
      // than asked not to start, as the collision plates do.
      state.controls.enabled = false;
      state.dragging = true;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!drag) return;
      rayAt(event);
      const at = along(drag.handle);
      if (at === null) return;
      drag.value = valueAfterDrag(drag.handle, at - drag.from);
      latest.current.onDrag(drag.handle.id, drag.value);
    };
    const onUp = (event: PointerEvent) => {
      if (!drag) return;
      const { handle, value } = drag;
      drag = null;
      state.controls.enabled = true;
      state.dragging = false;
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      if (value !== handle.value) latest.current.onDragEnd(handle.id, value);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      if (drag) {
        state.controls.enabled = true;
        state.dragging = false;
      }
    };
  }, [sceneRef, show]);
}
