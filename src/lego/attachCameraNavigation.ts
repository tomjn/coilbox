import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { type NavigationPreset, mouseButtonsFor } from "./cameraNavigation";

const NO_KEYS = {
  button: 0,
  ctrl: false,
  shift: false,
  alt: false,
  meta: false,
};

/**
 * Sets `controls.mouseButtons` from the modifiers held when a drag starts, and
 * puts the Coilbox buttons back when it ends. OrbitControls reads the buttons
 * only on pointerdown, and cannot say "Alt with the middle button" itself.
 *
 * Call it before the `OrbitControls` is made, so this listener runs first on
 * the same element. `getControls` is read on each press, so it can return
 * nothing until the controls exist. Returns a function that removes the
 * listeners.
 */
export function attachCameraNavigation(
  element: HTMLElement,
  getControls: () => Pick<OrbitControls, "mouseButtons"> | undefined,
  getPreset: () => NavigationPreset,
): () => void {
  const onDown = (event: PointerEvent) => {
    const controls = getControls();
    if (!controls || event.pointerType === "touch") return;
    controls.mouseButtons = mouseButtonsFor(getPreset(), {
      button: event.button,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
    });
  };
  const onEnd = () => {
    const controls = getControls();
    if (controls) controls.mouseButtons = mouseButtonsFor("coilbox", NO_KEYS);
  };
  element.addEventListener("pointerdown", onDown);
  element.ownerDocument.addEventListener("pointerup", onEnd);
  element.ownerDocument.addEventListener("pointercancel", onEnd);
  return () => {
    element.removeEventListener("pointerdown", onDown);
    element.ownerDocument.removeEventListener("pointerup", onEnd);
    element.ownerDocument.removeEventListener("pointercancel", onEnd);
  };
}
