import { type RefObject, useEffect } from "react";
import type { LegoProject } from "../../model";
import type { SceneState } from "./sceneState";
import { applyHoverVisual, resolveHovered } from "./selectionAndHoverOutlines";

/**
 * Draw the piece hovered from outside the canvas, e.g. because the sidebar
 * tree's row for it is hovered instead.
 *
 * Independent of the pointer: the hovered piece can arrive from the sidebar
 * tree instead of a raycast, and does not report back up when it does, so
 * this never fights with what the pointer itself is over. Unlike the
 * pointer-driven path this always redraws rather than bailing out when the
 * id has not changed, so an edit to the hovered piece itself (a transform
 * typed into a field, an undo) still keeps its outline and wash in step.
 */
export function useModelHover(
  sceneRef: RefObject<SceneState | null>,
  hoveredId: string | null | undefined,
  project: LegoProject,
) {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.hoveredId = resolveHovered(project, hoveredId ?? null);
    applyHoverVisual(state);
    state.render();
  }, [sceneRef, hoveredId, project]);
}
