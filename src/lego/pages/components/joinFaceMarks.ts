import * as THREE from "three";

import { joinFaceOutlines } from "../../connectors";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { SceneState } from "./sceneState";

/** Faces the join is made by. */
const JOINED_COLOUR = 0x22d3ee;
/** Faces nothing is joined to. */
const FREE_COLOUR = 0x94a3b8;

/**
 * Outline the faces the selected piece is joined by: its own and its parent's,
 * and with `showFree` its other faces too. Each outline is a child of the group
 * of the piece it belongs to, so it follows that piece without being moved.
 * Nothing here is part of the model, so no export sees it.
 */
export function showJoinFaces(
  state: SceneState,
  pack: LoadedPack,
  project: LegoProject,
  pieceId: string | null,
  showFree: boolean,
) {
  clearJoinFaces(state);
  if (!pieceId) return;

  for (const outline of joinFaceOutlines(project, pack, pieceId, showFree)) {
    const group = state.groups.get(outline.owner);
    if (!group) continue;
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        outline.corners.map((corner) => new THREE.Vector3(...corner)),
      ),
      new THREE.LineBasicMaterial({
        color: outline.kind === "joined" ? JOINED_COLOUR : FREE_COLOUR,
        // The face is usually on the surface or inside another part.
        depthTest: false,
        transparent: true,
      }),
    );
    line.renderOrder = 3;
    line.raycast = () => {};
    group.add(line);
    state.joinMarks.push(line);
  }
}

export function clearJoinFaces(state: SceneState) {
  for (const mark of state.joinMarks) {
    mark.removeFromParent();
    if (mark instanceof THREE.LineLoop) {
      mark.geometry.dispose();
      (mark.material as THREE.Material).dispose();
    }
  }
  state.joinMarks = [];
}
