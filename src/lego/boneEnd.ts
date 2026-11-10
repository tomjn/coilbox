export type Vec3 = [number, number, number];

/** Which axis wins when two are as long as each other and reach as far from
 *  the origin: z first, the way a unit faces, then y, then x. */
const AXIS_ORDER: readonly (0 | 1 | 2)[] = [2, 1, 0];

/**
 * The far end of a piece's geometry, in the piece's own space, from its box.
 * `boneEnd` in `lua/skeleton-widget/luaui/coilbox_skeleton/skeleton.lua` is the
 * same rule, and `boneEnd.test.ts` runs that file's cases through this one so
 * the two cannot drift (issue #5183).
 *
 * Take the axis the box is longest along (max - min). The end is the middle of
 * the box face on that axis that lies farther from the origin. Being the middle
 * of a face, it keeps the box's offset on the other two axes, so a barrel
 * mounted above its pivot gets a bone that points at the barrel.
 *
 * Ties: between axes of the same length, the one whose far face lies farther
 * from the origin, then z, y, x. Between two faces as far from the origin as
 * each other, the positive one.
 *
 * Returns null for a box that is a point at the origin, which has no bone.
 */
export function boneEnd(min: Vec3, max: Vec3): Vec3 | null {
  let best: 0 | 1 | 2 = 2;
  let bestLength = -Infinity;
  let bestReach = 0;
  for (const axis of AXIS_ORDER) {
    const length = max[axis] - min[axis];
    const reach = Math.max(Math.abs(min[axis]), Math.abs(max[axis]));
    if (length > bestLength || (length === bestLength && reach > bestReach)) {
      best = axis;
      bestLength = length;
      bestReach = reach;
    }
  }
  // `+ 0` turns a negative zero into zero.
  const end: Vec3 = [
    (min[0] + max[0]) / 2 + 0,
    (min[1] + max[1]) / 2 + 0,
    (min[2] + max[2]) / 2 + 0,
  ];
  end[best] =
    (Math.abs(min[best]) > Math.abs(max[best]) ? min[best] : max[best]) + 0;
  if (end[0] === 0 && end[1] === 0 && end[2] === 0) return null;
  return end;
}
