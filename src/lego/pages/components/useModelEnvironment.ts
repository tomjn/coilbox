import { type RefObject, useEffect, useRef } from "react";
import * as THREE from "three";
import { REFERENCE_PARK_X, referenceParkX } from "../../buildPlate";
import type { BackdropId, GroundId, GroundShape } from "../../environment";
import {
  buildGameReferenceUnit,
  buildReferenceUnit,
  disposeReferenceUnit,
} from "../../referenceObject";
import { applySceneScale } from "./cameraFraming";
import type { GameReferenceChoice } from "./ReferencePicker";
import {
  applyBackdrop,
  applyGround,
  type SceneState,
  standReferenceOnGround,
} from "./sceneState";

export interface ModelEnvironmentDeps {
  showGrid: boolean;
  showReference: boolean;
  gameReference: GameReferenceChoice | null;
  backdrop: BackdropId;
  ground: GroundId;
  /** What `groundShape` made of the choice, null for a flat ground. Held by
   *  the caller so it is the same object for as long as nothing changes. */
  shape: GroundShape | null;
  /** How far from the origin a drive takes the unit, in elmos, or 0. */
  driveReach: number;
  /** Which way is up for the unit on that ground, from `unitUp`, or null. */
  up: [number, number, number] | null;
  /** Whether the unit is playing or showing a script run, which is when it
   *  stands on the ground the way the engine would stand it there. */
  previewing: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The viewport's own chrome: the ground grid, the reference figure (built-in
 * or read out of a game), the sky and the solid ground, and how the unit
 * stands on that ground.
 *
 * Bundled into one hook because these are adjacent, independent toggles over
 * the same view aids, each already reading its own single piece of state, in
 * the same order they ran in before this hook existed.
 */
export function useModelEnvironment(
  sceneRef: RefObject<SceneState | null>,
  {
    showGrid,
    showReference,
    gameReference,
    backdrop,
    ground,
    shape,
    driveReach,
    up,
    previewing,
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
    standReferenceOnGround(state);
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
    applyGround(state, ground, shape, driveReach);
    state.render();
  }, [sceneRef, ground, shape, driveReach]);

  // The unit turns to the ground only while it is being previewed. Building
  // happens upright, because every edit, snap and plate is measured from
  // level, and a tilted unit would put the gizmo's axes at an angle to them.
  const [upX, upY, upZ] = up ?? [0, 1, 0];
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (previewing) {
      // The shortest turn from straight up, with the heading left at 0, which
      // is the engine's own (`CSolidObject::UpdateDirVectors`).
      state.restTilt.setFromUnitVectors(UP, new THREE.Vector3(upX, upY, upZ));
    } else {
      state.restTilt.identity();
    }
    // A drive turns the unit itself, on every frame it poses.
    if (!state.drive) state.root.quaternion.copy(state.restTilt);
    state.render();
  }, [sceneRef, previewing, upX, upY, upZ]);
}
