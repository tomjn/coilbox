import { type RefObject, useEffect } from "react";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { showAnchors } from "./anchorsAndSnapping";
import type { SceneState } from "./sceneState";

/**
 * Draw the origin, seat and snap anchors for the one selected piece.
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
) {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    showAnchors(state, pack, project, playing ? null : soleSelectedId);
    state.render();
  }, [sceneRef, pack, project, soleSelectedId, playing]);
}
