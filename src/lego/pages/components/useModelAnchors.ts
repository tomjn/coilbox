import { type RefObject, useEffect } from "react";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { showAnchors } from "./anchorsAndSnapping";
import { showJoinFaces } from "./joinFaceMarks";
import { showMountMarks } from "./mountMarks";
import type { SceneState } from "./sceneState";

/**
 * Draw the origin, seat and snap anchors, and the join faces, for the one
 * selected piece.
 *
 * Declared after the scene sync, so the group a new piece needs already
 * exists by the time this looks for it. Playback clears them: the baked scene
 * has no pivot left to point at. So does a set: a group drag seats against
 * nothing, so fifteen dots per piece would be pointing at nothing.
 */
export function useModelAnchors(
  sceneRef: RefObject<SceneState | null>,
  pack: LoadedPack,
  project: LegoProject,
  soleSelectedId: string | null,
  playing: boolean,
  showFreeFaces = false,
) {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    showAnchors(state, pack, project, playing ? null : soleSelectedId);
    showJoinFaces(
      state,
      pack,
      project,
      playing ? null : soleSelectedId,
      showFreeFaces,
    );
    showMountMarks(state, pack, project, playing);
    state.render();
  }, [sceneRef, pack, project, soleSelectedId, playing, showFreeFaces]);
}
