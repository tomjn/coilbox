import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
} from "react";
import { isShortcut } from "../../shortcuts";
import { focusSelection, type GizmoMode } from "./ModelViewport";
import type { SceneState } from "./sceneState";

export interface ModelShortcutsDeps {
  selectedIdsRef: RefObject<string[]>;
  setSnapped: Dispatch<SetStateAction<boolean>>;
  setSnappedTo: Dispatch<SetStateAction<string | null>>;
  setMode: Dispatch<SetStateAction<GizmoMode>>;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * Wire the scene's snap feedback into local state, and the window's keyboard
 * shortcuts into the gizmo mode, the snap hold and the shortcuts sheet.
 *
 * Both run once, on mount, and stay together because they were declared next
 * to each other before this hook existed and neither depends on a prop.
 */
export function useModelShortcuts(
  sceneRef: RefObject<SceneState | null>,
  {
    selectedIdsRef,
    setSnapped,
    setSnappedTo,
    setMode,
    setShortcutsOpen,
  }: ModelShortcutsDeps,
) {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.onSnapChange = (on, anchorName) => {
      setSnapped(on);
      setSnappedTo(anchorName ?? null);
    };
  }, [sceneRef, setSnapped, setSnappedTo]);

  // Held rather than toggled: snapping is on, and letting go of it is a
  // deliberate act for the one piece that has to sit off the grid.
  useEffect(() => {
    const setSnapping = (on: boolean) => {
      const state = sceneRef.current;
      if (state) state.snapping = on;
    };
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (isShortcut("snap-hold", event)) setSnapping(false);
      if (isShortcut("translate", event)) setMode("translate");
      if (isShortcut("rotate", event)) setMode("rotate");
      if (isShortcut("scale", event)) setMode("scale");
      if (isShortcut("frame", event)) {
        const state = sceneRef.current;
        if (state) focusSelection(state, selectedIdsRef.current);
      }
      if (isShortcut("shortcuts", event)) setShortcutsOpen(true);
    };
    const up = (event: KeyboardEvent) => {
      if (!isShortcut("snap-hold", event)) setSnapping(true);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [sceneRef, selectedIdsRef, setMode, setShortcutsOpen]);
}
