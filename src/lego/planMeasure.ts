/**
 * Small helpers the body plans measure a fitted unit with (#3261). Each takes
 * the joints of the bones the game maker picked and gives undefined for
 * anything a missing joint leaves unknown.
 */

export type Vec3 = [number, number, number];

/** Where each picked bone's joint is in the unit, by bone id. */
export type Joints = ReadonlyMap<string, Vec3>;

/** The distance between two bones' joints. */
export function between(joints: Joints, a: string, b: string) {
  const from = joints.get(a);
  const to = joints.get(b);
  if (!from || !to) return undefined;
  return Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
}

/** How far the second bone's joint is above the first's. */
export function rise(joints: Joints, from: string, to: string) {
  const a = joints.get(from);
  const b = joints.get(to);
  return a && b ? b[1] - a[1] : undefined;
}

/** The mean of the values that are known. */
export function mean(values: (number | undefined)[]) {
  const known = values.filter((v): v is number => v !== undefined);
  return known.length > 0
    ? known.reduce((sum, v) => sum + v, 0) / known.length
    : undefined;
}

/**
 * The gap between neighbours in a row of evenly spaced places along z, from
 * the first and last places known. `rows` is the row in order, each entry the
 * bones at that place, such as the two wheels of one axle.
 */
export function spacingAlongZ(joints: Joints, rows: string[][]) {
  const known = rows.flatMap((ids, index) => {
    const z = mean(ids.map((id) => joints.get(id)?.[2]));
    return z === undefined ? [] : [{ index, z }];
  });
  const first = known[0];
  const last = known[known.length - 1];
  if (!first || !last || first === last) return undefined;
  return Math.abs(last.z - first.z) / (last.index - first.index);
}
