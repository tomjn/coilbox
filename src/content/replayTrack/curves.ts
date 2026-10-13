/**
 * The value of a curve at a frame, from the keys either side of it (#3806).
 *
 * This is `crates/coilbox-track/src/curve.rs` for the curves a top down map
 * view draws: a unit's position and facing, its health and build progress, and
 * a projectile. It is the same arithmetic in the same order, in `number`s,
 * which are the `f64`s the Rust uses. Positions and velocities arrive as `f32`
 * holding whole steps of a power of two, so they are exact. The test
 * `curves.test.ts` holds this to the values the Rust reader gives.
 *
 * Not ported, because the map view does not use them: a unit's height, its
 * pose tracks, its targets and its build queue.
 *
 * Before a curve's first key its value is that key's value, and after its last
 * key the same. A frame on a key gives that key's value exactly.
 */
import type { TrackWindow } from "./trackWindow";

/** Health and build progress are stored out of this, for full or complete. */
const FRACTION_FULL = 65_535;
const FRAC_1_SQRT_2 = Math.SQRT1_2;

export interface TransformValue {
  /** Elmos. */
  x: number;
  z: number;
  /** The blended rotation as a unit quaternion. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Where the unit's front points, on the map: the quaternion's front
   *  direction `(0, 0, 1)` turned, taken along x and z. */
  fx: number;
  fz: number;
}

export interface StatusValue {
  /** 0 to 1. */
  health: number;
  /** 0 to 1, with 1 for complete. */
  build: number;
}

export interface ProjectileValue {
  x: number;
  z: number;
  /** Elmos per frame. */
  vx: number;
  vz: number;
}

/**
 * How many of `frames[lo..hi]` are at or before `frame`. The frames rise.
 * `partition_point(|k| k.frame <= frame)` in the Rust.
 */
function countAtOrBefore(
  frames: Uint32Array,
  lo: number,
  hi: number,
  frame: number,
): number {
  let from = lo;
  let to = hi;
  while (from < to) {
    const mid = (from + to) >>> 1;
    if (frames[mid] <= frame) from = mid + 1;
    else to = mid;
  }
  return from - lo;
}

/**
 * Where `frame` sits among the keys `lo..hi`. Returns the key the curve holds
 * at (`a`, with `b` set to -1), or the two keys either side with the fraction
 * `s` of the way and the frames `n` between them.
 */
interface Span {
  a: number;
  b: number;
  s: number;
  n: number;
}

const span: Span = { a: 0, b: -1, s: 0, n: 0 };

/** False when the curve has no keys. Fills the shared {@link span}. */
function locate(
  frames: Uint32Array,
  lo: number,
  hi: number,
  frame: number,
): boolean {
  if (lo >= hi) return false;
  const after = countAtOrBefore(frames, lo, hi, frame);
  if (after === 0) {
    span.a = lo;
    span.b = -1;
    return true;
  }
  const a = lo + after - 1;
  const b = lo + after;
  if (b < hi && frames[a] !== frame) {
    const n = frames[b] - frames[a];
    span.a = a;
    span.b = b;
    span.n = n;
    span.s = (frame - frames[a]) / n;
    return true;
  }
  span.a = a;
  span.b = -1;
  return true;
}

const rotationA: [number, number, number, number] = [0, 0, 0, 0];
const rotationB: [number, number, number, number] = [0, 0, 0, 0];

/** `Quantiser::rotation_value`: the quaternion `(x, y, z, w)` key `i` stands for. */
function rotationValue(
  w: TrackWindow,
  i: number,
  out: [number, number, number, number],
): void {
  const scale = (1 << (w.rotationBits - 1)) - 1;
  const k0 = (w.rotationA[i] * FRAC_1_SQRT_2) / scale;
  const k1 = (w.rotationB[i] * FRAC_1_SQRT_2) / scale;
  const k2 = (w.rotationC[i] * FRAC_1_SQRT_2) / scale;
  const dropped = Math.sqrt(Math.max(1 - (k0 * k0 + k1 * k1 + k2 * k2), 0));
  const which = w.rotationDropped[i];
  let next = 0;
  for (let c = 0; c < 4; c++) {
    if (c === which) {
      out[c] = dropped;
    } else {
      out[c] = next === 0 ? k0 : next === 1 ? k1 : k2;
      next++;
    }
  }
}

function setFront(out: TransformValue): void {
  const { qx: x, qy: y, qz: z, qw: w } = out;
  out.fx = 2 * (x * z + w * y);
  out.fz = 1 - 2 * (x * x + y * y);
}

/**
 * Unit `unit`'s position and facing at `frame`: a straight line between keys
 * for position, and the two rotations blended in the same proportion and scaled
 * back to unit length for rotation, with the second negated first when the dot
 * product is negative. False, and `out` untouched, when the unit has no keys.
 */
