/**
 * Put the stand-in where a scenario's track says it is on one frame.
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
import type { StandInTrack } from "../../scriptPlayback";
import { attachedAt, standInAt } from "../../standIn";
import type { SceneState } from "./sceneState";

export interface StandInPlacement {
  /** The running scenario's track, or null when it defines none. */
  track: StandInTrack | null;
  /** The piece each attach source named, keyed by the call-in it came from.
   *  A source the probe answered nothing for is simply absent. */
  attachPieces: Map<string, string>;
  /** The viewport's own toggle. */
  show: boolean;
}

const AT = new THREE.Vector3();

export function placeStandIn(
  state: SceneState,
  project: LegoProject,
  { track, attachPieces, show }: StandInPlacement,
  frame: number,
): void {
  const pose = track ? standInAt(track, frame, state.standInRadius) : null;
  if (!show || !track || !pose) {
    state.standIn.visible = false;
    return;
  }
  state.standIn.visible = true;
  state.standIn.rotation.set(0, pose.heading, 0);

  // The track's own attach piece rather than the one in force on this frame: a
  // key measured from it is measured from it after the detachment too, which is
  // how a dropped passenger falls away from the transport rather than from the
  // unit's origin.
  const piece = track.attach ? attachPieces.get(track.attach.from) : undefined;
  const group = piece ? groupOfPiece(state, project, piece) : undefined;
  const attach = attachedAt(track, frame);
  // The pose was written onto the groups a moment ago and nothing has rendered
  // since, so their world matrices are a frame out until this asks for them.
  group?.updateWorldMatrix(true, false);

  // Riding a piece: the stand-in takes that piece's position outright. Its own
  // keyed position says nothing while it is being carried.
  if (attach?.follow && group) {
    state.standIn.position.copy(group.getWorldPosition(AT));
    return;
  }

  // Sitting where a piece rests rather than riding it: a factory's build spot.
  // The rest offsets are what `showBaked` wrote, so this is the piece's place
  // before anything animated it.
  if (attach && !attach.follow && piece) {
    const rest = restOfPiece(state, project, piece);
    if (rest) {
      state.standIn.position.set(...rest);
      return;
    }
  }

  // Loose, or attached to a piece the probe never named. A key measured from
  // the attach piece is offset from wherever that piece is, so a dropped
  // passenger leaves the transport rather than the unit's origin. With no piece
  // to measure from it falls back to the unit's origin, which is the same
  // answer an ordinary key gives.
  AT.set(0, 0, 0);
  if (pose.fromAttachPiece && group) group.getWorldPosition(AT);
  state.standIn.position.set(
    AT.x + pose.pos[0],
    AT.y + pose.pos[1],
    AT.z + pose.pos[2],
  );
}

/** The scene group standing for a piece, found by the piece's name because
 *  that is what a script probe answers with. */
function groupOfPiece(
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
