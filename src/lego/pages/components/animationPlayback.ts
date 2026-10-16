import * as THREE from "three";
import type { LegoProject } from "../../model";
import {
  frameAt,
  hiddenAt,
  poseAt,
  type ScriptTimeline,
} from "../../scriptPlayback";
import { poseRoot, restoreFromDrive } from "./drivePlayback";
import type { SceneState } from "./sceneState";

/**
 * Pose every piece the way the unit's own script put it at one moment.
 *
 * The engine composes a piece's rotations y, then x, then z, so the groups are
 * put in that order for as long as playback owns them. Three's own default is
 * x, y, z, which agrees only while a piece turns about one axis at a time.
 *
 * A run that stopped early loops at the length it reached, so a script that
 * threw two seconds in plays those two seconds rather than freezing on one.
 */
export function applyTimeline(
  state: SceneState,
  project: LegoProject,
  timeline: ScriptTimeline,
  seconds: number,
) {
  const frame = frameAt(timeline, seconds);
  if (frame < 0) return;
  applyTimelineFrame(state, project, timeline, frame);
}

/**
 * Pose every piece at one exact frame, for a paused run being scrubbed or
 * stepped rather than played. `applyTimeline` is the running clock's own way
 * of reaching this: it turns elapsed seconds into a frame and calls through.
 *
 * The whole unit goes where a drive has it on the frame too, so anything that
 * poses a frame to read a piece's place in the world, an effect or a released
 * stand-in, reads it where the unit is on that frame.
 */
export function applyTimelineFrame(
  state: SceneState,
  project: LegoProject,
  timeline: ScriptTimeline,
  frame: number,
) {
  poseRoot(state, frame);
  for (let index = 0; index < timeline.pieces.length; index++) {
    const piece = project.pieces.find(
      (candidate) => candidate.name === timeline.pieces[index],
    );
    const group = piece ? state.groups.get(piece.id) : undefined;
    const offset = piece ? state.rest.get(piece.id) : undefined;
    if (!group || !offset) continue;

    const pose = poseAt(timeline, frame, index);
    if (!pose) continue;
    group.position.set(
      offset[0] + pose[0],
      offset[1] + pose[1],
      offset[2] + pose[2],
    );
    group.rotation.order = "YXZ";
    group.rotation.set(pose[3], pose[4], pose[5]);

    // The piece's own mesh rather than its group: hiding a piece in the engine
    // leaves its children where they were, and a group takes everything under
    // it with it.
    const mesh = group.children.find((child) => child instanceof THREE.Mesh);
    if (mesh) mesh.visible = !hiddenAt(timeline, frame, index);
  }
}

/**
 * Undo what playing a script did to the groups themselves, as opposed to what
 * it put in them: a piece it hid, the rotation order it borrowed, and where a
 * drive took the whole unit. Rebuilding the scene from the document sets
 * positions and rotations but none of these.
 */
export function restoreFromPlayback(state: SceneState) {
  restoreFromDrive(state);
  for (const group of state.groups.values()) {
    group.rotation.order = "XYZ";
    for (const child of group.children) {
      if (child instanceof THREE.Mesh) child.visible = true;
    }
  }
}
