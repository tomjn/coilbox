import { MOUSE } from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { mouseButtonsFor, type NavigationPreset } from "./cameraNavigation";

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
 * nothing until the controls exist. `canOrbit` is read on each press too, and
 * where it says no, the orbit button pans instead: the top, front and side
 * views of the four view layout pan and zoom but never turn. Returns a
 * function that removes the listeners.
 */
export function attachCameraNavigation(
  element: HTMLElement,
  getControls: () => Pick<OrbitControls, "mouseButtons"> | undefined,
  getPreset: () => NavigationPreset,
  canOrbit: () => boolean = () => true,
): () => void {
  const onDown = (event: PointerEvent) => {
    const controls = getControls();
    if (!controls || event.pointerType === "touch") return;
    const buttons = mouseButtonsFor(getPreset(), {
      button: event.button,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
    });
    if (!canOrbit()) {
      // OrbitControls swaps rotate and pan while Ctrl, Command or Shift is
      // held, so which entry means "orbit" depends on them.
      const swapped = event.ctrlKey || event.metaKey || event.shiftKey;
      const orbit = swapped ? MOUSE.PAN : MOUSE.ROTATE;
      const pan = swapped ? MOUSE.ROTATE : MOUSE.PAN;
      for (const key of ["LEFT", "MIDDLE", "RIGHT"] as const) {
        if (buttons[key] === orbit) buttons[key] = pan;
      }
    }
    controls.mouseButtons = buttons;
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
