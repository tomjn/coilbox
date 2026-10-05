import type { WorldPos } from "./layout";
import type { BorderPiece, MapPoint } from "./provinces";

/**
 * The geometry of the lines `cueLayer.ts` draws on a terrain map: the shared
 * edge of two provinces as continuous lines, and a line cut into dashes. Pure
 * and free of three.js. A crossing's route is in `seaRoute.ts`.
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
