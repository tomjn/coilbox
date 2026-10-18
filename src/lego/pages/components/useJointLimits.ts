import { type RefObject, useEffect } from "react";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { pieceWorldRest } from "../../s3oBuild";
import { applySceneScale } from "./cameraFraming";
import { buildJointLimits, disposeJointLimits } from "./jointLimitsLayer";
import type { SceneState } from "./sceneState";

/**
 * Draw the turn range of the selected piece, while exactly one piece is
 * selected and it has one. `pieceId` is null for no piece or several.
 */
export function useJointLimits(
  sceneRef: RefObject<SceneState | null>,
  {
    project,
    pack,
    raw,
    pieceId,
  }: {
    project: LegoProject;
    pack: LoadedPack;
    raw: RawGeometry | null;
    pieceId: string | null;
  },
): void {
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (state.jointLimits) disposeJointLimits(state.jointLimits);
    state.jointLimits = null;
    const piece = pieceId
      ? project.pieces.find((candidate) => candidate.id === pieceId)
      : undefined;
    const at = piece?.limits
      ? pieceWorldRest(project, pack, raw).get(piece.name)
      : undefined;
    if (piece && at) {
      state.jointLimits = buildJointLimits(piece.limits, at);
      if (state.jointLimits) state.overlay.add(state.jointLimits);
    }
    applySceneScale(state);
    state.render();
  }, [sceneRef, project, pack, raw, pieceId]);
}
