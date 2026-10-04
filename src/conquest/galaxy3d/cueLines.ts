import type { WorldPos } from "./layout";
import type { BorderPiece, MapPoint, ProvinceIndex } from "./provinces";

/**
 * The geometry of the lines `cueLayer.ts` draws on a terrain map: the stretch
 * of a crossing that lies over the gap, the shared edge of two provinces as
 * continuous lines, and a line cut into dashes. Pure and free of three.js.
 */

/**
 * Cut a line of world points into dashes `dash` long with `gap` between them,
 * measured across the ground plane. The pattern carries on round each corner,
 * so a line of many short stretches dashes as evenly as one long one. A last
 * dash shorter than half a dash is dropped.
 */
export function dashPolyline(
  points: readonly WorldPos[],
  dash: number,
  gap: number,
): WorldPos[][] {
  const out: WorldPos[][] = [];
  if (points.length < 2 || dash <= 0 || gap < 0) return out;
  // Distance along the line at each point.
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    along.push(along[i - 1] + Math.hypot(to[0] - from[0], to[2] - from[2]));
  }
  const total = along[along.length - 1];
  /** The point `d` along the line, which lies in segment `i`. */
  const at = (d: number, i: number): WorldPos => {
    const from = points[i];
    const to = points[i + 1];
    const t = (d - along[i]) / (along[i + 1] - along[i] || 1);
    return [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ];
  };
  let segment = 0;
  for (let start = 0; start < total; start += dash + gap) {
    const end = Math.min(start + dash, total);
    if (end - start < dash / 2) break;
    while (along[segment + 1] <= start) segment++;
    const piece = [at(start, segment)];
    // Every corner the dash passes on its way.
    let i = segment;
    while (along[i + 1] < end) {
      i++;
      piece.push(points[i]);
    }
    piece.push(at(end, i));
    out.push(piece);
  }
  return out;
}

/**
 * The two ends of the stretch of a crossing to draw, as map points on the
 * straight line between two anchors.
 *
 * A crossing joins two provinces that do not touch, so the stretch that tells
 * the player anything is the one over the gap between them. The line is
 * walked in steps of `step` map units: it starts at the last step inside the
 * first province and ends at the first step after that inside the second. An
 * end that is a point location, given as node index -1, keeps its anchor.
 *
 * Where the two outlines meet or overlap along the line the gap has no
 * length, so the stretch is widened about its middle to `minLength` map
 * units, or to the whole line if that is shorter.
 */
export function crossingSpan(
  index: Pick<ProvinceIndex, "contains"> | undefined,
  nodeA: number,
  nodeB: number,
  from: MapPoint,
  to: MapPoint,
  step: number,
  minLength: number,
): [MapPoint, MapPoint] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (length === 0 || step <= 0) return [from, to];
  const count = Math.max(1, Math.ceil(length / step));
  const at = (t: number): MapPoint => [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
  ];
  const inside = (node: number, i: number): boolean => {
    if (!index || node < 0) return false;
    const [x, y] = at(i / count);
    return index.contains(node, x, y);
  };
  let start = 0;
  for (let i = 0; i <= count; i++) if (inside(nodeA, i)) start = i;
  let end = count;
  for (let i = start + 1; i <= count; i++) {
    if (inside(nodeB, i)) {
      end = i;
      break;
    }
  }
  let t0 = start / count;
  let t1 = end / count;
  const want = Math.min(1, minLength / length);
  if (t1 - t0 < want) {
    const mid = Math.min(1 - want / 2, Math.max(want / 2, (t0 + t1) / 2));
    t0 = mid - want / 2;
    t1 = mid + want / 2;
  }
  return [at(t0), at(t1)];
}

/**
 * The border pieces two provinces share, joined end to end into continuous
 * lines of map points. `pieces` is the province layer's own list, so a border
 * drawn here lies exactly on the line drawn there. Two pieces join when one
 * ends where the next begins.
 */
export function sharedBorderLines(
  pieces: readonly BorderPiece[],
  nodeA: number,
  nodeB: number,
): MapPoint[][] {
  const lines: MapPoint[][] = [];
  let line: MapPoint[] | null = null;
  for (const piece of pieces) {
    const shared =
      (piece.province === nodeA && piece.neighbour === nodeB) ||
      (piece.province === nodeB && piece.neighbour === nodeA);
    if (!shared) continue;
    const tail: MapPoint | undefined = line?.[line.length - 1];
    if (
      line &&
      tail &&
      Math.hypot(tail[0] - piece.a[0], tail[1] - piece.a[1]) < 1e-6
    ) {
      line.push(piece.b);
    } else {
      line = [piece.a, piece.b];
      lines.push(line);
    }
  }
  return lines;
}
