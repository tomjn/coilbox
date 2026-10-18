import type * as THREE from "three";

import { pieceConnectors } from "../../connectors";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { faceMark } from "./dotsAndPoints";
import type { SceneState } from "./sceneState";

/** A mount point, drawn apart from the sky blue of an ordinary face. */
export const MOUNT_COLOUR = 0xf97316;

/**
 * Mark every mount point of every piece (#3279). Each mark is a child of the
 * group of the piece it is on, so it follows that piece. Unlike the selected
 * piece's anchors these show all the time, since a game maker wants to see where
 * the modules go without selecting each chassis piece. Nothing here is part of
 * the model, so no export sees it.
 */
export function showMountMarks(
  state: SceneState,
  pack: LoadedPack,
  project: LegoProject,
  hidden: boolean,
) {
  clearMountMarks(state);
  if (hidden) return;
  for (const piece of project.pieces) {
    if (!piece.mountPoints?.length) continue;
    const group = state.groups.get(piece.id);
    if (!group) continue;
    const pivot = piece.pivot ?? [0, 0, 0];
    const connectors = pieceConnectors(pack, piece);
    for (const mount of piece.mountPoints) {
      const connector = connectors.find((c) => c.id === mount.connector);
      if (!connector) continue;
      const mark: THREE.Object3D = faceMark(
        {
          x: connector.position[0] - pivot[0],
          y: connector.position[1] - pivot[1],
          z: connector.position[2] - pivot[2],
        },
        {
          x: connector.facing[0],
          y: connector.facing[1],
          z: connector.facing[2],
        },
        MOUNT_COLOUR,
      );
      group.add(mark);
      state.mountMarks.push(mark);
    }
  }
}

export function clearMountMarks(state: SceneState) {
  for (const mark of state.mountMarks) mark.removeFromParent();
  state.mountMarks = [];
}
