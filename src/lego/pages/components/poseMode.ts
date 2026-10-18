import { ENGINE_ROTATION_ORDER } from "../../animPresets";
import type { LegoProject } from "../../model";
import type { PoseOffsets } from "../../pose";
import { followPieces } from "./overlayFollow";
import type { SceneState } from "./sceneState";
import { poseSkeleton } from "./skeletonLayer";

/**
 * Put every piece of the baked scene where a pose has it (#3355).
 *
 * The groups are baked at their rest places, so a pose is the rest place plus
 * the move and a rotation of the turn alone, in the engine's order: the same
 * thing `applyTimelineFrame` does for a frame of the unit's script. A piece the
 * pose does not name goes back to rest, so applying one pose over another
 * leaves nothing of the first.
 *
 * Nothing is written to the document. Rebuilding the scene from it, which
 * leaving the mode does, puts every piece back.
 */
export function applyPoseOffsets(
  state: SceneState,
  project: LegoProject,
  offsets: PoseOffsets,
) {
  for (const piece of project.pieces) {
    const group = state.groups.get(piece.id);
    const rest = state.rest.get(piece.id);
    if (!group || !rest) continue;
    const offset = offsets[piece.id];
    const move = offset?.move ?? [0, 0, 0];
    const turn = offset?.turn ?? [0, 0, 0];
    group.rotation.order = ENGINE_ROTATION_ORDER;
    group.rotation.set(turn[0], turn[1], turn[2]);
    group.position.set(rest[0] + move[0], rest[1] + move[1], rest[2] + move[2]);
  }
  followPieces(state);
  poseSkeleton(state);
}
