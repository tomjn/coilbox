import type { RiverLine } from "../rivers";
import type { RoadLine } from "./roadMask";
import type { MapXY } from "./roadRoute";

/**
 * Where roads cross rivers. The terrain shader draws a bridge wherever a road
 * runs over water (`groundShader.ts`), so a bridge is as straight as the road
 * is there. This straightens each road over every river it crosses.
 *
 * Pure, so it is tested without a scene.
 */

/**
 * Rivers found on a picture `wide` pixels across, `margin` of them past the
 * map on each side, in map units of a map `mapWidth` by `mapHeight`: x, y
 * and half width triples, the half width turned from world units by `scale`
 * world units a map unit.
 */
export function riversInMapUnits(
  lines: readonly RiverLine[],
  wideWidth: number,
  wideHeight: number,
  margin: number,
  mapWidth: number,
  mapHeight: number,
  scale: number,
): Float32Array[] {
  const sx = mapWidth / (wideWidth - 2 * margin);
  const sy = mapHeight / (wideHeight - 2 * margin);
  return lines.map(({ points }) => {
    const out = new Float32Array(points.length);
    for (let k = 0; k < points.length; k += 3) {
      out[k] = (points[k] - margin) * sx;
      out[k + 1] = (points[k + 1] - margin) * sy;
      out[k + 2] = points[k + 2] / scale;
    }
    return out;
  });
}

/** How far a bridge runs past each bank, in world units, as the shader draws it. */
export const BRIDGE_OVERHANG = 0.025;
/** Road kept straight beyond the bridge's ends, in world units. */
const APPROACH = 0.18;

/** Where segment a-b meets segment c-d, as the share of the way along a-b, or -1. */
function meet(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const rx = bx - ax;
  const ry = by - ay;
  const qx = dx - cx;
  const qy = dy - cy;
  const den = rx * qy - ry * qx;
  if (den === 0) return -1;
  const t = ((cx - ax) * qy - (cy - ay) * qx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

/** Points along a line, by distance from its start. */
function along(line: MapXY[]): number[] {
  const out = [0];
  for (let k = 1; k < line.length; k++) {
    const dx = line[k][0] - line[k - 1][0];
    const dy = line[k][1] - line[k - 1][1];
    out.push(out[k - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return out;
}

/** The point `s` along a line whose distances are `at`. */
function pointAt(line: MapXY[], at: number[], s: number): MapXY {
  let k = 1;
  while (k < line.length - 1 && at[k] < s) k++;
  const span = at[k] - at[k - 1];
  const f = span === 0 ? 0 : Math.min(1, Math.max(0, (s - at[k - 1]) / span));
  return [
    line[k - 1][0] + (line[k][0] - line[k - 1][0]) * f,
    line[k - 1][1] + (line[k][1] - line[k - 1][1]) * f,
  ];
}

/**
 * One road's line made straight over each river it crosses: from a little
 * before the water to a little after it, the road runs as one straight
 * stretch. `rivers` are x, y and half width triples in map units, and
 * `scale` is world units a map unit.
 */
export function straightenOverRivers(
  line: MapXY[],
  rivers: readonly Float32Array[],
  scale: number,
): MapXY[] {
  if (line.length < 2 || rivers.length === 0) return line;
  const at = along(line);
  // Each crossing's place along the road and how far either side of it to
  // keep straight.
  const cuts: { from: number; to: number }[] = [];
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, ay] = line[k];
    const [bx, by] = line[k + 1];
    for (const r of rivers) {
      for (let j = 0; j + 5 < r.length; j += 3) {
        const t = meet(ax, ay, bx, by, r[j], r[j + 1], r[j + 3], r[j + 4]);
        if (t < 0) continue;
        const s = at[k] + (at[k + 1] - at[k]) * t;
        // A river crossed at a slant is wider along the road, so reach on
        // past both banks in any case.
        const half =
          (Math.max(r[j + 2], r[j + 5]) * 1.6 + BRIDGE_OVERHANG + APPROACH) /
          scale;
        cuts.push({ from: s - half, to: s + half });
      }
    }
  }
  if (cuts.length === 0) return line;
  cuts.sort((p, q) => p.from - q.from);
  const total = at[at.length - 1];
  const out: MapXY[] = [];
  let k = 0;
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const { from, to } of cuts) {
    const start = Math.max(0, from);
    const end = Math.min(total, to);
    if (start <= lastEnd) {
      // Two crossings close together share one straight stretch.
      if (end > lastEnd) {
        out[out.length - 1] = pointAt(line, at, end);
        lastEnd = end;
      }
    } else {
      while (k < line.length && at[k] < start) out.push(line[k++]);
      out.push(pointAt(line, at, start), pointAt(line, at, end));
      lastEnd = end;
    }
    while (k < line.length && at[k] <= lastEnd) k++;
  }
  while (k < line.length) out.push(line[k++]);
  // Drop points left on top of one another.
  return out.filter(
    (p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1],
  );
}

/** {@link straightenOverRivers} for every road. */
export function straightenRoads(
  roads: RoadLine[],
  rivers: readonly Float32Array[],
  scale: number,
): RoadLine[] {
  if (rivers.length === 0) return roads;
  return roads.map((road) => ({
    ...road,
    line: straightenOverRivers(road.line, rivers, scale),
  }));
}
