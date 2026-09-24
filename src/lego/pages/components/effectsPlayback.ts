/**
 * Draw what a running script emitted, on one frame.
 *
 * Called beside `placeStandIn`, from the same two places. Where each emission
 * starts and what it aims at is worked out once per timeline, by posing the
 * scene on the frame before it for the start and on the frame it fires for the
 * target, then putting the scene back, the way `releasePoint` reads a release.
 * After that every frame is `particlesAt`, so scrubbing back to a frame draws
 * what it drew before.
 */

import * as THREE from "three";

import {
  type Emission,
  type NanoEmission,
  particlesAt,
  type Vec3,
} from "../../effects";
import type { LegoProject } from "../../model";
import type { NanoStyle, ScriptTimeline } from "../../scriptPlayback";
import { STAND_IN_MID_Y } from "../../standIn";
import { applyTimelineFrame } from "./animationPlayback";
import type { SceneState } from "./sceneState";
import {
  groupOfPiece,
  placeStandIn,
  type StandInPlacement,
} from "./standInPlayback";

const AT = new THREE.Vector3();
const NOTHING = particlesAt([], 0);

interface Resolved {
  radius: number;
  nano: NanoStyle;
  emissions: Emission[];
}

/** Emissions already worked out, per timeline. A new run is a new timeline.
 *  Kept alongside what they depend on besides the run, so a stand-in resized
 *  under the same run is worked out again. */
const RESOLVED = new WeakMap<ScriptTimeline, Resolved>();

export function placeEffects(
  state: SceneState,
  project: LegoProject,
  standIn: StandInPlacement,
  show: boolean,
  timeline: ScriptTimeline | null,
  frame: number,
): void {
  state.effects.object.visible = show;
  const nano = standIn.nano ?? null;
  if (!show || !timeline || !nano || !standIn.track) {
    state.effects.update(NOTHING);
    return;
  }
  const emissions = resolve(state, project, standIn, nano, timeline, frame);
  state.effects.update(particlesAt(emissions, frame));
}

function resolve(
  state: SceneState,
  project: LegoProject,
  standIn: StandInPlacement,
  nano: NanoStyle,
  timeline: ScriptTimeline,
  frame: number,
): Emission[] {
  const known = RESOLVED.get(timeline);
  if (known && known.radius === state.standInRadius && known.nano === nano) {
    return known.emissions;
  }

  // The stand-in is where the spray goes whether or not it is being shown.
  const seen = { ...standIn, show: true };
  const emissions: Emission[] = [];
  let posed = -1;
  // Each nozzle's latest emission in the current unbroken run of spraying
  // frames, so its span can reach to when that nozzle next fires.
  const latest = new Map<string, NanoEmission>();
  let lastSpraying = -2;
  timeline.events.forEach((event, seed) => {
    if (event.kind !== "nano") return;
    if (event.frame !== lastSpraying + 1) latest.clear();
    lastSpraying = event.frame;
    if (event.piece === null) return;
    const group = groupOfPiece(state, project, event.piece);
    if (!group) return;

    // The nozzle is the nano piece's position on the frame before the one it
    // fires on, but the target is the buildee's own `midPos` read on the
    // firing frame itself (`Builder.cpp:353,987-988`), so the two are posed
    // separately.
    const before = Math.max(event.frame - 1, 0);
    if (before !== posed) {
      applyTimelineFrame(state, project, timeline, before);
      posed = before;
    }
    group.updateWorldMatrix(true, false);
    group.getWorldPosition(AT);
    const at: Vec3 = [AT.x, AT.y, AT.z];

    if (event.frame !== posed) {
      applyTimelineFrame(state, project, timeline, event.frame);
      posed = event.frame;
    }
    placeStandIn(state, project, seen, timeline, event.frame);
    const to: Vec3 = [
      state.standIn.position.x,
      state.standIn.position.y + STAND_IN_MID_Y * state.standInRadius,
      state.standIn.position.z,
    ];
    const emission: NanoEmission = {
      kind: "nano",
      birth: event.frame,
      at,
      to,
      radius: state.standInRadius * 0.5,
      style: nano,
      seed,
    };
    const previous = latest.get(event.piece);
    if (previous) previous.span = event.frame - previous.birth;
    latest.set(event.piece, emission);
    emissions.push(emission);
  });
  if (posed !== -1) {
    applyTimelineFrame(state, project, timeline, frame);
    placeStandIn(state, project, standIn, timeline, frame);
  }

  RESOLVED.set(timeline, { radius: state.standInRadius, nano, emissions });
  return emissions;
}
