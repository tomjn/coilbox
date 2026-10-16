/**
 * A target the game maker sets moving, for the "Aiming and firing" scenario.
 *
 * A turret that aims well at a target standing still can still turn the long
 * way round, lag behind a crossing target or swing past its limit. This turns
 * a choice of path and speed into a stand-in track that keeps moving for the
 * whole preview, so the weapon is always chasing something.
 *
 * Everything is in the stand-in's own radius, as every track is, so one
 * motion suits a scout and a factory. The speed is the one exception: it is a
 * multiple of the unit's own speed, because a fast target and a slow turret is
 * the case that goes wrong, and that is only a fast target relative to the
 * unit.
 */

import {
  PREVIEW_FRAMES,
  type StandInKey,
  type StandInTrack,
} from "./scriptPlayback";

type Vec2 = [number, number];

export type TargetPath = "crossing" | "circling" | "approaching" | "retreating";

export interface TargetMotion {
  path: TargetPath;
  /** A multiple of the unit's own speed. Zero holds the target at `anchor`. */
  speed: number;
  /**
   * Unit-local x and z, in stand-in radii. The middle of a crossing or of an
   * approach, and where a circling target is on frame 0. Dragging the target
   * moves this.
   */
  anchor: Vec2;
}

/** Straight ahead, as far out as the firing scenario's fixed track used to
 *  put its two spots, and moving at the unit's own speed. */
export const DEFAULT_TARGET: TargetMotion = {
  path: "crossing",
  speed: 1,
  anchor: [0, 10],
};

export const TARGET_PATHS: { value: TargetPath; label: string }[] = [
  { value: "crossing", label: "Crossing in front" },
  { value: "circling", label: "Circling the unit" },
  { value: "approaching", label: "Coming closer" },
  { value: "retreating", label: "Going away" },
];

/** What a motion needs to know about the unit it is beside. */
export interface TargetScale {
  /** The stand-in's radius, in elmos. */
  radius: number;
  /** The unit's own speed, in elmos a frame. */
  unitSpeed: number;
  /** How close the stand-in's middle may come to the unit's, in stand-in
   *  radii, so an approach stops short of driving through it. */
  nearest: number;
}

/**
 * How far a crossing reaches either side of its middle, and how long one
 * approach is, in stand-in radii, before either is fitted to a whole number
 * of passes. Set by eye: wide enough that the turret has to turn, and short
 * of sweeping the target behind the unit.
 */
const SWEEP = 6;

/** Radii a frame. */
function speedOf(motion: TargetMotion, scale: TargetScale): number {
  if (scale.radius <= 0) return 0;
  return (Math.max(motion.speed, 0) * scale.unitSpeed) / scale.radius;
}

function length(v: Vec2): number {
  return Math.hypot(v[0], v[1]);
}

/** A unit vector along `v`, or straight ahead for a zero vector. */
function unit(v: Vec2): Vec2 {
  const l = length(v);
  return l === 0 ? [0, 1] : [v[0] / l, v[1] / l];
}

/** `v` turned about the vertical axis, the way three.js turns x and z. */
function turn(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c];
}

/** Square to a direction, on the unit's left when the direction is ahead. */
function across(dir: Vec2): Vec2 {
  return [dir[1], -dir[0]];
}

/**
 * A crossing's reach, fitted so a whole number of back and forth passes takes
 * exactly the preview at the asked speed. The speed is kept and the width
 * gives, so the loop is seamless and the speed is what was asked for.
 */
function crossingReach(v: number): number {
  const travel = v * PREVIEW_FRAMES;
  const passes = Math.max(1, Math.round(travel / (4 * SWEEP)));
  return travel / (4 * passes);
}

/** `x` brought into 0..m, with anything a rounding error short of `m` read as
 *  0, so the closing frame of a whole number of passes lands back on frame 0's
 *  position rather than a pass's length away from it. */
function wrap(x: number, m: number): number {
  const r = ((x % m) + m) % m;
  return m - r < m * 1e-9 ? 0 : r;
}

/** How far along a crossing is on a frame, from -reach to reach, and which
 *  way it is going. Starts in the middle going out. */
