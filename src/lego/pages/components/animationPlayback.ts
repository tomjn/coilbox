import * as THREE from "three";
import {
  type AnimPreset,
  ENGINE_ROTATION_ORDER,
  presetById,
} from "../../animPresets";
import type { LegoProject } from "../../model";
import {
  frameAt,
  hiddenAt,
  poseAt,
  type ScriptTimeline,
} from "../../scriptPlayback";
import type { Vec3 } from "../../snapping";
import type { SceneState } from "./sceneState";

/**
 * Pose every animated piece for one moment in time.
 *
 * Each piece sits at its baked offset and takes the sum of every applied
 * preset's delta as a rotation about its own origin, so two presets touching
 * the same piece add up rather than one winning.
 *
 * The summed angles compose in the engine's order for as long as playback owns
 * the group, and `restoreFromPlayback` puts it back.
 */
export function applyAnimation(
  state: SceneState,
  project: LegoProject,
  t: number,
) {
  const applied = (project.animations ?? [])
    .map((entry) => ({
      preset: presetById(entry.presetId),
      params: entry.params,
    }))
    .filter(
      (
        entry,
      ): entry is { preset: AnimPreset; params: Record<string, number> } =>
        entry.preset !== undefined,
    );
  if (applied.length === 0) return;

  for (const piece of project.pieces) {
    if (!piece.role) continue;
    const group = state.groups.get(piece.id);
    const offset = state.rest.get(piece.id);
    if (!group || !offset) continue;

    // From the baked pose, not the document's: the geometry already carries
    // the piece's own rotation and scale, so a delta is a plain turn about
    // its origin, which is the only thing the engine does.
    const position: Vec3 = [...offset];
    const rotation: Vec3 = [0, 0, 0];
    for (const { preset, params } of applied) {
      const delta = preset.track(t, params, piece.role);
      if (!delta) continue;
      for (let axis = 0; axis < 3; axis++) {
        position[axis] += delta.position?.[axis] ?? 0;
        rotation[axis] += delta.rotation?.[axis] ?? 0;
      }
    }
    group.position.set(...position);
    group.rotation.order = ENGINE_ROTATION_ORDER;
    group.rotation.set(...rotation);
  }
}

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
 */
export function applyTimelineFrame(
  state: SceneState,
  project: LegoProject,
  timeline: ScriptTimeline,
  frame: number,
) {
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
 * it put in them: a piece it hid, and the rotation order it borrowed. Rebuilding
 * the scene from the document sets positions and rotations but neither of these.
 */
export function restoreFromPlayback(state: SceneState) {
  for (const group of state.groups.values()) {
    group.rotation.order = "XYZ";
    for (const child of group.children) {
      if (child instanceof THREE.Mesh) child.visible = true;
    }
  }
}
