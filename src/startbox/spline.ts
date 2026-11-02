import type { WorldPoint } from "./polygon";

/**
 * Curved start boxes (issue #343). A box with three or more points is a closed
 * ring of anchors. Each anchor has a strength from 0 to 1, and the stretch
 * between two anchors bends by the mean of their two strengths: 0 is a straight
 * edge and 1 is the full curve. The curve is a centripetal Catmull-Rom spline,
 * the kind that does not loop or overshoot where anchors sit unevenly apart.
 * BAR's game cuts the same ring into the same points, so the preview matches
 * the area the game enforces.
 */

/** A ring point, with how far the edges leaving it curve. */
export interface Anchor {
  x: number;
  z: number;
  strength?: number;
}

/** Straight pieces each curved edge is cut into, as BAR cuts it. */
export const SEGMENTS_PER_EDGE = 12;

/** Below this, two knots are the same knot and the curve is not defined there. */
const KNOT_EPSILON = 1e-9;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Centripetal parameter distance: the square root of the distance. */
const knotGap = (a: WorldPoint, b: WorldPoint) =>
  Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5;

/** The point at `t` on the line through `a` (at `ta`) and `b` (at `tb`). */
function along(
  a: WorldPoint,
  b: WorldPoint,
  ta: number,
  tb: number,
  t: number,
): WorldPoint {
  const w = (t - ta) / (tb - ta);
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
}

/**
 * The curve between `p1` and `p2` at `u` from 0 to 1, with `p0` before and `p3`
 * after, by three rounds of blending between neighbouring points.
 */
function curveAt(
  p0: WorldPoint,
  p1: WorldPoint,
  p2: WorldPoint,
  p3: WorldPoint,
  u: number,
): WorldPoint {
  const t1 = knotGap(p0, p1);
  const t2 = t1 + knotGap(p1, p2);
  const t3 = t2 + knotGap(p2, p3);
  if (t2 - t1 <= KNOT_EPSILON) return p1;
  const t = t1 + (t2 - t1) * u;
  const a1 = t1 > KNOT_EPSILON ? along(p0, p1, 0, t1, t) : p1;
  const a2 = along(p1, p2, t1, t2, t);
  const a3 = t3 - t2 > KNOT_EPSILON ? along(p2, p3, t2, t3, t) : p2;
  const b1 = along(a1, a2, 0, t2, t);
  const b2 = along(a2, a3, t1, t3, t);
  return along(b1, b2, t1, t2, t);
}

/**
 * A closed ring of anchors as the points of a polygon. Every anchor is kept,
 * and each edge with a strength above 0 gets points between its two anchors.
 * A ring of two or fewer anchors, or one with no strengths, comes back as it
 * went in.
 */
export function tessellateRing(anchors: readonly Anchor[]): WorldPoint[] {
  const n = anchors.length;
  const at = (i: number): WorldPoint => {
    const a = anchors[((i % n) + n) % n];
    return [a.x, a.z];
  };
  const out: WorldPoint[] = [];
  for (let i = 0; i < n; i++) {
    out.push(at(i));
    if (n < 3) continue;
    const bend = clamp01(
      (clamp01(anchors[i].strength ?? 0) +
        clamp01(anchors[(i + 1) % n].strength ?? 0)) /
        2,
    );
    if (bend <= 0) continue;
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 1; k < SEGMENTS_PER_EDGE; k++) {
      const [cx, cz] = curveAt(p0, p1, p2, p3, k / SEGMENTS_PER_EDGE);
      // Blended toward the straight edge by `bend`, so a bend of 0 is a line
      // and a bend of 1 is the whole curve.
      const lx = p1[0] + (p2[0] - p1[0]) * (k / SEGMENTS_PER_EDGE);
      const lz = p1[1] + (p2[1] - p1[1]) * (k / SEGMENTS_PER_EDGE);
      out.push([lx + (cx - lx) * bend, lz + (cz - lz) * bend]);
    }
  }
  return out;
}
