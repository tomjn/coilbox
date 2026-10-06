import type { MapPoint } from "./provinces";

/**
 * Where a sea crossing runs on a terrain map, in map units. Pure and free of
 * three.js, so `cueLayer.ts` draws what is tested here.
 *
 * A crossing leaves its first location over land, puts to sea at a landing
 * point on that coast, follows a gentle curve across the water, and lands on
 * the far coast before running on over land to the second location. The two
 * landing points are where the straight line between the locations first
 * leaves land and last reaches it. The curve bows to whichever side crosses
 * the least land on the way.
 */
export interface SeaRoute {
  /** The first location, then its landing point. Two equal points when it is at sea. */
  jettyA: [MapPoint, MapPoint];
  /** From landing point to landing point, the curve across the water. */
  sea: MapPoint[];
  /** The second landing point, then the second location. */
  jettyB: [MapPoint, MapPoint];
}

/**
 * How far the curve's control point stands off the straight line between the
 * landing points, as shares of that line's length, in the order they are
 * tried. The first is the gentle bow every crossing has. The curve's widest
 * point is half the control point's offset.
 */
const BOWS = [0.12, 0.25, 0.4, 0.6, 0.8];

/** Halvings of a step when a coast is pinned down between two samples. */
const COAST_REFINE = 8;

/** How far off a shore the curve tries to keep, in steps. */
const CLEARANCE_STEPS = 2;

/** Points on the curve, at most. */
const MAX_CURVE_POINTS = 96;

/**
 * The route of a crossing from `from` to `to`, or `undefined` when no coast
 * can be found on the line between them. That is when the line never reaches
 * the sea, or the water it crosses is narrower than a step, and the caller
 * then draws the straight line. `isLand` says whether
 * a map point is land. `step` is the distance between samples, the size of
 * the smallest bay or headland the route notices.
 */
export function seaRoute(
  from: MapPoint,
  to: MapPoint,
  isLand: (x: number, y: number) => boolean,
  step: number,
): SeaRoute | undefined {
  const length = distance(from, to);
  if (length === 0 || step <= 0) return undefined;
  const count = sampleCount(length, step);
  const at = (t: number): MapPoint => lerp(from, to, t);
  const land = (t: number): boolean => {
    const [x, y] = at(t);
    return isLand(x, y);
  };

  // The first sample at sea, and the last.
  let first = -1;
  let last = -1;
  for (let i = 0; i <= count; i++) {
    if (land(i / count)) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return undefined;

  /** The coast between a land sample and a sea sample, by halving. */
  const coast = (landT: number, seaT: number): number => {
    let a = landT;
    let b = seaT;
    for (let k = 0; k < COAST_REFINE; k++) {
      const mid = (a + b) / 2;
      if (land(mid)) a = mid;
      else b = mid;
    }
    return b;
  };
  const t0 = first === 0 ? 0 : coast((first - 1) / count, first / count);
  const t1 = last === count ? 1 : coast((last + 1) / count, last / count);
  const landingA = at(t0);
  const landingB = at(t1);
  // Water narrower than a step is below what the samples can tell from the
  // coast, and would leave the crossing with no stretch at sea to draw.
  if (distance(landingA, landingB) < step) return undefined;

  return {
    jettyA: [from, landingA],
    sea: seaCurve(landingA, landingB, isLand, step),
    jettyB: [landingB, to],
  };
}

/** Samples along a line of `length`, as many as {@link seaRoute} takes. */
const sampleCount = (length: number, step: number): number =>
  Math.max(2, Math.ceil(length / step));

/**
 * True when every sample on the straight line from `from` to `to` is land, so
 * the line has no water to put a sea lane on. Samples the line as
 * {@link seaRoute} does, so the two agree: a line that is dry here is one
 * `seaRoute` finds no coast on.
 */
export function isDryLine(
  from: MapPoint,
  to: MapPoint,
  isLand: (x: number, y: number) => boolean,
  step: number,
): boolean {
  const length = distance(from, to);
  if (length === 0 || step <= 0) return false;
  const count = sampleCount(length, step);
  for (let i = 0; i <= count; i++) {
    const [x, y] = lerp(from, to, i / count);
    if (!isLand(x, y)) return false;
  }
  return true;
}

/**
 * A gentle curve from `a` to `b` that keeps off the land where it can. Each
 * bow in {@link BOWS} is tried on both sides, and the curve that crosses the
 * fewest land samples wins. A tie goes to the gentler bow, then to the left
 * of the direction of travel, so the same map always draws the same route.
 */
export function seaCurve(
  a: MapPoint,
  b: MapPoint,
  isLand: (x: number, y: number) => boolean,
  step: number,
): MapPoint[] {
  const length = distance(a, b);
  if (length === 0 || step <= 0) return [a, b];
  const count = Math.min(
    MAX_CURVE_POINTS,
    Math.max(2, Math.ceil(length / step)),
  );
  // The left-hand normal of the direction of travel, in map units.
  const nx = -(b[1] - a[1]) / length;
  const ny = (b[0] - a[0]) / length;
  const mid = lerp(a, b, 0.5);
  const clear = CLEARANCE_STEPS * step;
  let best: MapPoint[] = [];
  let bestLand = Number.POSITIVE_INFINITY;
  for (const bow of BOWS) {
    for (const side of [1, -1]) {
      const control: MapPoint = [
        mid[0] + nx * bow * length * side,
        mid[1] + ny * bow * length * side,
      ];
      const points = quadratic(a, control, b, count);
      // The two ends are on the coast, so only the points between count.
      // Land a little to either side counts too, so the curve that wins
      // stands off a shore rather than brushing it. Near its ends the curve
      // is meant to be beside the coast it lands on, so there only the
      // point itself counts.
      let onLand = 0;
      for (let i = 1; i < points.length - 1; i++) {
        const [x, y] = points[i];
        if (isLand(x, y)) onLand++;
        if (
          Math.min(distance(points[i], a), distance(points[i], b)) <
          2 * clear
        )
          continue;
        if (isLand(x + nx * clear, y + ny * clear)) onLand++;
        if (isLand(x - nx * clear, y - ny * clear)) onLand++;
      }
      if (onLand < bestLand) {
        best = points;
        bestLand = onLand;
      }
    }
    if (bestLand === 0) break;
  }
  return best;
}

/** `count + 1` points along a quadratic Bezier curve, both ends included. */
function quadratic(
  a: MapPoint,
  control: MapPoint,
  b: MapPoint,
  count: number,
): MapPoint[] {
  const out: MapPoint[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const u = 1 - t;
    out.push([
      u * u * a[0] + 2 * u * t * control[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * control[1] + t * t * b[1],
    ]);
  }
  return out;
}

const distance = (a: MapPoint, b: MapPoint): number =>
  Math.hypot(b[0] - a[0], b[1] - a[1]);

const lerp = (a: MapPoint, b: MapPoint, t: number): MapPoint => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