export function transformAt(
  w: TrackWindow,
  unit: number,
  frame: number,
  out: TransformValue,
): boolean {
  if (
    !locate(
      w.transformFrame,
      w.unitTransformStart[unit],
      w.unitTransformStart[unit + 1],
      frame,
    )
  ) {
    return false;
  }
  const { a, b, s } = span;
  rotationValue(w, a, rotationA);
  if (b < 0) {
    out.x = w.transformX[a];
    out.z = w.transformZ[a];
    [out.qx, out.qy, out.qz, out.qw] = rotationA;
    setFront(out);
    return true;
  }
  rotationValue(w, b, rotationB);
  const xa = w.transformX[a];
  const za = w.transformZ[a];
  out.x = xa + (w.transformX[b] - xa) * s;
  out.z = za + (w.transformZ[b] - za) * s;

  let dot = 0;
  for (let c = 0; c < 4; c++) dot += rotationA[c] * rotationB[c];
  const sign = dot < 0 ? -1 : 1;
  const q0 = rotationA[0] * (1 - s) + sign * rotationB[0] * s;
  const q1 = rotationA[1] * (1 - s) + sign * rotationB[1] * s;
  const q2 = rotationA[2] * (1 - s) + sign * rotationB[2] * s;
  const q3 = rotationA[3] * (1 - s) + sign * rotationB[3] * s;
  const len = Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
  if (len > 0) {
    out.qx = q0 / len;
    out.qy = q1 / len;
    out.qz = q2 / len;
    out.qw = q3 / len;
  } else {
    [out.qx, out.qy, out.qz, out.qw] = rotationA;
  }
  setFront(out);
  return true;
}

/**
 * Unit `unit`'s health and build progress at `frame`, as fractions in a
 * straight line between keys. False, and `out` untouched, when the unit has no
 * status keys.
 */
export function statusAt(
  w: TrackWindow,
  unit: number,
  frame: number,
  out: StatusValue,
): boolean {
  if (
    !locate(
      w.statusFrame,
      w.unitStatusStart[unit],
      w.unitStatusStart[unit + 1],
      frame,
    )
  ) {
    return false;
  }
  const { a, b, s } = span;
  if (b < 0) {
    out.health = w.statusHealth[a] / FRACTION_FULL;
    out.build = w.statusBuild[a] / FRACTION_FULL;
    return true;
  }
  const mix = (x: number, y: number) => (x + (y - x) * s) / FRACTION_FULL;
  out.health = mix(w.statusHealth[a], w.statusHealth[b]);
  out.build = mix(w.statusBuild[a], w.statusBuild[b]);
  return true;
}

/**
 * Projectile `projectile`'s position and velocity at `frame`. Between two keys
 * `n` frames apart the position is the cubic through both positions that
 * matches both velocities, and the velocity is the slope of that cubic divided
 * by `n`. False when the projectile has no keys.
 */
export function projectileAt(
  w: TrackWindow,
  projectile: number,
  frame: number,
  out: ProjectileValue,
): boolean {
  if (
    !locate(
      w.shotFrame,
      w.projectileKeyStart[projectile],
      w.projectileKeyStart[projectile + 1],
      frame,
    )
  ) {
    return false;
  }
  const { a, b, s, n } = span;
  if (b < 0) {
    out.x = w.shotX[a];
    out.z = w.shotZ[a];
    out.vx = w.shotVx[a];
    out.vz = w.shotVz[a];
    return true;
  }
  const s2 = s * s;
  const s3 = s * s * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const d00 = 6 * s2 - 6 * s;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = -6 * s2 + 6 * s;
  const d11 = 3 * s2 - 2 * s;
  out.x =
    h00 * w.shotX[a] +
    h10 * n * w.shotVx[a] +
    h01 * w.shotX[b] +
    h11 * n * w.shotVx[b];
  out.z =
    h00 * w.shotZ[a] +
    h10 * n * w.shotVz[a] +
    h01 * w.shotZ[b] +
    h11 * n * w.shotVz[b];
  out.vx =
    (d00 * w.shotX[a] +
      d10 * n * w.shotVx[a] +
      d01 * w.shotX[b] +
      d11 * n * w.shotVx[b]) /
    n;
  out.vz =
    (d00 * w.shotZ[a] +
      d10 * n * w.shotVz[a] +
      d01 * w.shotZ[b] +
      d11 * n * w.shotVz[b]) /
    n;
  return true;
}

/**
 * Calls `visit` with the index of every unit alive at `frame`. Units are in
 * order of first frame, so the search stops at the first one that has not
 * started and never reads a key.
 */
export function forEachAliveUnit(
  w: TrackWindow,
  frame: number,
  visit: (unit: number) => void,
): void {
  for (let i = 0; i < w.unitCount; i++) {
    if (w.unitFirst[i] > frame) break;
    if (w.unitLast[i] >= frame) visit(i);
  }
}

export function aliveUnitCount(w: TrackWindow, frame: number): number {
  let n = 0;
  forEachAliveUnit(w, frame, () => {
    n++;
  });
  return n;
}

/** The same for projectiles, which are also in order of first frame. */
export function forEachAliveProjectile(
  w: TrackWindow,
  frame: number,
  visit: (projectile: number) => void,
): void {
  for (let i = 0; i < w.projectileCount; i++) {
    if (w.projectileFirst[i] > frame) break;
    if (w.projectileLast[i] >= frame) visit(i);
  }
}
