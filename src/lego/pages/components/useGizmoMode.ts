import { type RefObject, useEffect } from "react";
import { showCollisionHandles } from "./collisionHandles";
import { attachGizmo, gizmoMode } from "./gizmoCommit";
import type { GizmoMode } from "./ModelViewport";
import type { SceneState } from "./sceneState";

/**
 * Put the gizmo in the chosen mode, and keep the uniform scale lock read
 * during a drag in step with the toggle.
 *
 * The two stay in one hook because both are about what the gizmo does with a
 * drag rather than what it is attached to, and were declared next to each
 * other before this hook existed.
 */
export function useGizmoMode(
  sceneRef: RefObject<SceneState | null>,
  mode: GizmoMode,
  editingVolume: boolean,
  showAimPoint: boolean,
  uniformScale: boolean,
) {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.gizmo.setMode(gizmoMode(mode, editingVolume, showAimPoint));
    // Scale on a volume is the face plates rather than the gizmo, so the mode
    // decides which of the two is on screen.
    attachGizmo(
      state,
      state.projectRef.current,
      state.selectedIdsRef.current,
      state.placingAnchorRef.current,
    );
    showCollisionHandles(state);
    state.render();
  }, [sceneRef, mode, editingVolume, showAimPoint]);

  useEffect(() => {
    const state = sceneRef.current;
    if (state) state.uniformScale = uniformScale;
  }, [sceneRef, uniformScale]);
}
