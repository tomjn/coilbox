import { type TransformValue, transformAt } from "./curves";
import type { TrackWindow } from "./trackWindow";

/** The weapon a piece of debris has, which is none. */
const DEBRIS = 65_535;

/**
 * Where something ended, for the frame being shown (#5317). The same object is
 * passed to every visit, so read what you need inside the callback.
 */
export interface ExplosionMark {
  /** Elmos along x and z, where the shot landed or the unit was last seen. */
  x: number;
  z: number;
  /** Frames since it ended, at least 1. */
  age: number;
  /** A unit's death, and not a shot landing. */
  death: boolean;
}

const mark: ExplosionMark = { x: 0, z: 0, age: 0, death: false };
const place: TransformValue = {
  x: 0,
  z: 0,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 0,
  fx: 0,
  fz: 0,
};

/**
 * Calls `visit` for every shot that landed and every unit that died in the
 * `span` frames before `frame`, in `w` and, for what ended before `w` began, in
 * `earlier`.
 *
 * Nothing records an explosion, so this works one out from the end of
 * something. A shot has landed when its last frame is before `frame` and it has
 * a weapon, since debris is not an explosion. A unit has died on its last
 * frame. A unit still there when the recording stops has no frame after its
 * last, so it never counts, and a unit that goes into a transport is still a
 * unit the track holds.
 *
 * A shot or unit that carries on into the next window has its last frame here
 * on the window's own last frame, which is no frame before one of this window.
 * It is the first frame of the next window, where the shot or unit is held
 * again with its true end. The window's frame range tells the two apart, so no
 * flag is needed. A shot that ends on that shared frame is held in both
 * windows too, and `earlier` is only asked for what ended before `w` begins, so
 * it is counted once.
 *
 * `earlier` is there so a circle does not vanish where a window begins when time
 * runs forwards over it and stay when time runs backwards.
 */
export function forEachExplosion(
  w: TrackWindow,
  earlier: TrackWindow | undefined,
  frame: number,
  span: number,
  visit: (explosion: ExplosionMark) => void,
): void {
  scan(w, frame, span, Number.POSITIVE_INFINITY, visit);
  if (earlier) scan(earlier, frame, span, w.startFrame, visit);
}

/** The ends in one window that fall in the span and before `until`. */
function scan(
  w: TrackWindow,
  frame: number,
  span: number,
  until: number,
  visit: (explosion: ExplosionMark) => void,
): void {
  const ended = (last: number) =>
    last < frame && last < until && frame - last <= span;

  // Both lists are in order of first frame, and a first frame is never after
  // the last, so nothing from the first one that starts at `frame` on can have
  // ended before it.
  mark.death = false;
  for (let i = 0; i < w.projectileCount; i++) {
    if (w.projectileFirst[i] >= frame) break;
    const last = w.projectileLast[i];
    if (!ended(last)) continue;
    if (w.projectileWeapon[i] === DEBRIS) continue;
    // A projectile always has a key at its last frame.
    const key = w.projectileKeyStart[i + 1] - 1;
    mark.x = w.shotX[key];
    mark.z = w.shotZ[key];
    mark.age = frame - last;
    visit(mark);
  }

  mark.death = true;
  for (let i = 0; i < w.unitCount; i++) {
    if (w.unitFirst[i] >= frame) break;
    const last = w.unitLast[i];
    if (!ended(last)) continue;
    if (!transformAt(w, i, last, place)) continue;
    mark.x = place.x;
    mark.z = place.z;
    mark.age = frame - last;
    visit(mark);
  }
}
