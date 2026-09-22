/**
 * A crude, inert second unit for the model editor to aim at, build and carry.
 *
 * A sibling of `referenceObject.ts` rather than a mode of it. The reference
 * figure is a real game unit and exists to judge scale against. This is a
 * shape with no game behind it, and exists so that an animation has something
 * to be about. An aim that is right and an aim that is wrong look the same
 * against an empty scene.
 *
 * It knows nothing about scripts. A scenario says where it goes, the viewport
 * puts it there, and `aimResolver.ts` works out what the unit should be told
 * about it.
 */

import type { StandInAttach, StandInKey, StandInTrack } from "./scriptPlayback";
import type { UnitBounds } from "./s3oBuild";

type Vec3 = [number, number, number];

/**
 * How big the stand-in is beside the unit being edited: a third of the unit's
 * wider horizontal extent.
 *
 * Judged by looking rather than derived. A fixed size is a speck beside a
 * factory and a wall beside a scout, and the point of the thing is that it
 * reads as another unit.
 */
const RADIUS_FRACTION = 1 / 3;
/** The smallest it goes, in elmos, so a unit with almost nothing built yet
 *  still has something visible to aim at. */
const MIN_RADIUS = 6;
/** The largest, so the biggest factory in a game gets a target rather than a
 *  second building. */
const MAX_RADIUS = 40;

/**
 * How high the stand-in's middle is above its base, in multiples of its
 * radius.
 *
 * A track's positions say where the stand-in stands, so `y: 0` sits it on the
 * ground exactly as the engine stands a unit on `y = 0`. What a weapon aims at
 * is the unit's middle, so this is what the resolver adds. Half the height the
 * shape in `buildStandIn` is built to.
 */
export const STAND_IN_MID_Y = 0.55;

/** How big the stand-in beside this unit should be, in elmos. */
export function standInRadius(bounds: UnitBounds): number {
  const across = Math.max(bounds.sizeX, bounds.sizeZ) * RADIUS_FRACTION;
  return Math.min(Math.max(across, MIN_RADIUS), MAX_RADIUS);
}

/** Where the stand-in is on one frame, in elmos, and which way it faces. */
export interface StandInPose {
  /** Unit-local, in elmos. Measured from the attach piece when
   *  `fromAttachPiece` says so, and from the unit's origin otherwise. */
  pos: Vec3;
  /** Radians about the vertical axis, relative to the unit's facing. */
  heading: number;
  fromAttachPiece: boolean;
}

/**
 * Where a track puts the stand-in on one frame.
 *
 * Keys interpolate linearly. A frame outside the track holds the nearest key
 * rather than extrapolating past it, because a scenario that stops asking for
 * something has stopped asking, and a stand-in sliding out of the scene at the
 * end of a preview would be a bug that looks like a feature.
 */
export function standInAt(
  track: StandInTrack,
  frame: number,
  radius: number,
): StandInPose | null {
  const { keys } = track;
  if (keys.length === 0) return null;

  const first = keys[0];
  if (frame <= first.frame) return posed(first, radius);
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return posed(last, radius);

  for (let i = 1; i < keys.length; i++) {
    const to = keys[i];
    if (frame > to.frame) continue;
    const from = keys[i - 1];
    const span = to.frame - from.frame;
    // Two keys on the same frame: the later one wins, as the loop's own
    // ordering already implies, rather than dividing by nothing.
    const t = span === 0 ? 1 : (frame - from.frame) / span;
    return {
      pos: [
        mix(from.pos[0], to.pos[0], t) * radius,
        mix(from.pos[1], to.pos[1], t) * radius,
        mix(from.pos[2], to.pos[2], t) * radius,
      ],
      heading: mix(from.heading ?? 0, to.heading ?? 0, t),
      // The key being moved towards, since that is the one that says where the
      // motion ends up. Tracks never mix the two origins mid-move.
      fromAttachPiece: to.fromAttachPiece ?? false,
    };
  }
  return posed(last, radius);
}

function posed(key: StandInKey, radius: number): StandInPose {
  return {
    pos: [key.pos[0] * radius, key.pos[1] * radius, key.pos[2] * radius],
    heading: key.heading ?? 0,
    fromAttachPiece: key.fromAttachPiece ?? false,
  };
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The attachment in force on a frame, or null when the stand-in is loose. */
export function attachedAt(
  track: StandInTrack,
  frame: number,
): StandInAttach | null {
  const attach = track.attach;
  if (!attach) return null;
  if (frame < attach.frame) return null;
  if (attach.until !== null && frame >= attach.until) return null;
  return attach;
}
