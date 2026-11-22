import { type RefObject, useEffect } from "react";
import type { LegoProject } from "../../model";
import type { HoverStore } from "./hoverStore";
import type { SceneState } from "./sceneState";
import { applyHoverVisual, resolveHovered } from "./selectionAndHoverOutlines";

/**
 * Draw the piece hovered from outside the canvas, e.g. because the sidebar
 * tree's row for it is hovered instead.
 *
 * Independent of the pointer: the hovered piece can arrive from the sidebar
 * tree instead of a raycast, and does not report back up when it does, so
 * this never fights with what the pointer itself is over. A change the
 * pointer made itself is already drawn, so it is skipped rather than drawn
 * twice. An edit always redraws, so an edit to the hovered piece itself (a
 * transform typed into a field, an undo) still keeps its outline and wash in
 * step.
 */
export function useModelHover(
  sceneRef: RefObject<SceneState | null>,
  hover: HoverStore | undefined,
  project: LegoProject,
) {
  useEffect(() => {
    const apply = (always: boolean) => {
      const state = sceneRef.current;
      if (!state) return;
      const resolved = resolveHovered(project, hover?.get() ?? null);
      if (!always && resolved === state.hoveredId) return;
      state.hoveredId = resolved;
      applyHoverVisual(state);
      state.render();
    };
    apply(true);
    return hover?.subscribe(() => apply(false));
  }, [sceneRef, hover, project]);
}
