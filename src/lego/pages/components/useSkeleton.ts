import { type RefObject, useEffect } from "react";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { skeletonJoints } from "../../skeletonJoints";
import { dotMaterial } from "./dotsAndPoints";
import type { SceneState } from "./sceneState";
import {
  buildSkeleton,
  disposeSkeleton,
  SKELETON_COLOUR,
} from "./skeletonLayer";

/** The joint marker's width on screen, in pixels. */
const JOINT_DOT = 9;

/**
 * Draw the unit's skeleton while `show` is on, and free it when it is off.
 * The drawing is of the rest pose.
 * While a script plays, `applyTimelineFrame` moves it onto the pieces.
 */
export function useSkeleton(
  sceneRef: RefObject<SceneState | null>,
  {
    project,
    pack,
    raw,
    show,
  }: {
    project: LegoProject;
    pack: LoadedPack;
    raw: RawGeometry | null;
    show: boolean;
  },
): void {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (state.skeleton) disposeSkeleton(state.skeleton);
    state.skeleton = null;
    if (show) {
      state.skeleton = buildSkeleton(
        skeletonJoints(project, pack, raw),
        dotMaterial(
          JOINT_DOT,
          state.renderer.getPixelRatio(),
          false,
          SKELETON_COLOUR,
        ),
      );
      if (state.skeleton) state.overlay.add(state.skeleton);
    }
    state.render();
  }, [sceneRef, project, pack, raw, show]);
}
