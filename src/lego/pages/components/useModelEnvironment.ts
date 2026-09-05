import { type RefObject, useEffect, useRef } from "react";
import { REFERENCE_PARK_X, referenceParkX } from "../../buildPlate";
import type { BackdropId, GroundId } from "../../environment";
import {
  buildGameReferenceUnit,
  buildReferenceUnit,
  disposeReferenceUnit,
} from "../../referenceObject";
import {
  applyBackdrop,
  applyGround,
  applySceneScale,
  type SceneState,
} from "./ModelViewport";
import type { GameReferenceChoice } from "./ReferencePicker";

export interface ModelEnvironmentDeps {
  showGrid: boolean;
  showReference: boolean;
  gameReference: GameReferenceChoice | null;
  backdrop: BackdropId;
  ground: GroundId;
}

/**
 * The viewport's own chrome: the ground grid, the reference figure (built-in
 * or read out of a game), the sky and the solid ground.
 *
 * Bundled into one hook because all five are adjacent, independent toggles
 * over the same view aids, each already reading its own single piece of
 * state, in the same order they ran in before this hook existed.
 */
export function useModelEnvironment(
  sceneRef: RefObject<SceneState | null>,
  {
    showGrid,
    showReference,
    gameReference,
    backdrop,
    ground,
  }: ModelEnvironmentDeps,
) {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.grid.visible = showGrid;
    state.axes.visible = showGrid;
    state.render();
  }, [sceneRef, showGrid]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.reference.visible = showReference;
    applySceneScale(state);
    state.render();
  }, [sceneRef, showReference]);

  // Read by the swap below, which must not itself rerun on a toggle: rebuilding
  // a game's model every time the figure is hidden and shown again would throw
  // its geometry away and read it back.
  const showReferenceRef = useRef(showReference);
  showReferenceRef.current = showReference;

  // Swapping the figure for a game's unit, and back. The old one is freed
  // rather than kept: a real unit can be tens of thousands of triangles and
  // several textures, and the built-in one is cheap to rebuild.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.scene.remove(state.reference);
    state.disposeReference();

    if (gameReference) {
      const built = buildGameReferenceUnit(gameReference.model);
      built.group.position.set(referenceParkX(built.widthElmos), 0, 0);
      state.reference = built.group;
      state.disposeReference = built.dispose;
    } else {
      const group = buildReferenceUnit();
      group.position.set(REFERENCE_PARK_X, 0, 0);
      state.reference = group;
      state.disposeReference = () => disposeReferenceUnit(group);
    }

    state.reference.visible = showReferenceRef.current;
    state.scene.add(state.reference);
    applySceneScale(state);
    state.render();
  }, [sceneRef, gameReference]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    applyBackdrop(state, backdrop);
    state.render();
  }, [sceneRef, backdrop]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    applyGround(state, ground);
    state.render();
  }, [sceneRef, ground]);
}
