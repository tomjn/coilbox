import { type RefObject, useEffect } from "react";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { PoseOffsets } from "../../pose";
import type { RawGeometry } from "../../rawGeometry";
import { restoreFromPlayback } from "./animationPlayback";
import { disposeBaked } from "./bakedPlayback";
import { attachGizmo } from "./gizmoCommit";
import { refreshSelection } from "./overlayFollow";
import { applyPoseOffsets } from "./poseMode";
import { type SceneState, syncScene } from "./sceneState";
import { poseSkeleton } from "./skeletonLayer";

/**
 * Hold the unit in a pose while the posing mode is on, and put it back to the
 * built shape when it goes off (#3355).
 *
 * The scene is baked by `useModelSceneSync` for as long as the mode is on, the
 * way it is for playback, because a piece's turn is measured from its baked
 * rest. This hook owns what is done on top of that: the gizmo, and the pose.
 * Leaving rebuilds the scene from the document, which was never touched.
 */
export function usePoseMode(
  sceneRef: RefObject<SceneState | null>,
  posing: boolean,
  offsets: PoseOffsets,
  project: LegoProject,
  packRef: RefObject<LoadedPack>,
  rawRef: RefObject<RawGeometry | null>,
  projectRef: RefObject<LegoProject>,
) {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state || !posing) return;
    state.posing = true;
    attachGizmo(
      state,
      projectRef.current,
      state.selectedIdsRef.current,
      state.placingAnchorRef.current,
    );
    return () => {
      const current = sceneRef.current;
      if (!current) return;
      current.posing = false;
      restoreFromPlayback(current);
      disposeBaked(current);
      syncScene(current, packRef.current, rawRef.current, projectRef.current);
      refreshSelection(current);
      poseSkeleton(current);
      attachGizmo(
        current,
        projectRef.current,
        current.selectedIdsRef.current,
        current.placingAnchorRef.current,
      );
      current.render();
    };
  }, [sceneRef, posing, packRef, rawRef, projectRef]);

  // The document is a dependency because a change to it bakes the scene again,
  // which puts every piece back at rest underneath the pose.
  // biome-ignore lint/correctness/useExhaustiveDependencies: project is what a rebake answers to
  useEffect(() => {
    const state = sceneRef.current;
    if (!state || !posing) return;
    applyPoseOffsets(state, project, offsets);
    state.render();
  }, [sceneRef, posing, offsets, project]);
}
