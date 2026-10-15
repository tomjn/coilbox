import type { ReplayTrackHandle } from "../replayTrack";

/**
 * Everything the map view draws at one frame (#3807), as flat arrays the
 * painter and the pointer both read.
 *
 * One scene is made for a view and filled again for each picture, so drawing
 * allocates nothing once the arrays have grown to the match's busiest frame.
 * The arrays stay inside the view. Nothing here is ever a React prop.
 */
export interface MapScene {
  /** The frame the scene was last filled for, or -1 before the first. */
  frame: number;
  units: number;
  /** Elmos along x and z. */
  unitX: Float32Array;
  unitZ: Float32Array;
  /** Where the unit's front points on the map. */
  unitFx: Float32Array;
  unitFz: Float32Array;
  /** Half the footprint in elmos: across the unit, and along its facing. */
  unitAcross: Float32Array;
  unitAlong: Float32Array;
  /** 0 to 1, with 1 for complete. */
  unitBuild: Float32Array;
  unitTeam: Uint8Array;
  unitDef: Uint16Array;
  unitSerial: Uint32Array;
  projectiles: number;
  shotX: Float32Array;
  shotZ: Float32Array;
  /** Elmos per frame. */
  shotVx: Float32Array;
  shotVz: Float32Array;
  wrecks: number;
  wreckX: Float32Array;
  wreckZ: Float32Array;
}

/** Room for this many of each to begin with. The arrays double when a frame
 *  has more, so this is where they start and not a limit. */
const START = 256;

export function createMapScene(): MapScene {
  return {
    frame: -1,
    units: 0,
    unitX: new Float32Array(START),
    unitZ: new Float32Array(START),
    unitFx: new Float32Array(START),
    unitFz: new Float32Array(START),
    unitAcross: new Float32Array(START),
    unitAlong: new Float32Array(START),
    unitBuild: new Float32Array(START),
    unitTeam: new Uint8Array(START),
    unitDef: new Uint16Array(START),
    unitSerial: new Uint32Array(START),
    projectiles: 0,
    shotX: new Float32Array(START),
    shotZ: new Float32Array(START),
    shotVx: new Float32Array(START),
    shotVz: new Float32Array(START),
    wrecks: 0,
    wreckX: new Float32Array(START),
    wreckZ: new Float32Array(START),
  };
}

type Arrays = Float32Array | Uint8Array | Uint16Array | Uint32Array;

function grown<T extends Arrays>(array: T): T {
  const next = new (array.constructor as new (n: number) => T)(
    array.length * 2,
  );
  next.set(array);
  return next;
}

function growUnits(s: MapScene): void {
  s.unitX = grown(s.unitX);
  s.unitZ = grown(s.unitZ);
  s.unitFx = grown(s.unitFx);
  s.unitFz = grown(s.unitFz);
  s.unitAcross = grown(s.unitAcross);
  s.unitAlong = grown(s.unitAlong);
  s.unitBuild = grown(s.unitBuild);
  s.unitTeam = grown(s.unitTeam);
  s.unitDef = grown(s.unitDef);
  s.unitSerial = grown(s.unitSerial);
}

function growShots(s: MapScene): void {
  s.shotX = grown(s.shotX);
  s.shotZ = grown(s.shotZ);
  s.shotVx = grown(s.shotVx);
  s.shotVz = grown(s.shotVz);
}

/**
 * Fills `scene` with what the track has at `frame`. False, with the scene left
 * as it was, while the frame's window is still loading: the view keeps the
 * picture it has.
 *
 * A wreck is a feature that appeared after the track's first frame. A feature
 * that was there from the start is the map's own scenery, a tree or a rock,
 * and the map's picture already shows it.
 */
export function collectScene(
  handle: ReplayTrackHandle,
  frame: number,
  scene: MapScene,
): boolean {
  if (!handle.isReady(frame)) return false;
  const { unitFootprints, features, firstFrame } = handle.header;

  let units = 0;
  handle.forEachUnit(frame, (u) => {
    if (units === scene.unitX.length) growUnits(scene);
    const footprint = unitFootprints[u.def];
    scene.unitX[units] = u.x;
    scene.unitZ[units] = u.z;
    scene.unitFx[units] = u.fx;
    scene.unitFz[units] = u.fz;
    scene.unitAcross[units] = footprint ? footprint[0] / 2 : 0;
    scene.unitAlong[units] = footprint ? footprint[1] / 2 : 0;
    scene.unitBuild[units] = u.build;
    scene.unitTeam[units] = u.team;
    scene.unitDef[units] = u.def;
    scene.unitSerial[units] = u.serial;
    units++;
  });

  let shots = 0;
  handle.forEachProjectile(frame, (p) => {
    if (shots === scene.shotX.length) growShots(scene);
    scene.shotX[shots] = p.x;
    scene.shotZ[shots] = p.z;
    scene.shotVx[shots] = p.vx;
    scene.shotVz[shots] = p.vz;
    shots++;
  });

  let wrecks = 0;
  for (let i = 0; i < features.first.length; i++) {
    const first = features.first[i];
    if (first <= firstFrame || first > frame || features.last[i] < frame) {
      continue;
    }
    if (wrecks === scene.wreckX.length) {
      scene.wreckX = grown(scene.wreckX);
      scene.wreckZ = grown(scene.wreckZ);
    }
    scene.wreckX[wrecks] = features.x[i];
    scene.wreckZ[wrecks] = features.z[i];
    wrecks++;
  }

  scene.frame = frame;
  scene.units = units;
  scene.projectiles = shots;
  scene.wrecks = wrecks;
  return true;
}

/**
 * The unit under a point on the map, as an index into the scene, or -1. All
 * four numbers are elmos.
 *
 * `least` is half the smallest size a mark is drawn at, so a unit whose
 * footprint is smaller than its mark is found anywhere on the mark. `slop`
 * widens every mark by that much, for a pointer that is nearly on one. Where
 * marks overlap it takes the unit whose middle is nearest.
 *
 * This is one pass over the scene for each pointer event, not for each
 * animation frame.
 */
export function unitAt(
  scene: MapScene,
  x: number,
  z: number,
  least: number,
  slop: number,
): number {
  let found = -1;
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < scene.units; i++) {
    const dx = x - scene.unitX[i];
    const dz = z - scene.unitZ[i];
    let fx = scene.unitFx[i];
    let fz = scene.unitFz[i];
    const length = Math.hypot(fx, fz);
    // A unit pointing straight up or down has no facing on the map.
    if (length < 1e-6) {
      fx = 0;
      fz = 1;
    } else {
      fx /= length;
      fz /= length;
    }
    const along = Math.abs(dx * fx + dz * fz);
    const across = Math.abs(dz * fx - dx * fz);
    if (
      along > Math.max(scene.unitAlong[i], least) + slop ||
      across > Math.max(scene.unitAcross[i], least) + slop
    ) {
      continue;
    }
    const distance = dx * dx + dz * dz;
    if (distance < nearest) {
      nearest = distance;
      found = i;
    }
  }
  return found;
}
