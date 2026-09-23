/**
 * Put the stand-in where the running script and the scenario's track say it is
 * on one frame.
 *
 * Called from the same places that pose the pieces, because it is the same
 * question asked about a different object: a running clock's tick, and the one
 * frame a paused run is held on. Keeping the two together is what stops the
 * stand-in lagging the unit by a frame while scrubbing.
 *
 * Pure with respect to time: everything it needs comes from the frame number,
 * so scrubbing back to a frame gives exactly the picture it gave before.
 */

import * as THREE from "three";

import type { LegoProject } from "../../model";
import type {
  NanoStyle,
  ScriptTimeline,
  StandInTrack,
} from "../../scriptPlayback";
import {
  attachedAt,
  type PassengerState,
  passengerAt,
  standInAfterRelease,
  standInAt,
} from "../../standIn";
import { applyTimelineFrame } from "./animationPlayback";
import type { SceneState } from "./sceneState";

type Vec3 = [number, number, number];

export interface StandInPlacement {
  /** The running scenario's track, or null when it defines none. */
  track: StandInTrack | null;
  /** The piece each attach source named, keyed by the call-in it came from.
   *  A source the probe answered nothing for is simply absent. */
  attachPieces: Map<string, string>;
  /** The viewport's own toggle. */
  show: boolean;
  /** How the running scenario's unit sprays nano at the stand-in, or null
   *  when it does not. */
  nano?: NanoStyle | null;
}

const AT = new THREE.Vector3();
const LOOSE: PassengerState = { kind: "loose" };

/**
 * The placement to hand to script frame stepping, with the viewport's own
 * toggle swapped in for `show`.
 *
 * The track and `nano` come along unchanged, because nano spray goes to the
 * stand-in whether or not it is being shown: only the mesh's own visibility
 * should follow the toggle.
 */
export function standInFor(
  standIn: StandInPlacement,
  showStandIn: boolean,
): StandInPlacement {
  return { ...standIn, show: showStandIn };
}

export function placeStandIn(
  state: SceneState,
  project: LegoProject,
  { track, attachPieces, show }: StandInPlacement,
  timeline: ScriptTimeline | null,
  frame: number,
): void {
  if (!show || !track) {
    state.standIn.visible = false;
    return;
  }

  // From its first attach the script owns where the stand-in is, so its events
  // come ahead of the track.
  const passenger = timeline ? passengerAt(timeline.events, frame) : LOOSE;
  if (passenger.kind === "void") {
    state.standIn.visible = false;
    return;
  }
  if (passenger.kind === "riding") {
    const group = groupOfPiece(state, project, passenger.piece);
    if (group) {
      // The pose was written onto the groups a moment ago and nothing has
      // rendered since, so their world matrices are a frame out until this
      // asks for them. Drawn from the three.js hierarchy, which composes
      // rotations, so a stand-in on a turned boom is where the boom is.
      group.updateWorldMatrix(true, false);
      state.standIn.visible = true;
      state.standIn.rotation.set(0, 0, 0);
      state.standIn.position.copy(group.getWorldPosition(AT));
      return;
    }
  }
  if (passenger.kind === "released" && timeline) {
    const at = releasePoint(state, project, timeline, passenger, frame);
    const pose = standInAfterRelease(
      track,
      frame,
      { frame: passenger.frame, at },
      state.standInRadius,
    );
    state.standIn.visible = true;
    state.standIn.rotation.set(0, pose.heading, 0);
    state.standIn.position.set(...pose.pos);
    return;
  }

  placeLoose(state, project, track, attachPieces, frame);
}

/** Before anything has attached it, the track, as it always was. */
function placeLoose(
  state: SceneState,
  project: LegoProject,
  track: StandInTrack,
  attachPieces: Map<string, string>,
  frame: number,
): void {
  const pose = standInAt(track, frame, state.standInRadius);
  if (!pose) {
    state.standIn.visible = false;
    return;
  }
  state.standIn.visible = true;
  state.standIn.rotation.set(0, pose.heading, 0);

  // A factory's build spot: where its piece rests, not where the doors have
  // swung it. The rest offsets are what `showBaked` wrote.
  const attach = attachedAt(track, frame);
  const piece = attach ? attachPieces.get(attach.from) : undefined;
  const rest = piece ? restOfPiece(state, project, piece) : null;
  if (rest) {
    state.standIn.position.set(...rest);
    return;
  }

  // Loose, or on a build piece the probe never named. Nothing has been let go
  // yet, so every key is measured from the unit's origin.
  state.standIn.position.set(...pose.pos);
}

/** Release points already read, per timeline and drop frame, so scrubbing
 *  stays a pure function of the frame. A new run is a new timeline. */
const RELEASES = new WeakMap<ScriptTimeline, Map<number, Vec3>>();

/**
 * Where a dropped stand-in was let go: its piece's world position on the frame
 * before the drop, which is the last place `UpdateTransportees` put it
 * (`rts/Sim/Units/Unit.cpp:718-757`). The unit's own origin for one dropped out
 * of the void (`Unit.cpp:726-732`).
 *
 * Read by posing the scene on that frame and asking the group, so a piece on a
 * turned boom is where it is, then posing the scene back to `frame`.
 */
function releasePoint(
  state: SceneState,
  project: LegoProject,
  timeline: ScriptTimeline,
  released: { frame: number; from: string | null },
  frame: number,
): Vec3 {
  let known = RELEASES.get(timeline);
  if (!known) {
    known = new Map();
    RELEASES.set(timeline, known);
  }
  const cached = known.get(released.frame);
  if (cached) return cached;

  let at: Vec3 = [0, 0, 0];
  const group = released.from
    ? groupOfPiece(state, project, released.from)
    : undefined;
  if (group) {
    applyTimelineFrame(
      state,
      project,
      timeline,
      Math.max(released.frame - 1, 0),
    );
    group.updateWorldMatrix(true, false);
    group.getWorldPosition(AT);
    at = [AT.x, AT.y, AT.z];
    applyTimelineFrame(state, project, timeline, frame);
  }
  known.set(released.frame, at);
  return at;
}

/** The scene group standing for a piece, found by the piece's name because
 *  that is what a script probe answers with. */
export function groupOfPiece(
  state: SceneState,
  project: LegoProject,
  name: string,
): THREE.Group | undefined {
  const piece = project.pieces.find((candidate) => candidate.name === name);
  return piece ? state.groups.get(piece.id) : undefined;
}

/** Where a piece rests, accumulated from the offsets playback wrote into
 *  `state.rest`, which is the bake rather than the document. */
function restOfPiece(
  state: SceneState,
  project: LegoProject,
  name: string,
): [number, number, number] | null {
  let piece = project.pieces.find((candidate) => candidate.name === name);
  const at: [number, number, number] = [0, 0, 0];
  while (piece) {
    const offset = state.rest.get(piece.id);
    if (!offset) return null;
    at[0] += offset[0];
    at[1] += offset[1];
    at[2] += offset[2];
    const parentId = piece.parentId;
    piece = parentId
      ? project.pieces.find((candidate) => candidate.id === parentId)
      : undefined;
  }
  return at;
}
