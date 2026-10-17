import { type RefObject, useEffect } from "react";
import * as THREE from "three";
import { guideLines, guidePlanes } from "../../guides";
import type { LegoProject } from "../../model";
import { type LoadedPack, partUnit } from "../../pack";
import { buildGuides, disposeGuides } from "./guideLayer";
import type { SceneState } from "./sceneState";

/** The smallest a guide square is drawn, in part units, for a unit with
 *  nothing in it to size them by. */
const EMPTY_UNIT_PARTS = 8;

/**
 * Draw the unit's guide planes while `show` is on, and hand the same planes to
 * the drag, so only a guide that can be seen can pull a piece.
 *
 * `scene` is only a dependency to pick up the fresh scene `useCanvas3D` builds
 * when it rebuilds, which would otherwise have no guides until the next edit.
 */
export function useGuides(
  sceneRef: RefObject<SceneState | null>,
  {
    project,
    pack,
    show,
    symmetry = false,
  }: {
    project: LegoProject;
    pack: LoadedPack;
    show: boolean;
    /** Add the built-in symmetry plane. */
    symmetry?: boolean;
  },
  scene: unknown,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: scene is only here to rerun the effect on a rebuilt scene
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (state.guideLayer) disposeGuides(state.guideLayer);
    state.guideLayer = null;

    const planes = show ? guidePlanes(project, { symmetry }) : [];
    const lines = show ? guideLines(project) : [];
    state.guidePlanes = planes;
    state.guideLines = lines;
    if (planes.length > 0 || lines.length > 0) {
      state.guideLayer = buildGuides(
        planes,
        new THREE.Box3().setFromObject(state.root),
        partUnit(pack) * EMPTY_UNIT_PARTS,
        lines,
      );
      state.overlay.add(state.guideLayer);
    }
    state.render();
  }, [sceneRef, project, pack, show, symmetry, scene]);
}
