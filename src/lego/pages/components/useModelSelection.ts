import { type RefObject, useEffect } from "react";
import type { LegoProject } from "../../model";
import { applyHoverVisual, attachGizmo, showSelection } from "./ModelViewport";
import type { SceneState } from "./sceneState";

/** Draw the selection's outlines and washes, and point the gizmo at it. */
export function useModelSelection(
  sceneRef: RefObject<SceneState | null>,
  selectedIds: string[],
  project: LegoProject,
  placingAnchor: boolean,
) {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    showSelection(state, project, selectedIds);
    attachGizmo(state, project, selectedIds, placingAnchor);
    // The new selection may be a piece already showing a hover treatment,
    // which now has to stand down in favour of the (stronger) selected look.
    applyHoverVisual(state);
    state.render();
  }, [sceneRef, selectedIds, project, placingAnchor]);
}
