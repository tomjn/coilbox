/**
 * Draw what a running script emitted, on one frame: nano spray, a muzzle
 * flame for each flare, and a tracer for each shot.
 *
 * Called beside `placeStandIn`, from the same two places. Where each emission
 * starts and what it aims at is worked out once per timeline, by posing the
 * scene on the frame before it for the start and on the frame it fires for the
 * target, then putting the scene back, the way `releasePoint` reads a release.
 * After that every frame is `particlesAt`, so scrubbing back to a frame draws
 * what it drew before.
 */

import * as THREE from "three";

import type { Aim } from "../../aimResolver";
import {
  DEFAULT_FLAME_SIZE,
  type Emission,
  emitPoint,
  type NanoEmission,
  particlesAt,
  type Vec3,
} from "../../effects";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { bakedPieces } from "../../s3oBuild";
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

/** A piece's vertices as the export writes them, in its own space, by name. */
export type PieceVertices = (piece: string) => Vec3[];

let lastBake: {
  project: LegoProject;
  pack: LoadedPack;
  raw: RawGeometry | null;
  vertices: PieceVertices;
} | null = null;

/** `PieceVertices` from the bake the exporter and playback share, worked out
 *  once for each project, pack and geometry. */
export function bakedVertices(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): PieceVertices {
  if (
    lastBake &&
    lastBake.project === project &&
    lastBake.pack === pack &&
    lastBake.raw === raw
  ) {
    return lastBake.vertices;
  }
  const { pieces } = bakedPieces(project, pack, raw);
  const byName = new Map<string, Vec3[]>();
  for (const baked of pieces.values()) {
    byName.set(
      baked.name,
      baked.vertices.map((vertex) => vertex.pos),
    );
  }
  const vertices: PieceVertices = (piece) => byName.get(piece) ?? [];
  lastBake = { project, pack, raw, vertices };
  return vertices;
}

interface Resolved {
  radius: number;
  nano: NanoStyle | null;
  aims: Aim[] | undefined;
  vertices: PieceVertices;
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
  vertices: PieceVertices,
): void {
  state.effects.object.visible = show;
  if (!show || !timeline) {
    state.effects.update(NOTHING);
    return;
  }
  const nano = standIn.nano ?? null;
  const emissions = resolve(
    state,
    project,
    standIn,
    nano,
    timeline,
    frame,
    vertices,
  );
  state.effects.update(particlesAt(emissions, frame, state.effects.smokeCount));
}

/** The latest `aims` entry at or before `frame`, normalised, or up when there
 *  is none: the unit's `lastMuzzleFlameDir` before any weapon fires
 *  (`Unit.h:332`). Aims come in frame order, so a forward scan keeping the
 *  last one that qualifies is enough. */
function latestAim(aims: Aim[] | undefined, frame: number): Vec3 {
  let found: Vec3 | null = null;
  for (const aim of aims ?? []) {
    if (aim.frame > frame) break;
    found = aim.dir;
  }
  if (!found) return [0, 1, 0];
  const length = Math.hypot(...found);
  if (length === 0) return [0, 1, 0];
  return [found[0] / length, found[1] / length, found[2] / length];
}

function resolve(
  state: SceneState,
  project: LegoProject,
  standIn: StandInPlacement,
  nano: NanoStyle | null,
  timeline: ScriptTimeline,
  frame: number,
  vertices: PieceVertices,
): Emission[] {
  const known = RESOLVED.get(timeline);
  if (
    known &&
    known.radius === state.standInRadius &&
    known.nano === nano &&
    known.aims === standIn.aims &&
    known.vertices === vertices
  ) {
    return known.emissions;
  }

  // The stand-in is where the spray and the shots go whether or not it is
  // being shown.
  const seen = { ...standIn, show: true };
  const emissions: Emission[] = [];
  let posed = -1;
  // Each nozzle's latest emission in the current unbroken run of spraying
  // frames, so its span can reach to when that nozzle next fires.
  const latest = new Map<string, NanoEmission>();
  let lastSpraying = -2;

  // A piece that turns on the very frame an event fires has already turned by
  // the time this reads it, so that turn is missed here, a known limit of
  // reading the frame before.
  const poseBefore = (eventFrame: number) => {
    const before = Math.max(eventFrame - 1, 0);
    if (before !== posed) {
      applyTimelineFrame(state, project, timeline, before);
      posed = before;
    }
  };

  const standInMiddle = (atFrame: number): Vec3 => {
    if (atFrame !== posed) {
      applyTimelineFrame(state, project, timeline, atFrame);
      posed = atFrame;
    }
    placeStandIn(state, project, seen, timeline, atFrame);
    return [
      state.standIn.position.x,
      state.standIn.position.y + STAND_IN_MID_Y * state.standInRadius,
      state.standIn.position.z,
    ];
  };

  timeline.events.forEach((event, seed) => {
    if (event.kind === "nano") {
      if (!nano || !standIn.track) return;
      if (event.frame !== lastSpraying + 1) latest.clear();
      lastSpraying = event.frame;
      if (event.piece === null) return;
      const group = groupOfPiece(state, project, event.piece);
      if (!group) return;

      // The nozzle is the nano piece's position on the frame before the one it
      // fires on, but the target is the buildee's own `midPos` read on the
      // firing frame itself (`Builder.cpp:353,987-988`), so the two are posed
      // separately.
      poseBefore(event.frame);
      group.updateWorldMatrix(true, false);
      group.getWorldPosition(AT);
      const at: Vec3 = [AT.x, AT.y, AT.z];

      const to = standInMiddle(event.frame);
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
      return;
    }

    if (event.kind === "flare") {
      const group = groupOfPiece(state, project, event.piece);
      if (!group) return;
      poseBefore(event.frame);
      group.updateWorldMatrix(true, false);
      group.getWorldPosition(AT);
      const at: Vec3 = [AT.x, AT.y, AT.z];
      emissions.push({
        kind: "flame",
        birth: event.frame,
        at,
        dir: latestAim(standIn.aims, event.frame),
        size: DEFAULT_FLAME_SIZE,
        seed,
      });
      return;
    }

    if (event.kind === "shot") {
      if (!standIn.track || event.piece === null) return;
      const group = groupOfPiece(state, project, event.piece);
      if (!group) return;
      poseBefore(event.frame);
      group.updateWorldMatrix(true, false);
      const { pos } = emitPoint(vertices(event.piece));
      AT.set(...pos).applyMatrix4(group.matrixWorld);
      const at: Vec3 = [AT.x, AT.y, AT.z];

      emissions.push({
        kind: "tracer",
        birth: event.frame,
        at,
        to: standInMiddle(event.frame),
        seed,
      });
    }
  });
  if (posed !== -1) {
    applyTimelineFrame(state, project, timeline, frame);
    placeStandIn(state, project, standIn, timeline, frame);
  }

  RESOLVED.set(timeline, {
    radius: state.standInRadius,
    nano,
    aims: standIn.aims,
    vertices,
    emissions,
  });
  return emissions;
}