function crossingOffset(
  v: number,
  frame: number,
): { offset: number; sign: number } {
  const reach = crossingReach(v);
  const d = wrap(v * frame, 4 * reach);
  if (d < reach) return { offset: d, sign: 1 };
  if (d < 3 * reach) return { offset: 2 * reach - d, sign: -1 };
  return { offset: d - 4 * reach, sign: 1 };
}

/** One approach's length and how far into the current one a frame is. Whole
 *  approaches in the preview, for the reason `crossingReach` gives. */
function leg(v: number, frame: number): { span: number; into: number } {
  const travel = v * PREVIEW_FRAMES;
  const legs = Math.max(1, Math.round(travel / SWEEP));
  const span = travel / legs;
  return { span, into: wrap(v * frame, span) };
}

/** Where the target is on a frame, unit-local x and z in stand-in radii, and
 *  which way it is heading, in radians about the vertical axis. */
export function targetAt(
  motion: TargetMotion,
  frame: number,
  scale: TargetScale,
): { at: Vec2; heading: number } {
  const anchor = motion.anchor;
  const v = speedOf(motion, scale);
  // Facing the unit while it waits.
  if (v === 0)
    return { at: anchor, heading: Math.atan2(-anchor[0], -anchor[1]) };

  const dir = unit(anchor);
  switch (motion.path) {
    case "crossing": {
      const { offset, sign } = crossingOffset(v, frame);
      const side = across(dir);
      return {
        at: [anchor[0] + side[0] * offset, anchor[1] + side[1] * offset],
        heading: Math.atan2(side[0] * sign, side[1] * sign),
      };
    }
    case "circling": {
      // The speed is kept rather than rounded to whole laps, because the
      // distance is the game maker's and a lap at unit speed far out can take
      // longer than the preview. A part lap jumps back when the preview loops.
      const r = length(anchor);
      if (r === 0) return { at: anchor, heading: 0 };
      const at = turn(anchor, (v / r) * frame);
      const tangent = across(at);
      return { at, heading: Math.atan2(tangent[0], tangent[1]) };
    }
    case "approaching":
    case "retreating": {
      const { span, into } = leg(v, frame);
      const middle = Math.max(length(anchor), scale.nearest + span / 2);
      const closer = motion.path === "approaching";
      const r = closer ? middle + span / 2 - into : middle - span / 2 + into;
      const out = closer ? -1 : 1;
      return {
        at: [dir[0] * r, dir[1] * r],
        heading: Math.atan2(dir[0] * out, dir[1] * out),
      };
    }
  }
}

/** A key for every frame of the preview, the closing one included, so the
 *  track's straight lines between keys are a frame long. */
export function targetTrack(
  motion: TargetMotion,
  scale: TargetScale,
): StandInTrack {
  const keys: StandInKey[] = [];
  for (let frame = 0; frame <= PREVIEW_FRAMES; frame++) {
    const { at, heading } = targetAt(motion, frame, scale);
    keys.push({ frame, pos: [at[0], 0, at[1]], heading });
  }
  return { keys };
}

/**
 * The anchor that puts the target at `at` on `frame`, for a target dragged
 * and let go there. The target carries on from where it was put rather than
 * jumping to wherever the old anchor's path would have it.
 *
 * `at` is unit-local x and z in stand-in radii. An approach is still kept
 * clear of the unit, so a target let go inside that ends up a little further
 * out.
 */
export function anchorFor(
  motion: TargetMotion,
  at: Vec2,
  frame: number,
  scale: TargetScale,
): Vec2 {
  const v = speedOf(motion, scale);
  if (v === 0) return at;
  const out = length(at);

  switch (motion.path) {
    case "crossing": {
      // The anchor and the offset across it are at right angles, so the
      // anchor's distance is the other side of that triangle.
      const { offset } = crossingOffset(v, frame);
      const middle = Math.sqrt(Math.max(out * out - offset * offset, 1e-6));
      const angle = Math.atan2(at[0], at[1]) - Math.atan2(offset, middle);
      return [middle * Math.sin(angle), middle * Math.cos(angle)];
    }
    case "circling":
      return out === 0 ? at : turn(at, -(v / out) * frame);
    case "approaching":
    case "retreating": {
      const { span, into } = leg(v, frame);
      const middle =
        motion.path === "approaching"
          ? out - span / 2 + into
          : out + span / 2 - into;
      const dir = unit(at);
      return [dir[0] * middle, dir[1] * middle];
    }
  }
}
