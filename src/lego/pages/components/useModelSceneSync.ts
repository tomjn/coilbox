import { type RefObject, useEffect } from "react";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { applySceneScale, frameObject, showBaked } from "./ModelViewport";
import { type SceneState, syncScene } from "./sceneState";

/**
 * Keep the scene's pieces and transforms in step with the document, and frame
 * the whole unit the first moment it has geometry to frame.
 *
 * Structure and transforms both land here, because a piece added and a piece
 * moved are the same operation on the same map. While playing, the bake goes
 * back over the top: changing an animation's parameters must not drop the
 * scene back to its unbaked form mid-cycle.
 */
export function useModelSceneSync(
  sceneRef: RefObject<SceneState | null>,
  pack: LoadedPack,
  raw: RawGeometry | null,
  project: LegoProject,
  playing: boolean,
  reduceMotion: boolean,
) {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    syncScene(state, pack, raw, project);
    if (playing && !reduceMotion) showBaked(state, pack, raw, project);
    // Before the frame below, not after it. Framing sets the camera's distance
    // and then hands it to the orbit controls, which pull it back in to
    // whatever `maxDistance` is at the time. Left until afterwards, that was
    // the builder's own starting limit of 120, so a unit read out of a game
    // opened clipped even once nothing capped the framing distance itself.
    applySceneScale(state);
    // Framed once per scene, the moment the whole unit's geometry first has
    // something in it. A brand new unit's root piece is empty, so this keeps
    // retrying on every sync (each one is cheap: an empty box, nothing more)
    // until a piece with geometry exists, rather than giving up after the
    // first, geometry-less attempt. Once it succeeds, `framed` stops it ever
    // running again for this scene, so it never fights a camera the user has
    // since moved.
    if (!state.framed && frameObject(state, state.root)) state.framed = true;
    state.render();
  }, [sceneRef, pack, raw, project, playing, reduceMotion]);
}
